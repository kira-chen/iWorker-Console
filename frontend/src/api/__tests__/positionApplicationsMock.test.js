// @vitest-environment jsdom
// （positionApplicationsMock → request.js → router 链路触达 window，故用 jsdom；同 positionAssignmentMock）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listPositionApplications,
  countPendingApplications,
  approvePositionApplication,
  rejectPositionApplication,
  markApplicationRebound,
  __resetPositionApplicationsMock
} from '../positionApplicationsMock'
import { listPositionAssignments, __resetPositionAssignmentMock } from '../positionAssignmentMock'
import { __resetPositionMock } from '../positionMock'

// vitest 用例随机顺序执行：每例前重置三侧种子（申请行联查分配 mock + 岗位名实时解析自 positionMock）
beforeEach(() => {
  __resetPositionMock()
  __resetPositionAssignmentMock()
  __resetPositionApplicationsMock()
})

async function assignmentOf(userId) {
  const { list } = await listPositionAssignments()
  return list.find((r) => r.userId === userId)
}

describe('positionApplicationsMock —— 岗位申请审批 mock（2026-09-09 PRD 复核·G2 / A8 全量展示口径）', () => {
  // md §4.1：展示全部四态；待审核组恒置顶，组内按提交时间由近到远
  it('A8 种子 6 条（3 待审核 + 3 已处理）：待审核置顶，组内 desc', async () => {
    const { list, total } = await listPositionApplications()
    expect(total).toBe(6)
    // 待审核组 701(08-28 10:32) / 702(08-28 09:46) / 703(08-27 17:18)，
    // 已处理组 704(08-20 14:05) / 705(08-19 11:40) / 706(08-18 09:03)
    expect(list.map((r) => r.id)).toEqual([701, 702, 703, 704, 705, 706])
    expect(list.map((r) => r.reviewStatus)).toEqual([
      'PENDING', 'PENDING', 'PENDING', 'APPROVED', 'REJECTED', 'REBOUND'
    ])
  })

  it('A8 sortDir=asc：只反转组内顺序，「待审核置顶」的分组规则不变（md §4.1）', async () => {
    const { list } = await listPositionApplications({ sortDir: 'asc' })
    expect(list.map((r) => r.id)).toEqual([703, 702, 701, 706, 705, 704])
    // 前三条仍全是待审核 —— 分组未被排序打散
    expect(list.slice(0, 3).every((r) => r.reviewStatus === 'PENDING')).toBe(true)
  })

  it('A8 审核状态筛选（md §4.1）：按 reviewStatus 过滤；非法值回落「全部」', async () => {
    expect((await listPositionApplications({ reviewStatus: 'PENDING' })).total).toBe(3)
    const rejected = await listPositionApplications({ reviewStatus: 'REJECTED' })
    expect(rejected.list.map((r) => r.id)).toEqual([705])
    expect((await listPositionApplications({ reviewStatus: 'REBOUND' })).total).toBe(1)
    expect((await listPositionApplications({ reviewStatus: 'NOPE' })).total).toBe(6) // 回落全部
  })

  it('A8 已处理行出参：审核结果 / 处理时间 / 处理人 / 驳回原因齐备；待审核行三者为空（md §4.2）', async () => {
    const { list } = await listPositionApplications()
    const byId = (id) => list.find((r) => r.id === id)
    const rejected = byId(705)
    expect(rejected.reviewStatus).toBe('REJECTED')
    expect(rejected.processedAt).toBe('2026-08-19 16:28')
    expect(rejected.processedBy).toBe('admin')
    expect(rejected.rejectReason).toContain('财务合规培训')
    const pending = byId(701)
    expect(pending.processedAt).toBe('')
    expect(pending.processedBy).toBe('')
    // status 仍是「用户启用/停用态」（命名口径未变，避免与分配页签同名列冲突）
    expect(pending.status).toBe('active')
    expect(byId(705).status).toBe('disabled') // 周明（userId 5）在分配表为停用
  })

  it('行内联查：状态/现有绑定取分配实时值，申请岗位名从 positionMock 实时解析（Q10 同款）', async () => {
    const { list } = await listPositionApplications()
    const chenyu = list.find((r) => r.username === 'chenyu')
    expect(chenyu.status).toBe('active')
    expect(chenyu.currentPositionName).toBeNull() // 未绑定
    expect(chenyu.requestedPositionName).toBe('市场研究岗') // 404，不是原型区的「产品运营专员」
    const lina = list.find((r) => r.username === 'li.na')
    expect(lina.currentPositionName).toBe('客户成功岗') // 402 实时值
    expect(lina.requestedPositionName).toBe('经营分析岗') // 401
    const sunxin = list.find((r) => r.username === 'sun.xin')
    expect(sunxin.requestedPositionName).toBe('财务审核岗') // 403
  })

  it('徽标计数：待审核数量随处理递减', async () => {
    expect((await countPendingApplications()).count).toBe(3)
    await approvePositionApplication(702)
    expect((await countPendingApplications()).count).toBe(2)
  })

  it('通过：走现有绑定接口把用户绑到申请岗位（覆盖式单岗）；A8 后申请留在列表并落处理留痕', async () => {
    await approvePositionApplication(702) // li.na：402 → 申请 401
    const lina = await assignmentOf(2)
    expect(lina.positionId).toBe(401)
    expect(lina.positionName).toBe('经营分析岗') // 换绑为覆盖关系，原 402 不保留
    const { list, total } = await listPositionApplications()
    expect(total).toBe(6) // md §4.3.4：已处理记录保留在列表
    const row = list.find((r) => r.id === 702)
    expect(row.reviewStatus).toBe('APPROVED')
    expect(row.processedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) // 精确到分钟
    expect(row.processedBy).toBe('admin')
    // 处理后离开待审核组 → 排到已处理组
    expect(list.findIndex((r) => r.id === 702)).toBeGreaterThan(1)
    // 已处理的申请不可重复操作（md §4.3.4）
    await expect(approvePositionApplication(702)).rejects.toThrow('该申请已处理')
  })

  it('驳回：原因必填（≤500 字）；不改变用户现有岗位绑定（业务规则）', async () => {
    await expect(rejectPositionApplication(701, '')).rejects.toThrow('请输入驳回原因')
    await expect(rejectPositionApplication(701, '  ')).rejects.toThrow('请输入驳回原因')
    await expect(rejectPositionApplication(701, 'x'.repeat(501))).rejects.toThrow('最多 500 字')
    // 上述失败均不改变申请状态
    expect((await countPendingApplications()).count).toBe(3)

    await rejectPositionApplication(701, '岗位编制已满，暂不开放')
    const { list } = await listPositionApplications()
    const row = list.find((r) => r.id === 701)
    expect(row.reviewStatus).toBe('REJECTED') // A8：已驳回仍在列表
    expect(row.rejectReason).toBe('岗位编制已满，暂不开放')
    expect(row.processedBy).toBe('admin')
    const chenyu = await assignmentOf(3)
    expect(chenyu.positionId).toBeNull() // 驳回不动绑定
  })

  it('重新绑定回执：仅标记 REBOUND（行保留），绑定由修改绑定弹窗链路另行落库', async () => {
    await markApplicationRebound(703)
    const { list, total } = await listPositionApplications()
    expect(total).toBe(6)
    expect(list.find((r) => r.id === 703).reviewStatus).toBe('REBOUND')
    const sunxin = await assignmentOf(6)
    expect(sunxin.positionId).toBeNull() // 本接口自身不触碰绑定
    await expect(markApplicationRebound(703)).rejects.toThrow('该申请已处理')
  })

  it('不存在的申请 → 404 报错', async () => {
    await expect(approvePositionApplication(999)).rejects.toThrow('申请不存在')
  })
})

describe('positionApplicationsMock · 持久化读回（mockPersist v2；写点 reject → 刷新后仍在）', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
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
    globalThis.localStorage = makeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.resetModules()
  })

  it('rejectPositionApplication(701) 落盘（v=2）→ 重新 import 模块 → 701 仍是已驳回且驳回原因在', async () => {
    const first = await import('../positionApplicationsMock')
    await first.rejectPositionApplication(701, '读回验证：驳回原因')
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(2)
    expect(snap.data.applications.find((r) => r.id === 701).status).toBe('REJECTED')
    vi.resetModules()
    const fresh = await import('../positionApplicationsMock')
    const { list } = await fresh.listPositionApplications()
    expect(list.find((r) => r.id === 701)).toMatchObject({ reviewStatus: 'REJECTED', rejectReason: '读回验证：驳回原因' })
    expect((await fresh.countPendingApplications()).count).toBe(2)
  })
})
