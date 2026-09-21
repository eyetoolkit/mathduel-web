/**
 * 首页 · 游戏网格
 * 六款游戏，24 点为旗舰（已迁入新架构），其余按同模板后续迭代。
 */

export interface GameDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  href: string;
  flagship?: boolean;
  coming?: boolean;
  modes: string[];
}

const GAMES: GameDef[] = [
  {
    id: '24-game',
    icon: '🂡',
    title: '24 · Card Table',
    desc: 'Four cards, four operators, one target. Race up to 99 players on identical cards — or beat the daily clock.',
    href: '/games/24-game/',
    flagship: true,
    modes: ['Practice', 'Daily', 'Competition'],
  },
  {
    id: 'sudoku',
    icon: '▦',
    title: 'Sudoku',
    desc: 'The classic 9×9 logic grid with a full difficulty ladder and a daily seeded puzzle.',
    href: '/games/sudoku/',
    coming: true,
    modes: ['Practice', 'Daily'],
  },
  {
    id: 'sudoku-6x6',
    icon: '▤',
    title: 'Sudoku 6×6',
    desc: 'A faster grid for quick sessions — same rules, tighter board, sharper timing.',
    href: '/games/sudoku-6x6/',
    coming: true,
    modes: ['Practice'],
  },
  {
    id: 'killer-sudoku',
    icon: '◇',
    title: 'Killer Sudoku',
    desc: 'Sudoku meets arithmetic cages. Sums must match — pure deduction, no guessing.',
    href: '/games/killer-sudoku/',
    coming: true,
    modes: ['Practice', 'Daily'],
  },
  {
    id: 'equation-pyramid',
    icon: '△',
    title: 'Equation Pyramid',
    desc: 'Stack arithmetic bottom-up until a single number remains. Plan backwards to win.',
    href: '/games/equation-pyramid/',
    coming: true,
    modes: ['Practice'],
  },
  {
    id: 'bulls',
    icon: '◎',
    title: 'Guess the Number',
    desc: 'Crack the hidden code using bulls and cows feedback — logic over luck.',
    href: '/games/bulls/',
    coming: true,
    modes: ['Practice', 'Competition'],
  },
];

function cardHtml(g: GameDef): string {
  const cls = ['card', 'card-interactive', 'game-card', g.flagship ? 'flagship' : '', g.coming ? 'coming' : '']
    .filter(Boolean)
    .join(' ');
  const modes = g.modes.map((m) => `<span class="badge badge-neutral">${m}</span>`).join('');
  const cta = g.coming
    ? `<span class="badge badge-neutral">Soon</span>`
    : `<span class="btn btn-primary btn-sm">Play</span>`;
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
  host.innerHTML = GAMES.map(cardHtml).join('');
}

export { GAMES };
