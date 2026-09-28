/**
 * MathDuel 首页入口（Homepage Redesign v2 · papergames 浅色版, 2026-09-23）
 * 设计稿：share-html/24zuixin.html
 * - 装配侧栏 + 游戏墙 + hero + 每日/周赛 + 天梯 + 特性 + 页脚
 * - 字体/CSS 沿用设计系统站内自托管（Space Grotesk / Sora）
 * - 倒计时到 UTC 零点（与 daily24 API 对齐）
 */
import '@tri-sites/design-system/styles';
import './styles/home-redesign.css';
import { renderHomeV2 } from './pages/home-redesign';
import { registerSW } from './pwa';
import { initI18n } from './i18n/runtime';

// 多语言（首访英文，URL ?lang= 或 localStorage 可切）
initI18n().finally(() => {
  // 等 async 字典加载完再重绘，把 t() 调用的英文替换成目标语言
  renderHomeV2();
});

// 主页装配（同步先绘一次，EN_FALLBACK 保证英文立即可见）
renderHomeV2();

// 语言切换时重绘（模板里用了 t() 调用，需要重新生成 DOM）
window.addEventListener('tri:lang', () => renderHomeV2());

// PWA（静默失败，不影响站点功能）
registerSW();

// 年份（页脚）
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
