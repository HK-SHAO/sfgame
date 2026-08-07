import { UrlState, codecs, type UrlStateListCodec } from '../core/url-state'
import type { SourcePlacement } from './types'

// 坐标 1 位小数，整数去掉尾部 .0（20.0 → 20）
export const num = (v: number) => {
  const s = v.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

// sources 列表项 "x-y-k"（k: h/c）；`-` 与 `_` 均为 URL 免编码字符，全程零百分号转义
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

export type AppView = 'title' | 'dev' | 'storage'

export const urlState = new UrlState({
  // lv=0 为 dev 面板编辑槽（默认内容 = 第 1 关，见 session.ts）
  lv: codecs.int(null, 0, 99),
  src: codecs.list<SourcePlacement>([], sourceItem, '_'),
  v: codecs.enum<AppView>('title', ['dev', 'storage']),
  dev: codecs.bool(false),
})
