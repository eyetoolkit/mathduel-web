/**
 * 9×9 数独引擎（纯函数，无 DOM 依赖）
 * 盘面：81 格一维数组；0 = 空。块 = 3 行高 × 3 列宽（9 个 3×3 宫）。
 * 生成：变换法产满解（瞬时，无需回溯）→ 按难度挖洞（保持唯一解）。
 * 每日题：shanghaiDateKey(UTC+8) + hashString → mulberry32 确定性种子（全球同题，纯前端零依赖）。
 *
 * 与 6×6 引擎同款接口，便于复用逻辑；差异点：N=9、3×3 宫、线索数（设计稿 Easy40/Med32/Hard26）。
 */

export type Grid = number[]; // length 81
export type Difficulty = 'easy' | 'standard' | 'hard';

export const N = 9;
/** 各难度的「线索数」（设计稿明确印刷在难度按钮上） */
export const CLUES_BY_DIFF: Record<Difficulty, number> = { easy: 40, standard: 32, hard: 26 };
export const HOLES_BY_DIFF: Record<Difficulty, number> = {
  easy: 81 - CLUES_BY_DIFF.easy,
  standard: 81 - CLUES_BY_DIFF.standard,
  hard: 81 - CLUES_BY_DIFF.hard,
};
/** Duel bot 每格平均耗时（秒） */
export const BOT_PACE: Record<Difficulty, number> = { easy: 7, standard: 5, hard: 3.8 };

export const idx = (r: number, c: number): number => r * N + c;
export const rowOf = (i: number): number => Math.floor(i / N);
export const colOf = (i: number): number => i % N;
/** 宫号：0..8（band = floor(r/3)，stack = floor(c/3)） */
export const boxOf = (i: number): number => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/* ─── 种子随机（与 24 点 / 6×6 同款 mulberry32 / FNV hash，确定性可复现） ─── */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 站点日期键（UTC+8 次日零点为界，与 24 点每日挑战一致） */
export function shanghaiDateKey(now?: Date): string {
  const d = now ?? new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return (
    utc8.getUTCFullYear().toString() +
    String(utc8.getUTCMonth() + 1).padStart(2, '0') +
    String(utc8.getUTCDate()).padStart(2, '0')
  );
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── 候选 / 冲突 ─── */

export function candidates(g: Grid, i: number): number[] {
  const used = new Set<number>();
  const r = rowOf(i);
  const c = colOf(i);
  for (let j = 0; j < 81; j++) {
    if (j === i || g[j] === 0) continue;
    if (rowOf(j) === r || colOf(j) === c || boxOf(j) === boxOf(i)) used.add(g[j]);
  }
  const out: number[] = [];
  for (let v = 1; v <= 9; v++) if (!used.has(v)) out.push(v);
  return out;
}

/** 返回当前所有冲突格下标集合（同行/列/宫 内重复值） */
export function findConflicts(g: Grid): Set<number> {
  const bad = new Set<number>();
  const groups: number[][] = [];
  for (let r = 0; r < N; r++) groups.push([...Array(N)].map((_, c) => idx(r, c)));
  for (let c = 0; c < N; c++) groups.push([...Array(N)].map((_, r) => idx(r, c)));
  for (let b = 0; b < 9; b++) {
    const cells: number[] = [];
    for (let i = 0; i < 81; i++) if (boxOf(i) === b) cells.push(i);
    groups.push(cells);
  }
  for (const cells of groups) {
    const byVal = new Map<number, number[]>();
    for (const i of cells) {
      if (!g[i]) continue;
      const arr = byVal.get(g[i]) ?? [];
      arr.push(i);
      byVal.set(g[i], arr);
    }
    for (const arr of byVal.values()) if (arr.length > 1) arr.forEach((i) => bad.add(i));
  }
  return bad;
}

/* ─── 生成满解（变换法，瞬时，无需回溯） ───
   先取一个合法基准解（行移位 Latin 方），再做：
   1) 数字 1–9 全排列；2) 宫内行/列交换；3) 宫（band/stack）置换。
   全部保持数独约束，且覆盖充分随机空间。 */
export function generateSolved(rng: () => number): Grid {
  const g: Grid = new Array(81).fill(0);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) g[idx(r, c)] = ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;

  // 1) 数字全排列
  const dp = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  for (let i = 0; i < 81; i++) g[i] = dp[g[i] - 1];

  // 2) 宫内行置换 + 3) band 置换（合并到一条 rowPerm）
  let rowPerm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let b = 0; b < 3; b++) {
    const seg = shuffle([0, 1, 2], rng);
    for (let k = 0; k < 3; k++) rowPerm[3 * b + k] = 3 * b + seg[k];
  }
  const bandOrder = shuffle([0, 1, 2], rng);
  const newRowPerm = new Array(9);
  for (let b = 0; b < 3; b++)
    for (let k = 0; k < 3; k++) newRowPerm[3 * b + k] = rowPerm[3 * bandOrder[b] + k];
  rowPerm = newRowPerm;

  // 宫内列置换 + stack 置换
  let colPerm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let b = 0; b < 3; b++) {
    const seg = shuffle([0, 1, 2], rng);
    for (let k = 0; k < 3; k++) colPerm[3 * b + k] = 3 * b + seg[k];
  }
  const stackOrder = shuffle([0, 1, 2], rng);
  const newColPerm = new Array(9);
  for (let b = 0; b < 3; b++)
    for (let k = 0; k < 3; k++) newColPerm[3 * b + k] = colPerm[3 * stackOrder[b] + k];
  colPerm = newColPerm;

  const out: Grid = new Array(81).fill(0);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) out[idx(r, c)] = g[idx(rowPerm[r], colPerm[c])];
  return out;
}

