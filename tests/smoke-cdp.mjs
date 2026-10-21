#!/usr/bin/env node
/**
 * 页面 smoke 门禁（CDP 零依赖，2026-10-21）
 *
 * 为什么有这份脚本（背景）：
 *   tests/ 原有三个文件全部不可执行——acceptance.mjs import 未安装的 'playwright'
 *   且断言的是 home-v2 改版前的首页（.hero-title / .game-card / #dailyCount /
 *   'Space Grotesk' 字体，这些在现行页面里已不存在）；audit-solo-lobby.mjs
 *   require 他人机器上的 playwright-core 绝对路径；probe.mjs 指向不存在的
 *   tests/min/。三者均无 npm script / CI job 调用——即本仓对「首页/主页面
 *   渲染回归」零机器防线，2026-10 首页改版这类改动无任何拦截。
 *   （三个旧文件已删除，其 lobby 场景由本脚本以 CDP 范式继承。）
 *
 * 本脚本做什么：
 *   零依赖 CDP（与 scripts/check-inmatch-geometry.mjs 同一范式，不引 playwright），
 *   对现行 home-v2 首页 + 5 个对战 lobby + daily/me/worksheets/shop 四个主页面
 *   断言关键 DOM 结构渲染成功 + 移动端首页无水平溢出。
 *
 * 不做什么（重要，避免假红）：
 *   不断言 console/pageerror——本地/CI 的 vite preview 没有后端，/api/* 失败会
 *   产生与产品无关的噪音（inmatch-gate 同样只做 DOM 断言）。
 *   4xx/5xx 响应只打印、不计失败（本地 preview 无 API 属环境限制）。
 *
 * 用法：
 *   先起 preview（默认端口 4173，PREVIEW_PORT 可覆盖），再：
 *     node tests/smoke-cdp.mjs
 *   环境变量：BASE / PREVIEW_PORT / CHROME_BIN / GATE_OUT / GATE_TIMEOUT
 *   （与 inmatch 门禁保持一致）
 *
 * 退出码：0 全过；1 有失败；2 环境不可用（无浏览器 / preview 不通）。
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT_PREVIEW = Number(process.env.PREVIEW_PORT || 4173);
const BASE = (process.env.BASE || `http://127.0.0.1:${PORT_PREVIEW}`).replace(/\/$/, '');
const OUT_DIR = process.env.GATE_OUT || join(process.cwd(), '.smoke-gate');
const CASE_TIMEOUT = Number(process.env.GATE_TIMEOUT || 20000);
const WAIT_RENDER = 1800; // SPA 挂载 + 字典加载的保守等待（ms）

/* ─── 浏览器探测：CI（ubuntu-latest）无 Edge，只有 google-chrome/chromium ─── */
function findBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    const cands = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const c of cands) if (existsSync(c)) return c;
  } else {
    for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try { execSync(`command -v ${c}`, { stdio: 'ignore' }); return c; } catch { /* next */ }
    }
  }
  return null;
}

const BIN = findBrowser();
if (!BIN) {
  console.error('FATAL: 找不到可用的 Chrome/Edge 浏览器。设 CHROME_BIN 指定路径。');
  process.exit(2);
}

// preview 不通就不必启动了（区分「环境问题」与「产品回归」）
try {
  const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`FATAL: preview 不可达 ${BASE}/（${e.message}）。先起 vite preview 再跑本门禁。`);
  process.exit(2);
}

