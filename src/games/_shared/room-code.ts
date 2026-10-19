// AI生成
/**
 * 房码单一真相源（2026-10-15 建立；2026-10-19 跨站统一为 6 位）
 * ----------------------------------------------------------------
 * 背景：此前生成端、校验端、maxlength、提示文案四者不一致 ——
 * 用户手输 4 位或 6 位（含 I/L/O/0/1 这些不会出现在合法房码里的字符）
 * 都能通过前端校验，然后被服务端拒绝，体验上像"房码无效"却查不出原因。
 *
 * 2026-10-19（P0-2 技术债修复）：为与 boardduel / memoryduel / 跨站共享匹配队列
 * 及后端 worker-shared/lib/room-code.js 统一，房码契约由 5 位改为 **6 位**
 * （选 6 位的理由：多数方本就是 6 位，改动面最小）。
 *
 * 契约：**固定 6 位，字符集剔除易混字符**。生成、校验、maxlength、提示文案
 * 全部从这里取，不要再各写一份。后端同值契约见 worker-shared/lib/room-code.js。
 */

/** 房码长度（固定）。输入框 maxlength 与服务端一致。 */
export const ROOM_CODE_LEN = 6;

/**
 * 房码字符集：剔除易混的 I / O / 0 / 1（保留 L —— 因 I、1 已剔除，L 无歧义对象）。
 * 剔除后为 32 个字符（24 字母 A–Z 去 I/O + 8 数字 2–9），
 * 6 位空间 = 32^6 = 1,073,741,824 种，足够抗碰撞。
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 房码校验正则（严格 6 位 + 无歧义字符集）。 */
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