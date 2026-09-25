/**
 * Equation Pyramid 竞赛适配器（服务端 gameType='eqpyr'）
 * 协议（worker/.../durable/game-room.js）：
 *   - 服务端推送 eqpyr_new_game{round,maxRounds,target,cells:[{id,num,op}],solutionsCount,timeLimit,players}
 *   - 客户端发送 {type:'eqpyr_solve', equation:[ids] | 'A,B,C'}（3 个互异 id）
 *   - 服务端推送 eqpyr_solved{player,solver,players} / eqpyr_timeout{target,cells,players}
 *   - 终局 game_over{ranking,elo}（外壳原生处理）
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

  const render = (boardEl: HTMLElement, shell: MpShell) => {
    if (!last) { boardEl.innerHTML = '<p style="color:#6B7280">Waiting for puzzle…</p>'; return; }
    const { target, cells, solutionsCount } = last;
    picks = [];
    boardEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;color:#6B7280';
    top.innerHTML = `<span style="font-size:12px;letter-spacing:.5px;text-transform:uppercase">Target</span><b style="font-size:30px;color:#B45309;letter-spacing:1px">${target}</b>${
      solutionsCount != null ? `<span style="margin-left:8px;font-size:12px;color:#9CA3AF">· ${solutionsCount} solution${solutionsCount === 1 ? '' : 's'}</span>` : ''
    }`;
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
      btn.innerHTML = `<span style="font-size:20px;line-height:1">${cell.num}</span><span style="font-size:11px;color:#9CA3AF;line-height:1">${cell.op || '·'}</span>`;
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
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      last = {
        target: payload.target,
        cells: (payload.cells || []).map((c: any) => ({ id: String(c.id), num: Number(c.num), op: String(c.op || '') })),
        solutionsCount: payload.solutionsCount,
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
          target: msg.target,
          cells: (msg.cells || []).map((c: any) => ({ id: String(c.id), num: Number(c.num), op: String(c.op || '') })),
        };
        return true;
      }
      return false;
    },
  };
}