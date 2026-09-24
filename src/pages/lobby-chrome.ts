/**
 * 纸感骨架（sidebar / topbar / overlay）的共享交互。
 * ------------------------------------------------------------
 * 三个入口都用它，避免同一份逻辑被抄成几份、口径漂移：
 *   1. 各游戏 lobby 页的静态壳（games/<id>/lobby/）
 *   2. 24 点 lobby（静态壳，此前漏接 → 移动端抽屉与收窄按钮全死）
 *   3. 首页（pages/home-redesign.ts 渲染的壳，收窄按钮 id 是 sbCollapse）
 * 本模块负责三件小事：移动端 burger 抽屉、遮罩/Esc 关闭、侧栏收窄。
 * 幂等 —— 重复调用无副作用，但重复「绑定」会让 toggle 相互抵消。
 */
import { initTheme } from '../theme';

let wired = false;

export function wireLobbyChrome(): void {
  if (wired) return;
  wired = true;

  // 白天/夜晚主题切换：首页与各 lobby 共用此模块，一处绑定覆盖全站
  initTheme();

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

  // 收窄按钮两个名字都认：lobby 壳用 #collapse，首页壳用 #sbCollapse
  const collapse = document.getElementById('collapse') ?? document.getElementById('sbCollapse');
  collapse?.addEventListener('click', () => document.body.classList.toggle('rail'));
}
