/**
 * MathDuel 首页入口（Homepage Redesign, 2026-09-23）
 * 装配：竞技墙 + 游戏网格（JS 渲染，beta 可见性由 VITE_SHOW_BETA 控制）。
 */
import '@tri-sites/design-system/styles';
import './styles/home-redesign.css';
import { renderGameGrid, renderArenaWall } from './pages/home';

// Hero 右侧「竞技墙」
renderArenaWall(document.getElementById('arenaWall'));

// 游戏网格（含 Sum Tower SOON 卡片）
renderGameGrid(document.getElementById('gameGrid'));

// 年份
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// 每日挑战倒计时：到下一个 UTC 零点
function nextDailyReset(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(0, next.getTime() - now.getTime());
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
function tickDaily() {
  const txt = fmt(nextDailyReset());
  const t1 = document.getElementById('dailyTimer');
  if (t1) t1.textContent = txt;
  const t2 = document.getElementById('dailyCountdown');
  if (t2) t2.textContent = `Same puzzle worldwide · resets in ${txt}`;
}
tickDaily();
setInterval(tickDaily, 1000);
