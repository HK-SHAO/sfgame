/**
 * 性能基准核心（无 DOM，node/浏览器共用）。
 *
 * 组件与真实游戏一致：第 1 关网格（76×56 / cell 0.75）、4 源、
 * 移动端初始粒子档（240 × 24 轨迹点）。输出 ms/frame 统计，
 * 对照 16.7ms（60fps）帧预算判断瓶颈构成。
 *
 * 引擎对比：fluid 基准可选跑 JS 求解器或 wasm 求解器（后者未就绪时自动跳过），
 * 用于验证 wasm 加速的真实收益与数值一致性。
 */
import { LevelSimulation } from '../game/simulation'
import { LEVEL_1 } from '../game/levels'
import { Tracers } from '../sim/particles'
import { MeshBatch } from '../core/batch'
import { SIM_DT } from '../core/loop'
import { setFluidEngine, wasmFluidAvailable, loadFluidWasm } from '../sim/fluid-wasm'

export const BENCH_TRACER_COUNT = 240
export const BENCH_TRAIL_LEN = 24

const SOURCE_SPOTS: Array<[number, number, 'hot' | 'cold']> = [
  [18, 42, 'hot'],
  [30, 40, 'hot'],
  [44, 30, 'hot'],
  [52, 24, 'cold'],
]

function ground1(x: number): number {
  return LEVEL_1.ground(x)
}

export interface BenchStat {
  name: string
  mean: number
  p95: number
  detail: string
}

export interface BenchOptions {
  /** 模拟时长（秒），默认 20 */
  seconds?: number
  /** 是否包含 wasm 求解器对比（需先调用 ensureWasmFluid） */
  includeWasm?: boolean
  /** 倍速帧基准的倍率（默认 16，即游戏中最高速档） */
  rate?: number
  /** 进度回调（0..1），供浏览器端展示 */
  onProgress?: (ratio: number) => void
}

function stats(samples: number[]): { mean: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length
  return { mean, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] }
}

function makeLoadedSim(): LevelSimulation {
  const sim = new LevelSimulation(LEVEL_1)
  for (const [x, y, kind] of SOURCE_SPOTS) sim.placeSource(x, y, kind, true)
  for (let i = 0; i < 300; i++) sim.step(SIM_DT)
  return sim
}

/** 让浏览器端先行装载 wasm 求解器（返回是否可用）；node 端无 fetch 时返回 false。 */
export async function ensureWasmFluid(): Promise<boolean> {
  try {
    await loadFluidWasm()
    return true
  } catch {
    return false
  }
}

function fluidBench(sim: LevelSimulation, steps: number, label: string): BenchStat {
  const samples: number[] = []
  const rate = 10 * SIM_DT
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now()
    for (const s of sim.sources) {
      sim.fluid.addHeat(s.x, s.y, s.kind === 'hot' ? rate : -rate)
    }
    sim.fluid.step(SIM_DT)
    samples.push(performance.now() - t0)
  }
  const { mean, p95 } = stats(samples)
  return {
    name: label,
    mean,
    p95,
    detail: `网格 ${sim.fluid.nx}×${sim.fluid.ny}（${sim.fluid.engine}）`,
  }
}

/** 以指定引擎模式构造一个满载关卡（source 已放、已预热）。 */
function makeLoadedSimFor(mode: 'js' | 'wasm'): LevelSimulation {
  setFluidEngine(mode)
  const sim = makeLoadedSim()
  setFluidEngine('auto')
  return sim
}

