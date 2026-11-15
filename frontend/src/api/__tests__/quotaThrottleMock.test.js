// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../mockPersist', () => ({ attachPersist: () => vi.fn() }))

import { getQuotaThrottleSettings, saveMergeWait, __resetQuotaThrottleMock } from '../quotaThrottleMock'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'

// 对齐 docs/PRD/数字员工管理端PRD/04运行/配额与限流/prd.配额与限流.md §三（字段、校验、保存）与 §四（访问审计），
// 以及 05治理/访问审计 §6.2.1 第 21 条。页面交互见 views/admin/__tests__/adminQuotaThrottle.test.js。
const liveOps = () => opsRecords.filter((r) => r.live && r.module === '配额与限流')

beforeEach(() => {
  __resetQuotaThrottleMock()
  resetAccessAuditMock()
})

describe('quotaThrottleMock —— 消息合并等待时长', () => {
  it('出厂值为 5 秒', async () => {
    expect(await getQuotaThrottleSettings()).toEqual({ mergeWaitSec: 5 })
  })

  it('保存合法值后读回新值', async () => {
    await saveMergeWait(8)
    expect(await getQuotaThrottleSettings()).toEqual({ mergeWaitSec: 8 })
  })

  it.each([1, 30, '08'])('边界与前导零可保存：%s', async (v) => {
    await expect(saveMergeWait(v)).resolves.toEqual({ mergeWaitSec: Number(v) })
  })

  it.each([
    ['', '请填写消息合并等待时长'],
    ['  ', '请填写消息合并等待时长'],
    [0, '请填写 1–30 之间的整数'],
    [31, '请填写 1–30 之间的整数'],
    ['2.5', '请填写 1–30 之间的整数'],
    ['-3', '请填写 1–30 之间的整数'],
    ['abc', '请填写 1–30 之间的整数']
  ])('非法值 %j 被拒，提示「%s」，原值不变（防绕过页面）', async (v, message) => {
    await expect(saveMergeWait(v)).rejects.toMatchObject({ message, field: 'mergeWaitSec' })
    expect(await getQuotaThrottleSettings()).toEqual({ mergeWaitSec: 5 })
    expect(liveOps()).toHaveLength(0)
  })
})

describe('quotaThrottleMock —— 访问审计（§四；访问审计 §6.2.1 第 21 条）', () => {
  it('值有变化：写一条「配额与限流 / 修改配置」，对象为配置项名称，变更内容「原值 → 新值」', async () => {
    await saveMergeWait(8)
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ module: '配额与限流', action: '修改配置', target: '消息合并等待时长', detail: '5 秒 → 8 秒' })
    expect(liveOps()[0].version).toBeUndefined()
  })

  it('值没变（含「05」这类写法）：不写审计', async () => {
    await saveMergeWait(5)
    await saveMergeWait('05')
    expect(liveOps()).toHaveLength(0)
  })

  it('连续修改各记一条，原值取上一次保存后的值', async () => {
    await saveMergeWait(8)
    await saveMergeWait(12)
    expect(liveOps().map((r) => r.detail)).toEqual(['8 秒 → 12 秒', '5 秒 → 8 秒']) // 新记录在前
  })
})
