import type { Fluid } from './fluid'
import type { SourceKind, WorldBounds } from './types'

interface SourcePoint {
  x: number
  y: number
  kind: SourceKind
}

/**
 * 示踪粒子（拉格朗日）：被动平流于风场，把看不见的气流可视化。
 * 颜色由所在位置的局部温度决定（热偏红、冷偏蓝、中性灰），
 * 透明度随风速增大——"有风的地方才看得见风"。
 */
export class Tracers {
  count: number
  x: Float32Array
  y: Float32Array
  life: Float32Array
  maxLife: Float32Array

  private world: WorldBounds
  private groundY: (x: number) => number

  constructor(count: number, world: WorldBounds, groundY: (x: number) => number) {
    this.count = count
    this.world = world
    this.groundY = groundY
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i, true)
  }

  private respawn(i: number, scatter = false) {
    const { w } = this.world
    for (let tries = 0; tries < 8; tries++) {
      const x = 2 + Math.random() * (w - 4)
      const ceil = this.groundY(x) - 1.5
      if (ceil < 3) continue
      const y = 2 + Math.random() * (ceil - 2)
      this.x[i] = x
      this.y[i] = y
      this.maxLife[i] = 2.5 + Math.random() * 4
      this.life[i] = scatter ? Math.random() * this.maxLife[i] : this.maxLife[i]
      return
    }
    this.x[i] = -100
    this.y[i] = -100
    this.life[i] = 0.1
  }

  step(dt: number, fluid: Fluid, sources: ReadonlyArray<SourcePoint>) {
    const air = { x: 0, y: 0 }
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.respawn(i)
        continue
      }
      fluid.sampleVelocity(this.x[i], this.y[i], air)
      this.x[i] += (air.x + (Math.random() - 0.5) * 0.5) * dt
      this.y[i] += (air.y + (Math.random() - 0.5) * 0.5) * dt
      const gy = this.groundY(this.x[i]) - 0.4
      if (
        this.y[i] > gy ||
        this.y[i] < 0.5 ||
        this.x[i] < 0.5 ||
        this.x[i] > this.world.w - 0.5
      ) {
        this.respawn(i)
      }
    }

    // 在活跃的源附近补充"羽流"粒子，强化因果感
    if (sources.length > 0) {
      for (let n = 0; n < 2; n++) {
        const s = sources[(Math.random() * sources.length) | 0]
        const i = (Math.random() * this.count) | 0
        const ang = Math.random() * Math.PI * 2
        const rad = Math.random() * 1.6
        const x = s.x + Math.cos(ang) * rad
        const y = s.y + Math.sin(ang) * rad
        if (y > this.groundY(x) - 0.6 || y < 1) continue
        this.x[i] = x
        this.y[i] = y
        this.maxLife[i] = 0.9 + Math.random() * 1.2
        this.life[i] = this.maxLife[i]
      }
    }
  }
}
