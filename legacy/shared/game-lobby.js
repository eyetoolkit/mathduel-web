/* ═══════════════════════════════════════════════════════════════
   GameLobby — 游戏模式选择落地层（与 24点 #mode-select 同视觉语言）
   ────────────────────────────────────────────────────────────────
   用途: 各游戏页进页先出「选模式」卡片（每日挑战 / 自由玩 / …），
         选完进入游戏；右下角 ☰ 悬浮钮可随时重开模式层。
   用法（在各游戏主脚本内、能拿到 start 函数的作用域里调用）:
     GameLobby.show({
       cover: '/games/sudoku/cover.svg',   // 封面图（或用 icon: '🧩'）
       title: 'Sudoku',
       sub:   'Classic 9×9 logic grids',
       modes: [
         { icon:'🌍', label:'Daily Challenge', sub:'Same puzzle worldwide',
           onClick: function(){ startDaily(); } },   // hide() 已自动调用
         { icon:'🧩', label:'Free Play', sub:'Easy · Medium · Hard',
           onClick: function(){ init('medium'); } }
       ],
       howTo: '#faq'        // 可选：玩法/FAQ 锚点
     });
   细节:
     - 覆盖层 z-index 90（站点头部 --z-sticky:100 之下 → 头部/登录栏保持可点）。
     - ESC 或选完模式即收起；GameLobby.reopen() 重开最后一次配置。
     - 纯前端、零依赖；CSS 一次性注入（#gl-lobby 命名空间，不与页面冲突）。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.GameLobby) return;

  var CSS = [
    '#gl-lobby{position:fixed;inset:0;z-index:90;overflow:auto;background:var(--bg,#F1F5F9);display:none;}',
    '#gl-lobby.gl-on{display:block;}',
    '#gl-lobby .gl-inner{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5.2rem 1rem 2.5rem;box-sizing:border-box;}',
    '#gl-lobby .gl-cover{width:92px;height:92px;border-radius:22%;box-shadow:0 12px 32px rgba(49,46,129,.28);}',
    '#gl-lobby .gl-icon{width:92px;height:92px;border-radius:22%;background:linear-gradient(135deg,#2563EB,#1D4ED8);color:#fff;font-size:2.6rem;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 32px rgba(49,46,129,.28);}',
    '#gl-lobby .gl-title{font-size:1.9rem;font-weight:800;margin:.9rem 0 .2rem;letter-spacing:-.02em;color:var(--text,#1E293B);text-align:center;}',
    '#gl-lobby .gl-sub{font-size:.95rem;color:var(--text-light,#64748B);margin:0 0 1.4rem;text-align:center;max-width:520px;}',
    '#gl-lobby .gl-cards{display:flex;flex-direction:column;gap:.7rem;width:100%;max-width:420px;}',
    '#gl-lobby .gl-card{position:relative;display:flex;align-items:center;gap:.8rem;width:100%;padding:1rem 1.1rem;background:#fff;border:2px solid var(--border,#E2E8F0);border-radius:14px;font-size:1.02rem;font-weight:700;color:var(--text,#1E293B);cursor:pointer;text-align:left;transition:transform .15s,box-shadow .15s,border-color .15s;box-shadow:0 2px 8px rgba(0,0,0,.05);font-family:inherit;}',
    '#gl-lobby .gl-card:hover{transform:translateY(-2px);border-color:var(--primary,#0071E3);box-shadow:0 8px 24px rgba(0,0,0,.1);}',
    '#gl-lobby .gl-card .gl-ico{font-size:1.35rem;}',
    '#gl-lobby .gl-card small{display:block;font-weight:500;font-size:.75rem;color:var(--text-light,#94A3B8);margin-top:.1rem;}',
    '#gl-lobby .gl-card.gl-disabled{opacity:.55;cursor:not-allowed;}',
    '#gl-lobby .gl-card.gl-disabled:hover{transform:none;box-shadow:0 2px 8px rgba(0,0,0,.05);border-color:var(--border,#E2E8F0);}',
    '#gl-lobby .gl-secondary{display:flex;gap:.6rem;margin-top:1.1rem;flex-wrap:wrap;justify-content:center;}',
    '#gl-lobby .gl-secondary button{padding:.55rem 1rem;background:#fff;border:2px solid var(--border,#E2E8F0);border-radius:999px;font-size:.88rem;font-weight:600;color:var(--text,#1E293B);cursor:pointer;font-family:inherit;}',
    '#gl-lobby .gl-secondary button:hover{border-color:var(--primary,#0071E3);}',
    '#gl-lobby .gl-learn{margin-top:1.1rem;font-size:.9rem;color:var(--primary,#0071E3);text-decoration:none;font-weight:600;}',
    '#gl-lobby .gl-learn:hover{text-decoration:underline;}',
    '#gl-fab{position:fixed;right:14px;bottom:14px;z-index:95;display:none;width:46px;height:46px;border-radius:50%;border:2px solid var(--border,#E2E8F0);background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.16);font-size:1.15rem;cursor:pointer;align-items:center;justify-content:center;color:var(--text,#1E293B);}',
    '#gl-fab.gl-on{display:flex;}',
    '#gl-fab:hover{border-color:var(--primary,#0071E3);}'
  ].join('\n');

  var lobby = null, fab = null, lastCfg = null;

  function ensureDom() {
    if (lobby) return true;
    if (!document.body) return false;   // body 未就绪（理论上不会：调用点都在页尾脚本）
    var st = document.createElement('style');
    st.id = 'gl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    lobby = document.createElement('div');
    lobby.id = 'gl-lobby';
    lobby.innerHTML = '<div class="gl-inner"></div>';
    document.body.appendChild(lobby);
    fab = document.createElement('button');
    fab.id = 'gl-fab';
    fab.type = 'button';
    fab.title = 'Game modes';
    fab.setAttribute('aria-label', 'Game modes');
    fab.textContent = '☰';
    fab.addEventListener('click', function () { window.GameLobby.reopen(); });
    document.body.appendChild(fab);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lobby.classList.contains('gl-on')) window.GameLobby.hide();
    });
    return true;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(cfg) {
    var inner = lobby.firstChild;
    inner.innerHTML = '';
    if (cfg.cover) {
      var img = document.createElement('img');
      img.className = 'gl-cover';
      img.src = cfg.cover;
      img.alt = cfg.title || 'Game';
      inner.appendChild(img);
    } else if (cfg.icon) {
      inner.appendChild(el('div', 'gl-icon', cfg.icon));
    }
    if (cfg.title) inner.appendChild(el('h1', 'gl-title', cfg.title));
    if (cfg.sub) inner.appendChild(el('p', 'gl-sub', cfg.sub));
    var cards = el('div', 'gl-cards');
    (cfg.modes || []).forEach(function (m) {
      var b = el('button', 'gl-card' + (m.disabled ? ' gl-disabled' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'gl-ico', m.icon || '▶'));
      var box = el('span');
      box.appendChild(el('span', null, m.label || ''));
      if (m.sub) box.appendChild(el('small', null, m.sub));
      b.appendChild(box);
      if (!m.disabled && typeof m.onClick === 'function') {
        b.addEventListener('click', function () {
          window.GameLobby.hide();
          try { m.onClick(); } catch (e) { /* 游戏自身有报错兜底 */ }
        });
      }
      cards.appendChild(b);
    });
    inner.appendChild(cards);
    if (cfg.secondary && cfg.secondary.length) {
      var row = el('div', 'gl-secondary');
      cfg.secondary.forEach(function (s) {
        var b = el('button', null, s.label || '');
        b.type = 'button';
        if (typeof s.onClick === 'function') {
          b.addEventListener('click', function () {
            window.GameLobby.hide();
            try { s.onClick(); } catch (e) {}
          });
        }
        row.appendChild(b);
      });
      inner.appendChild(row);
    }
    if (cfg.howTo) {
      var a = el('a', 'gl-learn', cfg.howToLabel || '📖 How to play, tips & FAQ');
      a.href = cfg.howTo;
      inner.appendChild(a);
    }
  }

  window.GameLobby = {
    /* 显示模式层；若 body 未就绪则等 DOMContentLoaded 再显 */
    show: function (cfg) {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () { window.GameLobby.show(cfg); });
        return;
      }
      lastCfg = cfg || {};
      ensureDom();
      render(lastCfg);
      lobby.classList.add('gl-on');
      if (fab && lastCfg.floating !== false) fab.classList.add('gl-on');
      lobby.scrollTop = 0;
    },
    hide: function () {
      if (!lobby) return;
      lobby.classList.remove('gl-on');
      if (fab) fab.classList.remove('gl-on');
    },
    reopen: function () { if (lastCfg) window.GameLobby.show(lastCfg); },
    isVisible: function () { return !!(lobby && lobby.classList.contains('gl-on')); }
  };
})();
