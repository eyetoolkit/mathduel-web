/**
 * match-topstats.ts · 跨棋类共享：顶栏 Solved / 🔥 Streak 双 chip 渲染
 * ------------------------------------------------------------------
 * 从 24-game 顶栏 .top-stats 沉淀出来的范式抽象。
 * 4 款非 24-game 游戏当前只显示 "Ready" + "🏠 Lobby"，缺得分/连胜反馈。
 *
 * 用法：
 *   import { renderTopStats } from '../_shared/match-topstats';
 *
 *   // HTML 已有的容器：<div class="top-stats">
 *   //   <span class="chip"><b id="stSolved">0</b> Solved</span>
 *   //   <span class="chip">🔥 Streak <b id="stCombo">0</b></span>
 *   // </div>
 *
 *   // 每完成一题 / streak 变化时调用
 *   renderTopStats({ solved: state.solved, streak: state.streak });
 *
 *   // localStorage 持久化（key 与游戏一一对应，跨页记住）
 *   //   localStorage.getItem('mg-streak-sudoku') = 当前连胜
 */

export interface TopStats {
  solved: number;
  streak: number;
}

interface TopStatsEls {
  solved: HTMLElement | null;
  streak: HTMLElement | null;
}

let cachedEls: TopStatsEls | null = null;
let cachedBaseId = '';

function getEls(baseId: string): TopStatsEls {
  if (cachedEls && cachedBaseId === baseId) return cachedEls;
  cachedBaseId = baseId;
  cachedEls = {
    solved: document.getElementById(baseId + 'Solved'),
    streak: document.getElementById(baseId + 'Combo'),
  };
  return cachedEls;
}

/**
 * 渲染 Solved / Streak chip。safeSolved / safeStreak 防止负数。
 * 元素不存在（HTML 未加 chip）则静默跳过，不抛错。
 */
export function renderTopStats(stats: TopStats, baseId = 'st'): void {
  const els = getEls(baseId);
  if (els.solved) els.solved.textContent = String(Math.max(0, stats.solved | 0));
  if (els.streak) els.streak.textContent = String(Math.max(0, stats.streak | 0));
}

/** localStorage 读写 helper（key: mg-streak-<gameId>） */
export function loadStreak(gameId: string): number {
  try {
    const v = parseInt(localStorage.getItem('mg-streak-' + gameId) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) {
    return 0;
  }
}

export function saveStreak(gameId: string, streak: number): void {
  try { localStorage.setItem('mg-streak-' + gameId, String(Math.max(0, streak | 0))); } catch (e) { /* noop */ }
}

/** Streak 累加：上一题答对则 +1，否则重置 0 */
export function bumpStreak(prev: number, ok: boolean): number {
  return ok ? prev + 1 : 0;
}
