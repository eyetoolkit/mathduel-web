/**
 * 批次 2f：equation-pyramid 的结算弹窗文案。
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
  'mg.pyr_verdict_all_banked': ['All equations banked 🎉', '全部等式已存入 🎉', 'すべての方程式を保存しました 🎉', 'Todas las ecuaciones guardadas 🎉', 'Toutes les équations validées 🎉', 'Alle Gleichungen gespeichert 🎉'],
  'mg.pyr_verdict_timeup': ['⏱ Time\u2019s up', '⏱ 时间到', '⏱ 時間切れ', '⏱ Se acabó el tiempo', '⏱ Temps écoulé', '⏱ Zeit abgelaufen'],
  'mg.pyr_verdict_you_win': ['You win 🏆', '你赢了 🏆', 'あなたの勝ち 🏆', 'Ganaste 🏆', 'Vous gagnez 🏆', 'Du gewinnst 🏆'],
  'mg.pyr_verdict_draw': ['Draw 🤝', '平局 🤝', '引き分け 🤝', 'Empate 🤝', 'Égalité 🤝', 'Unentschieden 🤝'],
  'mg.pyr_verdict_bot_wins': ['Bot wins 🤖', '机器人获胜 🤖', 'ボットの勝利 🤖', 'Gana el bot 🤖', 'Le bot gagne 🤖', 'Bot gewinnt 🤖'],
  'mg.pyr_lbl_your_time': ['your time', '你的用时', 'あなたのタイム', 'tu tiempo', 'votre temps', 'deine Zeit'],
  'mg.pyr_lbl_boards_cleared': ['boards cleared', '已通关棋盘', 'クリア盤面', 'tableros completados', 'plateaux terminés', 'gelöste Raster'],
  'mg.pyr_lbl_your_banks': ['your banks', '你的存入数', 'あなたの保存数', 'tus depositadas', 'vos validées', 'deine Treffer'],
  'mg.pyr_lbl_bot_banks': ['Bot banks', '机器人存入数', 'ボットの保存数', 'del bot', 'du bot', 'Bot-Treffer'],
  'mg.pyr_exhausted_html': ['✅ Exhausted in <b>{time}</b>', '✅ 用时 <b>{time}</b> 全部通关', '✅ <b>{time}</b> で全問クリア', '✅ Completado en <b>{time}</b>', '✅ Tout validé en <b>{time}</b>', '✅ Alles geschafft in <b>{time}</b>'],
  'mg.pyr_draw_banks_html': ['🤝 Draw — <b>{n}</b> banks each', '🤝 平局 —— 双方各 <b>{n}</b> 条', '🤝 引き分け —— 双方 <b>{n}</b> 件', '🤝 Empate — <b>{n}</b> cada uno', '🤝 Égalité — <b>{n}</b> chacun', '🤝 Unentschieden — je <b>{n}</b>'],
  'mg.pyr_btn_new_board': ['↻ New board', '↻ 换一座金字塔', '↻ 新しい盤面', '↻ Nuevo tablero', '↻ Nouveau plateau', '↻ Neues Raster'],
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
