import { describe, expect, it } from 'vitest'
import { analytics, cappedPush, type AnalyticsEvent } from '../app/core/analytics.ts'

const complete: AnalyticsEvent = {
  type: 'level_complete',
  payload: {
    levelId: 'luo-yu',
    levelName: '落羽',
    group: '长风',
    time: 12.5,
    extra: 4,
    sources: 2,
    totalTime: 16.5,
    newRecord: true,
  },
}

describe('analytics', () => {
  it('emit 透传事件', () => {
    const spy: AnalyticsEvent[] = []
    analytics.transport = (e) => spy.push(e)
    analytics.emit(complete)
    expect(spy).toHaveLength(1)
    expect(spy[0]).toEqual(complete)
  })

  it('传输抛错被吞，不影响后续事件', () => {
    const spy: AnalyticsEvent[] = []
    analytics.transport = () => {
      throw new Error('boom')
    }
    expect(() => analytics.emit(complete)).not.toThrow()
    analytics.transport = (e) => spy.push(e)
    analytics.emit(complete)
    expect(spy).toHaveLength(1)
  })

  it('cappedPush 队列封顶丢最旧', () => {
    const q: unknown[] = []
    for (let i = 0; i < 5; i++) cappedPush(q, i, 3)
    expect(q).toEqual([2, 3, 4])
  })
})
