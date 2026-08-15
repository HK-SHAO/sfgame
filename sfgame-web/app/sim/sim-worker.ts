// 模拟 worker：LevelSimulation + 示踪 + 云 + 拖尾 + 风采样 + 落地判定整体迁入。
// 主线程只发消息、收帧快照渲染；引擎内存为共享内存（SAB，见 scripts/patch-shared.ts 注入）——
// 示踪粒子/流体场的零拷贝视图经 ready 的 sab 转移给主线程直读，快照不再搬运大数组。
// 引擎实例跨关卡复用：fluid_init 全量复位已保证安全（engine-reuse.test 钉死），load 只重建模拟对象。
// 消息处理在 wasm 引导完成前即可注册：load 恒为第一条消息，await 引擎就绪后按序消费（队列 FIFO 不丢消息）
import engineUrl from '../wasm/sfengine.wasm?url'
import { bootEngine, createEngine, type EngineHandle } from '../wasm/engine.ts'
import { LevelSimulation } from '../game/simulation.ts'
import { levelFromJson } from '../game/level-format.ts'
import { resolveLevel, levelSeed } from '../game/levels.ts'
import { Tracers, TRAIL_LEN } from './particles.ts'
import { Clouds } from './clouds.ts'
import { PLANE_TRAIL_FADE, Trail } from './trail.ts'
import { buildWindProbes, isLanding, sampleWind } from '../core/wind.ts'
import { FLUID_MARGIN } from './terrain.ts'
import { totalPenaltySeconds } from '../game/timer.ts'
import type { Source } from '../game/types.ts'
import type { SimRequest, SimEvent, FrameSnapshot, PlaneTrailView } from './worker-protocol.ts'
import { TRACER_COUNT } from './worker-protocol.ts'

const PLANE_TRAIL_MAX_SPEED = 30
const PLANE_TRAIL_SAMPLE = 0.3
const PLANE_TRAIL_MAX_POINTS = Math.ceil((PLANE_TRAIL_MAX_SPEED * PLANE_TRAIL_FADE) / PLANE_TRAIL_SAMPLE)
// 落地音节流（墙钟）：连续落地不叠音（同原 controller 逻辑）
const LAND_SOUND_MIN_INTERVAL = 150

// worker 全局 postMessage：DOM lib 把 self 按 Window 键入（签名带 targetOrigin），窄化为专用口
const post = (msg: SimEvent, transfer?: Transferable[]) =>
  (self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void }).postMessage(msg, transfer)

let engine: EngineHandle
let sim: LevelSimulation
let tracers: Tracers
let clouds: Clouds
let planeTrail: Trail
let windProbes: { x: number; y: number }[]
let lastPhase: 'playing' | 'won' = 'playing'
let lastHudKey = ''
let lastLand = -Infinity
const tmpAir = { x: 0, y: 0 }
const windSample = { field: 0, rel: 0 }

const enginePromise = bootEngine(async () => {
  const res = await fetch(engineUrl)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}).then((ok) => {
  if (!ok) throw new Error('sim worker: wasm 加载失败')
  return createEngine()
})

self.addEventListener('message', (e: MessageEvent<SimRequest>) => {
  void (async () => {
    try {
      engine = await enginePromise
      switch (e.data.t) {
        case 'load':
          loadLevel(e.data)
          break
        case 'tick':
          tick(e.data.dt)
          break
        case 'place':
          place(e.data)
          break
        case 'remove':
          remove(e.data.id)
          break
        case 'applySources':
          applySources(e.data.list)
          break
        case 'restart':
          restart()
          break
        case 'pause':
          setPaused(e.data.v)
          break
      }
    } catch (err) {
      // 冒泡为未捕获异常 → 主线程 worker.onerror 停机（无回退路径，见 controller）
      setTimeout(() => {
        throw err
      })
    }
  })()
})

function loadLevel(m: Extract<SimRequest, { t: 'load' }>) {
  const level = m.json ? levelFromJson(m.json, true) : resolveLevel({ id: m.levelId })
  if (!level) throw new Error(`sim worker: 关卡 ${m.levelId} 不可用`)
  const world = level.world
  sim = new LevelSimulation(level, engine, { unlimited: m.unlimited ?? false })
  tracers = new Tracers(
    engine, TRACER_COUNT, world, sim.terrain, TRAIL_LEN, FLUID_MARGIN,
    levelSeed(level.id, 0x85ebca6b),
  )
  clouds = new Clouds(levelSeed(level.id), world, sim.terrain)
  planeTrail = new Trail(PLANE_TRAIL_MAX_POINTS, PLANE_TRAIL_SAMPLE, PLANE_TRAIL_FADE)
  windProbes = buildWindProbes(world.w, world.h)
  lastPhase = 'playing'
  lastHudKey = ''
  lastLand = -Infinity
  // 地形场独立副本可转移：sim 物理仍持有原场（转移会 detach 视图）。
  // sab 是 engine.memory.buffer 的一次性视图（该访问每次返回新对象）：转移它不影响
  // 实例与 Tracers 内部已建的视图（同一 SAB 底层，共享语义）；主线程用 batch 实例
  // 的导出地址在同一块内存上自建零拷贝视图
  const field = new Float32Array(sim.terrain.field)
  post({
    t: 'ready',
    terrain: {
      nx: sim.terrain.nx,
      ny: sim.terrain.ny,
      cell: sim.terrain.cell,
      originX: sim.terrain.originX,
      originY: sim.terrain.originY,
      field,
    },
    world,
    goals: level.goals.map((g, i) => ({ x: g.x, r: g.r, anchorY: sim.goalAnchorY[i] })),
    fixedSources: sim.fixedSources.map(toSourceView),
    fans: sim.fans,
    // 引擎内存已注入 shared 位（scripts/patch-shared.ts），运行时必为 SAB；TS 类型面仍按
    // WebAssembly.Memory.buffer 报 ArrayBuffer，窄化仅作类型断言。
    // SAB 不能进 transfer list（DataCloneError）：结构化克隆对共享内存走共享引用分支，
    // 作为消息字段直接传递即零拷贝——transfer 只负责地形场的独立副本
    sab: engine.memory.buffer as unknown as SharedArrayBuffer,
  }, [field.buffer])
  maybeHud()
}

