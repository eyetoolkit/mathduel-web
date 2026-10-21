/**
 * NumeriDuel 主页 · papergames 浅色版（Homepage Redesign v2, 2026-09-23）
 * 设计稿：share-html/24zuixin.html
 *
 * 设计要点：
 *   - 固定左侧栏 236px（桌面可收窄到 74px 图标栏；<1120px 转抽屉）
 *   - 主区第 1 屏是 6 张游戏卡墙（2 列 × 3 行），卡上是游戏封面 SVG
 *   - 居中 hero + 双列（Daily Challenge / Weekly Tournament）+ 天梯 + 4 列特性 + 深靛页脚
 *   - 生产仅 24 Game「live」，其余 5 个游戏以灰态 "Polishing" 卡片展示
 *     （可点击进对应页，只是 prod 标记为 beta 打磨中；beta 环境恢复全 live）
 *   - 字体用设计系统站内自托管的 Space Grotesk / Sora，模拟 Baloo 2 圆润感
 */
import type { GameDef } from './home';
import { wireLobbyChrome } from './lobby-chrome';
import { getTodaysDones, getDailyStreak, getBadges } from '../games/cross-game';
import { i18nT, escHtml } from '../games/_shared/i18n-t';
import {
  coinsMe, checkin, getQuests, claimQuests, QUEST_KEY_MAP,
  type CoinsMe as CoinsMeData, type Quest as CoinsQuest,
  CoinsError,
} from '../shared/coins';
import { playSfx } from '../shared/sfx';

const SHOW_BETA = (import.meta.env.VITE_SHOW_BETA ?? '') === '1';

/* ───────── 6 个游戏的封面 SVG symbol（与设计稿逐字一致） ───────── */
const CV_SYMBOLS = `
<symbol id="cv-24" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <rect x="56" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="56" y="272" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="272" width="184" height="184" rx="42" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="148" y="148" dominant-baseline="central" font-size="80" fill="#3730A3">13</text>
    <text x="364" y="148" dominant-baseline="central" font-size="80" fill="#3730A3">11</text>
    <text x="148" y="366" dominant-baseline="central" font-size="86" fill="#3730A3">+</text>
    <text x="364" y="366" dominant-baseline="central" font-size="72" fill="#1E1B39">24</text>
  </g>
</symbol>

<symbol id="cv-sudoku" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <g fill="#FFFFFF">
    <rect x="56" y="56" width="118" height="118" rx="27"/>
    <rect x="197" y="56" width="118" height="118" rx="27"/>
    <rect x="338" y="56" width="118" height="118" rx="27"/>
    <rect x="56" y="197" width="118" height="118" rx="27"/>
    <rect x="197" y="197" width="118" height="118" rx="27"/>
    <rect x="338" y="197" width="118" height="118" rx="27"/>
    <rect x="56" y="338" width="118" height="118" rx="27"/>
    <rect x="197" y="338" width="118" height="118" rx="27"/>
  </g>
  <rect x="338" y="338" width="118" height="118" rx="27" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="115" y="115" dominant-baseline="central" font-size="62" fill="#3730A3">1</text>
    <text x="256" y="115" dominant-baseline="central" font-size="62" fill="#3730A3">2</text>
    <text x="397" y="115" dominant-baseline="central" font-size="62" fill="#3730A3">3</text>
    <text x="115" y="256" dominant-baseline="central" font-size="62" fill="#3730A3">4</text>
    <text x="256" y="256" dominant-baseline="central" font-size="62" fill="#3730A3">5</text>
    <text x="397" y="256" dominant-baseline="central" font-size="62" fill="#3730A3">6</text>
    <text x="115" y="397" dominant-baseline="central" font-size="62" fill="#3730A3">7</text>
    <text x="256" y="397" dominant-baseline="central" font-size="62" fill="#3730A3">8</text>
    <text x="397" y="397" dominant-baseline="central" font-size="62" fill="#1E1B39">9</text>
  </g>
</symbol>

<symbol id="cv-s6" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <g fill="#FFFFFF">
    <rect x="56" y="126" width="118" height="118" rx="27"/>
    <rect x="197" y="126" width="118" height="118" rx="27"/>
    <rect x="338" y="126" width="118" height="118" rx="27"/>
    <rect x="56" y="267" width="118" height="118" rx="27"/>
    <rect x="197" y="267" width="118" height="118" rx="27"/>
  </g>
  <rect x="338" y="267" width="118" height="118" rx="27" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="115" y="185" dominant-baseline="central" font-size="62" fill="#3730A3">1</text>
    <text x="256" y="185" dominant-baseline="central" font-size="62" fill="#3730A3">2</text>
    <text x="397" y="185" dominant-baseline="central" font-size="62" fill="#3730A3">3</text>
    <text x="115" y="326" dominant-baseline="central" font-size="62" fill="#3730A3">4</text>
    <text x="256" y="326" dominant-baseline="central" font-size="62" fill="#3730A3">5</text>
    <text x="397" y="326" dominant-baseline="central" font-size="62" fill="#FFFFFF">6</text>
  </g>
</symbol>

<symbol id="cv-s4" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <rect x="76" y="76" width="168" height="168" rx="38" fill="#FFFFFF"/>
  <rect x="268" y="76" width="168" height="168" rx="38" fill="#FFFFFF"/>
  <rect x="76" y="268" width="168" height="168" rx="38" fill="#FFFFFF"/>
  <rect x="268" y="268" width="168" height="168" rx="38" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="160" y="160" dominant-baseline="central" font-size="92" fill="#3730A3">1</text>
    <text x="352" y="160" dominant-baseline="central" font-size="92" fill="#3730A3">2</text>
    <text x="160" y="352" dominant-baseline="central" font-size="92" fill="#3730A3">3</text>
    <text x="352" y="352" dominant-baseline="central" font-size="92" fill="#1E1B39">4</text>
  </g>
</symbol>

<symbol id="cv-pyr" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <g fill="#FFFFFF" fill-opacity="0.16">
    <rect x="260" y="164" width="88" height="88" rx="20"/>
    <rect x="116" y="260" width="88" height="88" rx="20"/>
    <rect x="308" y="260" width="88" height="88" rx="20"/>
    <rect x="68" y="356" width="88" height="88" rx="20"/>
    <rect x="164" y="356" width="88" height="88" rx="20"/>
    <rect x="356" y="356" width="88" height="88" rx="20"/>
  </g>
  <g fill="#F59E0B" fill-opacity="0.32">
    <rect x="212" y="260" width="88" height="88" rx="20"/>
    <rect x="260" y="356" width="88" height="88" rx="20"/>
  </g>
  <rect x="164" y="164" width="88" height="88" rx="20" fill="#F59E0B"/>
  <rect x="212" y="68" width="88" height="88" rx="20" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="256" y="112" dominant-baseline="central" font-size="36" fill="#1E1B39">24</text>
    <text x="208" y="190" dominant-baseline="central" font-size="19" fill="#7C4A03" text-decoration="line-through">÷</text>
    <text x="208" y="230" dominant-baseline="central" font-size="38" fill="#1E1B39">2</text>
    <text x="256" y="286" dominant-baseline="central" font-size="19" fill="#F59E0B">×</text>
    <text x="256" y="326" dominant-baseline="central" font-size="38" fill="#F59E0B">9</text>
    <text x="304" y="382" dominant-baseline="central" font-size="19" fill="#F59E0B">+</text>
    <text x="304" y="422" dominant-baseline="central" font-size="38" fill="#F59E0B">6</text>
  </g>
</symbol>


`;

