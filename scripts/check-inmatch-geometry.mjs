#!/usr/bin/env node
/**
 * 对局沉浸布局几何门禁（check-inmatch-geometry）
 *
 * 背景（2026-10-16）：numeriduel 对局页连续两轮布局回归——
 *   第一轮「棋盘被裁 / 数字键盘不可达」（body position:fixed 无滚动兜底），
 *   第二轮「棋盘不沉浸」（只有 aspect-ratio 没有 grid-template-rows，
 *   行高被格子字号内容撑开；格子字号按 vw 不按棋盘）。
 * 两轮的共同点：tsc / i18n / lang-leak / brand 全绿， bug 照样上线 ——
 * 现有门禁没有任何「几何断言」。本脚本补上这一层。
 *
 * 判据（每个场景）：
 *   1. 棋盘渲染成功（格子数达标）
 *   2. 行数完整（格子 distinct top 数 == 设计行数）—— 抓住「格子互相重叠/行被裁」
 *   3. 无裁切（最后一行底边不超出棋盘底边 >2px）—— 抓住 overflow:hidden 吃行
 *   4. 无不可达控件（视口外且无滚动祖先）—— 抓住「键盘滚不到」
 *   5. 格子字号不溢出（font-size <= 格子高）—— 抓住字号按视口算的溢出
 *   6. 沉浸场景（immersive=true）：.pg-main 零滚动 + 操作区底边 <= 视口高
 *      回退场景（immersive=false，横屏 <560px 高）：不要求零滚动，但 3/4 必须过
 *
 * 用法：
 *   先起 preview（端口默认 4173，可用 PREVIEW_PORT 覆盖），再跑：
 *     node scripts/check-inmatch-geometry.mjs
 *   环境变量：
 *     PREVIEW_PORT  预览服务端口（默认 4173）
 *     CHROME_BIN    浏览器可执行路径（默认按平台探测：Edge/Chrome → google-chrome/chromium）
 *     GATE_OUT      输出目录（默认 <cwd>/.inmatch-gate，含失败场景截图）
 *     GATE_TIMEOUT  单场景总超时 ms（默认 30000）
 *
 * 退出码：0 全过；1 有失败；2 环境不可用（无浏览器 / preview 不通）。
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT_PREVIEW = Number(process.env.PREVIEW_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT_PREVIEW}`;
const OUT_DIR = process.env.GATE_OUT || join(process.cwd(), '.inmatch-gate');
const CASE_TIMEOUT = Number(process.env.GATE_TIMEOUT || 30000);

// ── 浏览器探测：CI（ubuntu-latest）无 Edge，只有 google-chrome/chromium ──
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
  console.error('FATAL: 找不到可用的 Chrome/Edge 浏览器。设 CHROME_BIN 指定路径，或在 CI 用带浏览器的 runner。');
  process.exit(2);
}

// preview 不通就不必启动了（区分「环境问题」与「产品回归」）
try {
  const r = await fetch(`${BASE}/games/sudoku/`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`FATAL: preview 不可达 ${BASE}/games/sudoku/（${e.message}）。先起 vite preview 再跑本门禁。`);
  process.exit(2);
}

const PORT = 9600 + (process.pid % 300);
const userDir = mkdtempSync(join(tmpdir(), 'cdp-gate-'));
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
async function tab(u) { return (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })).json(); }
async function withTimeout(p, ms, label) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`TIMEOUT ${label}`)), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

// [id, url, boardSel, cellSel, nRows, nWait, w, h, immersive]
// nRows：行数断言值；0 = 跳过（24 点发牌随机，牌面位数不同会导致 wrap 行数在 1/3 间抖动，
//       布局本身稳定 bw/bh 恒定，行数判据对它不成立 —— 2026-10-16 实测确认）
// nWait：渲染就绪所需格子数
// 场景挑选原则：覆盖 3 款数独 × solo/duel × 手机/桌面 + 金字塔 + 24 点回归 + 横屏回退，
// 每个维度取最能复现历史 bug 的极端视口（最小手机 360 / 主流手机 390 / 矮桌面 900 / 大桌面 1080）。
const CASES = [
  ['9x9-solo-m360',  '/games/sudoku/?mode=solo',            '.s9-board', '.c9cell', 9, 81, 360, 640, true],
  ['9x9-solo-m390',  '/games/sudoku/?mode=solo',            '.s9-board', '.c9cell', 9, 81, 390, 844, true],
  ['9x9-duel-m390',  '/games/sudoku/?mode=duel',            '.s9-board', '.c9cell', 9, 81, 390, 844, true],
  ['9x9-solo-d900',  '/games/sudoku/?mode=solo',            '.s9-board', '.c9cell', 9, 81, 1280, 900, true],
  ['9x9-duel-d900',  '/games/sudoku/?mode=duel',            '.s9-board', '.c9cell', 9, 81, 1280, 900, true],
  ['9x9-solo-d1080', '/games/sudoku/?mode=solo',            '.s9-board', '.c9cell', 9, 81, 1920, 1080, true],
  ['6x6-solo-m390',  '/games/sudoku-6x6/?mode=solo',        '.s6-board', '.c6cell', 6, 36, 390, 844, true],
  ['6x6-solo-d900',  '/games/sudoku-6x6/?mode=solo',        '.s6-board', '.c6cell', 6, 36, 1280, 900, true],
  ['4x4-solo-m390',  '/games/sudoku-4x4/?mode=solo',        '.s4-board', '.c4cell', 4, 16, 390, 844, true],
  ['4x4-solo-d900',  '/games/sudoku-4x4/?mode=solo',        '.s4-board', '.c4cell', 4, 16, 1280, 900, true],
  ['ep-solo-m390',   '/games/equation-pyramid/?mode=solo', '.ep-grid',  '.epc',    3, 9, 390, 844, true],
  ['ep-solo-d900',   '/games/equation-pyramid/?mode=solo', '.ep-grid',  '.epc',    3, 9, 1280, 900, true],
  ['g24-solo-d900',  '/games/24-game/?mode=solo',           '.cards',   '.card',   0, 4, 1280, 900, true],
  ['9x9-solo-land',  '/games/sudoku/?mode=solo',            '.s9-board', '.c9cell', 9, 81, 667, 375, false],
];

const Q = `(function(){
  var b=document.querySelector(BOARDSEL); if(!b) return {err:'no board'};
  var br=b.getBoundingClientRect();
  var cells=Array.from(b.querySelectorAll(CELLSEL));
  var lastB=cells.length?Math.max.apply(null,cells.map(function(c){return c.getBoundingClientRect().bottom;})):br.bottom;
  var pm=document.querySelector('.pg-main');
  var vh=window.innerHeight;
  var pad=document.querySelector('.s9-pad,.s6-pad,.s4-pad,.ep-tools,.pad');
  var padB=pad?Math.round(pad.getBoundingClientRect().bottom):-1;
  // 不可达（视口外且无滚动祖先）
  var un=0, unList=[];
  document.querySelectorAll('.pk,.ep-tool,.card,.op-btn,.s9-pad button,.s6-pad button,.s4-pad button').forEach(function(el){
    var s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden')return;
    var r=el.getBoundingClientRect(); if(r.height<2)return;
    if(r.bottom>vh+2||r.top<-2){ var canScroll=false; var p=el.parentElement;
      while(p&&p!==document.documentElement){var ps=getComputedStyle(p);
        if((ps.overflowY==='auto'||ps.overflowY==='scroll')&&p.scrollHeight>p.clientHeight+2){canScroll=true;break;} p=p.parentElement;}
      if(!canScroll){un++; if(unList.length<5)unList.push((el.className+'').split(' ')[0]+'@'+Math.round(r.top));} }});
  // 格子字号溢出（字号 > 格子高即溢出）
  var fontOver=0;
  cells.forEach(function(c){ var cs=getComputedStyle(c); var fs=parseFloat(cs.fontSize)||0;
    if(fs>c.getBoundingClientRect().height+0.5) fontOver++; });
  return {bw:Math.round(br.width),bh:Math.round(br.height),
    rows:(function(){var t={};cells.forEach(function(c){var r=c.getBoundingClientRect();t[Math.round(r.top)]=1;});return Object.keys(t).length;})(),
    over:Math.round(lastB-br.bottom), un:un, unList:unList, fontOver:fontOver,
    pgScroll:pm?Math.round(pm.scrollHeight-pm.clientHeight):-1,
    padB:padB, vh:vh};
})()`;

const out = [];
let pass = 0, fail = 0;
for (const [id, url, b, c, n, nw, w, h, immersive] of CASES) {
  try {
    await withTimeout((async () => {
      const t = await tab('about:blank');
      const cd = await C.connect(t.webSocketDebuggerUrl);
      await cd.send('Runtime.enable');
      await cd.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 1000 });
      await cd.send('Page.navigate', { url: BASE + url });
      let rendered = false;
      for (let i = 0; i < 48; i++) {
        try { if ((await cd.eval(`document.querySelectorAll('${c}').length`)) >= nw) { rendered = true; break; } } catch { /* retry */ }
        await sleep(250);
      }
      await sleep(700);
      const r = await cd.eval(Q.replace('BOARDSEL', JSON.stringify(b)).replace('CELLSEL', JSON.stringify(c)));
      out.push({ id, w, h, ...r });
      const errs = [];
      if (!rendered) errs.push('NOT_RENDERED');
      if (n > 0 && r.rows !== n) errs.push(`rows=${r.rows}/${n}`);
      if (r.over > 2) errs.push(`clip=${r.over}`);
      if (r.un > 0) errs.push(`unreachable=${r.un}`);
      if (r.fontOver > 0) errs.push(`fontOver=${r.fontOver}`);
      if (immersive) {
        if (r.pgScroll !== 0) errs.push(`scroll=${r.pgScroll}`);
        if (r.padB > h + 2) errs.push(`padBelowFold=${r.padB}/${h}`);
      } else if (r.un > 0) {
        errs.push('fallback-unreachable');
      }
      if (errs.length) {
        fail++;
        console.log(`FAIL ${id.padEnd(15)} board=${r.bw}x${r.bh} ${errs.join(' ')}${r.unList.length ? ' ' + JSON.stringify(r.unList) : ''}`);
        try {
          const cap = await cd.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(OUT_DIR, `fail-${id}.png`), Buffer.from(cap.data, 'base64'));
        } catch { /* screenshot best-effort */ }
      } else {
        pass++;
        console.log(`PASS ${id.padEnd(15)} board=${r.bw}x${r.bh} rows=${r.rows} pad=${r.padB}/${h} scroll=${r.pgScroll}`);
      }
      await cd.send('Page.close').catch(() => {});
      cd.close();
    })(), CASE_TIMEOUT, id);
  } catch (e) {
    fail++;
    console.log(`FAIL ${id.padEnd(15)} ${e.message.slice(0, 140)}`);
    out.push({ id, w, h, error: e.message });
  }
}

writeFileSync(join(OUT_DIR, 'result.json'), JSON.stringify(out, null, 2));
edge.kill();
console.log(`DONE pass=${pass} fail=${fail}  (截图与数据：${OUT_DIR})`);
process.exit(fail > 0 ? 1 : 0);
