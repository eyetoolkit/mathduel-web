/**
 * 等式金字塔引擎（纯函数，无 DOM 依赖）
 * ------------------------------------------------------------
 * 玩法：9 格（3×3），每格 = (数字 + 运算符)。target 是 apex 的目标数。
 * 玩家按点击顺序选 3 格，公式为「数字 op 数字 op 数字」=
 *   1. 第一格的运算符是 anchor（被 strike，但仍显示）——只作锚点，不参与运算；
 *   2. 第二格的运算符才是真正的运算符 1（连接第一格数字与第二格数字）；
 *   3. 第三格的运算符 = 运算符 2（连接第二格与第三格）；
 *   4. 优先级：× ÷ 优先于 + −。
 * 难度按「解的数量」分：Warm-up 8-12 / Standard 4-7 / Tricky 恰好 3（÷/×-heavy 板）。
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
  warmup: [8, 12],
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
    // 边界必须是 i+1（right = tokens[i+1]）。曾误写 i+2 导致 op2 位置的 ×/÷ 永不合并、
    // 连 a×b×c 都恒判 null（acc 循环遇 ×/÷ 走 else return null）。
    if (typeof tk === 'string' && (tk === mul || tk === div) && i + 1 < tokens.length) {
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
  // 🔴 修复 (2026-10-28 审计 P3)：原 `Number.isInteger(acc)` 对浮点误差零容忍，
  // 导致 `1÷3×3` 这类「中间非整数但结果恰好为整数」的合法解被误判无效
  // （JS 里 1/3*3 = 0.9999… 不通过整数判定）。用 1e-9 容差吸收纯浮点误差，
  // 仍会拒绝真正的非整数结果（如 1÷3 = 0.333…），不改变难度分级口径。
  const rounded = Math.round(acc * 1e9) / 1e9;
  return Number.isInteger(rounded) ? rounded : null;
}

/** 解去重：同 3 格（任意点击顺序）视为同一解。
 *  🔴 P0 修复（2026-10-27 审计）：原键含「排序算子序列」→ 同一格集以不同算子组合
 *  命中 target 时被记成多个解，而 UI 的 tripleKey 只按下标、只能 bank 一次
 *  → banked.size 永远追不上 solutions.length（实测 400 板 8% 中招），
 *  winBoard 永不触发：solo/daily 卡死在「还剩 1 个」、duel bot 无限出手。
 *  现与 UI tripleKey、banner 文案 "the same 3 numbers in any order count once"
 *  三方口径统一：只按排序下标。 */
function solutionKey(triple: number[]): string {
  return [...triple].sort((a, b) => a - b).join(',');
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
          const k2 = solutionKey([i, j, k]);
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

/** 反复生成候选直到解数命中目标区间（带预算）。
   失败时不再回落到写死的固定题（旧实现 PROB-PY-1：5000 次失败后返回 target=7 常量板且 tier 标签失真）。
   现策略：先按本档区间重试，预算耗尽后放宽到「相邻档」区间继续重试（warmup 放宽到 standard、
   tricky 放宽到 standard），仍用调用者 tier 出题但标签语义诚实——放宽档的解数区间更接近实际产出。 */
export function generateBoard(tier: Tier, rng: () => number): Board {
  const maxNum = tier === 'warmup' ? 6 : 9;
  // 放宽顺序：本档 → 相邻档（解数区间更宽，命中概率更高）
  const tierOrder: Tier[] = tier === 'tricky' ? ['tricky', 'standard'] : tier === 'warmup' ? ['warmup', 'standard'] : ['standard', 'tricky', 'warmup'];
  let attempts = 0;
  const maxAttempts = 5000;
  for (const tryTier of tierOrder) {
    const [tLo, tHi] = TIER_RANGE[tryTier];
    while (attempts++ < maxAttempts) {
      const cells = genCells(rng, maxNum);
      const target = genTarget(rng);
      const board: Board = { cells, target, tier, solutions: [] };
      const sols = findAllSolutions(board);
      if (sols.length >= tLo && sols.length <= tHi) {
        board.solutions = sols;
        return board;
      }
    }
  }
  // 三重档全失败（极低概率）：兜底「任意有解」的板，保证可玩；标签仍为调用者 tier（已尽力拓宽）。
  let fallbackAttempts = 0;
  while (fallbackAttempts++ < 2000) {
    const cells = genCells(rng, maxNum);
    const target = genTarget(rng);
    const board: Board = { cells, target, tier, solutions: [] };
    const sols = findAllSolutions(board);
    if (sols.length > 0) {
      board.solutions = sols;
      return board;
    }
  }
  // 终极兜底（理论不可达）：用一个确定有解的合法板（target=7 设计稿示例），保留可玩性。
  const fbCells: Array<{ num: number; op: Op }> = [
    { num: 5, op: '-' }, { num: 3, op: '+' }, { num: 6, op: '×' },
    { num: 6, op: '×' }, { num: 1, op: '+' }, { num: 5, op: '-' },
    { num: 6, op: '-' }, { num: 4, op: '+' }, { num: 2, op: '+' },
  ];
  return {
    cells: fbCells,
    target: 7,
    tier,
    solutions: findAllSolutions({ cells: fbCells, target: 7, tier, solutions: [] }),
  };
}

/** 把解数组变成可读的完整方程「9 - 4 × 4」（三个数，用于 tray chip / toast）。
 *  🔴 P1 修复（2026-10-27 审计）：原实现漏掉中间操作数 num_j，显示成 "5 ÷ 3"
 *  （真实方程 5 ÷ 5 − 3）→ chip/bank toast/miss toast 三处等式全错。
 *  注意：board.cells 上的 op 是引擎用 String.fromCharCode 构造的，已是正确 × ÷；
 *  不要在这里写 '×'/'÷' 字面量（会被 esbuild minify 替换为 '?'）。 */
export function describeSolution(triple: number[], board: Board): string {
  const [i, j, k] = triple;
  return `${board.cells[i].num} ${board.cells[j].op} ${board.cells[j].num} ${board.cells[k].op} ${board.cells[k].num}`;
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