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
import { wireLobbyChrome } from './lobby-chrome';
import { getTodaysDones, getDailyStreak, getBadges } from '../games/cross-game';

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

<symbol id="cv-killer" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <g fill="#FFFFFF">
    <rect x="56" y="56" width="118" height="118" rx="27"/>
    <rect x="197" y="56" width="118" height="118" rx="27"/>
    <rect x="338" y="56" width="118" height="118" rx="27"/>
    <rect x="56" y="197" width="118" height="118" rx="27"/>
    <rect x="197" y="197" width="118" height="118" rx="27"/>
    <rect x="338" y="197" width="118" height="118" rx="27"/>
    <rect x="56" y="338" width="118" height="118" rx="27"/>
  </g>
  <rect x="197" y="338" width="259" height="118" rx="27" fill="#F59E0B"/>
  <rect x="197" y="338" width="259" height="118" rx="27" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-dasharray="16 13"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800">
    <g text-anchor="middle">
      <text x="115" y="115" dominant-baseline="central" font-size="62" fill="#3730A3">5</text>
      <text x="397" y="115" dominant-baseline="central" font-size="62" fill="#3730A3">6</text>
      <text x="256" y="256" dominant-baseline="central" font-size="62" fill="#3730A3">3</text>
      <text x="115" y="397" dominant-baseline="central" font-size="62" fill="#3730A3">2</text>
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
  <rect width="512" height="512" fill="#3730A3"/>
  <rect x="56" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="56" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="56" y="272" width="184" height="184" rx="42" fill="#FFFFFF"/>
  <rect x="272" y="272" width="184" height="184" rx="42" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="148" y="148" dominant-baseline="central" font-size="110" fill="#3730A3">1</text>
    <text x="364" y="148" dominant-baseline="central" font-size="110" fill="#3730A3">2</text>
    <text x="148" y="366" dominant-baseline="central" font-size="110" fill="#3730A3">A</text>
    <text x="364" y="366" dominant-baseline="central" font-size="110" fill="#1E1B39">B</text>
  </g>
</symbol>

