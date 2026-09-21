/**
 * MathDuel 首页入口
 */
import '@tri-sites/design-system/styles';
import '../src/styles/home.css';
import { mountHeader, initI18n, t } from '@tri-sites/design-system';
import { renderGameGrid } from './pages/home';
import { renderDailySettings } from './components/daily-settings';
import { renderHeroFlow } from './components/hero-flow';

initI18n();

const headerHost = document.getElementById('header');
if (headerHost) {
  mountHeader(headerHost, {
    brandName: 'MathDuel',
    brandSub: 'Make 24',
    mark: '24',
    nav: [
      { labelKey: 'nav.home', href: '/' },
      { labelKey: 'nav.games', href: '/games/24-game/' },
      { labelKey: 'nav.leaderboard', href: '/leaderboard/' },
    ],
  });
}

renderHeroFlow(document.getElementById('heroFlow'));
renderDailySettings(
  document.getElementById('dailyCount'),
  document.getElementById('dailyTime'),
  document.getElementById('dailyStart'),
);
renderGameGrid(document.getElementById('gameGrid'));

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// 在线人数：轻微起伏，制造"活的站点"观感（不阻塞首屏）
const statPlayers = document.getElementById('statPlayers');
if (statPlayers) {
  const base = 1180 + Math.floor(Math.random() * 160);
  let cur = base;
  statPlayers.textContent = cur.toLocaleString('en-US');
  setInterval(() => {
    cur += Math.floor(Math.random() * 9) - 4;
    statPlayers.textContent = Math.max(900, cur).toLocaleString('en-US');
  }, 4200);
}

// 让首屏以下内容在语言切换后仍正确翻译
document.addEventListener('tri:lang', () => {
  renderGameGrid(document.getElementById('gameGrid'));
  const banner = document.getElementById('dailyBanner');
  if (banner) banner.setAttribute('aria-label', t('daily.badge'));
});
