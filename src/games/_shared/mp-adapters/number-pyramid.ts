/**
 * Number Pyramid 竞赛适配器（服务端权威版）
 *
 * 双协议：
 * A. CF DO（gameType='number-pyramid'）：
 *    - np_new_game{round,maxRounds,levels,cells:[{i,num,owner}],timeLimit,players}
 *    - 客户端 {type:'np_place', i, value} → 服务端逐格校验
 *    - np_placed/np_round_over/np_timeout 回显
 *
 * B. SV 中继（gameType='number-pyramid' 经 mdcomp）：
 *    - new_round{hasPuzzle:false,round,...} → 房主本地 generateTower(5) → set_puzzle
 *    - puzzle{levels,cells[]}（不包含 solution）广播
 *    - 客户端本地校验「上格 = 下层两格之和」 + 全部匹配 solution → shell.relaySubmit()
 *    - 终局 race_over 由 SV 广播
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';
import { generateTower } from '../../number-pyramid/engine';

export interface NumberPyramidAdapterOpts {
  label: string;
  height?: 4 | 5 | 6;
  rounds?: number;
  timeLimit?: number;
  raceMax?: number;
}

interface PyramidCell { i: number; num: number | null; owner: 0 | 1 | 2 }

const myName = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mp_name') || '' : '');

/* SV 中继：校验整塔是否填满且每砖 = 下层两砖之和。
   与 number-pyramid 引擎同款规则（生成塔时使用），用前缀和计算下标。 */
function checkNumpyrComplete(grid: number[], sol: number[], lv: number): boolean {
  if (grid.length !== sol.length) return false;
  for (let i = 0; i < grid.length; i++) if (!grid[i] || grid[i] !== sol[i]) return false;
  // 算式一致性
  const idxAt = (level: number, col: number) => { let c = 0; for (let l = 0; l < level; l++) c += l + 1; return c + col; };
  for (let level = lv - 2; level >= 0; level--) {
    for (let col = 0; col <= level; col++) {
      const a = grid[idxAt(level + 1, col)];
      const b = grid[idxAt(level + 1, col + 1)];
      const top = grid[idxAt(level, col)];
      if (top !== a + b) return false;
    }
  }
  return true;
}

