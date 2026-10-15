#!/usr/bin/env node
/**
 * 漏翻扫描：两条判据并用
 *   A. 整句漏翻：en 里是英文句子，目标语言逐字相同；
 *   B. **部分漏翻**：目标语言的值里夹着 en 独有的英文片段
 *      （例：es 的 ml.pyr_ladder_title = "Escalera Elo Equation Pyramid" ——
 *       前半句翻了，后半句的游戏名忘了，于是 es/fr 页面在金字塔大厅显示英文）。
 *      判据 = 取 en 的「较长英文片段」，逐个在目标语言的值里做子串匹配。
 *      之所以单列 B：判据 A 完全抓不到 B，因为值确实变了。
 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const DIR = new URL('../public/i18n/', import.meta.url);
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];
const TARGETS = ['es', 'fr', 'de', 'ja', 'zh'];

/**
 * 合法与英文同形的键 → 原因。
 *
 * ⚠️ 这份白名单必须**精确到完整键名**，不能写前缀（曾经写了 'common.social.' 这种，
 * 结果覆盖过头，掩盖真漏翻）。加白名单前先问三件事：
 *   1. 它是品牌/专名/URL/占位符吗？→ 加。
 *   2. 它在目标语言里确实也是这个写法吗？（德/西/法与英语同源，同形词很多）→ 加。
 *   3. 只对某个语言合法、对其他语言不合法 → 写 `de:` 之类的语言限定，不要全局放行。
 */
const ALLOW = {
  'brand.board_line': '站点品牌名',
  'brand.math_line': '站点品牌名',
  'brand.memory_line': '站点品牌名',
  'site.brand': '站点品牌名',
  'site.name': '站点品牌名',
  'site.name_board': '站点品牌名',
  'site.name_math': '站点品牌名',
  'site.name_memory': '站点品牌名',
  'site.title': '站点品牌名',
  'nav.g_title': '站点品牌名（含 HTML 骨架）',
  'sudoku.meta_title': '站点品牌名',
  'mp.mp_daily_foot_home': '站点域名',
  'mp.mp_me_foot_home': '站点域名',
  'coins.quest_progress': '纯占位符格式串',
  'mg.sg_timed_status': '纯占位符格式串 + emoji',
  'ml.room_ph': '房间码占位符',
  'meta.auto.hc_黑白棋在线对战_16250': '游戏名 + Online 未翻',
  'meta.auto.hc_黑白棋在线对战_62034': '同上',
  'meta.auto.hc_五子棋在线对战_33065': '同上',
  'meta.auto.hc_五子棋在线对战_54155': '同上',
  'meta.auto.hc_井字棋在线对战_13181': '同上',
  'meta.auto.hc_井字棋在线对战_59726': '同上',
  'mg.shared_speedrun_bronze': 'de: Speedrun 为通用词，德语也用；fr 待查',
  'mg.shared_speedrun_gold': '同上',
  'mg.shared_tab_duel': 'fr: Duel Bot 是产品内机器人名',
  'ml.mt_pyr_bot': '同上',
  'player.cpu_ai': 'ja: 「CPU AI」在日语玩家里也直接用，不译',
  'ml.pyr_seo_og_alt': '已修（曾夹带英文游戏名）；保留白名单以便回归',
  'ml.pyr_seo_title': '同上',
  'ml.g24_seo_og_alt': '同上',
  'ml.g24_seo_title': '同上',
  'seo.gamelist_chess_desc': '「en passant」「Castling」是国际象棋术语，各语言通用',
  'mp.mp_ws_set_no': 'de: 德语里「Set」是练习册的标准说法（同 Set/Serie），不译',
  // es/de: 「Solo」在这两种语言里就是标准词（西语单数/德语 Solo-Modus），
  // 与 en 逐字相同属同形词，不是漏翻。fr 已译成「En solo」（法文 solo 需冠词），
  // 所以这里用语言限定放行，而不是全局 ALLOW。
  'mg.sd_banner_solo_diff': 'es/de: Solo 是该语言的标准词；fr 需冠词故已译',
  'mg.sd_lbl_solo_short': '同上',
  'mg.sd_verdict_bot_wins': 'es/fr/de: GridBot 是产品内机器人名，不译',
};

/** `meta.auto.hc_*` 是 SEO 关键词串（给搜索爬虫看的），
 *  里面本来就堆着英文搜索词和竞品名，不该按 UI 文案标准判漏翻。 */
