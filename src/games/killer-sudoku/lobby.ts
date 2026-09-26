/**
 * 杀手数独 · 模式选择页（Lobby）
 * 与 24 点 / 6×6 / 9×9 lobby 同构（arb-* 骨架 + --a-* 皮肤）。
 * JS 只管三件事：hero 装饰（虚拟 cages）、每日倒计时、本地成绩与难度行接线。
 */

import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how / ladder
import '../24-game/lobby.css';
import './lobby.css';
import { wireLobbyChrome } from '../../pages/lobby-chrome';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_DAILY = 'ks_daily_v1';
const LS_BEST = 'ks_best_v1';
const LS_DIFF = 'ks_diff_v1';

const readJSON = <T>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const fmt = (sec: number): string => `${sec.toFixed(1)}s`;
const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' })[c] as string,
  );

/* ===================== Hero：装饰性笼子（虚拟 SVG） =====================
   设计稿方向是 cage，不是 9×9 的 1–9 一行。
   这里画一个小型 3×3 cage grid 的缩略图——虚线围出两三个笼子，标 sum。 */
function renderHeroCages(): void {
  const el = $('heroCages');
  if (!el) return;
  // viewBox 用 9×9 grid 单位；sum 在角格上
  const cages = [
    { cells: [[0,0],[0,1],[1,0],[1,1]], sum: 17 }, // 左上 2×2
    { cells: [[0,2],[1,2],[2,2],[3,2]], sum: 22 }, // 上方长蛇
    { cells: [[2,0],[2,1],[3,0],[3,1]], sum: 19 }, // 左下 2×2
    { cells: [[4,4],[5,4],[5,5],[5,6]], sum: 23 }, // 中部 L
  ];
  const paths = cages
    .map((c) => {
      const cellSet = new Set(c.cells.map(([r, cc]) => r * 9 + cc));
      const segs: string[] = [];
      for (const [r, cc] of c.cells) {
        if (!cellSet.has((r - 1) * 9 + cc)) segs.push(`M${cc} ${r} L${cc + 1} ${r}`);
        if (!cellSet.has(r * 9 + cc - 1)) segs.push(`M${cc} ${r} L${cc} ${r + 1}`);
        if (!cellSet.has((r + 1) * 9 + cc)) segs.push(`M${cc} ${r + 1} L${cc + 1} ${r + 1}`);
        if (!cellSet.has(r * 9 + cc + 1)) segs.push(`M${cc + 1} ${r} L${cc + 1} ${r + 1}`);
      }
      const [cr, cc] = c.cells[0];
      const sx = (cc / 9) * 100;
      const sy = (cr / 9) * 100;
      return `<svg viewBox="0 0 9 9" preserveAspectRatio="none" class="arb-cage-deco-svg">
        <path class="cage-l" d="${segs.join(' ')}"/>
      </svg>
      <span class="arb-cage-deco-sum" style="left:${sx}%;top:${sy}%">${c.sum}</span>`;
    })
    .join('');
  el.innerHTML = paths;
}

/* ===================== 今日完成标记 ===================== */
function markDailyDone(): void {
  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const tag = $('dailyTag');
  if (tag && typeof done[shanghaiDateKey()] === 'number') tag.hidden = false;
}

/* ===================== 榜（本机成绩） ===================== */
function rowHtml(rankLabel: string, name: string, score: string, cls = ''): string {
  return (
    `<div class="arb-row ${cls}">` +
    `<span class="arb-rank">${esc(rankLabel)}</span>` +
    `<span class="arb-name">${esc(name)}</span>` +
    `<span class="arb-score num">${esc(score)}</span>` +
    '</div>'
  );
}

function renderBoard(): void {
  const host = $('boardRows');
  if (!host) return;

  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const best = readJSON<Record<string, number>>(LS_BEST, {});
  const dk = shanghaiDateKey();
  const today = done[dk];

  let html = '';
  if (today != null) {
    html += rowHtml('✓', 'Today · you', fmt(today), 'me');
  } else {
    html += rowHtml('–', 'Today', 'unsolved');
  }

  const past = Object.keys(done)
    .filter((k) => k !== dk)
    .sort()
    .reverse()
    .slice(0, 2);
  past.forEach((k) => {
    html += rowHtml(`${k.slice(4, 6)}/${k.slice(6)}`, 'Daily cage', fmt(done[k] as number));
  });

  const bestLine = ['gentle', 'standard', 'fierce']
    .filter((d) => best[d] != null)
    .map((d) => `${d[0].toUpperCase()}${d.slice(1)} ${fmt(best[d] as number)}`)
    .join(' · ');
  html += `<div class="arb-note board-note">${
    bestLine ? `Solo bests · ${esc(bestLine)}<br />` : ''
  }Local runs only — the global board lands with the live API.</div>`;

  host.innerHTML = html;
}

/* ===================== 难度行 ===================== */
const DIFFS = ['gentle', 'standard', 'fierce'] as const;
type Diff = (typeof DIFFS)[number];
const isDiff = (x: string): x is Diff => (DIFFS as readonly string[]).includes(x);

function currentDiff(): Diff {
  try {
    const v = localStorage.getItem(LS_DIFF) ?? '';
    return isDiff(v) ? v : 'standard';
  } catch {
    return 'standard';
  }
}

function wireDifficulty(): void {
  const host = $('lobbyDiff');
  if (!host) return;
  const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('.arb-dbtn'));

  const apply = (d: Diff): void => {
    btns.forEach((b) => {
      const on = b.dataset.d === d;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    try {
      localStorage.setItem(LS_DIFF, d);
    } catch {
      /* ignore */
    }
    // daily 是固定种子题（Standard 29 cages），对局页会隐藏难度选择器 → 不追加 ?d=
    document.querySelectorAll<HTMLAnchorElement>('a.arb-mode[data-mode]').forEach((a) => {
      const m = a.dataset.mode;
      if (!m || m === 'daily') return;
      a.href = `/games/killer-sudoku/?mode=${m}&d=${d}`;
    });
  };

  btns.forEach((b) =>
    b.addEventListener('click', () => {
      const d = b.dataset.d;
      if (d && isDiff(d)) apply(d);
    }),
  );

  apply(currentDiff());
}

function boot(): void {
  wireLobbyChrome();
  renderHeroCages();
  markDailyDone();
  renderBoard();
  wireDifficulty();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
