// 流体内核 SIMD 入口（--enable simd）。f64x2 车道运算与 JS 的 f64 中间量语义逐位一致——
// 混沌流场（李雅普诺夫放大）下任何 f32 舍入都会指数放大并破坏解法可通关性，故全部场运算保持 f64；
// 存储仍为 f32（与 JS 一致），load/store 侧做 promote/demote。半拉格朗日回溯（gather）保持标量。
export {
  init,
  clear,
  setAmbient,
  rebuildSolid,
  addHeat,
  addForce,
  sampleVelocity,
  outX,
  outY,
  sampleTemp,
  fieldU,
  fieldV,
  fieldT,
  solidBuf,
} from './core'

import {
  u,
  v,
  t,
  u0,
  v0,
  t0,
  q1,
  q2,
  p,
  div,
  divH2,
  solid,
  solidF,
  inGroup,
  coreGroup,
  bndEven,
  bndOdd,
  coreGroupN,
  bndEvenN,
  bndOddN,
  nx,
  ny,
  cell,
  buoyancy,
  iterations,
  velDamping,
  tDamping,
  vorticity,
  applyVorticity,
  copyFields,
  advectPass,
  correctCell,
  enforceBoundary,
} from './core'

const B = 4

// f32x4 的高半对：promote_low + 自交换 shuffle（AS 无 promote_high 内建）
function hiOf(v4: v128): v128 {
  return f64x2.promote_low_f32x4(f32x4.shuffle(v4, v4, 2, 3, 0, 0))
}

export function applyBuoyancy(dt: f64): void {
  const k = buoyancy * dt
  const kV = f64x2.splat(k)
  const vB = v.dataStart
  const tB = t.dataStart
  const w = nx
  for (let j = 1; j < ny - 1; j++) {
    const row = j * w
    let i = 1
    for (; i <= w - 5; i += 4) {
      const off = (row + i) * B
      const tv = v128.load(tB + off)
      const vv = v128.load(vB + off)
      const lo = f64x2.sub(f64x2.promote_low_f32x4(vv), f64x2.mul(f64x2.promote_low_f32x4(tv), kV))
      const hi = f64x2.sub(hiOf(vv), f64x2.mul(hiOf(tv), kV))
      v128.store(
        vB + off,
        f32x4.shuffle(f32x4.demote_f64x2_zero(lo), f32x4.demote_f64x2_zero(hi), 0, 1, 4, 5),
      )
    }
    for (; i <= w - 2; i++) {
      const idx = row + i
      v[idx] = <f32>(<f64>v[idx] - k * <f64>t[idx])
    }
  }
}

