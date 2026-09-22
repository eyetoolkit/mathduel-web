/**
 * 数字金字塔引擎（纯函数，无 DOM 依赖）
 * ------------------------------------------------------------
 * 塔形：每层 level k 有 k 个格子，第 k 层第 i 格 = 第 k+1 层 i 格 + 第 k+1 层 i+1 格。
 * 高度 levels 表示「层数」，levels=5 → 1+2+3+4+5=15 格，apex 在最顶。
 *
 * 生成思路（最简单且保证唯一解）：
 *   1) 随机选底层 level=levels 的 values[]（1..9 之间，保证金字塔顶 ≤ 999）
 *   2) 向上累加得到整个塔的 solution
 *   3) 挖洞保唯一解：从底层往上挖，挖一个后算 solution[level][i] 是否能被反推唯一确定；
 *      不可唯一确定就放回。带 budget 限速。
 *
 * 设计稿的难度按「塔高 levels」：Swift 4 / Standard 5 / Deep 6。
 * 与杀手数独（按笼子数）和 9×9（按线索数）一脉相承——"难度由几何决定"。
 */
import { mulberry32, hashString, shanghaiDateKey } from '../sudoku/engine';

export type Height = 4 | 5 | 6;
export const HEIGHTS: Height[] = [4, 5, 6];
export const HEIGHT_LABEL: Record<Height, string> = {
  4: 'Swift',
  5: 'Standard',
  6: 'Deep',
};
/** 每层该有多少格（level=0 是顶层 1 格，level=levels-1 是底层 levels 格） */
export const cellsAt = (level: number, _levels: Height): number => level + 1;

/** 塔的完整解：一维数组按行展开（顶层在前）。
 * 比如 levels=5:
 *   idx 0      : apex
 *   idx 1, 2   : row 1
 *   idx 3..5   : row 2
 *   idx 6..9   : row 3
 *   idx 10..14 : row 4 (base)
 */
export type Grid = number[]; // length = sum(1..levels) = levels*(levels+1)/2

export interface Tower {
  solution: Grid;
  puzzle: Grid; // 0 = 空格
  givens: number[]; // 给定格下标（paper 显示）
  holes: number[]; // 空格下标
  levels: Height;
}

/** 给定 idx → 所在 level（0=顶层）和行内位置（0..level） */
export function posOf(i: number, levels: Height): { level: number; row: number; col: number } {
  let level = 0;
  let cum = 0;
  while (level < levels) {
    const row = cellsAt(level, levels);
    if (i < cum + row) return { level, row, col: i - cum };
    cum += row;
    level++;
  }
  // 兜底：超出索引（不应发生）
  return { level: levels - 1, row: levels, col: i - cum };
}

/** 反查 idx（已知 level 和 col） */
export function idxAt(level: number, col: number, levels: Height): number {
  let cum = 0;
  for (let l = 0; l < level; l++) cum += cellsAt(l, levels);
  return cum + col;
}

/* ─── 顶层 + 解生成 ─── */
/** 底层（levels 格）每格 1..9，且最终 apex ≤ 999。
 *  简单限速：限制底层累加和最大（levels-1 级之和）的合理范围。
 *  对 levels=5（底层 5 个数），相邻和 ≤ 9+9=18，下一层（4 格）≤ 36，
 *  继续累加，最顶层 ≤ 72（远小于 999）。
 *  对 levels=6，apex 累加路径 5+4+3+2+1 = 15 项 × 最大 9 = 135。
 *  所以 1..9 完全够用，apex 不会爆三位数。 */
const MIN = 1;
const MAX = 9;

function genSolution(levels: Height, rng: () => number): Grid {
  // 底层
  const base: number[] = [];
  for (let i = 0; i < levels; i++) base.push(MIN + Math.floor(rng() * (MAX - MIN + 1)));
  const grid: Grid = new Array((levels * (levels + 1)) / 2);
  // 底层写入最后 levels 个位置
  const baseStart = (levels * (levels + 1)) / 2 - levels;
  for (let i = 0; i < levels; i++) grid[baseStart + i] = base[i];
  // 向上累加
  for (let level = levels - 2; level >= 0; level--) {
    const row = cellsAt(level, levels);
    const start = idxAt(level, 0, levels);
    const belowStart = idxAt(level + 1, 0, levels);
    for (let col = 0; col < row; col++) {
      grid[start + col] = grid[belowStart + col] + grid[belowStart + col + 1];
    }
  }
  return grid;
}

/** 唯一性检测：挖一些格子后，从下往上反推是否每个空格都恰好唯一。
 *  贪心检查：对每个空格，尝试所有合法候选（受已知格约束）。
 *  但金字塔是线性递推——已知下一层两格之和可唯一推上一层单格。
 *  唯一性 = 任何非已知格能被唯一定位。返回 true = 当前谜题有唯一解。 */
