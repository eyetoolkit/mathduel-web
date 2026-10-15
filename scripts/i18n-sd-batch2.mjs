/**
 * 批次 2：三个数独 + 金字塔的游戏内剩余硬编码英文 → 六语字典。
 * 用法：node scripts/i18n-sd-batch2.mjs
 *
 * 🔴 沿用 i18n-apply-additions.mjs 的红线：不直接 git checkout 单语言文件。
 * 本脚本只做「按路径写入」，写完自行校验六语 key 对齐。
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

/** 六语对照表：key → [en, zh, ja, es, fr, de] */
const T = {
  'mg.sd_verdict_complete': ['Grid complete 🎉', '本盘完成 🎉', 'パズル完成 🎉', 'Cuadrícula completa 🎉', 'Grille terminée 🎉', 'Raster vollständig 🎉'],
  'mg.sd_verdict_out_of_lives': ['Out of lives', '机会用尽', 'ライフ切れ', 'Sin vidas', 'Plus de vies', 'Keine Leben mehr'],
  'mg.sd_verdict_timeup': ['⏱ Time\u2019s up', '⏱ 时间到', '⏱ 時間切れ', '⏱ Se acabó el tiempo', '⏱ Temps écoulé', '⏱ Zeit abgelaufen'],
  'mg.sd_lbl_your_time': ['your time', '你的用时', 'あなたのタイム', 'tu tiempo', 'votre temps', 'deine Zeit'],
  'mg.sd_lbl_mistakes': ['mistakes', '次错误', '回ミス', 'errores', 'erreurs', 'Fehler'],
  'mg.sd_lbl_solved': ['solved', '已解出', '正解', 'resueltos', 'résolus', 'gelöst'],
  'mg.sd_lbl_best_streak': ['best streak', '最佳连对', '最高連続', 'mejor racha', 'meilleure série', 'beste Serie'],
  'mg.sd_lbl_unsolved': ['unsolved', '未解出', '未正解', 'sin resolver', 'non résolus', 'ungelöst'],
  'mg.sd_lbl_you': ['you', '你', 'あなた', 'tú', 'vous', 'du'],
  'mg.sd_lbl_mistakes_count': ['{n} mistakes', '{n} 次错误', '{n} 回ミス', '{n} errores', '{n} erreurs', '{n} Fehler'],
  'mg.sd_solved_in': ['✅ Solved in {time}', '✅ 用时 {time} 解出', '✅ {time} で正解', '✅ Resuelto en {time}', '✅ Résolu en {time}', '✅ In {time} gelöst'],
  'mg.sd_newbest': ['🥇 New personal best!', '🥇 新的个人最佳！', '🥇 自己ベスト更新！', '🥇 ¡Nuevo récord personal!', '🥇 Nouveau record personnel !', '🥇 Neue persönliche Bestzeit!'],
  'mg.sd_daily_logged': ['🌐 Daily grid logged — see you tomorrow!', '🌐 今日每日局已记录 —— 明天见！', '🌐 今日のデイリーを記録しました —— また明日！', '🌐 Cuadrícula diaria registrada — ¡nos vemos mañana!', '🌐 Grille du jour enregistrée — à demain !', '🌐 Tägliches Raster eingetragen — bis morgen!'],
  'mg.sd_daily_already': ['Already logged today — replay doesn\u2019t overwrite.', '今日已记录 —— 重玩不会覆盖。', '今日は記録済み —— 再プレイでも上書きされません。', 'Ya registrado hoy — repetir no sobrescribe.', 'Déjà enregistré aujourd\u2019hui — une reprise n\u2019écrase pas.', 'Heute bereits eingetragen — Wiederholung überschreibt nicht.'],
  'mg.sd_timed_next_streak': ['✅ #{n} · {streak} streak — next grid!', '✅ 第 {n} 盘 · 连对 {streak} —— 下一盘！', '✅ #{n} · {streak} 連続 —— 次の盤面！', '✅ #{n} · racha de {streak} — ¡siguiente cuadrícula!', '✅ #{n} · série de {streak} — grille suivante !', '✅ #{n} · {streak} Serie — nächstes Raster!'],
  'mg.sd_timed_next_incoming': ['✅ #{n} in {time} — next grid incoming…', '✅ 第 {n} 盘用时 {time} —— 下一盘即将开始…', '✅ #{n} を {time} で —— 次の盤面へ…', '✅ #{n} en {time} — ¡llega la siguiente cuadrícula!', '✅ #{n} en {time} — grille suivante en approche…', '✅ #{n} in {time} — nächstes Raster kommt…'],
  'mg.sd_btn_try_again': ['↻ Try again', '↻ 再来一次', '↻ もう一度', '↻ Reintentar', '↻ Réessayer', '↻ Erneut versuchen'],
  'mg.sd_btn_run_again': ['↻ Run it again', '↻ 再跑一次', '↻ もう一度プレイ', '↻ Jugar otra vez', '↻ Rejouer', '↻ Nochmal spielen'],
  'mg.sd_btn_rematch': ['⚔️ Rematch', '⚔️ 再战', '⚔️ 再戦', '⚔️ Revancha', '⚔️ Revanche', '⚔️ Revanche'],
  'mg.sd_banner_duel': ['🤖 Duel Bot · claim your half', '🤖 对战机器人 · 抢占你的一半', '🤖 対戦ボット · 自分の半分を確保', '🤖 Bot de duelo · reclama tu mitad', '🤖 Bot de duel · réclamez votre moitié', '🤖 Duell-Bot · sichere deine Hälfte'],
  'mg.sd_banner_duel_sub': ['Fill only the cells with an ember corner · wrong digits cost {penalty}s', '只填带余烬角标的格子 · 填错数字罚 {penalty} 秒', '余りマスのみ入力 · 誤入力は {penalty} 秒ペナルティ', 'Rellena solo las celdas con esquina de brasa · los dígitos incorrectos cuestan {penalty}s', 'Remplissez seulement les cases avec un coin braise · les mauvais chiffres coûtent {penalty}s', 'Nur Felder mit Glut-Ecke füllen · falsche Ziffern kosten {penalty}s'],
  'mg.sd_banner_daily_world': ['One seeded puzzle worldwide · Standard · finish to log today', '全球同一道种子题 · 标准 · 完成后记录今日成绩', '世界中で同じ出題 · スタンダード · 完成で記録', 'Un mismo puzzle sembrado en todo el mundo · Estándar · termina para registrar hoy', 'Une même grille semée dans le monde entier · Standard · terminez pour enregistrer', 'Weltweit dieselbe Seeds-Aufgabe · Standard · Abschluss wird heute protokolliert'],
  'mg.sd_toast_candidates': ['✨ Candidates filled · {n} cells', '✨ 已填候选数 · {n} 个格子', '✨ 候補を埋めた · {n} マス', '✨ Candidatos rellenados · {n} casillas', '✨ Candidats remplis · {n} cases', '✨ Kandidaten gefüllt · {n} Felder'],
  'mg.sd_toast_committed': ['✨ Every cell is committed', '✨ 所有格子都已定案', '✨ すべてのマスが確定しています', '✨ Todas las celdas están confirmadas', '✨ Toutes les cases sont confirmées', '✨ Alle Felder sind festgelegt'],
  'mg.sd_toast_conflict': ['⚔️ Conflict! +{penalty}s penalty', '⚔️ 冲突！+{penalty} 秒罚时', '⚔️ 衝突！ +{penalty} 秒ペナルティ', '⚔️ ¡Conflicto! +{penalty}s de penalización', '⚔️ Conflit ! +{penalty}s de pénalité', '⚔️ Konflikt! +{penalty}s Strafe'],
  'mg.sd_toast_mistake': ['⚔️ Mistake! +{penalty}s penalty', '⚔️ 错误！+{penalty} 秒罚时', '⚔️ ミス！ +{penalty} 秒ペナルティ', '⚔️ ¡Error! +{penalty}s de penalización', '⚔️ Erreur ! +{penalty}s de pénalité', '⚔️ Fehler! +{penalty}s Strafe'],
  'mg.sd_duel_you_win': ['🏆 You filled your half in {time} — GridBot stalled at {done}/{total}', '🏆 你用 {time} 填满自己的一半 —— GridBot 卡在 {done}/{total}', '🏆 {time} で自分の半分を埋めた —— GridBot は {done}/{total} で停止', '🏆 Llenaste tu mitad en {time} — GridBot se quedó en {done}/{total}', '🏆 Vous avez rempli votre moitié en {time} — GridBot bloqué à {done}/{total}', '🏆 Du hast deine Hälfte in {time} gefüllt — GridBot blieb bei {done}/{total}'],
  'mg.sd_duel_bot_win': ['🤖 GridBot finished first ({time}) — you had {done}/{total}', '🤖 GridBot 先完成（{time}）—— 你完成到 {done}/{total}', '🤖 GridBot が先に完成（{time}）—— あなたは {done}/{total}', '🤖 GridBot terminó primero ({time}) — tú tenías {done}/{total}', '🤖 GridBot a terminé en premier ({time}) — vous aviez {done}/{total}', '🤖 GridBot war zuerst fertig ({time}) — du hattest {done}/{total}'],
  'mg.sd_verdict_you_win': ['You win 🏆', '你赢了 🏆', 'あなたの勝ち 🏆', 'Ganaste 🏆', 'Vous gagnez 🏆', 'Du gewinnst 🏆'],
  'mg.sd_verdict_bot_wins': ['GridBot wins 🤖', 'GridBot 获胜 🤖', 'GridBot の勝利 🤖', 'Gana GridBot 🤖', 'GridBot gagne 🤖', 'GridBot gewinnt 🤖'],
  'mg.sd_bot_cells': ['Bot cells {done}/{total}', '机器人格子 {done}/{total}', 'ボットのマス {done}/{total}', 'Celdas del bot {done}/{total}', 'Cases du bot {done}/{total}', 'Bot-Felder {done}/{total}'],
  'mg.sd_panel_grid_status': ['▦ Grid status', '▦ 棋盘状态', '▦ パズル状況', '▦ Estado de la cuadrícula', '▦ État de la grille', '▦ Rasterstatus'],
  'mg.sd_panel_best_times': ['🏅 Best times', '🏅 最佳成绩', '🏅 自己ベスト', '🏅 Mejores tiempos', '🏅 Meilleurs temps', '🏅 Bestzeiten'],
  'mg.sd_panel_daily': ['🌐 Daily', '🌐 每日', '🌐 デイリー', '🌐 Diario', '🌐 Quotidien', '🌐 Täglich'],
  'mg.sd_lbl_cells_filled': ['Cells filled', '已填格子', '埋めたマス', 'Celdas rellenadas', 'Cases remplies', 'Gefüllte Felder'],
  'mg.sd_lbl_empty': ['Empty (this puzzle)', '剩余空格（本盘）', '空きマス（この盤面）', 'Vacías (este puzle)', 'Vides (cette grille)', 'Leer (dieses Raster)'],
  'mg.sd_daily_note': ['One attempt logs your time; replays are free but won\u2019t overwrite.', '一次尝试即记录成绩；重玩免费但不会覆盖。', '1回でタイムを記録。再プレイは無料ですが上書きされません。', 'Un intento registra tu tiempo; repetir es gratis pero no sobrescribe.', 'Une tentative enregistre votre temps ; les reprises sont gratuites mais n\u2019écrasent pas.', 'Ein Versuch protokolliert deine Zeit; Wiederholungen sind kostenlos, überschreiben aber nicht.'],
  'mg.sd_hint_click4': ['Click a cell, then tap a number — or type 1–4, arrows to move. Toggle Notes (✏) to pencil candidates; Backspace erases.', '点击格子，再点数字 —— 或键入 1–4、方向键移动。切换笔记（✏）用铅笔标记候选；Backspace 清除。', 'マスをクリックして数字を選択 — または 1–4 を入力、矢印で移動。ノート（✏）で候補をメモ；Backspace で削除。', 'Haz clic en una celda y luego un número — o escribe 1–4, flechas para mover. Activa Notas (✏) para candidatos; Retroceso borra.', 'Cliquez une case puis un chiffre — ou tapez 1–4, flèches pour bouger. Activez Notes (✏) pour les candidats ; Retour arrière efface.', 'Klicke ein Feld dann eine Zahl — oder tippe 1–4, Pfeile zum Bewegen. Notizen (✏) für Kandidaten; Rücktaste löscht.'],
  'mg.sd_hint_click6': ['Click a cell, then tap a number — or type 1–6, arrows to move, Backspace to erase.', '点击格子，再点数字 —— 或键入 1–6、方向键移动、Backspace 清除。', 'マスをクリックして数字を選択 — または 1–6 を入力、矢印で移動、Backspace で削除。', 'Haz clic en una celda y luego un número — o escribe 1–6, flechas para mover, Retroceso borra.', 'Cliquez une case puis un chiffre — ou tapez 1–6, flèches pour bouger, Retour arrière efface.', 'Klicke ein Feld dann eine Zahl — oder tippe 1–6, Pfeile zum Bewegen, Rücktaste löscht.'],
  'mg.sd_hint_click9': ['Click a cell, then tap a number — or type 1–9, arrows to move. Toggle Notes (✏) to pencil candidates; Backspace erases.', '点击格子，再点数字 —— 或键入 1–9、方向键移动。切换笔记（✏）用铅笔标记候选；Backspace 清除。', 'マスをクリックして数字を選択 — または 1–9 を入力、矢印で移動。ノート（✏）で候補をメモ；Backspace で削除。', 'Haz clic en una celda y luego un número — o escribe 1–9, flechas para mover. Activa Notas (✏) para candidatos; Retroceso borra.', 'Cliquez une case puis un chiffre — ou tapez 1–9, flèches pour bouger. Activez Notes (✏) pour les candidats ; Retour arrière efface.', 'Klicke ein Feld dann eine Zahl — oder tippe 1–9, Pfeile zum Bewegen. Notizen (✏) für Kandidaten; Rücktaste löscht.'],
  'mg.sd_hint_must_be': ['💡 r{row}c{col} must be {value} — {reason}', '💡 第 {row} 行第 {col} 列必须是 {value} —— {reason}', '💡 {row}行{col}列は {value} でなければならない —— {reason}', '💡 f{row}c{col} debe ser {value} — {reason}', '💡 l{row}c{col} doit être {value} — {reason}', '💡 Z{row}S{col} muss {value} sein — {reason}'],
  'mg.sd_hint_only_fit': ['💡 r{row}c{col}: only {cands} fit there', '💡 第 {row} 行第 {col} 列：只有 {cands} 可填', '💡 {row}行{col}列：{cands} しか入らない', '💡 f{row}c{col}: solo caben {cands}', '💡 l{row}c{col} : seul {cands} peut y aller', '💡 Z{row}S{col}: nur {cands} passt dort'],
  'mg.sd_reason_row': ['only digit missing from row {n}', '该行只缺这个数字', 'その行でこの数字だけが欠けている', 'solo falta este dígito en la fila {n}', 'seul chiffre manquant de la ligne {n}', 'nur diese Ziffer fehlt in Zeile {n}'],
  'mg.sd_reason_col': ['only digit missing from column {n}', '该列只缺这个数字', 'その列でこの数字だけが欠けている', 'solo falta este dígito en la columna {n}', 'seul chiffre manquant de la colonne {n}', 'nur diese Ziffer fehlt in Spalte {n}'],
  'mg.sd_reason_box': ['only digit missing from its 2×2 box', '该 2×2 宫只缺这个数字', 'その 2×2 ボックスでこの数字だけが欠けている', 'solo falta este dígito en su caja 2×2', 'seul chiffre manquant de sa boîte 2×2', 'nur diese Ziffer fehlt in seiner 2×2-Box'],
  'mg.sd_reason_nearby': ['every other digit already sits nearby', '附近其他数字都已就位', '他の数字はすべて近くに置かれている', 'todos los demás dígitos ya están cerca', 'tous les autres chiffres sont déjà placés', 'alle anderen Ziffern stehen bereits in der Nähe'],
  'mg.sd_chat_title': ['Match chat · GridBot', '对战聊天 · GridBot', '対戦チャット · GridBot', 'Chat de partida · GridBot', 'Chat du match · GridBot', 'Match-Chat · GridBot'],
  'mg.sd_chat_beta': ['beta demo', '测试版演示', 'ベータデモ', 'demo beta', 'démo bêta', 'Beta-Demo'],

  'mg.pyr_found_of': ['Found {found} of {total}', '已找到 {found}/{total}', '{found}/{total} 発見', '{found} de {total} encontrados', '{found} sur {total} trouvées', '{found} von {total} gefunden'],
  'mg.pyr_banks': ['{n} banks', '存入 {n} 条', '{n} 件登録', '{n} depositadas', '{n} validées', '{n} gespeichert'],
  'mg.pyr_of_total': ['{done} of {total}', '{done}/{total}', '{done}/{total}', '{done} de {total}', '{done} sur {total}', '{done} von {total}'],
  'mg.pyr_target_note': ['✗ {eq} = {val} (target {target})', '✗ {eq} = {val}（目标 {target}）', '✗ {eq} = {val}（目標 {target}）', '✗ {eq} = {val} (objetivo {target})', '✗ {eq} = {val} (objectif {target})', '✗ {eq} = {val} (Ziel {target})'],
};