// 每趟 4 格：低对 (i,i+1) + 高对 (i+2,i+3)，promote 到 f64x2 运算，demote+shuffle 拼回连续 4 格写回；
// 固体格由 solidF 掩码 bitselect 归零（同奇偶格互不依赖，车道组乱序安全）
function advectCorrectSimd(dst: Float32Array, src: Float32Array, damping: f64): void {
  const w = nx
  const dampV = f64x2.splat(damping)
  const zeroV = f64x2.splat(0)
  const halfV = f64x2.splat(0.5)
  const srcBase = src.dataStart
  const q1Base = q1.dataStart
  const q2Base = q2.dataStart
  const dstBase = dst.dataStart
  const mBase = solidF.dataStart
  for (let j = 1; j < ny - 1; j++) {
    const row = j * w
    let i = 1
    for (; i <= w - 5; i += 4) {
      const off = (row + i) * B

      let loMin = f64x2.promote_low_f32x4(v128.load(srcBase + off))
      let loMax = loMin
      let hiMin = hiOf(v128.load(srcBase + off))
      let hiMax = hiMin
      let lo: v128
      let hi: v128
      lo = v128.load(srcBase + off - (w + 1) * B)
      hi = v128.load(srcBase + off + 2 * B - (w + 1) * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off - w * B)
      hi = v128.load(srcBase + off + 2 * B - w * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off - (w - 1) * B)
      hi = v128.load(srcBase + off + 2 * B - (w - 1) * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off - B)
      hi = v128.load(srcBase + off + 2 * B - B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off + B)
      hi = v128.load(srcBase + off + 2 * B + B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off + (w - 1) * B)
      hi = v128.load(srcBase + off + 2 * B + (w - 1) * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off + w * B)
      hi = v128.load(srcBase + off + 2 * B + w * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))
      lo = v128.load(srcBase + off + (w + 1) * B)
      hi = v128.load(srcBase + off + 2 * B + (w + 1) * B)
      loMin = f64x2.min(loMin, f64x2.promote_low_f32x4(lo))
      loMax = f64x2.max(loMax, f64x2.promote_low_f32x4(lo))
      hiMin = f64x2.min(hiMin, hiOf(lo))
      hiMax = f64x2.max(hiMax, hiOf(lo))

      const scLo = f64x2.promote_low_f32x4(v128.load(srcBase + off))
      const scHi = hiOf(v128.load(srcBase + off))
      const q1Lo = f64x2.promote_low_f32x4(v128.load(q1Base + off))
      const q1Hi = hiOf(v128.load(q1Base + off))
      const q2Lo = f64x2.promote_low_f32x4(v128.load(q2Base + off))
      const q2Hi = hiOf(v128.load(q2Base + off))
      let valLo = f64x2.add(q1Lo, f64x2.mul(f64x2.sub(scLo, q2Lo), halfV))
      let valHi = f64x2.add(q1Hi, f64x2.mul(f64x2.sub(scHi, q2Hi), halfV))
      valLo = f64x2.mul(f64x2.min(f64x2.max(valLo, loMin), loMax), dampV)
      valHi = f64x2.mul(f64x2.min(f64x2.max(valHi, hiMin), hiMax), dampV)

      const keepLo = f64x2.eq(f64x2.promote_low_f32x4(v128.load(mBase + off)), zeroV)
      const keepHi = f64x2.eq(hiOf(v128.load(mBase + off)), zeroV)
      valLo = v128.bitselect(valLo, zeroV, keepLo)
      valHi = v128.bitselect(valHi, zeroV, keepHi)
      const packed = f32x4.shuffle(
        f32x4.demote_f64x2_zero(valLo),
        f32x4.demote_f64x2_zero(valHi),
        0,
        1,
        4,
        5,
      )
      v128.store(dstBase + off, packed)
    }
    for (; i < w - 1; i++) {
      correctCell(row + i, dst, src, damping)
    }
  }
}

function advectMacCormack(dst: Float32Array, src: Float32Array, dt: f64, damping: f64): void {
  advectPass(q1, src, dt, 1)
  advectPass(q2, q1, dt, -1)
  advectCorrectSimd(dst, src, damping)
}

