import { defineConfig } from 'vitest/config'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** 把 levels/*.yaml 以原始文本注入虚拟模块 `virtual:levels`（dev/build/test 共用）。
 * 关卡 YAML 是唯一事实来源；TypeScript 侧只看到 Record<文件名, 文本>。 */
function levelYamlPlugin(): Plugin {
  const dir = fileURLToPath(new URL('./levels', import.meta.url))
  return {
    name: 'sfgame-levels-yaml',
    resolveId(id) {
      if (id === 'virtual:levels') return '\0virtual:levels'
    },
    load(id) {
      if (id !== '\0virtual:levels') return
      const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()
      const entries = files.map(
        (f) => `${JSON.stringify(f)}: ${JSON.stringify(readFileSync(`${dir}/${f}`, 'utf8'))}`,
      )
      return `export const LEVEL_TEXTS = { ${entries.join(', ')} }`
    },
  }
}

export default defineConfig({
  plugins: [levelYamlPlugin()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
