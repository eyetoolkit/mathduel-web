/**
 * 批次 2c：nakedReason 的 box 尺寸因游戏而异（4×4/6×6 是 2×2，9×9 是 3×3），
 * 必须按尺寸分键，不能共用一条 —— 否则 9×9 会显示「2×2 宫」。
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
  // 删除批次 2 里那条写死 2×2 的键（9×9 用它就是错文案）
  __delete__: ['mg.sd_reason_box'],
  'mg.sd_reason_box2': [
    'only digit missing from its 2×2 box',
    '该 2×2 宫只缺这个数字',
    'その 2×2 ボックスでこの数字だけが欠けている',
    'solo falta este dígito en su caja 2×2',
    'seul chiffre manquant de sa boîte 2×2',
    'nur diese Ziffer fehlt in seiner 2×2-Box',
  ],
  'mg.sd_reason_box3': [
    'only digit missing from its 3×3 box',
    '该 3×3 宫只缺这个数字',
    'その 3×3 ボックスでこの数字だけが欠けている',
    'solo falta este dígito en su caja 3×3',
    'seul chiffre manquant de sa boîte 3×3',
    'nur diese Ziffer fehlt in seiner 3×3-Box',
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
  for (const key of T.__delete__) {
    const [ns, leaf] = key.split('.');
    if (obj[ns] && leaf in obj[ns]) delete obj[ns][leaf];
  }
  for (const [key, vals] of Object.entries(T)) {
    if (key === '__delete__') continue;
    set(obj, key, vals[i]);
  }
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
