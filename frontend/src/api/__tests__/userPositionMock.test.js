// @vitest-environment jsdom
// （userPositionMock 动态 import positionMock → request.js → router 链路触达 window，故用 jsdom）
// 2026-09-12 测试审计 T53：userPositionMock（3cc4591 收口补齐）零测试 → 补 2 条。
// 员工端「可选岗位」列表与管理端同源：只出已发布岗位（md 岗位管理 §3.1 用户只能领用已发布岗位；
// positionMock 三态展示口径 status:'published'）。bindPosition 无写点（demo 只回成功应答，本地态由 store 收口）。
import { describe, it, expect, beforeEach } from 'vitest'
import { listPositions, bindPosition } from '../userPositionMock'
import { __resetPositionMock, unpublishPosition } from '../positionMock'

beforeEach(() => __resetPositionMock())

describe('userPositionMock · 员工端可选岗位（与 positionMock 同源）', () => {
  it('listPositions → 只含「已发布」岗位（种子 401/402），未发布/审核中的 403、404 不出；VO 为员工端卡片形状', async () => {
    const list = await listPositions()
    expect(Array.isArray(list)).toBe(true)
    expect(list.map((p) => p.name)).toEqual(['经营分析岗', '客户成功岗'])
    expect(list.map((p) => p.id)).toEqual([401, 402])
    // 卡片 VO：avatar 复用后台岗位图标、intro 取描述、jobTag/expertise 留空
    expect(list[0]).toEqual({
      id: 401,
      name: '经营分析岗',
      avatar: '▤',
      jobTag: '',
      intro: '负责经营数据汇总、异常识别与经营分析报告输出',
      expertise: ''
    })
  })

  it('管理端提交停用审核（pendingAction=DELIST，展示态变审核中）→ 员工端列表即时少一条', async () => {
    await unpublishPosition(402)
    const list = await listPositions()
    expect(list.map((p) => p.name)).toEqual(['经营分析岗'])
  })

  it('bindPosition(401) → 回成功应答 { positionId: 401 }（demo 无服务端状态，不改管理端数据）', async () => {
    await expect(bindPosition(401)).resolves.toEqual({ positionId: 401 })
    expect((await listPositions()).map((p) => p.id)).toEqual([401, 402])
  })
})
