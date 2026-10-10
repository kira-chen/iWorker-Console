// @vitest-environment jsdom
// （各 mock → request.js → router 链路触达 window，故用 jsdom，同 positionMock.test.js）
import { describe, it, expect, beforeEach } from 'vitest'

/**
 * 已修缺陷回归集（数据层）+ 未来新缺陷的钉桩落点——2026-10-09 改写。
 *
 * 【现状】2026-10-08 待办核验登记的缺陷（yuepu#50 #51 #52 #57 #61②）已全部修好，本文件里原来的 `it.fails`
 * 都已按 CLAUDE.md「测试约定」转成正式 `it`，成为回归用例；文件里已没有 `it.fails`。用例名前缀 `yuepu#NN`
 * 对应 docs/产品经理待办任务/yuepu.md 的待办序号。
 *
 * 【未来新钉桩放这里】发现「代码与 md 不一致、但不归本次任务修」的数据层缺陷时，按「修好后应有的行为」写成
 * `it.fails('yuepu#NN …')` / `it.fails('clcao#NN …')`（CLAUDE.md 测试约定：it.fails 钉桩集中在本文件与各页面用例旁）：
 * 缺陷还在 → 断言失败 → 该条算通过；缺陷修好 → 断言通过 → `it.fails` 反而报红，提醒修复人把它改回 `it`、
 * 并在 commit 说明里写「关闭待办 <人>#<序号>」。页面交互类缺陷钉在各自页面用例旁，本文件只收数据层可直接复现的。
 *
 * 【前提必须拆成普通 it】`it.fails` 遇到任何异常都算「通过」——种子状态、前置写操作若写在 it.fails 里，
 * 种子一变或前置步骤先报错，钉桩就会「为错误的原因通过」，缺陷修好也不再翻红。所以每组的前提都拆成同 describe
 * 的普通 `it`，`it.fails` 里只留缺陷断言。
 *
 * 【转正须知】unifiedSkillMock / knowledgeBaseMock 没有 __reset 导出，#57②③⑤ 往这两个模块里写了新行
 * （名字各不相同，现阶段互不影响）；新增用例沿用唯一命名，或先给它们补重置，免得跨用例累积。
 */
import {
  deletePosition,
  updatePosition,
  createPosition,
  createAgent,
  assignSkill,
  getPosition,
  listPositions,
  __resetPositionMock
} from '../positionMock'
import { setUserPosition, __resetPositionAssignmentMock } from '../positionAssignmentMock'
import { __resetOrgMock } from '../adminUserMock'
import { __resetSampleTaskMock } from '../sampleTaskMock'
import { __resetDataTableMock } from '../dataTableMock'
import { __resetRuntimeSpecMock } from '../runtimeSpecMock'
import { updateExpert, __resetExpertMock } from '../domainExpertMock'
import { listMcpSync, createMcp, fetchMcpTools, __resetMcpMock } from '../mcpConnectorMock'
import { listApisSync, __resetApiMock } from '../apiConnectorMock'
import { createBizSystem, listBizSystemsSync, __resetBizSystemMock } from '../bizSystemMock'
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
const skillNumId = (id) => Number(String(id).replace('sk_', ''))

describe('yuepu#50（已修）连接器发布态未联动技能工具坞', () => {
  // 一览表 :195「停用后技能不再可引用该 API」；种子 mail_center 未发布、健康度 ok
  it('前提：工具坞候选含已发布的 expense_mcp（code 带 mcp__ 前缀），mail_center 种子为未发布', async () => {
    const codes = (await skillMock.toolPicker({ type: 'MCP' })).map((t) => t.code)
    expect(codes).toContain('mcp__expense_mcp')
    expect(mcpRow('expense_mcp').publishedAt).toBeTruthy()
    expect(mcpRow('mail_center')).toMatchObject({ publishedAt: null, pendingAction: null })
  })

  it('yuepu#50 工具坞候选不应列出未发布的 MCP（mail_center）', async () => {
    const codes = (await skillMock.toolPicker({ type: 'MCP' })).map((t) => t.code)
    expect(codes).not.toContain('mcp__mail_center')
  })
})

