/**
 * 数独家族竞赛适配器（sudoku / sudoku-6x6 / killer-sudoku）
 * 服务端协议：sudoku_new_game{puzzle,solution[,cages,size]} + sudoku_place{index,value}
 * 服务端逐格校验：sudoku_placed{correct,value,player} 回显；全员填满正确 → sudoku_game_over
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';

export interface SudokuAdapterOpts {
  gameType: string;        // 'sudoku' | 'sudoku-6x6' | 'killer-sudoku'
  label: string;
  size: 9 | 6;
  isKiller?: boolean;
  difficulty?: string;
  rounds?: number;
  timeLimit?: number;
}

const MAX_BY_SIZE: Record<number, number> = { 9: 9, 6: 6 };

export function createSudokuAdapter(opts: SudokuAdapterOpts): MpAdapter {
  let grid: number[] = [];
  let puzzle: number[] = [];
  let cells: HTMLElement[] = [];
  const myName = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mp_name') || '' : '');

  const render = (boardEl: HTMLElement, shell: MpShell, size: number, cages?: any) => {
    const max = MAX_BY_SIZE[size] || 9;
    const box = size === 6 ? 2 : 3;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(' + size + ',1fr);gap:2px;width:min(420px,86vw);background:#E5E7EB;padding:4px;border-radius:10px';
    cells = [];
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement('div');
      const r = Math.floor(i / size), c = i % size;
      const br = c % box === box - 1 && c !== size - 1;
      const bb = r % box === box - 1 && r !== size - 1;
      cell.style.cssText = 'aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:' + (size === 6 ? 22 : 18) + 'px;font-weight:700;border-radius:5px;' +
        (br ? 'border-right:2px solid #9CA3AF;' : '') + (bb ? 'border-bottom:2px solid #9CA3AF;' : '') +
        (puzzle[i] ? 'background:#F3F4F6;color:#9CA3AF;' : 'background:#F9FAFB;color:#B45309;cursor:pointer;');
      cell.dataset.i = String(i);
      if (puzzle[i]) cell.textContent = String(puzzle[i]);
      if (!puzzle[i]) {
        cell.addEventListener('click', () => {
          const cur = grid[i] || 0;
          const nv = ((cur + 1) % (max + 1));
          grid[i] = nv;
          cell.textContent = nv ? String(nv) : '';
          if (nv) shell.sendAction({ type: 'sudoku_place', index: i, value: nv });
          else shell.sendAction({ type: 'sudoku_place', index: i, value: 0 });
        });
      }
      if (opts.isKiller && cages && cages[r] && cages[r][c]) {
        cell.style.position = 'relative';
        const tag = document.createElement('span');
        tag.style.cssText = 'position:absolute;top:1px;left:3px;font-size:9px;color:#6B7280';
        tag.textContent = String(cages[r][c]);
        cell.appendChild(tag);
      }
      cells.push(cell);
      wrap.appendChild(cell);
    }
    boardEl.innerHTML = '';
    boardEl.appendChild(wrap);
    const hint = document.createElement('p');
    hint.style.cssText = 'color:#6B7280;font-size:12px;margin-top:10px;text-align:center';
    hint.textContent = 'Tap an empty cell to cycle 1–' + max + ' · first to fill the grid correctly wins';
    boardEl.appendChild(hint);
  };

  return {
    gameType: opts.gameType,
    label: opts.label,
    difficulty: opts.difficulty,
    rounds: opts.rounds,
    timeLimit: opts.timeLimit,
    makeDemoPuzzle() {
      // DEMO：生成一个简单的可解数独骨架（本地预览用，非真实引擎）
      const n = opts.size * opts.size;
      const p: number[] = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) if (Math.random() < 0.45) p[i] = (i % opts.size) + 1;
      return { puzzle: p, solution: p.slice() };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      puzzle = (payload.puzzle && payload.puzzle.flat) ? payload.puzzle.flat() : (Array.isArray(payload.puzzle) ? payload.puzzle : new Array(opts.size * opts.size).fill(0));
      grid = puzzle.slice();
      const cages = payload.cages || (payload.solution && payload.solution.cages);
      render(boardEl, shell, opts.size, cages);
    },
    onMessage(msg: any, _shell: MpShell): boolean {
      if (msg.type === 'sudoku_new_game') {
        // 由外壳 handleRoundMsg 兜底渲染；这里返回 false 让外壳处理
        return false;
      }
      if (msg.type === 'sudoku_placed') {
        const i = msg.index ?? (msg.row != null && msg.col != null ? msg.row * opts.size + msg.col : -1);
        if (i >= 0 && cells[i]) {
          const v = msg.value || 0;
          if (msg.player && msg.player !== myName()) {
            cells[i].textContent = v ? String(v) : '';
            cells[i].style.color = '#16A34A';
            grid[i] = v;
          }
        }
        return true;
      }
      return false;
    },
  };
}
