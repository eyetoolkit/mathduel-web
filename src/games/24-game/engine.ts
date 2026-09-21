/**
 * 24 点游戏 · 引擎（纯函数，无 DOM 依赖）
 * 移植自原 24-game/index.html（已验证各难度 500–2000 把全部可解），逻辑逐字保留。
 * 拆为独立模块的目的：可单测、可复用、可被每日挑战与竞赛共同调用。
 */

export type Difficulty = 'easy' | 'standard' | 'hard';

export interface Node24 {
  value: number;
  expr: string;
}

/** 保留 6 位小数，消除浮点误差累积 */
export function sround(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 递归求解：返回 [值, 表达式] 或 null */
export function solve(nums: Node24[]): [number, string] | null {
  if (nums.length === 1) {
    if (Math.abs(nums[0].value - 24) < 0.0001) return [nums[0].value, nums[0].expr];
    return null;
  }
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      const a = nums[i];
      const b = nums[j];
      const rest = nums.filter((_, k) => k !== i && k !== j);
      const ops: { val: number; sym: string; ae: string; be: string }[] = [
        { val: sround(a.value + b.value), sym: '+', ae: a.expr, be: b.expr },
        { val: sround(a.value - b.value), sym: '-', ae: a.expr, be: b.expr },
        { val: sround(b.value - a.value), sym: '-', ae: b.expr, be: a.expr },
        { val: sround(a.value * b.value), sym: '*', ae: a.expr, be: b.expr },
      ];
      if (Math.abs(b.value) > 0.0001) ops.push({ val: sround(a.value / b.value), sym: '/', ae: a.expr, be: b.expr });
      if (Math.abs(a.value) > 0.0001) ops.push({ val: sround(b.value / a.value), sym: '/', ae: b.expr, be: a.expr });
      for (const op of ops) {
        const r = solve([...rest, { value: op.val, expr: '(' + op.ae + ' ' + op.sym + ' ' + op.be + ')' }]);
        if (r) return r;
      }
    }
  }
  return null;
}

/** 当前牌面共有多少种不同解法 */
export function countSolutions(numbers: number[]): number {
  const sols = new Set<string>();
  const init: Node24[] = numbers.map((n) => ({ value: n, expr: String(n) }));
  (function find(ns: Node24[]) {
    if (ns.length === 1) {
      if (Math.abs(ns[0].value - 24) < 0.0001) sols.add(ns[0].expr);
      return;
    }
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i];
        const b = ns[j];
        const rest = ns.filter((_, k) => k !== i && k !== j);
        const ops: { val: number; sym: string; ae: string; be: string }[] = [
          { val: sround(a.value + b.value), sym: '+', ae: a.expr, be: b.expr },
          { val: sround(a.value - b.value), sym: '-', ae: a.expr, be: b.expr },
          { val: sround(b.value - a.value), sym: '-', ae: b.expr, be: a.expr },
          { val: sround(a.value * b.value), sym: '*', ae: a.expr, be: b.expr },
        ];
        if (Math.abs(b.value) > 0.0001) ops.push({ val: sround(a.value / b.value), sym: '/', ae: a.expr, be: b.expr });
        if (Math.abs(a.value) > 0.0001) ops.push({ val: sround(b.value / a.value), sym: '/', ae: b.expr, be: a.expr });
        for (const op of ops) find([...rest, { value: op.val, expr: '(' + op.ae + ' ' + op.sym + ' ' + op.be + ')' }]);
      }
    }
  })(init);
  return sols.size;
}

/** 发牌：保证生成的牌面一定可解 */
export function generate24Puzzle(rng?: () => number, diff?: Difficulty, maxTries = 600): number[] {
  const rand = rng || Math.random;
  const d = diff || 'standard';
  const MAX_V = d === 'easy' ? 9 : 13;
  const HARD_BIG = 0.5;
  const HARD_PRIME = 0.6;
  function pickHard(): number {
    if (rand() < HARD_BIG) {
      if (rand() < HARD_PRIME) return [11, 13][Math.floor(rand() * 2)];
      return 10 + Math.floor(rand() * 3);
    }
    return 1 + Math.floor(rand() * 9);
  }
  for (let t = 0; t < maxTries; t++) {
    const ns = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) ns[i] = d === 'hard' ? pickHard() : 1 + Math.floor(rand() * MAX_V);
    if (solve(ns.map((v) => ({ value: v, expr: String(v) })))) return ns;
  }
  return [3, 3, 8, 8];
}

/** 输入符号归一化（全角 / 各种乘除号 → ASCII） */
export function normalize24(s: string): string {
  return String(s)
    .replace(/[×·＊]/g, '*')
    .replace(/[＋]/g, '+')
    .replace(/[÷∕]/g, '/')
    .replace(/[−－–—]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

/** 括号是否配平、末尾是否残缺 */
export function isCompleteExpr(f: string): boolean {
  let d = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '(') d++;
    else if (f[i] === ')') {
      d--;
      if (d < 0) return false;
    }
  }
  if (d !== 0) return false;
  const l = f[f.length - 1];
  return !('+-*/'.includes(l) || l === '(');
}

/** 安全求值：自写递归下降解析器（不用 eval，杜绝注入） */
export function safeEval(expr: string): number {
  const s = String(expr).replace(/[ \t\r\n]+/g, '');
  let p = 0;
  const pk = () => s[p];
  function num(): number {
    const st = p;
    while (p < s.length && ((s[p] >= '0' && s[p] <= '9') || s[p] === '.')) p++;
    if (p === st) throw new Error('bad expr');   // 缺操作数（如 "1+"）→ 视为残缺表达式
    const v = parseFloat(s.slice(st, p));
    if (!Number.isFinite(v)) throw new Error('bad expr');
    return v;
  }
  function factor(): number {
    if (pk() === '(') {
      p++;
      const v = e2();
      p++;
      return v;
    }
    if (pk() === '-') {
      p++;
      return -factor();
    }
    if (pk() === '+') {
      p++;
      return factor();
    }
    return num();
  }
  function term(): number {
    let v = factor();
    while (pk() === '*' || pk() === '/') {
      const o = s[p++];
      const r = factor();
      v = o === '*' ? v * r : v / r;
    }
    return v;
  }
  function e2(): number {
    let v = term();
    while (pk() === '+' || pk() === '-') {
      const o = s[p++];
      const r = term();
      v = o === '+' ? v + r : v - r;
    }
    return v;
  }
  const r = e2();
  if (p !== s.length) throw new Error('bad expr');
  return r;
}

/** 可复现随机数（每日挑战用：日期种子 → 全球同题） */
export function SeededRandom(seed: number): () => number {
  let s = seed || 1;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 当日种子：年-月-日 × 游戏标识 */
export function dailySeed(date = new Date()): number {
  const key = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  return key * 1000 + (hashString('24-game') % 1000);
}

/** 当日文案 key，如 #Sep 21 */
export function dailyKeyStr(date = new Date()): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '#' + M[date.getMonth()] + ' ' + date.getDate();
}
