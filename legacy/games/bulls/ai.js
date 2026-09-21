/* ═══════════════════════════════════════════════════════════════
   bulls 猜数字 1A2B — 前端本地核心 + 人机 AI（ESM）
   每位玩家设 4 位不重复数字(1-9)，轮流猜对方，4A 即胜。
   AI 用"候选集消除"：维护与所有反馈一致的候选，从中出招并逐步缩小。
   多档难度：easy / normal / hard（hard 用最一致候选，收敛更快）。
   ═══════════════════════════════════════════════════════════════ */

export const DIGITS = '123456789';
export const LEN = 4;

export function newGame() {
  return { secrets: [null, null], ready: [false, false], history: [], turn: 0, status: 'playing', winner: null, moveCount: 0 };
}

export function isValidSecret(v) {
  if (typeof v !== 'string' || v.length !== LEN) return false;
  const s = new Set();
  for (const ch of v) { if (!DIGITS.includes(ch) || s.has(ch)) return false; s.add(ch); }
  return true;
}

export function setSecret(g, playerIdx, v) {
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (g.history.length) return { ok: false, error: '对局已开始，不能改密' };
  if (!isValidSecret(v)) return { ok: false, error: '须为 4 位不重复数字（1-9）' };
  g.secrets[playerIdx] = v; g.ready[playerIdx] = true;
  return { ok: true, event: 'secret' };
}

export function judge(secret, guess) {
  let a = 0; const secIdx = {}, gueIdx = {};
  for (let i = 0; i < LEN; i++) {
    if (secret[i] === guess[i]) a++;
    else { secIdx[secret[i]] = (secIdx[secret[i]] || 0) + 1; gueIdx[guess[i]] = (gueIdx[guess[i]] || 0) + 1; }
  }
  let b = 0;
  for (const ch in secIdx) if (gueIdx[ch]) b += Math.min(secIdx[ch], gueIdx[ch]);
  return { a, b };
}

export function applyGuess(g, playerIdx, guess) {
  if (g.status !== 'playing') return { ok: false, error: '对局已结束' };
  if (!g.ready[0] || !g.ready[1]) return { ok: false, error: '双方尚在设密' };
  if (playerIdx !== g.turn) return { ok: false, error: '还没轮到你' };
  if (!isValidSecret(guess)) return { ok: false, error: '须为 4 位不重复数字（1-9）' };
  const opp = playerIdx === 0 ? 1 : 0;
  const { a, b } = judge(g.secrets[opp], guess);
  g.history.push({ by: playerIdx, guess, a, b });
  g.moveCount++;
  if (a === LEN) { g.status = 'over'; g.winner = playerIdx; return { ok: true, event: 'win', winner: playerIdx, a, b }; }
  g.turn = opp;
  return { ok: true, event: 'guess', a, b, turn: g.turn };
}

export function snapshot(g) {
  return { ready: g.ready, secrets: [null, null], history: g.history, turn: g.status === 'playing' ? g.turn : -1, status: g.status, winner: g.status === 'over' ? g.winner : null, moveCount: g.moveCount };
}

/* ───────────── 人机 AI ───────────── */
// 全部可能秘密（9P4 = 3024）
const ALL = (() => {
  const out = [];
  const d = DIGITS.split('');
  (function perm(pre, avail) {
    if (pre.length === LEN) { out.push(pre); return; }
    for (let i = 0; i < avail.length; i++) perm(pre + avail[i], avail.slice(0, i).concat(avail.slice(i + 1)));
  })('', d);
  return out;
})();

export function randomSecret() { return ALL[Math.floor(Math.random() * ALL.length)]; }
export function allSecrets() { return ALL; }
export function filterByFeedback(cands, guess, a, b) {
  return cands.filter(c => { const r = judge(c, guess); return r.a === a && r.b === b; });
}
export function aiNextGuess(cands, quality) {
  if (quality === 'easy' || !cands.length) return ALL[Math.floor(Math.random() * ALL.length)];
  if (quality === 'normal') {
    // 普通档偶尔乱猜一口（降低比例，避免 AI 显得随意）
    if (Math.random() < 0.1) return ALL[Math.floor(Math.random() * ALL.length)];
  }
  return cands[Math.floor(Math.random() * cands.length)];
}
