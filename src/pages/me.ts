/* ═══════════════════════════════════════════════════════════════
   NumeriDuel · My Journey（F3.2 免登录足迹页）
   ────────────────────────────────────────────────────────────────
   只和自己比：streak 日历、每日完成史、玩过的游戏与模式、徽章。
   数据 100% 来自 cross-game.ts 的 localStorage（mathduel_progress_v1），
   零网络请求、零账号 —— 这是隐私立场的具象化页面。
   ═══════════════════════════════════════════════════════════════ */
import './me.css';
import {
  getDailyStreak, getTodaysDones, getBadges, getGamesPlayedCount,
  getTotalDailyDoneCount, todayKey, ALL_GAMES,
  type GameId,
} from '../games/cross-game';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

interface History {
  dailyDone: Record<string, Partial<Record<GameId, true>>>;
  playedGames: Partial<Record<GameId, { firstSeen: string; modes: string[] }>>;
}

function loadHistory(): History {
  try {
    const raw = JSON.parse(localStorage.getItem('mathduel_progress_v1') || '{}');
    return {
      dailyDone: (raw && raw.dailyDone) || {},
      playedGames: (raw && raw.playedGames) || {},
    };
  } catch {
    return { dailyDone: {}, playedGames: {} };
  }
}

const GAME_NAMES: Record<GameId, string> = {
  '24-game': '24 Point',
  'sudoku-4x4': 'Sudoku 4×4',
  'sudoku': 'Sudoku 9×9',
  'sudoku-6x6': 'Sudoku 6×6',
  'equation-pyramid': 'Equation Pyramid',
};

const MODE_LABELS: Record<string, string> = {
  solo: 'Solo', daily: 'Daily', duel: 'Duel', timed: 'Timed',
  practice: 'Practice', competition: 'Competition',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

const hist = loadHistory();
let dones: GameId[] = [];
try { dones = getTodaysDones(); } catch { /* private mode */ }

/* ─── 顶部：streak + 总计 + 今日环 ─── */
$('streakN').textContent = String(getDailyStreak());
{
  const total = getTotalDailyDoneCount();
  const games = getGamesPlayedCount();
  $('totals').innerHTML =
    `<b>${total}</b> daily${total === 1 ? '' : 's'} finished · <b>${games}</b> game${games === 1 ? '' : 's'} explored · ` +
    `today <b>${dones.length}/${ALL_GAMES.length}</b>`;
  const pct = Math.round((dones.length / ALL_GAMES.length) * 100);
  $('ringTxt').textContent = `${dones.length}/${ALL_GAMES.length}`;
  $('ring').style.background = `conic-gradient(#F59E0B ${pct * 3.6}deg, #E3E6F0 0deg)`;
  $('ring').classList.toggle('full', dones.length === ALL_GAMES.length);
}

/* ─── 8 周日历热力格（过去的 56 天，与 GitHub 贡献格同语法）─── */
function renderCalendar(): void {
  const cal = $('cal');
  const cells: string[] = [];
  const now = new Date();
  // 从 55 天前走到今天（UTC+8 日期键，与 daily 种子一致）
  for (let i = 55; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000 + (now.getTimezoneOffset() + 480) * 60_000);
    const k = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const n = Object.keys(hist.dailyDone[k] || {}).length;
    const lvl = n >= 4 ? 'l3' : n >= 2 ? 'l2' : n >= 1 ? 'l1' : 'l0';
    const pretty = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
    cells.push(`<i class="${lvl}${k === todayKey() ? ' today' : ''}" title="${pretty} · ${n} daily${n === 1 ? '' : 's'}"></i>`);
  }
  cal.innerHTML = cells.join('');
}
renderCalendar();

/* ─── 游戏卡：模式足迹 + 今日完成态 ─── */
function renderGames(): void {
  const host = $('games');
  host.textContent = '';
  for (const g of ALL_GAMES) {
    const rec = hist.playedGames[g];
    const modes = rec && Array.isArray(rec.modes) ? rec.modes : [];
    const modeTags = modes.map((m) => `<span class="mj-mode">${esc(MODE_LABELS[m] || m)}</span>`).join('');
    const doneToday = dones.includes(g);
    const a = document.createElement('a');
    a.className = 'mj-game' + (rec ? '' : ' never');
    a.href = `/games/${g}/lobby/`;
    a.innerHTML = `
      <span class="mj-gname">${esc(GAME_NAMES[g] || g)}</span>
      <span class="mj-gmodes">${modeTags || '<span class="mj-never">not tried yet</span>'}</span>
      <span class="mj-gtoday">${doneToday ? '<b class="ok">✓ daily today</b>' : '&nbsp;'}</span>`;
    host.appendChild(a);
  }
}
renderGames();

/* ─── 徽章 ─── */
function renderBadges(): void {
  const host = $('badges');
  host.textContent = '';
  for (const b of getBadges()) {
    const el = document.createElement('div');
    el.className = 'mj-badge' + (b.unlocked ? '' : ' locked');
    el.innerHTML = `<span class="mj-be">${b.emoji}</span><span class="mj-bn">${esc(b.name)}</span><span class="mj-bh">${esc(b.hint)}</span>`;
    host.appendChild(el);
  }
}
renderBadges();
