// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getPendingApplicationByUserId,
  countPendingApplications,
  markApplicationAssigned,
  __resetPositionApplicationsMock
} from '../positionApplicationsMock'
import { listPositionAssignments, __resetPositionAssignmentMock } from '../positionAssignmentMock'
import { __resetPositionMock } from '../positionMock'
import { __resetOrgMock } from '../adminUserMock'

/**
 * positionApplicationsMock 单测（2026-09-17 重写，对齐 prd.岗位管理.md §一 / §五「待分配申请」新流程）。
 *
 * 新流程（d4ff97d / b5ded68，2026-09-15）：用户从客户端举手申请、不指定岗位；管理端在岗位管理页
 * 统一「分配岗位」，分配后申请标记 ASSIGNED 留痕。原「通过 / 驳回 / 重新绑定」审批语义随
 * requestedPositionId 一并移除——688ea7f 曾为喂旧用例把四个函数加回，2026-09-17 负责人裁决删除，
 * 本文件只守现行三个导出：getPendingApplicationByUserId / countPendingApplications / markApplicationAssigned。
 */

// vitest 用例随机顺序执行：每例前重置三侧种子（分配行联查申请 mock；岗位名解析自 positionMock）
beforeEach(() => {
  __resetOrgMock()
  __resetPositionMock()
  __resetPositionAssignmentMock()
  __resetPositionApplicationsMock()
})

async function assignmentOf(userId) {
  const { list } = await listPositionAssignments()
  return list.find((r) => r.userId === userId)
}

describe('positionApplicationsMock —— 待分配申请（新流程：举手申请不指定岗位，管理端统一分配）', () => {
  it('种子 3 条：chenyu(203) / sun.xin(206) 待分配，li.na(202) 历史已分配；徽标计数 = 2', async () => {
    expect(getPendingApplicationByUserId(203)).toMatchObject({ id: 701, status: 'PENDING' })
    expect(getPendingApplicationByUserId(206)).toMatchObject({ id: 702, status: 'PENDING' })
    expect(getPendingApplicationByUserId(202)).toBeNull() // 703 已 ASSIGNED，不算待分配
    expect((await countPendingApplications()).count).toBe(2)
  })

  it('getPendingApplicationByUserId：userId 数字/字符串同义；无申请的用户返回 null', () => {
    expect(getPendingApplicationByUserId('203')).toMatchObject({ id: 701 })
    expect(getPendingApplicationByUserId(999)).toBeNull()
  })

  it('联查到分配列表：有待分配申请的行带 hasPendingRequest/pendingRequestId/pendingRequestAt；hasPendingRequest=true 只筛出这些行（md §一.18 / §二「待分配」标签）', async () => {
    expect(await assignmentOf(203)).toMatchObject({ hasPendingRequest: true, pendingRequestId: 701, pendingRequestAt: '2026-08-28 10:32' })
    expect(await assignmentOf(202)).toMatchObject({ hasPendingRequest: false, pendingRequestId: null })
    const { list } = await listPositionAssignments({ hasPendingRequest: true })
    expect(list.map((r) => r.userId).sort((a, b) => a - b)).toEqual([203, 206])
  })

  it('markApplicationAssigned：PENDING → ASSIGNED 留痕（assignedAt/assignedBy），徽标递减，分配列表上「待分配」标签消失', async () => {
    await markApplicationAssigned(701)
    expect(getPendingApplicationByUserId(203)).toBeNull()
    expect((await countPendingApplications()).count).toBe(1)
    expect(await assignmentOf(203)).toMatchObject({ hasPendingRequest: false })
  })

  it('markApplicationAssigned 守卫：已处理的申请再标记 → 「该申请已处理」；不存在的 id → 404「申请不存在」', async () => {
    await expect(markApplicationAssigned(703)).rejects.toMatchObject({ message: '该申请已处理' })
    await expect(markApplicationAssigned(9999)).rejects.toMatchObject({ code: 404, message: '申请不存在' })
  })
})

describe('positionApplicationsMock · 持久化读回（mockPersist v4；写点 markApplicationAssigned → 刷新后仍在）', () => {
  // 本仓 jsdom/node 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 故与 mockPersist.test 同款注入内存版存储，用 vi.resetModules + 动态 import 模拟「写入 → 刷新 → 重载」。
  const KEY = 'iworker-demo-mock:positionApplications'
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

  it('markApplicationAssigned(701) 落盘（v=4）→ 重新 import 模块 → 701 仍是已分配、待分配数为 1', async () => {
    const first = await import('../positionApplicationsMock')
    await first.markApplicationAssigned(701)
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(4)
    expect(snap.data.applications.find((r) => r.id === 701)).toMatchObject({ status: 'ASSIGNED', assignedBy: 'admin' })
    vi.resetModules()
    const fresh = await import('../positionApplicationsMock')
    expect(fresh.getPendingApplicationByUserId(203)).toBeNull()
    expect((await fresh.countPendingApplications()).count).toBe(1)
  })
})
