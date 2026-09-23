/**
 * 6×6 数独 · 模式选择页（Lobby）
 * ------------------------------------------------------------
 * 与 24 点的 /games/24-game/lobby/ 同构（同一套 arb-* 骨架与 --a-* 皮肤）：
 *  · 模式卡是纯 `<a href>`，无 JS 也能用（可分享、可中键新开、利于抓取）；
 *  · JS 只负责三件事 —— hero 迷你网格、每日倒计时、本地成绩与「今日已完成」标记。
 * 对局逻辑全部在 /games/sudoku-6x6/ 的 engine / index 里。
 *
 * 注意：beta 站无 Worker 路由（B-010），拿不到全球榜，
 * 所以本页榜单渲染的是**本机成绩**，并明确标注，不伪装成全球数据。
 */

// 设计系统必须先引入：--font-display / --font-sans 等 token 由它定义，
// arena.css 的 --a-disp 只是引用 var(--font-display)。缺了这行标题会掉回 Times New Roman。
import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how / ladder
import '../24-game/lobby.css';
import './lobby.css';
import { wireLobbyChrome } from '../../pages/lobby-chrome';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_DAILY = 's6_daily_v1';
const LS_BEST = 's6_best_v1';

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
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/* ===================== Hero 迷你网格 ===================== */
/** 6 格示例：1–6 各一次（行约束的直观暗示） */
function renderHeroGrid(): void {
  const el = $('heroGrid');
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5, 6]
    .map((n, i) => `<span class="arb-cell${i === 4 ? ' hl' : ''}">${n}</span>`)
    .join('');
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

  const past = Object.keys(done)
    .filter((k) => k !== dk)
    .sort()
    .reverse()
    .slice(0, 2);
  past.forEach((k) => {
    html += rowHtml(`${k.slice(4, 6)}/${k.slice(6)}`, 'Daily grid', fmt(done[k] as number));
  });

  const bestLine = ['easy', 'standard', 'hard']
    .filter((d) => best[d] != null)
    .map((d) => `${d[0].toUpperCase()} ${fmt(best[d] as number)}`)
    .join(' · ');
  html += `<div class="arb-note board-note">${
    bestLine ? `Solo bests · ${esc(bestLine)}<br />` : ''
  }Local runs only — the global board lands with the live API.</div>`;

  host.innerHTML = html;
}

/* ===================== 启动 ===================== */
function boot(): void {
  wireLobbyChrome();
  wireLobbyChrome();
  renderHeroGrid();
  markDailyDone();
  startCountdown();
  renderBoard();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
