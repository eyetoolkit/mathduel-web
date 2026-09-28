/**
 * MathDuel i18n Runtime · TypeScript
 * ──────────────────────────────────────────────────────────────────────
 * 移植自 legacy/i18n/i18n.js（v27），保留所有生产验证过的能力，
 * 去除 legacy 专有的 LITERALS / window 污染 / navigator 自动探测。
 *
 * 支持 10 种语言：en / zh-CN / zh-TW / ja / ko / es / de / fr / it / pt
 *
 * 用法：
 *   // HTML 声明式（推荐，自动覆盖）
 *   <button data-i18n="common.ok"></button>
 *   <input data-i18n-placeholder="battle.enter_name">
 *   <span data-i18n-vars='{"round":1,"total":10}' data-i18n="battle.round"></span>
 *   <title data-i18n="site.title">
 *   <meta property="og:title" data-i18n="meta.og_title">
 *
 *   // JS 命令式
 *   import { t, initI18n, setLang } from '../i18n/runtime';
 *   t('battle.round', { round: 1, total: 10 });
 *   setLang('zh-CN');
 */

// =====================================================================
// Types & Config
// =====================================================================

export type LangCode = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'de' | 'fr' | 'it' | 'pt';

export const LANGS: { code: LangCode; label: string; short: string; flag: string }[] = [
  { code: 'en', label: 'English',         short: 'EN',   flag: '🇺🇸' },
  { code: 'zh-CN', label: '简体中文',      short: '中文',  flag: '🇨🇳' },
  { code: 'zh-TW', label: '繁體中文',      short: '中文',  flag: '🇹🇼' },
  { code: 'ja',  label: '日本語',          short: '日本語', flag: '🇯🇵' },
  { code: 'ko',  label: '한국어',          short: '한국어', flag: '🇰🇷' },
  { code: 'es',  label: 'Español',         short: 'ES',   flag: '🇪🇸' },
  { code: 'de',  label: 'Deutsch',         short: 'DE',   flag: '🇩🇪' },
  { code: 'fr',  label: 'Français',         short: 'FR',   flag: '🇫🇷' },
  { code: 'it',  label: 'Italiano',         short: 'IT',   flag: '🇮🇹' },
  { code: 'pt',  label: 'Português',       short: 'PT',   flag: '🇧🇷' },
];

export const SUPPORTED: LangCode[] = LANGS.map((l) => l.code);
export const DEFAULT_LANG: LangCode = 'en';

const DICT_VERSION = '1'; // 字典结构变更时 +1
const BASE_URL = '/i18n/';

const SITE_ID = (typeof document !== 'undefined'
  ? document.documentElement.getAttribute('data-site') || 'mathduel'
  : 'mathduel');
const STORAGE_KEY = SITE_ID + '_lang'; // 站点独立: mathduel_lang
const GENERIC_KEY = 'lang';             // 跨站同步键

let current: LangCode = DEFAULT_LANG;

/** 内联英文回退字典 —— 保证模块加载即同步可用。
 *  当 async loadDict('en') 完成后会用完整的 public/i18n/en.json 覆盖。
 *  任何时刻调用 t() 都能返回可读英文，不会把 key 字面量显示给用户。 */
