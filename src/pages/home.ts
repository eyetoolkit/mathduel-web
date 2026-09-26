/**
 * 首页 · 主页重构（MathDuel Homepage Redesign）
 * - 竞技墙 (renderArenaWall)：hero 右侧 4 格迷你面板，用各游戏的「真实起始局面」。
 * - 游戏网格 (renderGameGrid)：6 个已上线竞技场 + 1 个 Coming soon 卡片。
 * 视觉与结构对齐 mathduel-homepage-redesign.html 设计稿。
 */

/**
 * 游戏发布阶段
 * - live   ：已正式上线，生产 + beta 均展示
 * - beta   ：仅 beta 环境展示（生产隐藏）
 * - coming ：尚未上线，固定展示为 SOON 卡片（预告位）
 */
export type Stage = 'live' | 'beta' | 'coming';

export interface GameDef {
  id: string;
  title: string;
  desc: string;
  href: string;
  modes: string;
  stage?: Stage;
  mini: string;
}

/** 是否处于 beta 环境（由 Cloudflare Pages 环境变量注入，构建期确定） */
const SHOW_BETA = import.meta.env.VITE_SHOW_BETA === '1';

/** 当前环境下该游戏是否应作为正式卡片展示 */
export function isVisible(g: GameDef): boolean {
  const stage = g.stage ?? 'live';
  if (stage === 'live') return true;
  if (stage === 'beta') return SHOW_BETA;
  return false;
}

/* ───────────── mini board 构造器（真实起始局面，与游戏生成器一致） ───────────── */

const MINI_24 = `
  <div class="m24">
    <div class="m24-cards"><span>3</span><span>3</span><span>8</span><span>8</span></div>
    <div class="m24-t">target <b>24</b></div>
  </div>`;

const MINI_SUDOKU9 = `<div class="board mini9">
<div class="c given">6</div><div class="c given">1</div><div class="c given bx-c">5</div><div class="c"></div><div class="c given">8</div><div class="c bx-c"></div><div class="c"></div><div class="c given">4</div><div class="c given">7</div>
<div class="c"></div><div class="c"></div><div class="c given bx-c">9</div><div class="c"></div><div class="c"></div><div class="c bx-c"></div><div class="c given">5</div><div class="c given">6</div><div class="c"></div>
<div class="c bx-r"></div><div class="c given bx-r">7</div><div class="c given bx-c bx-r">4</div><div class="c bx-r"></div><div class="c given bx-r">6</div><div class="c bx-c bx-r"></div><div class="c given bx-r">1</div><div class="c given bx-r">8</div><div class="c bx-r"></div>
<div class="c given">1</div><div class="c"></div><div class="c given bx-c">3</div><div class="c"></div><div class="c"></div><div class="c given bx-c">4</div><div class="c given">9</div><div class="c"></div><div class="c"></div>
<div class="c"></div><div class="c given">9</div><div class="c given bx-c">6</div><div class="c"></div><div class="c"></div><div class="c bx-c"></div><div class="c given">2</div><div class="c"></div><div class="c given">4</div>
<div class="c given bx-r">7</div><div class="c bx-r"></div><div class="c given bx-c bx-r">2</div><div class="c given bx-r">9</div><div class="c given bx-r">5</div><div class="c given bx-c bx-r">3</div><div class="c bx-r"></div><div class="c bx-r"></div><div class="c given bx-r">6</div>
<div class="c"></div><div class="c"></div><div class="c bx-c"></div><div class="c given">5</div><div class="c"></div><div class="c bx-c"></div><div class="c given">6</div><div class="c given">9</div><div class="c"></div>
<div class="c"></div><div class="c"></div><div class="c"></div><div class="c given bx-c">1</div><div class="c given">8</div><div class="c"></div><div class="c given bx-c">6</div><div class="c"></div><div class="c"></div>
<div class="c given">3</div><div class="c"></div><div class="c given">6</div><div class="c bx-c"></div><div class="c given">7</div><div class="c given">3</div><div class="c bx-c"></div><div class="c given">4</div><div class="c given">5</div><div class="c"></div>
</div>`;

const MINI_SUDOKU66 = `<div class="board mini66">
<div class="c given">1</div><div class="c given">2</div><div class="c given">5</div><div class="c given bx-c">3</div><div class="c"></div><div class="c given">6</div>
<div class="c bx-r"></div><div class="c given bx-r">3</div><div class="c given bx-r">6</div><div class="c bx-c bx-r"></div><div class="c bx-r"></div><div class="c bx-r"></div>
<div class="c"></div><div class="c given">1</div><div class="c given">4</div><div class="c given bx-c">5</div><div class="c"></div><div class="c"></div>
<div class="c given bx-r">6</div><div class="c bx-r"></div><div class="c bx-r"></div><div class="c given bx-c bx-r">2</div><div class="c given bx-r">1</div><div class="c given bx-r">4</div>
<div class="c"></div><div class="c"></div><div class="c"></div><div class="c given bx-c">4</div><div class="c"></div><div class="c given">2</div>
<div class="c given">5</div><div class="c"></div><div class="c"></div><div class="c given bx-c">6</div><div class="c"></div><div class="c"></div>
</div>`;

function miniS4(): string {
  // 4×4，2×2 宫布局 + 琥珀点缀，与 Sudoku 4×4 视觉一致
  let cells = '';
  for (let i = 0; i < 16; i++) {
    const amber = i === 15 ? ' amber' : '';
    cells += `<div class="kc${amber}"></div>`;
  }
  return `<div class="miniK">${cells}</div>`;
}

