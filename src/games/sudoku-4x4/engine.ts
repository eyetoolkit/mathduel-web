/**
 * 4×4 数独引擎（纯函数，无 DOM 依赖）· 小朋友入门款
 * 盘面：16 格一维数组；0 = 空。块 = 2 行高 × 2 列宽（4 个 2×2 宫）。
 * 生成：变换法产满解（瞬时，无需回溯）→ 按难度挖洞（保持唯一解）。
 * 与 9×9 / 6×6 引擎同款接口与范式；差异点：N=4、2×2 宫、线索数（Easy10/Medium8/Hard6）。
 */

export type Grid = number[]; // length 16
export type Difficulty = 'easy' | 'standard' | 'hard';

/** 各难度的「线索数」（印刷在难度按钮上，适合学龄前/低年级） */
export const CLUES_BY_DIFF: Record<Difficulty, number> = { easy: 10, standard: 8, hard: 6 };
export const HOLES_BY_DIFF: Record<Difficulty, number> = {
  easy: 16 - CLUES_BY_DIFF.easy,
  standard: 16 - CLUES_BY_DIFF.standard,
  hard: 16 - CLUES_BY_DIFF.hard,
};

export const N = 4;
export const idx = (r: number, c: number): number => r * N + c;
export const rowOf = (i: number): number => Math.floor(i / N);
export const colOf = (i: number): number => i % N;
/** 宫号：0..3（band = floor(r/2)，stack = floor(c/2)） */
export const boxOf = (i: number): number => Math.floor(rowOf(i) / 2) * 2 + Math.floor(colOf(i) / 2);

/* ─── 种子随机（与 9×9/6×6 同款 mulberry32 / FNV hash） ─── */
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
  for (let j = 0; j < 16; j++) {
    if (j === i || g[j] === 0) continue;
    if (rowOf(j) === r || colOf(j) === c || boxOf(j) === boxOf(i)) used.add(g[j]);
  }
  const out: number[] = [];
  for (let v = 1; v <= 4; v++) if (!used.has(v)) out.push(v);
  return out;
}

/** 返回当前所有冲突格下标集合（同行/列/宫 内重复值） */
export function findConflicts(g: Grid): Set<number> {
  const bad = new Set<number>();
  const groups: number[][] = [];
  for (let r = 0; r < N; r++) groups.push([...Array(N)].map((_, c) => idx(r, c)));
  for (let c = 0; c < N; c++) groups.push([...Array(N)].map((_, r) => idx(r, c)));
  for (let b = 0; b < 4; b++) {
    const cells: number[] = [];
    for (let i = 0; i < 16; i++) if (boxOf(i) === b) cells.push(i);
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

/* ─── 生成满解（变换法，瞬时） ───
   基准解（2×2 宫结构 Latin 方）→ 数字 1–4 全排列 + 宫内行/列交换 + band/stack 置换。 */
export function generateSolved(rng: () => number): Grid {
  const g: Grid = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) g[idx(r, c)] = ((r * 2 + Math.floor(r / 2) + c) % 4) + 1;

  // 1) 数字全排列
  const dp = shuffle([1, 2, 3, 4], rng);
  for (let i = 0; i < 16; i++) g[i] = dp[g[i] - 1];

  // 2) 宫内行交换（band 内 r0↔r1）+ band 置换（band0↔band1）
  const rowFlip = shuffle([0, 1], rng); // 每个 band 内是否上下交换
  const bandOrder = shuffle([0, 1], rng);
  const rowPerm = new Array(4);
  for (let b = 0; b < 2; b++)
    for (let k = 0; k < 2; k++) rowPerm[2 * b + k] = 2 * bandOrder[b] + (rowFlip[b] ? 1 - k : k);

  // 3) 宫内列交换 + stack 置换
  const colFlip = shuffle([0, 1], rng);
  const stackOrder = shuffle([0, 1], rng);
  const colPerm = new Array(4);
  for (let b = 0; b < 2; b++)
    for (let k = 0; k < 2; k++) colPerm[2 * b + k] = 2 * stackOrder[b] + (colFlip[b] ? 1 - k : k);

  const out: Grid = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) out[idx(r, c)] = g[idx(rowPerm[r], colPerm[c])];
  return out;
}

/** 解数计数（上限 limit 剪枝；limit=2 用于唯一性检查） */
export function countSolutions(g: Grid, limit = 2): number {
  let first = -1;
  let best: number[] | null = null;
  for (let i = 0; i < 16; i++) {
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

/** 生成唯一解谜题：随机挖洞，破坏唯一性则放回（16 格极小，预算充裕） */
export function generatePuzzle(diff: Difficulty, rng: () => number): Puzzle {
  const solution = generateSolved(rng);
  const puzzle = solution.slice();
  const target = HOLES_BY_DIFF[diff];
  const holes: number[] = [];
  let budget = 600;

  const tryPass = (): void => {
    const order = shuffle([...Array(16).keys()], rng);
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
  let guard = 0;
  while (holes.length < target && budget > 0 && guard < 8) {
    const before = holes.length;
    tryPass();
    if (holes.length === before) break;
    guard++;
  }

  return { solution, puzzle, holes, diff };
}

/** 是否全部按解填满（值正确） */
export function isSolved(g: Grid, solution: Grid): boolean {
  for (let i = 0; i < 16; i++) if (g[i] !== solution[i]) return false;
  return true;
}
