/**
 * 4×4 数独 · 模式选择页（Lobby）· 小朋友入门款
 * ------------------------------------------------------------
 * 与 9×9 / 24 点的 lobby 同构（同一套 arb-* 骨架与 --a-* 皮肤）：
 *  · 模式卡是纯 `<a href>`，无 JS 也能用（可分享、可中键新开、利于抓取）；
 *  · JS 只负责两件事 —— hero 迷你网格、本机最佳成绩。
 * 模式：Solo / Daily / Timed / Friend Battle / Random（后两者走竞赛外壳）。
 */

// 设计系统必须先引入：--font-display / --font-sans 等 token 由它定义
import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how
import '../24-game/lobby.css';            // .home-v2 下的模式卡 / panel / arb-row 榜行样式
import '../sudoku/lobby.css';             // 数独专属组件：hero 迷你网格 / 规则列表 / 难度行
import './lobby.css';                     // 4×4 专属：hero 2×2 大格
import { wireLobbyChrome } from '../../pages/lobby-chrome';
import { i18nT, onI18nReady } from '../_shared/i18n-t';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_BEST = 's4_best_v1';
const LS_DAILY = 's4_daily_v1';

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

const BEST_MODES = [
  { key: 'solo', label: 'mg.shared_tab_solo' },
  { key: 'daily', label: 'mg.shared_tab_daily' },
];

function renderBoard(): void {
  const host = $('bestRows');
  if (!host) return;

  const best = readJSON<Record<string, number>>(LS_BEST, {});
  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const dk = shanghaiDateKey();
  const rows = BEST_MODES.filter((m) => best[m.key] != null);

  if (!rows.length && done[dk] == null) {
    host.innerHTML = `<div class="arb-empty">${esc(i18nT('ml.s4_panel1_empty'))}</div>`;
    return;
  }

  let html = '';
  // 今日 daily 已完成 → 置顶打勾行（与 6×6/9×9 lobby 同款）
  if (done[dk] != null) {
    html += rowHtml('✓', i18nT('mg.lb_row_today_you'), fmt(done[dk] as number), 'me');
  }
  rows.forEach((m, i) => {
    html += rowHtml(String(i + 1), i18nT(m.label), fmt(best[m.key] as number), done[dk] == null && i === 0 ? 'me' : '');
  });
  html += `<div class="arb-note board-note">${esc(i18nT('mg.lb_local_device'))}</div>`;

  host.innerHTML = html;
}

/* ===================== 启动 ===================== */
function boot(): void {
  wireLobbyChrome();
  renderHeroGrid();
  // 🔴 榜单里的文案走 i18nT()，必须等字典 ready，否则会渲染出原始 key
  onI18nReady(renderBoard);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
