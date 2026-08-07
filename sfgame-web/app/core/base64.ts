// utf8 字节 → base64url（无 padding，+/→-_）；btoa 不支持中文，故经字节编码。
// 字母表全为 URLSearchParams 直通字符，query 里全程零百分号转义
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)]
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)]
    if (i + 2 < bytes.length) out += B64[b2 & 63]
  }
  return out
}

// 宽松解码：字母表外字符跳过（对齐无 padding 的容错），返回解码字节
export function fromBase64Url(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let bit = 0
  let buf = 0
  let j = 0
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i])
    if (v < 0) continue
    buf = (buf << 6) | v
    bit += 6
    if (bit >= 8) {
      out[j++] = (buf >> (bit - 8)) & 0xff
      bit -= 8
    }
  }
  return out.subarray(0, j)
}
