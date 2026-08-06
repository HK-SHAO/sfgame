import { MeshBatch, VERTEX_STRIDE } from './batch'
import { GlRenderer } from './gl'
import { bilinearSample } from '../sim/fluid'
import type { EngineHandle } from '../wasm/engine'
import type { Tracers } from '../sim/particles'
import { TRAIL_FADE_T } from '../sim/particles'
import type { Clouds } from '../sim/clouds'
import type { Trail } from '../sim/trail'
import type { Vec2 } from '../sim/types'
import type { LevelSimulation } from '../game/simulation'
import { GOAL_LIFT } from '../game/simulation'
import type { PressVisual } from '../game/types'
import { LONG_PRESS_MS } from '../ui/input'

export interface SceneState {
  sim: LevelSimulation
  tracers: Tracers
  clouds: Clouds
  planeTrail: Trail
  press: PressVisual | null
  now: number
}

type RGB = readonly [number, number, number]

const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

const HOT = rgb(255, 90, 60)
const COLD = rgb(61, 139, 255)
const TRAIL_INK = rgb(64, 74, 106)
const INK_DARK = rgb(61, 52, 39)
const GOAL = rgb(47, 191, 113)
const SKY_TOP = rgb(255, 248, 234)
const SKY_BOTTOM = rgb(248, 226, 187)
const GROUND_FILL = rgb(236, 220, 186)
const GROUND_EDGE = rgb(216, 193, 147)
const SUN = rgb(255, 196, 83)
const PAPER = rgb(255, 253, 248)
const FLAG_POLE = rgb(107, 91, 69)
const CLOUD = rgb(255, 255, 254)
const CLOUD_SOLID_FRAC = 0.75
const CLOUD_STRETCH = 1.7
const CLOUD_CORE_MIN = 0.15

const SUN_POS = { x: 12, y: 9.5 }
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

const AIR_AMBIENT = rgb(200, 197, 183)
const AIR_SOFT = 0.35
const HEAD_ALPHA_AMBIENT = 0.45
const HEAD_ALPHA_STRONG = 0.85
const LINE_ALPHA_AMBIENT = 0.18
const LINE_ALPHA_COLORED = 0.42
const TRACER_LINE_WIDTH = 0.3
const TRACER_HEAD_RADIUS = 0.3
const GUST_BASE = 0.7
const GUST_BOOST = 0.6
const GUST_FULL_SPEED = 4
const VISIBLE_ALPHA = 0.02
const SOURCE_POP_RATE = 9
const SOURCE_GLOW_RADIUS = 4.8
const SOURCE_CORE_RADIUS = 1.15
const FLAG_RESPONSE_BASE = 1.2
const FLAG_RESPONSE_WIND = 3
const POLE_HEIGHT = 5.7
const POLE_FABRIC_LEN = 1.8
const POLE_SINK = 0.6

const TERRAIN_STEP = 0.25
const TERRAIN_MAX_STEP = 2
const TERRAIN_ANG_TOL = 0.02

