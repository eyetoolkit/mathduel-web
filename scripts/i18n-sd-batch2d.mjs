/**
 * 批次 2d：补两个 4×4 侧栏用到的键。
 *  - mg.sd_panel_best_time：4×4 只存单一模式的最佳成绩（6×6/9×9 是按难度三行），标题用单数。
 *  - mg.sd_lbl_solo_short：4×4 侧栏那行的行标签，直接复用 mg.sd_banner_solo 会把「🎯 」图标也带进来。
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
  'mg.sd_panel_best_time': ['🏅 Best time', '🏅 最佳成绩', '🏅 自己ベスト', '🏅 Mejor tiempo', '🏅 Meilleur temps', '🏅 Beste Zeit'],
  'mg.sd_lbl_solo_short': ['Solo', '单人', 'ソロ', 'Solo', 'Solo', 'Solo'],
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
