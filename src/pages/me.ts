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
  getTotalDailyDoneCount, todayKey, ALL_GAMES, GAME_NAME_KEYS,
  type GameId,
} from '../games/cross-game';
import { i18nT, onI18nChange } from '../games/_shared/i18n-t';
import {
  coinsMe, getHistory,
  type CoinHistoryItem, type CoinsMe as CoinsMeData,
  CoinsError,
} from '../shared/coins';

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

/* 游戏名映射已上收到 games/cross-game.ts 的 GAME_NAME_KEYS（全站唯一出口）。
 * 🔴 早这里是本文件私有的英文字面量表，切中文时「我的旅程」页仍显示
 *    "Equation Pyramid" —— 静态扫描抓不到字典形式的硬编码，只有 CDP 才暴露。
 *    现在与分享文案、Daily Elo 榜共用同一份映射。 */

/** 模式名同样走字典，键与 daily/lobby 的统计口径一致。
 *  🔴 2026-10-17：duel/timed/practice/competition 四个模式原先指向
 *  mg.mp_me_mode_*（六本字典里都不存在 → /me/ 页这四个标签显示裸 key），
 *  改为字典里早已建好的 mg.shared_tab_*（与 solo/daily 同源，六语齐全）。 */
const MODE_LABEL_KEYS: Record<string, string> = {
  solo: 'mg.shared_tab_solo',
  daily: 'mg.shared_tab_daily',
  duel: 'mg.shared_tab_duel',
  timed: 'mg.shared_tab_timed',
  practice: 'mg.shared_tab_practice',
  competition: 'mg.shared_tab_competition',
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
function renderTotals(): void {
  const total = getTotalDailyDoneCount();
  const games = getGamesPlayedCount();
  $('totals').innerHTML =
    `<b>${total}</b> ${i18nT('mp.mp_me_stat_daily')} · ` +
    `<b>${games}</b> ${i18nT('mp.mp_me_stat_games')} · ` +
    `${i18nT('mp.mp_me_stat_today')} <b>${dones.length}/${ALL_GAMES.length}</b>`;
  const pct = Math.round((dones.length / ALL_GAMES.length) * 100);
  $('ringTxt').textContent = `${dones.length}/${ALL_GAMES.length}`;
  $('ring').style.background = `conic-gradient(#F59E0B ${pct * 3.6}deg, #E3E6F0 0deg)`;
  $('ring').classList.toggle('full', dones.length === ALL_GAMES.length);
}
renderTotals();

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
    const modeTags = modes.map((m) => `<span class="mj-mode">${esc(i18nT(MODE_LABEL_KEYS[m] || m))}</span>`).join('');
    const doneToday = dones.includes(g);
    const a = document.createElement('a');
    a.className = 'mj-game' + (rec ? '' : ' never');
    a.href = `/games/${g}/lobby/`;
    a.innerHTML = `
      <span class="mj-gname">${esc(i18nT(GAME_NAME_KEYS[g] || g))}</span>
      <span class="mj-gmodes">${modeTags || `<span class="mj-never">${i18nT('mp.mp_me_never')}</span>`}</span>
      <span class="mj-gtoday">${doneToday ? `<b class="ok">${i18nT('mp.mp_me_daily_today')}</b>` : '&nbsp;'}</span>`;
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
    el.innerHTML = `<span class="mj-be">${b.emoji}</span><span class="mj-bn">${esc(i18nT(b.nameKey))}</span><span class="mj-bh">${esc(i18nT(b.hintKey, b.hintVars))}</span>`;
    host.appendChild(el);
  }
}
renderBadges();

/* ─── 语言切换后重渲染 ───
 * 🔴 上面这些渲染用了 i18nT()，但 i18n.js 是异步 fetch 字典后才 ready；
 *   页面脚本往往先跑完，此时 i18nT会回落到 key 名，
 *   于是徽章区/统计行会显示 mg.badge_* 这种原始键。
 *   这里在 ready 后重跑一次，把文案换成目标语言。
 *
 *   同样必须监听 i18n:change —— 玩家在 /me/ 上切语言时，
 *   静态骨架 i18n.js 会自动换，但用 i18nT() 写的这些节点它管不到。 */
onI18nChange(() => {
  renderCalendar();
  renderTotals();
  renderGames();
  renderBadges();
  renderCoinsSection();
});

/* ─── 金币钱包区（P0 经济接线） ─────────────────────────────
 * 余额 + 最近 20 条收支流水，全部走 src/shared/coins.ts 封装的已有 API。
 * 服务端是单一真相源（coins.me / coins.history），本地只渲染。
 * 匿名态降级为「登录解锁」提示（wallet_anon），不报错、不影响足迹页。 */

/** source 字符串 → i18n 键（对齐服务端 member.history 的 source 取值） */
const COIN_SRC_KEY: Record<string, string> = {
  checkin: 'coins.src_checkin',
  game: 'coins.src_game',
  game_win: 'coins.src_game_win',
  game_hard: 'coins.src_game_hard',
  quest: 'coins.src_quest',
  pvp: 'coins.src_pvp',
  daily: 'coins.src_daily',
  purchase: 'coins.src_purchase',
  invite: 'coins.src_invite',
};

/** 取 source 的本地化标签：查映射表，未命中回落原 source 串（防御服务端新增 source） */
function coinSrcLabel(src: string): string {
  const key = COIN_SRC_KEY[src];
  return key ? i18nT(key) : src;
}

function renderCoinsSection(): void {
  const card = document.getElementById('coinsCard');
  const numEl = document.getElementById('coinsNum');
  const rowsEl = document.getElementById('coinRows') as HTMLElement | null;
  if (!card || !numEl || !rowsEl) return;

  void coinsMe()
    .then((me: CoinsMeData) => {
      if (me.authenticated && typeof me.coins === 'number') {
        numEl.textContent = String(me.coins);
        card.classList.add('authed');
        return getHistory(20);
      }
      card.classList.remove('authed');
      numEl.textContent = '—';
      rowsEl!.textContent = '';
      const hint = document.createElement('p');
      hint.className = 'mj-coins-anon';
      hint.textContent = i18nT('coins.wallet_anon');
      rowsEl!.appendChild(hint);
      return null;
    })
    .then((hist) => {
      if (!hist) return;
      rowsEl!.textContent = '';
      if (!hist.history || hist.history.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'mj-coins-empty';
        empty.textContent = i18nT('coins.history_empty');
        rowsEl!.appendChild(empty);
        return;
      }
      for (const item of hist.history) {
        rowsEl!.appendChild(coinRowHtml(item));
      }
    })
    .catch((e) => {
      // 网络/服务不可达 → 离线提示；匿名/业务错 → 保留降级
      if (e instanceof CoinsError && e.code === 'network') {
        const off = document.createElement('p');
        off.className = 'mj-coins-offline';
        off.textContent = i18nT('coins.err_offline');
        rowsEl!.textContent = '';
        rowsEl!.appendChild(off);
      }
    });
}

function coinRowHtml(item: CoinHistoryItem): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mj-coinrow ' + (item.type === 'earn' ? 'earn' : 'spend');
  const sign = item.type === 'earn' ? '+' : '−';
  const time = new Date(item.ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  row.innerHTML =
    `<span class="mj-cr-src">${esc(coinSrcLabel(item.source))}</span>` +
    `<span class="mj-cr-amt num">${sign}${item.amount}</span>` +
    `<span class="mj-cr-time">${esc(time)}</span>`;
  return row;
}

/* 首次渲染（i18n 未就绪时也会先跑一次，ready 后由 onI18nChange 重渲） */
renderCoinsSection();