export function createNumberPyramidAdapter(opts: NumberPyramidAdapterOpts): MpAdapter {
  const height = opts.height || 5;
  let cells: PyramidCell[] = [];
  let levels = height;
  let inputs: Record<number, HTMLInputElement> = {};
  let locked: Record<number, number> = {};
  let solution: number[] = [];      // SV 中继：完整解（供本地校验）


  const render = (boardEl: HTMLElement, shell: MpShell) => {
    boardEl.innerHTML = '';
    inputs = {};
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0';
    // 金字塔形渲染：第 level 行渲染 level+1 格，居中对齐（idx 前缀和定位）
    const idxAt = (level: number, col: number) => { let c = 0; for (let l = 0; l < level; l++) c += l + 1; return c + col; };
    const byIdx = new Map<number, PyramidCell>(cells.map((c) => [c.i, c]));
    for (let level = 0; level < levels; level++) {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = 'display:flex;gap:5px;justify-content:center';
      for (let col = 0; col <= level; col++) {
        const cell = byIdx.get(idxAt(level, col));
        if (!cell) continue;
        const tile = document.createElement('div');
        tile.style.cssText = 'width:52px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-weight:800;font-size:18px;';
        if (cell.num != null) {
          tile.style.cssText += 'background:#FEF3C7;border:1px solid #F59E0B;color:#B45309';
          tile.textContent = String(cell.num);
        } else if (locked[cell.i]) {
          tile.style.cssText += 'background:#FFFFFF;border:1px solid #E5E7EB;color:#1A1B2E';
          tile.textContent = String(locked[cell.i]);
        } else {
          tile.style.cssText += 'background:#F9FAFB;border:1px solid #E5E7EB';
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.min = '1';
          inp.max = '999';
          inp.placeholder = '?';
          inp.style.cssText = 'width:100%;height:100%;border:none;background:transparent;outline:none;text-align:center;font-weight:800;font-size:18px;color:#1A1B2E;-moz-appearance:textfield';
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });
inp.addEventListener('change', () => {
          const v = parseInt(inp.value, 10);
          if (!Number.isFinite(v) || v < 1 || v > 999) return;
          if (shell.relay) {
            /* SV 中继：本地校验（若所有空格都填且全部匹配 solution → 立即 relaySubmit） */
            const grid = new Array(solution.length).fill(0);
            for (const c of cells) if (c.num != null) grid[c.i] = c.num;
            grid[cell.i] = v;
            if (checkNumpyrComplete(grid, solution, levels)) {
              shell.relaySubmit();
              // 把所有剩余空格填满（提示已收卷）
              for (const c of cells) {
                if (c.num == null) { c.num = solution[c.i]; locked[c.i] = solution[c.i]; }
              }
              const board = shell.boardEl;
              if (board) render(board, shell);
            }
            return;
          }
          shell.sendAction({ type: 'np_place', i: cell.i, value: v });
        });
          inputs[cell.i] = inp;
          tile.appendChild(inp);
        }
        rowEl.appendChild(tile);
      }
      wrap.appendChild(rowEl);
    }
    const hint = document.createElement('p');
    hint.style.cssText = 'color:#6B7280;font-size:12px;margin:6px 0 0;text-align:center';
    hint.textContent = 'Each brick = sum of the two below · type a number and press Enter';
    wrap.appendChild(hint);
    boardEl.appendChild(wrap);
  };

  return {
    gameType: 'number-pyramid',
    label: opts.label,
    rounds: opts.rounds,
    timeLimit: opts.timeLimit,
    raceMax: opts.raceMax,
    makeDemoPuzzle(_round: number) {
      // DEMO：无服务端时用本地引擎拼一座塔（与生产协议同构）
      const total = (height * (height + 1)) / 2;
      const sol = new Array(total).fill(0);
      const baseStart = total - height;
      for (let i = 0; i < height; i++) sol[baseStart + i] = 1 + Math.floor(Math.random() * 9);
      let cum = 0;
      const idxAt = (level: number, col: number) => { let c = 0; for (let l = 0; l < level; l++) c += l + 1; return c + col; };
      for (let level = height - 2; level >= 0; level--) {
        const start = idxAt(level, 0); const below = idxAt(level + 1, 0);
        for (let col = 0; col <= level; col++) sol[start + col] = sol[below + col] + sol[below + col + 1];
      }
      void cum;
      const holes: number[] = [];
      for (let level = 1; level < height; level++) {
        for (let col = 0; col <= level; col++) if (Math.random() < 0.7) holes.push(idxAt(level, col));
      }
      const holeSet = new Set(holes);
      levels = height;
      locked = {};
      cells = sol.map((v, i) => ({ i, num: holeSet.has(i) ? null : v, owner: holeSet.has(i) ? 1 : 0 }));
      return { levels: height, cells };
    },
    /* SV 中继出题：复用前端真实引擎 generateTower(5) */
    makeRacePuzzle(_round: number) {
      const tower = generateTower(height, Math.random);
      solution = tower.solution.slice();
      levels = tower.levels;
      locked = {};
      const outCells = tower.puzzle.map((v, i) => ({ i, num: v > 0 ? v : null, owner: 0 }));
      return { levels: tower.levels, cells: outCells, _solution: solution };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      if (payload && payload.waiting) {
        boardEl.innerHTML = '<p style="color:#6B7280;text-align:center;padding:40px 0">Host is generating puzzle…</p>';
        return;
      }
      if (payload && Array.isArray(payload.cells)) {
        levels = payload.levels || height;
        locked = {};
        cells = payload.cells.map((c: any) => ({ i: Number(c.i), num: c.num == null ? null : Number(c.num), owner: (c.owner || 0) as 0 | 1 | 2 }));
      } else if (!payload || !Array.isArray(payload.cells)) {
        boardEl.innerHTML = '<p style="color:#6B7280;text-align:center;padding:40px 0">Waiting for the server to deal…</p>';
        return;
      }
      // SV 中继：solution 仅来自房主本地的 _solution 字段；非房主拿不到（payload 上报前被剥除）
      if (payload && Array.isArray(payload._solution)) {
        solution = payload._solution.slice();
      } else if (!shell.relay) {
        // DO 路径不缓存 solution
        solution = [];
      }
      render(boardEl, shell);
    },
    onMessage(msg: any, shell: MpShell): boolean {
      if (msg.type === 'np_new_game') return false; // 外壳 handleRoundMsg 兜底渲染
      if (msg.type === 'np_placed') {
        const i = Number(msg.i);
        const correct = !!msg.correct;
        const who = msg.player || '';
        if (correct) {
          const cell = cells.find(c => c.i === i);
          if (cell) {
            cell.num = Number(msg.value);
            locked[i] = Number(msg.value);
          }
          const inp = inputs[i];
          if (inp && who !== myName()) { /* 对手正确：把 input 换成显示值 */ }
          const tile = inp && inp.parentElement;
          if (tile) {
            tile.style.background = who === myName() ? '#EAF3DE' : '#FFFFFF';
            tile.style.border = '1px solid #16A34A';
            tile.textContent = String(msg.value);
            delete inputs[i];
          }
        } else if (who === myName()) {
          const inp = inputs[i];
          if (inp) {
            inp.value = '';
            inp.placeholder = '✗';
            inp.style.color = '#DC2626';
            window.setTimeout(() => { inp.placeholder = '?'; inp.style.color = '#1A1B2E'; }, 900);
          }
        }
        return true;
      }
      if (msg.type === 'np_round_over' || msg.type === 'np_timeout') {
        // 揭晓完整解：把所有空格按 solution 填充展示
        const sol: number[] = Array.isArray(msg.solution) ? msg.solution : [];
        if (sol.length) {
          for (const cell of cells) {
            if (cell.num == null && sol[cell.i]) { cell.num = sol[cell.i]; locked[cell.i] = sol[cell.i]; }
          }
          const board = shell.boardEl;
          if (board && board.childElementCount) render(board, shell);
        }
        return true;
      }
      return false;
    },
  };
}
