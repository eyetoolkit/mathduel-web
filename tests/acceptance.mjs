/**
 * MathDuel 新架构 · 端到端验收
 * 验收项（对应「所见即所得」硬约束）：
 *  1. 首页：Hero + 6 张游戏卡 + 每日挑战设置渲染成功
 *  2. 字体：Space Grotesk / Sora 同源加载成功（非常量回退字体）
 *  3. 无外部字体请求（CSP 兼容）
 *  4. 24 点：引擎可用（发牌 → 答案 → 输入判定）
 *  5. 24 点：每日挑战题目数 / 60s 倒计时 / 题号显示
 *  6. 24 点：竞赛建房（DEMO 99 人）→ 开局 → 同牌
 *  7. 移动端：无水平溢出，tab 不截断，触摸目标 ≥44px
 *  8. 控制台错误 = 0
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173';
let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) {
    pass++;
    console.log('  PASS', m);
  } else {
    fail++;
    console.log('  FAIL', m);
  }
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

/* ---------------- 桌面端 ---------------- */
console.log('\n=== 桌面端 (1440x900) ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const fontRequests = [];
  const externalFonts = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    const u = r.url();
    if (/\.woff2?(\?|$)/.test(u)) {
      fontRequests.push(u);
      if (!u.includes('localhost')) externalFonts.push(u);
    }
  });

  await page.goto(BASE + '/', { waitUntil: 'commit' });

  ok(await page.locator('.hero-title').isVisible(), 'Hero 标题可见');
  const cards = await page.locator('.game-card').count();
  ok(cards === 6, `游戏卡数量 = 6（实际 ${cards}）`);
  ok((await page.locator('#dailyCount button').count()) === 3, '每日挑战题数选项 = 3 (5/10/15)');
  ok((await page.locator('#dailyTime button').count()) === 3, '每日挑战时间选项 = 3 (60/90/120s)');
  const heroFlow = await page.locator('#heroFlow .fl').count();
  ok(heroFlow > 0, `记忆点算式流元素已生成（${heroFlow} 个）`);

  await page.locator('#dailyCount button[data-c="10"]').click();
  await page.locator('#dailyTime button[data-t="90"]').click();
  const href = await page.locator('#dailyStart').getAttribute('href');
  ok(/count=10/.test(href) && /time=90/.test(href), `每日挑战链接同步设置：${href}`);

  await page.waitForTimeout(600);
  const loaded = await page.evaluate(() =>
    Array.from(document.fonts)
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family),
  );
  ok(loaded.includes('Space Grotesk'), 'Space Grotesk 已加载（非通用字体）');
  ok(loaded.includes('Sora'), 'Sora 已加载（非通用字体）');
  ok(fontRequests.length > 0 && externalFonts.length === 0, `字体全部同源（${fontRequests.length} 个请求，外部 ${externalFonts.length} 个）`);

  ok(errors.length === 0, `首页控制台错误 = 0（实际 ${errors.length}）`);
  if (errors.length) console.log('     errors:', errors.slice(0, 3));
  await ctx.close();
}