const EN_FALLBACK: Record<string, unknown> = {
  common: { loading: 'Loading…', retry: 'Retry', copy: 'Copy', close: 'Close', share: 'Share', back: 'Back', ok: 'OK', cancel: 'Cancel', play_now: 'Play now', name_placeholder: 'Your name', done: 'Done', today: 'Today', error: 'Error', network: 'Connection failed. Check your network and try again.', copied: 'Copied', not_applicable: '—' },
  lang: { switch: 'Language', coming_soon: 'More languages coming soon' },
  nav: { home: 'Home', games: 'Games', about: 'About', contact: 'Contact', privacy: 'Privacy', terms: 'Terms', how_to_play: 'How to play', menu: 'Menu', signin: 'Sign in', leaderboard: 'Leaderboard', coin_shop: 'Coin Shop', collapse: 'Collapse sidebar', toggle_theme: 'Toggle theme', toggle_nav: 'Open navigation' },
  site: { name: 'MathDuel', sub: 'Pure static · Privacy-first · Free to play', tagline: 'Race the world to solve math puzzles' },
  hero: { eyebrow: 'Global multiplayer math', title: 'Race the world to make 24.', lead: 'Four cards. Four operators. One target. Solve faster than up to 99 players worldwide.', cta_play: 'Play now', cta_daily: "Today's challenge" },
  home: { section_games_title: 'Pick your game', coming_soon: 'Coming soon', all_games: 'All games', explore_family: 'Explore the Duel family' },
  daily: { badge: 'Daily Challenge', count: 'Puzzles', time: 'Per puzzle', start: 'Start daily', play_now: 'Play now', done_today: '✓ Done today' },
  game: { play: 'Play', practice: 'Practice', competition: 'Competition', daily: 'Daily', timed: 'Timed Practice', duel: 'Duel', race: 'Race', new_deal: '🂠 New Deal', hint: '💡 Hint', show_answer: 'Show Answer', your_name: 'Your name', room_code: 'Room code', create: 'Create', join: 'Join', start: 'Start', leave: 'Leave', waiting_to_start: 'Waiting to start…', round: 'Round {n}', target: 'Target', difficulty: 'Difficulty', easy: 'Easy', standard: 'Standard', hard: 'Hard', warmup: 'Warm-up', tricky: 'Tricky', solved: 'Solved', combo: 'Streak' },
  mp: {
      competition_over: "\ud83c\udfc1 Competition Over",
      connection_failed: "Connection failed, please retry",
      copy_code: "\u29c9 Copy code",
      copy_invite: "\ud83d\udd17 Copy invite",
      create_room: "\ud83d\ude80 Create Room",
      elo_rated: "\u2694\ufe0f Elo \u2014 rated match",
      enter_name: "Enter a name",
      host: "Host",
      invite_copied: "Invite link copied",
      join: "Join",
      join_code: "Join with code",
      leave: "Leave",
      live: "Live",
      live_standings: "\ud83c\udfc6 Live Standings",
      looking_for_opponent: "\ud83c\udfb2 Looking for an opponent\u2026",
      name_label: "Your name",
      name_placeholder: "Player",
      next_round: "Next round starting\u2026",
      no_opponent: "No opponent right now \u2014 try Create Room",
      no_submissions: "No submissions yet \u2014 be first!",
      play_again: "\ud83d\udd01 Play Again",
      players_count: "{n} players \u00b7 cap {cap}",
      random: "\ud83c\udfb2 Find Random Opponent",
      random_looking: "\ud83c\udfb2 Looking for an opponent\u2026",
      random_match_unavailable: "No opponent right now \u2014 try Create Room",
      room_chat: "\ud83d\udcac Room chat",
      room_code: "ROOM CODE",
      room_code_copied: "Room code copied: {code}",
      room_code_invalid: "Invalid code (4\u20136 chars)",
      room_failed: "Room failed",
      room_ready: "Room ready \u2014 share this code:",
      round_get_ready: "get ready",
      round_result_title: "\ud83c\udfc1 Round {n} Result",
      round_timer: "Round timer {s}s",
      round_timer_label: "Round timer {s}s",
      round_title: "Round {n}",
      say_something: "Say something\u2026",
      searching_30s: "\ud83c\udfb2 Searching \u2014 this stays open for 30s\u2026",
      send: "Send",
      solved: "solved",
      spec_round: "\ud83d\udc40 Spectating this round",
      spectating: "\ud83d\udc40 Spectating",
      spectating_desc: "read-only view",
      spectating_readonly: "\ud83d\udc40 <b>Spectating</b> \u2014 read-only view",
      spectating_watchers: "{n} watchers",
      speed_ring_speedrun: "Speedrun",
      speedrun_bronze: "Bronze",
      speedrun_gold: "Gold",
      speedrun_silver: "Silver",
      start_competition: "\ud83d\ude80 Start",
      start_competition_ready: "\ud83d\ude80 Start Competition",
      start_requirement: "Start Competition (2+ players)",
      sub: "Create a room, share the code, race friends or the world.",
      title: "{label} \u2014 Competition",
      waiting_for_players: "\u23f3 Waiting for players\u2026",
      waiting_for_server: "Live \u00b7 Waiting for server",
      waiting_to_start: "Waiting to start\u2026",
      watching_only: "only this room",
      you: "You",
      you_ranked: "\ud83c\udfc1 You ranked #{rank}",
      you_won: "\ud83c\udfc6 You won!",
      your_row_pinned: "Your row is pinned."
  },
  error: { invalid_room_code: 'Invalid room code', room_not_found: 'Room not found', room_full: 'Room is full', connection_lost: 'Connection lost', session_expired: 'Session expired — refresh', server_error: 'Server error — please retry' },
  sidebar: { logo: 'MathDuel', collapse: 'Collapse sidebar', toggle_theme: 'Toggle theme', toggle_nav: 'Open navigation', accounts_not_enabled: 'Accounts are not enabled yet', all_games_group: 'All games · {n}', coin_shop: 'Coin Shop', coin_shop_soon: 'soon', coin_shop_coming_soon: 'Coming soon', help_group: 'Help', teacher_group: 'For teachers', teacher_dashboard: 'Teacher dashboard', daily_challenge: 'Daily challenge', lang_coming_soon: 'More languages coming soon' },
  home_hero: { title: 'Make your <em>brain</em> smarter, 5 minutes a day', subtitle: 'Sudoku reasoning · 24-point speed math · equation climbs · code-breaking — six hand-picked math games,<br>same puzzle worldwide. Just tap and play.', cta_daily: "Start today's challenge", cta_friend: 'Challenge a friend', chip_no_login: 'No login', chip_no_ads: 'Free · no ads', chip_privacy: 'Privacy-first', chip_same_daily: 'Same puzzle daily' },
  home_daily: { title: 'Daily Challenge', streak: '{n}-day streak', msg_zero: "Try today's Daily — <b>same puzzle worldwide</b>. Unlock rank stars by completing 5 in a row.", msg_partial: '<b>{done}</b> of {total} done today — {left} left for rank stars.', msg_all: '<b>All {total}</b> done today — streak extended to <b>{streak} day{s}</b>!', until_reset: 'until the global reset' },
  home_weekly: { title: 'Weekly Tournament', live: 'Live', row: '{start} → {end} · {players} players · prizes 🥇50🪙 🥈25🪙 🥉10🪙', row_you: 'You', exchange: '🪙 Exchange coins for ad-free' },
  home_ladder: { title: 'Six-tier ladder', sub: 'One Elo across all three duel sites · weekly reset', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond', master: 'Master' },
  home_feats: { daily_title: 'Daily hunt', daily_desc: 'One puzzle worldwide, timed reset — race the globe.', friend_title: 'Friend duel', friend_desc: "Copy an invite link — one click and you're in the room.", race_title: 'Race · 99', race_desc: 'Live standings, your row pinned on the page.', hint_title: 'Smart hint', hint_desc: "Stuck? Ask for a hint — it shows the next step, not the answer." },
  home_why: { eyebrow: 'WHY MATHDUEL', title: 'Math is more fun when you can prove it.', lead: 'Every game on this site ships with a <b>Daily Challenge</b> — the same puzzle for everyone, everywhere, at the same Shanghai date. No login, no ads, no data mining. Just open the page and you can play.', privacy_title: '🔒 Privacy-first', privacy_desc: 'Anonymous UUID stored only in your browser. Clear cookies to reset.', same_title: '🌏 Same puzzle worldwide', same_desc: 'Shanghai-date seeded generation. Compare with anyone on Earth.', no_streak_title: '🪙 No streak rewards', no_streak_desc: 'The only prize is breaking your own yesterday. No notifications, no upsell.', free_title: '⚡ Free forever', free_desc: 'Static pages on Cloudflare, ~0 cost per visitor. No paywall, ever.' },
  home_footer: { title: 'Explore the Duel family', bd_title: 'BoardDuel — Chess & Card Games', md_title: 'MathDuel — Math Puzzle Games', mem_title: 'MemoryDuel — Knowledge Battles', daily_ranks: 'Daily & Ranks', my_journey: 'My Journey', worksheets: 'Worksheets', for_teachers: 'For teachers', tagline: 'MathDuel · Pure static · Privacy-first · Free to play' },
};

const dicts: Partial<Record<LangCode, Record<string, unknown>>> = {
  en: EN_FALLBACK, // 模块加载即同步可用，async loadDict('en') 会覆盖为完整版本
};

// =====================================================================
// Dict Loading
// =====================================================================

function loadDict(lang: LangCode, force = false): Promise<Record<string, unknown>> {
  if (dicts[lang] && !force) return Promise.resolve(dicts[lang]!);
  return fetch(BASE_URL + lang + '.json?v=' + DICT_VERSION, { credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok) throw new Error('Failed to load ' + lang);
      return r.json();
    })
    .then((data) => {
      dicts[lang] = data as Record<string, unknown>;
      return dicts[lang]!;
    });
}

