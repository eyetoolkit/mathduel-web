/* ============================================================
   game-chrome.js · 游戏页结构增强（蓝白重设计 v3，对齐 PDF 规范）
   - 页头横条：图标 + h1 + 每日徽章 + 模式 tabs + CTA
   - 右侧栏：今日排行榜（真实 /api/daily/<slug>/rank）+ 其他游戏
   - 「如何玩」三步卡片
   纯增量注入，不改页面既有逻辑；i18n 由 i18n.js MutationObserver 接管
   ============================================================ */
(function () {
  var m = location.pathname.match(/games\/([a-z0-9-]+)/);
  var slug = m ? m[1] : '';
  var GAMES = {
    '24-game':          { ico: '24', nameKey: 'nav.game_24',              stepKey: 'gc.g24',    tag: 'classic', daily: true,  rank: true  },
    'sudoku':           { ico: '9²', nameKey: 'nav.game_sudoku',          stepKey: 'gc.sdk',    tag: 'classic', daily: true,  rank: true  },
    'sudoku-6x6':       { ico: '6²', nameKey: 'nav.game_sudoku_6x6',      stepKey: 'gc.s6',     tag: 'easy',    daily: true,  rank: false },
    'killer-sudoku':    { ico: 'Σ',  nameKey: 'nav.game_killer_sudoku',   stepKey: 'gc.killer', tag: 'adv',     daily: false, rank: false },
    'equation-pyramid': { ico: '▲',  nameKey: 'nav.game_equation_pyramid',stepKey: 'gc.pyr',    tag: 'new',     daily: true,  rank: true  }
  };
  var ORDER = ['24-game', 'sudoku', 'sudoku-6x6', 'killer-sudoku', 'equation-pyramid'];
  var TAGKEY = { classic: 'gc.tag_classic', easy: 'gc.tag_easy', adv: 'gc.tag_adv', new: 'gc.tag_new' };
  var cfg = GAMES[slug];
  if (!cfg) return;

  /* ---- 极简收敛：隐藏设计稿之外的功能按钮 / 板块 ----
     原则：管理/元功能按钮（暂停·答案·难度·统计·主题·商店·分享·历史·声音）
     与对战/每日入口（tabs/CTA 已接管）一律隐藏；棋盘操作键保留。 */
  var HIDE_BY_SLUG = {
    '24-game':          ['#clear', '#pause', '#show-answer', '#skip', '#rush-btn', '#history-btn', '#share-btn', '#sound-btn', '#battle-btn', '#daily-btn'],
    'sudoku':           ['#pause', '#auto-check-btn', '#theme-btn', '#daily-btn', '#battle-btn'],
    'sudoku-6x6':       ['#pause', '#theme-btn', '#auto-check-btn', '#daily-btn', '#battle-btn'],
    'killer-sudoku':    ['#btn-pause', '#btn-answer', '#btn-rules', '#btn-check', '#btn-reset', '#battle-btn'],
    'equation-pyramid': ['#help', '#pause', '#battle-btn']
  };
  /* 棋盘卡片化目标：把 .gc-boardcard 加到「棋盘容器」上，获得白卡样式。
     ⚠️ 仅用于 HTML 里没有实体卡片容器的页面。
     ⚠️⚠️ 棋盘元素本身绝不可进此表！
       .gc-boardcard 的 background:#f5f5f7 / padding:16px!important / max-width:420px
       会直接污染棋盘：底色刷成浅灰 → gap:1px 透出的缝与白色格子无对比，
       细网格线全部不可见；padding 内缩 → 格子与 grid 线错位。
     已因此移除：
       - sudoku-6x6（HTML 已有 <div class="gc-boardcard"> 外层卡片）
       - sudoku 9x9（同为棋盘自身，2026-09-14 实测：棋盘 computed
         backgroundColor=rgb(245,245,247)，内部细线 0 条，仅外框可见；
         手机端因窄屏 max-width:420px 恰好等于自然宽度、padding 视觉影响被掩盖，
         故表现为「手机端正常、电脑端异常」） */
  var BOARD_CARD_BY_SLUG = {
    '24-game': '.g24-container',
    'killer-sudoku': '.game-container',
    'equation-pyramid': '.pyr-page'
  };

  var CSS = [
    '.gc-headbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#fff;border:1px solid #f0f0f0;border-radius:18px;padding:14px 20px;margin:0 0 20px}',
    '.gc-hb-l{display:flex;align-items:center;gap:12px;min-width:0}',
    '.gc-hb-l h1{font-size:22px;font-weight:700;margin:0;color:#1d1d1f;line-height:1.2}',
    '.gc-ico{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:#0066CC;color:#fff;font-weight:700;font-size:15px;flex:none}',
    '.gc-badge{font-size:12px;color:#00529C;background:#DCEBFB;border-radius:999px;padding:3px 10px;font-weight:600;white-space:nowrap}',
    '.gc-hb-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.gc-tabs{display:flex;background:#f5f5f7;border-radius:999px;padding:3px;gap:2px}',
    '.gc-tabs button{border:0;background:transparent;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#6e6e73;cursor:pointer;white-space:nowrap;font-family:inherit}',
    '.gc-tabs button:hover{color:#1d1d1f}',
    '.gc-tabs button.active{background:#0066CC;color:#fff}',
    '.gc-tabs button.active:hover{color:#fff}',
    '.gc-cta{border:0;border-radius:999px;background:#0066CC;color:#fff;font-size:13px;font-weight:600;padding:9px 18px;cursor:pointer;font-family:inherit}',
    '.gc-cta:hover{background:#0071E3}',
    '.gc-cols{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:start;max-width:1040px;margin:0 auto}',
    '.gc-side{display:flex;flex-direction:column;gap:16px;min-width:0}',
    '.gc-card{background:#fff;border:1px solid #f0f0f0;border-radius:18px;padding:16px}',
    '.gc-card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
    '.gc-card-h b{font-size:15px;color:#1d1d1f}',
    '.gc-card-h a{font-size:13px;color:#0066CC;text-decoration:none;font-weight:500}',
    '.gc-rank-list{list-style:none;margin:0;padding:0}',
    '.gc-rank-list li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;font-size:14px}',
    '.gc-rank-n{width:22px;font-weight:700;color:#0066CC;flex:none;font-variant-numeric:tabular-nums}',
    '.gc-rank-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1d1d1f}',
    '.gc-rank-time{color:#6e6e73;font-variant-numeric:tabular-nums;flex:none}',
    '.gc-rank-empty{color:#86868b;font-size:13px}',
    '.gc-rank-list li.me{background:#EFF5FD}',
    '.gc-rank-list li.me .gc-rank-n,.gc-rank-list li.me .gc-rank-time{color:#0066CC}',
    '.gc-others{background:#f5f5f7;border-color:transparent}',
    '.gc-others a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;color:inherit;text-decoration:none;font-size:14px;font-weight:500}',
    '.gc-others a:hover{background:#fff}',
    '.gc-mini{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:#0066CC;color:#fff;font-size:12px;font-weight:700;flex:none}',
    '.gc-tag{margin-left:auto;font-size:11px;color:#00529C;background:#fff;border-radius:999px;padding:2px 8px;font-weight:600;flex:none}',
    '.gc-howto{margin-top:28px}',
    '.gc-howto h2{font-size:22px;font-weight:700;color:#1d1d1f;margin:0 0 14px}',
    '.gc-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}',
    '.gc-step{background:#fff;border:1px solid #f0f0f0;border-radius:18px;padding:18px}',
    '.gc-n{display:inline-flex;width:26px;height:26px;border-radius:50%;background:#EFF5FD;color:#0066CC;font-weight:700;font-size:13px;align-items:center;justify-content:center;margin-bottom:10px}',
    '.gc-step b{display:block;font-size:15px;color:#1d1d1f;margin-bottom:6px}',
    '.gc-step p{margin:0;font-size:13px;line-height:1.55;color:#6e6e73}',
    '.gc-on .gm-ico,.gc-on .gm-sub{display:none!important}',
    '.gc-on .gm-head{margin-bottom:8px}',
    /* 极简收敛：统计行/难度行隐藏；棋盘卡片化（PDF 浅灰大圆角） */
    '.gc-on .g24-stats,.gc-on .g24e-stats,.gc-on .pyr-stats,.gc-on .game-stats,.gc-on .diff-stats{display:none!important}',
    /* pad 里的括号（24e 无 id，用 data-type）*/
    /* killer 难度条 */
    '.gc-on .difficulty-bar{display:none!important}',
    /* ── 设计稿对齐（24 系）：文字 tabs / 牌面 / 运算符 / 单行布局 ── */
    '.gc-tabs{background:transparent;padding:0;gap:26px}',
    '.gc-tabs button{padding:20px 0 17px;border-radius:0;font-size:14px;color:#6e6e73;position:relative}',
    '.gc-tabs button.active{background:transparent;color:#0066CC}',
    '.gc-tabs button.active::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2.5px;background:#0066CC;border-radius:2px}',
    '.gc-headbar{padding:6px 20px}',
    '.gc-badge{display:inline-flex}',
    /* 牌面 → 设计稿白卡 + 牌面阴影 */
    '.gc-on .g24-card,.gc-on .g24e-card{background:#fff!important;border:none!important;border-radius:14px!important;box-shadow:0 6px 18px rgba(0,0,0,.14)!important;width:88px!important;height:118px!important;gap:2px}',
    '.gc-on .g24-card .num,.gc-on .g24e-card .num{font-size:2.4rem!important;color:#1d1d1f!important}',
    '.gc-on .g24-card .suit,.gc-on .g24e-card .suit{opacity:.6;font-size:1.3rem}',
    '.gc-on .g24-card.selected,.gc-on .g24e-card.selected{border:2px solid #0066CC!important;background:#EFF5FD!important;transform:translateY(-6px) scale(1.05)}',
    '@media(max-width:480px){.gc-on .g24-card,.gc-on .g24e-card{width:64px!important;height:88px!important}.gc-on .g24-card .num,.gc-on .g24e-card .num{font-size:1.9rem!important}}',
    /* 算式条 → 白底细边 */
    '.gc-on .g24e-formula,.gc-on .g24-formula{background:#fff!important;border:1px solid #f0f0f0!important;border-radius:12px!important;min-height:52px!important;font-family:inherit!important}',
    /* 运算符 → 白底方块；pad 改单行居中，重来/提示并入同一行 */
    '.gc-on .g24-pad,.gc-on .g24e-pad{display:flex!important;flex-direction:column;align-items:center;gap:10px;padding:4px 0!important;width:100%}',
    '.gc-on .g24-pad-row,.gc-on .g24e-pad-row{display:flex!important;justify-content:center;align-items:center;gap:8px;width:100%}',
    '.gc-on .g24e-pad button[data-type=op],.gc-on .g24-pad button[data-type=op]{background:#fff!important;color:#0066CC!important;border:2px solid #0066CC!important;width:52px;height:48px;font-size:20px!important;font-weight:700!important;border-radius:12px!important;display:flex!important;align-items:center;justify-content:center!important}',
    '.gc-on .g24e-pad button.special,.gc-on .g24-pad button.special,.gc-on .g24e-pad button[data-type=paren],.gc-on .g24-pad button[data-type=paren]{background:#fff!important;color:#0066CC!important;border:2px solid #0066CC!important;width:52px;height:48px;font-size:20px!important;font-weight:700!important;border-radius:12px!important;display:flex!important;align-items:center;justify-content:center!important}',
    /* #undo 方框样式仅适用于 24 系（其 #undo 是「↶」单字符图标按钮）。
       数独系 #undo 为「↶ Undo」文字按钮，在 .controls 内，不可套用固定宽度，否则文字溢出折行。 */
    '.gc-on .g24-pad #undo,.gc-on .g24e-pad #undo{background:#fff!important;color:#0066CC!important;border:2px solid #0066CC!important;width:52px;height:48px;font-size:20px!important;font-weight:700!important;border-radius:12px!important;display:flex!important;align-items:center;justify-content:center!important}',
    '.gc-on .g24e-pad button[data-type=op]:hover,.gc-on .g24-pad button[data-type=op]:hover{background:#f0f7ff!important;box-shadow:0 2px 8px rgba(0,102,204,.2)!important}',
    '.gc-on .g24e-pad button.special:hover,.gc-on .g24-pad button.special:hover,.gc-on .g24e-pad button[data-type=paren]:hover,.gc-on .g24-pad button[data-type=paren]:hover,.gc-on .g24-pad #undo:hover,.gc-on .g24e-pad #undo:hover{background:#EEF4FF!important;transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,102,204,.2)!important}',
    '.gc-actions{margin-top:0!important}',
    '.gc-actions .btn{min-height:44px;padding:0 26px!important;margin-left:4px}',
    /* 棋盘 caption「用 + − × ÷ 凑出 24」 */
    '.gc-caption{text-align:center;font-size:15px;color:#6e6e73;font-weight:500;margin-bottom:18px}',
    '.gc-caption b{font-size:30px;color:#0066CC;font-weight:700;margin-left:6px;vertical-align:-3px}',
    /* 设计稿棋盘内部顺序：caption→进度→牌→算式条→运算符行→结果→提示 */
    '.gc-on .g24-container>*,.gc-on .g24e-container>*{order:9}',
    '.gc-on .g24-container .gc-caption,.gc-on .g24e-container .gc-caption{order:0}',
    '.gc-on .g24-progress,.gc-on .g24e-progress{order:1}',
    '.gc-on .g24-cards,.gc-on .g24e-cards{order:2}',
    '.gc-on .g24-formula,.gc-on .g24e-formula{order:3}',
    '.gc-on .g24-pad,.gc-on .g24e-pad{order:4}',
    '.gc-on .g24-result,.gc-on .g24e-result{order:5}',
    '.gc-on #hint-box,.gc-on #solutions-count,.gc-on #sol-count{order:6}',
    '.gc-on .g24-container,.gc-on .g24e-container{gap:14px!important}',
    /* 每日横幅右列 */
    '.gc-refresh-label{font-size:11px;color:#a1a1a6;margin-bottom:2px;text-align:right}',
    '.daily-banner-countdown{font-size:22px!important;font-weight:700!important;color:#2997ff!important;background:transparent!important;padding:0!important;letter-spacing:.5px;font-variant-numeric:tabular-nums;text-align:right!important}',
    // Mobile banner optimizations
    '@media(max-width:480px){.daily-banner-countdown{font-size:14px!important;padding:0!important}}',
    '@media(max-width:360px){.daily-banner-countdown{font-size:12px!important}}',
    /* ⚠️ 手机端每日横幅：必须允许换行 + 允许标题收缩。
       若强制 nowrap（历史上曾用），banner 最小内容宽度会被撑到约 398px，
       撑爆 .game-page → 连累棋盘与数字键盘右溢被裁（390 视口裁 56px）。 */
    '@media(max-width:480px){.gc-on #daily-banner .daily-banner-inner{flex-wrap:wrap!important;gap:.4rem!important;min-width:0!important}}',
    '@media(max-width:480px){.gc-on .daily-banner-title{white-space:normal!important;flex-shrink:1!important;min-width:0!important;font-size:.8rem!important;line-height:1.25!important}}',
    '@media(max-width:480px){.gc-on .daily-banner-title>#daily-banner-date{white-space:normal!important;flex-shrink:1!important;min-width:0!important}}',
    '@media(max-width:480px){.gc-on .daily-banner-emoji{flex-shrink:0!important}}',
    '@media(max-width:480px){.gc-on .daily-banner-countdown{white-space:nowrap!important;flex-shrink:0!important}}',
    '@media(max-width:480px){.gc-on .daily-banner-sub{min-width:0!important;font-size:.78rem!important}}',
    '@media(max-width:360px){.gc-on .daily-banner-title{font-size:.76rem!important}}',
    '@media(max-width:360px){.gc-on .daily-banner-sub{font-size:.72rem!important}}',

    '.gc-boardcard{background:#f5f5f7;border-radius:18px;padding:16px!important;margin:4px auto 0;max-width:420px;box-sizing:border-box}',
    '@media(prefers-color-scheme:dark){.gc-boardcard{background:#1c1c1e}}',
    /* 保留按钮 → PDF 白色 pill */
    '.gc-actions{display:flex;gap:10px;justify-content:center;margin-top:6px}',
    '.gc-actions .btn{background:#fff!important;color:#1d1d1f!important;border:1px solid #e0e0e0!important;border-radius:999px!important;padding:.55rem 1.4rem!important;font-size:.875rem!important;box-shadow:none!important}',
    '.gc-actions .btn:hover{border-color:#0066CC!important;color:#0066CC!important}',
    '@media(max-width:1020px){.gc-cols{grid-template-columns:1fr}}',
    '@media(max-width:720px){.gc-steps{grid-template-columns:1fr}.gc-headbar{padding:12px 14px}.gc-hb-l h1{font-size:18px}}',
    '@media(prefers-color-scheme:dark){',
    '  .gc-headbar,.gc-card,.gc-step{background:#1c1c1e;border-color:#2c2c2e}',
    '  .gc-hb-l h1,.gc-card-h b,.gc-rank-name,.gc-step b,.gc-howto h2{color:#f5f5f7}',
    '  .gc-tabs{background:#2c2c2e}.gc-tabs button{color:#d2d2d7}.gc-tabs button:hover{color:#fff}',
    '  .gc-others{background:#111113}.gc-others a:hover{background:#1c1c1e}.gc-tag{background:#1c1c1e}',
    '  .gc-rank-time,.gc-step p{color:#86868b}.gc-badge{background:#0a2540}',
    '}'
  ].join('\n');

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  /* ★ 注入样式（v8 修复：CSS 数组此前从未被注入页面——全部 chrome 样式失效的根因） */
  if (!document.getElementById('gc-styles')) {
    var _st = document.createElement('style');
    _st.id = 'gc-styles';
    _st.textContent = CSS;
    document.head.appendChild(_st);
  }
  function txt(tag, cls, i18nKey, fallback) {
    var n = el(tag, cls, fallback);
    n.setAttribute('data-i18n', i18nKey);
    return n;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // Format YYYYMMDD -> "Mon D" (e.g., "20260914" -> "Sep 14")
  function formatDateKey(key) {
    if (!key || key.length !== 8) return key;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = parseInt(key.substring(4,6), 10) - 1;
    const d = parseInt(key.substring(6,8), 10);
    if (m < 0 || m > 11 || d < 1 || d > 31) return key;
    return '#' + months[m] + ' ' + d;
  }


  function todayKeyUTC() {
    var d = new Date();
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
  }
  function fmtDur(s) {
    s = Number(s) || 0;
    return s >= 60 ? Math.floor(s / 60) + ':' + pad2(s % 60) : s + 's';
  }

  function build() {
    try {
    var gp = document.querySelector('.game-page');
    /* 幂等：headbar 是第一个注入的元素，存在即已建过（v8 修复双份注入） */
    if (!gp || document.querySelector('.gc-headbar')) return;
    document.body.classList.add('gc-on');

    /* ---------- 1. 页头横条 ---------- */
    var bar = el('div', 'gc-headbar');
    var hbL = el('div', 'gc-hb-l');
    var ico = el('span', 'gc-ico'); ico.textContent = cfg.ico;
    hbL.appendChild(ico);
    var h1 = gp.querySelector('h1');
    if (h1) { hbL.appendChild(h1); }
    else { hbL.appendChild(txt('h1', null, cfg.nameKey, '')); }
    var badge = txt('span', 'gc-badge', 'gc.badge_daily', 'Daily challenge live');
    hbL.appendChild(badge);
    bar.appendChild(hbL);

    var hbR = el('div', 'gc-hb-r');
    var tabs = el('nav', 'gc-tabs');
    var dailyBtn = document.getElementById('daily-btn');
    var battleBtn = document.getElementById('battle-btn');
    var tPractice = txt('button', 'active', 'gc.tab_practice', 'Practice');
    tPractice.type = 'button';
    tabs.appendChild(tPractice);
    if (dailyBtn) {
      var tDaily = txt('button', null, 'gc.tab_daily', 'Daily');
      tDaily.type = 'button';
      tDaily.addEventListener('click', function () { setActive(tDaily); dailyBtn.click(); });
      tabs.appendChild(tDaily);
    }
    if (battleBtn) {
      var tBattle = txt('button', null, 'gc.tab_battle', 'Battle');
      tBattle.type = 'button';
      tBattle.addEventListener('click', function () { setActive(tBattle); battleBtn.click(); });
      tabs.appendChild(tBattle);
    }
    tPractice.addEventListener('click', function () {
      setActive(tPractice);
      if (gp.scrollIntoView) gp.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    function setActive(btn) {
      var all = tabs.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      btn.classList.add('active');
    }
    hbR.appendChild(tabs);
    if (dailyBtn) {
      var cta = txt('button', 'gc-cta', 'gc.cta_daily', "Start today's challenge");
      cta.type = 'button';
      cta.addEventListener('click', function () { setActive(tabs.querySelectorAll('button')[1] || tPractice); dailyBtn.click(); });
      hbR.appendChild(cta);
    }
    bar.appendChild(hbR);

    /* ---------- 2. 双栏 grid + 右侧栏 ---------- */
    var cols = el('div', 'gc-cols');
    gp.parentNode.insertBefore(bar, gp);
    gp.parentNode.insertBefore(cols, gp);
    cols.appendChild(gp);

    var side = el('aside', 'gc-side');

    var rankCard = el('div', 'gc-card gc-rank');
    var rkH = el('div', 'gc-card-h');
    rkH.appendChild(txt('b', null, 'gc.rank_title', "Today's Leaderboard"));
    var va = txt('a', null, 'gc.rank_viewall', 'View all');
    va.href = '/rank/';
    rkH.appendChild(va);
    rankCard.appendChild(rkH);
    var rkList = el('ol', 'gc-rank-list');
    rkList.appendChild(txt('li', 'gc-rank-empty', 'gc.rank_loading', 'Loading…'));
    rankCard.appendChild(rkList);
    side.appendChild(rankCard);

    var othCard = el('div', 'gc-card gc-others');
    var othH = el('div', 'gc-card-h');
    othH.appendChild(txt('b', null, 'gc.others', 'More games'));
    othCard.appendChild(othH);
    ORDER.forEach(function (s) {
      if (s === slug) return;
      var g = GAMES[s];
      var a = el('a');
      a.href = '/games/' + s + '/';
      var mini = el('span', 'gc-mini'); mini.textContent = g.ico;
      a.appendChild(mini);
      a.appendChild(txt('span', null, g.nameKey, ''));
      a.appendChild(txt('span', 'gc-tag', TAGKEY[g.tag], ''));
      othCard.appendChild(a);
    });
    side.appendChild(othCard);
    cols.appendChild(side);

    /* ---------- 3. 如何玩 ---------- */
    var howto = el('section', 'gc-howto');
    howto.appendChild(txt('h2', null, 'gc.howto', 'How to play'));
    var steps = el('div', 'gc-steps');
    for (var i = 1; i <= 3; i++) {
      var st = el('div', 'gc-step');
      var n = el('span', 'gc-n'); n.textContent = i;
      st.appendChild(n);
      st.appendChild(txt('b', null, cfg.stepKey + '.' + i + 't', ''));
      st.appendChild(txt('p', null, cfg.stepKey + '.' + i + 'd', ''));
      steps.appendChild(st);
    }
    howto.appendChild(steps);
    gp.appendChild(howto);

    /* ---------- 5. 极简收敛（PDF 之外的功能板块/按键） ---------- */
    (HIDE_BY_SLUG[slug] || []).forEach(function (sel) {
      var n = document.querySelector(sel);
      if (n) n.style.display = 'none';
    });
    if (slug === '24-game') {
      var db = document.getElementById('diff-bar');
      if (db) db.style.display = 'none';
    } else if (slug === 'sudoku' || slug === 'sudoku-6x6') {
      var rows = document.querySelectorAll('.controls');
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].querySelector('.difficulty-btn')) rows[r].style.display = 'none';
      }
    }
    var bsel = BOARD_CARD_BY_SLUG[slug];
    if (bsel) {
      var bc = document.querySelector(bsel);
      if (bc) bc.classList.add('gc-boardcard');
    }
    if (slug === '24-game') {
      /* 设计稿：棋盘卡顶部「用 + − × ÷ 凑出 24」 */
      var cont = gp.querySelector('.g24-container, .g24e-container');
      if (cont && !cont.querySelector('.gc-caption')) {
        var cap = el('div', 'gc-caption');
        cap.appendChild(txt('span', null, 'gc.caption_24', 'Make 24 with + \u2212 \u00d7 \u00f7'));
        var capNum = el('b'); capNum.textContent = '24';
        cap.appendChild(capNum);
        cont.insertBefore(cap, cont.firstChild);
      }
      /* 设计稿：运算符与「重来/提示」同一行 */
      var pad = gp.querySelector('.g24-pad, .g24e-pad');
      var ng = document.getElementById('new-game');
      var hb = document.getElementById('hint-btn');
      if (pad && (ng || hb)) {
        var act = el('div', 'gc-actions');
        if (ng) act.appendChild(ng);
        if (hb) act.appendChild(hb);
        pad.appendChild(act);
      }
      var ctrl = gp.querySelector('.g24-controls, .g24e-controls');
      if (ctrl) ctrl.style.display = 'none';
    }
    /* 每日横幅常驻（PDF 黑条）+ UTC 倒计时 */
    var banner = document.getElementById('daily-banner');
    if (banner) {
      banner.style.display = 'block';
      var dEl = document.getElementById('daily-banner-date');
      if (dEl && !dEl.textContent) dEl.textContent = formatDateKey(todayKeyUTC());
      var cd = document.getElementById('daily-banner-countdown');
      if (cd) {
        /* 设计稿右列：「距刷新」小标签在上、蓝色倒计时在下 */
        var cdWrap = cd.parentNode;
        if (cdWrap && !cdWrap.querySelector('.gc-refresh-label')) {
          cdWrap.innerHTML = '';
          cdWrap.appendChild(txt('div', 'gc-refresh-label', 'gc.refresh_in', 'Refreshes in'));
          cdWrap.appendChild(cd);
        }
        var tick = function () {
          var now = new Date();
          var mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
          var s = Math.max(0, Math.floor((mid - now) / 1000));
          cd.textContent = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
        };
        tick();
        setInterval(tick, 1000);
      }
    }

    /* ---------- 4. 排行榜数据（仅后端支持的 slug） ---------- */
    if (cfg.rank) {
    fetch('/api/daily/' + slug + '/rank?d=' + todayKeyUTC() + '&limit=5', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
      .then(function (j) {
        var es = (j && j.entries) || [];
        rkList.innerHTML = '';
        if (!es.length) {
          rkList.appendChild(txt('li', 'gc-rank-empty', 'gc.rank_empty', 'No scores yet today — be the first!'));
          return;
        }
        es.slice(0, 5).forEach(function (e, i) {
          var li = el('li');
          var rn = el('span', 'gc-rank-n'); rn.textContent = i + 1;
          var nm = el('span', 'gc-rank-name'); nm.textContent = e.nickname || '—';
          var tm = el('span', 'gc-rank-time'); tm.textContent = fmtDur(e.duration);
          li.appendChild(rn); li.appendChild(nm); li.appendChild(tm);
          rkList.appendChild(li);
        });
        /* 设计稿：我的排名高亮行 */
        var me = (j && j.me) ? j.me : null;
        if (me && me.rank) {
          var liMe = el('li'); liMe.className = 'me';
          var mn = el('span', 'gc-rank-n'); mn.textContent = me.rank;
          var mm = el('span', 'gc-rank-name'); mm.textContent = me.nickname || 'Me';
          var mt = el('span', 'gc-rank-time'); mt.textContent = fmtDur(me.duration);
          liMe.appendChild(mn); liMe.appendChild(mm); liMe.appendChild(mt);
          rkList.appendChild(liMe);
        }
      })
      .catch(function () {
        rkList.innerHTML = '';
        rkList.appendChild(txt('li', 'gc-rank-empty', 'gc.rank_empty', 'No scores yet today — be the first!'));
      });
    } else {
      rkList.innerHTML = '';
      rkList.appendChild(txt('li', 'gc-rank-empty', 'gc.rank_empty', 'No scores yet today — be the first!'));
    }

    /* ---------- 5. 自动开局（24 系页面加载后模拟点击 New Hand，否则 gameActive=false 点牌无反应） ---------- */
    if (slug === '24-game') {
      /* 算式条/结果栏脱离 i18n 管辖（否则游戏写入的算式被 MutationObserver 立即覆盖回占位文案） */
      ['formula', 'result'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.removeAttribute('data-i18n');
      });
      var ngAuto = document.getElementById('new-game');
      if (ngAuto && !ngAuto.dataset.gcAuto) {
        ngAuto.dataset.gcAuto = '1';
        ngAuto.click();
      }
    }
  } catch (err) {
      if (window.console && console.warn) console.warn('[game-chrome] build failed:', err);
    }
  }

  function start() {
    try { build(); } catch (err) {
      if (window.console && console.warn) console.warn('[game-chrome] start failed:', err);
    }
    /* v10 chrome 构建完成 → 解除旧骨架隐藏（配合页面 html.gc-pending，消除"旧版一闪"） */
    try { document.documentElement.classList.remove('gc-pending'); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
