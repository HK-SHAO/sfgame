// 模拟 worker：LevelSimulation + 示踪 + 云 + 拖尾 + 风采样 + 落地判定整体迁入。
// 主线程只发消息、收帧快照渲染；渲染所需的示踪着色与旗面风由 worker 预计算（含大场采样），
// 帧载荷只有记录级小数组（协议见 worker-protocol.ts）。
// 引擎实例跨关卡复用：fluid_init 全量复位已保证安全（engine-reuse.test 钉死），load 只重建模拟对象。
// 消息处理在 wasm 引导完成前即可注册：load 恒为第一条消息，await 引擎就绪后按序消费（队列 FIFO 不丢消息）
import engineUrl from '../wasm/sfengine.wasm?url'
import { bootEngine, createEngine, type EngineHandle } from '../wasm/engine.ts'
import { LevelSimulation } from '../game/simulation.ts'
import { levelFromJson } from '../game/level-format.ts'
import { resolveLevel, levelSeed } from '../game/levels.ts'
import { Tracers, TRAIL_LEN } from './particles.ts'
import { Clouds } from './clouds.ts'
import { fadeRetention, PLANE_TRAIL_FADE, TRAIL_FADE_T, Trail } from './trail.ts'
import { bilinearSample } from './fluid.ts'
import { buildWindProbes, isLanding, sampleWind } from '../core/wind.ts'
import { FLUID_MARGIN } from './terrain.ts'
import { totalPenaltySeconds } from '../game/timer.ts'
import type { Source } from '../game/types.ts'
import type { SimRequest, SimEvent, FrameSnapshot, PlaneTrailView, TracerBatch } from './worker-protocol.ts'
import {
  AIR_AMBIENT, AIR_SOFT, COLD, GUST_BASE, GUST_BOOST, GUST_FULL_SPEED,
  HEAD_ALPHA_AMBIENT, HEAD_ALPHA_STRONG, HOT, LINE_ALPHA_AMBIENT, LINE_ALPHA_COLORED,
  POLE_HEIGHT, FLAG_SAMPLE_DX, FLAG_SAMPLE_DY,
  TRACER_COUNT, TRACER_FADE_IN, TRACER_FADE_OUT, TRACER_TAIL_SEGS, VISIBLE_ALPHA,
} from './worker-protocol.ts'

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

// 采样视图与渲染批 scratch（loadLevel 建一次）：预计算示踪着色/旗面风的输入面
let fieldViews: {
  u: Float32Array
  v: Float32Array
  t: Float32Array
  fxU: Float32Array
  fxV: Float32Array
  tracerX: Float32Array
  tracerY: Float32Array
  life: Float32Array
  maxLife: Float32Array
  trailX: Float32Array
  trailY: Float32Array
  trailT: Float32Array
  trailN: Uint8Array
  stride: number
  cap: number
} | null = null
let tracerScratch: Float32Array | null = null

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
  // 采样视图：引擎内存上的零拷贝视图（非副本），仅供 worker 侧预计算渲染载荷
  const mem = engine.memory.buffer
  const ex = engine.ex
  const n = sim.terrain.nx * sim.terrain.ny
  const view = (off: number, len: number) => new Float32Array(mem, off, len)
  const stride = ex.bTracerStride()
  fieldViews = {
    u: view(ex.fieldU(), n),
    v: view(ex.fieldV(), n),
    t: view(ex.fieldT(), n),
    fxU: view(ex.fieldFxU(), n),
    fxV: view(ex.fieldFxV(), n),
    tracerX: view(ex.tXBuf(), TRACER_COUNT),
    tracerY: view(ex.tYBuf(), TRACER_COUNT),
    life: view(ex.tLifeBuf(), TRACER_COUNT),
    maxLife: view(ex.tMaxLifeBuf(), TRACER_COUNT),
    trailX: view(ex.tTrailXBuf(), TRACER_COUNT * TRAIL_LEN),
    trailY: view(ex.tTrailYBuf(), TRACER_COUNT * TRAIL_LEN),
    trailT: view(ex.tTrailTBuf(), TRACER_COUNT * TRAIL_LEN),
    trailN: new Uint8Array(mem, ex.tTrailNBuf(), TRACER_COUNT),
    stride,
    cap: ex.bTracerCap(),
  }
  tracerScratch = new Float32Array(TRACER_COUNT * stride)
  lastPhase = 'playing'
  lastHudKey = ''
  lastLand = -Infinity
  // 地形场独立副本可转移：sim 物理仍持有原场（转移会 detach 视图）
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
  // 渲染批独立可转移（transfer 移交所有权）；其余标量随消息结构化克隆
  post({ t: 'frame', snapshot }, snapshot.tracers ? [snapshot.tracers.data.buffer] : [])
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

