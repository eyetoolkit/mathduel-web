(function(){
  /* ============================================================
     积分余额顶栏组件
     Usage:
       window.CoinsBar.init()           // 初始化
       window.CoinsBar.refresh()         // 刷新
       window.CoinsBar.getBalance(cb)    // 获取余额回调
     DOM: 显示积分徽章，点击展开详情弹窗
  ============================================================ */
  'use strict';

  var API = '/api/coins/me';
  var STORAGE_KEY = 'md_coins_v1';
  var cache = null;
  var cacheTime = 0;
  var CACHE_TTL = 60 * 1000; // 1分钟缓存

  /* ─── 翻译函数 ─── */
  function __(key, fallback) {
    if (typeof window !== 'undefined') {
      if (window.i18n && typeof window.i18n.t === 'function') {
        return window.i18n.t(key);
      }
      if (window.__ && typeof window.__ === 'function') {
        return window.__(key);
      }
    }
    return fallback || key;
  }

  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function getBalance(cb) {
    var now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL) {
      cb(cache);
      return;
    }
    fetch(API, { credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.coins !== undefined) {
          cache = d;
          cacheTime = now;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ d: d, t: now })); } catch(e){}
          cb(d);
        } else {
          cb(null);
        }
      })
      .catch(function(){ cb(null); });
  }

  function render(bal) {
    var el = qs('#coins-bar-btn');
    if (!el) return;
    if (bal) {
      el.textContent = '\uD83E\uDE99 ' + bal.coins.toLocaleString();
      if (bal.ad_free && bal.ad_free.active) {
        el.classList.add('coins-bar--vip');
      }
    } else {
      /* P7: 游客显示"登录"而非 "--"（点击弹窗引导登录）; i18n 缺 key 时回退中文 */
      var lbl = '登录';
      try { var tv = window.i18n && window.i18n.t ? window.i18n.t('coins.login_cta') : null; if (tv && tv !== 'coins.login_cta') lbl = tv; } catch (e) {}
      el.textContent = '\uD83E\uDE99 ' + lbl;
      el.classList.remove('coins-bar--vip');
    }
  }

  /* ─── P0-4 (2026-09-20): 签到入口 ───
     背景：/api/coins/checkin 规则（+10，7 天连签再 +50）在后端一直在，但三站前端 0 引用、
     全站没有任何 UI ⇒ 签到与"连续签到 3 天"任务不可达。这里把它挂到金币徽章弹窗里。 */
  function todayUTCKey() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function checkinBtnHtml(bal) {
    var done = !!(bal && bal.streaks && bal.streaks.last_checkin_date === todayUTCKey());
    if (done) {
      return '<div style="background:#f3f4f6;color:#6b7280;text-align:center;padding:8px;border-radius:8px;font-size:13px;margin-bottom:8px">\u2705 ' + __('coins.checked_in_today', '今日已签到') + '</div>';
    }
    return '<button id="coins-checkin-btn" type="button" style="display:block;width:100%;background:#f59e0b;color:#fff;border:none;text-align:center;padding:8px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px">\uD83D\uDCC5 ' + __('coins.checkin_cta', '签到领 10 金币') + '</button>';
  }
  function bindCheckin(popup) {
    var ci = popup.querySelector('#coins-checkin-btn');
    if (!ci) return;
    ci.addEventListener('click', function (e) {
      e.stopPropagation();
      ci.disabled = true;
      ci.textContent = '...';
      fetch('/api/coins/checkin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          cache = null; cacheTime = 0;
          getBalance(function (nb) { closeAllPopups(); showTooltip(nb); });
        })
        .catch(function () { ci.disabled = false; ci.textContent = __('coins.checkin_cta', '签到领 10 金币'); });
    });
  }

  function showTooltip(bal) {
    closeAllPopups();
    var popup = document.createElement('div');
    popup.id = 'coins-popup';
    popup.style.cssText = [
      'position:absolute','right:0','top:100%','margin-top:8px',
      'background:#fff','border-radius:12px','box-shadow:0 8px 24px rgba(0,0,0,.15)',
      'min-width:200px','padding:16px','z-index:9999','font-size:14px',
      'border:1px solid #e5e7eb','text-align:left'
    ].join(';');

    if (!bal) {
      popup.innerHTML = '<p style="color:#6b7280;margin:0 0 10px">' + __('coins.login_to_view', 'Log in to view points') + '</p>'
        + '<button id="coins-login-btn" type="button" data-open-login style="display:block;width:100%;background:var(--primary,#4f46e5);color:#fff;border:none;text-align:center;padding:8px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">' + __('coins.login_cta', '登录 / 注册') + '</button>';
    } else {
      var adFreeHtml = '';
      if (bal.ad_free && bal.ad_free.active) {
        var days = Math.ceil((bal.ad_free.expires_at - Date.now()) / 86400000);
        adFreeHtml = '<div style="background:#dcfce7;color:#166534;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-weight:600">\u2705 ' + __('coins.ad_free_remaining', '' + __('coins.ad_free_remaining','Ad-free remaining ') + '{days}' + __('coins.days',' days') + '').replace('{days}', days) + '</div>';
      }
      var streakHtml = '';
      if (bal.streaks && bal.streaks.login_streak > 0) {
        streakHtml = '<div style="margin-bottom:8px;color:#6b7280">\uD83D\uDD25 ' + __('coins.streak_days', '' + __('coins.streak_days','Streak ') + '<b>{count}</b>' + __('coins.days',' days') + '').replace('{count}', bal.streaks.login_streak) + '</div>';
      }
      popup.innerHTML =
        adFreeHtml +
        '<div style="font-size:18px;font-weight:700;color:#1f2937;margin-bottom:8px">\uD83E\uDE99 ' + bal.coins.toLocaleString() + '</div>' +
        streakHtml +
        '<div style="color:#6b7280;font-size:12px;margin-bottom:10px">' + __('coins.today_gained', '' + __('coins.today_gained','Earned today: ') + '<b>+{amount}</b>').replace('{amount}', ((bal.daily_budget && bal.daily_budget.used) || bal.today_earned || 0)) + '</div>' +
        checkinBtnHtml(bal) + '<a href="/membership/" style="display:block;background:var(--primary);color:#fff;text-align:center;padding:8px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">\uD83D\uDCB0 ' + __('coins.earn_more', '赚更多积分') + '</a>';
    }

    var btn = qs('#coins-bar-btn');
    var parent = btn && btn.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(popup);
      bindCheckin(popup);
      var _lb = popup.querySelector('#coins-login-btn');
      if (_lb) _lb.addEventListener('click', function (ev) { ev.stopPropagation(); closeAllPopups(); ensureAuthModal(openLoginModal); });
      setTimeout(function(){
        document.addEventListener('click', closeOnClickOutside);
      }, 0);
    }
  }

  function closeOnClickOutside(e) {
    var popup = qs('#coins-popup');
    var btn = qs('#coins-bar-btn');
    if (popup && !popup.contains(e.target) && (!btn || !btn.contains(e.target))) {
      closeAllPopups();
    }
  }

  function closeAllPopups() {
    var p = qs('#coins-popup');
    if (p) p.remove();
    document.removeEventListener('click', closeOnClickOutside);
  }

  /* ─── 登录弹窗（按需加载）───
     本组件被 mathduel 7 个页面引用，其中 6 个（各游戏页）未静态加载 auth-modal.js。
     游客点「登录」时按需动态加载，单点修复全站 —— 之前只弹一段文字，等于"点了没反应"。 */
  var _authLoading = null;
  function ensureAuthModal(cb) {
    if (window.AuthModal) { cb(); return; }
    if (_authLoading) { _authLoading.push(cb); return; }
    _authLoading = [cb];
    var s = document.createElement('script');
    s.src = '/shared/auth-modal.js?v=20260924';
    s.onload = function () {
      var q = _authLoading || []; _authLoading = null;
      q.forEach(function (f) { try { f(); } catch (e) {} });
    };
    s.onerror = function () { _authLoading = null; openLoginModal(); };
    document.head.appendChild(s);
  }
  function openLoginModal() {
    if (window.AuthModal && typeof window.AuthModal.open === 'function') { window.AuthModal.open('login'); return; }
    try { document.dispatchEvent(new CustomEvent('open-login-tab')); } catch (e) {}
  }

  function mount() {
    var existing = qs('#coins-bar-btn');
    if (!existing) {
      /* P7 自挂载: 全站无人渲染 #coins-bar-btn —— 徽章自己创建（site-header 右侧, 无头则固定右上角）*/
      var host = qs('.sh-actions');
      var btn = document.createElement('button');
      btn.id = 'coins-bar-btn';
      btn.type = 'button';
      btn.style.cssText = 'position:relative;cursor:pointer;border:1px solid rgba(0,0,0,.08);background:#fff;border-radius:999px;padding:4px 12px;font-size:14px;font-weight:700;color:#1f2937;box-shadow:0 1px 4px rgba(0,0,0,.08);white-space:nowrap;line-height:1.4;';
      btn.textContent = '\uD83E\uDE99 --';
      if (host) {
        if (!host.style.position) host.style.position = 'relative';
        host.appendChild(btn);
      } else if (document.body) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;top:12px;right:14px;z-index:9000;';
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
      } else {
        return; /* body 未就绪且无头 —— 等 DOMContentLoaded 重试 */
      }
      existing = btn;
    }
    if (existing.dataset && existing.coinsBound) { getBalance(function(bal){ render(bal); }); return; }
    if (existing.dataset) existing.coinsBound = true;

    existing.addEventListener('click', function(e){
      e.stopPropagation();
      var popup = qs('#coins-popup');
      if (popup) {
        closeAllPopups();
      } else {
        getBalance(function(bal){
          render(bal);
          /* 游客点「登录」→ 直接打开登录弹窗（原实现只弹一段文字，等于点了没反应）*/
          if (!bal) { ensureAuthModal(openLoginModal); }
          else { showTooltip(bal); }
        });
      }
    });

    getBalance(function(bal){ render(bal); });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  function refresh() {
    cache = null;
    cacheTime = 0;
    getBalance(function(bal){ render(bal); });
  }

  function getBalanceSync() { return cache; }

  if (typeof window !== 'undefined') {
    window.CoinsBar = { init: init, refresh: refresh, getBalance: getBalance, getBalanceSync: getBalanceSync };
  }
  init();
})();
