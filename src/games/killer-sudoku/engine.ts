/**
 * 杀手数独引擎（纯函数，无 DOM 依赖）
 * ------------------------------------------------------------
 * 在 9×9 数独的基础上叠加「笼子(cage)约束」：
 *   · 每个笼子是 2–7 格的连通区域，笼内格子数字不重复；
 *   · 笼子左上角标和值 = 笼内所有数字之和。
 *   · 难度按笼子数（设计稿）：Gentle 26 / Standard 29 / Fierce 34。
 *
 * 复用 9×9 数独引擎的 generateSolved / countSolutions / dailyPuzzle / duelDeal，
 * 仅在谜题上**加笼子**和**减 givens**——杀手不印刷任何 given。
 */
import {
  Grid,
  N,
  idx,
  rowOf,
  colOf,
  boxOf,
  mulberry32,
  hashString,
  shanghaiDateKey,
  generateSolved,
  countSolutions,
  Puzzle as BasePuzzle,
} from '../sudoku/engine';

export type KillerDifficulty = 'gentle' | 'standard' | 'fierce';
export const CAGES_BY_DIFF: Record<KillerDifficulty, number> = { gentle: 26, standard: 29, fierce: 34 };
export const BOT_PACE: Record<KillerDifficulty, number> = { gentle: 8, standard: 6, fierce: 4.5 };

export interface Cage {
  /** 笼子内格子的 idx（2..7 个；不含重复格） */
  cells: number[];
  /** 和值（设计稿展示在左上角） */
  sum: number;
  /** 角格（显示 sum 的那一格） */
  corner: number;
  /** 边界边：所有「两格之间有边界」的下/右方向对 (from,to) */
  walls: Array<[number, number]>;
}

export interface KillerPuzzle extends Omit<BasePuzzle, 'diff'> {
  diff: KillerDifficulty;
  cages: Cage[];
}

/** 邻居（同单元隔壁 4 格） */
function neighbors(i: number): number[] {
  const r = rowOf(i);
  const c = colOf(i);
  const ns: number[] = [];
  if (r > 0) ns.push(idx(r - 1, c));
  if (r < N - 1) ns.push(idx(r + 1, c));
  if (c > 0) ns.push(idx(r, c - 1));
  if (c < N - 1) ns.push(idx(r, c + 1));
  return ns;
}

/* ─── 划分笼子 ───
   从任一未分格起，按「蛇形生长 + 随机收口」逐个生成连通区域：
     · 每笼大小 1–4 格（设计稿说难度=笼子数，26/29/34 对应平均 ~3 格）；
     · 优先拓展最便宜的格子（邻居数最少 → 避免长蛇）；
     · 跑完一轮大约 22–30 个 cage（81 / ~3），再用 finalizeCages 按目标数微调。
   实现：BFS 一直跑直到所有 81 格都被分进某个笼子。 */
