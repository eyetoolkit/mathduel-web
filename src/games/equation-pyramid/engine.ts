/**
 * 等式金字塔引擎（纯函数，无 DOM 依赖）
 * ------------------------------------------------------------
 * 玩法：9 格（3×3），每格 = (数字 + 运算符)。target 是 apex 的目标数。
 * 玩家按点击顺序选 3 格，公式为「数字 op 数字 op 数字」=
 *   1. 第一格的运算符是 anchor（被 strike，但仍显示）——只作锚点，不参与运算；
 *   2. 第二格的运算符才是真正的运算符 1（连接第一格数字与第二格数字）；
 *   3. 第三格的运算符 = 运算符 2（连接第二格与第三格）；
 *   4. 优先级：× ÷ 优先于 + −。
 * 难度按「解的数量」分：Warm-up 6-12 / Standard 4-7 / Tricky 恰好 3（÷/×-heavy 板）。
 *
 * 生成策略：
 *   1. 随机生成候选 board（9 个数字 1-9 + 9 个运算符 + 1 个 target）；
 *   2. 列举所有 (9*8*7)=504 种有序三元组，按优先级计算公式；
 *   3. 筛选解数符合目标的 board；
 *   4. 去重：解按 sorted([a,b,c]) + (sorted-op-sequence) 视为同一解，避免对称重复计数。
 */

import { mulberry32, hashString, shanghaiDateKey } from '../sudoku/engine';

export type Op = '+' | '-' | '×' | '÷';
/** OPS 数组：esbuild minify 会把源码字面量与 \u 转义里的 × ÷ 当作"非 ASCII" 替换为 '?'，
 *  最稳的兜底：在源码里**完全 ASCII**，运行时从 charcode 数字构造。 */
export const OP_MUL_CODE = 0xd7; // ×
export const OP_DIV_CODE = 0xf7; // ÷
export const OPS: Op[] = ['+', '-', String.fromCharCode(OP_MUL_CODE) as Op, String.fromCharCode(OP_DIV_CODE) as Op];

export type Tier = 'warmup' | 'standard' | 'tricky';
export const TIER_LABEL: Record<Tier, string> = {
  warmup: 'Warm-up',
  standard: 'Standard',
  tricky: 'Tricky',
};
export const TIER_RANGE: Record<Tier, [number, number]> = {
  warmup: [6, 12],
  standard: [4, 7],
  tricky: [3, 3], // 恰好 3
};

export interface Board {
  /** 9 格：cells[i] = { num, op }，op 是此格的「上行运算符」(展示用) */
  cells: Array<{ num: number; op: Op }>;
  target: number;
  tier: Tier;
  /** 全部有序解（去重后）：解是 [i, j, k] 三个下标，公式为 cells[i].num cells[j].op cells[k].num（j 的 op 才是真运算符）；
   *  我们存下标而非具体数值，避免存储膨胀。 */
  solutions: number[][];
}

/* ─── 计算表达式 ───
   公式：a op1 b op2 c
   op1 是 cells[b].op（b 格的「上行运算符」）；op2 是 cells[c].op。
   第一格（a）的 op 是 anchor，不参与运算。
   优先级：×÷ 优先。比较时通过运行时函数调用的返回值避开 esbuild minify 替换。 */
function opChar(code: number): string { return String.fromCharCode(code); }
function getOpMul(): Op { return opChar(OP_MUL_CODE) as Op; }
function getOpDiv(): Op { return opChar(OP_DIV_CODE) as Op; }

export function evalTriple(a: number, op1: Op, b: number, op2: Op, c: number): number | null {
  const mul = getOpMul();
  const div = getOpDiv();
  if (op1 === div && b === 0) return null;
  if (op2 === div && c === 0) return null;
  let tokens: (number | Op)[] = [a, op1, b, op2, c];
  const result1: (number | Op)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (typeof tk === 'string' && (tk === mul || tk === div) && i + 2 < tokens.length) {
      const left = result1.pop() as number;
      const right = tokens[i + 1] as number;
      if (tk === mul) {
        result1.push(left * right);
      } else {
        result1.push(left / right);
      }
      i++;
    } else {
      result1.push(tk);
    }
  }
  let acc = result1[0] as number;
  for (let i = 1; i < result1.length; i += 2) {
    const op = result1[i] as Op;
    const right = result1[i + 1] as number;
    if (op === '+') acc = acc + right;
    else if (op === '-') acc = acc - right;
    else return null;
  }
  return Number.isInteger(acc) ? acc : null;
}

