// 语义事件 schema + 传输注入点：业务侧只发语义事件；gtag/自建等传输由 ui 适配器装配。
// 换上报服务 = 实现 AnalyticsTransport 的新适配器 + main.ts 换装配，schema 与触发点零改动。
// transport 可注入是 core 无 DOM 的浏览器面注入约定（与 url-state 的 URL 源同款）。
export interface LevelStartPayload {
  levelId: string
  levelName: string
}

export interface LevelCompletePayload extends LevelStartPayload {
  time: number
  extra: number
  sources: number
  totalTime: number
  newRecord: boolean
}

export type AnalyticsEvent =
  | { type: 'level_start'; payload: LevelStartPayload }
  | { type: 'level_complete'; payload: LevelCompletePayload }

export type AnalyticsTransport = (event: AnalyticsEvent) => void

export const analytics = {
  transport: (() => {}) as AnalyticsTransport,
  // 分析永不破坏游戏：传输异常全吞掉（广告拦截/离线是常态，warn 会刷屏）
  emit(e: AnalyticsEvent) {
    try {
      analytics.transport(e)
    } catch {
      // 静默
    }
  },
}