// 散度 + divH2 预乘：8 格组红黑双车道 f64x2（u/v 本趟不变，双奇偶可同趟融合），余部标量替换分支
function projectDiv(): void {
  const h = cell
  const inv2h = 1 / (2 * h)
  const h2 = h * h
  const w = nx
  const uB = u.dataStart
  const vB = v.dataStart
  const dB = div.dataStart
  const inv2hV = f64x2.splat(inv2h)
  for (let g = 0; g < coreGroupN; g++) {
    const off = <usize>coreGroup[g] * B
    const uLr4 = f32x4.shuffle(v128.load(uB + off - B), v128.load(uB + off + 12), 0, 2, 4, 6)
    const uRr4 = f32x4.shuffle(v128.load(uB + off + B), v128.load(uB + off + 16), 0, 2, 5, 7)
    const vUr4 = f32x4.shuffle(v128.load(vB + off - w * B), v128.load(vB + off - w * B + 16), 0, 2, 4, 6)
    const vDr4 = f32x4.shuffle(v128.load(vB + off + w * B), v128.load(vB + off + w * B + 16), 0, 2, 4, 6)
    const uLb4 = f32x4.shuffle(v128.load(uB + off), v128.load(uB + off + 16), 0, 2, 4, 6)
    const uRb4 = f32x4.shuffle(v128.load(uB + off + 8), v128.load(uB + off + 24), 0, 2, 4, 6)
    const vUb4 = f32x4.shuffle(v128.load(vB + off - w * B + B), v128.load(vB + off - w * B + 20), 0, 2, 4, 6)
    const vDb4 = f32x4.shuffle(v128.load(vB + off + w * B + B), v128.load(vB + off + w * B + 20), 0, 2, 4, 6)

    const rLo = f64x2.mul(
      f64x2.add(
        f64x2.sub(f64x2.promote_low_f32x4(uRr4), f64x2.promote_low_f32x4(uLr4)),
        f64x2.sub(f64x2.promote_low_f32x4(vDr4), f64x2.promote_low_f32x4(vUr4)),
      ),
      inv2hV,
    )
    const rHi = f64x2.mul(
      f64x2.add(f64x2.sub(hiOf(uRr4), hiOf(uLr4)), f64x2.sub(hiOf(vDr4), hiOf(vUr4))),
      inv2hV,
    )
    const bLo = f64x2.mul(
      f64x2.add(
        f64x2.sub(f64x2.promote_low_f32x4(uRb4), f64x2.promote_low_f32x4(uLb4)),
        f64x2.sub(f64x2.promote_low_f32x4(vDb4), f64x2.promote_low_f32x4(vUb4)),
      ),
      inv2hV,
    )
    const bHi = f64x2.mul(
      f64x2.add(f64x2.sub(hiOf(uRb4), hiOf(uLb4)), f64x2.sub(hiOf(vDb4), hiOf(vUb4))),
      inv2hV,
    )
    const dLo = f32x4.demote_f64x2_zero(rLo)
    const dHi = f32x4.demote_f64x2_zero(rHi)
    const bLo4 = f32x4.demote_f64x2_zero(bLo)
    const bHi4 = f32x4.demote_f64x2_zero(bHi)
    v128.store(dB + off, f32x4.shuffle(dLo, bLo4, 0, 4, 1, 5))
    v128.store(dB + off + 16, f32x4.shuffle(dHi, bHi4, 0, 4, 1, 5))
  }
  for (let j = 1; j < ny - 1; j++) {
    const row = j * w
    for (let i = 1; i <= w - 2; i++) {
      const idx = i + row
      if (solid[idx]) {
        div[idx] = 0
        p[idx] = 0
        continue
      }
      if (inGroup[idx]) continue
      const uR = solid[idx + 1] ? 0 : <f64>u[idx + 1]
      const uL = solid[idx - 1] ? 0 : <f64>u[idx - 1]
      const vD = solid[idx + nx] ? 0 : <f64>v[idx + nx]
      const vU = solid[idx - nx] ? 0 : <f64>v[idx - nx]
      div[idx] = <f32>((uR - uL + vD - vU) * inv2h)
    }
  }
  const n = nx * ny
  for (let i = 0; i < n; i++) divH2[i] = h2 * <f64>div[i]
}

// 8 格组红黑双趟 GS：红趟只写偶车道（黑车道位保留），黑趟读本趟红值——与逐行红黑扫描同语义。
// 车道 = (s, s+2, s+4, s+6)：stencil 邻居同为步 2，每方向两次 load 相隔 16 字节 + (0,2,4,6) 抽签；
// f32 存储 → promote 到 f64x2 车道运算 → demote + 掩码回写
function sweepRed(off: usize, pB: usize, hB: usize, w: i32, H25: v128): void {
  const pL4 = f32x4.shuffle(v128.load(pB + off - B), v128.load(pB + off + 12), 0, 2, 4, 6)
  const pR4 = f32x4.shuffle(v128.load(pB + off + B), v128.load(pB + off + 16), 0, 2, 5, 7)
  const pU4 = f32x4.shuffle(v128.load(pB + off - w * B), v128.load(pB + off - w * B + 16), 0, 2, 4, 6)
  const pD4 = f32x4.shuffle(v128.load(pB + off + w * B), v128.load(pB + off + w * B + 16), 0, 2, 4, 6)
  const pLLo = f64x2.promote_low_f32x4(pL4)
  const pRLo = f64x2.promote_low_f32x4(pR4)
  const pULo = f64x2.promote_low_f32x4(pU4)
  const pDLo = f64x2.promote_low_f32x4(pD4)
  const pLHi = hiOf(pL4)
  const pRHi = hiOf(pR4)
  const pUHi = hiOf(pU4)
  const pDHi = hiOf(pD4)
  const d2Lo = f64x2.shuffle(v128.load(hB + 2 * off), v128.load(hB + 2 * off + 16), 0, 2)
  const d2Hi = f64x2.shuffle(v128.load(hB + 2 * off + 32), v128.load(hB + 2 * off + 48), 0, 2)
  const valLo = f64x2.mul(
    f64x2.sub(f64x2.add(f64x2.add(f64x2.add(pLLo, pRLo), pULo), pDLo), d2Lo),
    H25,
  )
  const valHi = f64x2.mul(
    f64x2.sub(f64x2.add(f64x2.add(f64x2.add(pLHi, pRHi), pUHi), pDHi), d2Hi),
    H25,
  )
  const lo2 = f32x4.demote_f64x2_zero(valLo)
  const hi2 = f32x4.demote_f64x2_zero(valHi)
  const cur0 = v128.load(pB + off)
  const cur8 = v128.load(pB + off + 16)
  v128.store(pB + off, f32x4.shuffle(lo2, cur0, 0, 5, 1, 7))
  v128.store(pB + off + 16, f32x4.shuffle(hi2, cur8, 0, 5, 1, 7))
}

