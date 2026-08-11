// 传输适配器：唯一知道 gtag/dataLayer 的模块。换上报服务 = 新建 ui/analytics-*.ts + main.ts 换装配。
// 直接 push dataLayer 而非 gtag('event')：广告拦截只杀 gtag fn，dataLayer 仍在，事件照常入队等加载器冲刷
import { analytics, cappedPush, type AnalyticsEvent, type AnalyticsTransport } from '../core/analytics.ts'

const QUEUE_CAP = 100

// GA 参数映射（snake_case）与值域清洗：GA 命名/限制的知识只在这一层
function toGtag(e: AnalyticsEvent): Record<string, unknown> {
  const base = {
    event: e.type,
    level_id: e.payload.levelId,
    level_name: e.payload.levelName,
    ...(e.payload.group !== undefined ? { group: e.payload.group } : {}),
  }
  if (e.type === 'level_start') return base
  const p = e.payload
  return {
    ...base,
    time: p.time,
    extra: p.extra,
    sources: p.sources,
    total_time: p.totalTime,
    new_record: p.newRecord,
  }
}

export function mountGtagAnalytics(): void {
  const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer
  if (dl === undefined) return
  const transport: AnalyticsTransport = (e) => cappedPush(dl, toGtag(e), QUEUE_CAP)
  analytics.transport = transport
}
