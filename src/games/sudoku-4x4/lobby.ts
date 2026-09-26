/**
 * 4×4 数独 · 模式选择页（Lobby）· 小朋友入门款
 * ------------------------------------------------------------
 * 与 9×9 / 24 点的 lobby 同构（同一套 arb-* 骨架与 --a-* 皮肤）：
 *  · 模式卡是纯 `<a href>`，无 JS 也能用（可分享、可中键新开、利于抓取）；
 *  · JS 只负责三件事 —— hero 迷你网格、本机最佳成绩、难度行写 href。
 * 对局逻辑全部在 /games/sudoku-4x4/ 的 engine / index 里（无 daily/联机，无 ladder）。
 */

// 设计系统必须先引入：--font-display / --font-sans 等 token 由它定义
import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how
import '../24-game/lobby.css';            // .home-v2 下的模式卡 / panel / arb-row 榜行样式
import '../sudoku/lobby.css';             // 数独专属组件：hero 迷你网格 / 规则列表 / 难度行
import './lobby.css';                     // 4×4 专属：hero 2×2 大格
import { wireLobbyChrome } from '../../pages/lobby-chrome';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_BEST = 's4_best_v1';

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
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/* ===================== Hero 迷你网格 ===================== */
/** 2×2 示例：1–4 各一次（宫约束的直观暗示） */
function renderHeroGrid(): void {
  const el = $('heroGrid');
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4]
    .map((n, i) => `<span class="arb-cell${i === 3 ? ' hl' : ''}">${n}</span>`)
    .join('');
}

/* ===================== 榜（本机最佳成绩） ===================== */
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
  const host = $('bestRows');
  if (!host) return;

  const best = readJSON<Record<string, number>>(LS_BEST, {});
  const diffs = ['easy', 'standard', 'hard'].filter((d) => best[d] != null);

  if (!diffs.length) {
    host.innerHTML = '<div class="arb-empty">Solve your first grid to set a record.</div>';
    return;
  }

  let html = '';
  diffs.forEach((d, i) => {
    const label = d[0].toUpperCase() + d.slice(1);
    html += rowHtml(String(i + 1), label, fmt(best[d] as number), i === 0 ? 'me' : '');
  });
  html += `<div class="arb-note board-note">Local runs only — saved on this device.</div>`;

  host.innerHTML = html;
}

/* ===================== 难度行 ===================== */
const LS_DIFF = 's4_diff_v1';
const DIFFS = ['easy', 'standard', 'hard'] as const;
type Diff = (typeof DIFFS)[number];

const isDiff = (x: string): x is Diff => (DIFFS as readonly string[]).includes(x);

function currentDiff(): Diff {
  try {
    const v = localStorage.getItem(LS_DIFF) ?? '';
    return isDiff(v) ? v : 'easy'; // 小朋友默认 Easy
  } catch {
    return 'easy';
  }
}

/**
 * 难度行的唯一职责：把选择**写进模式卡的 href**。
 * 模式卡仍是纯 `<a href>`（无 JS 也能点、可中键新开、可爬取）。
 */
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
      /* 隐私模式下写不进就只在本轮生效 */
    }
    document.querySelectorAll<HTMLAnchorElement>('a.arb-mode[data-mode]').forEach((a) => {
      const m = a.dataset.mode;
      if (!m) return;
      a.href = `/games/sudoku-4x4/?mode=${m}&d=${d}`;
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

/* ===================== 启动 ===================== */
function boot(): void {
  wireLobbyChrome();
  renderHeroGrid();
  renderBoard();
  wireDifficulty();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
