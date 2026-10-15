#!/usr/bin/env node
/**
 * 扫描「本该走 i18n 却硬编码英文」的字面量（P1-3 盘点用）
 * ----------------------------------------------------------------
 * 判据：出现在 UI 出口（toast / banner / textContent / innerHTML /
 * aria-label / title / placeholder / confirm / alert）里的，
 * 含至少 2 个英文单词的字符串字面量，且不含插值表达式 `${`。
 * 这些就是切到中日文后仍然显示英文的地方。
 *
 * 用法：node scripts/scan-hardcoded-i18n.mjs [--verbose]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const verbose = process.argv.includes('--verbose');

const SINKS = [
  /\btoast\(\s*[`'"]([^`'"]+)[`'"]/g,
  /\bbanner\(\s*[`'"]([^`'"]+)[`'"]/g,
  /\btextContent\s*=\s*[`'"]([^`'"]+)[`'"]/g,
  /\binnerHTML\s*=\s*[`'"]([^`'"]+)[`'"]/g,
  /aria-label\s*=\s*[`'"]([^`'"]+)[`'"]/g,
  /aria-label\s*=\s*\\?[`'"]([^`'"]+)[`'"]/g,
  /\btitle\s*=\s*[`'"]([^`'"]+)[`'"]/g,
  /placeholder\s*=\s*\\?[`'"]([^`'"]+)[`'"]/g,
  // 🔴 el(tag, cls?, text?) —— 通用建节点 helper 的第三个参数就是显示文案。
  //    worksheets.ts 整页纸面文字都是这么生成的，早期版本只扫 textContent/innerHTML，
  //    结果这一页 0 命中却满屏英文（假绿）。
  //    末尾的 `\)` 是关键：只匹配「恰好三参数」的调用，
  //    否则 el('div', 'pcard pc24') 这种两参数（第二个是 className）会被误判。
  /\bel\(\s*[`'"][a-zA-Z][^`'"]*[`'"]\s*,\s*(?:[`'"][^`'"]*[`'"]|undefined)\s*,\s*([`'"])([^`'"]{2,}?)\1\s*\)/g,
  // 🔴 canvas 绘制出口 —— share.ts 的分享卡全部文字是画上去的，
  //    不走 textContent/innerHTML，旧版 SINKS 完全覆盖不到（另一处假绿）。
  /\bfillText\(\s*([^,]{2,}?)\s*,\s*[\w.]+\s*,\s*[\w.]+\s*\)/g,
  // 🔴 三元 / 逻辑或里的裸英文分支 —— 条件 ? i18nT('k') : 'Lock Secret'
  //    只扫「被赋值或被返回的那一侧」会漏掉冒号后的英文，真实代码里两支都常见。
  /\?\s*[^:;]{0,120}:\s*([`'"])([^`'"\n]{2,}?)\1/g,
];

/** 至少 2 个英文单词；含中文的一律跳过（那是注释或键值） */
function isPlainEnglish(s, minWords) {
  if (!s) return false;
  if (/[一-鿿]/.test(s)) return false;
  // CSS 块（内联 <style> / style 模板串）：含 { } 或分号分隔的声明
  if (/[{}]/.test(s) || /;\s*[a-z-]+:\s/.test(s)) return false;
  // 单条 CSS 声明片段，如 "font-family: Inter"（分号后的续行）
  if (/(^|[\s;{])\(?[a-z-]+\)?\s*:\s/.test(s)) return false;
  const t = s.trim();
  if (!t) return false;
  const words = t.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < minWords) return false;
  // 排除纯符号/缩写/键名形态
  if (/^[a-z0-9_.-]+$/i.test(t)) return false;
  // 单词模式下要求词长 >= 3，滤掉 ok/id/no 这类短标记
  if (words[0].length < 3) return false;
  return true;
}

/**
 * 🔴 把含插值的模板字面量切成「静态片段」，逐段判定。
 *
 * 旧实现是 `if (s.includes('${')) return false` —— 只要字面量里出现插值就整条放弃，
 * 于是 `toast(\`Solved ${n} of ${m}\`)` 这种真实硬编码被放过（本轮假绿的头号来源）。
 * 这里保留偏移量，好让调用方判断该片段是否落在 class/id 这类非文案属性里。
 */