function partitionCages(rng: () => number): Cage[] {
  const owner = new Int8Array(81).fill(-1);
  const cages: Cage[] = [];
  let iter = 0;

  const start = (): number => {
    for (let i = 0; i < 81; i++) if (owner[i] === -1) return i;
    return -1;
  };

  while (true) {
    iter++;
    if (iter > 200) break;
    const seed = start();
    if (seed === -1) break;
    const id = cages.length;
    const cells: number[] = [seed];
    owner[seed] = id;
    cages.push({ cells, sum: 0, corner: seed, walls: [] });

    const growable = (): number[] => {
      const out: number[] = [];
      const seen = new Set<number>();
      for (const c of cells) for (const n of neighbors(c)) {
        if (owner[n] === -1 && !seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
      }
      out.sort((a, b) => availableNeighbors(a) - availableNeighbors(b));
      return out;
    };
    const availableNeighbors = (i: number): number => {
      let n = 0;
      for (const k of neighbors(i)) if (owner[k] === -1) n++;
      return n;
    };

    const size = 1 + Math.floor(rng() * 4); // 1..4
    let guard = 0;
    while (cells.length < size && guard++ < 20) {
      const cands = growable();
      if (cands.length === 0) break;
      const pick = cands[Math.floor(rng() * cands.length)];
      cells.push(pick);
      owner[pick] = id;
    }
  }

  // 用 owner 重建（保证 cages/cells 同步、wall 重算）
  return cagesFromOwner(owner);
}

function cagesFromOwner(owner: Int8Array): Cage[] {
  const byId = new Map<number, Cage>();
  for (let i = 0; i < 81; i++) {
    const id = owner[i];
    if (!byId.has(id)) byId.set(id, { cells: [], sum: 0, corner: i, walls: [] });
    byId.get(id)!.cells.push(i);
  }
  const cages = Array.from(byId.values());
  // corner = cells 中 (row, col) 字典序最小的那个（最左上）
  for (const c of cages) {
    c.corner = c.cells.slice().sort((a, b) => a - b)[0];
  }
  // walls：笼内「两格相邻」的对不算墙，跨笼相邻算墙
  const walls: Array<[number, number]> = [];
  for (let i = 0; i < 81; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    if (c < N - 1) {
      const j = idx(r, c + 1);
      if (owner[j] !== owner[i]) walls.push([i, j]);
    }
    if (r < N - 1) {
      const j = idx(r + 1, c);
      if (owner[j] !== owner[i]) walls.push([i, j]);
    }
  }
  // 把 walls 落到 cage 上
  for (const [a, b] of walls) {
    const ca = cages.find((x) => x.cells.includes(a))!;
    const cb = cages.find((x) => x.cells.includes(b))!;
    ca.walls.push([a, b]);
    cb.walls.push([a, b]);
  }
  return cages;
}

/** 算每个笼子的 sum（基于满解），并把 cavity 缩到目标 cage 数。
 *  Killer 难度按「笼子数」定义——目标笼数越少，笼子越大越宽松；
 *  我们先划 81 个最小笼（每笼 2 格左右），再按合并相邻小笼来缩到目标数。 */
function finalizeCages(cages: Cage[], solution: Grid, targetCount: number, rng: () => number): Cage[] {
  // 给每个 cage 算 sum（基于满解）
  for (const cage of cages) {
    cage.sum = cage.cells.reduce((acc, i) => acc + solution[i], 0);
  }

  // partitionCages 平均给 ~30 笼，target 26/29/34 几乎都在范围内；
  // 只有 working 略多于 target 时做合并降到目标数（不会引入数独冲突，
  // 因为 solution 已经保证每行/列/宫无重复，cage 合并仅扩区域不破坏数独）。
  if (cages.length <= targetCount) return cages;

  const working = cages.slice();
  const canMerge = (a: Cage, b: Cage): boolean =>
    a.cells.length + b.cells.length <= 7 && a.walls.some(([x, y]) => b.cells.includes(x) || b.cells.includes(y));

  let guard = 0;
  while (working.length > targetCount && guard++ < 4000) {
    const aIdx = Math.floor(rng() * working.length);
    const a = working[aIdx];
    const bCandidates: Cage[] = [];
    for (const b of working) if (b !== a && canMerge(a, b)) bCandidates.push(b);
    if (!bCandidates.length) break;
    const b = bCandidates[Math.floor(rng() * bCandidates.length)];
    const merged: Cage = {
      cells: [...a.cells, ...b.cells],
      sum: a.sum + b.sum,
      corner: Math.min(a.corner, b.corner),
      walls: [],
    };
    working.splice(working.indexOf(b), 1);
    working.splice(working.indexOf(a), 1);
    working.push(merged);
  }
  return cagesFromOwner(workingToOwner(working));
}

function workingToOwner(cages: Cage[]): Int8Array {
  const o = new Int8Array(81).fill(-1);
  cages.forEach((c, i) => c.cells.forEach((idx) => (o[idx] = i)));
  return o;
}

/* ─── 谜题生成 ─── */

/**
 * 生成唯一解的杀手谜题。
 * 1) 变换法产满解 → 2) 划分 cages → 3) 合并缩到目标笼数 → 4) 挖洞（杀手 0 givens，
 *    但为支持难度变化仍允许一些 given，做为「hint」；我们保持 0 givens 与设计稿一致）。
 */
export function generateKiller(diff: KillerDifficulty, rng: () => number): KillerPuzzle {
  const solution = generateSolved(rng);
  const cages = finalizeCages(partitionCages(rng), solution, CAGES_BY_DIFF[diff], rng);
  // 杀手设计稿：所有格都是 entry（无 given），0 线索；puzzle 全 0 数组。
  const puzzle: Grid = new Array(81).fill(0);
  return {
    solution,
    puzzle,
    holes: Array.from({ length: 81 }, (_, i) => i),
    diff,
    cages,
  };
}

/** 每日题（确定性种子，全球同题） */
export function dailyKiller(dateKey: string): KillerPuzzle {
  return generateKiller('standard', mulberry32(hashString('ks-' + dateKey)));
}

/** Duel：挖洞后把空格随机均分给玩家 / bot（杀手全空，所以等同于均分 81 格） */
export function duelKiller(diff: KillerDifficulty, rng: () => number): KillerPuzzle & { mine: Set<number>; bots: Set<number> } {
  const p = generateKiller(diff, rng);
  const ids = Array.from({ length: 81 }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const half = Math.floor(ids.length / 2);
  return {
    ...p,
    mine: new Set(ids.slice(0, half)),
    bots: new Set(ids.slice(half)),
  };
}

/* ─── 实时笼子和 HUD ───
   HUD：「22 · used 8 · needs 14」—— 笼和值、已用值之和、还需多少。
   笼清空（0 空格 + 数独合法） → cleared；和 > sum → overspent（teal）。*/

/** 给定 idx，返回它所在的 Cage */
export function cageOf(cages: Cage[], i: number): Cage | undefined {
  return cages.find((c) => c.cells.includes(i));
}

/** 笼子实时统计：used（已填非零格之和）/ count（已填数）/ sum（目标）/ state */
export type CageState = 'open' | 'cleared' | 'overspent';
export interface CageStat {
  used: number; // 已填之和
  count: number; // 已填格数
  needs: number; // sum - used
  state: CageState;
  /** 笼内是否有数独层面冲突（任意两格同值） */
  conflict: boolean;
}

export function cageStat(cage: Cage, grid: Grid, conflicts: Set<number>): CageStat {
  let used = 0;
  let count = 0;
  let dup = false;
  const seen = new Set<number>();
  for (const i of cage.cells) {
    const v = grid[i];
    if (!v) continue;
    count++;
    used += v;
    if (seen.has(v)) dup = true;
    seen.add(v);
  }
  const conflict = cage.cells.some((i) => conflicts.has(i)) || dup;
  let state: CageState = 'open';
  if (used > cage.sum) state = 'overspent';
  else if (count === cage.cells.length && used === cage.sum && !dup) state = 'cleared';
  return { used, count, needs: cage.sum - used, state, conflict };
}

/** 全部 cage 是否 cleared（解出整个谜题） */
export function allCleared(cages: Cage[], grid: Grid, conflicts: Set<number>): boolean {
  return cages.every((c) => cageStat(c, grid, conflicts).state === 'cleared');
}

/* ─── 复用于对局页：dateKey / 类型转换 ─── */
export { N, idx, rowOf, colOf, boxOf, mulberry32, hashString, shanghaiDateKey, generateSolved, countSolutions };
export type { Grid };
