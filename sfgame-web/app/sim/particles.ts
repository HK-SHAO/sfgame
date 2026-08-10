// 示踪粒子（纯视觉层）：数值内核在 assembly/tracers.ts（WASM，与流体同模块同内存——
// 采样直调内核零跨界、地形采宿主烘焙的 SDF 场），本模块只是零拷贝视图门面。宿主每 tick 只写热源表并单次调用
import type { EngineHandle } from '../wasm/engine'
import type { Terrain } from './terrain'
import type { WorldBounds } from './types'

export const TRAIL_LEN = 24

export class Tracers {
  readonly count: number
  readonly trailLen: number
  x: Float32Array
  y: Float32Array
  life: Float32Array
  maxLife: Float32Array
  trailX: Float32Array
  trailY: Float32Array
  trailT: Float32Array
  trailN: Uint8Array

  private ex: EngineHandle['ex']
  private srcView: Float32Array
  private srcCap: number

  constructor(
    engine: EngineHandle,
    count: number,
    world: WorldBounds,
    terrain: Terrain,
    trailLen = TRAIL_LEN,
    margin = 0,
    seed: number,
  ) {
    const ex = engine.ex
    const buf = engine.memory.buffer
    // 地形场原样上传（与流体掩码/飞机碰撞同源）：init 内 scatter 重生即消费
    const sdfCap = ex.tSdfCap()
    if (terrain.nx * terrain.ny > sdfCap) throw new Error('地形场超出示踪内核编译容量')
    new Float32Array(buf, ex.tSdfBuf(), sdfCap).set(terrain.field)
    // 种子由调用方派生（关卡 id）：同一关卡粒子场逐位可复现，重开/刷新画面一致
    const st = ex.tracersInit(
      count, trailLen, world.w, world.h, margin,
      terrain.nx, terrain.ny, terrain.cell, terrain.originX, terrain.originY,
      seed >>> 0,
    )
    // 容量不符/越界即抛：无声退化等于带病启动（同 createFluid 策略）
    if (st !== 0) throw new Error('示踪粒子内核初始化失败（count/trailLen/地形场与编译期容量不符）')

    this.ex = ex
    this.count = count
    this.trailLen = trailLen
    this.x = new Float32Array(buf, ex.tXBuf(), count)
    this.y = new Float32Array(buf, ex.tYBuf(), count)
    this.life = new Float32Array(buf, ex.tLifeBuf(), count)
    this.maxLife = new Float32Array(buf, ex.tMaxLifeBuf(), count)
    this.trailX = new Float32Array(buf, ex.tTrailXBuf(), count * trailLen)
    this.trailY = new Float32Array(buf, ex.tTrailYBuf(), count * trailLen)
    this.trailT = new Float32Array(buf, ex.tTrailTBuf(), count * trailLen)
    this.trailN = new Uint8Array(buf, ex.tTrailNBuf(), count)
    this.srcCap = ex.tSrcCap()
    this.srcView = new Float32Array(buf, ex.tSrcBuf(), this.srcCap * 2)
  }

  get time(): number {
    return this.ex.tTime()
  }

  envelope(i: number): number {
    const FADE_IN = 0.5
    const FADE_OUT = 0.7
    const age = this.maxLife[i] - this.life[i]
    const env = Math.min(1, age / FADE_IN, this.life[i] / FADE_OUT)
    return env < 0 ? 0 : env
  }

  step(dt: number, sources: ReadonlyArray<{ x: number; y: number }>) {
    const n = Math.min(sources.length, this.srcCap)
    for (let i = 0; i < n; i++) {
      this.srcView[i * 2] = sources[i].x
      this.srcView[i * 2 + 1] = sources[i].y
    }
    this.ex.tracersStep(dt, n)
  }
}
