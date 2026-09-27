/**
 * PWA 注册入口 —— 极简、零依赖、静默失败。
 * 服务策略（见 /sw.js）：
 *   - /api/、/ws 永不缓存
 *   - 带 hash 的 /assets/ 与 /fonts/：cache-first（immutable）
 *   - 页面导航：network-first，离线回落缓存
 * 任何失败（http 环境、老浏览器、被禁用）都不影响站点功能。
 */
export function registerSW(): void {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* 静默 */ });
    });
  } catch { /* 静默 */ }
}
