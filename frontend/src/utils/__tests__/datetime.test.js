import { describe, it, expect } from 'vitest'
import { fmtMinute, nowMinuteText, nowIsoLocal } from '@/utils/datetime'
import { fmtTime } from '@/utils/docMeta'

/**
 * utils/datetime 单测（2026-09-09 代码冗余治理·第二批 批 2-1 新增）。
 * 钉死收编时拍板的三个边界（空值 / 非法值 / 合法 ISO），外加两条护栏：
 *  - fmtMinute 输出与收编前旧算法（本地墙钟 + padStart(2,"0")）逐字等价，防回归；
 *  - docMeta.fmtTime 的 re-export 与正本同一函数（13+ 消费组件零改动的前提）。
 *
 * 2026-09-12 负责人决策 3（审计 J2）：员工端整体退役后 utils/taskStatus.js 已删除，
 * 原先两条护栏里对 taskStatus.fmtDateTime 的引用改为不依赖该模块——
 * 「与旧实现等价」改为直接逐字推演旧算法（断言强度不变），re-export 一条只留 docMeta。
 */
describe('fmtMinute（正本语义钉死）', () => {
  it('空值 → 空串', () => {
    expect(fmtMinute('')).toBe('')
    expect(fmtMinute(null)).toBe('')
    expect(fmtMinute(undefined)).toBe('')
  })

  it('非法值 → 原样返回', () => {
    expect(fmtMinute('not-a-date')).toBe('not-a-date')
    expect(fmtMinute('2026-13-99T99:99:99')).toBe('2026-13-99T99:99:99')
  })

  it('合法 ISO → YYYY-MM-DD HH:mm（不带时区偏移的 ISO 按本地墙钟解析，跨时区结果稳定）', () => {
    expect(fmtMinute('2026-09-09T18:30:00')).toBe('2026-09-09 18:30')
    // 个位月/日/时/分补零
    expect(fmtMinute('2026-01-02T03:04:05')).toBe('2026-01-02 03:04')
    // 带时区偏移的串按本地时区换算，只校验格式（同 docMeta.test.js 既有口径）
    expect(fmtMinute('2026-06-11T08:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('Date 入参（sampleTaskMock.fmtDt 收编路径）→ 同串', () => {
    expect(fmtMinute(new Date(2026, 8, 9, 18, 30, 0))).toBe('2026-09-09 18:30')
  })
})

describe('护栏：与旧实现等价 / re-export 同一', () => {
  it('合法 ISO 串 → fmtMinute 输出与收编前旧算法（本地墙钟 + padStart）逐字等价', () => {
    // 旧实现合法值路径的期望值逐字推演（旧 taskStatus.fmtDateTime 已随员工端退役删除，
    // 但其算法即此处 oldOut，等价护栏照常有效）
    const legal = ['2026-09-09T18:30:00', '2026-01-02T03:04:05', '2025-12-31T23:59:59+08:00']
    for (const iso of legal) {
      const d = new Date(iso)
      const pad = (n) => String(n).padStart(2, '0')
      const oldOut = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      expect(fmtMinute(iso)).toBe(oldOut)
    }
  })

  it('docMeta.fmtTime 即 fmtMinute（一行 re-export，消费方零改动）', () => {
    expect(fmtTime).toBe(fmtMinute)
  })
})

describe('nowMinuteText / nowIsoLocal（mock 层时间戳形态）', () => {
  it('nowMinuteText → 与种子同形的「YYYY-MM-DD HH:mm」墙钟串', () => {
    expect(nowMinuteText()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('nowIsoLocal → 秒级本地 ISO、固定 +08:00 后缀（mock 存储口径）', () => {
    const out = nowIsoLocal()
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
    // 与展示层闭环：nowIsoLocal 产出的串对 fmtMinute 是合法输入（带偏移串按本地时区换算，只校验格式）
    expect(fmtMinute(out)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
