/**
 * Lobby 页共享的「页面骨架」交互。
 * ------------------------------------------------------------
 * 各游戏 lobby 页的静态壳（sidebar / topbar / overlay）与首页同源，
 * 但首页的接线在 pages/home-redesign.ts 里，lobby 页不经过它。
 * 本模块只负责三件小事：移动端 burger 抽屉、遮罩/Esc 关闭、侧栏收窄。
 * 页面在 DOMContentLoaded 后调用一次 wireLobbyChrome() 即可。
 */
export function wireLobbyChrome(): void {
  const burger = document.getElementById('burger');
  const overlay = document.getElementById('overlay');
  if (burger && overlay) {
    const close = (): void => {
      document.body.classList.remove('nav-open');
      burger.setAttribute('aria-expanded', 'false');
    };
    burger.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    });
  }

  const collapse = document.getElementById('collapse');
  collapse?.addEventListener('click', () => document.body.classList.toggle('rail'));
}
