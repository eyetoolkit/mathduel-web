/**
 * 批次 2h：GridBot 的对话台词（两个大数独里 BOT_LINES 内容相同，只是转义写法不同）。
 * 这些是玩家在「对战聊天」里直接读到的文本，必须走字典。
 * 台词刻意保留玩皮语气 —— 翻译时不要改写成正式说明文。
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

/** 键后缀 → 六语数组，顺序 [en, zh, ja, es, fr, de] */
const LINES = {
  hello_1: ['Good luck — you\u2019ll need it.', '祝你好运 —— 你会需要的。', '健闘を祈る —— 必要なのは運だけだ。', 'Buena suerte — la necesitarás.', 'Bonne chance — vous en aurez besoin.', 'Viel Glück — das wirst du brauchen.'],
  hello_2: ['Grid goes brrr.', '棋盘嗡嗡嗡。', '盤面がブリブリ音を立てる。', 'La cuadrícula hace brrr.', 'La grille fait brrr.', 'Das Raster macht brrr.'],
  hello_3: ['I was compiled to win this.', '我可是被编译出来赢这个的。', 'これを勝つために組まれた。', 'Me compilaron para ganar esto.', 'J\u2019ai été compilé pour gagner ceci.', 'Ich wurde kompiliert, um das zu gewinnen.'],
  playerfill_1: ['Nice one.', '漂亮。', 'いいね。', 'Bien jugado.', 'Joli.', 'Gut gemacht.'],
  playerfill_2: ['Hey, that was mine-ish.', '嘿，那差不多是我的格子。', 'おい、それはほぼ俺の石だ。', 'Oye, ese era casi mío.', 'Hé, celle-là était presque à moi.', 'Hey, das war fast meiner.'],
  playerfill_3: ['Okay, warm-up over.', '好吧，热身结束。', 'よし、ウォームアップ終了。', 'Vale, calentamiento terminado.', 'Bon, échauffement terminé.', 'Okay, Aufwärmen vorbei.'],
  botfill_1: ['Claimed.', '拿到了。', '確保した。', 'Reclamada.', 'Prise.', 'Hab sie.'],
  botfill_2: ['Mine.', '我的。', '俺のもの。', 'Mía.', 'À moi.', 'Meine.'],
  botfill_3: ['Tick tock.', '滴答滴答。', ' Abstrahieren nicht — tick tock. カelj. ', 'tic, toc.', 'tic, toc.', 'Tick tack.'],
  botfill_4: ['Beep.', '哔。', 'ピコン。', 'Bip.', 'Bip.', 'Piep.'],
  losing_1: ['You\u2019re fast for a human…', '对人类来说你挺快……', '人間にしては速い……', 'Vas rápido para un humano…', 'Vous êtes rapide pour un humain…', 'Für einen Menschen bist du schnell…'],
  losing_2: ['Recalibrating…', '重新校准中……', '再校正中……', 'Recalibrando…', 'Recalibrage…', 'Neukalibrierung…'],
  winning_1: ['This is easy mode for me.', '对我来说这就是简单模式。', 'これは俺にはイージーだ。', 'Esto es el modo fácil para mí.', 'C\u2019est le mode facile pour moi.', 'Für mich ist das der leichte Modus.'],
  winning_2: ['Almost there!', '快好了！', 'もうすぐだ！', '¡Casi está!', 'Presque fini !', 'Fast fertig!'],
};

const T = {};
for (const [suffix, vals] of Object.entries(LINES)) {
  T[`mg.sg_bot_${suffix}`] = vals;
}
// botfill_3 上面手滑写坏了，这里覆盖成正确值
T['mg.sg_bot_botfill_3'] = ['Tick tock.', '滴答滴答。', 'チクタク。', 'tic, toc.', 'tic, toc.', 'Tick tack.'];

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