function sweepBlack(off: usize, pB: usize, hB: usize, w: i32, H25: v128): void {
  const pL4 = f32x4.shuffle(v128.load(pB + off), v128.load(pB + off + 16), 0, 2, 4, 6)
  const pR4 = f32x4.shuffle(v128.load(pB + off + 8), v128.load(pB + off + 24), 0, 2, 4, 6)
  const pU4 = f32x4.shuffle(v128.load(pB + off - w * B + B), v128.load(pB + off - w * B + 20), 0, 2, 4, 6)
  const pD4 = f32x4.shuffle(v128.load(pB + off + w * B + B), v128.load(pB + off + w * B + 20), 0, 2, 4, 6)
  const pLLo = f64x2.promote_low_f32x4(pL4)
  const pRLo = f64x2.promote_low_f32x4(pR4)
  const pULo = f64x2.promote_low_f32x4(pU4)
  const pDLo = f64x2.promote_low_f32x4(pD4)
  const pLHi = hiOf(pL4)
  const pRHi = hiOf(pR4)
  const pUHi = hiOf(pU4)
  const pDHi = hiOf(pD4)
  const d2Lo = f64x2.shuffle(v128.load(hB + 2 * off + 8), v128.load(hB + 2 * off + 24), 0, 2)
  const d2Hi = f64x2.shuffle(v128.load(hB + 2 * off + 40), v128.load(hB + 2 * off + 56), 0, 2)
  const valLo = f64x2.mul(
    f64x2.sub(f64x2.add(f64x2.add(f64x2.add(pLLo, pRLo), pULo), pDLo), d2Lo),
    H25,
  )
  const valHi = f64x2.mul(
    f64x2.sub(f64x2.add(f64x2.add(f64x2.add(pLHi, pRHi), pUHi), pDHi), d2Hi),
    H25,
  )
  const lo2 = f32x4.demote_f64x2_zero(valLo)
  const hi2 = f32x4.demote_f64x2_zero(valHi)
  const cur0 = v128.load(pB + off)
  const cur8 = v128.load(pB + off + 16)
  v128.store(pB + off, f32x4.shuffle(cur0, lo2, 0, 4, 2, 5))
  v128.store(pB + off + 16, f32x4.shuffle(cur8, hi2, 0, 4, 2, 5))
}

function sweepBnd(list: Int32Array, n: i32): void {
  for (let k = 0; k < n; k++) {
    const idx = list[k]
    const pL = solid[idx - 1] ? <f64>p[idx] : <f64>p[idx - 1]
    const pR = solid[idx + 1] ? <f64>p[idx] : <f64>p[idx + 1]
    const pU = solid[idx - nx] ? <f64>p[idx] : <f64>p[idx - nx]
    const pD = solid[idx + nx] ? <f64>p[idx] : <f64>p[idx + nx]
    p[idx] = <f32>((pL + pR + pU + pD - divH2[idx]) * 0.25)
  }
}

// 逐行红黑扫描（与 JS project 完全同构）：nx 偶数时组车道会读到本趟已更新的同奇偶格，退化为标量保证语义
function sweepScalarAll(): void {
  for (let it = 0; it < iterations; it++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let j = 1; j < ny - 1; j++) {
        const i0 = (parity ^ (j & 1)) & 1 ? 1 : 2
        const row = j * nx
        for (let i = i0; i < nx - 1; i += 2) {
          const idx = i + row
          if (solid[idx]) continue
          const pL = solid[idx - 1] ? <f64>p[idx] : <f64>p[idx - 1]
          const pR = solid[idx + 1] ? <f64>p[idx] : <f64>p[idx + 1]
          const pU = solid[idx - nx] ? <f64>p[idx] : <f64>p[idx - nx]
          const pD = solid[idx + nx] ? <f64>p[idx] : <f64>p[idx + nx]
          p[idx] = <f32>((pL + pR + pU + pD - divH2[idx]) * 0.25)
        }
      }
    }
  }
}

