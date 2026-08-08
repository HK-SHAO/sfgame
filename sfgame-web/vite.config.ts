import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  build: {
    // Safari 不消费 modulepreload 缓存并误报 "preloaded but not used"，禁用注入
    modulePreload: false,
    rollupOptions: {
      output: {
        // 第三方稳定 chunk：lit 体积大且全组件共享，独立成块利于浏览器缓存命中
        manualChunks(id) {
          if (id.includes('node_modules/lit') || id.includes('node_modules/@lit')) {
            return 'vendor-lit'
          }
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
