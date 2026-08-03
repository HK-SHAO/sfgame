// 诊断脚本：复现无头通关 bot，输出飞机轨迹与放置决策
import { LEVEL_1 } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

// 目标巡航/进场高度：略高于崖顶(y=22)，让滑翔下沉正好落进目标带
const TARGET_Y = 13

function botDecide(sim: LevelSimulation) {
  const px = sim.plane.x
  const py = sim.plane.y
  const gy = LEVEL_1.ground(px)

  // 阶段 1：贴地——清理占位旧源，在脚下放热源托举
  if (py > gy - 2.5) {
    const tx = px
    const ty = Math.min(py + 1, gy - 0.7)
    for (const s of [...sim.sources]) {
      if (s.kind === 'hot' && Math.hypot(s.x - tx, s.y - ty) < 3.2) sim.removeSource(s.id)
    }
    if (sim.hotLeft > 0 && sim.canPlaceAt(tx, ty)) {
      sim.placeSource(tx, ty, 'hot')
      console.log(`   -> hot(lift) @ (${tx.toFixed(1)},${ty.toFixed(1)})`)
    } else {
      console.log('   -> lift blocked')
    }
    return
  }

  // 阶段 2：还没到巡航高度——在飞机下方补热源继续爬升
  if (py > TARGET_Y) {
    if (sim.hotLeft === 0) {
      let farthest: { id: number; d: number } | null = null
      for (const s of sim.sources) {
        if (s.kind !== 'hot') continue
        const d = Math.hypot(s.x - px, s.y - py)
        if (d > 8 && (!farthest || d > farthest.d)) farthest = { id: s.id, d }
      }
      if (farthest) {
        sim.removeSource(farthest.id)
        console.log(`   -> recycle hot#${farthest.id}`)
      }
    }
    const candidates = [
      { x: px, y: py + 3.5 },
      { x: px - 2, y: py + 3 },
      { x: px + 2, y: py + 3 },
    ]
    for (const c of candidates) {
      if (sim.hotLeft > 0 && sim.canPlaceAt(c.x, c.y)) {
        sim.placeSource(c.x, c.y, 'hot')
        console.log(`   -> hot(climb) @ (${c.x.toFixed(1)},${c.y.toFixed(1)})`)
        return
      }
    }
    console.log('   -> climb: no placement')
    return
  }

  // 阶段 3：已到巡航高度——停止托举，让谷风护送右行、自然下沉进场
  // 若过高且已接近目标，用冷源轻压；若掉得过低，补一口热
  const goalCX = LEVEL_1.goal.x
  const goalCY = LEVEL_1.ground(goalCX) - 2
  if (py < goalCY - LEVEL_1.goal.r + 1 && px > goalCX - 16) {
    if (sim.coldLeft > 0 && sim.canPlaceAt(px, py - 3)) {
      sim.placeSource(px, py - 3, 'cold')
      console.log(`   -> cold(trim) @ (${px.toFixed(1)},${(py - 3).toFixed(1)})`)
      return
    }
  }
  if (py > goalCY + LEVEL_1.goal.r - 1 && sim.hotLeft > 0) {
    const c = { x: px - 2, y: Math.min(py + 3, LEVEL_1.ground(px - 2) - 0.7) }
    if (sim.canPlaceAt(c.x, c.y)) {
      sim.placeSource(c.x, c.y, 'hot')
      console.log(`   -> hot(save) @ (${c.x.toFixed(1)},${c.y.toFixed(1)})`)
      return
    }
  }
  console.log('   -> glide')
}

const sim = new LevelSimulation(LEVEL_1)
sim.placeSource(16, LEVEL_1.ground(16) - 0.7, 'hot')

let nextDecision = 1.5
for (let t = 0; t < 120; t += DT) {
  sim.step(DT)
  if (sim.phase === 'won') {
    console.log(`WON at t=${t.toFixed(1)}s  plane=(${sim.plane.x.toFixed(1)},${sim.plane.y.toFixed(1)})`)
    break
  }
  if (t % 2 < DT) {
    const air = { x: 0, y: 0 }
    sim.fluid.sampleVelocity(sim.plane.x, sim.plane.y, air)
    console.log(
      `t=${t.toFixed(0).padStart(3)} p=(${sim.plane.x.toFixed(1)},${sim.plane.y.toFixed(1)}) v=(${sim.plane.vx.toFixed(1)},${sim.plane.vy.toFixed(1)}) air=(${air.x.toFixed(1)},${air.y.toFixed(1)}) hot=${sim.hotLeft} cold=${sim.coldLeft} src=${sim.sources.length}`,
    )
  }
  if (t >= nextDecision) {
    nextDecision = t + 1.5
    botDecide(sim)
  }
}
if (sim.phase !== 'won') {
  console.log('NOT WON. final plane:', sim.plane.x.toFixed(1), sim.plane.y.toFixed(1))
}