const PORT = 9700 + (process.pid % 300);
const userDir = mkdtempSync(join(tmpdir(), 'smoke-gate-'));
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(BIN, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--no-sandbox',
  `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
let edgeUp = false;
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { edgeUp = true; break; } } catch { /* retry */ }
  await sleep(250);
}
if (!edgeUp) { console.error('FATAL: 浏览器 CDP 端口 20s 内未就绪'); edge.kill(); process.exit(2); }

/* ─── 精简 CDP 客户端（WebSocket 原生，无依赖） ─── */
class C {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); }
  static async connect(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new C(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.p.has(m.id)) {
        const { res, rej } = c.p.get(m.id); c.p.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.p.set(id, { res, rej }));
  }
  async eval(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval exception');
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ─── 场景定义：[名称, 路径, viewport, 断言[标签, 表达式]] ─── */
const MOBILE = { w: 390, h: 844, mobile: true };
const DESKTOP = { w: 1440, h: 900, mobile: false };

const SCENES = [
  ['首页-桌面', '/', DESKTOP, [
    ['#home-v2 已挂载', `!!document.querySelector('#home-v2')`],
    // 注意：index.html 的静态 SEO 骨架（.seo-shell/.ss-hero）在 SPA 挂载后会被
    // home-redesign.ts 的 root.innerHTML 替换——断言必须针对**渲染结果**
    // （.wall-grid 游戏墙 / .gcard 卡 / .hero h1），不能针对已被替换的静态骨架。
    ['游戏墙 .wall-grid 渲染', `!!document.querySelector('.wall-grid')`],
    ['游戏卡 = 5', `document.querySelectorAll('.wall-grid .gcard').length === 5`],
    ['Hero 标题渲染', `!!document.querySelector('.hero h1') && document.querySelector('.hero h1').textContent.trim().length > 0`],
  ]],
  ['首页-移动', '/', MOBILE, [
    ['无水平溢出', `document.documentElement.scrollWidth <= window.innerWidth + 1`],
  ]],
  ['lobby-24-game', '/games/24-game/lobby/', DESKTOP, [
    ['#modeGrid 渲染', `!!document.querySelector('#modeGrid')`],
    ['mode 卡 >= 3', `document.querySelectorAll('#modeGrid .mode').length >= 3`],
  ]],
  ['lobby-sudoku', '/games/sudoku/lobby/', DESKTOP, [
    ['#modeGrid 渲染', `!!document.querySelector('#modeGrid')`],
    ['mode 卡 >= 3', `document.querySelectorAll('#modeGrid .mode').length >= 3`],
  ]],
  ['lobby-sudoku-4x4', '/games/sudoku-4x4/lobby/', DESKTOP, [
    ['#modeGrid 渲染', `!!document.querySelector('#modeGrid')`],
    ['mode 卡 >= 3', `document.querySelectorAll('#modeGrid .mode').length >= 3`],
  ]],
  ['lobby-sudoku-6x6', '/games/sudoku-6x6/lobby/', DESKTOP, [
    ['#modeGrid 渲染', `!!document.querySelector('#modeGrid')`],
    ['mode 卡 >= 3', `document.querySelectorAll('#modeGrid .mode').length >= 3`],
  ]],
  ['lobby-equation-pyramid', '/games/equation-pyramid/lobby/', DESKTOP, [
    ['#modeGrid 渲染', `!!document.querySelector('#modeGrid')`],
    ['mode 卡 >= 3', `document.querySelectorAll('#modeGrid .mode').length >= 3`],
  ]],
  ['daily', '/daily/', DESKTOP, [
    ['#streak 渲染', `!!document.querySelector('#streak')`],
    ['#cards 渲染', `!!document.querySelector('#cards')`],
  ]],
  ['me', '/me/', DESKTOP, [
    ['#totals 渲染', `!!document.querySelector('#totals')`],
  ]],
  ['worksheets', '/worksheets/', DESKTOP, [
    ['#gameTabs 渲染', `!!document.querySelector('#gameTabs')`],
  ]],
  ['shop', '/shop/', DESKTOP, [
    ['#shopCard 渲染', `!!document.querySelector('#shopCard')`],
  ]],
];

let pass = 0;
let fail = 0;
const failures = [];
const ok = (c, m) => {
  if (c) { pass++; console.log('  PASS', m); }
  else { fail++; failures.push(m); console.log('  FAIL', m); }
};

async function withTimeout(p, ms, label) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`TIMEOUT ${label}`)), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

for (const [name, path, vp, checks] of SCENES) {
  console.log(`\n=== ${name} (${vp.w}x${vp.h}) ${path} ===`);
  const failBefore = fail;
  let c;
  try {
    const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    c = await C.connect(tab.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
    });
    const http4xx = [];
    // 网络监听（只打印，不计失败）：Network.domain 事件
    await c.send('Network.enable');
    c.ws.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
          http4xx.push(`${m.params.response.status} ${m.params.response.url.replace(BASE, '').slice(0, 60)}`);
        }
      } catch { /* ignore */ }
    });

    await withTimeout(c.send('Page.navigate', { url: BASE + path }), CASE_TIMEOUT, name);
    await sleep(WAIT_RENDER);

    for (const [label, expr] of checks) {
      const v = await withTimeout(c.eval(expr), 5000, `${name}/${label}`);
      ok(v === true, `${label}（实际 ${JSON.stringify(v)}）`);
    }

    if (http4xx.length) {
      console.log(`     ⚠️ 4xx/5xx ${http4xx.length} 个（本地 preview 无后端属预期，不计失败）：`);
      [...new Set(http4xx)].slice(0, 5).forEach((u) => console.log('      ', u));
    }
  } catch (e) {
    ok(false, `场景异常：${e.message.slice(0, 120)}`);
  }

  // 本场景有失败（断言失败或异常）→ 截图留证
  if (fail > failBefore) {
    try {
      const shot = await c?.send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) writeFileSync(join(OUT_DIR, `fail-${name}.png`), Buffer.from(shot.data, 'base64'));
    } catch { /* ignore */ }
  }
  c?.close();
}

edge.kill();
console.log(`\n================ smoke 结果：${pass} 通过 / ${fail} 失败 ================`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  ✗', f));
  console.log(`截图目录（如有）：${OUT_DIR}`);
}
process.exit(fail === 0 ? 0 : 1);