// 红黑 Gauss-Seidel + warm-start 压强（与 JS project 同构，12 迭代收敛）：组车道 f64x2，余部标量替换分支。
// 组首格 s ≡ 1 (mod 8) → 车道奇偶 = (1+j)&1 随行翻转：奇行车道为偶相，偶行车道为奇相，须按行分发
function projectGS(): void {
  if (nx & 1) {
    const w = nx
    const pB = p.dataStart
    const hB = divH2.dataStart
    const H25 = f64x2.splat(0.25)
    for (let it = 0; it < iterations; it++) {
      for (let k = 0; k < coreGroupN; k++) {
        const off = <usize>coreGroup[k] * B
        if ((coreGroup[k] / nx) & 1) sweepRed(off, pB, hB, w, H25)
        else sweepBlack(off, pB, hB, w, H25)
      }
      sweepBnd(bndEven, bndEvenN)
      for (let k = 0; k < coreGroupN; k++) {
        const off = <usize>coreGroup[k] * B
        if ((coreGroup[k] / nx) & 1) sweepBlack(off, pB, hB, w, H25)
        else sweepRed(off, pB, hB, w, H25)
      }
      sweepBnd(bndOdd, bndOddN)
    }
  } else {
    sweepScalarAll()
  }
}

// 压强梯度回减：8 格组红黑双车道 f64x2，余部标量替换分支
function projectGrad(): void {
  const h = cell
  const inv2h = 1 / (2 * h)
  const w = nx
  const uB = u.dataStart
  const vB = v.dataStart
  const pB = p.dataStart
  const inv2hV = f64x2.splat(inv2h)
  for (let g = 0; g < coreGroupN; g++) {
    const off = <usize>coreGroup[g] * B
    const pLr4 = f32x4.shuffle(v128.load(pB + off - B), v128.load(pB + off + 12), 0, 2, 4, 6)
    const pRr4 = f32x4.shuffle(v128.load(pB + off + B), v128.load(pB + off + 16), 0, 2, 5, 7)
    const pUr4 = f32x4.shuffle(v128.load(pB + off - w * B), v128.load(pB + off - w * B + 16), 0, 2, 4, 6)
    const pDr4 = f32x4.shuffle(v128.load(pB + off + w * B), v128.load(pB + off + w * B + 16), 0, 2, 4, 6)
    const pLb4 = f32x4.shuffle(v128.load(pB + off), v128.load(pB + off + 16), 0, 2, 4, 6)
    const pRb4 = f32x4.shuffle(v128.load(pB + off + 8), v128.load(pB + off + 24), 0, 2, 4, 6)
    const pUb4 = f32x4.shuffle(v128.load(pB + off - w * B + B), v128.load(pB + off - w * B + 20), 0, 2, 4, 6)
    const pDb4 = f32x4.shuffle(v128.load(pB + off + w * B + B), v128.load(pB + off + w * B + 20), 0, 2, 4, 6)

    const uLane4 = f32x4.shuffle(v128.load(uB + off), v128.load(uB + off + 16), 0, 2, 4, 6)
    const vLane4 = f32x4.shuffle(v128.load(vB + off), v128.load(vB + off + 16), 0, 2, 4, 6)
    const uBk4 = f32x4.shuffle(v128.load(uB + off), v128.load(uB + off + 16), 1, 3, 5, 7)
    const vBk4 = f32x4.shuffle(v128.load(vB + off), v128.load(vB + off + 16), 1, 3, 5, 7)
    const uLaneLo = f64x2.promote_low_f32x4(uLane4)
    const vLaneLo = f64x2.promote_low_f32x4(vLane4)
    const uLaneHi = hiOf(uLane4)
    const vLaneHi = hiOf(vLane4)
    const uBkLo = f64x2.promote_low_f32x4(uBk4)
    const vBkLo = f64x2.promote_low_f32x4(vBk4)
    const uBkHi = hiOf(uBk4)
    const vBkHi = hiOf(vBk4)

    const urLo = f64x2.sub(
      uLaneLo,
      f64x2.mul(f64x2.sub(f64x2.promote_low_f32x4(pRr4), f64x2.promote_low_f32x4(pLr4)), inv2hV),
    )
    const vrLo = f64x2.sub(
      vLaneLo,
      f64x2.mul(f64x2.sub(f64x2.promote_low_f32x4(pDr4), f64x2.promote_low_f32x4(pUr4)), inv2hV),
    )
    const urHi = f64x2.sub(uLaneHi, f64x2.mul(f64x2.sub(hiOf(pRr4), hiOf(pLr4)), inv2hV))
    const vrHi = f64x2.sub(vLaneHi, f64x2.mul(f64x2.sub(hiOf(pDr4), hiOf(pUr4)), inv2hV))
    const ubLo = f64x2.sub(
      uBkLo,
      f64x2.mul(f64x2.sub(f64x2.promote_low_f32x4(pRb4), f64x2.promote_low_f32x4(pLb4)), inv2hV),
    )
    const vbLo = f64x2.sub(
      vBkLo,
      f64x2.mul(f64x2.sub(f64x2.promote_low_f32x4(pDb4), f64x2.promote_low_f32x4(pUb4)), inv2hV),
    )
    const ubHi = f64x2.sub(uBkHi, f64x2.mul(f64x2.sub(hiOf(pRb4), hiOf(pLb4)), inv2hV))
    const vbHi = f64x2.sub(vBkHi, f64x2.mul(f64x2.sub(hiOf(pDb4), hiOf(pUb4)), inv2hV))

    // 红黑同趟融合写回：红车道 (s,s+2,s+4,s+6) 与黑车道 (s+1,s+3,s+5,s+7) 一次拼成连续 8 格
    const uLo4 = f32x4.demote_f64x2_zero(urLo)
    const uHi4 = f32x4.demote_f64x2_zero(urHi)
    const uBkLo4 = f32x4.demote_f64x2_zero(ubLo)
    const uBkHi4 = f32x4.demote_f64x2_zero(ubHi)
    const vLo4 = f32x4.demote_f64x2_zero(vrLo)
    const vHi4 = f32x4.demote_f64x2_zero(vrHi)
    const vBkLo4 = f32x4.demote_f64x2_zero(vbLo)
    const vBkHi4 = f32x4.demote_f64x2_zero(vbHi)
    v128.store(uB + off, f32x4.shuffle(uLo4, uBkLo4, 0, 4, 1, 5))
    v128.store(uB + off + 16, f32x4.shuffle(uHi4, uBkHi4, 0, 4, 1, 5))
    v128.store(vB + off, f32x4.shuffle(vLo4, vBkLo4, 0, 4, 1, 5))
    v128.store(vB + off + 16, f32x4.shuffle(vHi4, vBkHi4, 0, 4, 1, 5))
  }
  for (let j = 1; j < ny - 1; j++) {
    const row = j * w
    for (let i = 1; i <= w - 2; i++) {
      const idx = i + row
      if (solid[idx] || inGroup[idx]) continue
      const pL = solid[idx - 1] ? <f64>p[idx] : <f64>p[idx - 1]
      const pR = solid[idx + 1] ? <f64>p[idx] : <f64>p[idx + 1]
      const pU = solid[idx - nx] ? <f64>p[idx] : <f64>p[idx - nx]
      const pD = solid[idx + nx] ? <f64>p[idx] : <f64>p[idx + nx]
      u[idx] = <f32>(<f64>u[idx] - (pR - pL) * inv2h)
      v[idx] = <f32>(<f64>v[idx] - (pD - pU) * inv2h)
    }
  }
}

function project(): void {
  projectDiv()
  projectGS()
  projectGrad()
}

export function step(dt: f64): void {
  applyBuoyancy(dt)
  if (vorticity > 0) applyVorticity(dt)

  copyFields()
  advectMacCormack(u, u0, dt, velDamping)
  advectMacCormack(v, v0, dt, velDamping)
  advectMacCormack(t, t0, dt, tDamping)

  project()
  enforceBoundary()
}
