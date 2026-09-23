// @vitest-environment jsdom
// （positionAssignmentMock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listPositionAssignments,
  setUserPosition,
  __resetPositionAssignmentMock
} from '../positionAssignmentMock'
import { __resetPositionMock } from '../positionMock'
import { updateUser, deleteUser, __resetOrgMock } from '../adminUserMock'

// vitest 用例随机顺序执行：每例前重置三侧种子（岗位名实时从 positionMock 解析；
// 2026-09-23 待办 yuepu#11③ 起用户列表同源自 adminUserMock，须一并重置）
beforeEach(() => {
  __resetOrgMock()
  __resetPositionMock()
  __resetPositionAssignmentMock()
})

const ALL_USERNAMES = [
  'zhangwei', 'li.na', 'chenyu', 'wangfang', 'zhouming', 'sun.xin',
  'liuqiang', 'zhaomin', 'yangfan', 'hejing', 'wujie', 'xulin', 'ma.chao'
]

describe('positionAssignmentMock —— 岗位分配 mock（2026-09-23 待办 yuepu#11③ 改版：用户列表实时同源自 adminUserMock 全部 13 名真实用户，不再自维护一份独立 6 人名单）', () => {
  it('列表覆盖 adminUserMock 全部 13 名用户；种子 4 人有绑定，岗位名与岗位模块种子联动（Q10，md 岗位管理 §3.1）', async () => {
    const { list, total } = await listPositionAssignments()
    expect(total).toBe(13)
    expect(list.map((r) => r.username)).toEqual(ALL_USERNAMES)
    // Q10 拍板：分配区岗位名统一采用岗位模块种子的岗位名（不是原型分配区的「经营分析师」等）
    expect(list.find((r) => r.username === 'zhangwei').positionName).toBe('经营分析岗')
    expect(list.find((r) => r.username === 'li.na').positionName).toBe('客户成功岗')
    expect(list.find((r) => r.username === 'wangfang').positionName).toBe('财务审核岗')
    expect(list.filter((r) => r.positionId == null).map((r) => r.username)).toEqual([
      'chenyu', 'sun.xin', 'liuqiang', 'zhaomin', 'yangfan', 'hejing', 'wujie', 'xulin', 'ma.chao'
    ])
    expect(list.find((r) => r.username === 'zhouming').status).toBe('disabled')
  })

  it('keyword（用户名/显示名）与 status 过滤', async () => {
    const byName = await listPositionAssignments({ keyword: '张伟' })
    expect(byName.list.map((r) => r.username)).toEqual(['zhangwei'])
    const byUsername = await listPositionAssignments({ keyword: 'sun.' })
    expect(byUsername.list.map((r) => r.username)).toEqual(['sun.xin'])
    const disabled = await listPositionAssignments({ status: 'disabled' })
    expect(disabled.list.map((r) => r.username)).toEqual(['zhouming', 'wujie'])
  })

  it('设置绑定：首绑/换绑/解绑即时生效；不存在的岗位 / 不存在的用户均被拒', async () => {
    await setUserPosition(203, 402) // chenyu 首绑
    let rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 203).positionName).toBe('客户成功岗')
    await setUserPosition(201, 402) // zhangwei 换绑
    rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 201).positionName).toBe('客户成功岗')
    await setUserPosition(201, null) // zhangwei 解绑
    rows = (await listPositionAssignments()).list
    expect(rows.find((r) => r.userId === 201).positionId).toBeNull()
    expect(rows.find((r) => r.userId === 201).positionName).toBeNull()
    await expect(setUserPosition(202, 999)).rejects.toThrow('岗位不存在')
    await expect(setUserPosition(9999, 402)).rejects.toThrow('用户不存在')
  })

  it('focusUserId 置顶（2026-09-04 审批「重新绑定」回跳）：目标用户排第一，其余相对顺序不变', async () => {
    const { list } = await listPositionAssignments({ focusUserId: 204 })
    expect(list[0].username).toBe('wangfang')
    expect(list.map((r) => r.username)).toEqual([
      'wangfang', ...ALL_USERNAMES.filter((u) => u !== 'wangfang')
    ])
  })

  it('用户表变更实时同步（2026-09-23 待办 yuepu#11③）：改名/停用即时反映；用户被删除后从列表消失，绑定一并失效', async () => {
    await updateUser(202, { displayName: '李娜娜', status: 'disabled' })
    const row = (await listPositionAssignments()).list.find((r) => r.userId === 202)
    expect(row).toMatchObject({ displayName: '李娜娜', status: 'disabled', positionName: '客户成功岗' })

    await deleteUser(203) // chenyu 未绑定，直接删
    const afterDelete = await listPositionAssignments()
    expect(afterDelete.total).toBe(12)
    expect(afterDelete.list.some((r) => r.username === 'chenyu')).toBe(false)
  })
})

describe('positionAssignmentMock · 持久化读回（mockPersist v2；写点 setUserPosition → 刷新后仍在）', () => {
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
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('setUserPosition(203, 402) 落盘（v=2，bindings 形状）→ 重新 import 模块 → chenyu 仍绑在客户成功岗', async () => {
    const first = await import('../positionAssignmentMock')
    await first.setUserPosition(203, 402)
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(2)
    expect(snap.data.bindings['203']).toBe(402)
    vi.resetModules()
    const fresh = await import('../positionAssignmentMock')
    const { list } = await fresh.listPositionAssignments()
    expect(list.find((r) => r.userId === 203)).toMatchObject({ positionId: 402, positionName: '客户成功岗' })
  })
})
