/**
 * Equation Pyramid 竞赛适配器（服务端 gameType='eqpyr'）
 *
 * 两条协议路径：
 * A. CF DO（room.gameType='equation-pyramid'）：
 *    - 服务端推送 eqpyr_new_game{round,maxRounds,target,cells:[{id,num,op}],solutionsCount,timeLimit,players}
 *    - 客户端发送 {type:'eqpyr_solve', equation:[ids] | 'A,B,C'}（3 个互异 id）
 *    - 服务端推送 eqpyr_solved{player,solver,players} / eqpyr_timeout{target,cells,players}
 *
 * B. SV 中继（room.gameType='equation-pyramid' 走 mdcomp）：
 *    - 服务端推送 new_round{hasPuzzle:false,round,...} —— 房主本地引擎出题后 set_puzzle
 *    - 服务端推送 puzzle{gameType:'equation-pyramid',payload:{target,cells,solutionsCount}}
 *    - 客户端本地解出 → shell.relaySubmit()（=submit_answer{result:true}，SV 仅计时不校验）
 *    - 终局 race_over 由 SV 广播，外壳统一处理
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';
import { generateBoard } from '../../equation-pyramid/engine';

export interface EqpyrAdapterOpts {
  label: string;
  tier?: 'warmup' | 'standard' | 'tricky';
  rounds?: number;
  timeLimit?: number;  // 服务端固定 60s；此处仅 DEMO 用
  raceMax?: number;
}

const NAMES = ['A','B','C','D','E','F','G','H','I'];

export function createEqpyrAdapter(opts: EqpyrAdapterOpts): MpAdapter {
  let last: { target: number; cells: { id: string; num: number; op: string }[]; solutionsCount?: number } | null = null;
  let picks: string[] = [];
  let myName = '';

  /* 运算符号白名单。relay 模式下题面由房主广播，op 完全不可信：
     渲染、判题、提交三处都只能接受这 4 个字符，其余一律当空。 */
  const OPS = ['+', '-', '×', '÷'];
  const sanitizeOp = (s: any): string => {
    const v = String(s == null ? '' : s).trim();
    return OPS.indexOf(v) >= 0 ? v : '';
  };

  const render = (boardEl: HTMLElement, shell: MpShell) => {
    if (!last) { boardEl.innerHTML = '<p style="color:#6B7280">Waiting for puzzle…</p>'; return; }
    const { target, cells, solutionsCount } = last;
    picks = [];
    boardEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;color:#6B7280';
    /* 安全（2026-10-06）：target 此前是 payload 原值直接拼进 innerHTML，而 relay 模式下
       payload 由**房主**通过 set_puzzle 广播给全体成员 → 一个恶意房主即可在所有参与者
       页面执行任意脚本（存储型 XSS）。改为用 DOM 节点 + textContent 写值。 */
    const topLabel = document.createElement('span');
    topLabel.style.cssText = 'font-size:12px;letter-spacing:.5px;text-transform:uppercase';
    topLabel.textContent = 'Target';
    const topVal = document.createElement('b');
    topVal.style.cssText = 'font-size:30px;color:#B45309;letter-spacing:1px';
    topVal.textContent = String(target);
    top.appendChild(topLabel);
    top.appendChild(topVal);
    if (solutionsCount != null) {
      const sol = document.createElement('span');
      sol.style.cssText = 'margin-left:8px;font-size:12px;color:#9CA3AF';
      sol.textContent = `· ${solutionsCount} solution${solutionsCount === 1 ? '' : 's'}`;
      top.appendChild(sol);
    }
    wrap.appendChild(top);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,64px);gap:6px';
    for (const id of NAMES) {
      const cell = cells.find((c) => c.id === id);
      if (!cell) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = id;
      btn.style.cssText = 'width:64px;height:64px;border-radius:10px;background:#FFFFFF;border:1px solid #E5E7EB;color:#1A1B2E;font-size:18px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:background .15s,border-color .15s,transform .1s';
      /* 安全（2026-10-06）：cell.op 此前只经 String() 就进 innerHTML，同样是房主可控的
         注入面。num 已由 renderRound 用 Number() 收敛，op 则必须白名单化。 */
      const numSpan = document.createElement('span');
      numSpan.style.cssText = 'font-size:20px;line-height:1';
      numSpan.textContent = String(cell.num);
      const opSpan = document.createElement('span');
      opSpan.style.cssText = 'font-size:11px;color:#9CA3AF;line-height:1';
      opSpan.textContent = sanitizeOp(cell.op) || '·';
      btn.appendChild(numSpan);
      btn.appendChild(opSpan);
      btn.addEventListener('click', () => onPick(id));
      grid.appendChild(btn);
    }
    wrap.appendChild(grid);

    const expr = document.createElement('div');
    expr.id = 'mpEqpyrExpr';
    expr.style.cssText = 'min-height:24px;font-size:14px;color:#6B7280';
    expr.textContent = 'Pick 3 cells to form aᵒᵖ bᵒᵖ c = target';
    wrap.appendChild(expr);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = '🚀 Submit';
    submitBtn.style.cssText = 'background:#F59E0B;color:#1a1305;border:none;border-radius:9px;padding:9px 18px;font-weight:700;cursor:pointer;font-size:14px;opacity:.5;pointer-events:none';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', () => {
      if (picks.length !== 3) return;
      /* SV 中继模式：本地校验三格表达式是否等于 target（用 evaluate），等于就 relaySubmit
         否则保留原 DO 协议发送 eqpyr_solve 让服务端验证。 */
      const triple = picks.map((id) => {
        const c = cells.find((x) => x.id === id)!;
        return { num: c.num, op: c.op };
      });
      const ok = (() => {
        if (!shell.relay) return null;          // DO 路径不本地判
        /* 安全（2026-10-06）：符号映射此前只认 ×/÷，其余字符原样拼进 eval()。
         而 op 来自**房主**广播的 relay payload —— 房主发 op:"+alert(document.cookie)+"
         就会在每个参与者页面执行任意脚本。改为：op 白名单化 + 纯算术求值，彻底不用 eval。 */
        const a = Number(triple[0].num), b = Number(triple[1].num), c = Number(triple[2].num);
        const o1 = sanitizeOp(triple[0].op), o2 = sanitizeOp(triple[1].op);
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !o1 || !o2) return false;
        const apply = (x: number, y: number, op: string): number => {
          switch (op) {
            case '+': return x + y;
            case '-': return x - y;
            case '×': return x * y;
            case '÷': return y === 0 ? NaN : x / y;
            default: return NaN;
          }
        };
        const r = Math.round(apply(apply(a, b, o1), c, o2));
        return Number.isFinite(r) && r === Number(target);
      })();
      if (ok === true) {
        shell.relaySubmit();
        submitBtn.disabled = true;
        return;
      }
      shell.sendAction({ type: 'eqpyr_solve', equation: picks.slice() });
      submitBtn.disabled = true;
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'background:#F3F4F6;color:#1A1B2E;border:1px solid #E5E7EB;border-radius:9px;padding:9px 14px;font-weight:600;cursor:pointer;font-size:13px';
    clearBtn.addEventListener('click', () => { picks = []; refresh(); });
    actions.appendChild(submitBtn);
    actions.appendChild(clearBtn);
    wrap.appendChild(actions);

    boardEl.appendChild(wrap);

    function onPick(id: string) {
      const idx = picks.indexOf(id);
      if (idx >= 0) picks.splice(idx, 1);
      else if (picks.length < 3) picks.push(id);
      else picks.shift(), picks.push(id);
      refresh();
    }
    function refresh() {
      const buttons = grid.querySelectorAll<HTMLButtonElement>('button[data-id]');
      buttons.forEach((b) => {
        const i = picks.indexOf(b.dataset.id || '');
        b.style.background = i >= 0 ? '#FEF3C7' : '#FFFFFF';
        b.style.borderColor = i >= 0 ? '#F59E0B' : '#E5E7EB';
        b.style.transform = i >= 0 ? 'translateY(-1px)' : 'none';
      });
      const exprEl = boardEl.querySelector('#mpEqpyrExpr') as HTMLElement;
      if (exprEl) {
        if (!picks.length) exprEl.textContent = 'Pick 3 cells to form aᵒᵖ bᵒᵖ c = target';
        else {
          const segs = picks.map((id) => {
            const c = cells.find((x) => x.id === id)!;
            return `${c.num}`;
          });
          exprEl.innerHTML = `Selected: <b style="color:#B45309">${segs.join(' · ')}</b>`;
        }
      }
      submitBtn.disabled = picks.length !== 3;
      submitBtn.style.opacity = picks.length === 3 ? '1' : '.5';
      submitBtn.style.pointerEvents = picks.length === 3 ? 'auto' : 'none';
    }
  };

  return {
    gameType: 'eqpyr',
    label: opts.label,
    difficulty: opts.tier,
    rounds: opts.rounds,
    timeLimit: opts.timeLimit,
    raceMax: opts.raceMax,
    makeDemoPuzzle(_round: number) {
      const board = generateBoard(opts.tier || 'standard', Math.random);
      return {
        target: board.target,
        cells: board.cells.map((c, i) => ({ id: NAMES[i], num: c.num, op: c.op })),
        solutionsCount: board.solutions.length,
      };
    },
    /* SV 中继出题：复用前端引擎，**只导出题目，不带 solution/solutions 数组**（防对手直接抄答案） */
    makeRacePuzzle(_round: number) {
      const board = generateBoard(opts.tier || 'standard', Math.random);
      return {
        target: board.target,
        cells: board.cells.map((c, i) => ({ id: NAMES[i], num: c.num, op: c.op })),
        solutionsCount: board.solutions.length,
      };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      /* 安全（2026-10-06）：target 与 op 均来自房主广播的 relay payload，
         此处统一收敛 —— target 强制 Number，op 走白名单。
         非数字 target 一律记为 NaN，渲染成 "NaN" 而不是把原字符串留在状态里。 */
      last = {
        target: Number(payload?.target),
        cells: (payload?.cells || []).map((c: any) => ({ id: String(c.id), num: Number(c.num), op: sanitizeOp(c.op) })),
        solutionsCount: payload?.solutionsCount,
      };
      render(boardEl, shell);
    },
    onMessage(msg: any, shell: MpShell): boolean {
      if (msg.type === 'eqpyr_solved') {
        // 标记自己已提交
        if (msg.solver === myName) shell.markSolved();
        return true;
      }
      if (msg.type === 'eqpyr_timeout') {
        // 展示正确答案（target + cells）
        last = {
          target: Number(msg?.target),
          cells: (msg?.cells || []).map((c: any) => ({ id: String(c.id), num: Number(c.num), op: sanitizeOp(c.op) })),
        };
        return true;
      }
      return false;
    },
  };
}