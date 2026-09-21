/**
 * 猜数字 1A2B（Bulls & Cows）· 纯逻辑引擎
 *
 * 规则：双方各设一个 4 位不重复数字（1-9），轮流猜对方的数。
 * 数字与位置都对记 A，数字对但位置错记 B，先猜出 4A 者胜。
 *
 * AI 采用「候选集消除」：维护与所有历史反馈一致的候选集，从中出招并逐步收敛。
 * 本文件为纯函数，不触碰 DOM，便于单测与复用。
 */

export const DIGITS = '123456789';
export const LEN = 4;

export type Player = 0 | 1;
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BullsGame {
  secrets: [string | null, string | null];
  ready: [boolean, boolean];
  history: HistoryEntry[];
  turn: Player;
  status: 'playing' | 'over';
  winner: Player | null;
  moveCount: number;
}

export interface HistoryEntry {
  by: Player;
  guess: string;
  a: number;
  b: number;
}

export interface Feedback {
  a: number;
  b: number;
}

export function newGame(): BullsGame {
  return {
    secrets: [null, null],
    ready: [false, false],
    history: [],
    turn: 0,
    status: 'playing',
    winner: null,
    moveCount: 0,
  };
}

/** 校验是否为合法的 4 位不重复数字（1-9） */
export function isValidSecret(v: unknown): boolean {
  if (typeof v !== 'string' || v.length !== LEN) return false;
  const seen = new Set<string>();
  for (const ch of v) {
    if (!DIGITS.includes(ch) || seen.has(ch)) return false;
    seen.add(ch);
  }
  return true;
}

export function setSecret(g: BullsGame, playerIdx: Player, v: string): { ok: boolean; error?: string } {
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (g.history.length) return { ok: false, error: '对局已开始，不能改密' };
  if (!isValidSecret(v)) return { ok: false, error: '须为 4 位不重复数字（1-9）' };
  g.secrets[playerIdx] = v;
  g.ready[playerIdx] = true;
  return { ok: true };
}

/** 计算猜测的 A / B */
export function judge(secret: string, guess: string): Feedback {
  let a = 0;
  const secRest: Record<string, number> = {};
  const gueRest: Record<string, number> = {};
  for (let i = 0; i < LEN; i++) {
    if (secret[i] === guess[i]) a++;
    else {
      secRest[secret[i]] = (secRest[secret[i]] || 0) + 1;
      gueRest[guess[i]] = (gueRest[guess[i]] || 0) + 1;
    }
  }
  let b = 0;
  for (const ch in secRest) if (gueRest[ch]) b += Math.min(secRest[ch], gueRest[ch]);
  return { a, b };
}

export function applyGuess(
  g: BullsGame,
  playerIdx: Player,
  guess: string,
): { ok: boolean; error?: string; a?: number; b?: number; win?: boolean } {
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (!g.ready[0] || !g.ready[1]) return { ok: false, error: '双方尚未设密' };
  if (playerIdx !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!isValidSecret(guess)) return { ok: false, error: '须为 4 位不重复数字（1-9）' };

  const opp: Player = playerIdx === 0 ? 1 : 0;
  const { a, b } = judge(g.secrets[opp] as string, guess);
  g.history.push({ by: playerIdx, guess, a, b });
  g.moveCount++;

  if (a === LEN) {
    g.status = 'over';
    g.winner = playerIdx;
    return { ok: true, a, b, win: true };
  }
  g.turn = opp;
  return { ok: true, a, b, win: false };
}

/* ───────────── AI：候选集消除 ───────────── */

/** 全部可能的秘密（9P4 = 3024） */
const ALL: readonly string[] = (() => {
  const out: string[] = [];
  const d = DIGITS.split('');
  (function perm(pre: string, avail: string[]) {
    if (pre.length === LEN) {
      out.push(pre);
      return;
    }
    for (let i = 0; i < avail.length; i++) {
      perm(pre + avail[i], avail.slice(0, i).concat(avail.slice(i + 1)));
    }
  })('', d);
  return out;
})();

export function allSecrets(): readonly string[] {
  return ALL;
}

export function randomSecret(): string {
  return ALL[Math.floor(Math.random() * ALL.length)];
}

/** 用一次反馈过滤候选集 */
export function filterByFeedback(cands: readonly string[], guess: string, a: number, b: number): string[] {
  return cands.filter((c) => {
    const r = judge(c, guess);
    return r.a === a && r.b === b;
  });
}

/** AI 出招：easy 随机；normal 少量随机扰动；hard 严格从候选集中取 */
export function aiNextGuess(cands: readonly string[], quality: Difficulty): string {
  if (quality === 'easy' || !cands.length) return ALL[Math.floor(Math.random() * ALL.length)];
  if (quality === 'normal' && Math.random() < 0.1) {
    return ALL[Math.floor(Math.random() * ALL.length)];
  }
  return cands[Math.floor(Math.random() * cands.length)];
}