describe('yuepu#51（已修）岗位侧绑定 / 解绑回写连接器「N 个岗位引用」', () => {
  // prd-连接器-MCP.md:51「N 为引用了该连接器的岗位数，引用关系在岗位侧产生」
  it('前提：expense_mcp 种子被 401 引用（positionCount=1）；401 解绑、402 改绑的保存都能成功', async () => {
    expect(mcpRow('expense_mcp').positionCount).toBe(1)
    await expect(updatePosition(401, { connectorMcpIds: [] })).resolves.toMatchObject({ positionId: 401 })
    // 只绑已发布的 expense_mcp：若 #57⑧（只能绑已发布）先修好，改绑未发布的会被拒，钉桩会为错误的原因通过
    await expect(updatePosition(402, { connectorMcpIds: ['expense_mcp'] })).resolves.toMatchObject({ positionId: 402 })
  })

  it('yuepu#51 401 解绑 expense_mcp 后，该连接器的岗位引用数归 0、引用清单里不再有 401', async () => {
    await updatePosition(401, { connectorMcpIds: [] })
    expect(mcpRow('expense_mcp').positionCount).toBe(0)
    expect(mcpRow('expense_mcp').referencedByPositions).toEqual([])
  })

  it('yuepu#51 402 绑定 expense_mcp 后，该连接器的岗位引用数 +1，清单带岗位名；重复保存不重复计数', async () => {
    await updatePosition(402, { connectorMcpIds: ['expense_mcp', 'mail_center', 'crm'] })
    await updatePosition(402, { connectorMcpIds: ['expense_mcp', 'mail_center', 'crm'] })
    expect(mcpRow('expense_mcp').positionCount).toBe(2)
    expect(mcpRow('expense_mcp').referencedByPositions.map((p) => [p.positionId, p.positionName])).toEqual([[401, '经营分析岗'], [402, '客户成功岗']])
  })

  it('yuepu#51 API / 业务系统同口径：401 解绑 api_1101 与 biz_2101 → 各自引用数减 1；改名后清单带新名', async () => {
    const apiRow = (id) => listApisSync().find((a) => a.id === id)
    const bizRow = (id) => listBizSystemsSync().find((b) => b.id === id)
    expect(apiRow('api_1101').positionCount).toBe(1)
    expect(bizRow('biz_2101').positionCount).toBe(2)
    await updatePosition(401, { connectorApiIds: [], businessSystemIds: [] })
    expect(apiRow('api_1101').positionCount).toBe(0)
    expect(bizRow('biz_2101').referencedByPositions.map((p) => p.positionId)).toEqual([402])
    await updatePosition(402, { name: '客户成功岗（改名）', businessSystemIds: ['biz_2101'] })
    expect(bizRow('biz_2101').referencedByPositions).toEqual([{ positionId: 402, positionName: '客户成功岗（改名）' }])
  })

  it('yuepu#51 未带连接器键的普通保存（只改描述）不动连接器引用', async () => {
    await updatePosition(401, { description: '只改描述' })
    expect(mcpRow('expense_mcp').positionCount).toBe(1)
  })
})

// yuepu#52（已修）删岗清知识库可见范围：强断言（id 恰 +1、岗位库 scopeRefId 落盘置空、非岗位库不被清）在 positionIdReuse.test.js

