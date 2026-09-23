/**
 * MathDuel 主页 · papergames 浅色版（Homepage Redesign v2, 2026-09-23）
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
  <rect width="512" height="512" fill="#4F46E5"/>
  <g fill="#FFFFFF">
    <rect x="56" y="126" width="118" height="118" rx="27"/>
    <rect x="197" y="126" width="118" height="118" rx="27"/>
    <rect x="338" y="126" width="118" height="118" rx="27"/>
    <rect x="56" y="267" width="118" height="118" rx="27"/>
    <rect x="197" y="267" width="118" height="118" rx="27"/>
  </g>
  <rect x="338" y="267" width="118" height="118" rx="27" fill="#22C55E"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="115" y="185" dominant-baseline="central" font-size="62" fill="#4F46E5">1</text>
    <text x="256" y="185" dominant-baseline="central" font-size="62" fill="#4F46E5">2</text>
    <text x="397" y="185" dominant-baseline="central" font-size="62" fill="#4F46E5">3</text>
    <text x="115" y="326" dominant-baseline="central" font-size="62" fill="#4F46E5">4</text>
    <text x="256" y="326" dominant-baseline="central" font-size="62" fill="#4F46E5">5</text>
    <text x="397" y="326" dominant-baseline="central" font-size="62" fill="#FFFFFF">6</text>
  </g>
</symbol>

<symbol id="cv-killer" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#312E81"/>
  <g fill="#FFFFFF">
    <rect x="56" y="56" width="118" height="118" rx="27"/>
    <rect x="197" y="56" width="118" height="118" rx="27"/>
    <rect x="338" y="56" width="118" height="118" rx="27"/>
    <rect x="56" y="197" width="118" height="118" rx="27"/>
    <rect x="197" y="197" width="118" height="118" rx="27"/>
    <rect x="338" y="197" width="118" height="118" rx="27"/>
    <rect x="56" y="338" width="118" height="118" rx="27"/>
  </g>
  <rect x="197" y="338" width="259" height="118" rx="27" fill="#DC2626"/>
  <rect x="197" y="338" width="259" height="118" rx="27" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-dasharray="16 13"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800">
    <g text-anchor="middle">
      <text x="115" y="115" dominant-baseline="central" font-size="62" fill="#312E81">5</text>
      <text x="397" y="115" dominant-baseline="central" font-size="62" fill="#312E81">6</text>
      <text x="256" y="256" dominant-baseline="central" font-size="62" fill="#312E81">3</text>
      <text x="115" y="397" dominant-baseline="central" font-size="62" fill="#312E81">2</text>
    </g>
    <text x="219" y="366" text-anchor="start" dominant-baseline="central" font-size="54" fill="#FFFFFF">17</text>
  </g>
</symbol>

<symbol id="cv-pyr" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <rect x="214" y="48" width="84" height="84" rx="19" fill="#F59E0B"/>
  <g fill="#FFFFFF" fill-opacity="0.16">
    <rect x="98" y="148" width="96" height="96" rx="22"/>
    <rect x="208" y="148" width="96" height="96" rx="22"/>
    <rect x="318" y="148" width="96" height="96" rx="22"/>
    <rect x="98" y="258" width="96" height="96" rx="22"/>
    <rect x="318" y="258" width="96" height="96" rx="22"/>
    <rect x="98" y="368" width="96" height="96" rx="22"/>
    <rect x="208" y="368" width="96" height="96" rx="22"/>
    <rect x="318" y="368" width="96" height="96" rx="22"/>
  </g>
  <g fill="#FFFFFF">
    <rect x="98" y="258" width="96" height="96" rx="22"/>
    <rect x="208" y="258" width="96" height="96" rx="22"/>
    <rect x="318" y="258" width="96" height="96" rx="22"/>
  </g>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="256" y="90" dominant-baseline="central" font-size="40" fill="#1E1B39">20</text>
    <text x="146" y="306" dominant-baseline="central" font-size="48" fill="#3730A3">4</text>
    <text x="256" y="306" dominant-baseline="central" font-size="48" fill="#3730A3">×</text>
    <text x="366" y="306" dominant-baseline="central" font-size="48" fill="#3730A3">5</text>
  </g>
</symbol>

<symbol id="cv-bulls" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1D4ED8"/>
  <rect x="56" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="56" y="272" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="272" width="184" height="184" rx="42" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="148" y="148" dominant-baseline="central" font-size="110" fill="#1D4ED8">1</text>
    <text x="364" y="148" dominant-baseline="central" font-size="110" fill="#1D4ED8">2</text>
    <text x="148" y="366" dominant-baseline="central" font-size="110" fill="#1D4ED8">A</text>
    <text x="364" y="366" dominant-baseline="central" font-size="110" fill="#1E1B39">B</text>
  </g>
</symbol>
`;

/* ───────── 6 个游戏 + 详情（与 home.ts GAMES 对齐，封面用 SVG symbol id） ───────── */
interface HomeCard {
  href: string;
  cvId: string;
  name: string;
  tags: string[];
  /** false 时渲染为灰态 "Polishing" 卡片（prod 上 beta 游戏） */
  live: boolean;
}
const HOME_CARDS: HomeCard[] = [
  { href: '/games/24-game/',          cvId: 'cv-24',     name: '24 Game',              tags: ['Solo', '1v1', 'Daily'], live: true  },
  { href: '/games/sudoku/',           cvId: 'cv-sudoku', name: 'Sudoku 9×9',           tags: ['Solo', 'Daily'],        live: false },
  { href: '/games/sudoku-6x6/',       cvId: 'cv-s6',     name: 'Sudoku 6×6',           tags: ['Solo', 'Beginner'],     live: false },
  { href: '/games/killer-sudoku/',    cvId: 'cv-killer', name: 'Killer Sudoku',        tags: ['Solo', 'Advanced'],     live: false },
  { href: '/games/equation-pyramid/', cvId: 'cv-pyr',    name: 'Equation Pyramid',     tags: ['Solo', 'Daily'],        live: false },
  { href: '/games/bulls/',            cvId: 'cv-bulls',  name: 'Number Guess 1A2B',    tags: ['1v1', 'PvP'],           live: false },
];

