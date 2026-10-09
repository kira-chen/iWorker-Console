// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountReal, flushAll } from '@/views/admin/__tests__/helpers/smokeMount'

/**
 * 编辑器顶部「已回收」提示条（RevokedBanner）——API / 业务系统 / MCP / 专家四个编辑抽屉。
 * （技能整页编辑器见 views/admin/__tests__/revokedBannerInSkillEditPage.test.js）
 *
 * 2026-10-09 对齐 PRD「强制回收」小节（/test-audit 补缺口 A6）：
 *  - 专家 prd.专家.md §3.5.1、MCP prd-连接器-MCP.md §3.6.1、API prd-API.md、业务系统 prd-业务系统.md：
 *    被强制回收的对象，编辑 / 查看页顶部展示「该{对象}已于 {时间} 被强制回收：{原因}」；未被回收则不展示。
 *    对象名：专家 / MCP / API / 业务系统。
 *
 * 真 Element Plus 挂载（同 connectorEditorsSmoke / expertEditorSmoke 写法），只 mock api 层与 vue-router，
 * 断言落在用户可见的提示条文案上。挂载条件（读各编辑器模板确认）：
 *  - ApiEditor / BizSystemEditor / McpEditor：编辑态（传了对象 id）恒挂，info 取详情 revoked，空则条自行不渲染；
 *  - ExpertEditor：编辑态且 detail.revoked 非空才挂；新建态一律不挂。
 */
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => ({ resolve: () => ({ href: '/x' }), push: vi.fn(), replace: vi.fn() }),
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  createWebHistory: () => ({})
}))

const admin = vi.hoisted(() => ({
  getMcp: vi.fn(),
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn(),
  getBizSystem: vi.fn(),
  createBizSystem: vi.fn(),
  updateBizSystem: vi.fn(),
  listBizSystemSkills: vi.fn(),
  createBizSystemOwnedSkill: vi.fn(),
  deleteBizSystemOwnedSkill: vi.fn()
}))
vi.mock('@/api/admin', () => admin)

const conn = vi.hoisted(() => ({
  getApi: vi.fn(),
  createApi: vi.fn(),
  updateApi: vi.fn(),
  listProviderSystems: vi.fn()
}))
vi.mock('@/api/apiConnector', () => conn)

const expertApi = vi.hoisted(() => ({
  getExpert: vi.fn(),
  createExpert: vi.fn(),
  updateExpert: vi.fn(),
  listExpertSkillCandidates: vi.fn(),
  getExpertKbScopeRefId: vi.fn(() => null)
}))
vi.mock('@/api/domainExpert', () => expertApi)
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn().mockResolvedValue({ list: [], total: 0 }) }))

// 图标选择浮层（IconField 内部）会拉图标库 / 探测 AI 图标可用性
vi.mock('@/api/position', () => ({
  getIconLibrary: vi.fn(() => Promise.resolve([])),
  aiGenerateIcon: vi.fn(),
  probeAiIconAvailability: vi.fn(() => Promise.resolve({ available: false }))
}))

const McpEditor = (await import('@/components/admin/McpEditor.vue')).default
const ApiEditor = (await import('@/components/admin/ApiEditor.vue')).default
const BizSystemEditor = (await import('@/components/admin/BizSystemEditor.vue')).default
const ExpertEditor = (await import('@/components/admin/ExpertEditor.vue')).default

const REVOKED = { reason: '接口泄露了客户手机号', at: '2026-10-09 09:30', operator: 'admin' }
const BANNER = '.revoked-banner'

const MCP_DETAIL = {
  id: 'mcp_1', name: '报销系统 MCP', icon: '¥', type: 'PLATFORM', description: '查询和提交员工报销单',
  transport: 'streamable-http', endpoint: 'https://expense.intra/mcp', timeoutMs: 15000,
  authInfo: { type: 'bearer', valueMasked: 'ab***yz' }, exampleQuestions: ['问一', '问二', '问三'],
  tools: [], referencedBySkills: [], connStatus: 'ok',
  createdAt: '2026-08-18T09:30:00Z', updatedAt: '2026-08-23T09:48:00Z'
}
const API_DETAIL = {
  code: 'api_1', name: '报销查询', icon: '📄', description: '按报销单号查询审批状态', providerSystemId: 'pv_1',
  type: 'PLATFORM', url: 'https://api.x.com/q', method: 'GET', enabled: true, readWrite: 'read',
  exampleQuestions: ['问题一', '问题二', '问题三'], authType: 'NONE', authConfig: null,
  requestSchema: null, responseSchema: null, referencedBySkills: [],
  createdAt: '2026-08-20T09:30:00+08:00', updatedAt: '2026-08-24T16:10:00+08:00', publishedAt: null
}
const BIZ_DETAIL = {
  name: 'CRM', type: 'PLATFORM', icon: '◎', description: '客户管理', loginUrl: 'https://crm.example.com/login',
  connType: 'login_session', bizPages: [{ url: 'https://crm.example.com/workspace', name: '工作台', description: '' }],
  exampleQuestions: ['问题一', '问题二', '问题三'], referencedBySkills: [],
  createdAt: '2026-08-18T10:20:00+08:00', updatedAt: '2026-08-24T15:40:00+08:00', publishedAt: null
}
const EXPERT_DETAIL = {
  id: 201, name: '经营分析专家', category: '投资', avatar: '▤', backgroundColor: '#DCF5E4', intro: '汇总经营数据',
  roleDesc: '你是一名经营分析专家。', status: 'draft', pendingAction: null, latestVersionLabel: 'v2.3.0',
  createdAt: '2026-08-12T09:20:00+08:00', updatedAt: '2026-08-24T14:12:00+08:00', publishedAt: '2026-08-20T16:30:00+08:00',
  exampleQuestions: ['问一', '问二', '问三'], skillIds: [], skills: []
}