describe('yuepu#57（已修）数据层守卫 / 校验缺口', () => {
  // ① md prd.岗位.md:97,119 仅「未发布且不在审核中」可删；403 = 草稿 + 待发布审核。
  // 种子把用户 204 绑在 403 上，删除会先被「已被领用」拦下——先解绑，才测得到「审核中」这道守卫
  it('前提：403 为草稿 + 在途发布审核；解绑 204 后领用数为 0', async () => {
    const p403 = (await listPositions({ size: 50 })).list.find((p) => p.positionId === 403)
    expect(p403).toMatchObject({ status: 'draft', pendingAction: 'PUBLISH' })
    await setUserPosition(204, null)
    expect((await listPositions({ size: 50 })).list.find((p) => p.positionId === 403).claimedUserCount).toBe(0)
  })

  it('yuepu#57① 审核中的岗位（403）数据层拒绝删除，已发布的岗位（402）也拒绝，列表里都还在', async () => {
    await setUserPosition(204, null)
    await expect(deletePosition(403)).rejects.toThrow(/审核/)
    // 402 已发布、仅 li.na（202）领用：解绑后只剩「已发布」这道守卫
    await setUserPosition(202, null)
    await expect(deletePosition(402)).rejects.toThrow(/已发布/)
    const ids = (await listPositions({ size: 50 })).list.map((p) => p.positionId)
    expect(ids).toEqual(expect.arrayContaining([402, 403]))
  })

  // ② md 岗位 §6.4 候选为「已发布」的岗位私有技能
  async function draftPositionSkillAndAgent() {
    const { skillId } = await skillMock.createSkill({ name: '未发布私有技能', type: 'POSITION', categoryName: '办公效率' })
    // 名称 + 职责描述都给齐：#4 号 K（createAgent 无必填校验）修好后，缺描述会先被拒，钉桩会为错误的原因通过
    const agent = await createAgent(404, { name: '验证 Agent', description: '验证用职责描述' })
    return { skillId, agentId: agent.agentId ?? agent.id }
  }

  it('前提：未发布的岗位私有技能与 404 下的新 Agent 都能建出来', async () => {
    const { skillId, agentId } = await draftPositionSkillAndAgent()
    expect(skillId).toBeTruthy()
    expect(agentId).toBeTruthy()
  })

  it('yuepu#57② Agent 不能引用未发布的岗位私有技能；已发布的仍可引用', async () => {
    const { skillId, agentId } = await draftPositionSkillAndAgent()
    await expect(assignSkill(skillId, agentId)).rejects.toThrow(/已发布/)
    await expect(assignSkill('sk_301', agentId)).resolves.toBeTruthy()
  })

  // ③ relistSkill 状态守卫（已修，转正式回归；正反向用例另见 unifiedSkillMock.test.js「重新上架状态守卫」）
  it('yuepu#57③ 未发布的技能调用 relistSkill 应被拒绝', async () => {
    const { skillId } = await skillMock.createSkill({ name: '草稿技能', type: 'PLATFORM', categoryName: '办公效率' })
    await expect(skillMock.relistSkill(skillId)).rejects.toMatchObject({ code: 40909 })
  })

  // ④ 审核中的 MCP 已锁定（update 拒写），拉取工具却能覆盖其 tools；种子 crm = 待审核
  it('前提：种子 crm 为审核中', () => {
    expect(mcpRow('crm').pendingAction).toBe('PUBLISH')
  })

  it('yuepu#57④ 审核中的 MCP（crm）拉取工具应被拒绝（提示审核中），且其工具清单与检活状态没被覆盖', async () => {
    const snap = () => { const { toolCount, lastCheckedAt, displayStatus } = mcpRow('crm'); return { toolCount, lastCheckedAt, displayStatus } }
    const before = snap()
    await expect(fetchMcpTools(mcpRow('crm').id)).rejects.toThrow(/审核中/)
    expect(snap()).toEqual(before)
  })

  // ⑤ 专家整批 skillIds 不按候选（已发布的市场技能）校验。专家 skillIds 契约是数字（domainExpertMock skillNumId），
  // 传 'sk_xxx' 字符串的话，修复若按「id 格式不合法」拒绝也会翻红，报出的原因是错的（专家组 T10）
  it('yuepu#57⑤ 专家整批写入未发布技能应被拒绝', async () => {
    const { skillId } = await skillMock.createSkill({ name: '未发布市场技能', type: 'PLATFORM', categoryName: '办公效率' })
    await expect(updateExpert(201, { skillIds: [302, 304, skillNumId(skillId)] })).rejects.toMatchObject({ field: 'skillIds' })
  })

})

