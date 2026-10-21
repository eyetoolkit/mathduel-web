# tri-sites 共享 i18n 运行时（单一真相源）

本目录是三站（mathduel / boardduel / memoryduel）i18n 运行时的**唯一来源**。
boardduel 与 memoryduel 通过 `scripts/sync-i18n.mjs` 把这里的两个文件复制到各自的
`public/i18n/`，**禁止在站点本地手动修改副本**——要改就改这里，再跑同步。

## 文件
- `i18n.js`        —— 运行时核心：`t()` / `setLang()` / `applyToDOM()` / `renderError()` / `LITERALS` 兜底 / `MutationObserver` 等。
- `lang-switcher.js` —— 语言切换下拉，只渲染运行时实际支持的语言。

## 默认行为（安全）
- `SUPPORTED` 默认仅 `["en"]` → **多语言关闭**，线上行为零变化、可一键回滚。
- 字典默认运行时 `fetch('/i18n/{lang}.json?v={DICT_VERSION}')`。

## 各站如何开启多语言（不改本共享文件）
在站点 HTML `<head>`（早于 `<script src="/i18n/i18n.js">`）注入：
```html
<script>
  window.__I18N_CONFIG__ = {
    supported: ['en', 'zh', 'ja', 'es', 'fr', 'de'], // 该站实际翻译好的语言
    defaultLang: 'en',
    dictVersion: '33'   // 字典更新时 bump，作为 cache-buster
  };
</script>
```
切换器只需在页面放一个挂载点 `<div id="lang-switcher"></div>` 并引入 `lang-switcher.js`。

## 升级路径：构建期注入字典（跳过 fetch）
若未来想消除运行时的网络拉取，可在构建产物里先于 `i18n.js` 注入：
```html
<script>window.__I18N_DICTS__ = { en: {...}, zh: {...} /* 由构建流程填充 */ };</script>
```
运行时检测到 `window.__I18N_DICTS__[lang]` 会直接使用，不再 `fetch`。

## 同步与校验
```bash
cd mathduel-web/vendor/tri-design-system
node scripts/sync-i18n.mjs --check   # 校验三站副本是否与源一致
node scripts/sync-i18n.mjs           # 推送到各站 public/i18n/
node scripts/test-i18n-runtime.cjs   # 行为级回归测试
```

## 路由
语言优先级：`?lang=` > `/xx/` 路径前缀 > `localStorage` > 默认。
路径前缀与 SEO `hreflang` 声明应保持一致（开启多语言时务必同步更新 hreflang）。
