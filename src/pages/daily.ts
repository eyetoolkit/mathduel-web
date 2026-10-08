/* ═══════════════════════════════════════════════════════════════
   NumeriDuel Daily Challenge Hub
   ────────────────────────────────────────────────────────────────
   - 5 款游戏每日挑战卡（深链 ?mode=daily，与各游戏深链契约一致）
   - streak / 今日完成度：cross-game.ts localStorage（免登录、纯本地）
   - 榜单：Elo ladder（scope=all）+ 各游戏今日完赛榜（/api/daily/:game/rank）
     —— 全部来自已有端点，零后端改动
   ═══════════════════════════════════════════════════════════════ */
import './daily.css';
import {
  getDailyStreak, getTodaysDones, todayKey,
  type GameId,
} from '../games/cross-game';

interface DailyCardDef {
  id: GameId;
  name: string;
  blurb: string;
  href: string;
  icon: string;   // 内联 SVG
  hue: string;    // 卡片强调色
}

const CARDS: DailyCardDef[] = [
  {
    id: '24-game', name: '24 Point', blurb: 'Make 24 from four numbers — 6 puzzles today.',
    href: '/games/24-game/?mode=daily', hue: '#3730A3',
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  },
  {
    id: 'sudoku-4x4', name: 'Sudoku 4×4', blurb: 'The friendly starter grid — one seeded puzzle.',
    href: '/games/sudoku-4x4/?mode=daily', hue: '#0E9F6E',
    icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M11.5 4v16M4 11.5h16" stroke-width="2"/></svg>',
  },
  {
    id: 'sudoku', name: 'Sudoku 9×9', blurb: 'The classic — today’s seeded medium grid.',
    href: '/games/sudoku/?mode=daily', hue: '#3730A3',
    icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke-width="2"/><path d="M9.3 4v16M14.6 4v16M4 9.3h16M4 14.6h16"/></svg>',
  },
  {
    id: 'sudoku-6x6', name: 'Sudoku 6×6', blurb: 'The next step up — one seeded puzzle.',
    href: '/games/sudoku-6x6/?mode=daily', hue: '#B45309',
    icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke-width="2"/><path d="M12 4v16M4 12h16"/></svg>',
  },
  {
    id: 'equation-pyramid', name: 'Equation Pyramid', blurb: 'Tap three cells that hit the target.',
    href: '/games/equation-pyramid/?mode=daily', hue: '#DC2626',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z" fill="none" stroke-width="2" stroke-linejoin="round"/><path d="M12 4v16M7.5 12h9" stroke-width="1.6"/></svg>',
  },
];

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/* ─── streak + 日期 + 完成度 ─── */
let dones: GameId[] = [];
try {
  dones = getTodaysDones();
  $('streakN').textContent = String(getDailyStreak());
} catch { /* private mode */ }

{
  const k = todayKey();
  const pretty = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
  $('dateLine').textContent = `${pretty} · Shanghai day`;
}

function renderRing(): void {
  const n = dones.length;
  const pct = Math.round((n / CARDS.length) * 100);
  $('ringTxt').textContent = `${n}/${CARDS.length}`;
  const ring = $('ring');
  ring.style.background =
    `conic-gradient(#F59E0B ${pct * 3.6}deg, #E3E6F0 0deg)`;
  ring.classList.toggle('full', n === CARDS.length);
}

/* ─── 卡片 ─── */
function renderCards(): void {
  const host = $('cards');
  host.textContent = '';
  for (const c of CARDS) {
    const done = dones.includes(c.id);
    const a = document.createElement('a');
    a.className = 'dcard' + (done ? ' done' : '');
    a.href = c.href;
    a.style.setProperty('--hue', c.hue);
    a.innerHTML = `
      <span class="dcard-ic">${c.icon}</span>
      <span class="dcard-body">
        <span class="dcard-name">${c.name}</span>
        <span class="dcard-blurb">${c.blurb}</span>
      </span>
      <span class="dcard-cta">${done ? '<b class="ok">✓ Done today</b>' : 'Play now →'}</span>`;
    host.appendChild(a);
  }
  renderRing();
}
renderCards();

