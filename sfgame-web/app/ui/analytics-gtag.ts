import { analytics, type AnalyticsEvent, type AnalyticsTransport } from '../core/analytics.ts'

function toGtagParams(e: AnalyticsEvent): Gtag.CustomParams {
  const p = e.payload
  const base: Gtag.CustomParams = {
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
  const transport: AnalyticsTransport = (e) => {
    if (typeof gtag === 'function') gtag('event', e.type, toGtagParams(e))
  }
  analytics.transport = transport
}
