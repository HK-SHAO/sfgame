import { CLOUD_COUNT, CLOUD_VISIBLE_ALPHA } from '../sim/clouds.ts'
import type { CloudsView } from '../sim/worker-protocol.ts'

// 云顶点批纯计算（可无头测试）：每朵云一个四边形（两三角形，6 顶点 × 6 浮点 pos2+uv2+alpha+seed），
// 形状全在片元，宿主只发包围盒。返回顶点数；out 容量 = CLOUD_COUNT×36 浮点。
// 入参 CloudsView：Clouds 实例与 worker 帧快照同构（同名字段），两者皆可消费
export function fillCloudVerts(clouds: CloudsView, out: Float32Array): number {
  const d = out
  let n = 0
  // 容量钳按浮点数算（每朵云 36 浮点）：n 数浮点，阈值必须同单位（P1 守卫修正——曾错写成 n < CLOUD_COUNT，
  // 只渲染第一朵可见云，导致"淡出后另一朵满不透明度异地闪现"的瞬移观感）
  for (let i = 0; i < clouds.count && n < CLOUD_COUNT * 36; i++) {
    const a = clouds.alpha[i]
    if (a <= CLOUD_VISIBLE_ALPHA) continue
    // 云体面积 ∝ alpha（P3）：凝结由小长大、消散缩至一点，免"满尺寸凭空凝出"；opacity 仍为 a
    const k = Math.sqrt(a)
    // 四边形 = 可见云体（片元基椭圆约 0.68/0.61 占空）的反算包围盒
    const hw = clouds.radius[i] * 1.5 * k
    const hh = clouds.radius[i] * 1.1 * k
    const x0 = clouds.x[i] - hw
    const y0 = clouds.y[i] - hh
    const x1 = clouds.x[i] + hw
    const y1 = clouds.y[i] + hh
    const s = clouds.seed[i]
    d[n++] = x0; d[n++] = y0; d[n++] = 0; d[n++] = 0; d[n++] = a; d[n++] = s
    d[n++] = x1; d[n++] = y0; d[n++] = 1; d[n++] = 0; d[n++] = a; d[n++] = s
    d[n++] = x0; d[n++] = y1; d[n++] = 0; d[n++] = 1; d[n++] = a; d[n++] = s
    d[n++] = x1; d[n++] = y0; d[n++] = 1; d[n++] = 0; d[n++] = a; d[n++] = s
    d[n++] = x1; d[n++] = y1; d[n++] = 1; d[n++] = 1; d[n++] = a; d[n++] = s
    d[n++] = x0; d[n++] = y1; d[n++] = 0; d[n++] = 1; d[n++] = a; d[n++] = s
  }
  return n / 6
}
