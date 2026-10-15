/**
 * 共享 i18n 取值出口（P1-3，2026-10-15）
 * ----------------------------------------------------------------
 * 背景：5 个游戏入口各自复制了一份完全相同的 `i18nT` 包装（24-game /
 * equation-pyramid / sudoku / sudoku-4x4 / sudoku-6x6），连 fallback 链都一样。
 * 复制粘贴的代价是：改一处 fallback 行为要同步改 5 个文件，漏一个就出现
 * 「有的游戏切语言生效、有的不生效」。
 *
 * 现在统一从这里取。fallback 链（按优先级）：
 *   1. window.i18n.t(key, vars)      —— design-system 注入的主字典
 *   2. window.t(key, vars)           —— 页面全局别名
 *   3. key 本身                       —— 最后兜底，至少能看出是哪个键缺
 *
 * ⚠️ 缺键会静默显示 key 名（如 `mp.dlg_offline`），所以新增文案后
 *    必须跑 `npm run check:i18n` 确认 key 在 6 个语言里都齐。
 */

/** 变量表：值允许 string / number，模板内用 {name} 占位。 */
export type I18nVars = Record<string, string | number>;

type I18nLike = { t: (k: string, v?: I18nVars) => string };

function resolveI18n(): I18nLike | null {
  const w = window as unknown as {
    i18n?: I18nLike;
    t?: (k: string, v?: I18nVars) => string;
  };
  if (w.i18n && typeof w.i18n.t === 'function') return w.i18n;
  if (typeof w.t === 'function') return { t: w.t };
  return null;
}

/**
 * 取一条本地化文案。
 * @param key  字典键，如 `mp.dlg_offline`
 * @param vars 插值变量，如 `{ n: 3 }`
 */
export function i18nT(key: string, vars?: I18nVars): string {
  try {
    const i = resolveI18n();
    if (i) return i.t(key, vars);
  } catch {
    /* 字典还没注入（极早期）→ 落到 key 兜底 */
  }
  return key;
}

/** 同 i18nT，语义化别名：显式表达「这是句号/按钮之类的短标签」。 */
export const t = i18nT;

/**
 * 取当前语言代码（'en' / 'zh' / 'ja' / 'es' / 'fr' / 'de'）。
 * 字典还没就绪时回落到 <html lang>，再兜底 'en'。
 *
 * 🔴 不要在别处直接写 `window.i18n.getLang()` —— window 上没有该类型的
 *    声明，TS 会报 TS2339。各页面一律从这里取。
 */
export function i18nLang(): string {
  const w = window as unknown as { i18n?: { getLang?: () => string | null } };
  const fromI18n = w.i18n?.getLang?.();
  if (fromI18n) return fromI18n;
  return document.documentElement.lang || 'en';
}

/**
 * 把语言代码映射到 BCP-47 locale，给 `toLocaleDateString` 之类用。
 * 纯机械映射，没有语言专属文案，不需要进字典。
 */
export function i18nLocale(): string {
  const map: Record<string, string> = {
    en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
  };
  return map[i18nLang()] || 'en-US';
}

/**
 * 判断 i18n **字典是否已真正加载**（而不是「API 是否存在」）。
 * ----------------------------------------------------------------
 * 🔴 这是本文件最大的坑，务必记住：
 *   `i18n.js` 在解析时就把 `window.i18n = { t, setLang, ... }` 挂出来了，
 *   而 `window.i18n.t` 内部依赖的 `dicts[lang]` 是之后才 async fetch 进来的。
 *   所以「`window.i18n.t` 是个函数」完全不代表「能查到文案」——
 *   字典没到时 t() 会一路 fallback 到 `return key`。
 *
 *   早期版 onI18nReady 就是用 `if (resolveI18n()) cb()` 判就绪的，
 *   于是它在字典到达前就 return 了，后面注册的 i18n:ready 监听也从不触发 ——
 *   表现是「onI18nReady 写了、事件也派了、但重渲染一次都没发生」。
 *
 *   正确判据：拿一个**必然存在于每种语言**的键去实测能否翻出来。
 */