/* ───────── 6 个游戏 + 详情（与 home.ts GAMES 对齐，封面用 SVG symbol id） ───────── */
interface HomeCard {
  href: string;
  cvId: string;
  /** 英文兜底名（i18n 未就绪时显示） */
  name: string;
  /** 游戏名 i18n 键 */
  nameKey: string;
  /** 标签：label 为英文兜底，key 为 i18n 键 */
  tags: { label: string; key: string }[];
  /** false 时渲染为灰态 "Polishing" 卡片（prod 上 beta 游戏） */
  live: boolean;
}
const TAG_SOLO = { label: 'Solo', key: 'math_home.tag_solo' };
const TAG_1V1 = { label: '1v1', key: 'math_home.tag_1v1' };
const TAG_DAILY = { label: 'Daily', key: 'math_home.tag_daily' };
const TAG_BEGINNER = { label: 'Beginner', key: 'math_home.tag_beginner' };
const TAG_MID = { label: 'Mid logic', key: 'math_home.tag_mid' };
const HOME_CARDS: HomeCard[] = [
  { href: '/games/24-game/lobby/',          cvId: 'cv-24',     name: '24 Game',          nameKey: 'nav.game_24',          tags: [TAG_SOLO, TAG_1V1, TAG_DAILY], live: true },
  { href: '/games/sudoku-4x4/lobby/',       cvId: 'cv-s4',     name: 'Sudoku 4×4',       nameKey: 'math_home.g_s4',       tags: [TAG_SOLO, TAG_BEGINNER],      live: true },
  { href: '/games/sudoku/lobby/',           cvId: 'cv-sudoku', name: 'Sudoku 9×9',       nameKey: 'math_home.g_s9',       tags: [TAG_SOLO, TAG_DAILY],         live: true },
  { href: '/games/sudoku-6x6/lobby/',       cvId: 'cv-s6',     name: 'Sudoku 6×6',       nameKey: 'math_home.g_s6',       tags: [TAG_SOLO, TAG_MID],           live: true },
  { href: '/games/equation-pyramid/lobby/', cvId: 'cv-pyr',    name: 'Equation Pyramid', nameKey: 'math_home.g_pyr',      tags: [TAG_SOLO, TAG_DAILY],         live: true },
];

/** 在 beta 环境里，beta 游戏也视为 live（无灰态） */
function effectiveLive(c: HomeCard): boolean {
  return SHOW_BETA ? true : c.live;
}

