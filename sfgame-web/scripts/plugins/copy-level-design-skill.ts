// skills/level-design 随包发布：线上站点直接分发关卡创作指南
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

export function copyLevelDesignSkill(): Plugin {
  return {
    name: 'copy-level-design-skill',
    apply: 'build',
    closeBundle() {
      const to = resolve('dist/skills/level-design')
      mkdirSync(dirname(to), { recursive: true })
      cpSync(resolve('../skills/level-design'), to, { recursive: true })
    },
  }
}
