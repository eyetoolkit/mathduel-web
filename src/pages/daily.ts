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
  getDailyStreak, getTodaysDones, todayKey, gameName,
  type GameId,
} from '../games/cross-game';
import { i18nT, onI18nChange } from '../games/_shared/i18n-t';

/** 🔴 卡片的名称/副标题一律走 i18n key，不在代码里写死任何语言的文案。
 *  data-i18n 依赖 i18n.js 的 MutationObserver 兜底，但这里同时显式 t() 一次，
 *  避免字典就绪前就插进 DOM 导致原始英文/原始 key 闪现在首屏。 */
interface DailyCardDef {
  id: GameId;
  nameKey: string;
  blurbKey: string;
  href: string;
  icon: string;   // 内联 SVG
  hue: string;    // 卡片强调色
}

const CARDS: DailyCardDef[] = [
  {
    id: '24-game', nameKey: 'ml.dc_24_name', blurbKey: 'ml.dc_24_blurb',
    href: '/games/24-game/?mode=daily', hue: '#3730A3',
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  },
  {
    id: 'sudoku-4x4', nameKey: 'ml.dc_s4_name', blurbKey: 'ml.dc_s4_blurb',
    href: '/games/sudoku-4x4/?mode=daily', hue: '#0E9F6E',
    icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M11.5 4v16M4 11.5h16" stroke-width="2"/></svg>',
  },
  {
    id: 'sudoku', nameKey: 'ml.dc_s9_name', blurbKey: 'ml.dc_s9_blurb',
    href: '/games/sudoku/?mode=daily', hue: '#3730A3',
    icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke-width="2"/><path d="M9.3 4v16M14.6 4v16M4 9.3h16M4 14.6h16"/></svg>',
  },
  {
    id: 'sudoku-6x6', nameKey: 'ml.dc_s6_name', blurbKey: 'ml.dc_s6_blurb',
    href: '/games/sudoku-6x6/?mode=daily', hue: '#B45309',
    icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke-width="2"/><path d="M12 4v16M4 12h16"/></svg>',
  },
  {
    id: 'equation-pyramid', nameKey: 'ml.dc_pyr_name', blurbKey: 'ml.dc_pyr_blurb',
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

/** 顶部日期行（"今天 · 2026-10-15"）。单独成函数是为了切语言时能重画。 */
function renderDate(): void {
  const k = todayKey();
  const pretty = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
  $('dateLine').textContent = i18nT('mp.mp_daily_date_suffix', { d: pretty });
}
renderDate();

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
    // data-i18n：i18n.js 的 MutationObserver 会自动翻译动态插入的节点，
    // 语言切换时也会跟着重译（无需手动监听）；内联 ${i18nT()} 保证首屏即译文。
    a.innerHTML = `
      <span class="dcard-ic">${c.icon}</span>
      <span class="dcard-body">
        <span class="dcard-name" data-i18n="${c.nameKey}">${esc(i18nT(c.nameKey))}</span>
        <span class="dcard-blurb" data-i18n="${c.blurbKey}">${esc(i18nT(c.blurbKey))}</span>
      </span>
      <span class="dcard-cta">${done ? '<b class="ok" data-i18n="ml.dc_done_today">✓ Done today</b>' : '<span data-i18n="ml.dc_play_now">Play now →</span>'}</span>`;
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

/** 🔴 榜单是 async fetch 后写 innerHTML，字典可能还没到位。
 *    关键：只缓存**纯数据行**（不含任何文案），表头/空态/失败态每次渲染现取 i18nT()，
 *    这样 i18n:ready 与 i18n:change 之后只要重渲一次就能补上译文，
 *    不必重新 fetch，也不会把「英文/原始 key」固化在 DOM 里。 */
let repaintRank: (() => void) | null = null;
let rankState: {
  kind: string;
  status: 'load' | 'ok' | 'empty' | 'fail';
  rows: string[];
} | null = null;

function rankHead(kind: string): string {
  if (kind === 'elo') {
    return '<div class="rhead"><span>#</span>' +
      `<span>${esc(i18nT('mp.mp_tour_col_player'))}</span>` +
      `<span>${esc(i18nT('mp.mp_daily_col_best_game'))}</span>` +
      `<span>${esc(i18nT('mp.mp_daily_col_elo'))}</span></div>`;
  }
  return '<div class="rhead"><span>#</span>' +
    `<span>${esc(i18nT('mp.mp_tour_col_player'))}</span>` +
    `<span>${esc(i18nT('mp.mp_daily_col_time'))}</span>` +
    `<span>${esc(i18nT('mp.mp_daily_col_solutions'))}</span></div>`;
}

function renderRank(): void {
  const st = rankState;
  if (!st) return;
  if (st.status === 'load') {
    panel.innerHTML = `<div class="rload">${esc(i18nT('common.loading'))}</div>`;
    return;
  }
  if (st.status === 'fail') {
    panel.innerHTML = `<div class="rempty">${esc(i18nT('mp.mp_daily_rank_fail'))}</div>`;
    return;
  }
  if (st.status === 'empty' || !st.rows.length) {
    panel.innerHTML = `<div class="rempty">${esc(
      st.kind === 'elo' ? i18nT('mp.mp_daily_elo_empty') : i18nT('mp.mp_daily_rank_empty'),
    )}</div>`;
    return;
  }
  panel.innerHTML = rankHead(st.kind) + st.rows.join('');
}

async function loadRank(kind: string): Promise<void> {
  repaintRank = () => { if (rankState) renderRank(); };
  rankState = { kind, status: 'load', rows: [] };
  renderRank();
  try {
    let rows: string[];
    if (kind === 'elo') {
      const r = await fetch('/api/elo/leaderboard?scope=all&limit=10', { credentials: 'include' });
      const j = await r.json();
      const entries: EloEntry[] = j.entries || [];
      rows = entries.map((e, i) => rowHtml(i, [
        `<b class="rname">${esc(e.nickname)}</b>`,
        `<span class="rgame">${esc(gameName(e.game))}</span>`,
        `<span class="relo"><i class="tier" style="color:${esc(e.tier && e.tier.color)}">${esc(e.tier && e.tier.emoji)}</i> ${e.elo}</span>`,
      ]));
    } else {
      const r = await fetch(`/api/daily/${encodeURIComponent(kind)}/rank?limit=10`, { credentials: 'include' });
      const j = await r.json();
      const entries: DailyEntry[] = j.entries || [];
      rows = entries.map((e, i) => rowHtml(i, [
        `<b class="rname">${esc(e.nickname)}</b>`,
        `<span class="rtime">${fmtDur(e.duration)}</span>`,
        `<span class="rsol">${e.solutions}</span>`,
      ]));
    }
    if (!rankState || rankState.kind !== kind) return;   // 已被切走的 tab，丢弃
    rankState = { kind, status: rows.length ? 'ok' : 'empty', rows };
    renderRank();
  } catch {
    if (!rankState || rankState.kind !== kind) return;
    rankState = { kind, status: 'fail', rows: [] };
    renderRank();
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
let tourState: { status: 'load' | 'ok' | 'fail' } = { status: 'load' };

/** 🔴 赛事榜文案一律直接 i18nT() 取，不要读隐藏节点的 textContent。
 *    读隐藏节点（旧的 TI() 写法）有两个致命问题：
 *      1) i18n.js 还没翻译完时读到的是英文兜底，写进 innerHTML 就固化了；
 *      2) fetch 失败路径 return 得早，语言就绪/切换后没有机会重绘。
 *    现在 load/empty/fail 三态都走 renderTourBoard()，随时可重入。 */
const TKEY = {
  player: 'mp.mp_tour_col_player',
  elo: 'mp.mp_tour_col_elo',
  score: 'mp.mp_tour_col_score',
  empty: 'mp.mp_tour_empty',
  fail: 'mp.mp_tour_fail',
  you: 'mp.mp_tour_you',
  unplayed: 'mp.mp_tour_unplayed',
  rollingClock: 'mp.mp_tour_rolling_clock',
} as const;

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

function renderTourBoard(): void {
  const board = $('tourBoard');
  const st = tourState;
  if (st.status === 'fail') {
    board.innerHTML = `<div class="rempty">${esc(i18nT(TKEY.fail))}</div>`;
    return;
  }
  const d = tourData;
  if (st.status === 'load' || !d) {
    board.innerHTML = `<div class="rload">${esc(i18nT('common.loading'))}</div>`;
    return;
  }
  if (!d.entries.length) {
    board.innerHTML = `<div class="rempty">${esc(i18nT(TKEY.empty))}</div>`;
    return;
  }
  board.innerHTML =
    `<div class="rhead"><span>#</span><span>${esc(i18nT(TKEY.player))}</span>` +
    `<span>${esc(i18nT(TKEY.elo))}</span><span>${esc(i18nT(TKEY.score))}</span></div>` +
    d.entries.slice(0, 5).map((e, i) => `<div class="rrow${i === 0 ? ' top1' : ''}">
      <span class="r-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span>
      <span class="rname">${esc(e.nickname || '—')}</span>
      <span class="rtime">${e.eloDelta > 0 ? '+' : ''}${e.eloDelta}</span>
      <span class="rsol">${e.score}</span>
    </div>`).join('');
}

function renderTour(): void {
  const d = tourData;
  if (!d) {
    renderTourBoard();
    return;
  }
  // 滚动 30 天榜没有「翻篇重置」时刻：隐藏 "until this board resets" 行内文案
  const until = document.querySelector('.tour-until') as HTMLElement | null;
  if (until) until.style.display = (d.period === 'rolling30') ? 'none' : '';
  const flag = $('tourFlag');
  if (flag && d.prizes) flag.textContent = d.prizes.emoji || '⚡';
  const prize = $('tourPrize');
  if (prize && d.prizes) {
    prize.textContent = `${d.prizes.emoji || '🏆'}${d.prizes.gold} · 🥈${d.prizes.silver} · 🥉${d.prizes.bronze}`;
  }

  renderTourBoard();

  const me = $('tourMe');
  if (me) {
    if (d.me && typeof d.me.rank === 'number') {
      me.textContent = `${i18nT(TKEY.you)} #${d.me.rank} · ${d.me.score}`;
      me.classList.remove('muted');
    } else {
      me.textContent = i18nT(TKEY.unplayed);
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
      if (el) el.textContent = i18nT(TKEY.rollingClock);
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
  tourState = { status: 'load' };
  renderTourBoard();
  try {
    const r = await fetch(`/api/tournament/${encodeURIComponent(period)}`, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    tourData = await r.json() as TourResp;
    tourPeriod = period;
    tourState = { status: 'ok' };
    renderTour();
    startTourClock();
  } catch {
    tourData = null;
    tourState = { status: 'fail' };
    renderTourBoard();
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
/* 语言切换后动态文案要跟着变。
   🔴 必须同时覆盖两种事件：
     i18n:ready —— 字典异步 fetch 完成，此刻之前渲染出去的是原始 key
     i18n:change —— 玩家在页面上主动切语言，静态骨架 i18n.js 会自动换，
                    但用 i18nT() 写进 innerHTML 的日期/榜单/表头它管不到 */
onI18nChange(() => {
  renderDate();
  renderTour();
  renderCards();
  if (repaintRank) repaintRank();
});