/* ─── 榜单 ─── */
interface EloEntry { nickname: string; game: string; elo: number; tier: { name: string; emoji: string; color: string }; games: number; }
interface DailyEntry { nickname: string; duration: number; solutions: number; }

const panel = $('rankPanel');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.rtab'));

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

function fmtDur(sec: number): string {
  if (!isFinite(sec)) return '—';
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${sec.toFixed(1)}s`;
}

function rowHtml(i: number, cols: string[]): string {
  return `<div class="rrow${i < 3 ? ' top' + (i + 1) : ''}">
    <span class="r-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span>${cols.map((c) => `<span>${c}</span>`).join('')}</div>`;
}

async function loadRank(kind: string): Promise<void> {
  panel.innerHTML = '<div class="rload">Loading…</div>';
  try {
    if (kind === 'elo') {
      const r = await fetch('/api/elo/leaderboard?scope=all&limit=10', { credentials: 'include' });
      const j = await r.json();
      const entries: EloEntry[] = j.entries || [];
      if (!entries.length) { panel.innerHTML = '<div class="rempty">No rated duels yet — play a competition round to enter the ladder.</div>'; return; }
      panel.innerHTML =
        '<div class="rhead"><span>#</span><span>Player</span><span>Best game</span><span>Elo</span></div>' +
        entries.map((e, i) => rowHtml(i, [
          `<b class="rname">${esc(e.nickname)}</b>`,
          `<span class="rgame">${esc(e.game)}</span>`,
          `<span class="relo"><i class="tier" style="color:${esc(e.tier && e.tier.color)}">${esc(e.tier && e.tier.emoji)}</i> ${e.elo}</span>`,
        ])).join('');
      return;
    }
    const r = await fetch(`/api/daily/${encodeURIComponent(kind)}/rank?limit=10`, { credentials: 'include' });
    const j = await r.json();
    const entries: DailyEntry[] = j.entries || [];
    if (!entries.length) {
      panel.innerHTML = '<div class="rempty">No finishers yet today — be the first on the board!</div>';
      return;
    }
    panel.innerHTML =
      '<div class="rhead"><span>#</span><span>Player</span><span>Time</span><span>Solutions</span></div>' +
      entries.map((e, i) => rowHtml(i, [
        `<b class="rname">${esc(e.nickname)}</b>`,
        `<span class="rtime">${fmtDur(e.duration)}</span>`,
        `<span class="rsol">${e.solutions}</span>`,
      ])).join('');
  } catch {
    panel.innerHTML = '<div class="rempty">Could not load the board — check your connection.</div>';
  }
}

tabs.forEach((t) => t.addEventListener('click', () => {
  tabs.forEach((x) => x.classList.toggle('on', x === t));
  loadRank(t.dataset.rank || 'elo');
}));

loadRank('elo');

/* ═══════════ 赛事榜（每日 / 每周 / 每月）═══════════
   这里显示的是「打对战攒的 Elo 涨幅」，和上面的每日题完赛榜是两回事：
   那个比的是解题速度，这个比的是一段时间里赢了多少分。

   后端到 2026-10-07 才真正开始落成绩（KV binding 缺失 + 结算路径没接上报，
   两个故障都是静默的：API 一直 200，榜单一直空）。所以空态不是异常路径，
   而是现在每天的真实状态 —— 文案要能接得住「还没人打」这件事。 */
interface TourEntry {
  rank: number | null; nickname: string | null; eloDelta: number;
  wins: number; losses: number; draws: number; score: number;
  tier: { name: string; emoji: string; color: string } | null; unplayed?: boolean;
}
interface TourResp {
  period: string; key: string; endsAt: string;
  prizes: { gold: number; silver: number; bronze: number; emoji: string };
  participantCount: number; entries: TourEntry[]; me: TourEntry | null;
}

let tourPeriod = 'daily';
let tourData: TourResp | null = null;
let tourTick: number | null = null;
let tourReloading = false;

/** 取隐藏节点的已翻译文案（data-i18n 由 i18n.js 替换过） */
const TI = (id: string): string => (document.getElementById(id)?.textContent || '').trim();

