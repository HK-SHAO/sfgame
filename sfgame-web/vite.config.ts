import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// 关卡 JSON 经 ?raw 内联进 bundle 不进 dist；schema 是随包发布的协议规范，
// 拷到 dist 根（关卡文件相对引用 ./level.schema.json 的部署解析目标）
function copyLevelSchema(): Plugin {
  return {
    name: 'copy-level-schema',
    apply: 'build',
    closeBundle() {
      const to = resolve('dist/level.schema.json')
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(resolve('levels/level.schema.json'), to)
    },
  }
}

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  plugins: [copyLevelSchema()],
  build: {
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
