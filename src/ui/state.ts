import { UrlState, codecs, type UrlStateListCodec } from '../core/url-state'
import type { SourcePlacement } from '../game/types'

/** sources 列表项："x,y,kind"（kind: hot|cold），非法项整体丢弃。 */
const sourceItem: UrlStateListCodec<SourcePlacement> = {
  encode(s) {
    return `${s.x.toFixed(1)},${s.y.toFixed(1)},${s.kind}`
  },
  decode(raw) {
    const parts = raw.split(',')
    if (parts.length !== 3) return null
    const x = Number(parts[0])
    const y = Number(parts[1])
    const kind = parts[2]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (kind !== 'hot' && kind !== 'cold') return null
    return { x, y, kind }
  },
}

/** 应用级 URL 状态 schema（单例）：level 直达关卡、sources 实时双向同步、dev 开发者模式。 */
export const urlState = new UrlState({
  level: codecs.int(null, 1, 99),
  sources: codecs.list<SourcePlacement>([], sourceItem, ';'),
  dev: codecs.bool(false),
})