function isUnique(puzzle: Grid, levels: Height): boolean {
  // 复制 puzzle 用作工作区；按 givens 重新逐层反推：
  // 对每个空格，从下到上若上一层两格已知可确定本层空格。
  // 关键：递推必须能从底层已知格出发，**每个空格都能被确定**。
  const work = puzzle.slice();
  const total = work.length;
  // 先把已知 givens >0 的位置保留，其它视为 0（未知）
  // 向上递推：从 level = levels-2 到 0
  for (let level = levels - 2; level >= 0; level--) {
    const row = cellsAt(level, levels);
    const start = idxAt(level, 0, levels);
    const belowStart = idxAt(level + 1, 0, levels);
    for (let col = 0; col < row; col++) {
      const a = work[belowStart + col];
      const b = work[belowStart + col + 1];
      if (a > 0 && b > 0) {
        const expected = a + b;
        if (work[start + col] === 0) {
          // 这一格必须 = expected 才能唯一解
          work[start + col] = expected;
        } else if (work[start + col] !== expected) {
          return false; // 与已知冲突，无解
        }
      } else {
        // 至少有一格未知，无法确定此格；若此格也是未知，则谜题不是唯一
        if (work[start + col] === 0) {
          // 进一步：向上继续推或上层也会有冲突。我们保守返回 false。
          // 但实际上部分顶层未知+底层已知仍可被确定（自上而下），这里我们要求所有空格能被反推。
          return false;
        }
      }
    }
  }
  // 检查所有空格都被确定
  for (let i = 0; i < total; i++) if (work[i] === 0) return false;
  // 检查答案确实唯一：上层已确定 → 整塔一致 → 与原 solution 一致就唯一
  // 此处仅做完整性检查；任何"全确定"谜题因为自下而上递推唯一→解唯一
  return true;
}

/** 生成谜题：随机挖洞，破坏唯一性则放回。
 *  关键：从**底层往上**每行先填全（即作为 given），然后逐层向上挖——
 *  这样玩家从底层已知格能唯一推上层空格，符合"数字金字塔=反向算术"。
 *  不过度挖：底层始终保持全 known（这是规则所需），上层可挖。 */
export function generateTower(levels: Height, rng: () => number): Tower {
  const solution = genSolution(levels, rng);
  const puzzle = solution.slice();
  const holes: number[] = [];
  let budget = 3000;

  // apex（level=0）保留为 given：从底层往上推需要它做参考点；
  // 从 level 1 往上挖洞，目标让"挖洞后仍能从底层唯一推回"。
  // isUnique 已确保唯一性；我们尽量挖到 row-1（每行至少留 1 个线索）。
  for (let level = 1; level < levels && budget > 0; level++) {
    const row = cellsAt(level, levels);
    // 每层至少留 1 个 given，其余尽量挖
    const targetHoles = row - 1;
    const order = shuffle(Array.from({ length: row }, (_, i) => i), rng);
    let holesThisRow = 0;
    for (const col of order) {
      if (holesThisRow >= targetHoles || budget <= 0) break;
      const i = idxAt(level, col, levels);
      if (puzzle[i] === 0) continue;
      const keep = puzzle[i];
      puzzle[i] = 0;
      budget--;
      if (isUnique(puzzle, levels)) {
        holes.push(i);
        holesThisRow++;
      } else {
        puzzle[i] = keep;
      }
    }
  }

  // 计算 givens = solution - holes
  const holeSet = new Set(holes);
  const givens: number[] = [];
  for (let i = 0; i < solution.length; i++) if (!holeSet.has(i)) givens.push(i);

  return { solution, puzzle, givens, holes, levels };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 每日题（确定性种子，全球同题；固定 Standard 5 levels） */
export function dailyTower(dateKey: string): Tower {
  return generateTower(5, mulberry32(hashString('np-' + dateKey)));
}

/** Duel：bot 与玩家各自填一半空格。
 *  简化策略：从底层向上递推——任何空格只要下层两格已知就能推上来。
 *  玩家先填还是 bot 先填由 caller 控制。
 *  返回：mine 玩家应填的下标集合；bots bot 应填的下标集合。
 *  此处 bot 故意「慢」（3-5s/格），玩家有赢面。 */
export function duelDeal(levels: Height, rng: () => number): Tower & { mine: Set<number>; bots: Set<number> } {
  const tower = generateTower(levels, rng);
  // 把 holes 随机均分
  const shuffled = tower.holes.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const half = Math.floor(shuffled.length / 2);
  return {
    ...tower,
    mine: new Set(shuffled.slice(0, half)),
    bots: new Set(shuffled.slice(half)),
  };
}

/** 给定已填 grid 与 levels，列出所有「下一步可唯一确定的空格」——对玩家提示有用。
 *  从下往上扫：上层空格若下层两格都已知（任一来源：givens 或玩家已填），就可确定。 */
export function nextDeterminable(grid: Grid, levels: Height): number[] {
  const out: number[] = [];
  for (let level = levels - 2; level >= 0; level--) {
    const row = cellsAt(level, levels);
    const start = idxAt(level, 0, levels);
    const belowStart = idxAt(level + 1, 0, levels);
    for (let col = 0; col < row; col++) {
      const i = start + col;
      if (grid[i] !== 0) continue;
      const a = grid[belowStart + col];
      const b = grid[belowStart + col + 1];
      if (a > 0 && b > 0) out.push(i);
    }
  }
  return out;
}

/** 当前 grid 的总格数（用于 HUD） */
export const totalCells = (levels: Height): number => (levels * (levels + 1)) / 2;

/** Bot 用的「找一个空格就填正确值」算法。
 *  返回 { idx, value } 或 null（全部填完）。 */
export function botStep(grid: Grid, solution: Grid, levels: Height): { idx: number; value: number } | null {
  const det = nextDeterminable(grid, levels);
  if (det.length === 0) return null;
  const i = det[Math.floor(Math.random() * det.length)];
  return { idx: i, value: solution[i] };
}

/** 复用于对局页 */
export { mulberry32, hashString, shanghaiDateKey };