/** 在 beta 环境里，beta 游戏也视为 live（无灰态） */
function effectiveLive(c: HomeCard): boolean {
  return SHOW_BETA ? true : c.live;
}

function cardHtml(c: HomeCard): string {
  const live = effectiveLive(c);
  const tagsHtml = c.tags.map(t => `<i>${t}</i>`).join('');
  if (live) {
    return `<a class="gcard" href="${c.href}" data-live="1">
      <span class="gcard-art"><svg role="img" aria-label="${c.name}"><use href="#${c.cvId}"/></svg></span>
      <span class="gcard-body">
        <span class="gcard-name">${c.name}</span>
        <span class="gcard-tags">${tagsHtml}</span>
      </span>
    </a>`;
  }
  return `<a class="gcard soon" href="${c.href}" data-live="0" aria-label="${c.name} (polishing, available in beta)">
      <span class="gcard-soon-pill">POLISHING</span>
      <span class="gcard-art"><svg role="img" aria-label="${c.name}"><use href="#${c.cvId}"/></svg></span>
      <span class="gcard-body">
        <span class="gcard-name">${c.name}</span>
        <span class="gcard-tags">${tagsHtml}</span>
      </span>
    </a>`;
}

/* ───────── 侧栏 ───────── */
function navItem(active: boolean, href: string, svg: string, label: string): string {
  return `<a class="nav-item${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>
    ${svg}<label style="cursor:inherit">${label}</label>
  </a>`;
}

function miniNavItem(active: boolean, href: string, cvId: string, label: string): string {
  return `<a class="nav-item${active ? ' active' : ''}" href="${href}">
    <svg class="mini" aria-hidden="true"><use href="#${cvId}"/></svg><label style="cursor:inherit">${label}</label>
  </a>`;
}

