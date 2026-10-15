// 访问审计「管理端操作」· 删除记录（prd.访问审计.md §6.2.1，2026-10-15 负责人拍板：删除需要记录、撤回不记）。
// 各模块的【删除】成功后写一条「删除」：操作人 = 当前登录管理员，变更内容为空，操作对象 = 被删对象名称；
// 被守卫拦下（抛错）的删除不写记录。这里抽岗位 / 专家 / MCP 三个模块验证接线，其余模块写法相同。
import { describe, it, expect, beforeEach } from 'vitest'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'
import { deletePosition, __resetPositionMock } from '../positionMock'
import { setUserPosition, __resetPositionAssignmentMock } from '../positionAssignmentMock'
import { deleteExpert, __resetExpertMock } from '../domainExpertMock'
import { deleteMcp, __resetMcpMock } from '../mcpConnectorMock'

const liveOps = () => opsRecords.filter((r) => r.live)

describe('各模块删除写访问审计「删除」', () => {
  beforeEach(() => {
    __resetPositionMock()
    __resetPositionAssignmentMock()
    __resetExpertMock()
    __resetMcpMock()
    resetAccessAuditMock()
  })

  it('前提：重置后没有运行期记录', () => {
    expect(liveOps()).toHaveLength(0)
  })

  it('删除专家：写「专家 / 删除」，对象为专家名，变更内容为空', async () => {
    await deleteExpert(203)
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ module: '专家', action: '删除', target: '法务审阅专家', detail: '' })
  })

  it('删除被拦下（已发布专家 201）不写记录', async () => {
    await expect(deleteExpert(201)).rejects.toBeTruthy()
    expect(liveOps()).toHaveLength(0)
  })

  it('删除岗位：写「岗位 / 删除」，对象为岗位名', async () => {
    await setUserPosition(202, null) // 402 种子被 li.na 领用，先解绑才能删
    await deletePosition(402)
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ module: '岗位', action: '删除', detail: '' })
    expect(liveOps()[0].target).toBeTruthy()
  })

  it('删除 MCP：写「MCP / 删除」，对象为 MCP 名称', async () => {
    await deleteMcp('mail_center')
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ module: 'MCP', action: '删除', detail: '' })
  })
})
