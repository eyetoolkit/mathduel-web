'use strict';
// 行为级验证：在 vm 沙箱里跑 i18n.js，mock 浏览器 API，断言关键行为。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILE = path.resolve(__dirname, '../src/i18n/runtime/i18n.js');

function makeSandbox(opts) {
  opts = opts || {};
  const fetchCalls = [];
  const win = {
    __I18N_CONFIG__: opts.config || undefined,
    __I18N_DICTS__: opts.preloaded || undefined,
    location: { pathname: opts.pathname || '/', search: opts.search || '', href: 'https://x.test' + (opts.pathname || '/') },
    document: {
      documentElement: {
        _attrs: {},
        getAttribute(k) { return this._attrs[k] || null; },
        setAttribute(k, v) { this._attrs[k] = v; },
        readyState: 'complete',
      },
      readyState: 'complete',
      addEventListener() {},
      querySelectorAll() { return []; },
      querySelector() { return null; },
      title: '',
      head: { appendChild() {} },
      getElementById() { return null; },
    },
    localStorage: {
      _m: {},
      getItem(k) { return this._m[k] || null; },
      setItem(k, v) { this._m[k] = v; },
    },
    dispatchEvent() {},
    CustomEvent: function (n, d) { this.name = n; this.detail = d; },
    history: { replaceState() {} },
    plausible: undefined,
    i18n: undefined,
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: win.document,
    navigator: { language: 'en' },
    localStorage: win.localStorage,
    location: win.location,
    history: win.history,
    CustomEvent: win.CustomEvent,
    URLSearchParams: URLSearchParams,
    MutationObserver: class { observe() {} },
    setTimeout, clearTimeout,
    console,
    fetch: function (url) {
      fetchCalls.push(url);
      // 注意：真实 locale JSON 是嵌套结构，get() 做点号遍历，故 mock 也用嵌套
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ common: { ok: 'OK-' + url } }) });
    },
  };
  sandbox.global = sandbox;
  return { sandbox, win, fetchCalls };
}

function run(opts) {
  const { sandbox, win, fetchCalls } = makeSandbox(opts);
  const code = fs.readFileSync(FILE, 'utf8');
  vm.createContext(sandbox);
  // 同步执行 IIFE；末尾的 loadDict(...).then 是异步，需返回 promise
  vm.runInContext(code, sandbox, { filename: 'i18n.js' });
  // 让末尾的 loadDict().then 跑完
  return new Promise((resolve) => {
    setTimeout(() => resolve({ win, fetchCalls }), 50);
  });
}

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
  console.log('Scenario A: 默认配置，路径 /zh/foo（多语言应关闭，回退 en）');
  let r = await run({ pathname: '/zh/foo' });
  assert('getSupported() === ["en"]', JSON.stringify(r.win.i18n.getSupported()) === '["en"]', JSON.stringify(r.win.i18n.getSupported()));
  assert('getLang() === "en"（路径 /zh/ 被 SUPPORTED 拒绝）', r.win.i18n.getLang() === 'en', r.win.i18n.getLang());
  assert('fetch 调用了字典 en.json?v=27', r.fetchCalls.some((u) => u.indexOf('/i18n/en.json?v=27') >= 0), r.fetchCalls.join(','));
  // 直接手动 loadDict 验证 fetch→dicts 链路（隔离 init 时序）
  const v = await r.win.i18n.loadDict('en', true);
  assert('手动 loadDict(en) 后 t(en) 命中字典', r.win.i18n.t('common.ok') === 'OK-/i18n/en.json?v=27', r.win.i18n.t('common.ok'));

  console.log('Scenario B: 开启 6 语言，路径 /zh/foo（应识别 zh）');
  r = await run({ pathname: '/zh/foo', config: { supported: ['en', 'zh', 'ja', 'es', 'fr', 'de'], dictVersion: '33' } });
  assert('getSupported() 长度 6', r.win.i18n.getSupported().length === 6, JSON.stringify(r.win.i18n.getSupported()));
  assert('getLang() === "zh"（路径优先路由生效）', r.win.i18n.getLang() === 'zh', r.win.i18n.getLang());
  assert('fetch 用 dictVersion=33', r.fetchCalls.some((u) => u.indexOf('?v=33') >= 0), r.fetchCalls.join(','));

  console.log('Scenario C: 开启 6 语言 + 预注入字典（应跳过 fetch）');
  r = await run({ pathname: '/', config: { supported: ['en', 'zh', 'ja', 'es', 'fr', 'de'] }, preloaded: { zh: { common: { ok: '预注入-ZH' } } } });
  // 触发一次 zh 加载
  await r.win.i18n.loadDict('zh', true);
  await new Promise((res) => setTimeout(res, 20));
  console.log('    [debug] after loadDict(zh): t(zh)=' + r.win.i18n.t('common.ok', null, 'zh') + ' fetchCalls=' + r.fetchCalls.length);
  assert('预注入后 loadDict(zh) 解析为预注入值', r.win.i18n.t('common.ok', null, 'zh') === '预注入-ZH', r.win.i18n.t('common.ok', null, 'zh'));
  assert('预注入路径不新增 zh 的 fetch（仅 init 的 en 拉取）', r.fetchCalls.length === 1 && r.fetchCalls.every((u) => u.indexOf('zh.json') < 0), 'fetchCalls=' + r.fetchCalls.join(','));

  console.log('Scenario D: 开启 6 语言，?lang=es 覆盖（URL 参数优先）');
  r = await run({ pathname: '/', search: '?lang=es', config: { supported: ['en', 'zh', 'ja', 'es', 'fr', 'de'] } });
  assert('getLang() === "es"（?lang 生效）', r.win.i18n.getLang() === 'es', r.win.i18n.getLang());

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();
