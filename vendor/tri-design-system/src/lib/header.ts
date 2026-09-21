/**
 * Tri-Sites Design System · 站点头部 + 移动抽屉
 * 一份实现，四站复用（靠 data-site 切品牌色，靠 config 切导航项）
 */

import { escapeHtml } from '../lib/utils';
import { mountLangSwitcher, t } from '../i18n';

export interface NavItem {
  labelKey: string;
  href: string;
}

export interface HeaderConfig {
  brandName: string;
  brandSub: string;
  mark: string;
  nav: NavItem[];
  /** 右侧额外内容（金币栏 / 登录按钮等）的挂载点 id */
  actionsId?: string;
}

/**
 * 挂载站点头部。返回抽屉控制句柄。
 * 结构：header.site-header > [brand] [nav(桌面)] [lang] [actions] [汉堡]
 */
export function mountHeader(host: HTMLElement, cfg: HeaderConfig): void {
  const activePath = location.pathname.replace(/index\.html$/, '');

  const navHtml = cfg.nav
    .map((item) => {
      const current = item.href !== '/' && activePath.startsWith(item.href) ? ' aria-current="page"' : '';
      return `<a href="${item.href}"${current} data-i18n="${item.labelKey}">${t(item.labelKey)}</a>`;
    })
    .join('');

  const drawerHtml = cfg.nav
    .map((item) => {
      const current = item.href !== '/' && activePath.startsWith(item.href) ? ' aria-current="page"' : '';
      return `<a href="${item.href}"${current} data-i18n="${item.labelKey}">${t(item.labelKey)}</a>`;
    })
    .join('');

  host.innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="site-header">
      <a class="site-brand" href="/">
        <span class="mark" aria-hidden="true">${escapeHtml(cfg.mark)}</span>
        <span class="stack">
          <span class="name">${escapeHtml(cfg.brandName)}</span>
          <span class="sub">${escapeHtml(cfg.brandSub)}</span>
        </span>
      </a>
      <nav class="site-nav site-nav-desktop" aria-label="Main">${navHtml}</nav>
      <div class="row gap-2">
        <span id="langHost"></span>
        ${cfg.actionsId ? `<span id="${cfg.actionsId}" class="row gap-2"></span>` : ''}
        <button class="icon-btn nav-toggle" id="navToggle" aria-label="${t('nav.menu')}" aria-expanded="false" aria-controls="navDrawer">
          <span aria-hidden="true">☰</span>
        </button>
      </div>
    </div>
    <div class="drawer-backdrop" id="drawerBackdrop"></div>
    <aside class="drawer" id="navDrawer" aria-label="${t('nav.menu')}">${drawerHtml}</aside>
  `;

  const langHost = host.querySelector<HTMLElement>('#langHost');
  if (langHost) mountLangSwitcher(langHost);

  const toggle = host.querySelector<HTMLButtonElement>('#navToggle')!;
  const drawer = host.querySelector<HTMLElement>('#navDrawer')!;
  const backdrop = host.querySelector<HTMLElement>('#drawerBackdrop')!;

  const setOpen = (open: boolean) => {
    drawer.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };

  toggle.addEventListener('click', () => setOpen(!drawer.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
  });
}
