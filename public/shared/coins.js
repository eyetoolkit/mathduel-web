/*!
 * coins.js — NumeriDuel 金币钱包（余额徽章 + 签到 + 每日任务 + 流水）
 * ────────────────────────────────────────────────────────────
 * 背景（2026-10-15 金币经济闭环 P0）：
 *   Worker 的 membership 模块早就是一整套经济系统（发分规则、日上限 250、
 *   任务、流水、排行榜），但前端从来没接过线——签到没人调、任务没人读、
 *   局末不上报。本模块把已有 API 全部接上，不新增任何服务端点。
 *
 * 身份模型（重要）：
 *   - 匿名玩家也有服务端账号（md_uuid 签名 cookie，/api/account/me 自动建号），
 *     PvP 结算与每日挑战已在服务端自动发分并计数；
 *   - 但 /api/coins/* 要求登录会话（auth_sid）⇒ 匿名时本模块**不渲染徽章**，
 *     也不发任何请求（避免 401 噪声）；登录后徽章自动出现。
 *   - 游客后期用同一邮箱升级（guest-bind）时 uuid 不变，历史进度自动继承。
 *
 * API 契约（_live_worker/worker/src/membership/index.js）：
 *   GET  /api/coins/me            → { authenticated, coins, coins_earned_total,
 *                                     streaks, daily, daily_budget }
 *   POST /api/coins/checkin       → { ok, earned, streak, total_coins }
 *   POST /api/coins/game-complete → { ok, earned, total_coins, games_today, won_today }
 *                                     body: { game, result, duration_sec, hard_mode }
 *   GET  /api/membership/quests   → { quests: [{ id, title, reward, completed,
 *                                     claimed, can_claim }], coins }
 *   POST /api/membership/quests/claim → { ok, claimed, skipped, coins_earned, total_coins }
 *                                     body: { quest_ids: [...] }
 *   GET  /api/coins/history?page&limit → { history: [{ type, amount, source, ts }] }
 *
 * 用法：<script src="/shared/coins.js"></script>（任意页面，自行找挂载点）
 *   window.Coins.mount()             // 手动挂载（默认 DOMContentLoaded 自动挂）
 *   window.Coins.reportGame({...})   // 局末上报（匿名时静默跳过）
 *   window.Coins.refresh()           // 余额/任务变化后刷新徽章
 */
