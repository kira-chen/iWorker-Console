// @vitest-environment jsdom
// （positionApplicationsMock → request.js → router 链路触达 window，故用 jsdom；同 positionAssignmentMock）
import { describe, it, expect, beforeEach } from 'vitest'
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

describe('positionApplicationsMock —— 岗位申请审批 mock（2026-09-04 PRD-20260903 对齐）', () => {
  it('种子 3 条待审核照原型（chenyu/li.na/sun.xin），默认提交时间由近到远', async () => {
    const { list, total } = await listPositionApplications()
    expect(total).toBe(3)
    expect(list.map((r) => r.id)).toEqual([701, 702, 703]) // desc：08-28 10:32 → 08-28 09:46 → 08-27 17:18
    expect(list.map((r) => r.username)).toEqual(['chenyu', 'li.na', 'sun.xin'])
  })

  it('sortDir=asc 切换为由远到近', async () => {
    const { list } = await listPositionApplications({ sortDir: 'asc' })
    expect(list.map((r) => r.id)).toEqual([703, 702, 701])
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

  it('通过：走现有绑定接口把用户绑到申请岗位（业务规则：等效管理员手动改绑，覆盖式单岗），申请离开列表', async () => {
    await approvePositionApplication(702) // li.na：402 → 申请 401
    const lina = await assignmentOf(2)
    expect(lina.positionId).toBe(401)
    expect(lina.positionName).toBe('经营分析岗') // 换绑为覆盖关系，原 402 不保留
    const { list, total } = await listPositionApplications()
    expect(total).toBe(2)
    expect(list.some((r) => r.id === 702)).toBe(false)
    // 已处理的申请不可重复操作
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
    expect(list.some((r) => r.id === 701)).toBe(false) // 已驳回不展示
    const chenyu = await assignmentOf(3)
    expect(chenyu.positionId).toBeNull() // 驳回不动绑定
  })

  it('重新绑定回执：仅标记 REBOUND 离开列表，绑定由修改绑定弹窗链路另行落库', async () => {
    await markApplicationRebound(703)
    const { list, total } = await listPositionApplications()
    expect(total).toBe(2)
    expect(list.some((r) => r.id === 703)).toBe(false)
    const sunxin = await assignmentOf(6)
    expect(sunxin.positionId).toBeNull() // 本接口自身不触碰绑定
    await expect(markApplicationRebound(703)).rejects.toThrow('该申请已处理')
  })

  it('不存在的申请 → 404 报错', async () => {
    await expect(approvePositionApplication(999)).rejects.toThrow('申请不存在')
  })
})