function cardHtml(c: HomeCard): string {
  const live = effectiveLive(c);
  const tagsHtml = c.tags.map(t => `<i data-i18n="${t.key}">${t.label}</i>`).join('');
  if (live) {
    return `<a class="gcard" href="${c.href}" data-live="1">
      <span class="gcard-art"><svg role="img" aria-label="${c.name}"><use href="#${c.cvId}"/></svg></span>
      <span class="gcard-body">
        <span class="gcard-name" data-i18n="${c.nameKey}">${c.name}</span>
        <span class="gcard-tags">${tagsHtml}</span>
      </span>
    </a>`;
  }
  return `<a class="gcard soon" href="${c.href}" data-live="0" aria-label="${c.name} (polishing, available in beta)" data-i18n-aria-label="math_home.card_polishing_aria" data-i18n-vars='{"name":"${c.name}"}'>
      <span class="gcard-soon-pill" data-i18n="math_home.pill_polishing">POLISHING</span>
      <span class="gcard-art"><svg role="img" aria-label="${c.name}"><use href="#${c.cvId}"/></svg></span>
      <span class="gcard-body">
        <span class="gcard-name" data-i18n="${c.nameKey}">${c.name}</span>
        <span class="gcard-tags">${tagsHtml}</span>
      </span>
    </a>`;
}

/* ───────── 侧栏 ───────── */
function navItem(active: boolean, href: string, svg: string, label: string, key: string): string {
  return `<a class="nav-item${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>
    ${svg}<label style="cursor:inherit" data-i18n="${key}">${label}</label>
  </a>`;
}

function miniNavItem(active: boolean, href: string, cvId: string, label: string, key: string): string {
  return `<a class="nav-item${active ? ' active' : ''}" href="${href}">
    <svg class="mini" aria-hidden="true"><use href="#${cvId}"/></svg><label style="cursor:inherit" data-i18n="${key}">${label}</label>
  </a>`;
}

