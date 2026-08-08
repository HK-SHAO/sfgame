import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // Safari 不消费 modulepreload 缓存并误报 "preloaded but not used"；本项目单入口小图，
    // 禁用注入消除该警告，代价可忽略
    modulePreload: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