function sidebarHtml(): string {
  // 当前激活：Home（首页）
  const home = navItem(true, '/',
    '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    'Home');
  const leaderboard = navItem(false, '/leaderboard/',
    '<svg viewBox="0 0 24 24"><path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>',
    'Leaderboard');
  const shop = navItem(false, '/shop/',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/></svg>',
    'Coin Shop 🪙');

  const duelGroup = `
    <div class="nav-group">Duel</div>
    ${navItem(false, '/rooms/', '<svg viewBox="0 0 24 24"><path d="M16 11a4 4 0 1 0-8 0"/><circle cx="12" cy="6" r="2.5"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>', 'Friend rooms')}
    ${navItem(false, '/tournaments/new/', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></svg>', 'Create tournament')}
    ${navItem(false, '/tournaments/', '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5"/><path d="M9.5 13.5L8 21l4-2 4 2-1.5-7.5"/></svg>', 'My tournaments')}
  `;

  const gamesGroup = `
    <div class="nav-group">All games · 6</div>
    ${miniNavItem(false, '/games/24-game/',          'cv-24',     '24 Game')}
    ${miniNavItem(false, '/games/sudoku/',           'cv-sudoku', 'Sudoku 9×9')}
    ${miniNavItem(false, '/games/sudoku-6x6/',       'cv-s6',     'Sudoku 6×6')}
    ${miniNavItem(false, '/games/killer-sudoku/',    'cv-killer', 'Killer Sudoku')}
    ${miniNavItem(false, '/games/equation-pyramid/', 'cv-pyr',    'Equation Pyramid')}
    ${miniNavItem(false, '/games/bulls/',            'cv-bulls',  'Number Guess 1A2B')}
  `;

  const helpGroup = `
    <div class="nav-group">Help</div>
    ${navItem(false, '/how-to-play/', '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>', 'How to play')}
  `;

  return `
    <div class="sb-top">
      <a class="logo" href="/">Math<b>Duel</b></a>
      <button class="sb-collapse" id="sbCollapse" title="Collapse sidebar" aria-label="Collapse sidebar">«</button>
    </div>
    <div class="sb-login">
      <a class="btn-login" href="#"><span>Log in / Sign up</span></a>
      <button class="sb-theme" title="Toggle theme" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/></svg>
      </button>
    </div>
    <nav class="sb-nav" aria-label="Site navigation">
      ${home}
      ${leaderboard}
      ${shop}
      ${duelGroup}
      ${gamesGroup}
      ${helpGroup}
    </nav>
    <div class="nav-foot">
      <span class="lang-pill"><b>EN</b> · 中文 · 日</span>
      <span class="sb-copy">© 2026</span>
    </div>
  `;
}

/* ───────── 每日挑战 + 周赛 ───────── */
function duoHtml(): string {
  return `
    <div class="panel panel-daily">
      <div class="panel-head">
        <span class="panel-title"><span class="cal">◷</span> Daily Challenge</span>
        <span class="panel-meta"><span class="star">⭐ <b>1</b>/4</span><span>🔥 3-day streak</span></span>
      </div>
      <div class="daily-tiles">
        <a class="dtile done" href="/games/24-game/?daily=1"><svg aria-hidden="true"><use href="#cv-24"/></svg>24 Game<span class="ok">✓</span></a>
        <a class="dtile" href="/games/equation-pyramid/?daily=1"><svg aria-hidden="true"><use href="#cv-pyr"/></svg>Pyramid</a>
        <a class="dtile" href="/games/sudoku/?daily=1"><svg aria-hidden="true"><use href="#cv-sudoku"/></svg>Sudoku 9×9</a>
        <a class="dtile" href="/games/sudoku-6x6/?daily=1"><svg aria-hidden="true"><use href="#cv-s6"/></svg>Sudoku 6×6</a>
      </div>
      <div class="progress"><i id="pbar" style="width:25%"></i></div>
      <p class="daily-msg">1 of 4 done today — keep going for rank stars · <span class="cd" id="cd">--:--:--</span> until the global reset</p>
    </div>

    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">🏆 Weekly Tournament <small style="font-size:.78rem;color:var(--mute);font-weight:600">W38</small></span>
        <span class="panel-meta"><span style="background:#EEF0FB;color:var(--indigo);border-radius:99px;padding:2px 10px;font-weight:700;font-size:.74rem">Live</span></span>
      </div>
      <p class="daily-msg" style="margin:-6px 0 10px">Sep 21 → Sep 27 · 128 players · prizes 🥇50🪙 🥈25🪙 🥉10🪙</p>
      <div class="weekly-rows">
        <div class="wrow"><span class="rk">1</span><span class="nm">Mira</span><span class="pt num">3120</span></div>
        <div class="wrow"><span class="rk">2</span><span class="nm">Ken</span><span class="pt num">2840</span></div>
        <div class="wrow"><span class="rk">3</span><span class="nm">Ade</span><span class="pt num">2610</span></div>
        <div class="wrow me"><span class="rk">57</span><span class="nm">You</span><span class="pt num">890</span></div>
      </div>
      <button class="btn-exchange" type="button">🪙 Exchange coins for ad-free</button>
    </div>
  `;
}

/* ───────── 天梯 ───────── */
function ladderHtml(): string {
  return `
    <div class="ladder-panel">
      <div class="ladder-title">Six-tier ladder<small>One Elo across all three duel sites · weekly reset</small></div>
      <div class="tiers">
        <div class="tier"><i style="height:16px"></i><span>Bronze</span></div>
        <div class="tier"><i style="height:22px"></i><span>Silver</span></div>
        <div class="tier"><i style="height:28px"></i><span>Gold</span></div>
        <div class="tier"><i style="height:34px"></i><span>Platinum</span></div>
        <div class="tier"><i style="height:40px"></i><span>Diamond</span></div>
        <div class="tier master"><i style="height:48px"></i><span>Master</span></div>
      </div>
    </div>
  `;
}

/* ───────── 特性行 ───────── */
function featsHtml(): string {
  const F = (icon: string, title: string, desc: string) => `
    <div class="feat">
      <span class="fic"><svg viewBox="0 0 24 24">${icon}</svg></span>
      <div><b>${title}</b><span>${desc}</span></div>
    </div>`;
  return `
    <div class="feats-grid">
      ${F('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'Daily hunt', 'One puzzle worldwide, timed reset — race the globe.')}
      ${F('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6"/>', 'Friend duel', 'Copy an invite link — one click and you\'re in the room.')}
      ${F('<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>', 'Race · 99', 'Live standings, your row pinned on the page.')}
      ${F('<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.2 0 1.2-1.3 2.2-3 2.2-1.1 0-2-.5-2.5-1.3M12 6.5V8m0 8v1.5"/>', 'Coin shop', 'Earn coins as you play, swap for avatars and emojis.')}
    </div>
  `;
}

/* ───────── 页脚 ───────── */
function footerHtml(): string {
  return `
    <div class="wrap">
      <div class="sf-title">Explore the Duel family</div>
      <div class="sf-matrix">
        <a class="sf-item" href="https://boardduel.com"><span class="pip" style="background:#2FC4C9"></span>BoardDuel · Chess & Card Games</a>
        <a class="sf-item" href="https://mathduel.games"><span class="pip" style="background:#F59E0B"></span>MathDuel · Math Puzzle Games</a>
        <a class="sf-item" href="https://memoryduel.com"><span class="pip" style="background:#4F46E5"></span>MemoryDuel · Knowledge Battles</a>
      </div>
      <div class="sf-links">
        <a href="/about/">About</a><a href="/contact/">Contact</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/how-to-play/">How to play</a>
      </div>
      <div class="sf-copy">© 2026 MathDuel · Pure static · Privacy-first · Free to play</div>
    </div>
  `;
}

/* ───────── 顶部移动端顶栏 ───────── */
function topbarHtml(): string {
  return `
    <button class="burger" id="burger" aria-label="Open navigation" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <a class="logo" href="/">Math<b>Duel</b></a>
    <a class="btn-login" href="#" style="flex:none;padding:8px 18px">Log in / Sign up</a>
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
      <section class="wall" aria-label="All games">
        <div class="wrap">
          <div class="wall-grid">${HOME_CARDS.map(cardHtml).join('')}</div>
        </div>
      </section>

      <!-- Hero -->
      <section class="hero">
        <div class="wrap">
          <h1>Make your <em>brain</em> smarter, 5 minutes a day</h1>
          <p class="sub">Sudoku reasoning · 24-point speed math · equation climbs · code-breaking — six hand-picked math games,<br>same puzzle worldwide. Just tap and play.</p>
          <div class="cta-row">
            <a class="btn btn-amber" href="/games/24-game/?daily=1">Start today's challenge</a>
            <a class="btn btn-ghost" href="/games/24-game/lobby/">Challenge a friend</a>
          </div>
          <div class="chips">
            <span class="chip"><span class="dot"></span>No login</span>
            <span class="chip"><span class="dot"></span>Free · no ads</span>
            <span class="chip"><span class="dot"></span>Privacy-first</span>
            <span class="chip"><span class="dot"></span>Same puzzle daily</span>
          </div>
        </div>
      </section>

      <!-- 双列：每日 + 周赛 -->
      <section class="duo wrap" aria-label="Daily activities">${duoHtml()}</section>

      <!-- 天梯 -->
      <section class="ladder wrap" aria-label="Rank ladder">${ladderHtml()}</section>

      <!-- 特性 -->
      <section class="feats"><div class="wrap">${featsHtml()}</div></section>
    </main>

    <!-- 页脚 -->
    <footer class="main">${footerHtml()}</footer>
  `;

  // 2. 行为绑定
  initCountdown();
  initSidebarToggle();
  initBurgerDrawer();
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

/* 桌面侧栏收窄 */
function initSidebarToggle(): void {
  const c = document.getElementById('sbCollapse');
  if (!c) return;
  c.addEventListener('click', () => {
    document.body.classList.toggle('rail');
  });
}

/* 移动端 burger 抽屉 */
function initBurgerDrawer(): void {
  const burger = document.getElementById('burger');
  const overlay = document.getElementById('overlay');
  if (!burger || !overlay) return;
  const close = (): void => {
    document.body.classList.remove('nav-open');
    burger.setAttribute('aria-expanded', 'false');
  };
  burger.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  });
}

/* 让 GameDef 与旧 home.ts 兼容导出，避免 lint 失败 */
export type { GameDef };
