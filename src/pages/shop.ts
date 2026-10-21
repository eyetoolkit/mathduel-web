/* ═══════════════════════════════════════════════════════════════
   NumeriDuel · Coin Shop（P1：金币消耗口）
   ────────────────────────────────────────────────────────────────
   商店页：拉 catalog + 余额 + 已拥有 + 当前激活，按 kind 分区渲染，
   购买 / 激活走 src/shared/coins.ts 封装的服务端端点（单一真相源，
   本地不写余额、不写所有权）。匿名态可浏览目录，购买/激活降级为「登录解锁」。
   装饰的实际渲染生效（头像显示在主页/对局、emoji 反应可用）是 P1-b 下一刀，
   本页先把「买得到、激活得了、拥有即显示已拥有」闭环跑通。
   ═══════════════════════════════════════════════════════════════ */
import './shop.css';
import { i18nT, onI18nChange } from '../games/_shared/i18n-t';
import {
  shopCatalog, shopBuy, shopActivate,
  type ShopItem, type ShopCatalogData,
  CoinsError,
} from '../shared/coins';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

/* ─── 状态 ───
 * catalog 为 null 前，购买/激活按钮一律 disabled（避免匿名误点打到 401）。
 * authed：catalog.balance>0 或服务端返回了非空 active → 视为登录态可操作。 */
let catalog: ShopCatalogData | null = null;
let busyId: string | null = null;

function isAuthed(): boolean {
  if (!catalog) return false;
  // catalog 匿名态 balance:0 + active:null；登录态通常有余额或已激活物
  const hasBalance = typeof catalog.balance === 'number' && catalog.balance > 0;
  const hasActive = catalog.active != null && Boolean(catalog.active.avatar || catalog.active.emoji);
  return hasBalance || hasActive;
}

function ownedSet(): Set<string> {
  const set = new Set(catalog?.owned ?? []);
  return set;
}

/* ─── 商品卡渲染 ─── */
function itemCard(item: ShopItem, active: boolean): HTMLElement {
  const owned = ownedSet().has(item.id);
  const authed = isAuthed();

  let action: string;
  if (owned) {
    // 已拥有 → 激活 / 已激活 两态
    const label = active ? i18nT('mp.mp_shop_active') : i18nT('mp.mp_shop_activate');
    action = `<button type="button" class="sh-act ${active ? 'is-active' : ''}" data-item="${esc(item.id)}" data-kind="${esc(item.kind)}" ${active ? 'disabled' : ''}>${esc(label)}</button>`;
  } else if (item.cost === 0) {
    // 免费默认头像：登录即拥有（服务端 normalize 已补全），可直接激活
    action = `<button type="button" class="sh-act is-free" data-item="${esc(item.id)}" data-kind="${esc(item.kind)}" ${authed ? '' : 'disabled'}>${esc(i18nT('mp.mp_shop_activate'))}</button>`;
  } else {
    // 未拥有 → 购买；余额不足显示缺口，匿名显示登录解锁
    // 🔴 缺口文案用 i18nT(key, vars) 即时翻译，**绝不挂 data-i18n 属性**——
    //    这是 JS 动态 innerHTML 节点，MutationObserver 60ms 后会把写死的值篡回（红线 #155）。
    //    切语言时由 onI18nChange → renderGrids() 整块重渲，文案自然换成目标语言。
    const gap = Math.max(0, item.cost - (catalog?.balance ?? 0));
    const affordHint = gap > 0 ? `<small class="sh-gap">${esc(i18nT('mp.mp_shop_gap', { n: gap }))}</small>` : '';
    action = `<button type="button" class="sh-act" data-item="${esc(item.id)}" data-kind="${esc(item.kind)}" ${authed ? '' : 'disabled'}><span class="sh-price num">🪙 ${esc(item.cost)}</span>${affordHint}</button>`;
  }

  const el = document.createElement('div');
  el.className = 'sh-item' + (owned ? ' owned' : '') + (active ? ' active' : '');
  el.innerHTML =
    `<span class="sh-icon">${esc(item.icon)}</span>` +
    `<span class="sh-name">${esc(item.name)}</span>` +
    action;
  return el;
}

