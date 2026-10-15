/**
 * CDP 验收：真机切中文，验证游戏内文案已本地化（P1-3）
 * ----------------------------------------------------------------
 * 纪律（见 .workbuddy/memory/RULES-FE-D.md）：
 *  - Runtime.evaluate 的谓词必须自带 return（会被包进 (async()=>{})()）
 *  - JS 注入的元素要轮询，不能 readyState=complete + 固定 sleep
 *  - 换 origin 前要先导航，否则 localStorage 作用域不对
 *  - 失败要打印真实 DOM，不能只说"不通过"
 *
 * 本版新增：
 *  - 只扫「用户真能看见」的节点（排除 display:none / visibility:hidden / aria-hidden /
 *    script/style/svg/option/[hidden]），否则会把隐藏弹窗里的英文也算成残留
 *  - 排除语言选择器里的语言自称（English / Español / Français …）
 *  - 排除原始 i18n key 泄漏（形如 aaa.bbb_ccc 的点分 key，本身就是缺键信号，单独报）
 *  - 额外扫一遍：页面里所有 data-i18n* 的 key 是否都能在字典里查到
 */
const http = require('http');
const fs = require('fs');

// 🔴 端口不写死：preview 端口会随占用情况变，写死会导致「换了端口就全红」，
//    而实际是脚本没跟上环境（典型假失败）。CI 与本机都能各自传。
const PORT = Number(process.env.I18N_CDP_PORT || 9222);
const BASE = process.env.I18N_BASE || 'http://localhost:4188';

// 🔴 对战页必须带 ?mode=solo：不带模式参数时页面会
//    `location.replace(LOBBY_URL)` 跳到大厅 —— 于是「对战页」这一行
//    实际验收的是大厅 DOM，覆盖语义缺失，数字看着全绿其实没测到。
//    matchGuard 会对每个条目额外断言 pathname 没被重定向。
const PAGES = [
  { name: '首页', path: '/' },
  { name: '每日挑战', path: '/daily/' },
  { name: '24 Game 对战页', path: '/games/24-game/?mode=solo' },
  { name: '24 Game 大厅', path: '/games/24-game/lobby/' },
  { name: '数独 4×4 对战页', path: '/games/sudoku-4x4/?mode=solo' },
  { name: '数独 4×4 大厅', path: '/games/sudoku-4x4/lobby/' },
  { name: '数独 6×6 对战页', path: '/games/sudoku-6x6/?mode=solo' },
  { name: '数独 6×6 大厅', path: '/games/sudoku-6x6/lobby/' },
  { name: '数独 9×9 对战页', path: '/games/sudoku/?mode=solo' },
  { name: '数独 9×9 大厅', path: '/games/sudoku/lobby/' },
  { name: '金字塔对战页', path: '/games/equation-pyramid/?mode=solo' },
  { name: '金字塔大厅', path: '/games/equation-pyramid/lobby/' },
  { name: '我的旅程', path: '/me/' },
  { name: '练习题', path: '/worksheets/' },
];

/** 这些条目必须真的停在原地，不能被重定向到大厅 */
function mustNotRedirect(path) {
  return path.includes('?mode=');
}