const flatLen = (o, pfx = '') =>
  Object.entries(o).reduce(
    (n, [k, v]) => n + (v && typeof v === 'object' && !Array.isArray(v) ? flatLen(v, `${pfx}${k}.`) : 1),
    0,
  );

let failed = false;
for (let i = 0; i < LANGS.length; i += 1) {
  const lang = LANGS[i];
  const p = join(ROOT, 'public', 'i18n', `${lang}.json`);
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  const before = flatLen(obj);
  let added = 0;
  for (const [key, vals] of Object.entries(T)) {
    const [ns, ...rest] = key.split('.');
    if (!obj[ns]) obj[ns] = {};
    const leaf = rest[rest.length - 1];
    if (!(leaf in obj[ns])) added += 1;
    set(obj, key, vals[i]);
  }
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  console.log(`  ${lang}: ${before} → ${flatLen(obj)}（本次新增 ${added}）`);
}

console.log('\n校验六语 key 对齐…');
const base = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8')));
for (const lang of LANGS) {
  const n = flatLen(JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${lang}.json`), 'utf8')));
  if (n !== base) {
    console.error(`  ✗ ${lang} = ${n}，en = ${base}`);
    failed = true;
  } else {
    console.log(`  ✓ ${lang} = ${n}`);
  }
}
process.exit(failed ? 1 : 0);