function renderGrids(): void {
  if (!catalog) return;
  const avatars = catalog.catalog.filter((i) => i.kind === 'avatar');
  const emojis = catalog.catalog.filter((i) => i.kind !== 'avatar');
  const gAv = $('gridAvatars') as HTMLElement;
  const gEm = $('gridEmojis') as HTMLElement;
  const kAv = $('shopAvatars') as HTMLElement;
  const kEm = $('shopEmojis') as HTMLElement;

  gAv.textContent = '';
  gEm.textContent = '';
  for (const it of avatars) gAv.appendChild(itemCard(it, catalog.active?.avatar === it.id));
  for (const it of emojis) gEm.appendChild(itemCard(it, catalog.active?.emoji === it.id));

  // 某分区为空时隐藏（避免空标题）
  kAv.hidden = avatars.length === 0;
  kEm.hidden = emojis.length === 0;
}

/* ─── 主加载 ─── */
async function loadCatalog(): Promise<void> {
  const card = $('shopCard') as HTMLElement;
  const anon = $('shopAnon') as HTMLElement;
  const off = $('shopOffline') as HTMLElement;
  const balEl = $('shopBal') as HTMLElement;

  card.hidden = true;
  anon.hidden = true;
  off.hidden = true;

  try {
    const data = await shopCatalog();
    catalog = data;
    balEl.textContent = String(data.balance ?? 0);

    if (isAuthed()) {
      card.hidden = false;
    } else {
      // 匿名：可浏览目录（展示商品与价格），但购买/激活按钮 disabled + 显示登录引导
      card.hidden = false;
      anon.hidden = false;
    }
    renderGrids();
    applyI18nGrids();
  } catch (e) {
    catalog = null;
    off.hidden = false;
    balEl.textContent = '—';
  }
}

/* ─── i18n 对动态写入节点补位（红线 #155：onI18nChange 必须覆盖全部运行时节点） ───
 * itemCard 的静态文案（activate/active）走 i18nT 已即时翻译；
 * 但缺口提示用了 data-i18n-html，i18n.js 的 MutationObserver 不会碰 JS 动态节点 ——
 * 这里切语言后手动重渲一遍目录，把缺口文案换成目标语言。 */
function applyI18nGrids(): void {
  if (!catalog) return;
  renderGrids();
}

/* ─── 购买 / 激活（事件委托） ─── */
function bindActions(): void {
  const card = $('shopCard') as HTMLElement;
  card.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.sh-act');
    if (!btn || btn.disabled || busyId) return;
    const id = btn.getAttribute('data-item');
    const kind = btn.getAttribute('data-kind') as 'avatar' | 'emoji' | null;
    if (!id || !kind || !catalog) return;

    busyId = id;
    btn.classList.add('is-busy');
    void (async () => {
      const owned = ownedSet().has(id);
      let actionErr: unknown = null;
      try {
        if (owned) {
          // 已拥有 → 激活
          await shopActivate(kind, id);
        } else {
          // 未拥有 → 购买（服务端幂等：already_owned 会抛错）
          await shopBuy(id);
        }
        // 成功后刷新目录（balance/owned/active 全变）
        await loadCatalog();
      } catch (e) {
        actionErr = e;
      } finally {
        busyId = null;
      }
      // 统一处理：任何结果（成功/业务错/网络错/未知）都重拉目录对齐状态，
      // 避免按钮卡死或「已拥有」态不同步。成功时上面的 loadCatalog 已刷新，
      // 这里按 error 类型决定是否再刷一次。
      if (actionErr instanceof CoinsError) {
        switch (actionErr.code) {
          case 'already_owned':
          case 'not_owned':
          case 'kind_mismatch':
          case 'insufficient_coins':
            // 业务错：重拉目录让「已拥有/余额不足」状态对齐，不弹报错
            await loadCatalog();
            break;
          case 'not_authenticated':
          case 'network':
            // 匿名/服务不可达：清本地缓存重新降级
            catalog = null;
            await loadCatalog();
            break;
          default:
            // 其它（http_400 no_such_item 等）→ 静默重拉目录兜底
            await loadCatalog();
        }
      } else if (actionErr) {
        // 未知异常：同样重拉目录兜底
        await loadCatalog();
      }
      // 成功路径 actionErr==null，loadCatalog 已在 try 内跑过，不再重复
    })();
  });
}

/* ─── 启动 ─── */
bindActions();
void loadCatalog();
onI18nChange(() => {
  applyI18nGrids();
});
