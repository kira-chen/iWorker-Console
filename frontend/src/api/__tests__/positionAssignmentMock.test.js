// @vitest-environment jsdom
// （positionAssignmentMock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listPositionAssignments,
  setUserPosition,
  __resetPositionAssignmentMock
} from '../positionAssignmentMock'
import { __resetPositionMock } from '../positionMock'

// vitest 用例随机顺序执行：每例前重置两侧种子（岗位名实时从 positionMock 解析）
beforeEach(() => {
  __resetPositionMock()
  __resetPositionAssignmentMock()
})

describe('positionAssignmentMock —— 岗位分配 mock（2026-09-01 PRD 对齐轮）', () => {
  it('种子 6 用户照原型：2 人未绑定、zhouming 停用；岗位名与岗位模块种子联动（Q10）', async () => {
    const { list, total } = await listPositionAssignments()
    expect(total).toBe(6)
    expect(list.map((r) => r.username)).toEqual(['zhangwei', 'li.na', 'chenyu', 'wangfang', 'zhouming', 'sun.xin'])
    // Q10 拍板：分配区岗位名统一采用岗位模块种子的岗位名（不是原型分配区的「经营分析师」等）
    expect(list[0].positionName).toBe('经营分析岗')
    expect(list[1].positionName).toBe('客户成功岗')
    expect(list[3].positionName).toBe('财务审核岗')
    expect(list.filter((r) => r.positionId == null).map((r) => r.username)).toEqual(['chenyu', 'sun.xin'])
    expect(list.find((r) => r.username === 'zhouming').status).toBe('disabled')
  })

  it('keyword（用户名/显示名）与 status 过滤', async () => {
    const byName = await listPositionAssignments({ keyword: '张伟' })
    expect(byName.list.map((r) => r.username)).toEqual(['zhangwei'])
    const byUsername = await listPositionAssignments({ keyword: 'sun.' })
    expect(byUsername.list.map((r) => r.username)).toEqual(['sun.xin'])
    const disabled = await listPositionAssignments({ status: 'disabled' })
    expect(disabled.list.map((r) => r.username)).toEqual(['zhouming'])
  })

  it('设置绑定：首绑/换绑/解绑即时生效；不存在的岗位被拒', async () => {
    await setUserPosition(3, 402) // 首绑
    let rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 3).positionName).toBe('客户成功岗')
    await setUserPosition(1, 402) // 换绑
    rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 1).positionName).toBe('客户成功岗')
    await setUserPosition(1, null) // 解绑
    rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 1).positionId).toBeNull()
    expect(rows.find((r) => r.userId === 1).positionName).toBeNull()
    await expect(setUserPosition(2, 999)).rejects.toThrow('岗位不存在')
  })
})
