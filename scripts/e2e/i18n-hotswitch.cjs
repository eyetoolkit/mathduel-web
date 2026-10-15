/**
 * CDP 交互验收：**真实点击**语言选择器，验证 i18n:change 后动态区域同步变化。
 * ----------------------------------------------------------------
 * 为什么必须单独做这个（_cdp-i18n-verify.cjs 覆盖不到的部分）：
 *   前者靠 localStorage 预置语言 + 重新导航，走的是**冷启动**路径；
 *   而玩家实际做的是**页内热切换**，依赖：
 *     1. i18n:change 事件被派发；
 *     2. 各页 onI18nChange() 订阅生效；
 *     3. 静态骨架由 i18n.js 自己重译；
 *     4. 用 i18nT() 写进 innerHTML 的动态区（日期 / 榜单 / 卡片 / 头部副标题）
 *        必须由页面自己重绘 —— i18n.js 的 MutationObserver **管不到**这层。
 *   第 4 条曾经反复出问题（对局页一直显示裸 key），只测冷启动会漏。
 *
 * 判据：对每个页面，先读一份「动态区签名」→ 点击切到目标语言 → 轮询到签名变化
 *      → 再校验页面上没有该语言不该出现的英文。
 *      🔴 签名必须包含动态区节点，不能只看 <title> 或 <html lang>（那些 i18n.js 自己会改）。
 *
 * 用法：node _cdp-i18n-switch.cjs
 */
const http = require('http');

// 🔴 端口不写死：preview 端口会随占用情况变，写死会导致「换了端口就全红」，
//    而实际是脚本没跟上环境（典型假失败）。CI 与本机都能各自传。
const PORT = Number(process.env.I18N_CDP_PORT || 9222);
const BASE = process.env.I18N_BASE || 'http://localhost:4188';
const FROM = 'en';   // 起始语言（故意用英文起点，任何「没跟着切」都会暴露成残留英文之外的现象）
const TO = 'zh';     // 目标语言

/**
 * 🔴 探针必须来自**该页真实存在且可见**的节点，且路径必须是真的能停留的页面。
 *
 * 踩过的三个坑（都是纯假失败，浪费了三轮 70/70 之外的时间）：
 *   1. 五个游戏「对战页」用 sidebar 骨架（#lang-switcher / .logo），
 *      没有 mountHeader 渲染的 .site-brand .sub —— 拿大厅页选择器去测，命中 0 节点。
 *   2. 首页 `.wbtn-gname`、数独页 `.diff-pick button` 是我臆造的选择器。
 *   3. 🔴 最隐蔽：**数独 4×4 / 6×6 / 9×9 与 24 Game 的「对战页」不带参数时
 *      会 location.replace 到 /lobby/**（见 src/games/sudoku-6x6/index.ts:957）。
 *      于是脚本以为在测对战页，实际早就被重定向到大厅了，
 *      用对战页的选择器当然一个都命中不到 —— 报「动态区没更新」，其实压根没在测那页。
 *      所以这几条要么给 mode 参数停留，要么就直接测大厅页的真实动态节点。
 *
 * 每个选择器都用 grep 核过存在于 dist/<page>/index.html 或对应 JS 里。
 */
