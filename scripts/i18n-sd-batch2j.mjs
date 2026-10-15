#!/usr/bin/env node
/**
 * 字典新增 batch2j：补 scan-hardcoded-i18n 增强后暴露的 30 处硬编码
 * ----------------------------------------------------------------
 * 背景（2026-10-15）：
 *   旧版扫描器有两条系统性假绿，本批全部由它们藏着：
 *   1. `isHardcodedEnglish()` 里 `if (s.includes('${')) return false`
 *      —— 只要字面量带插值就整条放弃，于是
 *      `toast(\`✓ Daily complete — streak ${combo}\`)` 这类真硬编码被放过。
 *   2. SINKS 只有「赋值右侧」形态，没有三元分支，于是
 *      `next ? i18nT('common.sound_on') : 'Sound off'` 只看到英文那一半。
 *
 * 增强后扫描器给出 30 处，逐条核实**全是真实面向玩家的英文**（不是符号、不是 class）。
 *
 * 🔴 命名沿用既有前缀，避免撞键：
 *   common.sound_off / common.sound            —— 开关按钮（已有 sound_on）
 *   common.theme_to_light / common.theme_to_dark
 *   mg.shared_*                                —— 跨游戏共用标签
 *   mg.g24_* / mg.ep_* / mg.mp_*               —— 各游戏/多人模块专属
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];

/** key → { en, zh, ja, es, fr, de } */
const ADD = {
  // ── 开关与主题（24-game/index.ts L206-207、match-sound.ts L66-67、theme.ts L62-63）
  'common.sound_off': {
    en: 'Sound off', zh: '音效关', ja: 'サウンドオフ',
    es: 'Sonido desactivado', fr: 'Son désactivé', de: 'Ton aus',
  },
  'common.sound': {
    en: 'Sound', zh: '音效', ja: 'サウンド',
    es: 'Sonido', fr: 'Son', de: 'Ton',
  },
  'common.theme_to_light': {
    en: 'Switch to light', zh: '切换到浅色', ja: 'ライトモードに切り替え',
    es: 'Cambiar a claro', fr: 'Passer en clair', de: 'Zu hell wechseln',
  },
  'common.theme_to_dark': {
    en: 'Switch to dark', zh: '切换到深色', ja: 'ダークモードに切り替え',
    es: 'Cambiar a oscuro', fr: 'Passer en sombre', de: 'Zu dunkel wechseln',
  },

  // ── 24 Game：复用已有 key 的接线（字典里早就有了，代码却写死英文）
  'mg.g24_daily_streak': {
    en: '✓ Daily complete — streak {n}', zh: '✓ 每日挑战完成 —— 连续 {n} 天',
    ja: '✓ デイリー完了 —— {n} 日連続', es: '✓ Diario completado — racha {n}',
    fr: '✓ Quotidien terminé — série {n}', de: '✓ Tagesaufgabe geschafft — Serie {n}',
  },
  'mg.g24_wait_host': {
    en: '⏳ {n} joined — share the code, start when ready',
    zh: '⏳ 已加入 {n} 人 —— 分享房间号，人齐即可开始',
    ja: '⏳ {n} 人が参加 —— コードを共有して準備ができたら開始',
    es: '⏳ {n} conectados — comparte el código e iniciad cuando estéis',
    fr: '⏳ {n} rejoint(s) — partagez le code, lancez quand tout le monde est là',
    de: '⏳ {n} beigetreten — Code teilen, starten sobald alle da sind',
  },
  'mg.g24_waiting_host': {
    en: '⏳ Joined — waiting for host… ({n} players)',
    zh: '⏳ 已加入 —— 等待房主开始…（{n} 人）',
    ja: '⏳ 参加しました —— ホストの開始を待っています…（{n} 人）',
    es: '⏳ Te has unido — esperando al anfitrión… ({n} jugadores)',
    fr: '⏳ Vous avez rejoint — en attente de l’hôte… ({n} joueurs)',
    de: '⏳ Beigetreten — warte auf den Host… ({n} Spieler)',
  },
  'mg.g24_round_ban_title': {
    en: '🏆 Round {round} / {max}', zh: '🏆 第 {round} / {max} 轮',
    ja: '🏆 ラウンド {round} / {max}', es: '🏆 Ronda {round} / {max}',
    fr: '🏆 Manche {round} / {max}', de: '🏆 Runde {round} / {max}',
  },
  'mg.g24_round_ban_sub': {
    en: 'Same cards · race to 24', zh: '同一副牌 · 抢先凑出 24',
    ja: '同じカード · 24 を競う', es: 'Mismas cartas · carrera a 24',
    fr: 'Mêmes cartes · course à 24', de: 'Gleiche Karten · Wettlauf zu 24',
  },
  'mg.g24_promoted': {
    en: '🎉 Promoted to', zh: '🎉 晋级至', ja: '🎉 昇格：',
    es: '🎉 Ascendido a', fr: '🎉 Promu en', de: '🎉 Aufgestiegen auf',
  },
  'mg.g24_demoted': {
    en: '⬇ Demoted to', zh: '⬇ 降至', ja: '⬇ 降格：',
    es: '⬇ Descendido a', fr: '⬇ Rétrogradé en', de: '⬇ Abgestiegen auf',
  },
  'mg.g24_rank_you': {
    en: '🏁 You ranked #{rank}', zh: '🏁 你排名第 {rank}',
    ja: '🏁 あなたは {rank} 位', es: '🏁 Quedaste #{rank}',
    fr: '🏁 Vous êtes {rank}e', de: '🏁 Du landest auf Platz {rank}',
  },
  'mg.g24_elo_rated': {
    en: '⚔️ Elo — rated match', zh: '⚔️ Elo —— 排位对战',
    ja: '⚔️ Elo —— ランク戦', es: '⚔️ Elo — partida classification',
    fr: '⚔️ Elo — match classé', de: '⚔️ Elo — Ranglistenspiel',
  },
  'mg.g24_cap_players': {
    en: '{n} players · cap {cap}', zh: '{n} 名玩家 · 上限 {cap} 人',
    ja: '{n} 人 · 上限 {cap} 人', es: '{n} jugadores · máx. {cap}',
    fr: '{n} joueurs · max {cap}', de: '{n} Spieler · max. {cap}',
  },
  'mg.g24_you_won_comp': {
    en: '🏆 You won the competition!', zh: '🏆 你赢得了本次比赛！',
    ja: '🏆 勝利しました！',
    es: '🏆 ¡Ganaste la competición!', fr: '🏆 Vous avez remporté la compétition !',
    de: '🏆 Du hast den Wettbewerb gewonnen!',
  },
  'mg.g24_comp_over': {
    en: '🏁 Competition Over', zh: '🏁 比赛结束',
    ja: '🏁 競技終了', es: '🏁 Competición terminada',
    fr: '🏁 Compétition terminée', de: '🏁 Wettbewerb beendet',
  },
  'mg.g24_my_rank_lbl': {
    en: 'My Rank', zh: '我的名次', ja: '自分の順位',
    es: 'Mi puesto', fr: 'Mon classement', de: 'Mein Platz',
  },
  'mg.g24_solved_lbl': {
    en: 'Solved', zh: '已解出', ja: '解答数',
    es: 'Resueltos', fr: 'Résolus', de: 'Gelöst',
  },
  'mg.g24_canvas_comp': {
    en: '🏆 Competition', zh: '🏆 比赛', ja: '🏆 競技',
    es: '🏆 Competición', fr: '🏆 Compétition', de: '🏆 Wettbewerb',
  },
  'mg.g24_canvas_daily': {
    en: '📅 Daily Challenge', zh: '📅 每日挑战', ja: '📅 デイリーチャレンジ',
    es: '📅 Desafío diario', fr: '📅 Défi quotidien', de: '📅 Tagesaufgabe',
  },
  'mg.g24_canvas_upto': {
    en: 'Up to {n} players', zh: '最多 {n} 人', ja: '最大 {n} 人',
    es: 'Hasta {n} jugadores', fr: "Jusqu'à {n} joueurs", de: 'Bis zu {n} Spieler',
  },
  'mg.g24_res_comp': {
    en: '🏆 Competition Results', zh: '🏆 比赛结果', ja: '🏆 競技結果',
    es: '🏆 Resultados de la competición', fr: '🏆 Résultats de la compétition',
    de: '🏆 Wettbewerbsergebnisse',
  },
  'mg.g24_res_daily_done': {
    en: '🎉 Daily Challenge Complete!', zh: '🎉 每日挑战完成！',
    ja: '🎉 デイリーチャレンジ完了！', es: '🎉 ¡Desafío diario completado!',
    fr: '🎉 Défi quotidien terminé !', de: '🎉 Tagesaufgabe geschafft!',
  },
  'mg.g24_res_daily': {
    en: '📅 Daily Challenge Results', zh: '📅 每日挑战结果',
    ja: '📅 デイリーチャレンジ結果', es: '📅 Resultados del desafío diario',
    fr: '📅 Résultats du défi quotidien', de: '📅 Ergebnisse der Tagesaufgabe',
  },
  'mg.g24_res_score': {
    en: '🏆 My 24 Score', zh: '🏆 我的 24 分成绩', ja: '🏆 私の 24 スコア',
    es: '🏆 Mi puntuación de 24', fr: '🏆 Mon score à 24',
    de: '🏆 Mein 24-Punkte-Ergebnis',
  },
  'mg.g24_copy_failed': {
    en: 'Copy failed — long-press the card', zh: '复制失败 —— 长按卡片试试',
    ja: 'コピー失敗 —— カードを長押ししてください',
    es: 'Copia fallida — mantén pulsada la tarjeta',
    fr: 'Échec de la copie — appuyez longuement sur la carte',
    de: 'Kopieren fehlgeschlagen — Karte lange drücken',
  },
  'mg.g24_copied_toast': {
    en: '✅ Copied — paste it anywhere!', zh: '✅ 已复制 —— 粘贴到任意位置！',
    ja: '✅ コピーしました —— どこにでも貼り付けできます！',
    es: '✅ Copiado — ¡pégalo donde quieras!',
    fr: '✅ Copié — collez-le où vous voulez !',
    de: '✅ Kopiert — überall einfügen!',
  },

  // ── Equation Pyramid（index.ts L560 / L563 / L646）
  'mg.ep_board_cleared_html': {
    en: '✅ Board cleared in <b>{time}</b> — next!',
    zh: '✅ 用时 <b>{time}</b> 清空棋盘 —— 下一块！',
    ja: '✅ <b>{time}</b> でボードをクリア —— 次へ！',
    es: '✅ Tablero limpio en <b>{time}</b> — ¡siguiente!',
    fr: '✅ Plateau vidé en <b>{time}</b> — suivant !',
    de: '✅ Brett in <b>{time}</b> geräumt — weiter!',
  },
  'mg.ep_cleared_streak_html': {
    en: '✅ Cleared in <b>{time}</b> — {streak} streak',
    zh: '✅ 用时 <b>{time}</b> 清空 —— 连续 {streak} 块',
    ja: '✅ <b>{time}</b> でクリア —— {streak} 連続',
    es: '✅ Limpio en <b>{time}</b> — racha de {streak}',
    fr: '✅ Vidé en <b>{time}</b> — série de {streak}',
    de: '✅ In <b>{time}</b> geräumt — {streak} in Serie',
  },
  'mg.ep_bot_banked': {
    en: '🤖 Bot banked {solution}', zh: '🤖 机器人存入 {solution}',
    ja: '🤖 ボットが {solution} を登録',
    es: '🤖 El bot registró {solution}',
    fr: '🤖 Le bot a enregistré {solution}',
    de: '🤖 Bot hat {solution} eingetragen',
  },

  // ── 多人对战（mp-client / bulls / sudoku adapter）
  'mg.shared_lbl_lock_secret': {
    en: '🔒 Lock Secret', zh: '🔒 锁定数字', ja: '🔒 数字をロック',
    es: '🔒 Fijar número', fr: '🔒 Verrouiller le numéro',
    de: '🔒 Zahl festlegen',
  },
  'mg.mp_bulls_lock_hint': {
    en: 'Both players lock in to start guessing. You have {n}s.',
    zh: '双方都锁定后开始猜数。你有 {n} 秒。',
    ja: '両者がロックすると推測開始。制限 {n} 秒。',
    es: 'Ambos fijan su número para empezar. Tienes {n}s.',
    fr: "Les deux verrouillent pour commencer. Vous avez {n}s.",
    de: 'Beide legen ihre Zahl fest, dann rät ihr. Ihr habt {n}s.',
  },
  'mg.mp_bulls_next_cracked': {
    en: 'Code broken — next round in 3s', zh: '数字已破解 —— 3 秒后下一轮',
    ja: '数字が割れた —— 3 秒後に次のラウンド',
    es: 'Código roto — siguiente ronda en 3 s',
    fr: 'Code brisé — manche suivante dans 3 s',
    de: 'Code geknackt — nächste Runde in 3 s',
  },
  'mg.mp_bulls_next_timeup': {
    en: 'Time up — next round in 3s', zh: '时间到 —— 3 秒后下一轮',
    ja: '時間切れ —— 3 秒後に次のラウンド',
    es: 'Tiempo agotado — siguiente ronda en 3 s',
    fr: 'Temps écoulé — manche suivante dans 3 s',
    de: 'Zeit abgelaufen — nächste Runde in 3 s',
  },
  'mg.mp_round_timer': {
    en: 'Round timer {n}s', zh: '本轮剩余 {n} 秒',
    ja: '残り {n} 秒', es: 'Tiempo de ronda {n}s',
    fr: 'Temps restant {n}s', de: 'Rundenzeit {n}s',
  },
  'mg.mp_spectating_now': {
    en: '👀 Spectating this round', zh: '👀 正在观战本轮',
    ja: '👀 このラウンドを観戦中', es: '👀 Viendo esta ronda',
    fr: '👀 Vous regardez cette manche', de: '👀 Sie sehen diese Runde',
  },
  'mg.mp_spectating_bar_html': {
    en: '👀 <b>Spectating</b> — read-only view',
    zh: '👀 <b>观战中</b> —— 只读视图',
    ja: '👀 <b>観戦中</b> —— 読み取り専用',
    es: '👀 <b>Observando</b> — vista de solo lectura',
    fr: '👀 <b>Observation</b> — vue en lecture seule',
    de: '👀 <b>Zuschauen</b> — nur lesen',
  },
  'mg.mp_watchers': {
    en: ' · {n} watchers', zh: ' · {n} 人观战',
    ja: ' · 観戦者 {n} 人', es: ' · {n} espectadores',
    fr: " · {n} spectateurs", de: ' · {n} Zuschauer',
  },
  'mg.mp_you_host': {
    en: 'You · Host', zh: '你 · 房主',
    ja: 'あなた · ホスト', es: 'Tú · Anfitrión',
    fr: 'Vous · Hôte', de: 'Du · Host',
  },
  'mg.mp_you_won_short': {
    en: '🏆 You won!', zh: '🏆 你赢了！', ja: '🏆 勝利！',
    es: '🏆 ¡Ganaste!', fr: '🏆 Vous avez gagné !', de: '🏆 Du hast gewonnen!',
  },
  'mg.mp_start_2plus': {
    en: '🚀 Start (2+ players)', zh: '🚀 开始（需 2 人以上）',
    ja: '🚀 開始（2 人以上）', es: '🚀 Iniciar (2+ jugadores)',
    fr: '🚀 Démarrer (2+ joueurs)', de: '🚀 Starten (2+ Spieler)',
  },

  // ── 教师课堂 / 数独提示
  'mg.tt_room_expired': {
    en: 'This room has expired — ask your teacher for a new link.',
    zh: '该房间已过期 —— 请向老师索取新链接。',
    ja: 'このルームは期限切れです —— 先生に新しいリンクをご依頼ください。',
    es: 'Esta sala ha caducado — pide a tu profesor un enlace nuevo.',
    fr: 'Ce salon a expiré — demandez un nouveau lien à votre enseignant.',
    de: 'Dieser Raum ist abgelaufen — bitte den Lehrer um einen neuen Link.',
  },
  'mg.tt_join_failed': {
    en: 'Could not join. Please check the code.',
    zh: '加入失败，请检查房间码。',
    ja: '参加できませんでした。コードを確認してください。',
    es: 'No se pudo entrar. Revisa el código.',
    fr: 'Impossible de rejoindre. Vérifiez le code.',
    de: 'Beitreten fehlgeschlagen. Bitte den Code prüfen.',
  },
  'mg.tt_not_roster': {
    en: 'This code is not on the class list — check with your teacher.',
    zh: '该房间码不在班级名单中 —— 请向老师确认。',
    ja: 'このコードはクラス名簿にありません —— 先生に確認してください。',
    es: 'Este código no está en la lista de clase — consulta a tu profesor.',
    fr: "Ce code n'est pas sur la liste de classe — vérifiez avec votre enseignant.",
    de: 'Dieser Code steht nicht auf der Klassenliste — bitte den Lehrer fragen.',
  },
  'mg.tt_assignment_closed': {
    en: 'This assignment has closed — ask your teacher.',
    zh: '该作业已关闭 —— 请向老师询问。',
    ja: 'この課題は終了しました —— 先生に聞いてください。',
    es: 'Esta tarea ya se cerró — pregunta a tu profesor.',
    fr: 'Ce devoir est fermé — demandez à votre enseignant.',
    de: 'Diese Aufgabe ist geschlossen — bitte den Lehrer fragen.',
  },
  'mg.tt_not_accepted': {
    en: 'Not accepted. Check with your teacher.',
    zh: '未通过验证，请向老师确认。',
    ja: '受理されませんでした。先生に確認してください。',
    es: 'No aceptado. Consulta a tu profesor.',
    fr: 'Non accepté. Vérifiez avec votre enseignant.',
    de: 'Nicht akzeptiert. Bitte den Lehrer fragen.',
  },
  'mg.mp_sudoku_tap_hint': {
    en: 'Tap an empty cell to cycle 1–{max} · {rule}',
    zh: '点击空格按 1–{max} 循环 · {rule}',
    ja: '空マスをタップして 1–{max} を切替 · {rule}',
    es: 'Toca una celda vacía para rotar 1–{max} · {rule}',
    fr: 'Touchez une case vide pour faire défiler 1–{max} · {rule}',
    de: 'Leere Zelle antippen für 1–{max} · {rule}',
  },
  'mg.mp_sudoku_relay_rule': {
    en: 'first to complete correctly wins',
    zh: '先正确填完者获胜',
    ja: '先に完成した人が勝ち',
    es: 'gana quien complete correctamente primero',
    fr: 'gagne celui qui termine correctement en premier',
    de: 'gewinnt, wer zuerst korrekt fertig ist',
  },
  'mg.mp_sudoku_grid_rule': {
    en: 'first to fill the grid correctly wins',
    zh: '先正确填满棋盘者获胜',
    ja: '先に正しく盤面を埋めた人が勝ち',
    es: 'gana quien llene el tablero correctamente primero',
    fr: 'gagne celui qui remplit la grille correctement en premier',
    de: 'gewinnt, wer das Gitter zuerst korrekt füllt',
  },

  // ── Worksheets 答案页无解占位
  'mg.ws_no_solution': {
    en: '(skip — no solution)', zh: '（跳过 —— 无解）',
    ja: '（スキップ —— 解なし）', es: '(omitir: sin solución)',
    fr: '(passé — aucune solution)', de: '(übersprungen — keine Lösung)',
  },

  // ── 单词数 < 2，扫描器的 minWords 门槛抓不到，只能人工补
  //    （规则：minWords=1 会把 el()/class 名/图标符号全卷进来，噪声不可接受）
  'mg.shared_lbl_you': {
    en: 'You', zh: '你', ja: 'あなた', es: 'Tú',
    fr: 'Vous', de: 'Du',
  },
  'mg.shared_lbl_host': {
    en: 'Host', zh: '房主', ja: 'ホスト', es: 'Anfitrión',
    fr: 'Hôte', de: 'Host',
  },
  'mg.shared_lbl_send': {
    en: 'Send', zh: '发送', ja: '送信', es: 'Enviar',
    fr: 'Envoyer', de: 'Senden',
  },
  'mg.shared_lbl_close': {
    en: 'Close', zh: '关闭', ja: '閉じる', es: 'Cerrar',
    fr: 'Fermer', de: 'Schließen',
  },
  'mg.shared_aria_send_emoji': {
    en: 'Send {e}', zh: '发送 {e}', ja: '{e} を送信',
    es: 'Enviar {e}', fr: 'Envoyer {e}', de: '{e} senden',
  },
  'mg.g24_copy_done': {
    en: '✅ Copied', zh: '✅ 已复制', ja: '✅ コピーしました',
    es: '✅ Copiado', fr: '✅ Copié', de: '✅ Kopiert',
  },
  'mg.mp_your_name': {
    en: 'Your name', zh: '你的昵称', ja: 'あなたの名前',
    es: 'Tu nombre', fr: 'Votre nom', de: 'Dein Name',
  },
  'mg.mp_ph_player': {
    en: 'Player', zh: '玩家', ja: 'プレイヤー', es: 'Jugador',
    fr: 'Joueur', de: 'Spieler',
  },
  'mg.mp_room_intro': {
    en: 'Create a room, share the code, race friends or the world.',
    zh: '创建房间、分享房间码，与好友或全世界同场竞速。',
    ja: 'ルームを作ってコードを共有し、好友や世界と競いましょう。',
    es: 'Crea una sala, comparte el código y compite con amigos o con el mundo.',
    fr: 'Créez un salon, partagez le code, affrontez vos amis ou le monde entier.',
    de: 'Raum erstellen, Code teilen, gegen Freunde oder die Welt antreten.',
  },
  'mg.mp_title_comp_html': {
    en: '🏆 {label} — Competition', zh: '🏆 {label} —— 比赛',
    ja: '🏆 {label} —— 競技', es: '🏆 {label} — Competición',
    fr: '🏆 {label} — Compétition', de: '🏆 {label} — Wettbewerb',
  },
  'mg.mp_create_room': {
    en: '🚀 Create Room', zh: '🚀 创建房间', ja: '🚀 ルームを作成',
    es: '🚀 Crear sala', fr: '🚀 Créer un salon', de: '🚀 Raum erstellen',
  },
  'mg.mp_join_with_code': {
    en: 'Join with code', zh: '用房间码加入', ja: 'コードで参加',
    es: 'Unirse con código', fr: 'Rejoindre avec un code',
    de: 'Mit Code beitreten',
  },
};

let totalAdded = 0;
for (const lang of LANGS) {
  const p = join(ROOT, 'public', 'i18n', `${lang}.json`);
  const d = JSON.parse(readFileSync(p, 'utf8'));
  let n = 0;
  for (const [fullKey, vals] of Object.entries(ADD)) {
    const dot = fullKey.indexOf('.');
    const ns = fullKey.slice(0, dot);
    const key = fullKey.slice(dot + 1);
    if (!d[ns]) d[ns] = {};
    if (d[ns][key] === undefined) {
      d[ns][key] = vals[lang];
      n += 1;
    }
  }
  writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8');
  console.log(`  ${lang}.json +${n}`);
  totalAdded += n;
}
console.log(`\n✓ batch2j 新增合计 ${totalAdded} 条（共 ${Object.keys(ADD).length} 个 key × 6 语）\n`);