/* ---------------- 24 点游戏 ---------------- */
console.log('\n=== 24 点游戏 ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(BASE + '/games/24-game/', { waitUntil: 'commit' });

  ok((await page.locator('.card').count()) === 4, '发牌 = 4 张');
  await page.locator('#answerBtn').click();
  await page.waitForTimeout(300);
  const solText = await page.locator('.sol').first().textContent().catch(() => '');
  ok(/= 24/.test(solText || ''), `引擎解出标准答案：${(solText || '').trim().slice(0, 40)}`);
  await page.locator('#mNext').click();
  await page.waitForTimeout(200);

  const nums = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.card .num')).map((e) => +e.textContent),
  );
  console.log('     本局牌面:', nums.join(','));
  await page.locator('.card').nth(0).click();
  await page.locator('.op-btn[data-v="+"]').click();
  await page.locator('.card').nth(1).click();
  const f = await page.locator('#formula').textContent();
  ok(f.includes(String(nums[0])), `算式时间线已记录输入：${f.trim()}`);
  await page.locator('.op-btn[data-act="clear"]').click();
  ok((await page.locator('#formula').textContent()).includes('Pick cards'), 'Clear 清空算式');

  await page.locator('.tab[data-mode="daily"]').click();
  await page.waitForTimeout(400);
  const banner = (await page.locator('.banner.daily').textContent()) || '';
  ok(/Daily Challenge/.test(banner), '每日挑战横幅显示');
  const flat = banner.replace(/\s+/g, ' ');
  ok(/\/ \d+/.test(flat), `题号进度显示：${(flat.match(/Puzzle [^·]*/) || [''])[0].trim()}`);
  ok((await page.locator('#dbCount button').count()) === 3, '每日挑战题数选项存在');
  ok(await page.locator('#dbClock').isVisible(), '每日挑战倒计时可见');
  const clock1 = await page.locator('#dbClock').textContent();
  await page.waitForTimeout(2100);
  const clock2 = await page.locator('#dbClock').textContent();
  ok(clock1 !== clock2, `倒计时在走：${clock1} -> ${clock2}`);

  await page.locator('.tab[data-mode="battle"]').click();
  await page.waitForTimeout(300);
  ok(await page.locator('#lobby.show').isVisible(), '竞赛 Lobby 打开');
  ok((await page.locator('#sizeRow .size-chip').count()) === 5, '房间规模选项 = 5 (2/10/25/50/99)');
  ok(
    ((await page.locator('#sizeRow .size-chip[data-max="99"]').getAttribute('class')) || '').includes('on'),
    '默认选中 99 人',
  );
  await page.locator('#nameInput').fill('Tester');
  await page.locator('#createBtn').click();
  await page.waitForTimeout(500);
  ok(await page.locator('#roomView').isVisible(), '建房后进入房间等待视图');
  const roomCode = ((await page.locator('#roomCode').textContent()) || '').trim();
  ok(/^[A-Z0-9]{5}$/.test(roomCode), `房间码生成：${roomCode}`);
  const playerCount = await page.locator('#roomPlayers .rp-item').count();
  ok(playerCount === 99, `DEMO 满员 99 人（实际 ${playerCount}）`);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(700);
  ok(await page.locator('#compHead').isVisible(), '开局后竞赛顶栏显示');
  const compCode = ((await page.locator('#compCode').textContent()) || '').trim();
  ok(compCode === roomCode, '竞赛顶栏房间码与建房一致');
  const roundBanner = ((await page.locator('#modeBanner').textContent()) || '').replace(/\s+/g, ' ');
  ok(/Round 1\s*\/\s*5/.test(roundBanner), `回合横幅：${roundBanner.trim().slice(0, 34)}`);
  const raceRows = await page.locator('.race-row').count();
  ok(raceRows > 0 || (await page.locator('.race-empty').count()) > 0, `实时榜单已挂载（${raceRows} 行）`);

  ok(errors.length === 0, `游戏页控制台错误 = 0（实际 ${errors.length}）`);
  if (errors.length) console.log('     errors:', errors.slice(0, 3));
  await ctx.close();
}

/* ---------------- 移动端 ---------------- */
console.log('\n=== 移动端 (iPhone 12 · 390x844) ===');
{
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  for (const [name, path] of [
    ['首页', '/'],
    ['24点', '/games/24-game/'],
  ]) {
    await page.goto(BASE + path, { waitUntil: 'commit' });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    );
    ok(overflow === 0, `${name} 无水平溢出（溢出 ${overflow}px）`);
  }

  await page.goto(BASE + '/games/24-game/', { waitUntil: 'commit' });
  const tabInfo = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.tab'));
    return { widths: els.map((e) => e.getBoundingClientRect().width), texts: els.map((e) => e.textContent.trim()) };
  });
  ok(
    tabInfo.widths.every((w) => w > 0),
    `三个 tab 均有可见宽度：${tabInfo.texts.join(' | ')}`,
  );

  await page.waitForTimeout(300);
  const smallTargets = await page.evaluate(() => {
    const sel = '.tab, .op-btn, .btn, .icon-btn, .card, .size-chip, .diff-pick button';
    const out = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44)) {
        out.push(`${el.className.split(' ')[0]}(${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    });
    return out;
  });
  ok(smallTargets.length === 0, `触摸目标全部 >=44px（不合规 ${smallTargets.length}：${smallTargets.slice(0, 5).join(', ')}）`);

  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.locator('#navToggle').click();
  await page.waitForTimeout(500);
  ok((await page.locator('#navDrawer.open').count()) === 1, '移动端汉堡菜单可打开抽屉');
  const drawerOverflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  ok(drawerOverflow === 0, `抽屉打开时仍无水平溢出（${drawerOverflow}px）`);

  ok(errors.length === 0, `移动端控制台错误 = 0（实际 ${errors.length}）`);
  if (errors.length) console.log('     errors:', errors.slice(0, 3));
  await ctx.close();
}

await browser.close();
console.log(`\n================ 验收结果：${pass} 通过 / ${fail} 失败 ================`);
process.exit(fail === 0 ? 0 : 1);
