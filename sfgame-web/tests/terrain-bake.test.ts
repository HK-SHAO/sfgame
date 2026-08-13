// 地形烘焙链位级基线：表达式 → bakeSdf（格心 f64 求值 → f32 存储）→ terrainFromField 掩码
// 逐位钉死。engine-golden 走解析式 sdf 不经此链，本基线是「烘焙掩码跨平台/跨改动稳定」的
// 唯一自动化护栏——掩码位翻会经混沌流场指数放大改变物理，改求值器/坐标必须先人工确认再更新
import { expect, test } from 'vitest'
import { bakeSdf } from '../app/game/sdf.ts'
import { terrainDims, terrainFromField, FLUID_MARGIN } from '../app/sim/terrain.ts'

function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// 世界 130×85 @ cell 0.75 + 边距 10 → 流体网格 200×127（origin 13）：与真实大地图同规格
const WORLD = { w: 130, h: 85 }
const CELL = 0.75

function bakeMask(sdf: string): { mask: Uint8Array; nx: number; ny: number; origin: number } {
  const dims = terrainDims(WORLD, CELL, FLUID_MARGIN)
  const terrain = terrainFromField(bakeSdf(sdf, dims.nx, dims.ny, dims.origin, CELL), dims, CELL)
  return { mask: terrain.mask, nx: dims.nx, ny: dims.ny, origin: dims.origin }
}

test('烘焙掩码基线：原语组合（smax/box/circle/capsule/flat）', () => {
  const sdf = 'smax(min(min(min(flat(62), box(24,42,4,20)), min(circle(62,18,7), 62-y)), 40-y), -capsule(10,30,50,26,4), 3)'
  const { mask, nx, ny, origin } = bakeMask(sdf)
  expect([nx, ny, origin]).toEqual([200, 127, 13])
  expect(fnv(mask)).toBe('ddef13a6')
})

test('烘焙掩码基线：高度场 + circle 挖洞', () => {
  const sdf = 'max(52 - 14*ss((x-22)/15) - 12*ss((x-52)/12) - 10*ss((x-80)/10) - 18*ss((x-112)/10)*ss((126-x)/10) - y, -circle(80, 44, 5))'
  const { mask, nx, ny, origin } = bakeMask(sdf)
  expect([nx, ny, origin]).toEqual([200, 127, 13])
  expect(fnv(mask)).toBe('c80cf392')
})
