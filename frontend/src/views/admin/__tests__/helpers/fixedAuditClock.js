import { vi } from 'vitest'

/**
 * 工具调用审计用例共用的固定系统时间：种子（toolCallAuditMock.js）在 2026-09-19 ~ 09-28，
 * 而列表默认窗口是「今天往前 90 天」，不固定时间的话真实日期推移后种子会被挤出窗口、用例到期变红。
 * 只 fake Date，不假定时器（Element Plus / Vue 的 nextTick、微任务照常跑）。
 * 在 beforeEach 调 useFixedAuditNow()，afterEach 调 restoreAuditClock()。
 */
export const FIXED_NOW = new Date('2026-09-28T12:00:00+08:00')

export function useFixedAuditNow() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
}

export function restoreAuditClock() {
  vi.useRealTimers()
}