function sidebarHtml(): string {
  // 当前激活：Home（首页）
  const home = navItem(true, '/',
    '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    'Home', 'nav.home');
  
  
  const gamesGroup = `
    <div class="nav-group" data-i18n="math_home.group_all_games">All games · 5</div>
    ${miniNavItem(false, '/games/24-game/lobby/',          'cv-24',     '24 Game',          'nav.game_24')}
    ${miniNavItem(false, '/games/sudoku-4x4/lobby/',       'cv-s4',     'Sudoku 4×4',       'math_home.g_s4')}
    ${miniNavItem(false, '/games/sudoku/lobby/',           'cv-sudoku', 'Sudoku 9×9',       'math_home.g_s9')}
    ${miniNavItem(false, '/games/sudoku-6x6/lobby/',       'cv-s6',     'Sudoku 6×6',       'math_home.g_s6')}
    ${miniNavItem(false, '/games/equation-pyramid/lobby/', 'cv-pyr',    'Equation Pyramid', 'math_home.g_pyr')}
  `;

  // 与各游戏页/lobby 页的静态壳保持同一份导航：
  // Home → Coin Shop（P1 实链，指向独立商店页 /shop/）→ All games · 5 → Help
  // P0 前这里是 is-disabled 灰态 + "Coming soon" pill；P0 先指向 /me/ 金币流水区，
  // P1 商店页上线后改指 /shop/（真正的消耗口：头像/表情 购买 + 激活）。
  const coinShop = `
    <a class="nav-item" href="/shop/"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><label style="cursor:inherit" data-i18n="mp.coin_shop">Coin Shop 🪙</label></a>
  `;

  const helpGroup = `
    <div class="nav-group" data-i18n="math_home.group_help">Help</div>
    ${navItem(false, '#how-to-play',
      '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>',
      'How to play', 'math_home.nav_how')}
  `;

  // 老师端入口：独立分组 + 常驻琥珀高亮，让它在靛蓝导航里自然跳出来
  const teacherGroup = `
    <div class="nav-group" data-i18n="math_home.group_teachers">For teachers</div>
    <a class="nav-item teacher" href="/teacher/">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 9L12 5 2 9l10 4 10-4z"/><path d="M6 11v5c0 1 2.7 2.5 6 2.5S18 17 18 16v-5"/></svg>
      <label style="cursor:inherit" data-i18n="math_home.nav_teacher">Teacher dashboard</label>
    </a>
  `;

  
  return `
    <div class="sb-top">
      <a class="logo" href="/">Numeri<b>Duel</b></a>
      <button class="sb-collapse" id="sbCollapse" title="Collapse sidebar" aria-label="Collapse sidebar" data-i18n-title="math_home.sb_collapse" data-i18n-aria-label="math_home.sb_collapse">«</button>
    </div>
    <div class="sb-login">
      <div id="lang-switcher"></div>
      <button class="sb-theme" title="Toggle theme" aria-label="Toggle theme" data-i18n-title="math_home.sb_theme" data-i18n-aria-label="math_home.sb_theme">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/></svg>
      </button>
    </div>
    <nav class="sb-nav" aria-label="Site navigation" data-i18n-aria-label="math_home.nav_aria">
      ${home}
      <a class="nav-item daily" href="/daily/">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1.5-.6-2.6-1.4-3.6C16 8.6 15 9.6 15 9.6 15.4 6.5 13.6 4.3 12 3z"/><path d="M8.5 13.5A4.5 4.5 0 0 0 12 21a4.5 4.5 0 0 0 3.5-7.5"/></svg>
        <label style="cursor:inherit" data-i18n="math_home.nav_daily">Daily challenge</label>
      </a>
      ${coinShop}
      ${gamesGroup}
      ${helpGroup}
      ${teacherGroup}
    </nav>
    <div class="nav-foot">
      <span class="sb-copy">© 2026</span>
    </div>
  `;
}

/* ───────── 每日挑战 + 周赛 ───────── */
function duoHtml(): string {
  // F-210: cross-game daily tracker (localStorage-driven, no longer mock)
  const dones: string[] = [];
  let doneCount = 0;
  let streak = 0;
  let badgeSummary = '';
  try {
    dones.push(...getTodaysDones());
    doneCount = dones.length;
    streak = getDailyStreak();
    const unlocked = getBadges().filter((b) => b.unlocked);
    if (unlocked.length > 0) {
      badgeSummary = unlocked.slice(0, 4).map((b) => '<span class="badge-mini" title="' + i18nT(b.nameKey) + ': ' + i18nT(b.hintKey, b.hintVars) + '">' + b.emoji + '</span>').join(' ');
    }
  } catch (e) { /* private mode */ }
  const totalShown = 4;
  const pct = Math.min(100, Math.round((doneCount / totalShown) * 100));
  const dailyGames = [
    { id: '24-game', href: '/games/24-game/?mode=daily', cvId: 'cv-24', name: '24 Game', nameKey: 'nav.game_24' },
    { id: 'sudoku', href: '/games/sudoku/?mode=daily', cvId: 'cv-sudoku', name: 'Sudoku 9×9', nameKey: 'math_home.g_s9' },
    { id: 'sudoku-6x6', href: '/games/sudoku-6x6/?mode=daily', cvId: 'cv-s6', name: 'Sudoku 6×6', nameKey: 'math_home.g_s6' },
    { id: 'equation-pyramid', href: '/games/equation-pyramid/?mode=daily', cvId: 'cv-pyr', name: 'Pyramid', nameKey: 'nav.game_equation_pyramid' },
  ];
  const tiles = dailyGames.map((g) => {
    const done = dones.includes(g.id);
    return '<a class="dtile' + (done ? ' done' : '') + '" href="' + g.href + '"><svg aria-hidden="true"><use href="#' + g.cvId + '"/></svg><span data-i18n="' + g.nameKey + '">' + g.name + '</span>' + (done ? '<span class="ok">✓</span>' : '') + '</a>';
  }).join('');
  // i18n：挑选字典键 + 占位符变量；英文串保留为 i18n 未就绪时的兜底文案
  let msgKey = 'math_home.daily_msg_none';
  let msgVars: Record<string, number> = {};
  if (doneCount === 0) {
    msgKey = 'math_home.daily_msg_none';
  } else if (doneCount < totalShown) {
    msgKey = 'math_home.daily_msg_some';
    msgVars = { done: doneCount, total: totalShown, left: totalShown - doneCount };
  } else {
    msgKey = 'math_home.daily_msg_all';
    msgVars = { total: totalShown, streak: streak };
  }
  const dailyMsgEn =
    doneCount === 0
      ? 'Try today\'s Daily — <b>same puzzle worldwide</b>. Unlock rank stars by completing 5 in a row.'
      : doneCount < totalShown
        ? '<b>' + doneCount + '</b> of ' + totalShown + ' done today — ' + (totalShown - doneCount) + ' left for rank stars.'
        : '<b>All ' + totalShown + '</b> done today — streak extended to <b>' + streak + ' day' + (streak === 1 ? '' : 's') + '</b>!';
  const dailyMsg =
    '<span data-i18n-html="' + msgKey + '" data-i18n-vars=\'' + JSON.stringify(msgVars) + '\'>' + dailyMsgEn + '</span>';
  // 右侧面板 = 金币钱包（P0 经济接线）：余额 / 今日已赚 / 签到 / 5 任务 / 领取
  // 全部走 src/shared/coins.ts 封装的已有 API，匿名态降级为「登录解锁」引导。
  // 静态骨架渲染占位结构，loadCoinsPanel() 异步填充真实数据（i18n ready 后重渲）。
  const walletPanel = `
    <div class="panel panel-coins" data-coins-panel aria-busy="true">
      <div class="panel-head">
        <span class="panel-title"><span class="cal">🪙</span> <span data-i18n="coins.panel_title">Coin wallet</span></span>
        <span class="panel-meta"><span data-i18n="coins.budget_hint">Resets at UTC midnight</span></span>
      </div>
      <div class="cw-balance" data-cw-balance>
        <span class="cw-num" data-cw-num>—</span>
        <span class="cw-lbl" data-i18n="coins.balance">Balance</span>
      </div>
      <div class="cw-budget" data-cw-budget>
        <div class="cw-budget-head">
          <span data-i18n="coins.today">Earned today</span>
          <span class="cw-budget-nums"><b data-cw-used>0</b>/<span data-cw-cap>250</span>
          <span class="cw-budget-cap-lbl" data-i18n="coins.cap">Daily cap</span></span>
        </div>
        <div class="progress"><i data-cw-bar style="width:0%"></i></div>
      </div>
      <button type="button" class="cw-checkin btn-amber" data-cw-checkin>
        <span data-i18n="coins.checkin_do">Check in</span>
      </button>
      <div class="cw-quests" data-cw-quests>
        <div class="cw-quests-head">
          <span data-i18n="coins.quests">Daily quests</span>
          <button type="button" class="cw-claim" data-cw-claim disabled>
            <span data-i18n="coins.quest_claim">Claim</span>
          </button>
        </div>
        <ul class="cw-quest-list" data-cw-quest-list></ul>
      </div>
      <p class="cw-anon" data-cw-anon hidden data-i18n="coins.wallet_anon">Sign in to sync coins across devices.</p>
      <p class="cw-offline" data-cw-offline hidden data-i18n="coins.err_offline">Coin service unreachable — your game still works.</p>
    </div>
  `;
  return `
    <div class="panel panel-daily">
      <div class="panel-head">
        <span class="panel-title"><span class="cal">◷</span> <span data-i18n="math_home.panel_daily">Daily Challenge</span></span>
        <span class="panel-meta">
          <span class="star">⭐ <b id="dDone">${doneCount}</b>/${totalShown}</span>
          <span data-i18n="math_home.streak_txt" data-i18n-vars='{"n":${streak}}'>🔥 ${streak}-day streak</span>
          ${badgeSummary ? '<span class="badges-mini">' + badgeSummary + '</span>' : ''}
        </span>
      </div>
      <div class="daily-tiles">${tiles}</div>
      <div class="progress"><i id="pbar" style="width:${pct}%"></i></div>
      <p class="daily-msg">${dailyMsg} · <span class="cd" id="cd">--:--:--</span> <span data-i18n="math_home.until_reset">until the global reset</span></p>
    </div>

    ${walletPanel}
  `;
}

/* ───────── 天梯 ───────── */
function ladderHtml(): string {
  return `
    <div class="ladder-panel">
      <div class="ladder-title"><span data-i18n="math_home.ladder_title">Six-tier ladder</span><small data-i18n="math_home.ladder_sub">One Elo across all three duel sites · weekly reset</small></div>
      <div class="tiers">
        <div class="tier"><i style="height:16px"></i><span data-i18n="math_home.tier_bronze">Bronze</span></div>
        <div class="tier"><i style="height:22px"></i><span data-i18n="math_home.tier_silver">Silver</span></div>
        <div class="tier"><i style="height:28px"></i><span data-i18n="math_home.tier_gold">Gold</span></div>
        <div class="tier"><i style="height:34px"></i><span data-i18n="math_home.tier_platinum">Platinum</span></div>
        <div class="tier"><i style="height:40px"></i><span data-i18n="math_home.tier_diamond">Diamond</span></div>
        <div class="tier master"><i style="height:48px"></i><span data-i18n="math_home.tier_master">Master</span></div>
      </div>
    </div>
  `;
}

/* ───────── 特性行 ───────── */
function featsHtml(): string {
  const F = (icon: string, title: string, desc: string, tk: string, dk: string) => `
    <div class="feat">
      <span class="fic"><svg viewBox="0 0 24 24">${icon}</svg></span>
      <div><b data-i18n="${tk}">${title}</b><span data-i18n="${dk}">${desc}</span></div>
    </div>`;
  return `
    <div class="feats-grid">
      ${F('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'Daily hunt', 'One puzzle worldwide, timed reset — race the globe.', 'math_home.feat1_t', 'math_home.feat1_d')}
      ${F('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6"/>', 'Friend duel', 'Copy an invite link — one click and you\'re in the room.', 'math_home.feat2_t', 'math_home.feat2_d')}
      ${F('<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>', 'Race · 99', 'Live standings, your row pinned on the page.', 'math_home.feat3_t', 'math_home.feat3_d')}
      ${F('<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.2 0 1.2-1.3 2.2-3 2.2-1.1 0-2-.5-2.5-1.3M12 6.5V8m0 8v1.5"/>', 'Smart hint', 'Stuck? Ask for a hint — it shows the next step, not the answer.', 'math_home.feat4_t', 'math_home.feat4_d')}
    </div>
  `;
}

/* ───────── 页脚 ───────── */
function footerHtml(): string {
  return `
    <div class="wrap">
      <div class="sf-title" data-i18n="math_home.f_family">Explore the Duel family</div>
      <div class="sf-matrix">
        <a class="sf-item" href="https://boardduel.com"><span class="pip" style="background:#2FC4C9"></span><span data-i18n="math_home.f_board">BoardDuel — Chess &amp; Card Games</span></a>
        <a class="sf-item" href="https://numeriduel.com"><span class="pip" style="background:#F59E0B"></span><span data-i18n="math_home.f_math">NumeriDuel — Math Puzzle Games</span></a>
        <a class="sf-item" href="https://memoryduel.com"><span class="pip" style="background:#4F46E5"></span><span data-i18n="math_home.f_memory">MemoryDuel — Knowledge Battles</span></a>
      </div>
      <div class="sf-links">
        <a href="/daily/" data-i18n="math_home.f_daily">Daily &amp; Ranks</a><a href="/me/" data-i18n="math_home.f_me">My Journey</a><a href="/worksheets/" data-i18n="math_home.f_worksheets">Worksheets</a><a href="/teacher/" data-i18n="math_home.f_teachers">For teachers</a><a href="/about/" data-i18n="nav.about">About</a><a href="/contact/" data-i18n="nav.contact">Contact</a><a href="/privacy/" data-i18n="nav.privacy">Privacy</a><a href="/terms/" data-i18n="nav.terms">Terms</a><a href="/" data-i18n="math_home.f_allgames">All games</a>
      </div>
      <div class="sf-copy" data-i18n="math_home.f_copy">© 2026 NumeriDuel · Paper-light · Privacy-first · Free to play</div>
    </div>
  `;
}

/* ───────── 顶部移动端顶栏 ───────── */
function topbarHtml(): string {
  // 顶栏不放 Log in 按钮：站点明确"No login, no identity"（见 Privacy / Contact 页），
  // 上线推广时该按钮是死链只会引诱访客点击成为噪音，故移除。
  return `
    <button class="burger" id="burger" aria-label="Open navigation" data-i18n-aria-label="math_home.burger_aria" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <a class="logo" href="/">Numeri<b>Duel</b></a>
    <div class="tb-lang" data-lang-switcher></div>
  `;
}

/* ───────── 主装配 ───────── */
export function renderHomeV2(): void {
  // 1. 注入 SVG symbol 库（只一次）
  if (!document.getElementById('cv-symbols')) {
    const wrap = document.createElement('div');
    wrap.id = 'cv-symbols';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    wrap.innerHTML = `<svg width="0" height="0"><defs>${CV_SYMBOLS}</defs></svg>`;
    document.body.prepend(wrap);
  }

  const root = document.getElementById('home-v2');
  if (!root) return;

  root.innerHTML = `
    <!-- 移动端顶栏 -->
    <div class="topbar">${topbarHtml()}</div>
    <div class="overlay" id="overlay"></div>

    <!-- 侧栏 -->
    <aside class="sidebar" id="sidebar">${sidebarHtml()}</aside>

    <!-- 主区 -->
    <main class="main">
      <!-- 游戏墙：6 张深靛卡 -->
      <section class="wall" aria-label="All games" data-i18n-aria-label="math_home.group_all_games_plain">
        <div class="wrap">
          <div class="wall-grid">${HOME_CARDS.map(cardHtml).join('')}</div>
        </div>
      </section>

      <!-- Hero -->
      <section class="hero">
        <div class="wrap">
          <h1 data-i18n-html="math_home.hero_h1">Make your <em>brain</em> smarter, 5 minutes a day</h1>
          <p class="sub" data-i18n-html="math_home.hero_sub">Sudoku reasoning · 24-point speed math · equation pyramids — 5 hand-picked math games,<br>same puzzle worldwide. Just tap and play.</p>
          <div class="cta-row">
            <a class="btn btn-amber" href="/games/24-game/?mode=daily" data-i18n="math_home.cta_daily">Start today's challenge</a>
            <a class="btn btn-ghost" href="/games/24-game/lobby/" data-i18n="math_home.cta_friend">Challenge a friend</a>
          </div>
          <div class="chips">
            <span class="chip"><span class="dot"></span><span data-i18n="math_home.chip_nologin">No login</span></span>
            <span class="chip"><span class="dot"></span><span data-i18n="math_home.chip_free">Free · no ads</span></span>
            <span class="chip"><span class="dot"></span><span data-i18n="math_home.chip_privacy">Privacy-first</span></span>
            <span class="chip"><span class="dot"></span><span data-i18n="math_home.chip_daily">Same puzzle daily</span></span>
          </div>
        </div>
      </section>

      <!-- 双列：每日 + 周赛 -->
      <section class="duo wrap" aria-label="Daily activities" data-i18n-aria-label="math_home.group_daily_acts">${duoHtml()}</section>

      <!-- 天梯 -->
      <section class="ladder wrap" aria-label="Rank ladder" data-i18n-aria-label="math_home.group_ladder">${ladderHtml()}</section>

      <!-- F-206 (c): Why NumeriDuel? brand story -->
      <section class="why wrap" aria-label="Why NumeriDuel" data-i18n-aria-label="math_home.why_title">
        <div class="why-card">
          <div class="why-eyebrow" data-i18n="math_home.why_eyebrow">WHY NUMERIDUEL</div>
          <h2 class="why-title" data-i18n="math_home.why_title">Math is more fun when you can prove it.</h2>
          <p class="why-lead" data-i18n-html="math_home.why_lead">
            Every game on this site ships with a <b>Daily Challenge</b> — the same puzzle for everyone, everywhere,
            at the same Shanghai date. No login, no ads, no data mining.
            Just open the page and you can play.
          </p>
          <div class="why-grid">
            <div><b data-i18n="math_home.why1_t">🔒 Privacy-first</b><span data-i18n="math_home.why1_d">Anonymous UUID stored only in your browser. Clear cookies to reset.</span></div>
            <div><b data-i18n="math_home.why2_t">🌏 Same puzzle worldwide</b><span data-i18n="math_home.why2_d">Shanghai-date seeded generation. Compare with anyone on Earth.</span></div>
            <div><b data-i18n="math_home.why3_t">🪙 No streak rewards</b><span data-i18n="math_home.why3_d">The only prize is breaking your own yesterday. No notifications, no upsell.</span></div>
            <div><b data-i18n="math_home.why4_t">⚡ Free forever</b><span data-i18n="math_home.why4_d">Static pages on Cloudflare, ~0 cost per visitor. No paywall, ever.</span></div>
          </div>
        </div>
      </section>

      <!-- 特性（"How it works" 锚点：sidebar How to play 跳这里） -->
      <section class="feats" id="how-to-play"><div class="wrap">${featsHtml()}</div></section>
    </main>

    <!-- 页脚 -->
    <footer class="main">${footerHtml()}</footer>
  `;

  // 2. 行为绑定
  initCountdown();
  // 抽屉 / 遮罩 / 侧栏收窄统一走 pages/lobby-chrome（首页壳的收窄按钮 id 是 sbCollapse，
  // 该模块两个 id 都认）。此前这里另有一份同名实现，与 lobby 页那份容易漂移。
  wireLobbyChrome();
  // 3. 金币钱包面板（P0 经济接线）：异步填充余额/签到/任务，i18n ready 后重渲
  initCoinsPanel();
}

/* ───────── 金币钱包面板（P0 经济接线） ─────────
 * 右侧 panel-coins 的异步填充：余额 / 今日已赚 / 签到 / 5 任务 / 领取。
 * 全部走 src/shared/coins.ts 封装的已有 API（不新增服务端点）。
 *
 * 渲染纪律（RULES-FE-D #88 / #90 延伸）：
 *   - 所有动态节点用 i18nT() 取值，挂 onI18nChange() 重渲（切语言时静态骨架
 *     i18n.js 管不到 JS 生成的节点，必须自己重画）
 *   - 异步 IIFE 必须把结果存出来，不能靠 return（暗色审计教训 #90 的 async IIFE 吞返回值）
 *   - 匿名态降级为「登录解锁」引导条，不报错；离线态显示 err_offline
 */
async function initCoinsPanel(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-coins-panel]');
  if (!root) return;

  root.setAttribute('aria-busy', 'true');

  // 拉余额 + 今日状态
  let me: CoinsMeData;
  try {
    me = await coinsMe();
  } catch (e) {
    if (e instanceof CoinsError && e.code === 'network') {
      showOffline(root);
      return;
    }
    // not_authenticated / 其它 → 走匿名分支
    me = { authenticated: false };
  }

  if (!me.authenticated) {
    // 匿名：余额不可见，显示「登录解锁」引导（站点无登录流，仅提示跨端同步）
    renderAnon(root);
    return;
  }

  // 登录态：填充余额 + 今日已赚 + 进度条
  renderBalance(root, me);
  await loadQuests(root);

  // 绑定签到 / 领取
  wireCheckin(root);
  wireClaim(root);

  root.setAttribute('aria-busy', 'false');
}

