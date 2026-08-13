// 传输适配器：唯一知道 gtag/dataLayer 的模块。换上报服务 = 新建 ui/analytics-*.ts + main.ts 换装配。
// 事件必须经 window.gtag('event', ...) 发送：gtag.js 加载后会替换 gtag 为 loader 实现（命令转内部对象并执行）；
// 直接 dataLayer.push 数组/对象都不产生 collect（对象是 GTM 容器协议，纯 GA4 无效）
import { analytics, type AnalyticsEvent, type AnalyticsTransport } from '../core/analytics.ts'

// GA 参数映射（snake_case）与值域清洗：GA 命名/限制的知识只在这一层
function toGtagParams(e: AnalyticsEvent): Record<string, unknown> {
  const p = e.payload
  const base: Record<string, unknown> = {
    level_id: p.levelId,
    level_name: p.levelName,
  }
  if (e.type === 'level_start') return base
  const c = e.payload
  return {
    ...base,
    time: c.time,
    extra: c.extra,
    sources: c.sources,
    total_time: c.totalTime,
    new_record: c.newRecord,
  }
}

export function mountGtagAnalytics(): void {
  // 惰性重取：gtag.js 可能晚于本装配加载（广告拦截/网络时序），mount 时缓存会把事件永久丢进 noop
  const transport: AnalyticsTransport = (e) => {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag
    if (typeof gtag === 'function') gtag('event', e.type, toGtagParams(e))
  }
  analytics.transport = transport
}
