import type { Tracers } from '../sim/particles'
import type { Vec2 } from '../sim/types'
import type { LevelSimulation } from '../game/simulation'
import type { PressVisual } from '../game/types'
import { LONG_PRESS_MS } from './input'

export interface SceneState {
  sim: LevelSimulation
  tracers: Tracers
  press: PressVisual | null
  now: number
}

const PAGE = '#fdf7ec'
const HOT = { r: 255, g: 90, b: 60 }
const COLD = { r: 61, g: 139, b: 255 }
const DUST = { r: 150, g: 132, b: 104 }
const GOAL = '#2fbf71'

/**
 * Canvas 2D 渲染器：极简矢量风。
 * 世界坐标 y 向下；视口按 contain 适配（等比缩放 + 居中留边）。
 */
export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private scale = 1
  private ox = 0
  private oy = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
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
    const ctx = this.ctx
    if (!ctx || this.cssW === 0) return
    const { sim, tracers, press, now } = scene
    const { w, h } = sim.level.world
    this.world = sim.level.world

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = PAGE
    ctx.fillRect(0, 0, this.cssW, this.cssH)

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    ctx.save()
    ctx.translate(this.ox, this.oy)
    ctx.scale(this.scale, this.scale)

    this.drawSky(ctx, w, h, now)
    this.drawGoal(ctx, sim, now)
    this.drawTerrain(ctx, sim)
    this.drawSources(ctx, sim, press)
    this.drawTracers(ctx, sim, tracers)
    this.drawPlane(ctx, sim)
    if (press && press.kind === 'place') this.drawPress(ctx, press, now)

    ctx.restore()
  }

  private drawSky(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    now: number,
  ) {
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#fff8ea')
    sky.addColorStop(1, '#f8e2bb')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    // 太阳：本游戏的力量之源
    const sx = 12
    const sy = 9.5
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12)
    halo.addColorStop(0, 'rgba(255, 196, 83, 0.4)')
    halo.addColorStop(1, 'rgba(255, 196, 83, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(sx, sy, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffc453'
    ctx.beginPath()
    ctx.arc(sx, sy, 4 + 0.12 * Math.sin(now / 700), 0, Math.PI * 2)
    ctx.fill()
  }

  private drawGoal(ctx: CanvasRenderingContext2D, sim: LevelSimulation, now: number) {
    const g = sim.level.goal
    const gy = sim.level.ground(g.x)
    const pulse = 1 + 0.06 * Math.sin(now / 320)

    // 感应范围（虚线圆）
    ctx.save()
    ctx.strokeStyle = 'rgba(47, 191, 113, 0.35)'
    ctx.lineWidth = 0.28
    ctx.setLineDash([1.2, 1.4])
    ctx.beginPath()
    ctx.arc(g.x, gy - 2, g.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // 光柱
    const beam = ctx.createLinearGradient(0, gy - 12, 0, gy)
    beam.addColorStop(0, 'rgba(47, 191, 113, 0)')
    beam.addColorStop(1, 'rgba(47, 191, 113, 0.14)')
    ctx.fillStyle = beam
    ctx.fillRect(g.x - 1.6, gy - 12, 3.2, 12)

    // 落点垫
    ctx.fillStyle = 'rgba(47, 191, 113, 0.3)'
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(47, 191, 113, 0.75)'
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.stroke()

    // 旗帜
    const top = gy - 6
    ctx.strokeStyle = '#6b5b45'
    ctx.lineWidth = 0.34
    ctx.beginPath()
    ctx.moveTo(g.x, gy)
    ctx.lineTo(g.x, top)
    ctx.stroke()
    const wave = 0.35 * Math.sin(now / 240)
    ctx.fillStyle = GOAL
    ctx.beginPath()
    ctx.moveTo(g.x, top)
    ctx.lineTo(g.x + 3.1, top + 0.9 + wave)
    ctx.lineTo(g.x, top + 2.1)
    ctx.closePath()
    ctx.fill()
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, sim: LevelSimulation) {
    const { w, h } = sim.level.world
    const ground = sim.level.ground
    ctx.beginPath()
    ctx.moveTo(0, ground(0))
    for (let x = 1; x <= w; x += 1) ctx.lineTo(x, ground(x))
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = '#ecdcba'
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(0, ground(0))
    for (let x = 1; x <= w; x += 1) ctx.lineTo(x, ground(x))
    ctx.strokeStyle = '#d8c193'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  private drawSources(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    press: PressVisual | null,
  ) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const age = sim.time - s.born
      const pop = 1 - Math.exp(-age * 9)
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      const glowR = 4.8 * pop
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR)
      glow.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0.32)`)
      glow.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2)
      ctx.fill()

      const coreR = 1.15 * pop * pulse * (grabbed ? 1.18 : 1)
      ctx.fillStyle = '#fffdf8'
      ctx.beginPath()
      ctx.arc(s.x, s.y, coreR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.9)`
      ctx.lineWidth = 0.34
      ctx.stroke()
      ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.95)`
      ctx.beginPath()
      ctx.arc(s.x, s.y, 0.42 * pop, 0, Math.PI * 2)
      ctx.fill()

      if (grabbed) {
        ctx.save()
        ctx.strokeStyle = 'rgba(61, 52, 39, 0.55)'
        ctx.lineWidth = 0.24
        ctx.setLineDash([0.9, 1.1])
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  private drawTracers(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    tracers: Tracers,
  ) {
    const fluid = sim.fluid
    const air = { x: 0, y: 0 }
    const tMax = fluid.tMax
    for (let i = 0; i < tracers.count; i++) {
      const x = tracers.x[i]
      const y = tracers.y[i]
      if (x < -50) continue
      fluid.sampleVelocity(x, y, air)
      const speed = Math.hypot(air.x, air.y)
      let tn = fluid.sampleTemp(x, y) / tMax
      if (tn > 1) tn = 1
      else if (tn < -1) tn = -1

      let r = DUST.r
      let g = DUST.g
      let b = DUST.b
      const m = Math.abs(tn)
      const target = tn > 0 ? HOT : COLD
      r += (target.r - r) * m
      g += (target.g - g) * m
      b += (target.b - b) * m
      const a = 0.13 + Math.min(0.4, speed * 0.055) + m * 0.3

      ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, 0.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawPlane(ctx: CanvasRenderingContext2D, sim: LevelSimulation) {
    const p = sim.plane
    const ground = sim.level.ground(p.x)
    const alt = Math.max(0, ground - p.y)
    if (alt < 16) {
      const sa = 0.16 * (1 - alt / 16)
      ctx.fillStyle = `rgba(61, 52, 39, ${sa.toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(p.x, ground - 0.12, 1.5, 0.32, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    const speed = Math.hypot(p.vx, p.vy)
    const idle = Math.max(0, 1 - speed / 3)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle + 0.07 * Math.sin(p.clock * 1.8) * idle)

    ctx.beginPath()
    ctx.moveTo(1.85, 0)
    ctx.lineTo(-1.35, -1.12)
    ctx.lineTo(-0.6, 0)
    ctx.lineTo(-1.35, 1.12)
    ctx.closePath()
    ctx.fillStyle = '#fffdf8'
    ctx.fill()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(61, 52, 39, 0.5)'
    ctx.lineWidth = 0.16
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(1.85, 0)
    ctx.lineTo(-0.6, 0)
    ctx.strokeStyle = 'rgba(61, 52, 39, 0.26)'
    ctx.lineWidth = 0.12
    ctx.stroke()
    ctx.restore()
  }

  private drawPress(ctx: CanvasRenderingContext2D, press: PressVisual, now: number) {
    const progress = Math.min(1, (now - press.start) / LONG_PRESS_MS)
    // 按压即刻反馈：热源幽灵 + 冷源进度环
    ctx.fillStyle = 'rgba(255, 90, 60, 0.12)'
    ctx.beginPath()
    ctx.arc(press.x, press.y, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 90, 60, 0.75)'
    ctx.lineWidth = 0.26
    ctx.beginPath()
    ctx.arc(press.x, press.y, 1.5, 0, Math.PI * 2)
    ctx.stroke()

    if (progress > 0.04) {
      ctx.strokeStyle = 'rgba(61, 139, 255, 0.9)'
      ctx.lineWidth = 0.4
      ctx.beginPath()
      ctx.arc(
        press.x,
        press.y,
        2.2,
        -Math.PI / 2,
        -Math.PI / 2 + progress * Math.PI * 2,
      )
      ctx.stroke()
    }
  }
}
