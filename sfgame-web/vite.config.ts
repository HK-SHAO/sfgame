import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import { mdUtf8 } from './scripts/vite-plugins/md-utf8.ts'
import { wasmRebuild } from './scripts/vite-plugins/wasm-rebuild.ts'

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  plugins: [
    wasmRebuild(),
    mdUtf8(),
    // SW 源码在 app/sw.ts（injectManifest 模式，TS 经 Vite 构建为 classic sw.js）：
    // 预缓存清单构建期注入、版本化清理随 activate 自动发生；manifest/图标沿用 public/ 原文件
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'app',
      filename: 'sw.ts',
      registerType: 'prompt',
      manifest: false,
      injectManifest: {
        rollupFormat: 'iife',
        globPatterns: ['**/*'],
        globIgnores: ['**/_headers', '**/_redirects', '**/sw.js'],
      },
    }),
  ],
  build: {
    minify: true,
    // Safari 不消费 modulepreload 缓存并误报 "preloaded but not used"，禁用注入
    modulePreload: false,
    rollupOptions: {
      output: {
        // 应用代码总量不大（~150KB），全部内联单 bundle：零碎片零请求开销，
        // 无需分包/提前加载（dev/storage 等低频页也随包，成本可忽略）
        codeSplitting: false,
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
