/**
 * 批次 2i：游戏 HTML 骨架里漏绑 data-i18n 的可见英文标签。
 *
 * 🔴 来源：冷启动 CDP 验收在金字塔对战页抓到 `[未本地化] START`，
 *    顺藤查出 4 个游戏 HTML 共 6 处裸英文：
 *      games/equation-pyramid/index.html  START / Target / Bot / Opponent / random
 *      games/{24-game,sudoku,sudoku-4x4,sudoku-6x6}/index.html  Target
 *    它们没有 data-i18n，i18n.js 的 applyToDOM() 只重写带属性的节点，
 *    所以切到中文/德语后仍是英文。
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
  'mg.shared_lbl_target': ['Target', '目标', '目標', 'Objetivo', 'Objectif', 'Ziel'],
  'mg.shared_lbl_start': ['START', '起点', '開始', 'INICIO', 'DÉPART', 'START'],
  'mg.shared_lbl_opponent': ['Opponent', '对手', '対戦相手', 'Rival', 'Adversaire', 'Gegner'],
  'mg.shared_lbl_bot': ['Bot', '机器人', 'ボット', 'Bot', 'Bot', 'Bot'],
  'mg.shared_opp_random': ['— · random', '— · 随机', '— · ランダム', '— · aleatorio', '— · aléatoire', '— · zufällig'],
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

// ── 绑 data-i18n ────────────────────────────────────────────────
const EDITS = [
  {
    file: 'games/equation-pyramid/index.html',
    subs: [
      ['<div class="ep-pn">Bot <span class="ep-side opp"><span class="d"></span>Opponent</span></div>',
       '<div class="ep-pn"><span data-i18n="mg.shared_lbl_bot">Bot</span> <span class="ep-side opp"><span class="d"></span><span data-i18n="mg.shared_lbl_opponent">Opponent</span></span></div>'],
      ['<div class="ep-ps" id="oppPace">— · random</div>',
       '<div class="ep-ps" id="oppPace" data-i18n="mg.shared_opp_random">— · random</div>'],
      ['<small>Target</small>', '<small data-i18n="mg.shared_lbl_target">Target</small>'],
      ['<small>START</small>', '<small data-i18n="mg.shared_lbl_start">START</small>'],
    ],
  },
];

for (const g of ['24-game', 'sudoku', 'sudoku-4x4', 'sudoku-6x6']) {
  EDITS.push({
    file: `games/${g}/index.html`,
    subs: [['<span class="lbl">Target</span>', '<span class="lbl" data-i18n="mg.shared_lbl_target">Target</span>']],
  });
}

for (const e of EDITS) {
  const p = join(ROOT, e.file);
  let src = readFileSync(p, 'utf8');
  for (const [from, to] of e.subs) {
    if (!src.includes(from)) {
      console.log(`  ✗ ${e.file}: 未找到 ${from.slice(0, 50)}`);
      continue;
    }
    src = src.split(from).join(to);
    console.log(`  ✓ ${e.file}: ${from.slice(0, 46)}…`);
  }
  writeFileSync(p, src, 'utf8');
}

const base = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8')));
let bad = false;
for (const lang of LANGS) {
  const n = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${lang}.json`), 'utf8')));
  console.log(`  ${n === base ? '✓' : '✗'} ${lang} = ${n}`);
  if (n !== base) bad = true;
}
process.exit(bad ? 1 : 0);
