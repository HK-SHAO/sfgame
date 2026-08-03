import type { LevelSimulation } from './simulation'
import type { SourceKind } from '../sim/types'
import { LEVEL_1 } from './levels'

/** 自动播放时间表条目：模拟玩家在某时刻点击放置一个源。 */
export interface AgentStep {
  /** 模拟时刻（秒），到达后放置 */
  t: number
  x: number
  y: number
  kind: SourceKind
}

/** 第一关参考答案（基准通关方案）：谷底托起 → 崖脚接力 → 崖顶推进 → 目标前托举。
 * 时刻分散为"像玩家一样逐个操作"（探针校准：全部同时放置反而更慢）；
 * 坐标即玩家点击位置（placeSource 负责吸附校验）。 */
export const LEVEL_1_REFERENCE: AgentStep[] = [
  { t: 0.5, x: 20, y: 44, kind: 'hot' },
  { t: 2, x: 36, y: 28, kind: 'hot' },
  { t: 4.5, x: 50, y: 16, kind: 'hot' },
  { t: 7, x: 58, y: 14, kind: 'hot' },
]

/** 关卡 → 自动播放参考答案；未知关卡返回 null（无方案，Agent 静默不操作）。 */
export function agentStepsFor(levelId: number): AgentStep[] | null {
  return levelId === LEVEL_1.id ? LEVEL_1_REFERENCE : null
}

/**
 * 开发者模式的自动播放 Agent（无头、确定性）。
 * 模拟用户逐次放置参考答案热源，物理自然演化直至过关。
 * 只走 LevelSimulation 的公开 API（placeSource 自带预算/间距/地面吸附校验）。
 * 整个模块自包含：删除本文件与其调用点即可整体移除。
 */
export class LevelAgent {
  private steps: AgentStep[]
  private next = 0
  /** 脚本已放置的源数（与场上源集合一致性比对用） */
  private placed = 0

  constructor(steps: AgentStep[] = LEVEL_1_REFERENCE) {
    this.steps = steps
  }

  /**
   * 每模拟步调用：到点放置。一致性守卫——场上源数与脚本进度不符（玩家介入，
   * 如后退撤销）即永久停止让位。返回本步是否发生放置（调用方据此决定是否同步 URL）。
   */
  step(sim: LevelSimulation): boolean {
    if (sim.sources.length !== this.placed) return false
    let acted = false
    while (this.next < this.steps.length && sim.time >= this.steps[this.next].t) {
      const s = this.steps[this.next]
      sim.placeSource(s.x, s.y, s.kind)
      this.next++
      this.placed++
      acted = true
    }
    return acted
  }

  /** 重置播放进度（关卡 reset 后调用）。 */
  reset() {
    this.next = 0
    this.placed = 0
  }
}
