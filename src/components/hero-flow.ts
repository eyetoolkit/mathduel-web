/**
 * 首页 · 记忆点：Hero「算式流动」背景
 * 用真实可解的 24 点算式（而非装饰性乱码）缓慢上浮，
 * 让背景本身就在讲这个游戏的规则——这是本页唯一承担记忆点的元素。
 */

const EXPRESSIONS = [
  '(11 − 3) × 6 ÷ 2',
  '8 ÷ (3 − 8 ÷ 3)',
  '6 × 4 × (3 − 2)',
  '(7 + 5) × (4 − 2)',
  '13 × 2 − 4 ÷ 2',
  '(9 − 1) × (5 − 2)',
  '12 × 2 × (3 − 2)',
  '(10 − 4) × (5 − 1)',
  '7 × 4 − 8 ÷ 2',
  '(13 − 5) × 6 ÷ 2',
];

export function renderHeroFlow(host: HTMLElement | null): void {
  if (!host) return;

  // 尊重动效降级：CSS 已隐藏该层，此处不再生成 DOM，省掉无谓开销
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const frag = document.createDocumentFragment();
  const cols = window.innerWidth < 1024 ? 3 : 5;

  EXPRESSIONS.slice(0, cols * 2).forEach((expr, i) => {
    const el = document.createElement('span');
    el.className = 'fl';
    el.textContent = expr;

    const size = 13 + (i % 4) * 5;                 // 13 → 28px
    const left = ((i * 37) % 92) + 4;               // 4% → 96%
    const dur = 16 + (i % 5) * 3.2;                 // 16 → 29s
    const delay = -(i * 2.4);

    el.style.fontSize = `${size}px`;
    el.style.left = `${left}%`;
    el.style.top = `${60 + (i % 3) * 12}%`;
    el.style.animationDuration = `${dur}s`;
    el.style.animationDelay = `${delay}s`;
    frag.appendChild(el);
  });

  host.appendChild(frag);
}
