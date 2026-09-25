/**
 * 数独家族竞赛适配器（sudoku / sudoku-6x6 / killer-sudoku）
 *
 * 双协议：
 * - CF DO：服务端推 sudoku_new_game{puzzle,solution[,cages,size]}，客户端逐格 sendAction('sudoku_place',...)，DO 校验
 * - SV 中继：服务端推 puzzle{puzzle[,cages]}，客户端本地解出 → shell.relaySubmit()，SV 仅计时
 *
 * 数独走 SV 时必须本地校验「无冲突」（即每行/列/宫格不重复 + 已填格=solution）；不能像 np 那样逐格上报
 * （SV 限流 20/60s，逐格上报必触发）。gameType 走 `equation-pyramid` 同名 gameType 直转。
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';
import { generatePuzzle as genSudoku9 } from '../../sudoku/engine';
import { generatePuzzle as genSudoku6 } from '../../sudoku-6x6/engine';
import { generateKiller } from '../../killer-sudoku/engine';

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
  let solution: number[] = [];      // SV 中继用：完整解（前端本地校验玩家输入 vs solution）
  let cells: HTMLElement[] = [];
  const myName = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mp_name') || '' : '');

  const render = (boardEl: HTMLElement, shell: MpShell, size: number, cages?: any) => {
    const max = MAX_BY_SIZE[size] || 9;
    const box = size === 6 ? 2 : 3;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(' + size + ',1fr);gap:2px;width:min(420px,86vw);background:#E5E7EB;padding:4px;border-radius:10px';
    cells = [];
    const checkWin = () => {
      /* relay 模式：所有空格已填 + 全部匹配 solution（不依赖题面冲突检测，因 solution 唯一）
         比 sudoku 引擎的冲突检查更严格；solution 是房主出题时本地引擎生成、自带唯一解 */
      if (!shell.relay) return;
      if (grid.length !== solution.length) return;
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i] || grid[i] !== solution[i]) return;
      }
      shell.relaySubmit();
    };
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
          if (!shell.relay) {
            // DO 路径
            if (nv) shell.sendAction({ type: 'sudoku_place', index: i, value: nv });
            else shell.sendAction({ type: 'sudoku_place', index: i, value: 0 });
          } else {
            // SV 中继路径：不发逐格，只本地判定胜负
            checkWin();
          }
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
    hint.textContent = shell.relay ? 'Tap an empty cell to cycle 1–' + max + ' · first to complete correctly wins' : 'Tap an empty cell to cycle 1–' + max + ' · first to fill the grid correctly wins';
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
    /* SV 中继出题：复用前端真实引擎，**把 solution 注入 payload._solution** 供 renderRound
       解锁本地校验（但 set_puzzle 上报时仅发 puzzle + cages，**不**带 solution 字段） */
    makeRacePuzzle(_round: number) {
      const rng = Math.random;
      let pz: any;
      if (opts.isKiller) {
        pz = generateKiller(opts.difficulty as any || 'standard', rng);
      } else if (opts.size === 6) {
        pz = genSudoku6(opts.difficulty as any || 'standard', rng);
      } else {
        pz = genSudoku9(opts.difficulty as any || 'standard', rng);
      }
      const puzzle: number[] = pz.puzzle.slice();
      const cages = (opts.isKiller && pz.cages) || null;
      /* 房主侧先把 _solution 写入自身内存；set_puzzle 上报时仅携带 puzzle + cages，
         房主的"自己渲染"也会走 renderRound → 填入 solution。SV 服务端 payload 经 JSON.parse(JSON.stringify)
         后 _solution 也会保留在内存中（set_puzzle 处使用 deep clone）；OK，因为房主本地就持有，不算泄密 */
      return { puzzle, _solution: pz.solution.slice(), cages, size: opts.size, isKiller: !!opts.isKiller };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      if (payload && payload.waiting) {
        boardEl.innerHTML = '<p style="color:#6B7280;text-align:center;padding:40px 0">Host is generating puzzle…</p>';
        return;
      }
      puzzle = (payload.puzzle && payload.puzzle.flat) ? payload.puzzle.flat() : (Array.isArray(payload.puzzle) ? payload.puzzle : new Array(opts.size * opts.size).fill(0));
      // SV 中继模式没有自带 solution，需由房主记下（payload._solution 是 makeRacePuzzle 注入的；不显式发给服务端）
      if (payload && Array.isArray(payload._solution)) {
        solution = payload._solution.slice();
      } else if (payload && payload.solution && Array.isArray(payload.solution.puzzle) === false && Array.isArray(payload.solution)) {
        solution = payload.solution.slice();
      } else {
        solution = [];
      }
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
