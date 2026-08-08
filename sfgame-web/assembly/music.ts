// 音乐合成内核：物理建模钢琴（移植自 Shadertoy iq/penguin piano 的 mono 简化）+ bass 软饱和
// 离线烘焙 stem loop 到静态 PCM 缓冲，JS 侧零拷贝读走 → AudioBuffer 循环播放（播放零合成成本）
// 乐谱由 JS 写入 scoreBuf（f64 × 4：midi, startSec, durSec, vel），mClear 清缓冲，mRender 按音色累加
// 音色要义：非谐波拉伸 B 系数出钢琴钟感、失谐多弦出丰盈、力度 vel 控制亮度（同引擎分三轨层次）
// 性能要义：正弦查表 + 增量包络（exp 转逐采样乘子），每采样零超越函数调用（除一次 tanh）

const SR = 44100
const PCM_CAP = 1323000 // 30s × 44.1k
const SCORE_CAP = 256
const TAU = 6.28318530718
const N_PARTIAL = 14

const pcm = new StaticArray<f32>(PCM_CAP)
const scoreBuf = new StaticArray<f64>(SCORE_CAP * 4)
let pcmLen = 0

const SIN_N = 2048
const sinTab = new StaticArray<f32>(SIN_N + 1)
for (let i = 0; i <= SIN_N; i++) sinTab[i] = f32(Math.sin((TAU * f64(i)) / f64(SIN_N)))

// 单音符渲染状态（模块级复用，stub runtime 零分配）
const ph1 = new StaticArray<f64>(N_PARTIAL)
const ph2 = new StaticArray<f64>(N_PARTIAL)
const ph3 = new StaticArray<f64>(N_PARTIAL)
const dp1 = new StaticArray<f64>(N_PARTIAL)
const dp2 = new StaticArray<f64>(N_PARTIAL)
const dp3 = new StaticArray<f64>(N_PARTIAL)
const amp0 = new StaticArray<f64>(N_PARTIAL)
const ampN = new StaticArray<f64>(N_PARTIAL)
const decN = new StaticArray<f64>(N_PARTIAL)

export function mPcmBuf(): usize {
  return changetype<usize>(pcm)
}

export function mScoreBuf(): usize {
  return changetype<usize>(scoreBuf)
}

// 清零并返回本次 stem 采样数（上层传 loop 精确时长，尾音折回头部叠加 → 循环无缝）
export function mClear(sec: f64): i32 {
  pcmLen = min(PCM_CAP, i32(Mathf.ceil(f32(sec) * f32(SR))))
  for (let i = 0; i < pcmLen; i++) pcm[i] = 0
  return pcmLen
}

// 小叶子函数：-O3 下 binaryen 必然内联，不加 @inline（顶层装饰器非合法 TS 语法，IDE 报错）
function fract(x: f64): f64 {
  return x - Math.floor(x)
}

// ph ∈ [0,1) 转数制相位 → 查表正弦（线性插值）
function sinT(ph: f64): f32 {
  const x = ph * f64(SIN_N)
  const i = i32(x)
  const f = f32(x - f64(i))
  return sinTab[i] + (sinTab[i + 1] - sinTab[i]) * f
}

