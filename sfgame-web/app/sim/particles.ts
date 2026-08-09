// 示踪粒子（纯视觉层）：数值内核在 assembly/tracers.ts（WASM，与流体同模块同内存——
// 采样直调内核零跨界、地面走 LUT），本模块只是零拷贝视图门面。宿主每 tick 只写热源表并单次调用
import type { EngineHandle } from '../wasm/engine'
import type { WorldBounds } from './types'

export const TRAIL_LEN = 24
// LUT 采样步长（世界单位）：0.25 与渲染地形同步长；粒子碰撞/重生容差 ≥0.4，线性插值误差无感
const LUT_STEP = 0.25

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
    groundY: (x: number) => number,
    trailLen = TRAIL_LEN,
    margin = 0,
  ) {
    const ex = engine.ex
    const buf = engine.memory.buffer
    // LUT 先行烘焙（init 内 scatter 重生即消费）：域 [0,w]，查询端外钳制取边缘值（同 groundExt）
    const lutCap = ex.tLutCap()
    const step = Math.max(LUT_STEP, world.w / (lutCap - 1))
    const lutN = Math.min(lutCap, Math.floor(world.w / step) + 1)
    const lut = new Float32Array(buf, ex.tLutBuf(), lutCap)
    for (let i = 0; i < lutN; i++) lut[i] = groundY(i * step)
    const st = ex.tracersInit(count, trailLen, world.w, margin, step, (Math.random() * 4294967296) >>> 0)
    // 容量不符/越界即抛：无声退化等于带病启动（同 createFluid 策略）
    if (st !== 0) throw new Error('示踪粒子内核初始化失败（count/trailLen 与编译期容量不符或 LUT 越界）')

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