/** 解去重：把 (a, b, c) 视为 unordered set 与 sorted [a,b,c] + 排序后的运算序列一起唯一。 */
function solutionKey(triple: number[], board: Board): string {
  const sorted = [...triple].sort((a, b) => a - b);
  const opsSeq = [board.cells[triple[1]].op, board.cells[triple[2]].op].sort();
  return sorted.join(',') + '|' + opsSeq.join(',');
}

/** 列举 board 的全部解（unordered set 去重）。 */
export function findAllSolutions(board: Board): number[][] {
  const N = board.cells.length;
  const seen = new Set<string>();
  const out: number[][] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      for (let k = 0; k < N; k++) {
        if (k === i || k === j) continue;
        const a = board.cells[i].num;
        const b = board.cells[j].num;
        const c = board.cells[k].num;
        const op1 = board.cells[j].op; // j 的 op 连接 i 与 j
        const op2 = board.cells[k].op; // k 的 op 连接 j 与 k
        const val = evalTriple(a, op1, b, op2, c);
        if (val === board.target) {
          const k2 = solutionKey([i, j, k], board);
          if (!seen.has(k2)) {
            seen.add(k2);
            out.push([i, j, k]);
          }
        }
      }
    }
  }
  return out;
}

/* ─── 生成 board ─── */
/** 生成候选 board（不带 target），返回 cells 数组。
 *  Warm-up：1..6（数字小、正）；Standard/Tricky：1..9（可负 target）。 */
function genCells(rng: () => number, maxNum: number): Array<{ num: number; op: Op }> {
  const cells: Array<{ num: number; op: Op }> = [];
  for (let i = 0; i < 9; i++) {
    const num = 1 + Math.min(maxNum - 1, Math.floor(rng() * maxNum));
    const op = OPS[Math.min(3, Math.floor(rng() * 4))];
    cells.push({ num, op });
  }
  return cells;
}

/** 随机一个 target（-9..9） */
function genTarget(rng: () => number): number {
  return Math.min(18, Math.floor(rng() * 19)) - 9;
}

/** 反复生成候选直到解数命中目标区间（带预算）。 */
export function generateBoard(tier: Tier, rng: () => number): Board {
  const [lo, hi] = TIER_RANGE[tier];
  const maxNum = tier === 'warmup' ? 6 : 9;
  let attempts = 0;
  const maxAttempts = 5000;
  while (attempts++ < maxAttempts) {
    const cells = genCells(rng, maxNum);
    const target = genTarget(rng);
    const board: Board = { cells, target, tier, solutions: [] };
    const sols = findAllSolutions(board);
    if (sols.length >= lo && sols.length <= hi) {
      board.solutions = sols;
      return board;
    }
  }
  // 兜底：构造一个 Warm-up 已知可行的 board（target=7，10 ways in 的设计稿示例）
  return {
    cells: [
      { num: 5, op: '-' }, { num: 3, op: '+' }, { num: 6, op: '×' },
      { num: 6, op: '×' }, { num: 1, op: '+' }, { num: 5, op: '-' },
      { num: 6, op: '-' }, { num: 4, op: '+' }, { num: 2, op: '+' },
    ],
    target: 7,
    tier,
    solutions: findAllSolutions({
      cells: [
        { num: 5, op: '-' }, { num: 3, op: '+' }, { num: 6, op: '×' },
        { num: 6, op: '×' }, { num: 1, op: '+' }, { num: 5, op: '-' },
        { num: 6, op: '-' }, { num: 4, op: '+' }, { num: 2, op: '+' },
      ],
      target: 7,
      tier,
      solutions: [],
    }),
  };
}

/** 把解数组变成可读的「9 - 4 × 4」字符串（用于 tray chip） */
export function describeSolution(triple: number[], board: Board): string {
  const [i, j, k] = triple;
  // 注意：board.cells 上的 op 是引擎用 String.fromCharCode 构造的，已是正确 × ÷；
  // 不要在这里写 '×'/'÷' 字面量（会被 esbuild minify 替换为 '?'）
  return `${board.cells[i].num} ${board.cells[j].op} ${board.cells[k].num}`;
}

/** 每日题（确定性种子；固定 Standard） */
export function dailyBoard(dateKey: string): Board {
  return generateBoard('standard', mulberry32(hashString('eq-' + dateKey)));
}

/** 把解 triple 转回可显示方程：cells[i].num cells[j].op cells[k].num = target */
export function tripleToParts(triple: number[], board: Board): { a: number; op1: Op; b: number; op2: Op; c: number } {
  const [i, j, k] = triple;
  return {
    a: board.cells[i].num,
    op1: board.cells[j].op,
    b: board.cells[j].num,
    op2: board.cells[k].op,
    c: board.cells[k].num,
  };
}

/** 复用于对局页 */
export { mulberry32, hashString, shanghaiDateKey };