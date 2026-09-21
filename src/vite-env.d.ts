/// <reference types="vite/client" />

/**
 * 构建期注入的环境变量（Cloudflare Pages 按环境分别配置）
 *
 * VITE_SHOW_BETA = '1'  →  beta / preview 环境：展示处于 beta 阶段的游戏
 * 未设置或为其他值      →  生产环境：只展示已正式上线的游戏
 *
 * 这是「同一份代码、不同环境不同表现」的 feature flag：
 * 上线新游戏 = 把 stage 从 'beta' 改成 'live'，不需要迁移代码。
 */
interface ImportMetaEnv {
  readonly VITE_SHOW_BETA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