// 钢琴单音渲染进 pcm（penguinPiano mono 增量式）：k=midi, s0=起始采样, durSec=持续(释音点), v=力度
// 2.2s 后能量 <3% 直接截断（烘焙耗时大头在长音符）
function pianoVoice(k: f64, s0: i32, durSec: f64, v: f64): void {
  const f = 440.0 * Math.pow(2, (k - 69) / 12)
  let B = 0.00007 * Math.pow(1.4, Math.log2(max(f, 27.5) / 27.5))
  B = min(max(B, 0.00003), 0.035)
  const tau1 = 0.55 + 0.9 / (1 + f * 0.0018)
  const tau2 = 6 + 14 / (1 + f * 0.0008)
  const ns = f < 115 ? 1 : f < 290 ? 2 : 3

  let active = N_PARTIAL
  for (let i = 1; i <= N_PARTIAL; i++) {
    const n = f64(i)
    const fn = f * n * Math.sqrt(1 + B * n * n)
    if (fn > 13000) {
      active = i - 1
      break
    }
    const j = i - 1
    ph1[j] = fract(n * 0.618033988749) * 0.5 / TAU
    ph2[j] = ph1[j] + 0.3 / TAU
    ph3[j] = ph1[j] + 0.4 / TAU
    const fb = fn / f64(SR)
    dp1[j] = fb * (1 - 0.00025)
    dp2[j] = fb
    dp3[j] = fb * (1 + 0.00025)
    let a: f64
    if (n < 1.5) a = 1
    else if (n < 2.5) a = 0.75
    else if (n < 3.5) a = 0.55
    else if (n < 4.5) a = 0.4
    else if (n < 5.5) a = 0.3
    else if (n < 6.5) a = 0.22
    else if (n < 7.5) a = 0.16
    else if (n < 8.5) a = 0.12
    else a = 0.1 / Math.pow(n - 7, 0.5)
    if (n > 3) a *= 0.88625
    a *= Math.pow(n, -(1 - v) * 0.8)
    amp0[j] = a
    ampN[j] = a
    decN[j] = Math.exp(-(0.4 + n * 0.12) / f64(SR))
  }

  // 全局包络/琴体/释音的增量乘子
  const dE1 = Math.exp(-1 / (tau1 * f64(SR)))
  const dE2 = Math.exp(-1 / (tau2 * f64(SR)))
  const dBe = Math.exp(-1 / f64(SR))
  const dBe2 = Math.exp(-2 / f64(SR))
  const relStep = Math.exp(-(4.5 + f * 0.0025) / f64(SR))
  let e1 = 1.0
  let e2 = 1.0
  let be = 1.0
  let be2 = 1.0
  let rel = 1.0
  let pb1 = 0.1 / TAU
  let pb2 = 0.15 / TAU
  let pb3 = 0.05 / TAU
  const db1 = f / f64(SR)
  const db2 = (f * 0.5) / f64(SR)
  const db3 = (f * 2) / f64(SR)
  const bassFac = f < 300 ? (300 - f) / 240 : 0
  const susSample = i32(durSec * f64(SR))
  const invNs = 0.55 / f64(ns)

  const total = i32(2.2 * f64(SR))
  for (let s = 0; s < total; s++) {
    let sig = 0.0
    for (let j = 0; j < active; j++) {
      const a = ampN[j]
      if (ns < 2) {
        sig += f64(sinT(ph2[j])) * a
      } else if (ns < 3) {
        sig += f64(sinT(ph1[j]) + sinT(ph3[j])) * 0.5 * a
      } else {
        sig += f64(sinT(ph1[j]) * 0.32 + sinT(ph2[j]) * 0.36 + sinT(ph3[j]) * 0.32) * a
      }
      ampN[j] *= decN[j]
      ph1[j] += dp1[j]
      if (ph1[j] >= 1) ph1[j] -= 1
      ph2[j] += dp2[j]
      if (ph2[j] >= 1) ph2[j] -= 1
      ph3[j] += dp3[j]
      if (ph3[j] >= 1) ph3[j] -= 1
    }
    // 高分音衰减最快：已静音的尾部音从 active 收缩，省后续查表
    while (active > 1 && ampN[active - 1] < 0.004) active--
    // 琴体共鸣瞬态
    const body =
      f64(sinT(pb1)) * 0.18 * be + f64(sinT(pb2)) * 0.1 * be * bassFac + f64(sinT(pb3)) * 0.05 * be * be2
    pb1 += db1
    if (pb1 >= 1) pb1 -= 1
    pb2 += db2
    if (pb2 >= 1) pb2 -= 1
    pb3 += db3
    if (pb3 >= 1) pb3 -= 1
    be *= dBe
    be2 *= dBe2
    const env = 0.82 * e1 + 0.18 * e2
    e1 *= dE1
    e2 *= dE2
    // 15ms 余弦起音窗
    const att = s < 662 ? 0.5 - 0.5 * Math.cos((Math.PI * f64(s)) / 662.0) : 1.0
    if (s > susSample) rel *= relStep
    const out = (sig * invNs + body * 0.75 * env) * att * env * rel
    pcm[(s0 + s) % pcmLen] += f32(Math.tanh(out * 1.02) * 0.62 * v)
    // 释音后能量低于 -54dB 提前截断（短音符省掉固定 2.2s 尾的全额开销）
    if (s > susSample && env * rel < 0.002) break
  }
}

// bass 单音渲染（bassProxy 思路）：基波+二次泛音，rise/decay/release 包络，tanh 出幻影分音
function bassVoice(k: f64, s0: i32, durSec: f64, v: f64): void {
  const f = 440.0 * Math.pow(2, (k - 69) / 12)
  const dRise = 1 - Math.exp(-200 / f64(SR))
  const dDec = Math.exp(-1.1 / f64(SR))
  const dRel = Math.exp(-3.5 / f64(SR))
  let rise = 0.0
  let dec = 1.0
  let rel = 1.0
  let p1 = 0.0
  let p2 = 0.5 / TAU
  const d1 = f / f64(SR)
  const d2 = (2 * f) / f64(SR)
  const susSample = i32(durSec * f64(SR))
  const total = min(i32(2.2 * f64(SR)), i32(durSec * f64(SR)) + SR)
  for (let s = 0; s < total; s++) {
    rise += (1 - rise) * dRise
    dec *= dDec
    if (s > susSample) rel *= dRel
    const sig = f64(sinT(p1)) * 0.9 + f64(sinT(p2)) * 0.35
    p1 += d1
    if (p1 >= 1) p1 -= 1
    p2 += d2
    if (p2 >= 1) p2 -= 1
    pcm[(s0 + s) % pcmLen] += f32((Math.tanh(sig * rise * dec * rel * v * 1.6) / 1.6) * 0.9)
  }
}

// 把乐谱 [0,count) 以 kind 音色累加进 pcm：0=bass 1=arp 2=theme（arp/theme 同钢琴引擎，力度分层）
export function mRender(kind: i32, count: i32): void {
  const n = min(count, SCORE_CAP)
  for (let i = 0; i < n; i++) {
    const k = scoreBuf[i * 4]
    const startSec = scoreBuf[i * 4 + 1]
    const durSec = scoreBuf[i * 4 + 2]
    let vel = scoreBuf[i * 4 + 3]
    // 人性化：力度按音高起伏 + 起音抖动（学 shadertoy：确定性 hash，烘焙可复现）
    vel *= 0.9 + 0.1 * Math.sin(f64(i) * 6731.0)
    const jitter = 0.002 * Math.sin(f64(i) * 56124.0)
    const s0 = i32((startSec + jitter) * f64(SR))
    if (s0 < 0 || s0 >= pcmLen) continue
    if (kind === 0) {
      bassVoice(k, s0, durSec, vel)
    } else {
      pianoVoice(k, s0, durSec, kind === 2 ? vel : vel * 0.55)
    }
  }
}
