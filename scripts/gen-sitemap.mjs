/**
 * 从 vite.config.ts 的 rollupOptions.input 派生 sitemap.xml。
 *
 * 为什么要有这个脚本：
 * public/sitemap.xml 此前是手写的，于是 /daily/ /me/ /worksheets/ 三个页面
 * 建好了、上线了，却从来没进过 sitemap —— 尤其是 /daily/，那是刚做完的
 * 每日赛入口，功能、入口、倒计时都有，就是没告诉 Google 这页存在。
 * 手写清单一定会漏，所以改成从唯一的真源（vite input）自动派生。
 *
 * 用法：node scripts/gen-sitemap.mjs [--check]
 *   --check  只比对不写文件，CI 或人工核对用（进程退出码 1 表示有差异）
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const ORIGIN = 'https://numeriduel.com';

/* ── 不进 sitemap 的页面 ──────────────────────────────────────────────
 * me：个人化页面（"Your journey, your device"），每个用户看到的内容不同，
 *     且没有 canonical。爬虫抓到的是一份零数据页面（0 streak / 0/5 today），
 *     属于低质量收录，进 sitemap 有害无益。
 *
 * 别顺手把 lobby 也排掉：实测 /games/24-game/lobby/ 有 1605 字符正文
 * （比游戏主页本身还多）且有 canonical，是有效的可索引页。
 * 「名字听起来像入口页」不是排除理由 —— 要看真实正文。
 */
const EXCLUDE = new Set(['me']);

/* ── 各页的抓取频率与权重 ──────────────────────────────────────────── */
function metaFor(key, urlPath) {
  if (urlPath === '/') return { changefreq: 'daily', priority: '1.0' };
  if (key === 'daily') return { changefreq: 'daily', priority: '0.9' };  // 每日五题+赛事榜每天变
  if (key === 'worksheets') return { changefreq: 'weekly', priority: '0.7' };
  if (urlPath.startsWith('/games/')) return { changefreq: 'weekly', priority: '0.9' };
  return { changefreq: 'monthly', priority: '0.6' };
}

/* ── 从 vite.config.ts 提取 input ──────────────────────────────────────
 * 用文本正则而不是 import 该模块：vite.config.ts 里有 defineConfig 等
 * 依赖，直接 import 会失败；而 input 块本身就是一份规整的键值对。
 */
function readViteInputs() {
  const src = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
  const block = src.slice(src.indexOf('input:'));
  const end = block.indexOf('},');
  const body = end > 0 ? block.slice(0, end) : block;

  const out = [];
  const re = /['"]?([\w-]+)['"]?\s*:\s*resolve\(\s*here\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(body))) out.push({ key: m[1], file: m[2] });
  return out;
}

function toUrlPath(file) {
  // 'index.html' -> '/'    'games/24-game/index.html' -> '/games/24-game/'
  const dir = file.replace(/index\.html$/, '');
  return '/' + dir;
}

function lastmod(file) {
  try {
    return statSync(resolve(root, file)).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function build() {
  const inputs = readViteInputs();
  if (!inputs.length) throw new Error('vite.config.ts 里没解析到任何 input —— 正则可能失配了');

  const urls = inputs
    .filter((i) => !EXCLUDE.has(i.key))
    .map((i) => {
      const p = toUrlPath(i.file);
      const meta = metaFor(i.key, p);
      return { key: i.key, loc: ORIGIN + p, lastmod: lastmod(i.file), ...meta };
    })
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));

  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n` +
        `    <lastmod>${u.lastmod}</lastmod>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        `    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    body +
    `\n</urlset>\n`
  );
}

/* ── 入口 ──────────────────────────────────────────────────────────── */
const check = process.argv.includes('--check');
const next = build();
const target = resolve(root, 'public/sitemap.xml');

let prev = null;
try {
  prev = readFileSync(target, 'utf8');
} catch {
  prev = null;
}

if (check) {
  if (prev === next) {
    console.log('sitemap 已是最新');
    process.exit(0);
  }
  const oldLocs = new Set([...prev.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const newLocs = new Set([...next.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const added = [...newLocs].filter((x) => !oldLocs.has(x));
  const removed = [...oldLocs].filter((x) => !newLocs.has(x));
  console.log('sitemap 有差异：');
  if (added.length) console.log('  新增:', added.join(', '));
  if (removed.length) console.log('  移除:', removed.join(', '));
  if (!added.length && !removed.length) console.log('  （仅 lastmod/顺序变化）');
  process.exit(1);
}

writeFileSync(target, next, 'utf8');
const n = [...next.matchAll(/<loc>/g)].length;
console.log(`已生成 public/sitemap.xml（${n} 条）`);
