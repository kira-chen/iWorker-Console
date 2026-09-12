// @vitest-environment jsdom
// （positionAssignmentMock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  it('种子 6 用户（历史出处：原型分配区）：2 人未绑定、zhouming 停用；岗位名与岗位模块种子联动（Q10，md 岗位管理 §3.1）', async () => {
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

  it('focusUserId 置顶（2026-09-04 审批「重新绑定」回跳）：目标用户排第一，其余相对顺序不变', async () => {
    const { list } = await listPositionAssignments({ focusUserId: 4 })
    expect(list[0].username).toBe('wangfang')
    expect(list.map((r) => r.username)).toEqual(['wangfang', 'zhangwei', 'li.na', 'chenyu', 'zhouming', 'sun.xin'])
  })
})

describe('positionAssignmentMock · 持久化读回（mockPersist v1；写点 setUserPosition → 刷新后仍在）', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 故与 mockPersist.test 同款注入内存版存储，用 vi.resetModules + 动态 import 模拟「写入 → 刷新 → 重载」。
  const KEY = 'iworker-demo-mock:positionAssignment'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  beforeEach(() => {
    globalThis.localStorage = makeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.resetModules()
  })

  it('setUserPosition(3, 402) 落盘（v=1）→ 重新 import 模块 → chenyu 仍绑在客户成功岗', async () => {
    const first = await import('../positionAssignmentMock')
    await first.setUserPosition(3, 402)
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(1)
    expect(snap.data.assignments.find((r) => r.userId === 3).positionId).toBe(402)
    vi.resetModules()
    const fresh = await import('../positionAssignmentMock')
    const { list } = await fresh.listPositionAssignments()
    expect(list.find((r) => r.userId === 3)).toMatchObject({ positionId: 402, positionName: '客户成功岗' })
  })
})
