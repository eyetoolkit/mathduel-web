/**
 * 数字金字塔 · Lobby 模式选择页
 * 与 24 点 / 6×6 / 9×9 / killer 同构（arb-* 骨架 + --a-* 皮肤）。
 * JS 只管三件事：hero 装饰（虚拟塔）、每日倒计时、本机成绩 + 高度行接线。
 */

import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how / ladder
import '../24-game/lobby.css';
import './lobby.css';
import { wireLobbyChrome } from '../../pages/lobby-chrome';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_DAILY = 'np_daily_v1';
const LS_BEST = 'np_best_v1';
const LS_H = 'np_height_v1';

const SH_OFFSET = 8 * 3600000;
function secondsToShanghaiMidnight(now = Date.now()): number {
  const sh = now + SH_OFFSET;
  const nextMidnight = (Math.floor(sh / 86400000) + 1) * 86400000;
  return Math.max(0, Math.round((nextMidnight - sh) / 1000));
}

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
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/* ===================== Hero：装饰性小塔 =====================
   用 SVG 画一个 5-level 三角塔，每层给一个示例数，传递"金字塔 sum"主题。 */
function renderHeroPyr(): void {
  const el = $('heroPyr');
  if (!el) return;
  // 位置/尺寸全部用百分比（相对容器），任何视口下金字塔都等比缩放。
  // 旧版把 100×100 的坐标当 px 用，brick 全部坍缩在容器左上角 100×100 内。
  const ROW_H = 100 / 6.5;  // 纵向 100 等分
  const CELL_W = 100 / 5.5; // 横向 100 等分
  const levels = 5;
  const labels = ['120', '64', '56', '34', '30', '26', '14', '12', '', '', '', '', '', '', ''];
  // 给顶 9 格标数字（given，paper 视觉），其余空
  const givenSet = new Set([0, 1, 2, 3, 4, 5, 7, 8]);

  let bricks = '';
  let cum = 0;
  for (let level = 0; level < levels; level++) {
    const row = levels - level;
    const w = row * CELL_W;
    const startX = (100 - w) / 2 + CELL_W / 2;
    for (let col = 0; col < row; col++) {
      const cx = startX + col * CELL_W;
      const cy = ROW_H * (level + 0.5);
      const w2 = CELL_W * 0.85;
      const h2 = ROW_H * 0.72;
      const x = cx - w2 / 2;
      const y = cy - h2 / 2;
      const isGiven = givenSet.has(cum);
      const val = labels[cum];
      const cls = isGiven ? 'brick given' : 'brick';
      const r1 = (n: number) => Math.round(n * 100) / 100;
      bricks += `<div class="${cls}" style="left:${r1(x)}%;top:${r1(y)}%;width:${r1(w2)}%;height:${r1(h2)}%;">${val}</div>`;
      cum++;
    }
  }
  el.innerHTML = bricks;
}

/* ===================== 倒计时 ===================== */
function startCountdown(): void {
  const el = $('boardCountdown');
  if (!el) return;
  const paint = (): void => {
    const s = secondsToShanghaiMidnight();
    const p = (n: number) => String(n).padStart(2, '0');
    el.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };
  paint();
  window.setInterval(paint, 1000);
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

  const past = Object.keys(done).filter((k) => k !== dk).sort().reverse().slice(0, 2);
  past.forEach((k) => {
    html += rowHtml(`${k.slice(4, 6)}/${k.slice(6)}`, 'Daily tower', fmt(done[k] as number));
  });

  const bestLine = ['4', '5', '6']
    .filter((d) => best[d] != null)
    .map((d) => `${({ 4: 'Swift', 5: 'Standard', 6: 'Deep' } as Record<string, string>)[d]} ${fmt(best[d] as number)}`)
    .join(' · ');
  html += `<div class="arb-note board-note">${
    bestLine ? `Solo bests · ${esc(bestLine)}<br />` : ''
  }Local runs only — the global board lands with the live API.</div>`;

  host.innerHTML = html;
}

/* ===================== 高度行 ===================== */
const HEIGHTS = ['4', '5', '6'] as const;
type H = (typeof HEIGHTS)[number];
const isH = (x: string): x is H => (HEIGHTS as readonly string[]).includes(x);

function currentH(): H {
  try {
    const v = localStorage.getItem(LS_H) ?? '';
    return isH(v) ? v : '5';
  } catch {
    return '5';
  }
}

function wireDifficulty(): void {
  const host = $('lobbyDiff');
  if (!host) return;
  const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('.arb-dbtn'));

  const apply = (h: H): void => {
    btns.forEach((b) => {
      const on = b.dataset.h === h;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    try {
      localStorage.setItem(LS_H, h);
    } catch {
      /* ignore */
    }
    document.querySelectorAll<HTMLAnchorElement>('a.arb-mode[data-mode]').forEach((a) => {
      const m = a.dataset.mode;
      if (!m || m === 'daily') return;
      a.href = `/games/number-pyramid/?mode=${m}&h=${h}`;
    });
  };

  btns.forEach((b) =>
    b.addEventListener('click', () => {
      const h = b.dataset.h;
      if (h && isH(h)) apply(h);
    }),
  );

  apply(currentH());
}

function boot(): void {
  wireLobbyChrome();
  wireLobbyChrome();
  renderHeroPyr();
  markDailyDone();
  startCountdown();
  renderBoard();
  wireDifficulty();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();