const PAGES = [
  // 首页：游戏名卡片（home-redesign 动态渲染 + data-i18n）
  { name: '首页', path: '/', probe: '.gcard-name' },
  // 每日挑战：日期行（i18nT 写入）+ 五张卡片名
  { name: '每日挑战', path: '/daily/', probe: '#dateLine, .dcard-name' },
  // 24 Game 对战页：带 mode=solo 才不会跳大厅；难度按钮 + 模式横幅都是 renderSide 动态写入
  { name: '24 Game 对战页', path: '/games/24-game/?mode=solo', probe: '.diff-pick button, #modeBanner' },
  { name: '24 Game 大厅', path: '/games/24-game/lobby/', probe: '.ladder-title' },
  // 数独三页同样要 mode 参数才停留
  { name: '数独 4×4 对战页', path: '/games/sudoku-4x4/?mode=solo', probe: '.diff-pick button, #modeBanner' },
  { name: '数独 6×6 对战页', path: '/games/sudoku-6x6/?mode=solo', probe: '.diff-pick button' },
  { name: '数独 9×9 对战页', path: '/games/sudoku/?mode=solo', probe: '.diff-pick button' },
  { name: '金字塔对战页', path: '/games/equation-pyramid/?mode=solo', probe: '#modeBanner' },
  { name: '金字塔大厅', path: '/games/equation-pyramid/lobby/', probe: '.ladder-title' },
  { name: '我的旅程', path: '/me/', probe: '.mj-gname' },
  { name: '练习题', path: '/worksheets/', probe: '.ws-tab' },
];

