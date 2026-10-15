/**
 * 批次 2g：equation-pyramid 对战结算的两条 `#result` 文案（内嵌 <b>，故用 _html 键）。
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
  'mg.pyr_duel_you_bank_html': [
    '🏆 You banked more — <b>{n}</b> of <b>{total}</b>',
    '🏆 你存入更多 —— <b>{n}</b>/<b>{total}</b>',
    '🏆 あなたの保存数が多い —— <b>{n}</b>/<b>{total}</b>',
    '🏆 Guardaste más — <b>{n}</b> de <b>{total}</b>',
    '🏆 Vous avez validé plus — <b>{n}</b> sur <b>{total}</b>',
    '🏆 Du hast mehr gespeichert — <b>{n}</b> von <b>{total}</b>',
  ],
  'mg.pyr_duel_bot_bank_html': [
    '🤖 Bot banked more — <b>{b}</b> vs <b>{p}</b>',
    '🤖 机器人存入更多 —— <b>{b}</b> 对 <b>{p}</b>',
    '🤖 ボットの保存数が多い —— <b>{b}</b> 対 <b>{p}</b>',
    '🤖 El bot guardó más — <b>{b}</b> contra <b>{p}</b>',
    '🤖 Le bot a validé plus — <b>{b}</b> contre <b>{p}</b>',
    '🤖 Der Bot hat mehr gespeichert — <b>{b}</b> gegen <b>{p}</b>',
  ],
};

const flatLen = (o, pfx = '') =>
  Object.entries(o).reduce(
    (n, [k, v]) => n + (v && typeof v === 'object' && !Array.isArray(v) ? flatLen(v, `${pfx}${k}.`) : 1),
    0,
  );

for (let i = 0; i < LANGS.length; i += 1) {
  const p = join(ROOT, 'public', 'i18n', `${LANGS[i]}.json`);
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
