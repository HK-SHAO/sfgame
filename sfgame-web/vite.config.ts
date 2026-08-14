import { defineConfig } from 'vitest/config'
import { copyLevelDesignSkill } from './scripts/plugins/copy-level-design-skill.ts'
import { copyLevelSchema } from './scripts/plugins/copy-level-schema.ts'
import { wasmRebuild } from './scripts/plugins/wasm-rebuild.ts'

export default defineConfig({
  // 相对路径部署（itch.io 等子路径托管）：HTML/CSS/JS 资源引用全部相对化
  base: './',
  plugins: [wasmRebuild(), copyLevelSchema(), copyLevelDesignSkill()],
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