const toSourceView = (s: Source) => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, born: s.born, wallBorn: s.wallBorn })

function tick(dt: number) {
  const t0 = performance.now()
  const frozen = sim.paused || sim.phase === 'won'
  const visitedBefore = sim.visitedCount
  if (!frozen) {
    const p = sim.plane
    const altBefore = sim.terrain.sample(p.x, p.y)
    const vyBefore = p.vy

    sim.step(dt)
    tracers.step(dt, sim.sources)
    clouds.step(dt, sim.fluid)
    planeTrail.push(p.x, p.y, sim.time)

    sampleWind(sim.fluid, windProbes, p, tmpAir, windSample)
    post({ t: 'wind', field: windSample.field, rel: windSample.rel, px: p.x })
    const altAfter = sim.terrain.sample(p.x, p.y)
    if (isLanding(altBefore, altAfter, vyBefore)) {
      const now = performance.now()
      if (now - lastLand > LAND_SOUND_MIN_INTERVAL) {
        lastLand = now
        post({ t: 'land', intensity: Math.abs(vyBefore) })
      }
    }
  }
  if (sim.visitedCount > visitedBefore) {
    post({ t: 'visited', won: sim.phase === 'won' })
  }
  if (sim.phase !== lastPhase) {
    lastPhase = sim.phase
    post({ t: 'phase', phase: sim.phase, won: sim.phase === 'won' })
  }
  maybeHud()
  const snapshot = buildSnapshot()
  snapshot.tickMs = performance.now() - t0
  post({ t: 'frame', snapshot })
}

function place(m: Extract<SimRequest, { t: 'place' }>) {
  const source = sim.placeSource(m.x, m.y, m.kind)
  if (source) {
    post({ t: 'placed', kind: m.kind })
    postSources()
    maybeHud()
  } else {
    post({ t: 'deny', kind: m.kind, clientX: m.clientX, clientY: m.clientY })
  }
}

function remove(id: number) {
  if (sim.removeSource(id)) {
    post({ t: 'removed' })
    postSources()
    maybeHud()
  }
}

// 原 controller.applySources 的获胜态复位也随迁（sim 状态只在 worker）：
// URL 恢复/重排时重开一局（phase→playing、visited 清零、解除暂停）
function applySources(list: { x: number; y: number; kind: 'hot' | 'cold' }[]) {
  if (sim.phase === 'won') {
    sim.phase = 'playing'
    sim.visited.fill(false)
    sim.visitedCount = 0
    sim.setPaused(false)
    lastPhase = 'playing'
  }
  sim.applySources(list)
  postSources()
  maybeHud()
}

function restart() {
  sim.restart()
  planeTrail.clear()
  lastPhase = 'playing'
  lastLand = -Infinity
  maybeHud()
}

function setPaused(v: boolean) {
  sim.setPaused(v)
  maybeHud()
}

// hud 只发静态字段变化（phase/预算/源数/暂停）：时间与罚时随帧快照走（onStatus 渲染驱动）
function maybeHud() {
  const s = sim.hudState()
  const key = `${s.phase}|${s.hotLeft}|${s.coldLeft}|${s.sources}|${s.paused}`
  if (key !== lastHudKey) {
    lastHudKey = key
    post({ t: 'hud', state: s })
  }
}

function postSources() {
  post({ t: 'sources', list: sim.sources.map((s) => ({ x: s.x, y: s.y, kind: s.kind })) })
}

// 快照瘦身：流体场/示踪大数组经 SAB 由主线程直读，此处只发每帧动态标量与 JS 侧状态
function buildSnapshot(): FrameSnapshot {
  return {
    clouds: {
      count: clouds.count,
      x: Float32Array.from(clouds.x),
      y: Float32Array.from(clouds.y),
      radius: Float32Array.from(clouds.radius),
      alpha: Float32Array.from(clouds.alpha),
      seed: Float32Array.from(clouds.seed),
    },
    planeTrail: buildPlaneTrailView(),
    plane: { x: sim.plane.x, y: sim.plane.y, angle: sim.plane.angle },
    sources: sim.sources.map(toSourceView),
    visited: sim.visited.slice(),
    time: sim.time,
    extra: totalPenaltySeconds(sim.sources.length, sim.groundedTime),
    phase: sim.phase,
    ambient: { x: engine.ambient.x, y: engine.ambient.y, t: engine.ambient.t },
    tickMs: 0,
  }
}

function buildPlaneTrailView(): PlaneTrailView {
  const n = planeTrail.count
  const tx = new Float32Array(n)
  const ty = new Float32Array(n)
  const tt = new Float32Array(n)
  planeTrail.forEachPoint((x, y, t, k) => {
    tx[k] = x
    ty[k] = y
    tt[k] = t
  })
  return { count: n, time: planeTrail.time, tx, ty, tt }
}
