/* ═══════════════════════════════════════════════════════════════════
   game-core.js · 游戏核心工具库 v1.0
   为 9 款游戏提供统一的工具：Confetti 动画、统计、成就、每日挑战、教程
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════
   game-core.js · 游戏核心工具库 v1.0
   为 9 款游戏提供统一的工具：Confetti 动画、统计、成就、每日挑战、教程
   ═══════════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  /* ──────────────── 1. Service Worker 注册 ──────────────── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }

  /* ──────────────── 2. Confetti 胜利动画 ──────────────── */
  function fireConfetti(opts = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = opts.colors || ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#fd79a8'];
    const duration = opts.duration || 2500;
    const container = document.createElement('div');
    container.className = 'g-confetti-container';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    for (let i = 0; i < (opts.count || 60); i++) {
      const c = document.createElement('div');
      c.className = 'g-confetti-piece';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 6 + Math.random() * 8;
      c.style.cssText = 'background:' + color + ';width:' + size + 'px;height:' + size + 'px;left:' + (Math.random() * 100) + '%;';
      container.appendChild(c);
      c.animate([
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: 'translateY(100vh) rotate(' + (360 + Math.random() * 720) + 'deg)', opacity: 0 }
      ], { duration: duration + Math.random() * 1000, delay: Math.random() * 200, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
    }
    setTimeout(() => container.remove(), duration + 2000);
  }
  global.fireConfetti = fireConfetti;

  /* ──────────────── 3. GameStats 统计系统 ──────────────── */
  const GameStats = {
    get(k) { try { return JSON.parse(localStorage.getItem('gs_' + k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('gs_' + k, JSON.stringify(v)); } catch (e) {} },
    inc(game, field, by = 1) {
      const stats = this.get('stats') || {};
      if (!stats[game]) stats[game] = {};
      stats[game][field] = (stats[game][field] || 0) + by;
      this.set('stats', stats);
    },
    track(game, action) {
      this.inc(game, 'plays');
      if (action) this.inc(game, 'actions_' + action);
    },
    getAll(game) { return (this.get('stats') || {})[game] || {}; },
    getAllStats() { return this.get('stats') || {}; },
    clear() { ['stats','achievements','daily','tutorial_seen'].forEach(k => localStorage.removeItem('gs_' + k)); }
  };
  global.GameStats = GameStats;

  /* ──────────────── 4. GameAchievements 成就系统 ──────────────── */
  const ACHIEVEMENT_DEFS = {
    first_play:  { name: '🎮 初出茅庐', desc: '完成第1 次游戏' },
    play_10:     { name: '🎯 十战十胜', desc: '累计完成10 次' },
    play_50:     { name: '⭐ 老玩家', desc: '累计完成50 次' },
    play_100:    { name: '👑 百战老兵', desc: '累计完成100 次' },
    streak_3:    { name: '🔥 三连胜', desc: '连续3 次完成' },
    streak_5:    { name: '🔥 五连胜', desc: '连续5 次完成' },
    streak_10:   { name: '💎 十连胜', desc: '连续10 次完成' },
    fast_30s:    { name: '⚡ 神速', desc: '30 秒内通关' },
    no_mistakes: { name: '💯 完美', desc: '零错误通关' },
    all_games:   { name: '🎰 全能玩家', desc: '玩过所有12 个游戏' }
  };

  const GameAchievements = {
    defs: ACHIEVEMENT_DEFS,
    get() { try { return JSON.parse(localStorage.getItem('gs_achievements') || '{}'); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('gs_achievements', JSON.stringify(v)); } catch (e) {} },
    unlock(id) {
      const got = this.get();
      if (got[id]) return false;
      got[id] = Date.now();
      this.set(got);
      const def = this.defs[id];
      if (def) this.notify(def.name, def.desc);
      return true;
    },
    unlockMany(ids) { ids.forEach(id => this.unlock(id)); },
    list() {
      const got = this.get();
      return Object.keys(this.defs).map(id => ({
        id, name: this.defs[id].name, desc: this.defs[id].desc, unlocked: !!got[id], time: got[id] || null
      }));
    },
    progress() {
      const got = this.get();
      const total = Object.keys(this.defs).length;
      const unlocked = Object.keys(got).length;
      return { unlocked, total, percent: Math.round(unlocked / total * 100) };
    },
    notify(title, desc) {
      const el = document.createElement('div');
      el.className = 'g-achievement-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<strong>🏆 成就解锁</strong><br><span style="font-size:1.1em">' + title + '</span><br><small style="opacity:0.95">' + desc + '</small>';
      document.body.appendChild(el);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.animate([
          { transform: 'translateX(-50%) translateY(-20px)', opacity: 0 },
          { transform: 'translateX(-50%) translateY(0)', opacity: 1 }
        ], { duration: 400, easing: 'ease-out' });
      }
      setTimeout(() => {
        el.style.transition = 'opacity 0.4s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 400);
      }, 3000);
      if (global.fireConfetti) fireConfetti({ duration: 1500 });
    },
    // 自动检测成就（在游戏胜利时调用）
    autoCheck(gameName, opts = {}) {
      const newIds = [];
      const stats = GameStats.get('stats') || {};
      const gameStats = stats[gameName] || {};
      const total = gameStats.plays || 0;

      if (total >= 1) newIds.push('first_play');
      if (total >= 10) newIds.push('play_10');
      if (total >= 50) newIds.push('play_50');
      if (total >= 100) newIds.push('play_100');

      if (opts.combo >= 3) newIds.push('streak_3');
      if (opts.combo >= 5) newIds.push('streak_5');
      if (opts.combo >= 10) newIds.push('streak_10');

      if (opts.time !== undefined && opts.time < 30) newIds.push('fast_30s');
      if (opts.noMistakes) newIds.push('no_mistakes');

      // 全能玩家：玩过所有12 个游戏
      const allGames = ['sudoku','sudoku-6x6','15-puzzle','24-game','equation-pyramid','killer-sudoku'];
      if (allGames.every(g => (stats[g] && stats[g].plays))) newIds.push('all_games');

      newIds.forEach(id => this.unlock(id));
    }
  };
  global.GameAchievements = GameAchievements;

  /* ──────────────── 5. GameDaily 每日挑战 ──────────────── */
  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  const GameDaily = {
    today() {
      const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    },
    getSeed(game) { return this.today() * 1000 + (hashString(game || '') % 1000); },
    isCompleted(game) { try { return (JSON.parse(localStorage.getItem('gs_daily') || '{}'))[game] === this.today(); } catch (e) { return false; } },
    complete(game) { const d = this.get('daily') || {}; d[game] = this.today(); this.set('daily', d); },
    getAll() { return this.get('daily') || {}; },
    get(k) { try { return JSON.parse(localStorage.getItem('gs_' + k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('gs_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  global.GameDaily = GameDaily;

  /* ──────────────── 6. SeededRandom 种子随机数 ──────────────── */
  function SeededRandom(seed) {
    let s = seed || 1;
    return function() { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }
  global.SeededRandom = SeededRandom;

  /* ──────────────── 7. Tutorial 教程系统 ──────────────── */
  const Tutorial = {
    seen(gameId) {
      try {
        const seen = JSON.parse(localStorage.getItem('gs_tutorial_seen') || '{}');
        return !!seen[gameId];
      } catch (e) { return false; }
    },
    markSeen(gameId) {
      try {
        const seen = JSON.parse(localStorage.getItem('gs_tutorial_seen') || '{}');
        seen[gameId] = Date.now();
        localStorage.setItem('gs_tutorial_seen', JSON.stringify(seen));
      } catch (e) {}
    },
    reset(gameId) {
      try {
        const seen = JSON.parse(localStorage.getItem('gs_tutorial_seen') || '{}');
        delete seen[gameId];
        localStorage.setItem('gs_tutorial_seen', JSON.stringify(seen));
      } catch (e) {}
    },
    /**
     * 显示教程
     * @param {object} opts - {gameId, title, steps, onClose}
     *   steps: [{title, body, icon?}]
     */
    show(opts) { /* no-op: tutorial replaced by inline game-footer */ },
    /**
     * 在游戏中添加一个"📖 玩法"按钮
     */
    attachButton(gameId, opts) { /* no-op: button replaced by inline game-footer */ }
  };
  global.GameTutorial = Tutorial;

  

  /* ──────────────── 9. Keyboard 键盘导航模块 ──────────────── */
  const Keyboard = {
    // 注册游戏的键盘监听
    register(gameName, handlers) {
      const listener = (e) => {
        // 暂停时只响应 Esc
        if (global.GameTimer && global.GameTimer.paused && e.key !== 'Escape') return;

        const key = e.key;
        const handler = handlers[key] || handlers[e.code];
        if (handler) {
          const result = handler(e);
          if (result !== false) e.preventDefault();
        }
      };
      document.addEventListener('keydown', listener);
      return () => document.removeEventListener('keydown', listener);
    },
    // 方向键通用处理（grid 移动）
    arrowHandler(state, callbacks) {
      return {
        'ArrowUp':    (e) => { e.preventDefault(); callbacks.up(); },
        'ArrowDown':  (e) => { e.preventDefault(); callbacks.down(); },
        'ArrowLeft':  (e) => { e.preventDefault(); callbacks.left(); },
        'ArrowRight': (e) => { e.preventDefault(); callbacks.right(); }
      };
    },
    // 数字键 1-9 通用处理
    numberHandler(callback) {
      const h = {};
      for (let i = 1; i <= 9; i++) {
        h[String(i)] = (e) => { e.preventDefault(); callback(i); };
      }
      return h;
    },
    // ESC 通用关闭
    escHandler(callback) {
      return { 'Escape': (e) => { e.preventDefault(); callback(); } };
    },
    // 空格/回车确认
    confirmHandler(callback) {
      return {
        ' ': (e) => { e.preventDefault(); callback(); },
        'Enter': (e) => { e.preventDefault(); callback(); }
      };
    }
  };
  global.GameKeyboard = Keyboard;

  /* ──────────────── 10. A11y 无障碍工具 ──────────────── */
  const A11y = {
    /**
     * 为游戏棋盘添加 ARIA grid 角色
     */
    setupGrid(boardEl, opts = {}) {
      if (!boardEl) return;
      boardEl.setAttribute('role', 'grid');
      boardEl.setAttribute('aria-label', opts.label || '游戏棋盘');
      boardEl.setAttribute('aria-rowcount', String(opts.rows || 0));
      boardEl.setAttribute('aria-colcount', String(opts.cols || 0));

      const cells = boardEl.querySelectorAll('[data-cell], .cell, td, .puzzle-cell, .sudoku-cell, .g24-card, .block-cell, .ws-tube');
      cells.forEach((cell, i) => {
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('tabindex', '-1');
        if (opts.cellLabel) {
          cell.setAttribute('aria-label', opts.cellLabel(i));
        }
      });
    },

    /**
     * 让元素可聚焦（Tab）
     */
    makeFocusable(el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    },

    /**
     * 公告状态变化（屏幕阅读器）
     */
    announce(message, priority = 'polite') {
      let announcer = document.getElementById('g-sr-announcer');
      if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'g-sr-announcer';
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(announcer);
      }
      announcer.setAttribute('aria-live', priority);
      // 清空再设，确保屏幕阅读器读到
      announcer.textContent = '';
      setTimeout(() => { announcer.textContent = message; }, 50);
    },

    /**
     * 给所有按钮加 aria-label（如果没有）
     */
    enhanceButtons(rootEl = document) {
      rootEl.querySelectorAll('button').forEach(btn => {
        if (!btn.getAttribute('aria-label') && btn.textContent.trim()) {
          btn.setAttribute('aria-label', btn.textContent.trim());
        }
      });
    },

    /**
     * 焦点陷阱（Modal 打开时）
     */
    trapFocus(container) {
      const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      function handler(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      container.addEventListener('keydown', handler);
      first.focus();
      return () => container.removeEventListener('keydown', handler);
    }
  };
  global.GameA11y = A11y;

  /* ──────────────── 11. Storage 数据迁移 ──────────────── */
  const Storage = {
    VERSION: 2,
    VERSION_KEY: 'gs_version',

    getVersion() {
      try { return parseInt(localStorage.getItem(this.VERSION_KEY) || '0'); } catch (e) { return 0; }
    },

    setVersion(v) {
      try { localStorage.setItem(this.VERSION_KEY, String(v)); } catch (e) {}
    },

    /**
     * 迁移旧版数据到新格式
     * v1 -> v2: 将分散的 scores/round/streak 等整合到 gs_stats
     */
    migrate() {
      const current = this.getVersion();
      if (current >= this.VERSION) return;

      console.log('[Storage] 迁移版本 v' + current + ' → v' + this.VERSION);

      if (current < 2) {
        // v1 → v2: 整合旧数据
        const stats = GameStats.getAllStats();

        // 旧数据格式: 各游戏的 localStorage key
        const oldKeys = {
          // 24-game
          '24_scores': ['24-game', 'scores'],
        };

        Object.keys(oldKeys).forEach(key => {
          try {
            const v = localStorage.getItem(key);
            if (v !== null) {
              const [game, field] = oldKeys[key];
              if (!stats[game]) stats[game] = {};
              stats[game][field] = isNaN(parseInt(v)) ? v : parseInt(v);
            }
          } catch (e) {}
        });

        GameStats.set('stats', stats);
      }

      this.setVersion(this.VERSION);
    },

    /**
     * 安全获取 + 错误恢复
     */
    safeGet(key, defaultValue) {
      try {
        const v = localStorage.getItem(key);
        if (v === null) return defaultValue;
        return JSON.parse(v);
      } catch (e) {
        console.warn('[Storage] 读取失败 ' + key + ':', e);
        // 数据损坏，自动备份并清理
        try {
          const v = localStorage.getItem(key);
          if (v) localStorage.setItem(key + '_corrupted_' + Date.now(), v);
          localStorage.removeItem(key);
        } catch (e2) {}
        return defaultValue;
      }
    },

    safeSet(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('[Storage] 写入失败 ' + key + ':', e);
        // 可能是 quota 超出
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          console.warn('[Storage] 存储已满，尝试清理旧数据...');
          // 清理 _corrupted_ 备份
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.includes('_corrupted_')) {
              localStorage.removeItem(k);
            }
          }
          // 再试一次
          try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
          } catch (e2) {
            return false;
          }
        }
        return false;
      }
    },

    /**
     * 检查整体数据完整性
     */
    healthCheck() {
      const report = {
        totalKeys: localStorage.length,
        totalBytes: new Blob([JSON.stringify(localStorage)]).size,
        corrupted: [],
        gameKeys: 0
      };
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.includes('_corrupted_')) {
          report.corrupted.push(k);
        }
        if (k.startsWith('gs_') ||
            ['24_scores',
            'ws_level_easy','ws_level_medium','ws_level_hard'].includes(k)) {
          report.gameKeys++;
        }
      }
      return report;
    }
  };
  global.GameStorage = Storage;

  // 自动执行迁移
  try { Storage.migrate(); } catch (e) { console.warn('[Storage] 迁移失败:', e); }

  /* ──────────────── 12. 版本号更新 ──────────────── */
  global.GameCore = {
    version: '1.1.0',
    fireConfetti, GameStats, GameAchievements, GameDaily, SeededRandom,
    Tutorial, Keyboard, A11y, Storage
  };

  // 自动 A11y 增强：所有页面加载后增强按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => A11y.enhanceButtons());
  } else {
    A11y.enhanceButtons();
  }

  console.log('[GameCore v' + global.GameCore.version + '] 已加载（含 Keyboard/A11y/Storage）');
})(typeof window !== 'undefined' ? window : this);
