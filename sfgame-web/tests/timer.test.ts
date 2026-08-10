import { expect, test } from 'vitest'
import { SOURCE_PENALTY, formatPenalty, formatTime, penaltySeconds } from '../app/game/timer.ts'

test('罚时按场上源数线性计费，时间 1 位小数、罚时带 + 号', () => {
  expect(SOURCE_PENALTY).toBe(4)
  expect(penaltySeconds(0)).toBe(0)
  expect(penaltySeconds(3)).toBe(12)
  expect(formatTime(0)).toBe('0.0s')
  expect(formatTime(30.34)).toBe('30.3s')
  expect(formatPenalty(0)).toBe('无')
  expect(formatPenalty(12)).toBe('+12.0s')
})
