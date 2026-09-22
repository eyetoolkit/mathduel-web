/**
 * 6×6 数独引擎（纯函数，无 DOM 依赖）
 * 盘面：36 格一维数组；0 = 空。块 = 2 行高 × 3 列宽（纵向 3 块、横向 2 块）。
 * 生成：回溯随机填满 → 按难度挖洞（保持唯一解）。
 * 每日题：shanghaiDateKey(UTC+8) + hashString → mulberry32 确定性种子（全球同题，纯前端零依赖）。
 */

export type Grid = number[]; // length 36
export type Difficulty = 'easy' | 'standard' | 'hard';

export const N = 6;
export const HOLES_BY_DIFF: Record<Difficulty, number> = { easy: 10, standard: 14, hard: 18 };
/** Duel bot 每格平均耗时（秒） */
export const BOT_PACE: Record<Difficulty, number> = { easy: 4.6, standard: 3.4, hard: 2.5 };

export const idx = (r: number, c: number): number => r * N + c;
export const rowOf = (i: number): number => Math.floor(i / N);
export const colOf = (i: number): number => i % N;
/** 块号：0..5（band = floor(r/2)，stack = floor(c/3)） */
export const boxOf = (i: number): number => Math.floor(rowOf(i) / 2) * 2 + Math.floor(colOf(i) / 3);

/* ─── 种子随机（与 24 点同款 mulberry32 / FNV hash，确定性可复现） ─── */
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

/* ─── 候选 / 冲突 ─── */

export function candidates(g: Grid, i: number): number[] {
  const used = new Set<number>();
  const r = rowOf(i);
  const c = colOf(i);
  const b = boxOf(i);
  for (let j = 0; j < 36; j++) {
    if (j === i || g[j] === 0) continue;
    if (rowOf(j) === r || colOf(j) === c || boxOf(j) === b) used.add(g[j]);
  }
  const out: number[] = [];
  for (let v = 1; v <= 6; v++) if (!used.has(v)) out.push(v);
  return out;
}

/** 返回当前所有冲突格下标集合（同行/列/块内重复值） */
export function findConflicts(g: Grid): Set<number> {
  const bad = new Set<number>();
  const groups: number[][] = [];
  for (let r = 0; r < N; r++) groups.push([...Array(N)].map((_, c) => idx(r, c)));
  for (let c = 0; c < N; c++) groups.push([...Array(N)].map((_, r) => idx(r, c)));
  for (let b = 0; b < 6; b++) {
    const cells: number[] = [];
    for (let i = 0; i < 36; i++) if (boxOf(i) === b) cells.push(i);
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

/* ─── 生成 ─── */

/** 回溯填满空盘（每格随机试 1..6），6×6 规模瞬时完成 */
export function generateSolved(rng: () => number): Grid {
  const g: Grid = new Array(36).fill(0);
  const fill = (pos: number): boolean => {
    if (pos === 36) return true;
    const vals = [1, 2, 3, 4, 5, 6];
    for (let i = vals.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [vals[i], vals[j]] = [vals[j], vals[i]];
    }
    for (const v of vals) {
      g[pos] = v;
      if (candidates(g, pos).includes(v) && fill(pos + 1)) return true;
      g[pos] = 0;
    }
    return false;
  };
  fill(0);
  return g;
}

/** 解数计数（上限 limit 剪枝；limit=2 用于唯一性检查足够快） */
export function countSolutions(g: Grid, limit = 2): number {
  let first = -1;
  let best: number[] | null = null;
  for (let i = 0; i < 36; i++) {
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

/** 生成唯一解谜题：随机挖洞，破坏唯一性则放回 */
export function generatePuzzle(diff: Difficulty, rng: () => number): Puzzle {
  const solution = generateSolved(rng);
  const puzzle = solution.slice();
  const order = [...Array(36)].map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const holes: number[] = [];
  const target = HOLES_BY_DIFF[diff];
  for (const i of order) {
    if (holes.length >= target) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle.slice(), 2) === 1) holes.push(i);
    else puzzle[i] = keep;
  }
  return { solution, puzzle, holes, diff };
}

/** 每日题（确定性种子，全球同题） */
export function dailyPuzzle(dateKey: string): Puzzle {
  return generatePuzzle('standard', mulberry32(hashString('s6-' + dateKey)));
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
  for (let i = 0; i < 36; i++) if (g[i] !== solution[i]) return false;
  return true;
}