// =====================================================================
// Key Lookup
// =====================================================================

/** 按点号查找嵌套键。get({common:{ok:'OK'}}, 'common.ok') → 'OK' */
function get(obj: unknown, path: string): unknown {
  if (obj == null || !path) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  return cur;
}

/** 占位符替换：{key} → vars[key] */
function interpolate(str: string, vars?: Record<string, unknown>): string {
  if (!str) return str;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v !== undefined ? String(v) : '{' + key + '}';
  });
}

// =====================================================================
// Core Translation
// =====================================================================

/** 核心翻译函数；缺失时回退 DEFAULT_LANG，再回退 key 本身 */
export function t(key: string, vars?: Record<string, unknown>): string {
  let val: unknown = get(dicts[current], key);

  if (val === undefined && current !== DEFAULT_LANG) {
    val = get(dicts[DEFAULT_LANG], key);
  }

  if (val === undefined || val === null) {
    if (typeof window !== 'undefined' && (window as any).__I18N_VERBOSE) {
      console.warn('[i18n] missing key:', key, 'lang:', current);
    }
    return key;
  }

  if (typeof val !== 'string') {
    if (typeof window !== 'undefined' && (window as any).__I18N_VERBOSE) {
      console.warn('[i18n] non-string value for key:', key, val);
    }
    return key;
  }

  return interpolate(val, vars);
}

