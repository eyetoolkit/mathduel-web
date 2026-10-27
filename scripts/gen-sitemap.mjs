/**
 * 从两个真源派生 sitemap.xml：
 *   ① vite.config.ts 的 rollupOptions.input（构建型页面）
 *   ② public 目录下的手写静态页 index.html（about/contact/terms/privacy）
 *
 * 为什么要有这个脚本：
 * public/sitemap.xml 此前是手写的，于是 /daily/ /me/ /worksheets/ 三个页面
 * 建好了、上线了，却从来没进过 sitemap —— 尤其是 /daily/，那是刚做完的
 * 每日赛入口，功能、入口、倒计时都有，就是没告诉 Google 这页存在。
 * 手写清单一定会漏，所以改成从真源自动派生。
 *
 * 2026-10-22 补第二个真源：about/contact/terms/privacy 是 public/ 下的静态页，
 * 不在 vite input 里，因此从未进过 sitemap —— 可索引、有 canonical、有正文，
 * 却对搜索引擎隐身。同理 /shop/ 是 noindex 页，却一直在 sitemap 里，
 * 「别收录我」和「这是重要页面」两个信号互相矛盾，一并列正。
 *
 * 用法：node scripts/gen-sitemap.mjs [--check]
 *   --check  只比对不写文件，CI 或人工核对用（进程退出码 1 表示有差异）
 */
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const ORIGIN = 'https://www.numeriduel.com';

/* ── 不进 sitemap 的页面 ──────────────────────────────────────────────
 * me：个人化页面（"Your journey, your device"），每个用户看到的内容不同，
 *     且没有 canonical。爬虫抓到的是一份零数据页面（0 streak / 0/5 today），
 *     属于低质量收录，进 sitemap 有害无益。
 *
 * 别顺手把 lobby 也排掉：实测 /games/24-game/lobby/ 有 1605 字符正文
 * （比游戏主页本身还多）且有 canonical，是有效的可索引页。
 * 「名字听起来像入口页」不是排除理由 —— 要看真实正文。
 */
const EXCLUDE = new Set(['me', 'shop']);
// shop：页面自身 noindex（金币商店属登录后功能），进 sitemap 是矛盾信号；
// 若日后改为可索引，删掉这个 key 即可自动回归。

/* ── 各页的抓取频率与权重 ──────────────────────────────────────────── */
function metaFor(key, urlPath) {
  const staticMeta = {
    '/about/': { changefreq: 'monthly', priority: '0.6' },
    '/contact/': { changefreq: 'monthly', priority: '0.4' },
    '/terms/': { changefreq: 'monthly', priority: '0.3' },
    '/privacy/': { changefreq: 'monthly', priority: '0.3' },
  };
  if (staticMeta[urlPath]) return staticMeta[urlPath];
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

/* 静态页来源：public/<dir>/index.html。
 * 收录标准不是「页面存在」，而是「页面准备好了被收录」：
 *   - 有 noindex robots meta → 跳过（与页面自身意愿一致，防矛盾信号；
 *     teacher 页就是这样被自动排除的，无需手工维护清单）
 *   - 没有 canonical → 跳过（join 房码入口页属功能性跳板，薄内容）
 */
function readStaticPages() {
  const base = resolve(root, 'public');
  const out = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = `${entry.name}/index.html`;
    if (!existsSync(resolve(root, 'public', file))) continue;
    const html = readFileSync(resolve(root, 'public', file), 'utf8');
    if (/name="robots"[^>]*noindex/.test(html)) continue;
    if (!/rel="canonical"/.test(html)) continue;
    out.push({ key: entry.name, file });
  }
  return out;
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

  const candidates = [
    ...inputs.map((i) => ({ ...i })),
    ...readStaticPages().map((i) => ({ ...i })),
  ];

  const seen = new Set();
  const urls = candidates
    .filter((i) => !EXCLUDE.has(i.key))
    .map((i) => {
      const p = toUrlPath(i.file);
      const meta = metaFor(i.key, p);
      return { key: i.key, loc: ORIGIN + p, lastmod: lastmod(i.file), ...meta };
    })
    // 静态页与 vite input 理论上不重叠；万一重叠，以先出现的 vite input 为准
    .filter((u) => (seen.has(u.loc) ? false : (seen.add(u.loc), true)))
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

  // ⚠️ 2026-10-17：<lastmod> 是构建当天日期，<url> 顺序也随入口注册顺序漂移，
  //    所以「URL 集合一致、只有 lastmod/顺序不同」是**正常状态**，不该判红。
  //    早先版本对此也 exit 1，导致本门禁一旦接进 build 就会永远失败 ——
  //    变成一个装饰性红灯（真正该抓的「入口漏注册」反而被淹没）。
  //    现在只对 URL 集合的增删判红，这才是本脚本要守的不变量。
  if (!added.length && !removed.length) {
    console.log('sitemap URL 集合与入口一致（lastmod/顺序为构建期产物，不参与判定）');
    process.exit(0);
  }

  console.log('sitemap URL 集合与页面真源（vite input + public 静态页）不一致：');
  if (added.length) console.log('  新增:', added.join(', '));
  if (removed.length) console.log('  移除:', removed.join(', '));
  console.log('  → 若确认是有意增删入口，请执行 `node scripts/gen-sitemap.mjs` 重新生成后提交。');
  process.exit(1);
}

writeFileSync(target, next, 'utf8');
const n = [...next.matchAll(/<loc>/g)].length;
console.log(`已生成 public/sitemap.xml（${n} 条）`);
