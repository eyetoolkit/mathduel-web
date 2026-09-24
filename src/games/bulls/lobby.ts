/**
 * Bulls & Cows（1A2B）模式选择页。
 * ------------------------------------------------------------
 * 本页没有每日榜 / 难度行 / 天梯 —— 游戏页不读任何 query 参数，
 * 也还没有写本地成绩，所以 JS 只有一件事：接线纸感骨架的移动端
 * burger 抽屉、遮罩关闭与侧栏收窄（wireLobbyChrome）。
 * hero 装饰、模式卡、规则、难度表全部是静态 HTML。
 */

import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how
import '../24-game/lobby.css';            // .home-v2 下的模式卡 / panel / arb-* 共享组件
import './lobby.css';                     // Bulls 专属：hero 装饰 + 难度表
import { wireLobbyChrome } from '../../pages/lobby-chrome';

function boot(): void {
  wireLobbyChrome();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
