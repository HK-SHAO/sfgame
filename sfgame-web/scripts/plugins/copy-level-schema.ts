// 关卡 schema 随包发布：构建后拷到 dist 根（关卡 $schema 绝对 URL https://sf.game.shao.fun/level.schema-1.json 的部署解析目标）
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

export function copyLevelSchema(): Plugin {
  return {
    name: 'copy-level-schema',
    apply: 'build',
    closeBundle() {
      const to = resolve('dist/level.schema-1.json')
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(resolve('levels/level.schema-1.json'), to)
    },
  }
}
