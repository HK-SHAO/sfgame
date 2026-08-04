import { UrlState, codecs, type UrlStateListCodec } from '../core/url-state'
import type { SourcePlacement } from './types'

/** 坐标 1 位小数，整数去掉尾部 .0（20.0 → 20）。 */
export const num = (v: number) => {
  const s = v.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** sources 列表项："x-y-k"（k: h/c）；`-` 与 `_` 均为 URL 免编码字符，全程零百分号转义。 */
export const sourceItem: UrlStateListCodec<SourcePlacement> = {
  encode(s) {
    return `${num(s.x)}-${num(s.y)}-${s.kind === 'hot' ? 'h' : 'c'}`
  },
  decode(raw) {
    const [xs, ys, ks] = raw.split('-')
    const x = Number(xs)
    const y = Number(ys)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    const kind = ks === 'h' ? 'hot' : ks === 'c' ? 'cold' : null
    return kind ? { x, y, kind } : null
  },
}

/** 页面视图：默认 title（无 view 参数）；solutions 为唯一显式值（解法参考页）。 */
export type AppView = 'title' | 'solutions'

/** 应用级 URL 状态 schema（单例）：level 直达关卡、sources 实时双向同步、
 * view 记录页面视图（解法参考页刷新不丢失）。
 * 例：?level=1&sources=20-44-h_36-28-h、?view=solutions */
export const urlState = new UrlState({
  level: codecs.int(null, 1, 99),
  sources: codecs.list<SourcePlacement>([], sourceItem, '_'),
  view: codecs.enum<AppView>('title', ['solutions']),
})
