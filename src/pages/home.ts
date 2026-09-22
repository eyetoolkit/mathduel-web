/**
 * 首页 · 游戏网格
 * 六款游戏，24 点为旗舰（已迁入新架构），其余按同模板后续迭代。
 */

/**
 * 游戏发布阶段
 * - live  ：已正式上线，生产 + beta 环境均展示
 * - beta  ：代码已就绪但仍在打磨，仅 beta 环境展示（生产隐藏）
 * - coming：尚未开发，任何环境都不展示
 */
export type Stage = 'live' | 'beta' | 'coming';

export interface GameDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  href: string;
  flagship?: boolean;
  stage?: Stage;
  modes: string[];
}

/** 是否处于 beta 环境（由 Cloudflare Pages 环境变量注入，构建期确定） */
const SHOW_BETA = import.meta.env.VITE_SHOW_BETA === '1';

/** 当前环境下该游戏是否应展示 */
export function isVisible(g: GameDef): boolean {
  const stage = g.stage ?? 'live';
  if (stage === 'live') return true;
  if (stage === 'beta') return SHOW_BETA;
  return false;
}

const GAMES: GameDef[] = [
  {
    id: '24-game',
    icon: '🂡',
    title: '24 · Card Table',
    desc: 'Four cards, four operators, one target. Race up to 99 players on identical cards — or beat the daily clock.',
    href: '/games/24-game/lobby/',
    flagship: true,
    stage: 'live',
    modes: ['Practice', 'Daily', 'Competition'],
  },
  {
    id: 'sudoku',
    icon: '▦',
    title: 'Sudoku',
    desc: 'The classic 9×9 logic grid with a full difficulty ladder and a daily seeded puzzle.',
    href: '/games/sudoku/lobby/',
    stage: 'beta',
    modes: ['Practice', 'Daily'],
  },
  {
    id: 'sudoku-6x6',
    icon: '▤',
    title: 'Sudoku 6×6',
    desc: 'A faster grid for quick sessions — same rules, tighter board, sharper timing.',
    href: '/games/sudoku-6x6/lobby/',
    stage: 'beta',
    modes: ['Practice', 'Daily', 'Duel'],
  },
  {
    id: 'killer-sudoku',
    icon: '◇',
    title: 'Killer Sudoku',
    desc: 'Sudoku meets arithmetic cages. Sums must match — pure deduction, no guessing.',
    href: '/games/killer-sudoku/lobby/',
    stage: 'beta',
    modes: ['Practice', 'Daily'],
  },
  {
    id: 'equation-pyramid',
    icon: '△',
    title: 'Equation Pyramid',
    desc: 'Stack arithmetic bottom-up until a single number remains. Plan backwards to win.',
    href: '/games/equation-pyramid/',
    stage: 'beta',
    modes: ['Practice'],
  },
  {
    id: 'bulls',
    icon: '◎',
    title: 'Guess the Number',
    desc: 'Crack the hidden code using bulls and cows feedback — logic over luck.',
    href: '/games/bulls/',
    stage: 'live',
    modes: ['Practice', 'Competition'],
  },
];

function cardHtml(g: GameDef): string {
  const stage = g.stage ?? 'live';
  const cls = ['card', 'card-interactive', 'game-card', g.flagship ? 'flagship' : '', stage === 'beta' ? 'coming' : '']
    .filter(Boolean)
    .join(' ');
  const modes = g.modes.map((m) => `<span class="badge badge-neutral">${m}</span>`).join('');
  const cta =
    stage === 'live'
      ? `<span class="btn btn-primary btn-sm">Play</span>`
      : `<span class="badge badge-neutral">${stage === 'beta' ? 'Beta' : 'Soon'}</span>`;
  return `
    <a class="${cls}" href="${g.href}" aria-label="${g.title}">
      <div class="gc-top">
        <span class="gc-icon" aria-hidden="true">${g.icon}</span>
      </div>
      <h3>${g.title}</h3>
      <p>${g.desc}</p>
      <div class="gc-foot">
        <div class="gc-modes">${modes}</div>
        ${cta}
      </div>
    </a>`;
}

export function renderGameGrid(host: HTMLElement | null): void {
  if (!host) return;
  host.innerHTML = GAMES.filter(isVisible).map(cardHtml).join('');
}

export { GAMES };