function showOffline(root: HTMLElement): void {
  const off = root.querySelector<HTMLElement>('[data-cw-offline]');
  if (off) off.hidden = false;
  // 隐藏余额 / 任务区，避免占位骨架误导
  for (const sel of ['[data-cw-balance]', '[data-cw-budget]', '[data-cw-checkin]', '[data-cw-quests]']) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.hidden = true;
  }
}

function renderAnon(root: HTMLElement): void {
  const anon = root.querySelector<HTMLElement>('[data-cw-anon]');
  if (anon) anon.hidden = false;
  for (const sel of ['[data-cw-balance]', '[data-cw-budget]', '[data-cw-checkin]', '[data-cw-quests]']) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.hidden = true;
  }
}

function renderBalance(root: HTMLElement, me: CoinsMeData): void {
  const num = root.querySelector<HTMLElement>('[data-cw-num]');
  if (num) num.textContent = String(me.coins ?? 0);
  const used = root.querySelector<HTMLElement>('[data-cw-used]');
  if (used) used.textContent = String(me.daily_budget?.used ?? me.daily?.earned_today ?? 0);
  const cap = root.querySelector<HTMLElement>('[data-cw-cap]');
  if (cap) cap.textContent = String(me.daily_budget?.cap ?? 250);
  const bar = root.querySelector<HTMLElement>('[data-cw-bar]');
  const capN = me.daily_budget?.cap ?? 250;
  const usedN = me.daily_budget?.used ?? me.daily?.earned_today ?? 0;
  if (bar) bar.style.width = `${Math.min(100, Math.round((usedN / Math.max(1, capN)) * 100))}%`;
}