// 快照只发每帧动态标量与 JS 侧状态；示踪着色批与旗面风由 worker 预计算（含大场采样）
function buildSnapshot(): FrameSnapshot {
  const amb = engine.ambient
  const goals = sim.level.goals
  const flags: { x: number; y: number }[] = []
  const air = tmpAir
  for (let i = 0; i < goals.length; i++) {
    bilinearSample(
      fv().u, fv().v, fv().t, fv().fxU, fv().fxV,
      sim.terrain.nx, sim.terrain.ny, sim.terrain.cell,
      sim.terrain.originX, sim.terrain.originY,
      amb.x, amb.y,
      goals[i].x + FLAG_SAMPLE_DX, sim.goalAnchorY[i] - POLE_HEIGHT + FLAG_SAMPLE_DY,
      air,
    )
    flags.push({ x: air.x, y: air.y })
  }
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
    ambient: { x: amb.x, y: amb.y, t: amb.t },
    tracers: buildTracerBatch(amb),
    flags,
    tickMs: 0,
  }
}

const fv = () => fieldViews!
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const tailFade = (k: number, segs: number) => (k < segs ? k / segs : 1)

// 示踪渲染批：与主线程旧 drawTracers 同布局同语义（内核记录格式），按可见性紧凑写入
function buildTracerBatch(amb: { x: number; y: number; t: number }): TracerBatch | null {
  const v = fieldViews
  const scratch = tracerScratch
  if (!v || !scratch) return null
  const stride = v.stride
  const cap = v.cap
  // 定长记录点数上限（头点占末位）：写入钳制，防越界写跨记录串扰（内核侧另有镜像钳制）
  const maxPts = (stride - 5) / 3
  const air = tmpAir
  const buf = scratch
  let m = 0
  for (let i = 0; i < TRACER_COUNT && m < cap; i++) {
    const age = v.maxLife[i] - v.life[i]
    const env = Math.min(1, age / TRACER_FADE_IN, v.life[i] / TRACER_FADE_OUT)
    if (env <= VISIBLE_ALPHA) continue
    // 采样 = 场直读 + 环境基场/偏置叠加（与 wasm 采样同构、与主线程旧实现同源）
    const temp =
      bilinearSample(
        v.u, v.v, v.t, v.fxU, v.fxV,
        sim.terrain.nx, sim.terrain.ny, sim.terrain.cell,
        sim.terrain.originX, sim.terrain.originY,
        amb.x, amb.y, v.tracerX[i], v.tracerY[i], air,
      ) + amb.t
    const sp2 = air.x * air.x + air.y * air.y
    const u = Math.tanh(Math.abs(temp) / AIR_SOFT)
    const to = temp >= 0 ? HOT : COLD
    const cr = mix(AIR_AMBIENT[0], to[0], u)
    const cg = mix(AIR_AMBIENT[1], to[1], u)
    const cb = mix(AIR_AMBIENT[2], to[2], u)
    const headAlpha = mix(HEAD_ALPHA_AMBIENT, HEAD_ALPHA_STRONG, u) * env
    const lineAlpha = mix(LINE_ALPHA_AMBIENT, LINE_ALPHA_COLORED, u)

    const off = m * stride
    buf[off] = cr
    buf[off + 1] = cg
    buf[off + 2] = cb
    buf[off + 4] = headAlpha
    let np = 0
    // 头点占末位：拖尾点最多 maxPts−1（写入钳制，与内核 b_tracers 的读取钳制成对）
    const n = Math.min(v.trailN[i], maxPts - 1)
    if (n > 0) {
      const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
      const base = i * TRAIL_LEN
      for (let k = 0; k < n; k++) {
        const po = off + 5 + np * 3
        buf[po] = v.trailX[base + k]
        buf[po + 1] = v.trailY[base + k]
        // trailT 以 sim 时间写入，淡出用同钟读，避免倍速下与 wall clock 漂移
        const a = fadeRetention(sim.time, v.trailT[base + k], TRAIL_FADE_T) * env * gust
        const tail = tailFade(k, TRACER_TAIL_SEGS)
        buf[po + 2] = a > 0 ? Math.min(1, a) * lineAlpha * tail : 0
        np++
      }
    }
    const po = off + 5 + np * 3
    buf[po] = v.tracerX[i]
    buf[po + 1] = v.tracerY[i]
    // 头部顶点 alpha=0：线带恰在头心淡尽，头部圆盘独享混合——避免线带与圆盘重叠区双混发深
    buf[po + 2] = 0
    np++
    buf[off + 3] = np
    m++
  }
  if (m === 0) return null
  const data = new Float32Array(m * stride)
  data.set(scratch.subarray(0, m * stride))
  return { count: m, data }
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
