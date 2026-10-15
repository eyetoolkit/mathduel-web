/**
 * 房码单一真相源（2026-10-15）
 * ----------------------------------------------------------------
 * 背景：此前生成端用 5 位无歧义字符集，校验端用 /^[A-Z0-9]{4,6}$/，
 * 文案又写 "4–6 character code"，maxlength 还有 5 和 6 两种 —— 三处不一致。
 * 用户手输 4 位或 6 位（含 I/L/O/0/1 这些本来不会出现在合法房码里的字符）
 * 都能通过前端校验，然后被服务端拒绝，体验上像"房码无效"却查不出原因。
 *
 * 契约：**固定 5 位，字符集剔除易混字符**。生成、校验、maxlength、提示文案
 * 全部从这里取，不要再各写一份。
 */

/** 房码长度（固定）。输入框 maxlength 与服务端一致。 */
export const ROOM_CODE_LEN = 5;

/**
 * 房码字符集：剔除 I / L / O / 0 / 1 五对易混字符。
 * 剔除后仍有 23 + 5 = 28 个字符，5 位空间 = 17,210,368 种，足够抗碰撞。
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 房码校验正则（严格 5 位 + 无歧义字符集）。 */
export const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LEN}}$`);

/** 生成一个随机房码。 */
export function genRoomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}

/**
 * 规范化用户输入：大写 + 剔除非法字符 + 截断到 ROOM_CODE_LEN。
 * 用户从小票/手输时大小写与误触空格都很常见，先规整再校验。
 */
export function normalizeRoomCode(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g'), '')
    .slice(0, ROOM_CODE_LEN);
}

/** 是否是合法房码（调用前建议先 normalizeRoomCode）。 */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}
