// 一次性调参扫描：在「不改地图/道具位置」约束下找出破坏挂机通关的参数组合（红线自查辅助）
import { readFileSync } from 'node:fs'
import { evalCandidate, FINE_DT, initBackend, type SourceTuple } from './solve-lib.ts'
import { levelFromJson } from '../app/game/level-format.ts'

await initBackend()

function afkWon(path: string, mut: (j: any) => void): { won: boolean; time: number } {
  const j = JSON.parse(readFileSync(path, 'utf8'))
  mut(j)
  const level = levelFromJson(j)
  const m = evalCandidate(level, [] as SourceTuple[], { dt: FINE_DT, cap: 150 })
  return { won: m.won, time: m.time }
}

console.log('== L13 疾摆（基线挂机通关）==')
for (const temp of [-0.1, -0.15, -0.2, -0.3]) {
  for (const power of [42, 30, 20]) {
    const r = afkWon(`${import.meta.dir}/../levels/level-13.json`, (j) => {
      j.ambient.temp = temp
      j.fans[0].power = power
    })
    console.log(`temp=${temp} fan=${power} → ${r.won ? `挂机 ${r.time.toFixed(1)}s 通关` : '挂机不通关'}`)
  }
}

console.log('== L14 灼原（基线挂机通关）==')
for (const temp of [0.22, 0.35, 0.5, 0.7]) {
  for (const power of [22, 14, 8]) {
    const r = afkWon(`${import.meta.dir}/../levels/level-14.json`, (j) => {
      j.ambient.temp = temp
      j.fans[0].power = power
    })
    console.log(`temp=${temp} fan=${power} → ${r.won ? `挂机 ${r.time.toFixed(1)}s 通关` : '挂机不通关'}`)
  }
}
