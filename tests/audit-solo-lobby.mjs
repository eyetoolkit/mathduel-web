import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/刘先生/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:5199';

// 每款游戏：solo 入口 + 渲染判据（SVG 棋盘查 rect，pyramid 查 .ep-row，24 点查 .card）
const GAMES = [
  { g: '24-game',           solo: '?mode=practice', check: 'cards' },
  { g: 'sudoku',           solo: '?mode=solo',     check: 'svg' },
  { g: 'sudoku-4x4',       solo: '?mode=solo',     check: 'svg' },
  { g: 'sudoku-6x6',       solo: '?mode=solo',     check: 'svg' },
  { g: 'equation-pyramid', solo: '?mode=solo',     check: 'pyr' },
];

// lobby 验收：5 个 <a> 真卡 + 灰态 SOON 卡（design intent，见 10-14 红线）
const LOBBY_CHECKS = {
  modeLinksMin: 3,        // Create/Join/Practice 三张真卡（pyramid 多一张 Bot）
  randomGhost: true,      // Random Match 应是 <span> 灰态
};

const results = [];
const log = (msg) => console.log(msg);

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

for (const { g, solo, check } of GAMES) {
  const entry = `${BASE}/games/${g}/`;
  const soloUrl = `${BASE}/games/${g}/${solo}`;
  const lobbyUrl = `${BASE}/games/${g}/lobby/`;
  const pageErrors = [];
  const httpErrors = [];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 60)}`);
  });

  // ---------- A. 对局页入口 ----------
  let entryOk = 'NAV_FAIL';
  let entryDetail = '';
  try {
    await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    entryOk = await page.evaluate(() => {
      const r = document.readyState;
      // 无 ?mode= 时按设计 location.replace(LOBBY) —— 判据：body 有 .lobby 或已跳转
      const isLobby = !!document.querySelector('.lobby-card, #modeGrid');
      const isGame = !!document.querySelector('#cards, #s9board, #s4board, #s6board, #epgrid, #board');
      return `rs:${r} lobby:${isLobby} game:${isGame}`;
    });
    entryDetail = entryOk;
  } catch (e) {
    entryDetail = e.message.slice(0, 80);
  }

  // ---------- B. Solo 模式（独立 goto，避免 replace 干扰） ----------
  let soloOk = false;
  let soloDetail = 'FAIL';
  try {
    await page.goto(soloUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // 等引擎渲染：SVG 棋盘 / 卡片 / pyramid 行
    if (check === 'svg') {
      await page.waitForFunction(
        () => {
          const b = document.querySelector('#s9board, #s4board, #s6board');
          if (!b) return false;
          // 数独格子 = board 直接子元素（HTML 骨架静态生成 81/16/36 格）
          // svg.grid-lines 由 JS requestAnimationFrame 追加
          return b.children.length > 0 && !!b.querySelector('svg.grid-lines');
        },
        null,
        { timeout: 8000 },
      ).catch(() => {});
      soloDetail = await page.evaluate(() => {
        const b = document.querySelector('#s9board, #s4board, #s6board');
        // children 含 1 条 svg.grid-lines，格子数 = children - 1
        const cells = b ? b.children.length - 1 : 0;
        const svg = b ? !!b.querySelector('svg.grid-lines') : false;
        const expected = { 81: '9x9', 16: '4x4', 36: '6x6' };
        const sz = expected[cells] || '?';
        return `cells:${cells}(${sz}) svg-lines:${svg}`;
      });
      soloOk = /cells:(\d+)/.test(soloDetail) && [81, 16, 36].includes(+soloDetail.match(/cells:(\d+)/)[1]);
    } else if (check === 'cards') {
      await page.waitForFunction(
        () => document.querySelectorAll('#cards .card').length >= 4,
        null,
        { timeout: 8000 },
      ).catch(() => {});
      soloDetail = await page.evaluate(() => `cards:${document.querySelectorAll('#cards .card').length}`);
      soloOk = /cards:\d+/.test(soloDetail) && +soloDetail.match(/cards:(\d+)/)[1] >= 4;
    } else if (check === 'pyr') {
      await page.waitForFunction(
        () => document.querySelectorAll('#epgrid .ep-row').length >= 1,
        null,
        { timeout: 8000 },
      ).catch(() => {});
      soloDetail = await page.evaluate(() => {
        const rows = document.querySelectorAll('#epgrid .ep-row').length;
        const target = (document.querySelector('#targetNum')?.textContent || '').trim();
        return `pyr-rows:${rows} target:${target || '?'}`;
      });
      soloOk = /pyr-rows:\d+/.test(soloDetail) && +soloDetail.match(/pyr-rows:(\d+)/)[1] >= 1;
    }
  } catch (e) {
    soloDetail = e.message.slice(0, 80);
  }

  // ---------- C. 对战 Lobby ----------
  let lobbyOk = false;
  let lobbyDetail = 'FAIL';
  try {
    await page.goto(lobbyUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500); // 字典 + 全球榜 fetch
    lobbyDetail = await page.evaluate(() => {
      const all = document.querySelectorAll('#modeGrid .mode');
      const links = Array.from(all).filter((el) => el.tagName === 'A');
      const ghosts = Array.from(all).filter((el) => el.tagName === 'SPAN' || el.classList.contains('disabled'));
      const soon = document.querySelector('#modeGrid .soon-pill');
      const title = (document.querySelector('#modesTitle')?.textContent || '').trim().slice(0, 50);
      // 全球榜加载状态
      const boardRows = document.querySelectorAll('#boardRows .arb-row').length;
      const boardEmpty = !!document.querySelector('#boardRows .arb-empty');
      return `cards:${all.length}(A:${links.length},ghost:${ghosts.length},soon:${!!soon}) title:"${title}" board:rows=${boardRows}empty=${boardEmpty}`;
    });
    const m = lobbyDetail.match(/cards:(\d+)/);
    lobbyOk = m ? +m[1] >= LOBBY_CHECKS.modeLinksMin : false;
  } catch (e) {
    lobbyDetail = e.message.slice(0, 80);
  }

  const allErrors = [...new Set(pageErrors)];
  const allHttp = [...new Set(httpErrors)];

  results.push({
    g,
    entry: { ok: entryOk !== 'NAV_FAIL', detail: entryDetail },
    solo: { ok: soloOk, detail: soloDetail },
    lobby: { ok: lobbyOk, detail: lobbyDetail },
    errors: allErrors,
    http4xx: allHttp,
  });

  await ctx.close();
}

await browser.close();

console.log('\n' + '='.repeat(64));
console.log('NUMERIDUEL 5 款游戏 · 运行 + 对战模式验收');
console.log('='.repeat(64));
for (const r of results) {
  const mark = (b) => (b ? '✅' : '❌');
  console.log(`\n■ ${r.g}`);
  console.log(`  入口页   ${mark(r.entry.ok)} ${r.entry.detail}`);
  console.log(`  Solo    ${mark(r.solo.ok)} ${r.solo.detail}`);
  console.log(`  对战大厅 ${mark(r.lobby.ok)} ${r.lobby.detail}`);
  if (r.errors.length) {
    console.log(`  🔴 pageerrors(${r.errors.length}):`);
    r.errors.forEach((e) => console.log('    ✗', e));
  }
  if (r.http4xx.length) {
    console.log(`  ⚠️ 4xx(${r.http4xx.length}):`);
    r.http4xx.slice(0, 5).forEach((e) => console.log('    ', e));
  }
}

const totalIssues = results.reduce((acc, r) => {
  if (!r.entry.ok) acc++;
  if (!r.solo.ok) acc++;
  if (!r.lobby.ok) acc++;
  if (r.errors.length) acc += r.errors.length;
  return acc;
}, 0);
console.log('\n' + '='.repeat(64));
console.log(`总问题数：${totalIssues}（0 = 全绿）`);
console.log('='.repeat(64));