/** 解数计数（上限 limit 剪枝；limit=2 用于唯一性检查） */
export function countSolutions(g: Grid, limit = 2): number {
  let first = -1;
  let best: number[] | null = null;
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    const c = candidates(g, i);
    if (c.length === 0) return 0;
    if (best === null || c.length < best.length) {
      first = i;
      best = c;
    }
  }
  if (first === -1) return 1;
  let total = 0;
  for (const v of best!) {
    g[first] = v;
    total += countSolutions(g, limit - total);
    g[first] = 0;
    if (total >= limit) break;
  }
  return total;
}

export interface Puzzle {
  solution: Grid;
  puzzle: Grid; // 挖洞后
  holes: number[]; // 空格下标
  diff: Difficulty;
}

/** 生成唯一解谜题：随机挖洞，破坏唯一性则放回；带尝试预算保证性能 */
export function generatePuzzle(diff: Difficulty, rng: () => number): Puzzle {
  const solution = generateSolved(rng);
  const puzzle = solution.slice();
  const target = HOLES_BY_DIFF[diff];
  const holes: number[] = [];
  let budget = 2500; // countSolutions 调用上限，约束最坏耗时

  const tryPass = (): void => {
    const order = shuffle([...Array(81).keys()], rng);
    for (const i of order) {
      if (holes.length >= target || budget <= 0) break;
      if (!puzzle[i]) continue;
      const keep = puzzle[i];
      puzzle[i] = 0;
      budget--;
      if (countSolutions(puzzle.slice(), 2) === 1) holes.push(i);
      else puzzle[i] = keep;
    }
  };

  tryPass();
  // 多轮直到达到目标洞数或无法再挖（保护预算）
  let guard = 0;
  while (holes.length < target && budget > 0 && guard < 8) {
    const before = holes.length;
    tryPass();
    if (holes.length === before) break; // 再无可挖
    guard++;
  }

  return { solution, puzzle, holes, diff };
}

/** 每日题（确定性种子，全球同题） */
export function dailyPuzzle(dateKey: string): Puzzle {
  return generatePuzzle('standard', mulberry32(hashString('s9-' + dateKey)));
}

/** Duel：挖洞后把空格随机均分给玩家 / bot */
export function duelDeal(diff: Difficulty, rng: () => number): Puzzle & { mine: Set<number>; bots: Set<number> } {
  const p = generatePuzzle(diff, rng);
  const shuffled = p.holes.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const half = Math.floor(shuffled.length / 2);
  return {
    ...p,
    mine: new Set(shuffled.slice(0, half)),
    bots: new Set(shuffled.slice(half)),
  };
}

/** 是否全部按解填满（值正确） */
export function isSolved(g: Grid, solution: Grid): boolean {
  for (let i = 0; i < 81; i++) if (g[i] !== solution[i]) return false;
  return true;
}
