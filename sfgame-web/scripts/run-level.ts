/**
 * 无头关卡工具（协议 v1）：
 *   bun run scripts/run-level.ts <关卡.yaml|json> [--sim 秒] [--verify 源列表] [--solve 源数]
 *
 * --sim N      无源跑 N 秒，打印轨迹要点与是否通关
 * --verify     源列表 "x-y-h,x-y-c,…"（h=热 c=冷），跑至通关（上限 120s）并打印通关时刻
 * --solve N    启发式随机搜索 N 个源的最优摆法（预算 30s，可加 --budget-ms），供算法/AI 接入参考
 *
 * 例：
 *   bun run scripts/run-level.ts levels/level-3.yaml --sim 20
 *   bun run scripts/run-level.ts levels/level-3.yaml --verify 26-28-h
 *   bun run scripts/run-level.ts levels/level-5.yaml --solve 2 --budget-ms 20000
 */
import { readFileSync } from 'node:fs'
import { levelFromJson, parseLevelText } from '../src/game/level-format'
import { LevelSimulation } from '../src/game/simulation'

const file = process.argv[2]
if (!file) {
  console.error('用法：bun run scripts/run-level.ts <关卡文件> [选项]')
  process.exit(1)
}
const args = process.argv.slice(3)
const opt = (name: string, def = ''): string => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] ?? def : def
}

const text = readFileSync(file, 'utf8')
const level = levelFromJson(parseLevelText(text))
const SIM_DT = 1 / 60

function simulate(sources: Array<[number, number, string]>, cap: number, dt = SIM_DT) {
  const s = new LevelSimulation(level)
  for (const [x, y, k] of sources) s.placeSource(x, y, k as 'hot' | 'cold')
  let lastX = -99
  for (let t = 0; t < cap; t += dt) {
    s.step(dt)
    if (Math.abs(s.plane.x - lastX) > 12) {
      console.log(
        `  t=${t.toFixed(1)}s x=${s.plane.x.toFixed(1)} y=${s.plane.y.toFixed(1)} 高度=${(level.ground(s.plane.x) - s.plane.y).toFixed(1)} 站点=${s.goalIndex}/${level.goals.length}`,
      )
      lastX = s.plane.x
    }
    if (s.phase === 'won') return { won: true, time: t, goalIndex: s.goalIndex }
  }
  return { won: false, time: -1, goalIndex: s.goalIndex }
}

console.log(`关卡 ${level.id}「${level.name}」 ${level.world.w}×${level.world.h} 预算 热${level.budget.hot}/冷${level.budget.cold}`)

const simCap = Number(opt('--sim', '20'))
if (args.includes('--sim')) {
  const r = simulate([], simCap)
  console.log(r.won ? `无操作：${r.time.toFixed(1)}s 通关` : `无操作：${simCap}s 未通关（站点 ${r.goalIndex}/${level.goals.length}）`)
}

if (args.includes('--verify')) {
  const raw = opt('--verify')
  const sources = raw.split(',').map((part) => {
    const [xs, ys, ks] = part.split('-')
    return [Number(xs), Number(ys), ks === 'c' ? 'cold' : 'hot'] as [number, number, string]
  })
  const r = simulate(sources, 120)
  console.log(r.won ? `解有效：${r.time.toFixed(1)}s 通关` : `解无效：120s 未通关（站点 ${r.goalIndex}/${level.goals.length}）`)
}

if (args.includes('--solve')) {
  const n = Number(opt('--solve', '1'))
  const budgetMs = Number(opt('--budget-ms', '30000'))
  const t0 = performance.now()
  const spots: Array<[number, number, string]> = []
  for (let x = 4; x <= level.world.w - 4; x += 2) {
    for (const dy of [0.7, 8, 16]) {
      const y = Math.max(3, level.ground(x) - dy)
      spots.push([x, y, 'hot'], [x, y, 'cold'])
    }
  }
  const rng = mulberry32(Date.now() >>> 0)
  const fitness = (src: Array<[number, number, string]>): number => {
    const s = new LevelSimulation(level)
    for (const [x, y, k] of src) s.placeSource(x, y, k as 'hot' | 'cold')
    for (let t = 0; t < 60; t += 1 / 30) {
      s.step(1 / 30)
      if (s.phase === 'won') return 1000 - t
    }
    return s.goalIndex * 100
  }
  const best = { src: [] as Array<[number, number, string]>, fit: -1, lastPrint: 0 }
  for (let restart = 0; restart < 50; restart++) {
    let src: Array<[number, number, string]> = []
    for (let i = 0; i < n; i++) src.push(spots[Math.floor(rng() * spots.length)])
    let fit = fitness(src)
    for (let it = 0; it < 200; it++) {
      if (performance.now() - t0 > budgetMs) break
      const next = src.map((s) => [...s] as [number, number, string])
      const which = Math.floor(rng() * next.length)
      const p = spots[Math.floor(rng() * spots.length)]
      next[which] = p
      const nf = fitness(next)
      if (nf >= fit) {
        src = next
        fit = nf
      }
      if (fit > best.fit) {
        best.fit = fit
        best.src = src.map((s) => [...s])
      }
      if (performance.now() - best.lastPrint > 5000) {
        best.lastPrint = performance.now()
        console.log(
          `[solve] ${((performance.now() - t0) / 1000).toFixed(0)}s 最优适配=${best.fit}（${best.fit > 900 ? `通关 ${(1000 - best.fit).toFixed(1)}s 粗估` : `站点 ${Math.floor(best.fit / 100)}/${level.goals.length}`}）`,
        )
      }
    }
  }
  if (best.fit > 0) {
    const fine = simulate(best.src, 120)
    console.log(`[solve] 找到 ${n} 源摆法：${best.src.map((s) => `${s[0]}-${s[1]}-${s[2][0]}`).join(',')} → ${fine.won ? `${fine.time.toFixed(1)}s 通关` : '精验未通（粗筛误差）'}`)
  } else {
    console.log(`[solve] ${((performance.now() - t0) / 1000).toFixed(0)}s 内未找到可通关摆法`)
  }
}

/** 确定性伪随机（搜索用，可复现） */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