const SHADOW_RADIUS = 1.5
const SHADOW_RY = 0.32
const SHADOW_LIFT = 0.12
const SHADOW_MAX_ALPHA = 0.3

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private engine: EngineHandle
  private batch: MeshBatch
  // 零拷贝流体场视图（共享引擎内存）：按关卡网格尺寸建一次，视图恒定
  private fields: { u: Float32Array; v: Float32Array; t: Float32Array; nx: number; ny: number; cell: number } | null = null
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  private terrainPts = new Float32Array(256)
  private tracerEnv = new Float32Array(0)
  private tracerColor = new Float32Array(0)
  private bgDirty = true
  lastVertexCount = 0
  lastUploadBytes = 0

  constructor(canvas: HTMLCanvasElement, engine: EngineHandle) {
    this.canvas = canvas
    this.engine = engine
    this.batch = new MeshBatch(engine)
    this.gl = GlRenderer.create(canvas)
    if (!this.gl) console.warn('WebGL 不可用，画布将保持空白')
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW
    this.cssH = cssH
    // dpr 体现在帧缓冲尺寸上：GL viewport 直接用 canvas 设备像素尺寸
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.gl?.resizeBg()
    this.bgDirty = true
  }

  toWorld(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const wx = (clientX - rect.left - this.ox) / this.scale
    const wy = (clientY - rect.top - this.oy) / this.scale
    const level = this.world
    if (!level) return null
    if (wx < -0.5 || wx > level.w + 0.5 || wy < -0.5 || wy > level.h + 0.5) return null
    return { x: wx, y: wy }
  }

  private world: { w: number; h: number } | null = null

  draw(scene: SceneState) {
    const gl = this.gl
    if (!gl || this.cssW === 0 || this.cssH === 0) return
    const { sim, tracers, planeTrail, press, now } = scene
    const { w, h, cell } = sim.level.world
    this.world = sim.level.world
    this.ensureFields(Math.round(w / cell), Math.round(h / cell), cell)

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale

    // resize/上下文重置会清空背景纹理：纹理缺失也强制重烘焙补帧（自愈）
    if (this.bgDirty || gl.bgStale || !gl.bgReady) {
      const bg = this.batch
      bg.reset()
      this.drawSky(bg, viewL, viewT, viewR, viewB, h)
      if (gl.bakeBg(bg, viewL, viewT, viewR, viewB)) {
        this.bgDirty = false
        gl.bgStale = false
      }
    }

    const b = this.batch
    b.reset()
    // 遮挡契约：云/光晕最背景；气流粒子与轨迹在场景物体之后，被旗杆、旗面、太阳、地形遮挡；
    // 飞机与飞机拖尾是主角层恒在最前
    this.drawClouds(b, scene.clouds)
    this.drawSunHalo(b)
    this.drawTracers(b, tracers)
    this.drawGoalPoles(b, sim)
    this.drawTerrain(b, sim, viewL, viewR, viewB)
    this.drawSun(b, now)
    this.drawGoal(b, sim)
    this.drawSources(b, sim, press)
    this.drawPlaneTrail(b, sim, planeTrail)
    this.drawPlane(b, sim)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    this.lastVertexCount = b.count
    this.lastUploadBytes = b.count * VERTEX_STRIDE * 4
    gl.draw(b, viewL, viewT, viewR, viewB)
  }

  private drawSky(b: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number, h: number) {
    const topBandEnd = Math.min(viewB, 0)
    if (viewT < topBandEnd) b.rect(viewL, viewT, viewR, topBandEnd, ...SKY_TOP, 1)
    const gradTop = Math.max(viewT, 0)
    const gradBottom = Math.min(viewB, h)
    if (gradTop < gradBottom) b.rectVGrad(viewL, gradTop, viewR, gradBottom, ...SKY_TOP, 1, ...SKY_BOTTOM, 1)
    const bottomBandTop = Math.max(viewT, h)
    if (bottomBandTop < viewB) b.rect(viewL, bottomBandTop, viewR, viewB, ...SKY_BOTTOM, 1)
  }

  private drawTerrain(b: MeshBatch, sim: LevelSimulation, viewL: number, viewR: number, viewB: number) {
    const ground = sim.level.ground
    const need = Math.ceil((viewR - viewL) / TERRAIN_STEP + 3) * 2
    if (this.terrainPts.length < need) this.terrainPts = new Float32Array(need)
    const pts = this.terrainPts
    let n = 0
    pts[n++] = viewL
    pts[n++] = ground(viewL)
    let lastX = viewL
    let lastY = pts[n - 1]
    let lastAng = 0
    let haveAng = false
    for (let x = Math.max(0, viewL) + TERRAIN_STEP; x <= viewR + 1e-9; x += TERRAIN_STEP) {
      const y = ground(x)
      const ang = Math.atan2(y - lastY, x - lastX)
      if (!haveAng || Math.abs(ang - lastAng) > TERRAIN_ANG_TOL || x - lastX >= TERRAIN_MAX_STEP) {
        pts[n++] = x
        pts[n++] = y
        lastX = x
        lastY = y
        lastAng = ang
        haveAng = true
      }
    }
    if (viewR - lastX > 1e-6) {
      pts[n++] = viewR
      pts[n++] = ground(viewR)
    }

    for (let i = 0; i + 3 < n; i += 2) {
      const ax = pts[i]
      const ay = pts[i + 1]
      const bx = pts[i + 2]
      const by = pts[i + 3]
      b.tri(ax, ay, bx, by, ax, viewB, ...GROUND_FILL, 1)
      b.tri(bx, by, bx, viewB, ax, viewB, ...GROUND_FILL, 1)
    }
    b.polyline(pts, n, 0.5, ...GROUND_EDGE, 1)
  }

  private drawSunHalo(b: MeshBatch) {
    b.discGrad(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 40, ...SUN, 0.4, ...SUN, 0)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS.x, SUN_POS.y, r, r, 0, 48, ...SUN, 1)
  }

  private drawClouds(b: MeshBatch, clouds: Clouds) {
    for (let i = 0; i < clouds.count; i++) {
      const a = clouds.alpha[i]
      if (a <= VISIBLE_ALPHA) continue
      const x = clouds.x[i]
      const y = clouds.y[i]
      const r = clouds.radius[i]
      const sf = CLOUD_SOLID_FRAC * (CLOUD_CORE_MIN + (1 - CLOUD_CORE_MIN) * a)
      b.discGradCore(x, y, r, 18, sf, ...CLOUD, 1.0 * a, ...CLOUD, 0)
      b.discGradCore(x - 0.62 * r * CLOUD_STRETCH, y + 0.1 * r, 0.66 * r, 14, sf, ...CLOUD, 0.9 * a, ...CLOUD, 0)
      b.discGradCore(x + 0.62 * r * CLOUD_STRETCH, y + 0.08 * r, 0.66 * r, 14, sf, ...CLOUD, 0.9 * a, ...CLOUD, 0)
      b.discGradCore(x, y - 0.42 * r, 0.5 * r, 14, sf, ...CLOUD, 0.78 * a, ...CLOUD, 0)
      b.discGradCore(x, y + 0.3 * r, 0.46 * r, 14, sf, ...CLOUD, 0.6 * a, ...CLOUD, 0)
    }
  }

  private drawGoalPoles(b: MeshBatch, sim: LevelSimulation) {
    for (const g of sim.level.goals) {
      const gy = sim.level.ground(g.x)
      b.stroke(g.x, gy + POLE_SINK, g.x, gy - POLE_HEIGHT, 0.34, ...FLAG_POLE, 1, true)
    }
  }

  private drawGoal(b: MeshBatch, sim: LevelSimulation) {
    const goals = sim.level.goals
    this.ensureFlagState(goals.length)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]
      if (sim.visited[i]) continue
      const gy = sim.level.ground(g.x)
      const flagTop = gy - POLE_HEIGHT

      b.dashRing(g.x, gy - GOAL_LIFT, g.r, 1.2, 1.4, 0.28, ...GOAL, 0.32)
      const air = Renderer.tmpAir
      sim.fluid.sampleVelocity(g.x + 1.6, flagTop + 1.4, air)
      const dt = sim.time - this.flagT[i]
      this.flagT[i] = sim.time
      if (dt > 0) {
        const k = 1 - Math.exp(-dt * (FLAG_RESPONSE_BASE + Math.hypot(air.x, air.y) * FLAG_RESPONSE_WIND))
        this.flagX[i] += (air.x - this.flagX[i]) * k
        this.flagY[i] += (air.y - this.flagY[i]) * k
      }
      const sx = this.flagX[i]
      const sy = this.flagY[i]
      const u = Math.hypot(sx, sy)
      const uN = Math.min(1.4, u)
      const len = 0.9 + uN * 2.2
      const dx = u > 0.05 ? sx / u : 0
      const dy = u > 0.05 ? sy / u : 0
      const droop = 0.85 * Math.exp(-uN * 1.6)
      const wave = (0.1 + uN * 0.45) * Math.sin(sim.time * (5 + uN * 4) + i * 1.7)
      const tipX = g.x + dx * len - dy * wave
      const tipY = flagTop + dy * len * 0.55 + droop * len + dx * wave
      b.tri(g.x, flagTop, tipX, tipY, g.x, flagTop + POLE_FABRIC_LEN, ...GOAL, 1)
    }
  }

  private flagX = new Float32Array(0)
  private flagY = new Float32Array(0)
  private flagT = new Float32Array(0)
  private trailPts = new Float32Array(0)
  private trailFade = new Float32Array(0)

  private ensureFlagState(n: number) {
    if (this.flagX.length >= n) return
    this.flagX = new Float32Array(n)
    this.flagY = new Float32Array(n)
    this.flagT = new Float32Array(n)
    this.flagT.fill(-Infinity)
  }

  private drawSources(b: MeshBatch, sim: LevelSimulation, press: PressVisual | null) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const pop = Math.max(0, 1 - Math.exp(-(sim.time - s.born) * SOURCE_POP_RATE))
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      if (pop > VISIBLE_ALPHA) {
        b.discGrad(s.x, s.y, SOURCE_GLOW_RADIUS * pop, 24, ...c, 0.32, ...c, 0)
      }

      const coreR = SOURCE_CORE_RADIUS * pop * pulse * (grabbed ? 1.18 : 1)
      b.disc(s.x, s.y, coreR, coreR, 0, 24, ...PAPER, 1)
      b.ring(s.x, s.y, coreR, coreR, 0, 24, 0.34, ...c, 0.9)
      b.disc(s.x, s.y, 0.42 * pop, 0.42 * pop, 0, 16, ...c, 0.95)

      if (grabbed) b.dashRing(s.x, s.y, 2.2, 0.9, 1.1, 0.24, ...INK_DARK, 0.55)
    }
  }

  private static tmpAir = { x: 0, y: 0 }

  private ensureFields(nx: number, ny: number, cell: number) {
    const f = this.fields
    if (f && f.nx === nx && f.ny === ny && f.cell === cell) return
    const buf = this.engine.memory.buffer
    const n = nx * ny
    this.fields = {
      u: new Float32Array(buf, this.engine.ex.fieldU(), n),
      v: new Float32Array(buf, this.engine.ex.fieldV(), n),
      t: new Float32Array(buf, this.engine.ex.fieldT(), n),
      nx,
      ny,
      cell,
    }
  }

  private drawTracers(b: MeshBatch, tracers: Tracers) {
    const { trailX, trailY, trailT, trailN, count } = tracers
    const trailLen = tracers.trailLen
    const air = Renderer.tmpAir
    const f = this.fields!
    const amb = this.engine.ambient
    if (this.tracerEnv.length < count) {
      this.tracerEnv = new Float32Array(count)
      this.tracerColor = new Float32Array(count * 5)
    }
    const envs = this.tracerEnv
    const colors = this.tracerColor

    for (let i = 0; i < count; i++) {
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) {
        envs[i] = 0
        continue
      }
      // 零拷贝采样：直读共享内存流体场（原每粒子 2 次 wasm 跨边界调用）
      const temp = bilinearSample(f.u, f.v, f.t, f.nx, f.ny, f.cell, amb.x, amb.y, tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      envs[i] = env
      const u = Math.tanh(Math.abs(temp) / AIR_SOFT)
      const to = temp >= 0 ? HOT : COLD
      const c0 = i * 5
      colors[c0] = AIR_AMBIENT[0] + (to[0] - AIR_AMBIENT[0]) * u
      colors[c0 + 1] = AIR_AMBIENT[1] + (to[1] - AIR_AMBIENT[1]) * u
      colors[c0 + 2] = AIR_AMBIENT[2] + (to[2] - AIR_AMBIENT[2]) * u
      colors[c0 + 3] = HEAD_ALPHA_AMBIENT + (HEAD_ALPHA_STRONG - HEAD_ALPHA_AMBIENT) * u
      colors[c0 + 4] = LINE_ALPHA_AMBIENT + (LINE_ALPHA_COLORED - LINE_ALPHA_AMBIENT) * u

      const n = trailN[i]
      if (n === 0) continue
      const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
      const base = i * trailLen
      const now = tracers.time
      const np = n + 1
      if (this.trailPts.length < np * 2) {
        this.trailPts = new Float32Array(np * 2)
        this.trailFade = new Float32Array(np)
      }
      const pts = this.trailPts
      const fade = this.trailFade
      for (let k = 0; k < n; k++) {
        pts[k * 2] = trailX[base + k]
        pts[k * 2 + 1] = trailY[base + k]
        const a = (1 - (now - trailT[base + k]) / TRAIL_FADE_T) * env * gust
        fade[k] = a > 0 ? Math.min(1, a) * colors[c0 + 4] : 0
      }
      pts[n * 2] = tracers.x[i]
      pts[n * 2 + 1] = tracers.y[i]
      fade[n] = colors[c0 + 3] * env
      b.polylineFade(pts, np * 2, TRACER_LINE_WIDTH, colors[c0], colors[c0 + 1], colors[c0 + 2], fade)
      b.disc(tracers.x[i], tracers.y[i], TRACER_LINE_WIDTH / 2, TRACER_LINE_WIDTH / 2, 0, 8, colors[c0], colors[c0 + 1], colors[c0 + 2], fade[n])
    }

    for (let i = 0; i < count; i++) {
      const env = envs[i]
      if (env <= 0) continue
      const c0 = i * 5
      b.disc(
        tracers.x[i], tracers.y[i],
        TRACER_HEAD_RADIUS, TRACER_HEAD_RADIUS, 0, 10,
        colors[c0], colors[c0 + 1], colors[c0 + 2], colors[c0 + 3] * env,
      )
    }
  }

  private drawPlaneTrail(b: MeshBatch, sim: LevelSimulation, trail: Trail) {
    const n = trail.count
    if (n === 0) return
    const p = sim.plane
    let px = trail.xAt(0)
    let py = trail.yAt(0)
    for (let k = 0; k < n; k++) {
      const nx = k + 1 < n ? trail.xAt(k + 1) : p.x
      const ny = k + 1 < n ? trail.yAt(k + 1) : p.y
      const ret = trail.retentionAt(k)
      if (ret > VISIBLE_ALPHA) {
        b.stroke(px, py, nx, ny, 0.1 + 0.26 * ret, TRAIL_INK[0], TRAIL_INK[1], TRAIL_INK[2], 0.5 * ret)
      }
      px = nx
      py = ny
    }
  }

  private static readonly PLANE_LOCAL = [
    [1.85, 0],
    [-1.35, -1.12],
    [-0.6, 0],
    [-1.35, 1.12],
  ] as const
  private planeWorld = new Float32Array(8)

  private drawPlane(b: MeshBatch, sim: LevelSimulation) {
    const p = sim.plane
    const g0 = sim.level.ground(p.x - SHADOW_RADIUS)
    const g1 = sim.level.ground(p.x + SHADOW_RADIUS)
    const slope = Math.atan2(g1 - g0, SHADOW_RADIUS * 2)
    const sy = sim.level.ground(p.x) - SHADOW_LIFT
    b.disc(p.x, sy, SHADOW_RADIUS, SHADOW_RY, slope, 24, ...INK_DARK, SHADOW_MAX_ALPHA)

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
    const idle = Math.max(0, 1 - speed / 3)
    const pitch = Math.max(-0.32, Math.min(0.32, p.vy * 0.1))
    const rot = p.angle + 0.07 * Math.sin(p.clock * 1.8) * idle + pitch
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const w = this.planeWorld
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = Renderer.PLANE_LOCAL[i]
      w[i * 2] = p.x + lx * cos - ly * sin
      w[i * 2 + 1] = p.y + lx * sin + ly * cos
    }
    b.tri(w[0], w[1], w[2], w[3], w[4], w[5], ...PAPER, 1)
    b.tri(w[0], w[1], w[4], w[5], w[6], w[7], ...PAPER, 1)
    const outline = [0, 1, 2, 3, 0]
    for (let i = 0; i < 4; i++) {
      const a = outline[i] * 2
      const c = outline[i + 1] * 2
      b.stroke(w[a], w[a + 1], w[c], w[c + 1], 0.16, ...INK_DARK, 0.5, true)
    }
    b.stroke(w[0], w[1], w[4], w[5], 0.12, ...INK_DARK, 0.26)
  }

  private drawPress(b: MeshBatch, press: PressVisual, now: number) {
    const progress = Math.min(1, (now - press.start) / LONG_PRESS_MS)
    b.disc(press.x, press.y, 1.5, 1.5, 0, 24, ...HOT, 0.12)
    b.ring(press.x, press.y, 1.5, 1.5, 0, 24, 0.26, ...HOT, 0.75)
    if (progress > 0.04) {
      b.arc(
        press.x, press.y, 2.2,
        -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, 24, 0.4,
        ...COLD, 0.9,
      )
    }
  }
}