const PROBE_KEY = 'common.loading';

export function i18nDictReady(): boolean {
  try {
    const i = resolveI18n();
    if (!i) return false;
    const out = i.t(PROBE_KEY);
    return typeof out === 'string' && out.length > 0 && out !== PROBE_KEY;
  } catch {
    return false;
  }
}

/**
 * 等待 i18n 字典注入完成。
 * ----------------------------------------------------------------
 * 🔴 为什么需要（RULES-FE-D #90 的延伸）：
 *   `i18n.js` 是 async fetch 字典后再替换 DOM，事件是 `i18n:ready`。
 *   页面脚本（type=module）是 defer 语义，**很可能先于 fetch 完成**跑完。
 *   此时调 i18nT() 会回落到 key 本身，于是玩家看到的是 `mg.lb_local_api`
 *   这种原始键名，而且它已经写进了 innerHTML —— 之后 i18n.js 只处理
 *   data-i18n* 属性，不会回头修这些 JS 生成的节点，于是**永久残留**。
 *
 *   正确姿势：凡是「用 i18nT() 拼 innerHTML / textContent」的渲染，
 *   都要挂到 onI18nReady() 上（或在 ready 后重渲一次）。
 */
export function onI18nReady(cb: () => void): void {
  if (i18nDictReady()) {
    // 字典已就绪（可能是 SPA 内二次进入，或同步注入的 PRELOADED 路径）
    cb();
    return;
  }
  let done = false;
  const fire = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('i18n:ready', fire);
    cb();
  };
  // 🔴 必须监听 window：i18n.js 里是 `window.dispatchEvent(...)`，
  //    CustomEvent 不会从 window 向下冒泡到 document，挂在 document 上永远收不到。
  window.addEventListener('i18n:ready', fire);
  // 兜底：如果 i18n.js 因网络/解析失败永远不派发 ready，3 秒后仍然渲染，
  // 否则页面会彻底空白（i18nT 的 key 兜底至少还能看出是哪个键）。
  setTimeout(fire, 3000);
}

/**
 * 订阅「语言发生变化」，用于动态渲染区域在玩家中途切语言后重绘。
 * ----------------------------------------------------------------
 * 🔴 为什么必须单独订阅 change 而不只是 ready：
 *   `data-i18n*` 静态骨架 i18n.js 会自动重写，但**用 i18nT() 写进
 *   innerHTML / textContent 的动态节点**它管不到 —— 玩家在榜单页切到
 *   中文，静态标题变了、动态表格还停在英文，看起来就是「切换失灵」。
 *
 * @param cb 触发回调
 * @param alsoReady  true 时首次字典就绪也触发一次（默认 true）——
 *                   字典就绪前那一帧渲染出来的是 key，必须补一次。
 */
export function onI18nChange(cb: () => void, alsoReady = true): void {
  window.addEventListener('i18n:change', cb);
  if (alsoReady) onI18nReady(cb);
}

/**
 * HTML 转义 —— 用于「把 i18nT() 的结果拼进 innerHTML」的场景。
 * ----------------------------------------------------------------
 * 🔴 为什么放在这个文件：i18nT() 的返回值会进 innerHTML（banner、榜单、侧栏…），
 *   而词典里存在 `<b>`、`&`、引号等字符（如 `mg.g24_share_scan_html`）。
 *   各游戏原本要么手写一份 escapeHtml、要么干脆不转义。
 *   不转义的后果分两层：
 *     1. 含 `&` 的译文（法/德语极常见，如 "Statisch & schnell"）会渲染成空白；
 *     2. 含 `<`/`>` 的译文会破坏 DOM 结构。
 */
export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

/**
 * 判断某个键在当前语言下是否有真实译文（而非 fallback 到 key 本身）。
 * 用于自检脚本：切换语言后扫 DOM，若某处文本 === 它的 key，说明该键缺翻译。
 */
export function hasTranslation(key: string): boolean {
  const out = i18nT(key);
  return out !== key && out.length > 0;
}
