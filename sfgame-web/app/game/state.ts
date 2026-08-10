import { fromBase64Url, toBase64Url } from '../core/base64'
import { UrlState, codecs, type UrlStateCodec, type UrlStateListCodec } from '../core/url-state'
import { ID_PATTERN } from './level-validate'
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

export type AppView = 'title' | 'dev' | 'storage' | 'about'

// lv 双形态：{ id } = 内置关卡 slug（URL 直传零转义）；{ json } = 内联关卡文本（base64url，编辑器压入）。
// 判别 = 先 slug 后 JSON 的 fallback：slug 字符集（小写字母/数字/连字符）先验命中即归属内置，
// 其余再试 base64 解码——损坏载荷（非法字符/坏填充/非 UTF-8）一律落 null 由调用方净化
export type LvValue = { id: string } | { json: string } | null

export const lvCodec: UrlStateCodec<LvValue> = {
  encode(v) {
    if (v === null) return ''
    if ('id' in v) return v.id
    return toBase64Url(new TextEncoder().encode(v.json))
  },
  decode(raw) {
    if (raw === null || raw === '') return null
    if (ID_PATTERN.test(raw)) return { id: raw }
    try {
      // fatal: 非法 UTF-8（损坏的 base64 输入）抛错回落 null，而非产出替换符垃圾串
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(raw))
      return text === '' ? null : { json: text }
    } catch {
      return null
    }
  },
}

export const urlState = new UrlState({
  lv: lvCodec,
  // s = sources 摆法（1 字符：分享 URL 短）
  s: codecs.list<SourcePlacement>([], sourceItem, '_'),
  v: codecs.enum<AppView>('title', ['dev', 'storage', 'about']),
  dev: codecs.bool(false),
})