const MINI_EQUATION = `
  <div class="mE">
    <div class="mE-target"><small>Target</small><b>-7</b></div>
    <div class="mE-grid">
      <div class="mec"><small>×</small><b>4</b></div><div class="mec"><small>-</small><b>2</b></div><div class="mec"><small>×</small><b>5</b></div>
      <div class="mec"><small>+</small><b>1</b></div><div class="mec"><small>-</small><b>4</b></div><div class="mec"><small>+</small><b>9</b></div>
      <div class="mec"><small>+</small><b>3</b></div><div class="mec"><small>×</small><b>5</b></div><div class="mec"><small>÷</small><b>9</b></div>
    </div>
  </div>`;

const MINI_BULLS = `
  <div class="mB">
    <div class="mB-g"><span>3</span><span>4</span><span>5</span><span>6</span></div>
    <div class="mB-v"><b>2A</b> 1B</div>
    <div class="mB-hint">5 of 8 tries used</div>
  </div>`;

const MINI_TOWER = `
  <div class="miniPyr">
    <div class="mb-row"><span class="mb given">60</span></div>
    <div class="mb-row"><span class="mb given">34</span><span class="mb given">26</span></div>
    <div class="mb-row"><span class="mb given">17</span><span class="mb given">17</span><span class="mb given">9</span></div>
    <div class="mb-row"><span class="mb "></span><span class="mb "></span><span class="mb "></span><span class="mb "></span></div>
  </div>`;

/* ───────────── 游戏定义（对齐设计稿「Six arenas」） ───────────── */

const GAMES: GameDef[] = [
  {
    id: '24-game',
    title: '24 Game',
    desc: 'Four cards, one target: 24. The classic mental-math sprint.',
    href: '/games/24-game/lobby/',
    modes: 'Logic · Duel + Race + Daily',
    stage: 'live',
    mini: MINI_24,
  },
  {
    id: 'sudoku-4x4',
    title: 'Sudoku 4×4',
    desc: 'A gentle first grid — 1–4, 2×2 boxes, made for young solvers.',
    href: '/games/sudoku-4x4/lobby/',
    modes: 'Beginner · Solo',
    stage: 'live',
    mini: miniS4(),
  },
  {
    id: 'sudoku',
    title: 'Sudoku 9×9',
    desc: 'The classic logic grid — race your opponent square by square.',
    href: '/games/sudoku/lobby/',
    modes: 'Classic · Duel + Daily',
    stage: 'live',
    mini: MINI_SUDOKU9,
  },
  {
    id: 'sudoku-6x6',
    title: 'Sudoku 6×6',
    desc: 'A quicker grid for warm-ups and younger players.',
    href: '/games/sudoku-6x6/lobby/',
    modes: 'Beginner · Duel + Daily',
    stage: 'live',
    mini: MINI_SUDOKU66,
  },
  {
    id: 'equation-pyramid',
    title: 'Equation Pyramid',
    desc: 'Pick three cells, build the equation, hit the target.',
    href: '/games/equation-pyramid/lobby/',
    modes: 'Precedence · Duel + Daily',
    stage: 'live',
    mini: MINI_EQUATION,
  },
  {
    id: 'bulls',
    title: 'Bulls 1A2B',
    desc: 'Crack the secret code in fewest guesses.',
    href: '/games/bulls/lobby/',
    modes: 'Deduction · Duel',
    stage: 'live',
    mini: MINI_BULLS,
  },
  {
    id: 'sum-tower',
    title: 'Sum Tower',
    desc: "Bricks that add up — the gentle one, on its way.",
    href: '#',
    modes: 'Coming soon',
    stage: 'coming',
    mini: MINI_TOWER,
  },
];

function gameCardHtml(g: GameDef): string {
  return `
    <a class="gcard" href="${g.href}" aria-label="${g.title}">
      <div class="gmini">${g.mini}</div>
      <div class="gbody">
        <b>${g.title}</b>
        <span>${g.desc}</span>
        <em class="num">${g.modes}</em>
      </div>
    </a>`;
}

function soonCardHtml(g: GameDef): string {
  return `
    <a class="gcard soon" href="${g.href}" aria-label="${g.title}">
      <div class="gmini">${g.mini}</div>
      <div class="gbody">
        <b>${g.title}</b>
        <span>${g.desc}</span>
        <em>${g.modes}</em>
      </div>
      <span class="soon-pill">SOON</span>
    </a>`;
}

/** 游戏网格：6 个竞技场 + 1 个 Coming soon 预告卡 */
export function renderGameGrid(host: HTMLElement | null): void {
  if (!host) return;
  const html = GAMES.map((g) => (g.stage === 'coming' ? soonCardHtml(g) : isVisible(g) ? gameCardHtml(g) : '')).join('');
  host.innerHTML = html;
}

/** Hero 右侧「竞技墙」：4 格迷你面板（24 / 9×9 / 等式金字塔 / 每日挑战倒计时） */
export function renderArenaWall(host: HTMLElement | null): void {
  if (!host) return;
  host.innerHTML = `
    <div class="whead"><span>The arena wall</span><span class="live"><i></i>Race · 17 solving now</span></div>
    <div class="wgrid">
      <div class="wtile">${MINI_24}<small>24 Game</small></div>
      <div class="wtile">${MINI_SUDOKU9}<small>Sudoku 9×9</small></div>
      <div class="wtile">${MINI_EQUATION}<small>Equation Pyramid</small></div>
      <div class="wtile daily"><b class="num" id="dailyTimer">04:48:51</b><span>until the daily hunt resets — same puzzle worldwide</span></div>
    </div>`;
}

export { GAMES };