let mounted
beforeEach(() => {
  vi.clearAllMocks()
  admin.getMcp.mockResolvedValue({ ...MCP_DETAIL })
  admin.getBizSystem.mockResolvedValue({ ...BIZ_DETAIL })
  admin.listBizSystemSkills.mockResolvedValue([])
  conn.getApi.mockResolvedValue({ ...API_DETAIL })
  conn.listProviderSystems.mockResolvedValue({ list: [{ id: 'pv_1', name: '财务系统' }] })
  expertApi.getExpert.mockResolvedValue({ ...EXPERT_DETAIL })
  expertApi.listExpertSkillCandidates.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

async function open(Component, props) {
  mounted = mountReal(Component, { visible: true, ...props })
  await flushAll(12)
  return mounted.container
}
const bannerText = (el) => el.querySelector(BANNER)?.textContent.trim()

describe('ApiEditor · 已回收提示条（prd-API.md「强制回收」）', () => {
  it('编辑一个被强制回收的 API → 顶部提示「该API已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号」', async () => {
    conn.getApi.mockResolvedValue({ ...API_DETAIL, revoked: REVOKED })
    const el = await open(ApiEditor, { apiId: 'api_1' })
    expect(bannerText(el)).toBe('该API已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号')
  })

  it('查看态（只读）同样展示提示条', async () => {
    conn.getApi.mockResolvedValue({ ...API_DETAIL, revoked: REVOKED })
    const el = await open(ApiEditor, { apiId: 'api_1', readonly: true })
    expect(bannerText(el)).toContain('被强制回收：接口泄露了客户手机号')
  })

  it('没被回收过的 API → 不出现提示条', async () => {
    const el = await open(ApiEditor, { apiId: 'api_1' })
    expect(el.querySelector(BANNER)).toBeNull()
  })

  it('新建 API → 不出现提示条', async () => {
    const el = await open(ApiEditor, { apiId: null })
    expect(el.querySelector(BANNER)).toBeNull()
  })
})

describe('BizSystemEditor · 已回收提示条（prd-业务系统.md「强制回收」）', () => {
  it('编辑一个被强制回收的业务系统 → 顶部提示「该业务系统已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号」', async () => {
    admin.getBizSystem.mockResolvedValue({ ...BIZ_DETAIL, revoked: REVOKED })
    const el = await open(BizSystemEditor, { bizId: 'biz_1' })
    expect(bannerText(el)).toBe('该业务系统已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号')
  })

  it('没被回收过的业务系统 → 不出现提示条', async () => {
    const el = await open(BizSystemEditor, { bizId: 'biz_1' })
    expect(el.querySelector(BANNER)).toBeNull()
  })

  it('新建业务系统 → 不出现提示条', async () => {
    const el = await open(BizSystemEditor, { bizId: null })
    expect(el.querySelector(BANNER)).toBeNull()
  })
})

describe('McpEditor · 已回收提示条（prd-连接器-MCP.md §3.6.1）', () => {
  it('编辑一个被强制回收的 MCP → 顶部提示「该MCP已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号」', async () => {
    admin.getMcp.mockResolvedValue({ ...MCP_DETAIL, revoked: REVOKED })
    const el = await open(McpEditor, { mcpId: 'mcp_1' })
    expect(bannerText(el)).toBe('该MCP已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号')
  })

  it('没被回收过的 MCP → 不出现提示条', async () => {
    const el = await open(McpEditor, { mcpId: 'mcp_1' })
    expect(el.querySelector(BANNER)).toBeNull()
  })

  it('登记（新建）MCP → 不出现提示条', async () => {
    const el = await open(McpEditor, { mcpId: null })
    expect(el.querySelector(BANNER)).toBeNull()
  })
})

describe('ExpertEditor · 已回收提示条（prd.专家.md §3.5.1）', () => {
  it('编辑一个被强制回收的专家 → 顶部提示「该专家已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号」', async () => {
    expertApi.getExpert.mockResolvedValue({ ...EXPERT_DETAIL, revoked: REVOKED })
    const el = await open(ExpertEditor, { expertId: 201 })
    expect(bannerText(el)).toBe('该专家已于 2026-10-09 09:30 被强制回收：接口泄露了客户手机号')
  })

  it('查看态（只读）同样展示提示条', async () => {
    expertApi.getExpert.mockResolvedValue({ ...EXPERT_DETAIL, revoked: REVOKED })
    const el = await open(ExpertEditor, { expertId: 201, readonly: true })
    expect(bannerText(el)).toContain('被强制回收：接口泄露了客户手机号')
  })

  it('没被回收过的专家 → 不出现提示条', async () => {
    const el = await open(ExpertEditor, { expertId: 201 })
    expect(el.querySelector(BANNER)).toBeNull()
  })

  it('新建专家 → 不出现提示条', async () => {
    const el = await open(ExpertEditor, { expertId: null })
    expect(el.querySelector(BANNER)).toBeNull()
  })
})
