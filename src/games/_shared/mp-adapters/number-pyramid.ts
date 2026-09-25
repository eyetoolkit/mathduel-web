/**
 * Number Pyramid 竞赛适配器（前端 fallback）
 * 后端 gameType 白名单暂不含 'number-pyramid'（见 worker/.../durable/game-room.js:255）；
 * 因此 prod 环境显示「后端未启用」提示；DEMO 与未来后端开通后可直接复用同一渲染。
 *
 * 协议设计（前后端对齐，等后端上线）：
 *   - 服务端 np_new_game{round,maxRounds,levels,owner,timeLimit,players}
 *     · owner[i]=0 砖块未揭 / 1 我方 / 2 对手
 *     · 砖值由双方通过 np_claim{i,value} 提交，由服务端判定对错：广播 np_placed{i,correct,player}
 *   - 终局 np_game_over{ranking,elo}
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';
import { generateTower } from '../../number-pyramid/engine';
import { isProdEnv } from '../mp-client';

export interface NumberPyramidAdapterOpts {
  label: string;
  height?: 4 | 5 | 6;
  rounds?: number;
  timeLimit?: number;
  raceMax?: number;
}

interface PyramidCell { i: number; num: number | null; owner: 0 | 1 | 2 }

const PROD_BLOCKED_HTML = `
<div style="max-width:420px;margin:24px auto;text-align:center;color:#1A1B2E">
  <div style="font-size:42px;margin-bottom:6px">⏳</div>
  <h3 style="margin:0 0 8px;font-size:18px">Server-side multiplayer coming soon</h3>
  <p style="color:#6B7280;font-size:13px;line-height:1.5;margin:0">
    The Number Pyramid competition server is being upgraded. Until then you can preview the
    competition UI in <b>demo mode</b> from a non-production host, or play solo / duel locally.
  </p>
  <p style="color:#9CA3AF;font-size:12px;margin-top:14px">🎮 Try other multiplayer games: <b>Sudoku · Bulls & Cows · Equation Pyramid</b> are live now.</p>
</div>`;

export function createNumberPyramidAdapter(opts: NumberPyramidAdapterOpts): MpAdapter {
  const height = opts.height || 5;
  let cells: PyramidCell[] = [];

  const buildCells = (ownerSeed?: number): PyramidCell[] => {
    const tower = generateTower(height, Math.random);
    const out: PyramidCell[] = [];
    for (let i = 0; i < tower.levels * tower.levels; i++) {
      const r = Math.floor(i / tower.levels);
      const c = i % tower.levels;
      const isBot = (typeof ownerSeed === 'number') && ((ownerSeed + r + c) % 2 === 0);
      const baseStart = (tower.levels * (tower.levels + 1)) / 2 - tower.levels;
      const num = r === tower.levels - 1 ? (tower.solution[baseStart + c] ?? null) : null;
      out.push({ i, num, owner: isBot ? 2 : 1 });
    }
    return out;
  };

  const render = (boardEl: HTMLElement, shell: MpShell) => {
    boardEl.innerHTML = '';
    if (isProdEnv()) {
      const w = document.createElement('div');
      w.innerHTML = PROD_BLOCKED_HTML;
      boardEl.appendChild(w);
      return;
    }
    // DEMO 渲染
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(' + height + ',48px);gap:4px';
    for (const cell of cells) {
      const tile = document.createElement('div');
      tile.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-weight:800;font-size:18px;' +
        (cell.num != null
          ? (cell.owner === 1 ? 'background:#FEF3C7;border:1px solid #F59E0B;color:#B45309' : 'background:#FFFFFF;border:1px solid #E5E7EB;color:#6B7280')
          : 'background:#F9FAFB;border:1px solid #E5E7EB;color:#9CA3AF');
      tile.textContent = cell.num != null ? String(cell.num) : '?';
      if (cell.num == null) {
        tile.style.cursor = 'pointer';
        tile.addEventListener('click', () => {
          // DEMO：点空格 → 由自己算（这里简单展示输入数字 1..9 循环）
          const cur = cell.num == null ? 0 : Number(cell.num);
          cell.num = cur >= 9 ? null : cur + 1;
          cell.owner = 1;
          render(boardEl, shell);
          if (cell.num != null) shell.markSolved();
        });
      }
      grid.appendChild(tile);
    }
    wrap.appendChild(grid);
    const hint = document.createElement('p');
    hint.style.cssText = 'color:#6B7280;font-size:12px;margin:6px 0 0;text-align:center';
    hint.textContent = 'Demo: tap a ? tile to claim it (1-9). Server-authoritative mode coming soon.';
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
      cells = buildCells();
      return { levels: height, cells };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      if (payload && payload.cells && Array.isArray(payload.cells)) {
        cells = payload.cells.map((c: any) => ({ i: Number(c.i), num: c.num == null ? null : Number(c.num), owner: (c.owner || 0) as 0 | 1 | 2 }));
      } else {
        cells = buildCells();
      }
      render(boardEl, shell);
    },
    onMessage(_msg: any, _shell: MpShell): boolean {
      // 后端未启用前不消费任何消息
      return false;
    },
  };
}