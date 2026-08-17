import { analytics, type AnalyticsEvent, type AnalyticsTransport } from '../core/analytics.ts'

const GA_ID = 'G-16BW99KEFB'

type GtagPush = (...args: unknown[]) => number

function injectSnippet(): GtagPush {
  const w = window as unknown as { dataLayer?: unknown[][]; gtag?: GtagPush }
  w.dataLayer ??= []
  const push: GtagPush = (...args) => w.dataLayer!.push(args)
  w.gtag = push
  push('consent', 'default', { ad_storage: 'denied', analytics_storage: 'granted', personalization_storage: 'denied' })
  push('js', new Date())
  push('config', GA_ID)
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
  return push
}

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
  const push = injectSnippet()
  const transport: AnalyticsTransport = (e) => {
    push('event', e.type, toGtagParams(e))
  }
  analytics.transport = transport
}
