/**
 * 批次 2b：需要内嵌 <b> 的句子改用 `_html` 后缀键（沿用 mg.g24_share_scan_html 的既有约定）。
 *
 * 🔴 为什么不直接 escHtml()：像 "✅ Solved in {time}" 这种句子，
 *    译文本身不含标签，但数字需要加粗。escHtml 后再插 <b> 只能靠
 *    正则切字符串 —— 那在多语言下极脆（德语变长、西语重音）。
 *    正确做法是把 <b> 写进词典的 `_html` 键，译文与结构分离。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];

const set = (obj, dotted, value) => {
  const parts = dotted.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) node = (node[parts[i]] ||= {});
  node[parts[parts.length - 1]] = value;
};

const T = {
  'mg.sd_solved_in_html': [
    '✅ Solved in <b>{time}</b>',
    '✅ 用时 <b>{time}</b> 解出',
    '✅ <b>{time}</b> で正解',
    '✅ Resuelto en <b>{time}</b>',
    '✅ Résolu en <b>{time}</b>',
    '✅ In <b>{time}</b> gelöst',
  ],
  'mg.sd_timed_next_incoming_html': [
    '✅ #{n} in <b>{time}</b> — next grid incoming…',
    '✅ 第 {n} 盘用时 <b>{time}</b> —— 下一盘即将开始…',
    '✅ #{n} を <b>{time}</b> で —— 次の盤面へ…',
    '✅ #{n} en <b>{time}</b> — ¡llega la siguiente cuadrícula!',
    '✅ #{n} en <b>{time}</b> — grille suivante en approche…',
    '✅ #{n} in <b>{time}</b> — nächstes Raster kommt…',
  ],
  'mg.sd_duel_you_win_html': [
    '🏆 You filled your half in <b>{time}</b> — GridBot stalled at {done}/{total}',
    '🏆 你用 <b>{time}</b> 填满自己的一半 —— GridBot 卡在 {done}/{total}',
    '🏆 <b>{time}</b> で自分の半分を埋めた —— GridBot は {done}/{total} で停止',
    '🏆 Llenaste tu mitad en <b>{time}</b> — GridBot se quedó en {done}/{total}',
    '🏆 Vous avez rempli votre moitié en <b>{time}</b> — GridBot bloqué à {done}/{total}',
    '🏆 Du hast deine Hälfte in <b>{time}</b> gefüllt — GridBot blieb bei {done}/{total}',
  ],
  'mg.sd_duel_bot_win_html': [
    '🤖 GridBot finished first (<b>{time}</b>) — you had {done}/{total}',
    '🤖 GridBot 先完成（<b>{time}</b>）—— 你完成到 {done}/{total}',
    '🤖 GridBot が先に完成（<b>{time}</b>）—— あなたは {done}/{total}',
    '🤖 GridBot terminó primero (<b>{time}</b>) — tú tenías {done}/{total}',
    '🤖 GridBot a terminé en premier (<b>{time}</b>) — vous aviez {done}/{total}',
    '🤖 GridBot war zuerst fertig (<b>{time}</b>) — du hattest {done}/{total}',
  ],
};

const flatLen = (o, pfx = '') =>
  Object.entries(o).reduce(
    (n, [k, v]) => n + (v && typeof v === 'object' && !Array.isArray(v) ? flatLen(v, `${pfx}${k}.`) : 1),
    0,
  );

for (let i = 0; i < LANGS.length; i += 1) {
  const lang = LANGS[i];
  const p = join(ROOT, 'public', 'i18n', `${lang}.json`);
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  for (const [key, vals] of Object.entries(T)) set(obj, key, vals[i]);
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

const base = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8')));
let bad = false;
for (const lang of LANGS) {
  const n = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${lang}.json`), 'utf8')));
  console.log(`  ${n === base ? '✓' : '✗'} ${lang} = ${n}`);
  if (n !== base) bad = true;
}
process.exit(bad ? 1 : 0);