async function loadQuests(root: HTMLElement): Promise<void> {
  let quests: CoinsQuest[];
  try {
    quests = (await getQuests()).quests;
  } catch (e) {
    if (e instanceof CoinsError && e.code === 'not_authenticated') {
      renderAnon(root);
      return;
    }
    // 任务拉取失败（网络）不阻塞余额展示，只隐藏任务区
    const list = root.querySelector<HTMLElement>('[data-cw-quest-list]');
    if (list) list.innerHTML = '';
    return;
  }

  const list = root.querySelector<HTMLElement>('[data-cw-quest-list]');
  if (!list) return;
  list.textContent = '';

  const claimable = quests.filter((x) => x.can_claim);
  for (const quest of quests) {
    const li = document.createElement('li');
    li.className = 'cw-qi' + (quest.claimed ? ' claimed' : quest.completed ? ' ready' : '');
    li.dataset.questId = quest.id;
    const titleKey = QUEST_KEY_MAP[quest.id];
    const title = titleKey ? i18nT(titleKey) : i18nT(`coins.quest_${quest.id}`);
    const state = quest.claimed
      ? i18nT('coins.quest_claimed')
      : quest.completed
        ? i18nT('coins.quest_done')
        : i18nT('coins.quest_todo');
    li.innerHTML =
      `<span class="cw-qi-t">${escHtml(title)}</span>` +
      `<span class="cw-qi-r">+${quest.reward}</span>` +
      `<span class="cw-qi-s">${escHtml(state)}</span>`;
    list.appendChild(li);
  }

  // 领取按钮：有可领任务才激活
  const claimBtn = root.querySelector<HTMLButtonElement>('[data-cw-claim]');
  if (claimBtn) {
    claimBtn.disabled = claimable.length === 0;
    if (claimable.length > 0) {
      claimBtn.dataset.reward = String(claimable.reduce((s, x) => s + x.reward, 0));
    }
  }
}