describe('yuepu#57（已修）数据层守卫 / 校验缺口（2026-10-08 /test-audit 共享层补钉：⑥后半）', () => {
  // ⑥后半·MCP：一览表 :137「服务描述 最多 2000 字符」、:153「MCP 服务地址（Endpoint）最多 500 字符」；
  // API mock 两项都校验（apiConnectorMock validateApiPayload），MCP mock 都没有。类型显式传 PLATFORM，避开⑥前半（类型缺省兜底）
  const mcpPayload = (code, extra = {}) => ({
    code, name: `长度验证 ${code}`, icon: '🧪', type: 'PLATFORM', transport: 'streamable-http',
    endpoint: 'https://x.intra/mcp', description: '验证用', exampleQuestions: ['问题一', '问题二', '问题三'], ...extra
  })

  it('前提：字段齐全、地址与描述都在上限内的 MCP 能登记成功', async () => {
    await expect(createMcp(mcpPayload('len_ok_mcp'))).resolves.toMatchObject({ code: 'len_ok_mcp' })
  })

  it('yuepu#57⑥ MCP 服务地址超过 500 字符应被拒绝', async () => {
    await expect(createMcp(mcpPayload('long_ep_mcp', { endpoint: 'https://x.intra/' + 'a'.repeat(500) }))).rejects.toThrow(/500/)
  })

  it('yuepu#57⑥ MCP 服务描述超过 2000 字符应被拒绝', async () => {
    await expect(createMcp(mcpPayload('long_desc_mcp', { description: '述'.repeat(2001) }))).rejects.toThrow(/2000/)
  })

  // ⑥后半·业务系统：一览表 :227「登录地址 合法的 HTTP 或 HTTPS URL，最多 1024 字符」；validateBizPayload 只校验协议前缀
  const bizPayload = (name, extra = {}) => ({
    name, icon: '🧪', type: 'PLATFORM', description: '验证用', loginUrl: 'https://crm.intra/login',
    exampleQuestions: ['问题一', '问题二', '问题三'], ...extra
  })

  it('前提：字段齐全、登录地址在上限内的业务系统能登记成功', async () => {
    await expect(createBizSystem(bizPayload('长度验证业务系统'))).resolves.toMatchObject({ name: '长度验证业务系统' })
  })

  it('yuepu#57⑥ 业务系统登录地址超过 1024 字符应被拒绝', async () => {
    await expect(createBizSystem(bizPayload('超长登录地址系统', { loginUrl: 'https://crm.intra/' + 'a'.repeat(1024) }))).rejects.toThrow(/1024/)
  })

  // ⑦（单个分配选「未绑定」也把待分配申请标为已分配）不在此钉：缺陷在页面编排（AdminPositionAssignments.vue onSaved
  // 不看所选岗位一律调 markApplicationAssigned），数据层 markApplicationAssigned(id) 契约里没有岗位参数、无从判断，
  // 写成数据层断言等于替修复人臆造接口。页面层钉桩归岗位管理页用例。
})

describe('Agent 技能子行「技能分类」进数据层（yuepu#61② 已修；md 岗位 §6.4「技能子行展示：技能名称、技能分类、工具数量」）', () => {
  // 页面层钉桩 PositionAgentSkillTab.test.js 用的夹具直接写了 category:'数据分析'，真实 VO 里 category 恒为
  // OPERATION/QUERY 派生值，11 类技能分类根本没进 VO——修复多半新增字段承载，页面层钉桩不会翻红（岗位组 T17c、专家组 T11）。
  // 断言不绑字段名：技能子行 VO 的某个字段等于技能本体的分类即可。
  it('前提：401 的「数据汇总」Agent 引用了 sk_301，且该技能本体有 11 类分类值', async () => {
    const detail = await getPosition(401)
    const ref = detail.agents.find((a) => a.agentId === 501).skills[0]
    expect(ref.skillId).toBe('sk_301')
    expect(skillMock._getRaw('sk_301').category).toBeTruthy()
  })

  it('技能子行 VO 带出技能本体的分类（如「办公效率」），而不只是 OPERATION / QUERY（yuepu#61②）', async () => {
    const detail = await getPosition(401)
    const ref = detail.agents.find((a) => a.agentId === 501).skills[0]
    expect(ref.displayCategoryName).toBe(skillMock._getRaw('sk_301').category)
  })
})
