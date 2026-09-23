/**
 * 24 点 · 模式选择页（Lobby）
 * ------------------------------------------------------------
 * 只做「入口层」：
 *  · 模式卡是纯 `<a href>`，无 JS 也能用（也利于抓取与分享）；
 *  · JS 仅负责三件事 —— 今日全球榜真实数据、今日是否已完成、好友房房号校验与跳转。
 * 具体对局逻辑全部留在 /games/24-game/ 的 engine / competition / daily 里。
 */

import '@tri-sites/design-system/styles';
// 共享 papergames 视觉（sidebar / footer / ladder / 移动端 drawer / .btn 等）
import '../../styles/home-redesign.css';
import './lobby.css';
import { dailyKeyStr } from './engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const GAME_URL = '/games/24-game/';
const DAILY_TOTAL = 5; // 后端 derivePuzzles(dateKey, 5)，全球榜固定 5 题

/* ===================== 上海时区（与后端同一「今天」） ===================== */
const SH_OFFSET = 8 * 3600000;

function shanghaiDateKey(d = new Date()): string {
  const sh = new Date(d.getTime() + SH_OFFSET);
  return `${sh.getUTCFullYear()}${String(sh.getUTCMonth() + 1).padStart(2, '0')}${String(sh.getUTCDate()).padStart(2, '0')}`;
}

/** 距离上海时间次日 00:00 的剩余秒数 */
function secondsToShanghaiMidnight(now = Date.now()): number {
  const sh = now + SH_OFFSET;
  const nextMidnight = (Math.floor(sh / 86400000) + 1) * 86400000;
  return Math.max(0, Math.round((nextMidnight - sh) / 1000));
}

function startCountdown(): void {
  const el = $('boardCountdown');
  if (!el) return;
  const paint = () => {
    const s = secondsToShanghaiMidnight();
    const p = (n: number) => String(n).padStart(2, '0');
    el.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };
  paint();
  window.setInterval(paint, 1000);
}

/* ===================== 今日完成标记 ===================== */
function completedToday(): boolean {
  try {
    return JSON.parse(localStorage.getItem('twentyfour_daily') || '{}')[dailyKeyStr()] === true;
  } catch {
    return false;
  }
}

/** 本机今天跑完每日挑战的成绩（由对局页在结算时写入 twentyfour_daily_last） */
function localDailyResult(): { dateKey: string; solved: number; total: number; totalTime: number } | null {
  try {
    const o = JSON.parse(localStorage.getItem('twentyfour_daily_last') || 'null');
    if (!o || typeof o !== 'object') return null;
    if (o.dateKey !== shanghaiDateKey()) return null;
    return { dateKey: o.dateKey, solved: +o.solved || 0, total: +o.total || DAILY_TOTAL, totalTime: +o.totalTime || 0 };
  } catch {
    return null;
  }
}

function markDailyDone(): void {
  const tag = $('dailyTag');
  if (tag && completedToday()) tag.hidden = false;
}

/* ===================== 今日全球榜 ===================== */
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

function rowHtml(rankLabel: string, name: string, score: string, cls = ''): string {
  return (
    `<div class="arb-row ${cls}">` +
    `<span class="arb-rank">${esc(rankLabel)}</span>` +
    `<span class="arb-name">${esc(name)}</span>` +
    `<span class="arb-score num">${esc(score)}</span>` +
    '</div>'
  );
}

async function renderBoard(): Promise<void> {
  const host = $('boardRows');
  if (!host) return;
  const d = shanghaiDateKey();
  try {
    // 线上权威榜单：/api/daily24/leaderboard（无需 cookie，游客也能看 top）
    const res = await fetch(`/api/daily24/leaderboard?d=${d}`, { credentials: 'include' });
    if (!res.ok) throw new Error('leaderboard_unavailable');
    const data = await res.json();
    const entries: any[] = Array.isArray(data.top) ? data.top : [];

    const scoreOf = (times: unknown, total: unknown): string => {
      const solved = Array.isArray(times) ? times.filter((x) => x != null).length : 0;
      return `${solved}/${DAILY_TOTAL} \u00b7 ${Number(total ?? 0).toFixed(1)}s`;
    };

    let html = '';
    if (!entries.length) {
      html = '<div class="arb-empty">Nobody has finished today\u2019s challenge yet \u2014 take the first spot.</div>';
    } else {
      html = entries
        .slice(0, 3)
        .map((e, i) => rowHtml(String(e.rank ?? i + 1), e.nickname || 'Player', scoreOf(e.times, e.total), `r${i + 1}`))
        .join('');
    }

    const me = data.me;
    if (me && me.rank) {
      html += rowHtml('you', 'You', scoreOf(me.times, me.total), 'me');
    } else {
      const mine = localDailyResult();
      if (mine) html += rowHtml('you', 'You', `${mine.solved}/${mine.total} \u00b7 ${mine.totalTime.toFixed(1)}s`, 'me');
    }
    host.innerHTML = html;
  } catch {
    host.innerHTML = '<div class="arb-empty">\ud83c\udf10 The global board needs a live connection.</div>';
  }
}

/* ===================== 好友房 ===================== */
function initRoom(): void {
  const input = $<HTMLInputElement>('roomInput');
  const err = $('roomErr');
  const say = (m: string) => {
    if (err) err.textContent = m;
  };

  // 本页也能被 ?room=XXX 分享进来
  const fromUrl = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
  if (fromUrl && input) input.value = fromUrl;

  if (input) {
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      say('');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('joinRoom')?.click();
    });
  }

  $('joinRoom')?.addEventListener('click', () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      say('Enter the 4\u20136 character room code.');
      input?.focus();
      return;
    }
    location.href = `${GAME_URL}?mode=battle&room=${encodeURIComponent(code)}`;
  });
}

/* ===================== 启动 ===================== */
function boot(): void {
  markDailyDone();
  startCountdown();
  initRoom();
  void renderBoard();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