function wireCheckin(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-cw-checkin]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await checkin();
      playSfx('win');
      // 本地即时刷新余额区（服务端 total_coins 为真相源）
      const num = root.querySelector<HTMLElement>('[data-cw-num]');
      if (num) num.textContent = String(r.total_coins);
      toast(i18nT('coins.toast_checkin', { n: r.earned }));
      // 签到后任务 checkin 项会变为可完成 → 重拉任务
      await loadQuests(root);
    } catch (e) {
      if (e instanceof CoinsError && e.code === 'already_checked_in') {
        // 已签到：按钮切到「今日已签」态
        const lbl = btn.querySelector<HTMLElement>('[data-i18n]') || btn;
        lbl.textContent = i18nT('coins.checkin_done');
        btn.classList.add('done');
        return;
      }
      if (e instanceof CoinsError && e.code === 'network') {
        toast(i18nT('coins.err_offline'));
        btn.disabled = false;
        return;
      }
      // not_authenticated 等 → 降级匿名
      renderAnon(root);
      return;
    }
  });
}

function wireClaim(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-cw-claim]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const list = root.querySelector<HTMLElement>('[data-cw-quest-list]');
    if (!list) return;
    const ids = Array.from(list.querySelectorAll<HTMLElement>('li.ready'))
      .map((li) => li.dataset.questId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) return;
    btn.disabled = true;
    try {
      const r = await claimQuests(ids);
      playSfx('win');
      toast(i18nT('coins.toast_quest', { n: r.coins_earned }));
      // 领取后余额增加 → 刷新余额 + 重拉任务（claimed 态更新）
      const num = root.querySelector<HTMLElement>('[data-cw-num]');
      if (num) num.textContent = String(r.total_coins);
      await loadQuests(root);
    } catch (e) {
      if (e instanceof CoinsError && e.code === 'network') {
        toast(i18nT('coins.err_offline'));
        btn.disabled = false;
      } else if (e instanceof CoinsError && e.code === 'not_authenticated') {
        renderAnon(root);
      }
    }
  });
}

/* 轻量 toast：复用页面已有的提示节奏（无则降级为状态行） */
function toast(msg: string): void {
  let box = document.querySelector<HTMLElement>('[data-cw-toast]');
  if (!box) {
    box = document.createElement('div');
    box.dataset.cwToast = '';
    box.className = 'cw-toast';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.hidden = false;
  window.clearTimeout((box as unknown as { _t?: number })._t);
  (box as unknown as { _t?: number })._t = window.setTimeout(() => { box!.hidden = true; }, 2600);
}

/* 每日倒计时（到下一个 UTC 零点，与服务端 daily 一致） */
function initCountdown(): void {
  const el = document.getElementById('cd');
  if (!el) return;
  const target = el;
  function tick(): void {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    target.textContent = `${h}:${m}:${sec}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* 让 GameDef 与旧 home.ts 兼容导出，避免 lint 失败 */
export type { GameDef };