function cdpGet(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const targets = await cdpGet('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('✗ 没有可用 page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) { const d=r.result.exceptionDetails; return { __err: (d.exception?.description || d.text || 'unknown') }; }
    return r.result?.result?.value;
  };

  const waitFor = async (expr, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await evalJs(expr);
      if (v) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  // ── 在页面内跑的主探针（一次 evaluate 拿全部数据） ──
  const PROBE = `(async () => {
    // ALLOW：经人工核验「本就该保持原样」的字符串。
    //  - 品牌名（含 logo 拆出来的 "Duel" 片段，如 nav.g_title 的 Board<span>Duel</span>）
    //  - 语言自称、域名、赛制缩写
    //  - "SOON"：Coin Shop 的状态徽标，六个语言词典里都写 SOON，属既定文案
    const ALLOW = new Set(['NumeriDuel','MathDuel','BoardDuel','MemoryDuel','Duel','Elo','UTC','Shanghai',
      'English','中文','日本語','Español','Français','Deutsch','24','Sudoku','Pyramid','CSV','PWA',
      'numeriduel.com','mathduel.games','Privacy','Contact','SOON']);
    const KEYLIKE = /^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$/i;

    /**
     * 🔴 可见性判定必须遍历**整条祖先链**（早期版本只看直接父元素）：
     *   隐藏的 modal / 折叠面板常写成「外层 display:none，内层照常写文案」，
     *   只看父元素会把这些不可见英文全报一遍，验收结果被噪声淹没，
     *   久而久之就没人信这个脚本了。
     */
    function visible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      if (el.closest('script,style,svg,defs,symbol,noscript,template,[hidden],option')) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
        const cs = window.getComputedStyle(n);
        if (!cs) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (Number(cs.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return !(r.width === 0 && r.height === 0);
    }

    /**
     * 🔴🔴 「这段文本是不是没本地化」的判据，**绝不能靠字符集猜**。
     *    这个探针为此返工过四次，每次都是判据自身制造噪声：
     *      1) 只认中日文 → 切 es/fr/de 时整页西语文案被当成"英文残留"
     *      2) 改成「必须含非 ASCII 拉丁字母」→ 德语几乎全是 ASCII
     *         （"Alle Spiele"、"So wird gespielt" 全被误判）
     *      3) 用每语言重音表 → fr/de/es 之间互相放过、又互相误报
     *      4) 「整段等于英文词典某条原文」→ 品牌词与同形词被误判：
     *         "Sudoku 4×4"、"Standard"、"Name ________________" 在德语词典里
     *         本来就与英文**完全相同**（专有名词/同源词），不是漏翻
     *
     *    ✅ 唯一有证据的判据：**词典差分**。
     *       同时 fetch en.json 与当前语言 json，逐键比对：
     *         - 该键译本与英文**不同** → 这段英文文本就是"本该被替换掉却没换"
     *         - 该键译本与英文**相同** → 专有名词/同源词/品牌，出现是正常的
     *       把「译本≠英文」的那些英文原文收进黑名单，页面文本命中即报错。
     *       这样判据与"是否真的漏翻"完全对齐，不含任何猜测成分。
     */
    const cur = (window.i18n && window.i18n.getLang && window.i18n.getLang())
      || document.documentElement.lang || 'en';

    /** 只收「英文原文 ≠ 本语言译本」的字符串 —— 它们出现在页面上就是漏翻 */
    let EN_ONLY = null;
    try {
      const ver = (window.__I18N_CONFIG__ && window.__I18N_CONFIG__.dictVersion) || '1';
      const [en, loc] = await Promise.all([
        fetch('/i18n/en.json?v=' + ver).then((r) => r.json()),
        fetch('/i18n/' + cur + '.json?v=' + ver).then((r) => r.json()),
      ]);
      const flatPairs = (a, b, pfx = '', out = []) => {
        for (const [k, v] of Object.entries(a)) {
          if (v && typeof v === 'object') flatPairs(v, (b && b[k]) || {}, pfx + k + '.', out);
          else if (typeof v === 'string') out.push([v, b && b[k]]);
        }
        return out;
      };
      EN_ONLY = new Set();
      for (const [enVal, locVal] of flatPairs(en, loc)) {
        if (typeof locVal !== 'string') continue;      // 本地缺这条 → 由 missingKeys 报
        if (locVal === enVal) continue;               // 同形词/品牌：出现是正常的
        const s = enVal.trim();
        if (s.length >= 4) EN_ONLY.add(s.toLowerCase()); // 过滤 "24"、"Elo" 这类
      }
    } catch (e) { EN_ONLY = null; }

    const bad = [];
    const rawKeys = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (!t || t.length < 3) continue;
      // 原始 i18n key 泄漏 —— 缺键的直接证据（与语言无关，任何语言都算残留）
      if (KEYLIKE.test(t) && /_/.test(t)) { rawKeys.push(t.slice(0, 60)); continue; }
      if (ALLOW.has(t)) continue;
      if (!visible(n.parentElement)) continue;
      if (cur === 'en') continue;                      // 英文页本来就该是英文
      // 唯一的残留判据：命中「英文原文 ≠ 本语言译本」黑名单
      if (EN_ONLY && EN_ONLY.has(t.toLowerCase())) {
        bad.push('[未本地化] ' + t.slice(0, 80));
        continue;
      }
      // 子串级兜底：整段是黑名单条目的**片段**（如被截断/拼进句子的英文）
      if (EN_ONLY && t.length >= 8) {
        const low = t.toLowerCase();
        for (const s of EN_ONLY) {
          if (s.length >= 12 && low.includes(s)) { bad.push('[未本地化片段] ' + t.slice(0, 80)); break; }
        }
      }
    }

    // data-i18n* 的key 是否都存在于字典
    const missingKeys = [];
    const t = window.i18n && window.i18n.t;
    if (t) {
      const seen = new Set();
      document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]').forEach((el) => {
        ['data-i18n','data-i18n-html','data-i18n-title','data-i18n-aria-label','data-i18n-placeholder'].forEach((a) => {
          const k = el.getAttribute(a);
          if (!k || seen.has(k)) return;
          seen.add(k);
          let out;
          try { out = t(k); } catch (e) { out = null; }
          // i18n 缺键时会回落到 key 本身
          if (out === k || out === undefined || out === null) missingKeys.push(k);
        });
      });
    }

    return {
      lang: document.documentElement.getAttribute('lang') || (window.i18n && window.i18n.lang) || '?',
      count: bad.length,
      sample: bad.slice(0, 8),
      rawKeys: [...new Set(rawKeys)].slice(0, 8),
      missingKeys: [...new Set(missingKeys)].slice(0, 8),
    };
  })()`;

  const results = [];

  // ── 语言矩阵 ──
  // 🔴 不能只测一种语言：键对齐（check-i18n）只保证「键存在」，
  //    不保证「译文不是英文」「不是 key 本身」「没有漏翻」。
  //    只测 zh 会漏掉 es/fr/de 单独没翻的那批键。
  const LANGS = (process.env.I18N_LANGS || 'zh,ja,es,fr,de').split(',').map((s) => s.trim()).filter(Boolean);
  const ONLY_PAGES = process.env.I18N_PAGES ? process.env.I18N_PAGES.split(',') : null;
  const pages = ONLY_PAGES ? PAGES.filter((p) => ONLY_PAGES.includes(p.path)) : PAGES;

  // 先导航一次建立 origin，再写 localStorage（换 origin 前必须先导航 — RULES-FE-D）
  await send('Page.navigate', { url: `${BASE}/` });
  await waitFor(`(() => true)()`);

  for (const lang of LANGS) {
    console.log(`\n\n${'═'.repeat(58)}\n  语言：${lang}\n${'═'.repeat(58)}`);
    await evalJs(`(() => {
      // 🔴 i18n.js 的候选优先级（public/i18n/i18n.js detectLang）：
      //     1) ?lang=  2) 路径前缀 /zh/  3) localStorage
      //          其中 STORAGE_KEY = SITE_ID + 'duel_lang' **先于** 通用键 'lang'
      //     4) navigator.language 兜底
      //    只写 'lang' 会漏掉优先级更高的站点键 —— 语言根本没切过去，
      //    然后把「语言没切」误报成「漏翻」（假失败，比真 bug 更费时间）。
      //    三个键全写：duel_lang / lang / tri_lang（design-system 自有键）。
      const site = document.documentElement.getAttribute('data-site') || '';
      localStorage.setItem(site + 'duel_lang', ${JSON.stringify(lang)});
      localStorage.setItem('lang', ${JSON.stringify(lang)});
      localStorage.setItem('tri_lang', ${JSON.stringify(lang)});
      return { duel: localStorage.getItem(site + 'duel_lang'), lang: localStorage.getItem('lang') };
    })()`);

    for (const p of pages) {
      const url = `${BASE}${p.path}`;
      await send('Page.navigate', { url });
      // 🔴 判据要等**字典真的到位**，不能只等 window.i18n 存在：
      //    i18n.js 在解析时就挂了 window.i18n，字典是之后 async fetch 的。
      const ready = await waitFor(
        `(() => { const i = window.i18n; if (!i || !i.t) return false;
          const v = i.t('common.loading'); return !!v && v !== 'common.loading'; })()`,
      );
      await new Promise((r) => setTimeout(r, 1000)); // 等 DOM 应用 data-i18n

      const probe = await evalJs(PROBE);
      const r = probe && probe.__err
        ? { lang: '?', count: -1, sample: [probe.__err], rawKeys: [], missingKeys: [] }
        : probe;

      // 🔴 对战页必须真的停在原地。matchGuard 在没有模式参数时会
      //    location.replace(大厅)，那样这一行实际测的是大厅 DOM ——
      //    看着全绿，对战 UI 一次都没验过（假绿）。
      // 🔴 只比 pathname：应用会给自己追加 ?v=<cachebuster>，
      //    连 search 一起比会把这种无害改写误判成「被重定向」。
      let redirected = null;
      if (mustNotRedirect(p.path)) {
        const here = await evalJs('(() => ({ path: location.pathname }))()');
        const want = p.path.split('?')[0];
        redirected = here && here.path !== want ? here.path : null;
      }

      results.push({ lang, page: p.name, path: p.path, ready, redirected, ...r });
      console.log(`\\n── ${p.name}  (lang=${r?.lang})`);
      if (redirected) console.log(`   ✗ 被重定向: ${p.path} → ${redirected}`);
      if (r?.count === 0 && !r?.missingKeys?.length && !r?.rawKeys?.length && !redirected) {
        console.log('   ✓ 无英文残留');
      } else {
        (r?.sample || []).forEach((s) => console.log('   ✗ 英文:', s));
        (r?.rawKeys || []).forEach((s) => console.log('   ✗ 原始 key泄漏:', s));
        (r?.missingKeys || []).forEach((s) => console.log('   ✗ 字典缺键:', s));
      }
    }
  }

  // 🔴 产物路径用 __dirname 推导，不能写死仓库绝对路径：
  //    换机器 / 换 clone 目录就写到别人机器上去了，且失败得很安静。
  fs.writeFileSync(
    require('path').join(__dirname, '..', '..', 'i18n-coldstart-result.json'),
    JSON.stringify(results, null, 2),
  );
  /**
   * 🔴 判失败时必须把「探针自己抛异常」也算失败。
   *    早期版本是 `x.count > 0`，而探针出错时 count 被赋成 -1 —— 于是
   *    -1 > 0 为假，**每一页的 JS 崩溃都被记成"干净"**，
   *    脚本报出 70/70 全绿，实际全是 "Uncaught"。
   *    正确判据：`count !== 0` 即失败（0 = 干净，其余含 -1/异常 都是失败）。
   *    这就是「验收脚本自身缺陷造成假绿」，比真 bug 更危险。
   */
  const bad = results.filter(
    (x) => !x.ready || x.count !== 0 || (x.missingKeys || []).length || (x.rawKeys || []).length || x.redirected,
  );
  console.log(`\n\n═══ 结果：${results.length - bad.length}/${results.length} （${LANGS.length} 语言 × ${pages.length} 页）═══`);
  if (bad.length) {
    console.log('未通过：');
    bad.forEach((b) => {
      console.log(`   [${b.lang}] ${b.page}${b.redirected ? `  → 被重定向到 ${b.redirected}` : ''}`);
      (b.sample || []).slice(0, 3).forEach((s) => console.log(`        英文: ${s}`));
      (b.rawKeys || []).slice(0, 3).forEach((s) => console.log(`        裸 key: ${s}`));
    });
    process.exit(1);
  }
  ws.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
