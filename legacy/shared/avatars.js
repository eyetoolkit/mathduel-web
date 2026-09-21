/* ═══════════════════════════════════════════════════════════════
   MathDuel P1 头像渲染助手 (mathduel 站内独立副本, 不入共享库)
   用法:
     MDAvatars.chipHtml(id)  -> '<span class="md-ava">🐱</span>' (字符串)
     MDAvatars.chip(el, id)  -> 渲染进容器
     MDAvatars.icon(id)      -> emoji 字符
   id 与服务端 stores/account.js FREE_AVATARS + ep.js CATALOG 对齐;
   未知 id 兜底 🎭, 不抛错。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var MAP = {
    /* 免费 12 */
    'a-cat': '🐱', 'a-dog': '🐶', 'a-frog': '🐸', 'a-owl': '🦉',
    'a-tiger': '🐯', 'a-bear': '🐻', 'a-penguin': '🐧', 'a-unicorn': '🦄',
    'a-robot': '🤖', 'a-ghost': '👻', 'a-turtle': '🐢', 'a-rabbit': '🐰',
    /* 商店付费 4 */
    'a-fox': '🦊', 'a-panda': '🐼', 'a-lion': '🦁', 'a-octo': '🐙'
  };
  function icon(id) { return (id && MAP[id]) || '🎭'; }
  function chipHtml(id) {
    if (!id) return '';   // 无头像数据(如旧排行榜快照)不渲染, 避免满屏兜底脸
    return '<span class="md-ava">' + icon(id) + '</span>';
  }
  function chip(el, id, label) {
    if (!el) return;
    el.innerHTML = chipHtml(id) + (label ? '<span>' + label + '</span>' : '');
  }
  function ensureStyle() {
    if (document.getElementById('md-ava-style')) return;
    var st = document.createElement('style');
    st.id = 'md-ava-style';
    st.textContent =
      '.md-ava{display:inline-flex;align-items:center;justify-content:center;' +
      'width:1.7em;height:1.7em;font-size:1.1em;background:#eef2f8;border-radius:50%;' +
      'vertical-align:-0.4em;margin-right:.4em;line-height:1;flex:none;' +
      'box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);}';
    document.head.appendChild(st);
  }
  if (document.head) ensureStyle();
  else document.addEventListener('DOMContentLoaded', ensureStyle);
  window.MDAvatars = { icon: icon, chipHtml: chipHtml, chip: chip };
})();