<symbol id="cv-numPyr" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#3730A3"/>
  <!-- 5-row pyramid: row 1 has 1 cell, row 5 has 5 cells. We only render visible numbers and a hole. -->
  <g fill="#FFFFFF">
    <!-- Row 1 -->
    <rect x="222" y="40"  width="68" height="68" rx="15"/>
    <!-- Row 2 -->
    <rect x="150" y="128" width="68" height="68" rx="15"/>
    <rect x="294" y="128" width="68" height="68" rx="15"/>
    <!-- Row 3 -->
    <rect x="78"  y="216" width="68" height="68" rx="15"/>
    <rect x="222" y="216" width="68" height="68" rx="15"/>
    <rect x="366" y="216" width="68" height="68" rx="15"/>
    <!-- Row 4 -->
    <rect x="42"  y="304" width="68" height="68" rx="15"/>
    <rect x="150" y="304" width="68" height="68" rx="15"/>
    <rect x="294" y="304" width="68" height="68" rx="15"/>
    <rect x="402" y="304" width="68" height="68" rx="15"/>
    <!-- Row 5 -->
    <rect x="6"   y="392" width="68" height="68" rx="15"/>
    <rect x="114" y="392" width="68" height="68" rx="15"/>
    <rect x="222" y="392" width="68" height="68" rx="15"/>
    <rect x="330" y="392" width="68" height="68" rx="15"/>
    <rect x="438" y="392" width="68" height="68" rx="15"/>
  </g>
  <!-- Hole (question) at row 3 center cell -->
  <rect x="222" y="216" width="68" height="68" rx="15" fill="#F59E0B"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle">
    <text x="256" y="78"  dominant-baseline="central" font-size="44" fill="#3730A3">7</text>
    <text x="184" y="166" dominant-baseline="central" font-size="40" fill="#3730A3">3</text>
    <text x="328" y="166" dominant-baseline="central" font-size="40" fill="#3730A3">4</text>
    <text x="112" y="254" dominant-baseline="central" font-size="36" fill="#3730A3">2</text>
    <text x="256" y="254" dominant-baseline="central" font-size="48" fill="#1E1B39">?</text>
    <text x="400" y="254" dominant-baseline="central" font-size="36" fill="#3730A3">6</text>
    <text x="76"  y="342" dominant-baseline="central" font-size="32" fill="#3730A3">1</text>
    <text x="184" y="342" dominant-baseline="central" font-size="32" fill="#3730A3">5</text>
    <text x="328" y="342" dominant-baseline="central" font-size="32" fill="#3730A3">8</text>
    <text x="436" y="342" dominant-baseline="central" font-size="32" fill="#3730A3">2</text>
    <text x="40"  y="430" dominant-baseline="central" font-size="28" fill="#3730A3">3</text>
    <text x="148" y="430" dominant-baseline="central" font-size="28" fill="#3730A3">6</text>
    <text x="256" y="430" dominant-baseline="central" font-size="28" fill="#3730A3">9</text>
    <text x="364" y="430" dominant-baseline="central" font-size="28" fill="#3730A3">4</text>
    <text x="472" y="430" dominant-baseline="central" font-size="28" fill="#3730A3">7</text>
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
  { href: '/games/24-game/lobby/',        cvId: 'cv-24',     name: '24 Game',           tags: ['Solo', '1v1', 'Daily'], live: true },
  { href: '/games/sudoku/lobby/',         cvId: 'cv-sudoku', name: 'Sudoku 9×9',        tags: ['Solo', 'Daily'],        live: true },
  { href: '/games/sudoku-6x6/lobby/',     cvId: 'cv-s6',     name: 'Sudoku 6×6',        tags: ['Solo', 'Beginner'],     live: true },
  { href: '/games/killer-sudoku/lobby/',  cvId: 'cv-killer', name: 'Killer Sudoku',     tags: ['Solo', 'Advanced'],     live: true },
  { href: '/games/equation-pyramid/lobby/', cvId: 'cv-pyr',  name: 'Equation Pyramid',  tags: ['Solo', 'Daily'],        live: true },
  { href: '/games/bulls/lobby/',          cvId: 'cv-bulls',  name: 'Number Guess 1A2B', tags: ['Solo', 'Logic'],         live: true },
  { href: '/games/number-pyramid/lobby/', cvId: 'cv-numPyr', name: 'Number Pyramid',    tags: ['Solo', 'Daily'],        live: true },
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
  
  
  const gamesGroup = `
    <div class="nav-group">All games · 7</div>
    ${miniNavItem(false, '/games/24-game/lobby/',        'cv-24',     '24 Game')}
    ${miniNavItem(false, '/games/sudoku/lobby/',         'cv-sudoku', 'Sudoku 9×9')}
    ${miniNavItem(false, '/games/sudoku-6x6/lobby/',     'cv-s6',     'Sudoku 6×6')}
    ${miniNavItem(false, '/games/killer-sudoku/lobby/',  'cv-killer', 'Killer Sudoku')}
    ${miniNavItem(false, '/games/number-pyramid/lobby/', 'cv-numPyr','Number Pyramid')}
    ${miniNavItem(false, '/games/equation-pyramid/lobby/', 'cv-pyr',  'Equation Pyramid')}
    ${miniNavItem(false, '/games/bulls/lobby/',          'cv-bulls',  'Number Guess 1A2B')}
  `;

  // 与各游戏页/lobby 页的静态壳保持同一份导航：
  // Home → Coin Shop（未上线灰态）→ All games · 7 → Help
  const coinShop = `
    <span class="nav-item is-disabled" aria-disabled="true" style="opacity:.5;cursor:default" title="Coming soon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><label style="cursor:inherit">Coin Shop<span class="pill-soon">soon</span></label></span>
  `;

  const helpGroup = `
    <div class="nav-group">Help</div>
    ${navItem(false, '#',
      '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>',
      'How to play')}
  `;

  
  return `
    <div class="sb-top">
      <a class="logo" href="/">Math<b>Duel</b></a>
      <button class="sb-collapse" id="sbCollapse" title="Collapse sidebar" aria-label="Collapse sidebar">«</button>
    </div>
    <div class="sb-login">
      <span class="btn-login" style="opacity:.55;cursor:default" title="Accounts are not enabled yet"><span>EN</span></span>
      <button class="sb-theme" title="Toggle theme" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/></svg>
      </button>
    </div>
    <nav class="sb-nav" aria-label="Site navigation">
      ${home}
      ${coinShop}
      ${gamesGroup}
      ${helpGroup}
    </nav>
    <div class="nav-foot">
      <span class="lang-pill" title="More languages coming soon"><b>EN</b></span>
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
      badgeSummary = unlocked.slice(0, 4).map((b) => '<span class="badge-mini" title="' + b.name + ': ' + b.hint + '">' + b.emoji + '</span>').join(' ');
    }
  } catch (e) { /* private mode */ }
  const totalShown = 4;
  const pct = Math.min(100, Math.round((doneCount / totalShown) * 100));
  const dailyGames = [
    { id: '24-game', href: '/games/24-game/?daily=1', cvId: 'cv-24', name: '24 Game' },
    { id: 'sudoku', href: '/games/sudoku/?daily=1', cvId: 'cv-sudoku', name: 'Sudoku 9x9' },
    { id: 'sudoku-6x6', href: '/games/sudoku-6x6/?daily=1', cvId: 'cv-s6', name: 'Sudoku 6x6' },
    { id: 'equation-pyramid', href: '/games/equation-pyramid/?daily=1', cvId: 'cv-pyr', name: 'Pyramid' },
  ];
  const tiles = dailyGames.map((g) => {
    const done = dones.includes(g.id);
    return '<a class="dtile' + (done ? ' done' : '') + '" href="' + g.href + '"><svg aria-hidden="true"><use href="#' + g.cvId + '"/></svg>' + g.name + (done ? '<span class="ok">✓</span>' : '') + '</a>';
  }).join('');
  const dailyMsg =
    doneCount === 0
      ? 'Try today\'s Daily — <b>same puzzle worldwide</b>. Unlock rank stars by completing 5 in a row.'
      : doneCount < totalShown
        ? '<b>' + doneCount + '</b> of ' + totalShown + ' done today — ' + (totalShown - doneCount) + ' left for rank stars.'
        : '<b>All ' + totalShown + '</b> done today — streak extended to <b>' + streak + ' day' + (streak === 1 ? '' : 's') + '</b>!';
  return `
    <div class="panel panel-daily">
      <div class="panel-head">
        <span class="panel-title"><span class="cal">◷</span> Daily Challenge</span>
        <span class="panel-meta">
          <span class="star">⭐ <b id="dDone">${doneCount}</b>/${totalShown}</span>
          <span>🔥 ${streak}-day streak</span>
          ${badgeSummary ? '<span class="badges-mini">' + badgeSummary + '</span>' : ''}
        </span>
      </div>
      <div class="daily-tiles">${tiles}</div>
      <div class="progress"><i id="pbar" style="width:${pct}%"></i></div>
      <p class="daily-msg">${dailyMsg} · <span class="cd" id="cd">--:--:--</span> until the global reset</p>
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
      ${F('<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.2 0 1.2-1.3 2.2-3 2.2-1.1 0-2-.5-2.5-1.3M12 6.5V8m0 8v1.5"/>', 'Smart hint', 'Stuck? Ask for a hint — it shows the next step, not the answer.')}
    </div>
  `;
}

/* ───────── 页脚 ───────── */
function footerHtml(): string {
  return `
    <div class="wrap">
      <div class="sf-title">Explore the Duel family</div>
      <div class="sf-matrix">
        <a class="sf-item" href="https://boardduel.com"><span class="pip" style="background:#2FC4C9"></span>BoardDuel — Chess &amp; Card Games</a>
        <a class="sf-item" href="https://mathduel.games"><span class="pip" style="background:#F59E0B"></span>MathDuel — Math Puzzle Games</a>
        <a class="sf-item" href="https://memoryduel.com"><span class="pip" style="background:#4F46E5"></span>MemoryDuel — Knowledge Battles</a>
      </div>
      <div class="sf-links">
        <a href="/about/">About</a><a href="/contact/">Contact</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/">All games</a>
      </div>
      <div class="sf-copy">© 2026 MathDuel · Pure static · Privacy-first · Free to play</div>
    </div>
  `;
}

/* ───────── 顶部移动端顶栏 ───────── */
function topbarHtml(): string {
  // 顶栏不放 Log in 按钮：站点明确"No login, no identity"（见 Privacy / Contact 页），
  // 上线推广时该按钮是死链只会引诱访客点击成为噪音，故移除。
  return `
    <button class="burger" id="burger" aria-label="Open navigation" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <a class="logo" href="/">Math<b>Duel</b></a>
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

      <!-- F-206 (c): Why MathDuel? brand story -->
      <section class="why wrap" aria-label="Why MathDuel">
        <div class="why-card">
          <div class="why-eyebrow">WHY MATHDUEL</div>
          <h2 class="why-title">Math is more fun when you can prove it.</h2>
          <p class="why-lead">
            Every game on this site ships with a <b>Daily Challenge</b> — the same puzzle for everyone, everywhere,
            at the same Shanghai date. No login, no ads, no data mining.
            Just open the page and you can play.
          </p>
          <div class="why-grid">
            <div><b>🔒 Privacy-first</b><span>Anonymous UUID stored only in your browser. Clear cookies to reset.</span></div>
            <div><b>🌏 Same puzzle worldwide</b><span>Shanghai-date seeded generation. Compare with anyone on Earth.</span></div>
            <div><b>🪙 No streak rewards</b><span>The only prize is breaking your own yesterday. No notifications, no upsell.</span></div>
            <div><b>⚡ Free forever</b><span>Static pages on Cloudflare, ~0 cost per visitor. No paywall, ever.</span></div>
          </div>
        </div>
      </section>

      <!-- 特性 -->
      <section class="feats"><div class="wrap">${featsHtml()}</div></section>
    </main>

    <!-- 页脚 -->
    <footer class="main">${footerHtml()}</footer>
  `;

  // 2. 行为绑定
  initCountdown();
  // 抽屉 / 遮罩 / 侧栏收窄统一走 pages/lobby-chrome（首页壳的收窄按钮 id 是 sbCollapse，
  // 该模块两个 id 都认）。此前这里另有一份同名实现，与 lobby 页那份容易漂移。
  wireLobbyChrome();
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