// =====================================================================
// DOM Application
// =====================================================================

let applying = false;

function apply(root: ParentNode = document): void {
  if (applying) return; // 防 MutationObserver 死循环
  applying = true;
  try {
    // data-i18n → textContent
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const vars = parseVars(el.dataset.i18nVars);
      el.textContent = t(key, vars);
    });

    // data-i18n-placeholder → placeholder
    root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (key) el.setAttribute('placeholder', t(key));
    });

    // data-i18n-title → title + 同步 <title> 元素 + document.title
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
      const key = el.dataset.i18nTitle;
      if (!key) return;
      const val = t(key);
      el.setAttribute('title', val);
      if ((el.tagName || '').toUpperCase() === 'TITLE') {
        el.textContent = val;
        if (typeof document !== 'undefined') document.title = val;
      }
    });

    // data-i18n-aria-label → aria-label
    root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
      const key = el.dataset.i18nAriaLabel;
      if (key) el.setAttribute('aria-label', t(key));
    });

    // data-i18n-html → innerHTML（允许 HTML 片段）
    root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
      const key = el.dataset.i18nHtml;
      if (!key) return;
      const val = t(key);
      if (val !== key) el.innerHTML = val;
    });

    // data-i18n-alt → alt（图片）
    root.querySelectorAll<HTMLElement>('[data-i18n-alt]').forEach((el) => {
      const key = el.dataset.i18nAlt;
      if (key) el.setAttribute('alt', t(key));
    });

    // <title data-i18n="key"> → document.title
    if (typeof document !== 'undefined') {
      const titleEl = document.querySelector('title[data-i18n]');
      if (titleEl) {
        const key = titleEl.getAttribute('data-i18n');
        if (key) {
          const v = t(key);
          if (v !== key) {
            titleEl.textContent = v;
            document.title = v;
          }
        }
      }

      // <meta data-i18n="key" [name|property]="..."> → content
      document.querySelectorAll('meta[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const v = t(key);
        if (v !== key) el.setAttribute('content', v);
      });

      document.documentElement.lang = current;
    }
  } finally {
    applying = false;
  }
}

