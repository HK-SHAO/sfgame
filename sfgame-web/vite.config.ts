import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  build: {
    // Safari 不消费 modulepreload 缓存并误报 "preloaded but not used"，禁用注入
    modulePreload: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
