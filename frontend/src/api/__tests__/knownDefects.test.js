// @vitest-environment jsdom
// （各 mock → request.js → router 链路触达 window，故用 jsdom，同 positionMock.test.js）
import { describe, it, expect, beforeEach } from 'vitest'

/**
 * 已知缺陷钉桩（数据层）——2026-10-08 待办核验第三方复核登记的缺陷，按「修好后应有的行为」写断言。
 *
 * 【怎么读】每条用 `it.fails`：缺陷还在 → 断言失败 → 该用例算通过（CI 不红）；
 * 缺陷修好 → 断言通过 → `it.fails` 反而报红，提醒修复人把 `it.fails` 改回 `it`、钉成正式回归用例。
 * 用例名前缀 `yuepu#NN` 对应 docs/产品经理待办任务/yuepu.md 的待办序号，修复时在 commit 里写「关闭待办 yuepu#NN」。
 *
 * 只收「数据层可直接复现」的缺陷；页面交互类（#49 编辑器加载失败态、#54 人设页定时器等）
 * 钉在各自页面的组件用例旁。mock 是模块级共享内存，每例前统一重置种子。
 */
import {
  deletePosition,
  updatePosition,
  createPosition,
  createAgent,
  assignSkill,
  __resetPositionMock
} from '../positionMock'
import { setUserPosition, __resetPositionAssignmentMock } from '../positionAssignmentMock'
import { __resetOrgMock } from '../adminUserMock'
import { __resetSampleTaskMock } from '../sampleTaskMock'
import { __resetDataTableMock } from '../dataTableMock'
import { __resetRuntimeSpecMock } from '../runtimeSpecMock'
import { updateExpert, __resetExpertMock } from '../domainExpertMock'
import { listMcpSync, createMcp, fetchMcpTools, __resetMcpMock } from '../mcpConnectorMock'
import { __resetApiMock } from '../apiConnectorMock'
import { __resetBizSystemMock } from '../bizSystemMock'
import * as skillMock from '../unifiedSkillMock'
import * as kbMock from '../knowledgeBaseMock'

beforeEach(() => {
  __resetOrgMock()
  __resetPositionMock()
  __resetPositionAssignmentMock()
  __resetExpertMock()
  __resetMcpMock()
  __resetApiMock()
  __resetBizSystemMock()
  __resetSampleTaskMock()
  __resetDataTableMock()
  __resetRuntimeSpecMock()
})

const mcpRow = (code) => listMcpSync().find((m) => m.code === code)

describe('yuepu#50 连接器发布态未联动技能工具坞', () => {
  // 一览表 :195「停用后技能不再可引用该 API」；种子 mail_center 未发布、健康度 ok
  it.fails('yuepu#50 工具坞候选不应列出未发布的 MCP（mail_center）', async () => {
    const codes = (await skillMock.toolPicker({ type: 'MCP' })).map((t) => t.code)
    expect(codes).toContain('mcp__expense_mcp') // 前提：已发布的 MCP 在候选里（工具坞 code 带 mcp__ 前缀）
    expect(codes).not.toContain('mcp__mail_center')
  })
})

describe('yuepu#51 岗位侧绑定 / 解绑不回写连接器「N 个岗位引用」', () => {
  // prd-连接器-MCP.md:51「N 为引用了该连接器的岗位数，引用关系在岗位侧产生」
  it.fails('yuepu#51 401 解绑 expense_mcp 后，该连接器的岗位引用数应归 0', async () => {
    expect(mcpRow('expense_mcp').positionCount).toBe(1) // 种子：被 401 引用
    await updatePosition(401, { connectorMcpIds: [] })
    expect(mcpRow('expense_mcp').positionCount).toBe(0)
  })

  it.fails('yuepu#51 402 绑定 expense_mcp 后，该连接器的岗位引用数应 +1', async () => {
    await updatePosition(402, { connectorMcpIds: ['mail_center', 'crm', 'expense_mcp'] })
    expect(mcpRow('expense_mcp').positionCount).toBe(2)
  })
})

describe('yuepu#52 删岗不清知识库可见范围', () => {
  it.fails('yuepu#52 删掉岗位后，以它为可见范围的岗位知识库不应再指向已删岗位', async () => {
    const pos = await createPosition({ name: '临时验证岗', icon: '🧪' })
    const kb = await kbMock.create({ name: '临时岗位库', icon: '📘', kbType: 'POSITION', scopeRefId: pos.positionId, description: 'x' })
    await deletePosition(pos.positionId)
    const after = await kbMock.get(kb.id)
    expect(String(after.scopeRefId)).not.toBe(String(pos.positionId))
  })
})

describe('yuepu#57 数据层守卫 / 校验缺口', () => {
  // ① md prd.岗位.md:97,119 仅「未发布且不在审核中」可删；403 = 草稿 + 待发布审核
  it.fails('yuepu#57① 审核中的岗位（403）数据层应拒绝删除', async () => {
    // 种子把用户 204 绑在 403 上，删除会先被「已被领用」拦下——先解绑，才测得到「审核中」这道守卫
    await setUserPosition(204, null)
    await expect(deletePosition(403)).rejects.toThrow()
  })

  // ② md 岗位 §6.4 候选为「已发布」的岗位私有技能
  it.fails('yuepu#57② Agent 不应能引用未发布的岗位私有技能', async () => {
    const { skillId } = await skillMock.createSkill({ name: '未发布私有技能', type: 'POSITION', categoryName: '办公效率' })
    const agent = await createAgent(404, { name: '验证 Agent' })
    await expect(assignSkill(skillId, agent.agentId ?? agent.id)).rejects.toThrow()
  })

  // ③ relistSkill 无状态守卫：从未发布的草稿也能被「重新上架」
  it.fails('yuepu#57③ 未发布的技能调用 relistSkill 应被拒绝', async () => {
    const { skillId } = await skillMock.createSkill({ name: '草稿技能', type: 'PLATFORM', categoryName: '办公效率' })
    await expect(skillMock.relistSkill(skillId)).rejects.toThrow()
  })

  // ④ 审核中的 MCP 已锁定（update 拒写），拉取工具却能覆盖其 tools；种子 crm = 待审核
  it.fails('yuepu#57④ 审核中的 MCP（crm）拉取工具应被拒绝', async () => {
    const crm = mcpRow('crm')
    await expect(fetchMcpTools(crm.id)).rejects.toThrow()
  })

  // ⑤ 专家整批 skillIds 不按候选（已发布的市场技能）校验
  it.fails('yuepu#57⑤ 专家整批写入未发布技能应被拒绝', async () => {
    const { skillId } = await skillMock.createSkill({ name: '未发布市场技能', type: 'PLATFORM', categoryName: '办公效率' })
    await expect(updateExpert(201, { skillIds: [302, 304, skillId] })).rejects.toThrow()
  })

  // ⑥ md MCP §三.3 连接器类型必选；mock 以缺省即 PLATFORM 兜底
  it.fails('yuepu#57⑥ 新建 MCP 不传连接器类型应被拒绝', async () => {
    await expect(createMcp({
      code: 'no_type_mcp', name: '无类型 MCP', icon: '🧪', transport: 'streamable-http',
      endpoint: 'https://x.intra/mcp', description: '验证用', exampleQuestions: ['问题一', '问题二', '问题三']
    })).rejects.toThrow()
  })
})