function parseVars(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// =====================================================================
// MutationObserver（重译动态注入节点）
// =====================================================================

let observer: MutationObserver | null = null;

function setupObserver(): void {
  if (typeof MutationObserver === 'undefined' || observer) return;
  observer = new MutationObserver(() => {
    if (applying) return; // 忽略 apply() 自身写 DOM 触发的 mutation
    if (_obsTimer) window.clearTimeout(_obsTimer);
    _obsTimer = window.setTimeout(() => { apply(); }, 60);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

let _obsTimer: number | null = null;

// =====================================================================
// Language API
// =====================================================================

/** 检测初始语言（优先级：URL > localStorage(站点) > localStorage(跨站) > 默认 en） */
export function detectLang(): LangCode {
  try {
    // 1. URL ?lang=
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('lang');
    if (fromUrl && SUPPORTED.includes(fromUrl as LangCode)) return fromUrl as LangCode;

    // 2. URL 路径前缀 /zh-CN/ /en/
    const m = window.location.pathname.match(/^\/([a-z-]+)(\/|$)/i);
    if (m && SUPPORTED.includes(m[1] as LangCode)) return m[1] as LangCode;

    // 3. localStorage — 站点键优先，其次跨站通用键
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored as LangCode)) return stored as LangCode;
    const generic = localStorage.getItem(GENERIC_KEY);
    if (generic && SUPPORTED.includes(generic as LangCode)) return generic as LangCode;
  } catch {
    /* ignore */
  }
  // 默认英文（首访统一，等用户主动切）
  return DEFAULT_LANG;
}

export function getLang(): LangCode {
  return current;
}

/** 切换语言 */
export function setLang(lang: LangCode, options?: { skipUrl?: boolean }): Promise<LangCode> {
  if (!SUPPORTED.includes(lang)) {
    console.warn('[i18n] unsupported lang:', lang);
    return Promise.reject(new Error('unsupported lang'));
  }
  const prev = current;
  return loadDict(lang, true).then(() => {
    current = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
      localStorage.setItem(GENERIC_KEY, lang);
    } catch { /* private mode */ }
    apply();
    window.dispatchEvent(new CustomEvent('tri:lang', { detail: { lang, prev } }));
    window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang, prev } }));
    if (!options?.skipUrl) syncUrl(lang);
    return lang;
  });
}

