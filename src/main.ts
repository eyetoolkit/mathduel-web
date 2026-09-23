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

// 主页装配
renderHomeV2();

// 年份（页脚）
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
