import { fromBase64Url, toBase64Url } from '../core/base64'
import { UrlState, codecs, type UrlStateCodec, type UrlStateListCodec } from '../core/url-state'
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

// lv 双形态：整数 = 内置关卡 id；内联关卡 JSON（dev 编辑生效即压入 URL，见 level-editor.ts）。
// 形态自判别无需前缀：id 为纯数字，base64url 必含字母（`eyJ` = `{"` 的固定编码，肉眼可辨）。
export type LvValue = number | string | null

export const lvCodec: UrlStateCodec<LvValue> = {
  encode(v) {
    if (v === null || v === '') return ''
    if (typeof v === 'number') return String(v)
    return toBase64Url(new TextEncoder().encode(v))
  },
  decode(raw) {
    if (raw === null || raw === '') return null
    // 纯数字 = 内置关卡 id，无数量上限（99 是旧 dev 槽时代的魔数，已无约束理由）；
    // 判别不依赖上限：合法 JSON 的 base64 必含字母，纯数字串永远不会是内联关卡
    if (/^\d+$/.test(raw)) {
      const n = Number(raw)
      return Number.isInteger(n) && n >= 1 && n <= Number.MAX_SAFE_INTEGER ? n : null
    }
    try {
      // fatal: 非法 UTF-8（损坏的 base64 输入）抛错回落 null，而非产出替换符垃圾串
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(raw))
      return text === '' ? null : text
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