/** 同步语言到 URL（路径前缀 /zh-CN/games/24-game/ 优先） */
function syncUrl(lang: LangCode): void {
  try {
    const url = new URL(window.location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    const first = parts[0];
    if (first && SUPPORTED.includes(first as LangCode)) {
      parts[0] = lang;
      url.pathname = '/' + parts.join('/') + (window.location.pathname.endsWith('/') ? '/' : '');
    } else {
      url.searchParams.set('lang', lang);
    }
    window.history.replaceState({}, '', url.toString());
  } catch { /* ignore */ }
}

/** 挂载语言切换器（原生 <select>，移动端无障碍最好） */
export function mountLangSwitcher(host: HTMLElement): void {
  host.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'lang-select';
  sel.setAttribute('aria-label', t('lang.switch'));
  for (const l of LANGS) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.flag + ' ' + l.label;
    if (l.code === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => setLang(sel.value as LangCode));
  host.appendChild(sel);
}

// =====================================================================
// Error Code Mapping（服务端 WS 错误码 → i18n key）
// =====================================================================

export const ERROR_CODE_MAP: Record<string, string> = {
  INVALID_ROOM_CODE: 'error.invalid_room_code',
  ROOM_NOT_FOUND: 'error.room_not_found',
  ROOM_FULL: 'error.room_full',
  INVALID_PUZZLE: 'error.invalid_puzzle',
  FORMULA_INVALID: 'error.formula_invalid',
  INVALID_CELL_ID: 'error.cell_invalid',
  WRONG_ANSWER: 'error.wrong_answer',
  SUDOKU_GEN_FAILED: 'error.sudoku_generation_failed',
  KILLER_SUDOKU_GEN_FAILED: 'error.killer_sudoku_generation_failed',
  PYRAMID_GEN_FAILED: 'error.pyramid_generation_failed',
  INVALID_NAME: 'error.invalid_name',
  NAME_TOO_SHORT: 'error.name_too_short',
  NAME_TOO_LONG: 'error.name_too_long',
  RATE_LIMITED: 'error.rate_limited',
  CONNECTION_LOST: 'error.connection_lost',
  NOT_IN_ROOM: 'error.not_in_room',
  GAME_OVER: 'error.game_over',
  WRONG_TURN: 'error.wrong_turn',
  SESSION_EXPIRED: 'error.session_expired',
  SERVER_ERROR: 'error.server_error',
  INVALID_VALUE: 'error.invalid_value',
  INVALID_INDEX: 'error.invalid_index',
  CELL_INVALID: 'error.cell_invalid',
  CELL_ALREADY_FILLED: 'error.cell_already_filled',
  CELL_DUPLICATE: 'error.cell_duplicate',
  EQUATION_INVALID: 'error.equation_invalid',
};

/** 渲染 WS 错误消息（优先 ERROR_CODE_MAP → msg 可能是 i18n key → msg 原串） */
export function renderError(errOrMsg: unknown, vars?: Record<string, unknown>): string {
  const v = vars || {};
  let code: string | null = null;
  let msg: string | null = null;
  if (typeof errOrMsg === 'string') {
    msg = errOrMsg;
  } else if (errOrMsg && typeof errOrMsg === 'object') {
    const e = errOrMsg as Record<string, unknown>;
    code = typeof e.code === 'string' ? e.code : null;
    msg = typeof e.msg === 'string' ? e.msg : typeof e.message === 'string' ? e.message : null;
  }
  if (code) {
    const key = ERROR_CODE_MAP[code];
    if (key) {
      const translated = t(key, v);
      if (translated && translated !== key) return translated;
    }
  }
  if (msg && typeof msg === 'string' && msg.indexOf('.') > 0 && msg.indexOf(' ') < 0) {
    const vv = t(msg, v);
    if (vv && vv !== msg) return vv;
  }
  if (msg) return interpolate(msg, v);
  return code || t('common.error');
}

// =====================================================================
// Initialization
// =====================================================================

export function initI18n(): Promise<LangCode> {
  const lang = detectLang();
  return loadDict(lang, true).then(() => {
    current = lang;
    if (typeof document !== 'undefined') {
      const trigger = () => {
        apply();
        setupObserver();
        document.documentElement.setAttribute('data-i18n-ready', 'true');
        window.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang } }));
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', trigger, { once: true });
      } else {
        trigger();
      }
    }
    return lang;
  }).catch((err) => {
    console.error('[i18n] init failed:', err);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-i18n-ready', 'error');
    }
    return DEFAULT_LANG;
  });
}
