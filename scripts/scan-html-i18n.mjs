#!/usr/bin/env node
/**
 * 扫描 HTML 里「可见英文文案却没有 data-i18n* 绑定」的节点（P1-3 补充）
 * ----------------------------------------------------------------
 * 与 scan-hardcoded-i18n.mjs 互补：那个只扫 TS 的 UI 出口，
 * 这个扫 HTML 骨架本身（innerHTML 之前就写死在 DOM 里的文案）。
 *
 * 判据：
 *   - 元素可见（排除 script/style/svg/defs/symbol/hidden/meta/title 的 SEO 兜底）
 *   - 直接文本节点含 ≥2 个英文单词且不含插值
 *   - 该节点所在元素没有 data-i18n / data-i18n-html 绑定
 */
import { readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HTML_FILES = [
  'index.html',
  'daily/index.html',
  'me/index.html',
  'worksheets/index.html',
  'games/24-game/index.html',
  'games/24-game/lobby/index.html',
  'games/sudoku/index.html',
  'games/sudoku/lobby/index.html',
  'games/sudoku-4x4/index.html',
  'games/sudoku-4x4/lobby/index.html',
  'games/sudoku-6x6/index.html',
  'games/sudoku-6x6/lobby/index.html',
  'games/equation-pyramid/index.html',
  'games/equation-pyramid/lobby/index.html',
];

/** 可见但不需要翻译的英文（品牌名、语言自称、数值、缩写） */
const ALLOW = [
  /^NumeriDuel$/i, /^MathDuel$/i, /^BoardDuel$/i, /^MemoryDuel$/i,
  /^English$/i, /^中文$/, /^日本語$/, /^Espa[nñ]ol$/i, /^Fran[cç]ais$/i, /^Deutsch$/i,
  /^W\d+$/, /^\d+$/, /^\d+(\.\d+)?s$/,
];

function isVisibleText(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (t.length < 3) return false;
  if (ALLOW.some((re) => re.test(t))) return false;
  // 纯数字 / 纯符号 / 只有 1 个英文单词
  if (/^[\d\s.,:;/%·+×÷=–—-]+$/.test(t)) return false;
  const words = t.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return words.length >= 2;
}

/** 逐个元素扫描，保留行号 */
/**
 * 🔴 已知「HTML 里是英文、但 JS 会在运行时用 i18nT() 覆盖」的节点。
 * 这些不是漏翻，而是**故意不加 data-i18n**：
 *  i18n.js 的 data-i18n 应用是异步的（先 fetch 字典再替换），
 *  会晚于游戏脚本的赋值跑一遍，把刚设好的多语言文案覆盖回HTML 默认那一份。
 * （games/24-game/index.html里就有一段注释记录了这个坑）
 * 验收时应以 CDP 真机渲染结果为准，这里只是让静态扫描不产生已知误报。
 */
const JS_OVERRIDDEN = [
  '#lobbyTitle', '#lobbyDesc',   // 24 点竞赛大厅：setLobbyView() 按视图切换
  '#oppSub', '#youSub',         // 数独对战条：botPaceText() / sg_duel_mycells
];

function scanFile(rel) {
  let src;
  try {
    src = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return [];
  }
  // 去注释
  src = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = src.split('\n');
  const hits = [];

  // 🔴 三类「已本地化但不该报」的上下文：
  //  a) .seo-shell —— 无 JS 的 SEO 兜底骨架，SPA 挂载后整块被 innerHTML 替换，
  //     永远不会出现在真实用户面前；翻成中文反而会污染首屏 SEO。
  //  b) data-i18n-html 的内部子元素 —— 外层已整块替换，子节点不该单独报。
  //  c) 被 JS 在运行时覆盖的节点（如 #lobbyTitle / #oppSub）——
  //     这些 id 在 TS 里有 textContent = i18nT(...) 赋值。
  const isSeoShell = (line) => {
    for (let i = 0; i < line && i < 400; i++) {
      if (lines[i] && lines[i].includes('class="seo-shell"')) return true;
      if (lines[i] && /^<\/div>/.test(lines[i].trim()) && i < line && lines.slice(i, line).some((l) => /<\/section>|<\/header>/.test(l))) return false;
    }
    return false;
  };
  const insideI18nHtml = (line) => {
    for (let i = line - 1; i >= 0; i--) {
      const l = lines[i];
      if (/data-i18n-html/.test(l)) return true;
      if (/<\/p>|<\/div>|<\/h[1-6]>/.test(l)) return false;
    }
    return false;
  };

  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const tags = [];
  let m;
  while ((m = tagRe.exec(src))) {
    const name = m[1].toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;
    tags.push({ name, attrs: m[2], line, start: m.index, end: m.index + m[0].length });
  }

  for (const tag of tags) {
    if (['script', 'style', 'svg', 'defs', 'symbol', 'meta', 'link', 'title', 'noscript'].includes(tag.name)) continue;
    if (/aria-hidden\s*=\s*["']true/.test(tag.attrs)) continue;
    if (/data-i18n(-html|-title|-aria-label)?\s*=/.test(tag.attrs)) continue;
    if (isSeoShell(tag.line) || insideI18nHtml(tag.line)) continue;
    // 运行时由 JS 覆盖的节点（见 JS_OVERRIDDEN 说明）
    if (JS_OVERRIDDEN.some((id) => new RegExp(`id="${id.slice(1)}"`).test(tag.attrs))) continue;
    // 取开标签之后紧邻的文本节点（到下一个 < 之前）
    const after = src.slice(tag.end, tag.end + 200);
    const next = after.indexOf('<');
    if (next < 0) continue;
    const text = after.slice(0, next);
    if (!isVisibleText(text)) continue;
    hits.push({ line: tag.line, tag: tag.name, text: text.replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

let total = 0;
for (const f of HTML_FILES) {
  const hits = scanFile(f);
  if (!hits.length) continue;
  console.log(`\n── ${f}  (${hits.length})`);
  for (const h of hits) {
    console.log(`   L${String(h.line).padStart(4)}  <${h.tag}>  ${h.text.slice(0, 110)}`);
  }
  total += hits.length;
}
console.log(`\n═══ HTML 可见英文未绑定 data-i18n：${total} 处 ═══\n`);