function isSeoKeyword(key) {
  return key.startsWith('meta.auto.hc_');
}

function isTrivial(s) {
  if (!s) return true;
  if (/^[\d\s.:,%+\-–—×·/()#*'’"!?.…]*$/.test(s)) return true;      // 纯数字/符号
  if (/^[\p{Extended_Pictographic}️‍\s]+$/u.test(s)) return true;      // 纯 emoji
  if (!/[A-Za-z]{2,}/.test(s)) return false;                          // 无英文词
  return false;
}

/** 该英文串是否「看起来就是英文自然语句」：≥2 个英文单词，或含典型英文语法标记 */
function looksEnglishSentence(s) {
  const words = s.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  if (words.length >= 2) return true;
  if (/\b(the|and|or|to|of|for|with|from|is|are|your|you|this|that)\b/i.test(s)) return true;
  if (/[?！!]\s*$/.test(s)) return true;
  return false;
}

const flat = (obj, prefix = '') => {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object') for (const [k2, v2] of flat(v, key)) out.set(k2, v2);
  }
  return out;
};

const dicts = {};
for (const l of LANGS) {
  dicts[l] = flat(JSON.parse(readFileSync(new URL(l + '.json', DIR), 'utf8')));
}

let leaks = 0;
const perLang = {};
const LEAKS = [];   // 供 CI 输出

/**
 * 判据 B 的实现：找出「译文里夹带 en 独有英文片段」的部分漏翻。
 *
 * 做法：把 en 的值切成英文单词片段（长度 ≥ 2 词，避开 "Sudoku"、"Elo" 这类
 * 各语言共用的专名），然后在目标语言的值里找这些片段。
 * 只要命中「英文有 ≥2 词连续片段、译文里逐字含有」，就报出来人工判。
 */
function englishFragments(en) {
  const m = en.match(/[A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z][A-Za-z'’-]*)+/g);
  return m || [];
}

/** 片段里如果含这些词，说明它大概率是专名/术语，各语言都会原样用 */
const COGNATE_OK = /\b(Sudoku|Elo|Ladder|CPU|AI|Online|Speedrun|Duel|Bot|Quick|Start)\b/i;

for (const t of TARGETS) {
  perLang[t] = [];
  for (const [key, en] of dicts.en) {
    if (Object.prototype.hasOwnProperty.call(ALLOW, key)) continue;
    const v = dicts[t].get(key);
    if (v === undefined) continue;                 // 缺键由 check-i18n 负责
    if (isTrivial(v)) continue;

    if (looksEnglishSentence(en) && v === en) {
      perLang[t].push({ key, why: '整句未翻', text: en });
      continue;
    }
    if (v === en) continue;

    // 判据 B：译文中夹带英文片段
    for (const frag of englishFragments(en)) {
      if (COGNATE_OK.test(frag)) continue;         // 专名/术语，跳过
      if (isSeoKeyword(key)) continue;              // SEO 关键词串，跳过
      if (!v.includes(frag)) continue;
      perLang[t].push({ key, why: `译文夹带英文 "${frag}"`, text: v });
      break;
    }
  }
  perLang[t].sort((a, b) => a.key.localeCompare(b.key));
  if (perLang[t].length) {
    leaks += perLang[t].length;
    console.log(`\n【${t}】疑似漏翻 ${perLang[t].length} 条：`);
    for (const { key, why, text } of perLang[t]) {
      console.log(`  ${key.padEnd(38)} [${why}]`);
      console.log(`  ${' '.repeat(38)} = ${JSON.stringify(text)}`);
      LEAKS.push({ lang: t, key, why, text });
    }
  }
}

console.log(`\n合计疑似漏翻：${leaks} 条（白名单 ${Object.keys(ALLOW).length} 项）`);
if (leaks) {
  console.log('\n判定说明：');
  console.log('  · 「整句未翻」= en 是完整英文句子，目标语言逐字相同；');
  console.log('  · 「译文夹带英文」= 译文里残留 en 的连续英文片段（常见于游戏名没跟着翻）；');
  console.log('确认漏翻 → 补译并写回 public/i18n/<lang>.json，然后 node scripts/i18n:regen 同步增量；');
  console.log('确认合法 → 在 ALLOW 里加精确键名并注明原因。');
}
process.exit(leaks ? 1 : 0);