function fmtLeft(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  // 日赛按秒跳动（时间压力就在那一秒一秒上）；周/月赛到分钟就够
  return d > 0 ? `${d}d ${hh}:${mm}` : `${hh}:${mm}:${ss}`;
}

function renderTour(): void {
  const d = tourData;
  if (!d) return;
  // 滚动 30 天榜没有「翻篇重置」时刻：隐藏 "until this board resets" 行内文案
  const until = document.querySelector('.tour-until') as HTMLElement | null;
  if (until) until.style.display = (d.period === 'rolling30') ? 'none' : '';
  const flag = $('tourFlag');
  if (flag && d.prizes) flag.textContent = d.prizes.emoji || '⚡';
  const prize = $('tourPrize');
  if (prize && d.prizes) {
    prize.textContent = `${d.prizes.emoji || '🏆'}${d.prizes.gold} · 🥈${d.prizes.silver} · 🥉${d.prizes.bronze}`;
  }

  const board = $('tourBoard');
  if (!d.entries.length) {
    board.innerHTML = `<div class="rempty">${esc(TI('tiEmpty'))}</div>`;
  } else {
    board.innerHTML =
      `<div class="rhead"><span>#</span><span>${esc(TI('tiPlayer'))}</span>` +
      `<span>${esc(TI('tiElo'))}</span><span>${esc(TI('tiScore'))}</span></div>` +
      d.entries.slice(0, 5).map((e, i) => `<div class="rrow${i === 0 ? ' top1' : ''}">
        <span class="r-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span>
        <span class="rname">${esc(e.nickname || '—')}</span>
        <span class="rtime">${e.eloDelta > 0 ? '+' : ''}${e.eloDelta}</span>
        <span class="rsol">${e.score}</span>
      </div>`).join('');
  }

  const me = $('tourMe');
  if (me) {
    if (d.me && typeof d.me.rank === 'number') {
      me.textContent = `${TI('tiYou')} #${d.me.rank} · ${d.me.score}`;
      me.classList.remove('muted');
    } else {
      me.textContent = TI('tiUnplayed');
      me.classList.add('muted');
    }
  }
}

function startTourClock(): void {
  if (tourTick) clearInterval(tourTick);
  const paint = (): void => {
    if (!tourData) return;
    const el = $('tourClock');
    // 滚动 30 天榜 endsAt 即此刻 → 倒计时恒为 0，不能走倒计时/翻篇重载逻辑（否则每秒重载）
    if (tourPeriod === 'rolling30') {
      if (el) el.textContent = TI('tiRollingClock');
      return;
    }
    const left = new Date(tourData.endsAt).getTime() - Date.now();
    if (el) el.textContent = fmtLeft(left);
    // 周期翻篇：拉一次新榜（新一期的 endsAt 会自己把时钟续上）
    if (left <= 0 && !tourReloading) {
      tourReloading = true;
      loadTournament(tourPeriod).finally(() => {
        setTimeout(() => { tourReloading = false; }, 5000);
      });
    }
  };
  paint();
  tourTick = window.setInterval(paint, 1000);
}

async function loadTournament(period: string): Promise<void> {
  const board = $('tourBoard');
  board.innerHTML = '<div class="rload">Loading…</div>';
  try {
    const r = await fetch(`/api/tournament/${encodeURIComponent(period)}`, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    tourData = await r.json() as TourResp;
    tourPeriod = period;
    renderTour();
    startTourClock();
  } catch {
    tourData = null;
    board.innerHTML = `<div class="rempty">${esc(TI('tiFail'))}</div>`;
  }
}

const tourTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#tourTabs .rtab'));
tourTabs.forEach((t) => t.addEventListener('click', () => {
  tourTabs.forEach((x) => x.classList.toggle('on', x === t));
  loadTournament(t.dataset.period || 'daily');
}));

loadTournament('daily');
/* 切回页面时刷新一次：打完一局回来想立刻看到自己上榜。
   不做定时轮询 —— 倒计时已经是这块唯一在动的东西了。 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadTournament(tourPeriod);
});
/* 语言切换后动态文案要跟着变 */
window.addEventListener('i18n:ready', () => renderTour());