(function (global) {
  'use strict';

  var doc = global.document;

  var API = {
    me: '/api/coins/me',
    checkin: '/api/coins/checkin',
    gameComplete: '/api/coins/game-complete',
    quests: '/api/membership/quests',
    claim: '/api/membership/quests/claim',
    history: '/api/coins/history'
  };

  /* 每日任务的「需要次数」——与服务端 DAILY_QUESTS 的 check() 保持一致，
     用于在面板上显示 x/y 进度（服务端只回 completed，不回进度）。 */
  var QUEST_NEED = { play_3: 3, win_1: 1, daily_challenge: 1, streak_3: 3, checkin: 1 };
  var QUEST_TITLE_KEY = {
    play_3: 'quest_play_3',
    win_1: 'quest_win_1',
    daily_challenge: 'quest_daily_challenge',
    streak_3: 'quest_streak_3',
    checkin: 'quest_checkin'
  };

  var state = {
    authed: false,
    me: null,          // /api/coins/me 缓存
    meAt: 0,
    quests: null,
    panelOpen: false,
    historyPage: 1,
    historyDone: false,
    historyBusy: false,
    mounted: false
  };
  var ME_TTL = 30 * 1000;
  var badgeEl = null;
  var panelEl = null;
  var toastTimer = 0;

  /* ─── i18n ─── */
  function t(key, fallback) {
    try {
      if (global.i18n && typeof global.i18n.t === 'function') return global.i18n.t('coins.' + key) || fallback;
      if (typeof global.t === 'function') return global.t('coins.' + key) || fallback;
    } catch (e) { /* 用兜底文案 */ }
    return fallback;
  }
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }
  function num(n) {
    try { return Number(n || 0).toLocaleString(); } catch (e) { return String(n || 0); }
  }
  function todayUTC() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ─── 样式（只注入一次；明暗两套都显式给色，防 #121 隐形陷阱） ─── */
  var styled = false;
  function style() {
    if (styled || !doc.head) return;
    styled = true;
    var css = ''
      + '.cn-wrap{position:relative;display:inline-flex}'
      + '.cn-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--pg-line,#E4E6F0);'
      + 'background:var(--pg-card,#fff);color:var(--pg-ink,#1D2333);border-radius:999px;padding:5px 12px;'
      + 'font-size:.84rem;font-weight:700;cursor:pointer;line-height:1.2;font-family:inherit}'
      + '.cn-badge:hover{border-color:var(--pg-indigo,#4F46E5);color:var(--pg-indigo,#4F46E5)}'
      + '.cn-badge .cn-ic{font-size:.95rem}'
      + '.cn-panel{position:absolute;top:calc(100% + 8px);left:0;z-index:120;width:min(310px,calc(100vw - 32px));'
      + 'background:var(--pg-card,#fff);color:var(--pg-ink,#1D2333);border:1px solid var(--pg-line,#E4E6F0);'
      + 'border-radius:14px;box-shadow:0 12px 32px rgba(20,24,40,.16);padding:14px;display:none;'
      + 'font-size:.86rem;line-height:1.45}'
      + '.cn-panel.open{display:block}'
      + '.cn-panel h4{margin:0 0 8px;font-size:.95rem;display:flex;align-items:center;justify-content:space-between;gap:8px}'
      + '.cn-panel .cn-x{border:0;background:none;color:var(--pg-mute,#6B7191);font-size:1rem;cursor:pointer;padding:2px 6px;border-radius:6px}'
      + '.cn-panel .cn-x:hover{background:var(--pg-hover,#F1F2FA);color:var(--pg-ink,#1D2333)}'
      + '.cn-bal{font-size:1.5rem;font-weight:800;letter-spacing:-.01em;margin:2px 0 2px}'
      + '.cn-sub{color:var(--pg-mute,#6B7191);font-size:.78rem}'
      + '.cn-bar{height:6px;border-radius:99px;background:var(--pg-hover,#EEF0FB);margin:6px 0 3px;overflow:hidden}'
      + '.cn-bar>i{display:block;height:100%;border-radius:99px;background:var(--pg-indigo,#4F46E5)}'
      + '.cn-sec{margin-top:12px;border-top:1px solid var(--pg-line,#E4E6F0);padding-top:10px}'
      + '.cn-sec>h5{margin:0 0 7px;font-size:.8rem;color:var(--pg-mute,#6B7191);letter-spacing:.04em;text-transform:uppercase}'
      + '.cn-btn{width:100%;border:0;border-radius:10px;background:var(--pg-indigo,#4F46E5);color:#fff;'
      + 'font-weight:700;font-size:.86rem;padding:9px 12px;cursor:pointer;font-family:inherit}'
      + '.cn-btn:hover{background:var(--pg-indigo-bright,#6366F1)}'
      + '.cn-btn[disabled]{background:var(--pg-hover,#EEF0FB);color:var(--pg-mute,#6B7191);cursor:default}'
      + '.cn-quest{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--pg-line,#E4E6F0)}'
      + '.cn-quest:last-child{border-bottom:0}'
      + '.cn-quest .cn-q-t{flex:1;min-width:0}'
      + '.cn-quest .cn-q-t b{display:block;font-weight:600;font-size:.84rem}'
      + '.cn-quest .cn-q-t small{color:var(--pg-mute,#6B7191);font-size:.74rem}'
      + '.cn-q-claim{flex:none;border:1px solid var(--pg-indigo,#4F46E5);background:none;color:var(--pg-indigo,#4F46E5);'
      + 'border-radius:8px;font-weight:700;font-size:.76rem;padding:5px 10px;cursor:pointer;font-family:inherit}'
      + '.cn-q-claim:hover{background:var(--pg-indigo,#4F46E5);color:#fff}'
      + '.cn-q-claim[disabled]{border-color:var(--pg-line,#E4E6F0);color:var(--pg-mute,#6B7191);cursor:default;background:none}'
      + '.cn-q-claim[disabled]:hover{background:none;color:var(--pg-mute,#6B7191)}'
      + '.cn-his{list-style:none;margin:0;padding:0;max-height:150px;overflow:auto}'
      + '.cn-his li{display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:.8rem}'
      + '.cn-his .cn-h-s{color:var(--pg-mute,#6B7191);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.cn-his .cn-h-a{font-weight:700;flex:none}'
      + '.cn-his .cn-h-a.earn{color:#0E9F6E}'
      + '.cn-his .cn-h-a.spend{color:#DC2626}'
      + '.cn-more{margin-top:6px;width:100%;border:1px solid var(--pg-line,#E4E6F0);background:none;'
      + 'border-radius:8px;color:var(--pg-mute,#6B7191);font-size:.76rem;padding:6px;cursor:pointer;font-family:inherit}'
      + '.cn-more:hover{color:var(--pg-ink,#1D2333);border-color:var(--pg-indigo,#4F46E5)}'
      + '.cn-link{display:inline-block;margin-top:8px;color:var(--pg-indigo,#4F46E5);font-size:.78rem;font-weight:600;text-decoration:none}'
      + '.cn-link:hover{text-decoration:underline}'
      + '.cn-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(8px);z-index:200;'
      + 'background:#1D2333;color:#fff;border-radius:999px;padding:9px 18px;font-size:.86rem;font-weight:700;'
      + 'box-shadow:0 8px 24px rgba(20,24,40,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;'
      + 'font-family:inherit;max-width:calc(100vw - 40px);text-align:center}'
      + '.cn-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}'
      /* 侧栏收窄成图标栏时只留硬币图标 */
      + 'body.has-papergames-shell.rail .cn-badge .cn-num{display:none}'
      + 'body.has-papergames-shell.rail .cn-badge{padding:6px 9px}'
      /* 暗色：显式覆盖，不继承 UA/父级黑字 */
      + 'html[data-theme="dark"] .cn-badge,html[data-theme="dark"] .cn-panel{'
      + 'background:#23263B;color:#EDEFF9;border-color:#3A3F5C}'
      + 'html[data-theme="dark"] .cn-badge:hover{color:#A5B4FC;border-color:#6366F1}'
      + 'html[data-theme="dark"] .cn-bar{background:#343852}'
      + 'html[data-theme="dark"] .cn-sub,html[data-theme="dark"] .cn-sec>h5,'
      + 'html[data-theme="dark"] .cn-his .cn-h-s{color:#9AA1C0}'
      + 'html[data-theme="dark"] .cn-btn[disabled]{background:#343852;color:#9AA1C0}'
      + 'html[data-theme="dark"] .cn-quest{border-bottom-color:#3A3F5C}'
      + 'html[data-theme="dark"] .cn-panel .cn-x:hover{background:#343852;color:#EDEFF9}'
      + 'html[data-theme="dark"] .cn-toast{background:#EDEFF9;color:#1D2333}'
      + '@media (max-width:1119px){.cn-panel{left:auto;right:0}}';
    var el = doc.createElement('style');
    el.id = 'coins-style';
    el.textContent = css;
    doc.head.appendChild(el);
  }

  /* ─── API ─── */
  function jget(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }
  function jpost(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { status: r.status, data: d || {} };
      });
    }).catch(function () { return { status: 0, data: {} }; });
  }

  function me(force) {
    var now = Date.now();
    if (!force && state.me && now - state.meAt < ME_TTL) {
      return Promise.resolve(state.me);
    }
    return jget(API.me).then(function (d) {
      state.me = d;
      state.meAt = Date.now();
      state.authed = !!(d && d.authenticated);
      return d;
    });
  }

  function checkin() {
    return jpost(API.checkin, {});
  }
  function quests() {
    return jget(API.quests);
  }
  function claim(ids) {
    return jpost(API.claim, { quest_ids: ids });
  }
  function history(page) {
    return jget(API.history + '?page=' + (page || 1) + '&limit=10');
  }

  /* 局末上报。先确认登录态（me() 有 30s 缓存，不会重复请求）；
     匿名/未登录静默跳过（端点会 401，不发请求免噪声）。
     服务端要求 duration_sec ≥ 15，不足则客户端也跳过（本就没有奖励）。
     PvP 由 DO 结算自动发分计数，不要重复上报（会双倍累计 games_today）。 */
  function reportGame(opts) {
    if (!opts || !opts.game || !opts.result) return Promise.resolve(null);
    var dur = Number(opts.duration_sec);
    if (!isFinite(dur) || dur < 15) return Promise.resolve(null);
    return me().then(function (d) {
      if (!d || !d.authenticated) return null;
      return jpost(API.gameComplete, {
        game: opts.game,
        result: opts.result,
        duration_sec: Math.round(dur),
        hard_mode: !!opts.hard_mode
      }).then(function (r) {
        if (r.status === 200 && r.data && r.data.earned > 0) {
          state.me = null; // 下次读取取最新余额
          toast(fill(t('toast_earned', '+{n} coins'), { n: r.data.earned }));
        }
        return r;
      });
    });
  }

  /* ─── toast ─── */
  function toast(text) {
    if (!text) return;
    var el = doc.querySelector('.cn-toast');
    if (!el) {
      el = doc.createElement('div');
      el.className = 'cn-toast';
      el.setAttribute('role', 'status');
      doc.body.appendChild(el);
    }
    el.textContent = text;
    // 强制回流，保证连续 toast 也能重新触发过渡
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ─── 任务进度（服务端只回 completed，进度用 /api/coins/me 的 daily 现算） ─── */
  function questProgress(q) {
    var d = (state.me && state.me.daily) || {};
    var s = (state.me && state.me.streaks) || {};
    var need = QUEST_NEED[q.id] || 1;
    var done = 0;
    if (q.id === 'play_3') done = Math.min(need, Number(d.games_today) || 0);
    else if (q.id === 'win_1') done = Math.min(need, Number(d.won_today) || 0);
    else if (q.id === 'daily_challenge') done = d.daily_challenge_done ? 1 : 0;
    else if (q.id === 'streak_3') done = Math.min(need, Number(s.login_streak) || 0);
    else if (q.id === 'checkin') done = s.last_checkin_date === todayUTC() ? 1 : 0;
    return { done: done, need: need };
  }

  function srcLabel(src) {
    var s = String(src || '');
    if (s.indexOf('checkin') === 0) return t('src_checkin', 'Daily check-in');
    if (s.indexOf('game_win') === 0) return t('src_game_win', 'Duel won');
    if (s.indexOf('game_hard') === 0) return t('src_game_hard', 'Hard difficulty');
    if (s.indexOf('game:') === 0) return t('src_game', 'Round finished');
    if (s.indexOf('quest:') === 0) return t('src_quest', 'Daily quest');
    if (s.indexOf('pvp:') === 0) return t('src_pvp', 'Duel settled');
    if (s.indexOf('daily:') === 0) return t('src_daily', 'Daily challenge');
    if (s.indexOf('purchase') === 0) return t('src_purchase', 'Purchase');
    if (s.indexOf('invite') >= 0) return t('src_invite', 'Friend invited');
    return s;
  }

  function fmtTs(ts) {
    var d = new Date(ts);
    var now = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return hm;
    return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + hm;
  }

  /* ─── 徽章 ─── */
  function buildBadge(anchor) {
    var wrap = doc.createElement('span');
    wrap.className = 'cn-wrap';
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'cn-badge';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-haspopup', 'dialog');
    b.title = t('open_wallet', 'Coin wallet');
    b.innerHTML = '<span class="cn-ic" aria-hidden="true">🪙</span><span class="cn-num">0</span>';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    wrap.appendChild(b);
    anchor.appendChild(wrap);
    badgeEl = b;
    return wrap;
  }

  function renderBadge() {
    if (!badgeEl || !state.me) return;
    var nEl = badgeEl.querySelector('.cn-num');
    if (nEl) nEl.textContent = num(state.me.coins);
  }

  /* ─── 面板 ─── */
  function togglePanel() {
    if (state.panelOpen) { closePanel(); return; }
    openPanel();
  }

  function openPanel() {
    if (!badgeEl || state.panelOpen) return;
    style();
    var wrap = badgeEl.parentElement;
    if (panelEl) panelEl.remove();
    panelEl = doc.createElement('div');
    panelEl.className = 'cn-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', t('panel_title', 'Coin wallet'));
    wrap.appendChild(panelEl);
    state.panelOpen = true;
    state.historyPage = 1;
    state.historyDone = false;
    badgeEl.setAttribute('aria-expanded', 'true');
    renderPanel();
    setTimeout(function () {
      doc.addEventListener('click', onDocClick);
      doc.addEventListener('keydown', onEsc);
    }, 0);
  }

  function closePanel() {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    if (panelEl) { panelEl.remove(); panelEl = null; }
    if (badgeEl) badgeEl.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('click', onDocClick);
    doc.removeEventListener('keydown', onEsc);
  }

  function onDocClick(e) {
    if (panelEl && !panelEl.contains(e.target) && (!badgeEl || !badgeEl.contains(e.target))) closePanel();
  }
  function onEsc(e) {
    if (e.key === 'Escape') closePanel();
  }

  function renderPanel() {
    if (!panelEl) return;
    var m = state.me || {};
    var budget = m.daily_budget || {};
    var used = Number(budget.used) || 0;
    var cap = Number(budget.cap) || 250;
    var pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    var streak = (m.streaks && m.streaks.login_streak) || 0;
    var checkedIn = !!(m.streaks && m.streaks.last_checkin_date === todayUTC());

    var html = ''
      + '<h4><span>' + t('panel_title', 'Coin wallet') + '</span>'
      + '<button type="button" class="cn-x" aria-label="'
      + ((global.i18n && global.i18n.t) ? (global.i18n.t('common.close') || 'Close') : 'Close')
      + '">×</button></h4>'
      + '<div class="cn-bal">🪙 ' + num(m.coins) + '</div>'
      + '<div class="cn-sub">' + t('balance', 'Balance') + ' · ' + t('today', 'Earned today') + ' +' + num(used) + '</div>'
      + '<div class="cn-bar"><i style="width:' + pct + '%"></i></div>'
      + '<div class="cn-sub">' + num(used) + ' / ' + num(cap) + ' ' + t('cap', 'Daily cap')
      + (streak > 0 ? ' · ' + fill(t('streak_days', '{n}-day check-in streak'), { n: streak }) : '')
      + ' · ' + t('budget_hint', 'Resets at UTC midnight') + '</div>'
      + '<div class="cn-sec"><button type="button" class="cn-btn" id="cnCheckin"'
      + (checkedIn ? ' disabled' : '') + '>'
      + (checkedIn ? '✓ ' + t('checkin_done', 'Checked in today') : t('checkin_do', 'Check in'))
      + '</button></div>'
      + '<div class="cn-sec"><h5>' + t('quests', 'Daily quests') + '</h5><div id="cnQuests"></div></div>'
      + '<div class="cn-sec"><h5>' + t('history', 'Recent activity') + '</h5>'
      + '<ul class="cn-his" id="cnHis"></ul>'
      + '<button type="button" class="cn-more" id="cnMore">' + t('history_more', 'Load more') + '</button>'
      + '<a class="cn-link" href="/me/#coins">' + t('view_all', 'See all in My Journey') + ' →</a></div>';

    panelEl.innerHTML = html;
    panelEl.querySelector('.cn-x').addEventListener('click', closePanel);
    var ci = panelEl.querySelector('#cnCheckin');
    if (ci && !ci.disabled) {
      ci.addEventListener('click', function () {
        ci.disabled = true;
        checkin().then(function (r) {
          if (r.status === 200 && r.data && r.data.ok) {
            state.me = null;
            toast(fill(t('toast_checkin', 'Checked in · +{n} coins'), { n: r.data.earned }));
            me(true).then(function () { renderPanel(); renderBadge(); });
          } else if (r.status === 400) {
            state.me = null;
            me(true).then(function () { renderPanel(); renderBadge(); });
          } else {
            ci.disabled = false;
            toast(t('err_offline', 'Coin service unreachable'));
          }
        });
      });
    }
    renderQuests();
    renderHistory(true);
  }

  function renderQuests() {
    var host = panelEl && panelEl.querySelector('#cnQuests');
    if (!host) return;
    quests().then(function (d) {
      if (!d || !host.isConnected) return;
      var list = d.quests || [];
      if (!list.length) { host.innerHTML = '<div class="cn-sub">—</div>'; return; }
      host.innerHTML = '';
      list.forEach(function (q) {
        var p = questProgress(q);
        var row = doc.createElement('div');
        row.className = 'cn-quest';
        var left = doc.createElement('div');
        left.className = 'cn-q-t';
        var title = t(QUEST_TITLE_KEY[q.id] || '', q.title || q.id);
        left.innerHTML = '<b></b><small>' + fill(t('quest_progress', '{done}/{need}'), p)
          + ' · +' + num(q.reward) + '</small>';
        left.querySelector('b').textContent = title;
        row.appendChild(left);
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'cn-q-claim';
        if (q.claimed) {
          btn.disabled = true;
          btn.textContent = '✓ ' + t('quest_claimed', 'Claimed');
        } else if (q.can_claim) {
          btn.textContent = t('quest_claim', 'Claim');
          btn.addEventListener('click', function () {
            btn.disabled = true;
            claim([q.id]).then(function (r) {
              if (r.status === 200 && r.data && r.data.ok && (r.data.claimed || []).indexOf(q.id) >= 0) {
                state.me = null;
                toast(fill(t('toast_quest', 'Quest claimed · +{n} coins'), { n: r.data.coins_earned || q.reward }));
                me(true).then(function () { renderPanel(); renderBadge(); });
              } else {
                btn.disabled = false;
                var reason = r.data && r.data.skipped && r.data.skipped[0] && r.data.skipped[0].reason;
                if (reason === 'daily_cap_reached') toast(t('cap', 'Daily cap') + ' ✓');
                else toast(t('err_offline', 'Coin service unreachable'));
              }
            });
          });
        } else {
          btn.disabled = true;
          btn.textContent = t('quest_todo', 'In progress');
        }
        row.appendChild(btn);
        host.appendChild(row);
      });
    });
  }

  function renderHistory(reset) {
    var host = panelEl && panelEl.querySelector('#cnHis');
    var more = panelEl && panelEl.querySelector('#cnMore');
    if (!host) return;
    if (state.historyBusy) return;
    state.historyBusy = true;
    history(state.historyPage).then(function (d) {
      state.historyBusy = false;
      if (!d || !host.isConnected) return;
      var rows = d.history || [];
      if (reset) host.innerHTML = '';
      if (!rows.length && reset) {
        host.innerHTML = '<li><span class="cn-h-s">' + t('history_empty', 'Nothing yet') + '</span></li>';
      }
      rows.forEach(function (h) {
        var li = doc.createElement('li');
        var s = doc.createElement('span');
        s.className = 'cn-h-s';
        s.textContent = srcLabel(h.source) + ' · ' + fmtTs(h.ts);
        var a = doc.createElement('span');
        a.className = 'cn-h-a ' + (h.type === 'spend' ? 'spend' : 'earn');
        a.textContent = (h.type === 'spend' ? '−' : '+') + num(h.amount);
        li.appendChild(s);
        li.appendChild(a);
        host.appendChild(li);
      });
      var total = Number(d.total) || 0;
      if (more) {
        var shown = host.children.length;
        more.style.display = shown < total ? '' : 'none';
      }
    });
    if (more) {
      more.onclick = function () {
        state.historyPage += 1;
        renderHistory(false);
      };
    }
  }

  /* ─── 挂载 ─── */
  function findAnchor() {
    return doc.querySelector('.sb-login') || doc.querySelector('[data-coins-mount]');
  }

  function mountOnce() {
    if (state.mounted) return;
    var anchor = findAnchor();
    if (!anchor) return false;
    state.mounted = true;
    style();
    me().then(function (d) {
      if (!d || !d.authenticated) return;   // 匿名：不渲染徽章、不发其它请求
      buildBadge(anchor);
      renderBadge();
    });
    return true;
  }

  function mount() {
    if (mountOnce()) return;
    // 首页侧栏是 JS 渲染的：等 .sb-login 出现（最多 5s）
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (mountOnce() || tries > 25) clearInterval(timer);
    }, 200);
  }

  /* 供页面上的「钱包」按钮调用：未登录时给一句提示（不弹登录框，
     各站登录入口不同，由用户自己点侧栏/顶栏的登录）。 */
  function openWallet() {
    if (!state.authed) {
      me().then(function (d) {
        if (d && d.authenticated) openPanel();
        else toast(t('err_need_login', 'Sign in to see your coins'));
      });
      return;
    }
    if (!badgeEl) { mountOnce(); }
    if (badgeEl) openPanel();
    else toast(t('err_need_login', 'Sign in to see your coins'));
  }

  function refresh() {
    state.me = null;
    me(true).then(function () {
      renderBadge();
      if (state.panelOpen) renderPanel();
    });
  }

  /* 语言切换后重渲染（面板开着时） */
  function onI18n() {
    if (state.panelOpen) renderPanel();
    if (badgeEl) badgeEl.title = t('open_wallet', 'Coin wallet');
  }
  if (global.addEventListener) {
    global.addEventListener('i18n:ready', onI18n);
    global.addEventListener('i18n:change', onI18n);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  global.Coins = {
    mount: mount,
    refresh: refresh,
    openWallet: openWallet,
    openPanel: openPanel,
    me: me,
    checkin: checkin,
    quests: quests,
    claim: claim,
    history: history,
    reportGame: reportGame,
    isAuthed: function () { return state.authed; },
    toast: toast
  };
})(window);