function cdpGet(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const targets = await cdpGet('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('✗ 没有可用 page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params) => new Promise((res) => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const d = r.result && r.result.result;
    if (r.result && r.result.exceptionDetails) {
      throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)
        || r.result.exceptionDetails.text || 'eval error');
    }
    return d ? d.value : undefined;
  };

  /** 轮询直到 pred 返回真值；超时返回最后一次结果 */
  const waitFor = async (expr, ms = 12000) => {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
      try { last = await evalJs(expr); } catch (e) { last = null; }
      if (last) return last;
      await new Promise((r) => setTimeout(r, 250));
    }
    return last;
  };

  // 先导航建立 origin，再写 localStorage（换 origin 前必须先导航 — RULES-FE-D）
  await send('Page.navigate', { url: `${BASE}/` });
  await waitFor(`(() => true)()`);
  await evalJs(`(() => {
    const site = document.documentElement.getAttribute('data-site') || '';
    localStorage.setItem(site + 'duel_lang', ${JSON.stringify(FROM)});
    localStorage.setItem('lang', ${JSON.stringify(FROM)});
    localStorage.setItem('tri_lang', ${JSON.stringify(FROM)});
    return true;
  })()`);

  let pass = 0, fail = 0;
  const failures = [];

  for (const p of PAGES) {
    await send('Page.navigate', { url: `${BASE}${p.path}` });
    const ready = await waitFor(`(() => {
      const i = window.i18n;
      if (!i || !i.t) return false;
      const v = i.t('common.loading');
      return typeof v === 'string' && v.length > 0 && v !== 'common.loading';
    })()`);
    if (!ready) {
      console.log(`\n── ${p.name}  ✗ 字典未就绪（lang=${FROM}）`);
      fail++; failures.push({ page: p.name, why: '字典未就绪' });
      continue;
    }

    /* 🔴 localStorage 会跨页面保留：上一轮跑完留在 zh，本轮起点就变 zh，
       于是「before !== after」必然不成立 → 整轮 100% 假失败。
       每页都强制回到起始语言再取 before。 */
    await evalJs(`(() => {
      const want = ${JSON.stringify(FROM)};
      const cur = (document.documentElement.getAttribute('lang') || '').toLowerCase();
      if (cur === want) return 'already';
      const site = document.documentElement.getAttribute('data-site') || '';
      localStorage.setItem(site + 'duel_lang', want);
      localStorage.setItem('lang', want);
      localStorage.setItem('tri_lang', want);
      if (window.i18n && typeof window.i18n.setLang === 'function') window.i18n.setLang(want);
      return 'reset';
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    // 若站点未暴露 setLang，只能重新导航一次让 detectLang 生效
    if ((await evalJs(`(() => (document.documentElement.getAttribute('lang') || '').toLowerCase())()`)) !== FROM) {
      // 🔴 拼 cache-buster 必须用 `&`，不能直接 `?`：
      //    对战页的 path 自带 `?mode=solo`，用 `?i18nprobe=` 会拼出
      //    `?mode=solo?i18nprobe=123` —— 非法 query，matchGuard 读不到 mode
      //    就把玩家送去大厅，于是「起点语言/探针」两连判据同时失效，
      //    症状看着像漏翻，根因是验收脚本自己把 URL 拼坏了。
      const sep = p.path.includes('?') ? '&' : '?';
      await send('Page.navigate', { url: `${BASE}${p.path}${sep}i18nprobe=${Date.now()}` });
      await waitFor(`(() => {
        const i = window.i18n;
        if (!i || !i.t) return false;
        const v = i.t('common.loading');
        return typeof v === 'string' && v && v !== 'common.loading';
      })()`);
      await new Promise((r) => setTimeout(r, 400));
    }

    // 1) 切语言前的动态区签名（必须真取到文本，不能只看 lang 属性）
    /* 🔴 必须**轮询到探针真的有非空文本**再继续。
       startRound() 走的是异步链（enterMatchMode → 切 body.in-match），
       某一瞬间 #modeBanner 会是「display:none 的空壳」；
       单发取值会把「还没渲染完」误判成「漏翻」（假失败）。
       空串视为未就绪，让 waitFor 继续轮询。 */
    const sigExpr = `(() => {
      const sel = ${JSON.stringify(p.probe)};
      const out = [];
      for (const q of sel.split(',')) {
        document.querySelectorAll(q.trim()).forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          const txt = (el.textContent || '').trim();
          if (!txt) return;                       // 空壳节点不算命中
          out.push(txt.slice(0, 80));
        });
      }
      return out.length ? out.join('\\u0001') : '';   // 空串 → waitFor 继续等
    })()`;
    const before = await waitFor(sigExpr);
    if (!before) await new Promise((r) => setTimeout(r, 600)); // 兜底再给一次机会

    /* 🔴 自查（对应「假失败比真 bug 更费时间」纪律）：
       起点必须是「起始语言」，否则 before 已经是目标语言，
       后面「before !== after」必然不成立 → 100% 假失败。
       这里把 before 时刻的真实语言打出来，失败信息里也带上。 */
    const beforeState = await evalJs(`(() => ({
      htmlLang: document.documentElement.getAttribute('lang'),
      probe: ${JSON.stringify(p.probe)},
      nodes: (() => {
        let n = 0;
        for (const q of ${JSON.stringify(p.probe)}.split(',')) {
          document.querySelectorAll(q.trim()).forEach((el) => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (!(el.textContent || '').trim()) return;   // 与签名保持同一判据
            n++;
          });
        }
        return n;
      })(),
    }))()`);
    if (beforeState.htmlLang !== FROM) {
      console.log(`\n── ${p.name}  ✗ 起点语言不是 ${FROM}（实际 ${beforeState.htmlLang}）—— 判据不成立，跳过`);
      console.log(`     probe=${p.probe} 命中可见节点 ${beforeState.nodes} 个`);
      fail++; failures.push({ page: p.name, why: `起点语言=${beforeState.htmlLang}，探针命中 ${beforeState.nodes} 节点` });
      continue;
    }
    if (beforeState.nodes === 0) {
      /* 🔴 先查是不是「页面被重定向走了」—— 数独/24 Game 对战页不带 mode 会
         location.replace 到 /lobby/，此时拿原页选择器去查必然 0 命中。
         不区分这两种情况，就会把「测错页面」误报成「漏翻」。 */
      // 🔴 只比 pathname：应用与脚本都会往 query 上追加 ?v= / ?lang= / ?i18nprobe=，
      //    连 search 一起比会把这些无害追加误判成「被重定向」。
      const at = await evalJs(`(() => location.pathname)()`);
      const wantPath = p.path.split('?')[0];
      console.log(`\n── ${p.name}  ✗ 探针 ${p.probe} 命中 0 个可见节点`);
      console.log(`     当前实际 pathname=${at}（期望 ${wantPath}）${at === wantPath ? '' : '  ← 页面被重定向，测的不是这一页'}`);
      fail++; failures.push({ page: p.name, why: `探针无命中（实际在 ${at}）` });
      continue;
    }

    // 2) 监听 i18n:change —— 必须真的派发了，不能只看「点击后语言变了」
    await evalJs(`(() => {
      window.__changeFired = 0;
      window.addEventListener('i18n:change', () => { window.__changeFired++; }, { once: false });
      return true;
    })()`);

    // 3) 真实触发语言切换（不是设 localStorage）
    //    站里有两套切换控件，必须都覆盖：
    //      A. design-system mountLangSwitcher → <select class="lang-select">，靠 change 事件
    //      B. i18n.js 的 window.i18n.setLang()（HTML 骨架页没有独立控件时走它）
    const picked = await evalJs(`(() => {
      const want = ${JSON.stringify(TO)};
      const sel = document.querySelector('select.lang-select, #langHost select, select[aria-label]');
      if (sel) {
        const opt = Array.from(sel.options).find((o) => (o.value || '').toLowerCase() === want);
        if (!opt) return 'no-option';
        sel.value = want;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'select-change:' + want;
      }
      if (window.i18n && typeof window.i18n.setLang === 'function') {
        window.i18n.setLang(want);
        return 'api-setLang:' + want;
      }
      return 'no-switcher';
    })()`);

    if (!/^(select-change|api-setLang)/.test(String(picked))) {
      console.log(`\n── ${p.name}  ✗ 切换失败（${picked}）`);
      fail++; failures.push({ page: p.name, why: `切换失败 ${picked}` });
      continue;
    }

    // 4) 等语言真的切过去（以 i18n:change 派发 + html lang 为准）
    const switched = await waitFor(`(() => {
      const l = (document.documentElement.getAttribute('lang') || '').toLowerCase();
      const fired = window.__changeFired || 0;
      return (l === ${JSON.stringify(TO)} || l.startsWith(${JSON.stringify(TO)})) && fired > 0;
    })()`);

    if (!switched) {
      const st = await evalJs(`(() => ({
        lang: document.documentElement.getAttribute('lang'),
        fired: window.__changeFired || 0,
      }))()`);
      console.log(`\n── ${p.name}  ✗ 切换未生效 lang=${st.lang} change事件=${st.fired}`);
      fail++; failures.push({ page: p.name, why: `切换未生效 lang=${st.lang} 事件=${st.fired}` });
      continue;
    }

    // 5) 动态区必须跟着变（这是本页存在的全部理由）
    // 🔴 同样要轮询：i18n:change 派发后各页的 onI18nChange 同步重渲，
    //    但 Pyramid 还要等 body.in-match 切换，直接单发可能读到空壳。
    let after = await waitFor(sigExpr);
    if (!after) {
      await new Promise((r) => setTimeout(r, 600));
      after = await evalJs(sigExpr);
    }
    const dynChanged = before !== after;
    const hasCJK = /[一-鿿぀-ヿ]/.test(after || '');

    if (!dynChanged) {
      console.log(`\n── ${p.name}  ✗ 动态区未随语言切换更新`);
      console.log(`     before=${JSON.stringify(String(before).slice(0, 110))}`);
      console.log(`     after =${JSON.stringify(String(after).slice(0, 110))}`);
      fail++; failures.push({ page: p.name, why: '动态区未更新' });
      continue;
    }
    if (!hasCJK) {
      console.log(`\n── ${p.name}  ✗ 动态区变了但不是目标语言文本：${JSON.stringify(String(after).slice(0, 110))}`);
      fail++; failures.push({ page: p.name, why: '动态区非目标语言' });
      continue;
    }

    console.log(`\n── ${p.name}  ✓ 点击切换生效，动态区已重绘`);
    console.log(`     ${JSON.stringify(String(after).slice(0, 110))}`);
    pass++;
  }

  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  页内点击切换验收：${pass}/${PAGES.length}`);
  if (failures.length) {
    console.log('  未通过：');
    for (const f of failures) console.log(`    · ${f.page} — ${f.why}`);
  }
  console.log(`${'═'.repeat(58)}`);
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
