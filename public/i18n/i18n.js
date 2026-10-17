/**
 * tri-sites SHARED i18n runtime  (single source of truth)
 * 位置：@tri-sites/design-system/src/i18n/runtime/i18n.js
 * 由 scripts/sync-i18n.mjs 推送到各站 public/i18n/，禁止在各站手动改副本。
 * 支持：
 * - 嵌套键查找（dot notation）
 * - 占位符替换 {name}
 * - 多个 fallback 语言
 * - localStorage 记忆 + URL 参数覆盖
 * - DOM 自动替换 [data-i18n] / [data-i18n-placeholder]
 *
 * 用法：
 *   <script src="/i18n/i18n.js"></script>
 *   <button data-i18n="common.confirm"></button>
 *   <input data-i18n-placeholder="battle.enter_name">
 *   <span data-i18n="battle.round" data-i18n-vars='{"round":1,"total":10}'></span>
 *
 *   // JS：
 *   t('common.ok')                              // "确定"
 *   t('battle.round', {round: 1, total: 10})    // "第 1/10 局"
 */
(function () {
  'use strict';

  // ─── 配置（单一真相源；站点可在 <head> 注入 window.__I18N_CONFIG__ 覆盖，无需改本文件）───
  // 示例（开启多语言时由各站自行注入，本共享文件不写死语言集）：
  //   <script>window.__I18N_CONFIG__={supported:['en','zh','ja','es','fr','de'],defaultLang:'en',dictVersion:'33'}</script>
  var CFG = (typeof window !== 'undefined' && window.__I18N_CONFIG__) || {};
  var SITE_ID = (document.documentElement.getAttribute('data-site') || 'board');
  var STORAGE_KEY = SITE_ID + 'duel_lang';   // 每站独立: boardduel_lang / mathduel_lang / memoryduel_lang
  var GENERIC_KEY = 'lang';                  // 跨站同步通用键
  // 默认仅英文（多语言关闭）。各站通过 __I18N_CONFIG__.supported 开启，不在此硬编码。
  var SUPPORTED = (Array.isArray(CFG.supported) && CFG.supported.length)
    ? CFG.supported
    : ["en"];
  var DEFAULT_LANG = CFG.defaultLang || 'en';
  var BASE_URL = CFG.baseUrl || '/i18n/';
  var DICT_VERSION = CFG.dictVersion || '27';  // 字典更新时由站点 bump（cache-buster）
  // 升级路径：构建期把字典注入 window.__I18N_DICTS__ 即可跳过网络 fetch（详见 sync 脚本说明）
  var PRELOADED = (typeof window !== 'undefined' && window.__I18N_DICTS__) || null;

  // 缓存已加载字典
  var dicts = {};
  var currentLang = null;

  /**
   * 检测初始语言（优先级：?lang > /xx/ 路径前缀 > localStorage > 默认）。
   * 所有候选都必须被 SUPPORTED 接受，否则跳过 —— 防止「路径写了 /de/ 但 de 未开启」时误切。
   */
  function detectInitialLang() {
    var candidates = [];
    // 1. URL 参数 ?lang=xx
    try {
      var fromUrl = new URLSearchParams(window.location.search).get('lang');
      if (fromUrl) candidates.push(fromUrl);
    } catch (e) {}
    // 2. URL 路径前缀 /xx/（路径优先于 localStorage，契合 SEO hreflang 声明）
    try {
      var m = window.location.pathname.match(/^\/(zh|en|ja|es|fr|de)(\/|$)/);
      if (m) candidates.push(m[1]);
    } catch (e) {}
    // 3. localStorage — 本网站点键优先, 其次跨站通用键
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) candidates.push(stored);
      var generic = localStorage.getItem(GENERIC_KEY);
      if (generic) candidates.push(generic);
    } catch (e) {}
    // 4. 浏览器语言兜底（2026-10-11 三站对齐：此前只有 boardduel 跟随 navigator.language，
    //    导致同一个德语 iPhone 装三站看到两种语言）。优先级最低 —— 只在用户从未显式
    //    选择过语言时生效，不覆盖 ?lang / 路径前缀 / localStorage。
    try {
      var nav = (navigator.language || navigator.userLanguage || '').slice(0, 2).toLowerCase();
      if (nav) candidates.push(nav);
    } catch (e) {}
    // 取第一个被 SUPPORTED 接受的语言
    for (var i = 0; i < candidates.length; i++) {
      if (SUPPORTED.indexOf(candidates[i]) >= 0) return candidates[i];
    }
    return DEFAULT_LANG;
  }

  /**
   * 异步加载字典（双模式）：
   *  - 优先用站点构建期注入的 window.__I18N_DICTS__[lang]（跳过网络 fetch）
   *  - 否则按 BASE_URL + lang + '?v=' + DICT_VERSION 运行时拉取
   */
  function loadDict(lang, force) {
    if (dicts[lang] && !force) return Promise.resolve(dicts[lang]);
    if (PRELOADED && PRELOADED[lang]) {
      dicts[lang] = PRELOADED[lang];
      return Promise.resolve(dicts[lang]);
    }
    return fetch(BASE_URL + lang + '.json?v=' + DICT_VERSION, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load ' + lang);
        return r.json();
      })
      .then(function (data) {
        dicts[lang] = data;
        return data;
      });
  }

  /**
   * 按点号查找嵌套键
   * 例如：get(dict, 'common.ok') → dict.common.ok
   */
  function get(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * 占位符替换：把 {key} 替换为 vars[key]
   */
  function interpolate(str, vars) {
    if (!str || typeof str !== 'string') return str;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (_, key) {
      return vars[key] !== undefined ? String(vars[key]) : '{' + key + '}';
    });
  }

  /**
   * 缺键告警 —— 🔴 2026-10-17：**默认开启**（与 boardduel / memoryduel 同一定稿）。
   * 旧实现把告警藏在 `window.__I18N_VERBOSE` 后面（默认 false），
   * 导致缺键长期躺在生产上、console 里一个信号都没有。
   * 现在：每个 (key, lang) 只报一次（避免刷爆控制台），
   * 需要静音时显式设 `window.__I18N_QUIET = true`。
   */
  var _missingWarned = {};
  /** 某语言的词典是否已加载完成（非空对象）。 */
  function dictReady(lang) {
    var d = dicts[lang];
    return !!d && Object.keys(d).length > 0;
  }
  function warnMissingKey(key, lang) {
    // 🔴 2026-10-17：字典尚未加载完成时（currentLang 还是 null、dicts[lang] 为空），
    // 每个键都会「查无此键」——这是启动竞态的瞬态，不是真缺键。
    // 页面 module 脚本是 defer 语义，常早于 i18n.js 的 async fetch 完成，
    // 此时报警会把控制台刷爆（实测单页 144 条假告警），真告警反被埋掉。
    // 判据：**只有被查询的那本词典已加载**、仍查不到该键，才报。
    // （不能放宽到「默认语言已加载也报」——en 先 fetch 完成、currentLang
    //   还是 null 的那一小段窗口里，页面脚本的每次调用都会被误报。）
    if (!dictReady(lang)) return;
    var id = lang + '|' + key;
    if (_missingWarned[id]) return;
    _missingWarned[id] = true;
    if (typeof window !== 'undefined' && window.__I18N_QUIET) return;
    console.warn('[i18n] missing key:', key, 'lang:', lang);
  }

  /**
   * 核心翻译函数
   *
   * @param key      字典键，如 'battle.round'
   * @param vars     插值变量对象，如 {round: 1, total: 10}；**不是兜底文案**
   * @param lang     语言，缺省用当前语言
   * @param fallback 🔴 第四参才是兜底文案。字典缺键时优先返回它，而不是裸 key。
   *                注意不要写 t('k', '兜底文案') —— 那会被当成 vars 忽略掉。
   */
  function t(key, vars, lang, fallback) {
    lang = lang || currentLang;
    var dict = dicts[lang] || {};
    var val = get(dict, key);

    // Fallback 到默认语言
    if (val === undefined && lang !== DEFAULT_LANG) {
      val = get(dicts[DEFAULT_LANG], key);
    }

    // Fallback 到调用方提供的兜底文案（优先于裸 key 上屏）
    if (val === undefined && fallback !== undefined && fallback !== null) {
      warnMissingKey(key, lang);
      return fallback;
    }

    // 兜底到 key 本身（最坏情况）—— 必须报警，不能静默
    if (val === undefined) {
      warnMissingKey(key, lang);
      return key;
    }

    return interpolate(val, vars);
  }

  /** 解析节点上的 data-i18n-vars（JSON）——所有 i18n 分支共用 */
  function parseVars(node) {
    var varsStr = node.getAttribute('data-i18n-vars');
    if (!varsStr) return {};
    try { return JSON.parse(varsStr) || {}; } catch (e) { return {}; }
  }

  /**
   * 替换 DOM 中的 data-i18n / data-i18n-placeholder
   */
  function applyToDOM(root) {
    root = root || document;
    // data-i18n → textContent
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-i18n');
      node.textContent = t(key, parseVars(node));
    }
    // data-i18n-placeholder → placeholder attr
    var phNodes = root.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phNodes.length; j++) {
      var phNode = phNodes[j];
      var phKey = phNode.getAttribute('data-i18n-placeholder');
      phNode.setAttribute('placeholder', t(phKey, parseVars(phNode)));
    }
    // data-i18n-title → title attr; if it's the <title> element, also update textContent + document.title
    var ttNodes = root.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < ttNodes.length; k++) {
      var ttNode = ttNodes[k];
      var ttKey = ttNode.getAttribute('data-i18n-title');
      var ttVal = t(ttKey, parseVars(ttNode));
      ttNode.setAttribute('title', ttVal);
      if (ttNode.tagName && ttNode.tagName.toUpperCase() === 'TITLE') {
        ttNode.textContent = ttVal;
        document.title = ttVal;
      }
    }
    // data-i18n-aria-label → aria-label attr
    var alNodes = root.querySelectorAll('[data-i18n-aria-label]');
    for (var m = 0; m < alNodes.length; m++) {
      var alNode = alNodes[m];
      var alKey = alNode.getAttribute('data-i18n-aria-label');
      alNode.setAttribute('aria-label', t(alKey, parseVars(alNode)));
    }
    // data-i18n-html → innerHTML (for HTML fragments like <span style="color">...)
    var htmlNodes = root.querySelectorAll('[data-i18n-html]');
    for (var n = 0; n < htmlNodes.length; n++) {
      var htmlNode = htmlNodes[n];
      var htmlKey = htmlNode.getAttribute('data-i18n-html');
      var htmlVal = t(htmlKey, parseVars(htmlNode));
      if (htmlVal && htmlVal !== htmlKey) {
        htmlNode.innerHTML = htmlVal;
      }
    }
    // data-i18n-alt → alt attr (for images)
    var altNodes = root.querySelectorAll('[data-i18n-alt]');
    for (var a = 0; a < altNodes.length; a++) {
      var altNode = altNodes[a];
      var altKey = altNode.getAttribute('data-i18n-alt');
      altNode.setAttribute('alt', t(altKey, parseVars(altNode)));
    }
    // data-i18n-content → content attr（用于 meta[name=description] / og:title / og:description）
    // 🔴 P1 修复：加 i18n-ready guard。applyToDOM 会在 i18n:ready 前被调用（initI18n 同步分支 /
    // 字典 fetch 未返回时），此时 t(key) 回退返回键值，会把 'math_home.seo_desc' 写进 <meta content>。
    // guard 让字典就绪前的调用跳过 content 替换（保留 HTML 里真实英文兜底），ready 后再补译。
    var ctNodes = root.querySelectorAll('[data-i18n-content]');
    for (var c = 0; c < ctNodes.length; c++) {
      var ctNode = ctNodes[c];
      var ctKey = ctNode.getAttribute('data-i18n-content');
      var ctVal = t(ctKey, parseVars(ctNode));
      if (ctVal && ctVal !== ctKey) {
        ctNode.setAttribute('content', ctVal);
      }
    }
    // <title data-i18n="key"> → document.title
    var titleNode = root.querySelector('title[data-i18n]');
    if (titleNode) {
      var tk = titleNode.getAttribute('data-i18n');
      var tv = t(tk);
      if (tv && tv !== tk) document.title = tv;
    }
    // <meta data-i18n="key" [name|property]="..."> → content attr
    var metaNodes = root.querySelectorAll('meta[data-i18n]');
    for (var p = 0; p < metaNodes.length; p++) {
      var metaNode = metaNodes[p];
      var mk = metaNode.getAttribute('data-i18n');
      var mv = t(mk);
      if (mv && mv !== mk) metaNode.setAttribute('content', mv);
    }
    // JSON-LD 脚本中的 i18n-name / i18n-desc / i18n-lang 属性支持
    var ldNodes = root.querySelectorAll('script[type="application/ld+json"]');
    for (var q = 0; q < ldNodes.length; q++) {
      var ldNode = ldNodes[q];
      try {
        var ldData = JSON.parse(ldNode.textContent);
        var changed = false;
        var processObj = function(obj) {
          if (obj && typeof obj === 'object') {
            var i18nAttrs = ['i18n-name', 'i18n-desc', 'i18n-lang'];
            for (var ai = 0; ai < i18nAttrs.length; ai++) {
              var attr = i18nAttrs[ai];
              if (obj[attr]) {
                var key = obj[attr];
                var val = t(key);
                if (val && val !== key) {
                  if (attr === 'i18n-name') obj.name = val;
                  else if (attr === 'i18n-desc') obj.description = val;
                  else if (attr === 'i18n-lang') obj.inLanguage = val;
                  changed = true;
                }
              }
            }
            for (var k in obj) {
              if (obj.hasOwnProperty(k)) {
                processObj(obj[k]);
              }
            }
          }
        };
        processObj(ldData);
        if (changed) {
          ldNode.textContent = JSON.stringify(ldData, null, 2);
        }
      } catch (e) {}
    }
  }

  /**
   * 切换语言
   */
  function setLang(lang, options) {
    options = options || {};
    if (SUPPORTED.indexOf(lang) < 0) {
      console.warn('[i18n] unsupported lang:', lang);
      return Promise.reject(new Error('unsupported lang'));
    }
    var prevLang = currentLang;
    return loadDict(lang, true).then(function () {
      currentLang = lang;
      // P5-1: 追踪语言切换
      if (prevLang && prevLang !== lang && typeof window.plausible === 'function') {
        try { window.plausible('lang_switch', { props: { from: prevLang, to: lang } }); } catch (e) {}
      }
      // 持久化
      try { localStorage.setItem(STORAGE_KEY, lang); localStorage.setItem(GENERIC_KEY, lang); } catch (e) {}
      // 更新 <html lang="...">
      document.documentElement.setAttribute('lang', lang);
      // 更新 PWA manifest 链接（按语言）
      try {
        var manifestLink = document.querySelector('link[rel="manifest"]');
        if (manifestLink && /\/manifest\.(zh|en|ja|es|fr|de)\.webmanifest$/.test(manifestLink.getAttribute('href') || '')) {
          manifestLink.setAttribute('href', '/manifest.' + lang + '.webmanifest');
        }
      } catch (e) {}
      // 应用到 DOM
      applyToDOM();
      // 给跨站链接补 ?lang=xx，让兄弟站落地即命中该语言
      decorateCrossSiteLinks(lang);
      // 触发自定义事件（让其他模块监听语言变化）
      window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: lang } }));
      // URL 同步（如果不是 options.skipUrl）
      if (!options.skipUrl) {
        syncUrl(lang);
      }
      return lang;
    });
  }

  /**
   * 把 lang 同步到 URL（?lang=en 或 /en/...）
   */
  function syncUrl(lang) {
    try {
      var url = new URL(window.location.href);
      // 优先用路径前缀风格
      var pathParts = url.pathname.split('/').filter(Boolean);
      var firstPart = pathParts[0];
      if (SUPPORTED.indexOf(firstPart) >= 0) {
        pathParts[0] = lang;
        url.pathname = '/' + pathParts.join('/') + (url.pathname.endsWith('/') ? '/' : '');
      } else {
        url.searchParams.set('lang', lang);
      }
      // 用 replaceState 不增加历史
      window.history.replaceState({}, '', url.toString());
    } catch (e) {}
  }

  /**
   * 跳转到带语言前缀的 URL（用于跨页面切换）
   */
  function navigateWithLang(lang, targetPath) {
    if (SUPPORTED.indexOf(lang) < 0) lang = DEFAULT_LANG;
    var path = targetPath || window.location.pathname;
    // 移除已有的语言前缀
    var parts = path.split('/').filter(Boolean);
    if (SUPPORTED.indexOf(parts[0]) >= 0) parts.shift();
    var newPath = '/' + lang + '/' + parts.join('/');
    window.location.href = newPath;
  }

  /**
   * 渲染 WS 错误消息
   * - 优先用 code 查 i18n key
   * - fallback 到 msg 字段（如果 msg 是 i18n key 形式）
   * - 再 fallback 到 msg 原字符串
   * - 最终 fallback 到 key 本身
   *
   * @param {object|string} errOrMsg - WS 错误对象 {code, msg} 或字符串 msg
   * @param {object} vars - 占位符变量
   * @returns {string} 多语言错误消息
   */
  function renderError(errOrMsg, vars) {
    vars = vars || {};
    var code = null, msg = null;
    if (typeof errOrMsg === 'string') {
      msg = errOrMsg;
    } else if (errOrMsg && typeof errOrMsg === 'object') {
      code = errOrMsg.code;
      msg = errOrMsg.msg || errOrMsg.message;
    }

    // 1. 用 code 查 i18n key 映射
    if (code) {
      var key = ERROR_CODE_MAP[code];
      if (key) {
        var translated = t(key, vars);
        if (translated && translated !== key) return translated;
      }
    }

    // 2. msg 可能是 i18n key 形式（如 "error.invalid_room_code"）
    if (msg && typeof msg === 'string' && msg.indexOf('.') > 0 && msg.indexOf(' ') < 0) {
      var v = t(msg, vars);
      if (v && v !== msg) return v;
    }

    // 3. fallback 到 msg 原字符串
    if (msg) return interpolate(msg, vars);

    // 4. 最终 fallback
    return code || t('common.error');
  }

  // 错误码 → i18n key 映射（与 ws-server/i18n/error-codes.json 同步）
  var ERROR_CODE_MAP = {
    INVALID_ROOM_CODE:        'error.invalid_room_code',
    ROOM_NOT_FOUND:           'error.room_not_found',
    ROOM_FULL:                'error.room_full',
    INVALID_PUZZLE:           'error.invalid_puzzle',
    FORMULA_INVALID:          'error.formula_invalid',
    INVALID_CELL_ID:          'error.cell_invalid',
    WRONG_ANSWER:             'error.wrong_answer',
    SUDOKU_GEN_FAILED:        'error.sudoku_generation_failed',
    KILLER_SUDOKU_GEN_FAILED: 'error.killer_sudoku_generation_failed',
    PYRAMID_GEN_FAILED:       'error.pyramid_generation_failed',
    INVALID_NAME:             'error.invalid_name',
    NAME_TOO_SHORT:           'error.name_too_short',
    NAME_TOO_LONG:            'error.name_too_long',
    RATE_LIMITED:             'error.rate_limited',
    CONNECTION_LOST:          'error.connection_lost',
    NOT_IN_ROOM:              'error.not_in_room',
    GAME_OVER:                'error.game_over',
    WRONG_TURN:               'error.wrong_turn',
    SESSION_EXPIRED:          'error.session_expired',
    SERVER_ERROR:             'error.server_error',
    INVALID_VALUE:            'error.invalid_value',
    INVALID_INDEX:            'error.invalid_index',
    CELL_INVALID:             'error.cell_invalid',
    CELL_ALREADY_FILLED:      'error.cell_already_filled',
    CELL_DUPLICATE:           'error.cell_duplicate',
    EQUATION_INVALID:         'error.equation_invalid'
  };

  // ─── 跨站语言传递 ───
  // localStorage 受同源策略限制，三站（不同域名）无法共享语言偏好。
  // 因此给「指向兄弟站的链接」补上 ?lang=xx —— 用户跳转过去时立即命中该语言。
  // 命中 ?lang 后 i18n 会把它写进 localStorage，后续该站全站跟随。
  var SIBLING_HOSTS = Array.isArray(CFG.siblingHosts)
    ? CFG.siblingHosts
    // 改名过渡期（2026-09-30 起 12 个月）：mathduel.games 与 numeriduel.com 并存
    : ['numeriduel.com', 'mathduel.games', 'boardduel.com', 'memoryduel.com'];
  function decorateCrossSiteLinks(lang) {
    try {
      if (!lang) return;
      var here = (location.hostname || '').replace(/^www\./, '');
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#') continue;
        var u;
        try { u = new URL(a.href, location.href); } catch (e) { continue; }
        var host = u.hostname.replace(/^www\./, '');
        if (host === here || SIBLING_HOSTS.indexOf(host) < 0) continue;
        if (u.searchParams.get('lang') === lang) continue;
        u.searchParams.set('lang', lang);
        a.setAttribute('href', u.toString());
      }
    } catch (e) {}
  }

  // ─── 暴露 API ───
  window.i18n = {
    t: t,
    setLang: setLang,
    getLang: function () { return currentLang; },
    getSupported: function () { return SUPPORTED.slice(); },
    applyToDOM: applyToDOM,
    navigateWithLang: navigateWithLang,
    decorateCrossSiteLinks: decorateCrossSiteLinks,
    loadDict: loadDict,
    renderError: renderError,
    ERROR_CODE_MAP: ERROR_CODE_MAP
  };


  // 暴露全局翻译入口，供各站点 tt()/__t()/window.t() 等调用（此前未定义导致回退中文）
  window.t = t;
  window.__t = t;

  // R-2: re-translate dynamically injected / re-rendered nodes
  var _i18nApplying = false;
  function applyI18nSafe(root) {
    _i18nApplying = true;
    try { applyToDOM(root || document); } finally { _i18nApplying = false; }
  }
  function setupI18nObserver() {
    if (typeof MutationObserver === 'undefined') return;
    var _t = null;
    var _obs = new MutationObserver(function () {
      if (_i18nApplying) return;            // ignore mutations we caused
      if (_t) clearTimeout(_t);
      _t = setTimeout(function () {
        applyI18nSafe(document);
        try { decorateCrossSiteLinks(currentLang); } catch (e) {}
      }, 60);
    });
    _obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }




  // ─── 启动：检测 + 加载 + 应用 ───
  var initLang = detectInitialLang();
  loadDict(initLang, true).then(function () {
    currentLang = initLang;
    document.documentElement.setAttribute('lang', initLang);
    // URL 显性指定语言（?lang=xx 或 /xx/ 路径前缀，典型场景：兄弟站 / 分享链接接力）时
    // 也要持久化 —— 否则用户点进下一个不带 ?lang 的页面会掉回默认语言。
    try {
      var _q = new URLSearchParams(window.location.search).get('lang');
      var _pm = (window.location.pathname || '').match(/^\/(zh|en|ja|es|fr|de)(\/|$)/);
      if ((_q || _pm) && SUPPORTED.indexOf(initLang) >= 0) {
        localStorage.setItem(STORAGE_KEY, initLang);
        localStorage.setItem(GENERIC_KEY, initLang);
      }
    } catch (e) {}
    // 等 DOMContentLoaded 再 apply
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { applyToDOM(); });
      setupI18nObserver();
    } else {
      applyToDOM();
    }
    // 首屏就绪后也装饰一次（未切换过语言也要带上当前语言）
    decorateCrossSiteLinks(initLang);
    // 标记就绪
    document.documentElement.setAttribute('data-i18n-ready', 'true');
    setupI18nObserver();
    window.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: initLang } }));
  }).catch(function (err) {
    console.error('[i18n] init failed:', err);
    document.documentElement.setAttribute('data-i18n-ready', 'error');
  });
})();
