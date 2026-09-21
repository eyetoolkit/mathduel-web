# MathDuel 分支与发布规范

采用 **主干开发 + 发布阶段开关（feature flag）+ 环境分层**。
核心原则：**代码同构，配置分环境** —— 同一份代码在不同环境表现不同，
上线新游戏不需要迁移代码，只改一个 `stage` 字段。

---

## 一、分支模型

```
main                     生产环境    mathduel.games
  ▲ 合并（游戏打磨完成）
  │
beta                     测试环境    beta.mathduel.games
  ▲ 合并（自测通过）
  │
game/<slug>              功能分支    <branch>.mathduel-games.pages.dev
```

| 分支 | 用途 | 生命周期 |
|---|---|---|
| `main` | 生产。只接受来自 `beta` 的合并 | 长期 |
| `beta` | 公开测试。接受来自 `game/*` 的合并 | 长期 |
| `game/sudoku` 等 | 单游戏开发 | 合并后删除 |

**分支命名**：`game/<slug>`，如 `game/killer-sudoku`。
slug 需与 `src/pages/home.ts` 中 `GameDef.id` 一致。

---

## 二、环境与域名

| 环境 | 分支 | 访问地址 | `VITE_SHOW_BETA` |
|---|---|---|---|
| 生产 | `main` | https://mathduel.games | 空（不展示 beta 游戏） |
| 测试 | `beta` | https://beta.mathduel.games | `1` |
| 预览 | `game/*` | https://<branch>.mathduel-games.pages.dev | `1` |

> Cloudflare Pages 不支持把自定义域名绑定到非生产分支，
> 因此 `beta` 环境由独立项目 `mathduel-beta` 承载（其生产分支设为 `beta`）。

---

## 三、游戏发布阶段（feature flag）

在 `src/pages/home.ts` 的 `GAMES` 中用 `stage` 标记每款游戏：

| stage | 含义 | 生产可见 | beta 可见 |
|---|---|---|---|
| `live` | 已正式上线 | ✅ | ✅ |
| `beta` | 代码就绪，仍在打磨 | ❌ | ✅ |
| `coming` | 尚未开发 | ❌ | ❌ |

```ts
{
  id: 'sudoku',
  title: 'Sudoku',
  href: '/games/sudoku/',
  stage: 'beta',   // ← 打磨完成后改成 'live' 即上线
}
```

**上线一款游戏 = 把 `stage` 从 `beta` 改成 `live`，推 `main`。**
不需要迁移文件、不需要改构建配置、不需要重新适配样式。

---

## 四、标准流程（以 Sudoku 为例）

```bash
# 1. 开发
git checkout beta
git checkout -b game/sudoku
# ... 写代码 ...
git push -u origin game/sudoku
# → 自动生成预览地址 https://game-sudoku.mathduel-games.pages.dev

# 2. 进入公开测试
git checkout beta && git merge game/sudoku && git push
# → https://beta.mathduel.games 上可玩，收集反馈

# 3. 正式上线
# 编辑 src/pages/home.ts：stage: 'beta' → stage: 'live'
git checkout main && git merge beta && git push
# → https://mathduel.games 自动出现该游戏
```

---

## 五、legacy 目录（过渡期）

`legacy/` 存放尚未用新架构重写的旧站游戏及其运行时
（`shared/*.js`、`i18n`、旧 CSS 等），共 56 个文件约 1.2MB。

- **生产构建不会打进产物**（主站保持 244KB 轻量）
- **仅 `VITE_SHOW_BETA=1` 时**由 `scripts/copy-legacy.mjs` 复制进 `dist`
- 这些页面是自包含的旧站页面，原样发布，不参与 Vite 打包

**每重写完一款游戏，就从 `legacy/games/` 中移除它，并迁入 `src/games/` 新架构。**
全部迁完后删除 `legacy/` 整个目录。

---

## 六、实战案例：bulls（猜数字 1A2B）全流程

已完整跑通一次，可作为后续 4 款游戏的模板。

| 步骤 | 分支 | 提交 | 结果 |
|---|---|---|---|
| 1. 新架构重写 | `game/bulls` | `4617d0e` | 预览地址自动生成 |
| 2. 进入公开测试 | `beta` | `67153bd` | beta.mathduel.games 可玩 |
| 3. 提升上线 | `main` | `80e875c` | mathduel.games 出现该游戏 |

**新增文件**：`src/games/bulls/{engine.ts,index.ts,styles.css}`、`games/bulls/index.html`
**删除**：`legacy/games/bulls`（18KB 旧页面）

关键顺序：**先 `main` 合并 `beta`（拿到新代码），再把 `stage` 改成 `live` 提交。**
反过来的话，`main` 上只有开关没有代码。

### 如何验证"是否真的上线"

首页卡片是**客户端渲染**的，`curl` 首页 HTML 里 grep 不到游戏标题。要验两处：

```bash
# 1. 编译时开关是否被正确内联
curl -s https://mathduel.games/assets/home-*.js | grep -oE 'const v=!{0,1}'
# 主站应为 !1（关），beta 站应为 !0（开）

# 2. 该游戏的 stage 字段
curl -s https://mathduel.games/assets/home-*.js | grep -oE 'href:"/games/bulls/".{0,200}'
# 应含 stage:"live"
```

---

## 七、注意事项

1. **改环境变量后必须重新部署才生效** —— 已有部署不会回溯应用新变量。
2. **`pnpm build` 与 `pnpm build:beta`**：前者按当前环境变量构建，后者强制注入 `VITE_SHOW_BETA=1` 用于本地验证。
3. **不要在 `beta` 上直接改 `stage`** —— 两个分支代码应保持一致，差异只由环境变量决定。
4. **生产存在 SPA fallback**：不存在的路径会返回首页（软 404），
   所以老游戏在生产是"回落首页"而非 404，属于正常隐藏行为。