function staticSegments(lit) {
  const out = [];
  let cur = '';
  let curStart = 0;
  let i = 0;
  const push = (end) => {
    if (cur.trim()) out.push({ text: cur, start: curStart });
    cur = '';
    curStart = end;
  };
  while (i < lit.length) {
    if (lit[i] === '$' && lit[i + 1] === '{') {
      push(i);
      let depth = 1;
      let q = null;
      i += 2;
      while (i < lit.length && depth > 0) {
        const c = lit[i];
        if (q) {
          if (c === '\\') { i += 2; continue; }
          if (c === q) q = null;
          i += 1;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; i += 1; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    cur += lit[i];
    i += 1;
  }
  push(i);
  return out;
}

/** 该片段是否落在 class/id/href 这类不该翻译的属性值里 */
function inNonTextAttr(lit, seg) {
  const prefix = lit.slice(Math.max(0, seg.start - 70), seg.start);
  return /(?:class|className|id|for|type|href|src|data-[a-z-]+)\s*=/i.test(prefix);
}

/**
 * 片段剥掉 HTML 标签后的可见文字。
 * 判定英文词必须跑在**剥完标签**的文本上，否则 `◆ <span>${x}</span>` 会因为
 * 标签名 `span`（4 个字母）被当成一个英文单词而误报（早期版本的真误报来源）。
 */
function visibleText(segText) {
  return segText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isHardcodedEnglish(s) {
  if (!s) return false;
  if (!s.includes('${')) return isPlainEnglish(s, 2);
  return staticSegments(s).some((seg) => {
    if (inNonTextAttr(s, seg)) return false;
    const text = visibleText(seg.text);
    if (!text) return false;
    return isPlainEnglish(text, 1);
  });
}

/**
 * 命中的那个属性是否已经挂了对应的 data-i18n* 绑定。
 * 运行时 i18n.js 会按 [data-i18n] / [data-i18n-title] / [data-i18n-aria-label] /
 * [data-i18n-placeholder] / [data-i18n-html] 自动替换，所以
 * `title="Collapse sidebar" data-i18n-title="math_home.sb_collapse"` 是**已本地化的**，
 * 字面英文只是 SEO/无 JS 兜底，不该重复报。
 *
 * 🔴 必须是「按属性名配对」而不是「这一行/这块有没有任何 data-i18n」：
 *    真实代码里 `aria-label="Site navigation" data-i18n-aria-label="..."` 常常
 *    和别的 data-i18n 写在同一行甚至同一段模板里，只看整行有没有 data-i18n
 *    会把没绑定 title 的那处一起放过（假绿）。
 *
 * @param ctx  命中位置周围的源码片段（多行模板串也要能覆盖到）
 * @param attr 命中的属性名，如 'title' / 'aria-label' / 'textContent'
 */
function hasI18nBinding(ctx, attr) {
  const plain = attr === 'title' || attr === 'aria-label' || attr === 'placeholder';
  if (!plain) return /data-i18n(-html|-vars)?\s*=/.test(ctx);
  // 从命中的属性往后看 400 字符：HTML 习惯把绑定写在同一个标签内
  const i = ctx.search(new RegExp(`\\b${attr.replace('-', '-')}\\s*=`));
  const tail = i >= 0 ? ctx.slice(i, i + 400) : ctx;
  // 别越到下一个标签去（否则属性 A 的绑定会误判成属性 B 的）
  const nextTag = tail.indexOf('>');
  const scoped = nextTag >= 0 ? tail.slice(0, nextTag) : tail;
  return new RegExp(`data-i18n-${attr}\\s*=`).test(scoped);
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/** 去掉行注释与块注释，避免把文档里的示例代码当真实文案 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // 保留换行以维持行号
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = walk(SRC);
let total = 0;
const perFile = [];

for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'));
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const lineStart = (ln) => {
    let i = -1;
    for (let k = 0; k < ln; k++) i = src.indexOf('\n', i + 1);
    return i + 1;
  };
  const hits = [];
  for (const re of SINKS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const raw = (m[2] != null ? m[2] : m[1]);
      if (raw == null || raw === '') continue;
      // 纯 HTML 片段（<div class=…>）不是文案，跳过
      if (/^\s*</.test(raw)) continue;
      if (!isHardcodedEnglish(raw)) continue;
      const ln = lineOf(m.index);
      // 取命中位置前后一段上下文，多行模板串里的 data-i18n 也要能看到
      const ctx = src.slice(Math.max(0, m.index - 60), m.index + 400);
      if (hasI18nBinding(ctx, m[0].match(/\b(title|aria-label|placeholder)\b/)?.[1] || 'textContent')) continue;
      hits.push({ line: ln, text: raw.trim() });
    }
  }
  // 同一行只报一次（多个 sink 可能命中同一条）
  const seen = new Set();
  const uniq = hits.filter((h) => {
    const k = `${h.line}|${h.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.line - b.line);
  if (uniq.length) {
    perFile.push({ file: relative(ROOT, f), hits: uniq });
    total += uniq.length;
  }
}

perFile.sort((a, b) => b.hits.length - a.hits.length);

console.log(`\n🔍 硬编码英文 UI 文案扫描：共 ${total} 处，分布在 ${perFile.length} 个文件\n`);
for (const { file, hits } of perFile) {
  console.log(`── ${file}  (${hits.length})`);
  if (verbose) {
    for (const h of hits) console.log(`   L${String(h.line).padStart(4)}  ${h.text.slice(0, 100)}`);
  } else {
    const sample = hits.slice(0, 4).map((h) => h.text.slice(0, 46));
    console.log(`   ${sample.join(' | ')}${hits.length > 4 ? `  … +${hits.length - 4}` : ''}`);
  }
}
console.log(`\n合计 ${total} 处。加 --verbose 看逐条明细。\n`);