export function runBench(opts: BenchOptions = {}): BenchStat[] {
  const seconds = opts.seconds ?? 20
  const steps = Math.round(seconds / SIM_DT)
  const results: BenchStat[] = []
  const progress = opts.onProgress ?? (() => {})

  // 1. 流体求解器（含源注入）——整帧的主导 CPU 成本
  results.push(fluidBench(makeLoadedSimFor('js'), steps, 'fluid.step（JS）'))
  progress(0.25)

  if (opts.includeWasm && wasmFluidAvailable()) {
    results.push(fluidBench(makeLoadedSimFor('wasm'), steps, 'fluid.step（wasm）'))
  }
  progress(0.5)

  // 2. 完整关卡步进（刚体 + 源 + 流体）——按游戏实际引擎选择
  {
    const s2 = makeLoadedSim()
    const samples: number[] = []
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now()
      s2.step(SIM_DT)
      samples.push(performance.now() - t0)
    }
    const { mean, p95 } = stats(samples)
    results.push({ name: 'LevelSim.step', mean, p95, detail: `流体+刚体+源（${s2.fluid.engine}）` })
  }
  progress(0.7)

  // 3. 示踪粒子推进
  {
    const s3 = makeLoadedSim()
    const tracers = new Tracers(BENCH_TRACER_COUNT, LEVEL_1.world, ground1, BENCH_TRAIL_LEN)
    for (let i = 0; i < 600; i++) tracers.step(SIM_DT, s3.fluid, s3.sources)
    const samples: number[] = []
    for (let i = 0; i < steps; i++) {
      s3.step(SIM_DT)
      const t0 = performance.now()
      tracers.step(SIM_DT, s3.fluid, s3.sources)
      samples.push(performance.now() - t0)
    }
    const { mean, p95 } = stats(samples)
    results.push({
      name: 'tracers.step',
      mean,
      p95,
      detail: `${BENCH_TRACER_COUNT} 粒子 × ${BENCH_TRAIL_LEN} 轨迹点`,
    })
  }
  progress(0.85)

  // 4. 顶点批构建（渲染侧 CPU）：最坏 9600 段描边 + 400 头部点
  {
    const batch = new MeshBatch()
    const n = 9600
    const samples: number[] = []
    for (let iter = 0; iter < 240; iter++) {
      batch.reset()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        const x = (i % 100) * 0.7
        const y = ((i / 100) | 0) * 0.7
        batch.stroke(x, y, x + 0.55, y + 0.12, 0.3, 0.8, 0.4, 0.2, 0.1)
      }
      for (let i = 0; i < 400; i++) {
        batch.disc((i % 20) * 3, ((i / 20) | 0) * 3, 0.3, 0.3, 0, 10, 0.5, 0.5, 0.5, 0.5)
      }
      samples.push(performance.now() - t0)
    }
    const { mean, p95 } = stats(samples)
    results.push({ name: 'batch 构建', mean, p95, detail: `${n} stroke + 400 disc` })
  }

  // 5. 倍速帧：rate×（关卡步进+粒子）+ 批构建 = 游戏在倍速下每 60Hz 帧的真实 CPU 成本
  //   （不含 GL 绘制/合成——那部分由 GPU 承担，CPU 侧这是全貌）
  {
    const rate = opts.rate ?? 16
    const s5 = makeLoadedSim()
    const tracers = new Tracers(BENCH_TRACER_COUNT, LEVEL_1.world, ground1, BENCH_TRAIL_LEN)
    const batch = new MeshBatch()
    const samples: number[] = []
    for (let i = 0; i < 300; i++) s5.step(SIM_DT)
    for (let iter = 0; iter < 240; iter++) {
      const t0 = performance.now()
      for (let t = 0; t < rate; t++) {
        s5.step(SIM_DT)
        tracers.step(SIM_DT, s5.fluid, s5.sources)
      }
      batch.reset()
      for (let i = 0; i < 9600; i++) {
        batch.stroke((i % 100) * 0.7, ((i / 100) | 0) * 0.7, (i % 100) * 0.7 + 0.55, ((i / 100) | 0) * 0.7 + 0.12, 0.3, 0.8, 0.4, 0.2, 0.1)
      }
      for (let i = 0; i < 400; i++) {
        batch.disc((i % 20) * 3, ((i / 20) | 0) * 3, 0.3, 0.3, 0, 10, 0.5, 0.5, 0.5, 0.5)
      }
      samples.push(performance.now() - t0)
    }
    const { mean, p95 } = stats(samples)
    results.push({
      name: `倍速帧 ${rate}×`,
      mean,
      p95,
      detail: `${rate} tick(步进+粒子) + 批构建；>16.7ms 即掉帧`,
    })
  }
  progress(1)
  return results
}
