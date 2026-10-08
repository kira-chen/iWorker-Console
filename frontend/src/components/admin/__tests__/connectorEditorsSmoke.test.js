// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountReal, flushAll } from '@/views/admin/__tests__/helpers/smokeMount'

/**
 * 连接器三个编辑抽屉（McpEditor / ApiEditor / BizSystemEditor）真实 Element Plus 挂载冒烟。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/：
 *  - MCP/prd-连接器-MCP.md §三.1 L202-203（登记态标题「登记 MCP」、底部【取消】【登记】；编辑态【取消】【保存】）；
 *  - API/prd-API.md §三.1（新建 / 编辑底部【取消】【保存】）；
 *  - 业务系统/prd-业务系统.md §三.1（新建 / 编辑底部【取消】【保存】）。
 *
 * 编辑器级单测（mcpEditor / ApiEditor / bizSystemEditor）把 el-drawer / el-form 等桩掉，拦不住
 * 真组件 setup 期报错、子组件 props 形状不对这类故障。本文件只 mock api 层与 vue-router，其余用真 Element Plus，
 * 以 visible=true 打开抽屉，新建与编辑各一次，断言：挂载不抛、console.error 零调用、抽屉标题与底部按钮。
 * 标题以组件现状为准：新建 API / 业务系统由 DrawerEditor 拼「新建」+ entity（「新建API」无空格、「新建业务系统」），
 * 编辑态同理拼「编辑」+ entity；md 写法带空格的差异仅排版，不钉。
 */
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => ({ resolve: () => ({ href: '/x' }), push: vi.fn(), replace: vi.fn() })
}))

const admin = vi.hoisted(() => ({
  // MCP
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  getMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn(),
  // 业务系统
  createBizSystem: vi.fn(),
  updateBizSystem: vi.fn(),
  getBizSystem: vi.fn(),
  listBizSystemSkills: vi.fn(),
  createBizSystemOwnedSkill: vi.fn(),
  deleteBizSystemOwnedSkill: vi.fn()
}))
vi.mock('@/api/admin', () => admin)

const conn = vi.hoisted(() => ({
  createApi: vi.fn(),
  updateApi: vi.fn(),
  getApi: vi.fn(),
  listProviderSystems: vi.fn()
}))
vi.mock('@/api/apiConnector', () => conn)

// 图标选择浮层（IconField 内部）会拉图标库 / 探测 AI 图标可用性
vi.mock('@/api/position', () => ({
  getIconLibrary: vi.fn(() => Promise.resolve([])),
  aiGenerateIcon: vi.fn(),
  probeAiIconAvailability: vi.fn(() => Promise.resolve({ available: false }))
}))

const McpEditor = (await import('@/components/admin/McpEditor.vue')).default
const ApiEditor = (await import('@/components/admin/ApiEditor.vue')).default
const BizSystemEditor = (await import('@/components/admin/BizSystemEditor.vue')).default

const MCP_DETAIL = {
  id: 'mcp_1',
  name: '报销系统 MCP',
  icon: '¥',
  type: 'PLATFORM',
  description: '查询和提交员工报销单',
  transport: 'streamable-http',
  endpoint: 'https://expense.intra/mcp',
  timeoutMs: 15000,
  authInfo: { type: 'bearer', valueMasked: 'ab***yz' },
  exampleQuestions: ['问一', '问二', '问三'],
  tools: [
    { name: 'expense_query', title: '报销单查询', description: '按单号查询', writeClass: 'READ', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  ],
  referencedBySkills: [{ skillId: 'sk_1', skillName: '报销助手' }],
  connStatus: 'ok',
  createdAt: '2026-08-18T09:30:00Z',
  updatedAt: '2026-08-23T09:48:00Z'
}
const API_DETAIL = {
  code: 'api_1',
  name: '报销查询',
  icon: '📄',
  description: '按报销单号查询审批状态',
  providerSystemId: 'pv_1',
  type: 'PLATFORM',
  url: 'https://api.x.com/q',
  method: 'GET',
  enabled: true,
  readWrite: 'read',
  exampleQuestions: ['问题一', '问题二', '问题三'],
  authType: 'NONE',
  authConfig: null,
  requestSchema: null,
  responseSchema: null,
  referencedBySkills: [],
  createdAt: '2026-08-20T09:30:00+08:00',
  updatedAt: '2026-08-24T16:10:00+08:00',
  publishedAt: null
}
const BIZ_DETAIL = {
  name: 'CRM',
  type: 'PLATFORM',
  icon: '◎',
  description: '客户管理',
  loginUrl: 'https://crm.example.com/login',
  connType: 'login_session',
  bizPages: [{ url: 'https://crm.example.com/workspace', name: '工作台', description: '' }],
  exampleQuestions: ['问题一', '问题二', '问题三'],
  referencedBySkills: [],
  createdAt: '2026-08-18T10:20:00+08:00',
  updatedAt: '2026-08-24T15:40:00+08:00',
  publishedAt: null
}

let mounted, errorSpy
beforeEach(() => {
  vi.clearAllMocks()
  admin.getMcp.mockResolvedValue({ ...MCP_DETAIL })
  admin.getBizSystem.mockResolvedValue({ ...BIZ_DETAIL })
  admin.listBizSystemSkills.mockResolvedValue([{ skillId: 'sk_b1', name: '客户记录' }])
  conn.getApi.mockResolvedValue({ ...API_DETAIL })
  conn.listProviderSystems.mockResolvedValue({ list: [{ id: 'pv_1', name: '财务系统' }] })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  errorSpy.mockRestore()
})

/** 真挂载并冲刷；返回容器。抽屉 append-to-body=false，内容渲染在容器内。 */
async function open(Component, props) {
  expect(() => {
    mounted = mountReal(Component, { visible: true, ...props })
  }).not.toThrow()
  await flushAll(10)
  return mounted.container
}
const title = (el) => el.querySelector('.de-head-title')?.textContent.trim()
const footerBtns = (el) => [...el.querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())

describe('McpEditor · 真 Element Plus 挂载冒烟（md MCP §三.1）', () => {
  it('登记态：挂载不抛、console.error 零调用，标题「登记 MCP」，底部【取消】【登记】', async () => {
    const el = await open(McpEditor, { mcpId: null })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(title(el)).toBe('登记 MCP')
    expect(footerBtns(el)).toEqual(['取消', '登记'])
    expect(el.querySelector('input[placeholder="如 报销系统 MCP"]')).toBeTruthy()
    expect(admin.getMcp).not.toHaveBeenCalled()
  })

  it('编辑态：挂载不抛、console.error 零调用，拉详情回填名称，标题「编辑MCP」，底部【取消】【保存】', async () => {
    const el = await open(McpEditor, { mcpId: 'mcp_1' })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(admin.getMcp).toHaveBeenCalledWith('mcp_1')
    expect(title(el)).toBe('编辑MCP')
    expect(footerBtns(el)).toEqual(['取消', '保存'])
    expect(el.querySelector('input[placeholder="如 报销系统 MCP"]').value).toBe('报销系统 MCP')
  })
})

describe('ApiEditor · 真 Element Plus 挂载冒烟（md API §三.1）', () => {
  it('新建态：挂载不抛、console.error 零调用，标题「新建API」，底部【取消】【保存】', async () => {
    const el = await open(ApiEditor, { apiId: null })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(title(el)).toBe('新建API')
    expect(footerBtns(el)).toEqual(['取消', '保存'])
    expect(conn.getApi).not.toHaveBeenCalled()
    expect(conn.listProviderSystems).toHaveBeenCalled()
  })

  it('编辑态：挂载不抛、console.error 零调用，拉详情回填名称，标题「编辑API」，底部【取消】【保存】', async () => {
    const el = await open(ApiEditor, { apiId: 'api_1' })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(conn.getApi).toHaveBeenCalledWith('api_1')
    expect(title(el)).toBe('编辑API')
    expect(footerBtns(el)).toEqual(['取消', '保存'])
    expect([...el.querySelectorAll('input')].some((i) => i.value === '报销查询')).toBe(true)
  })
})

describe('BizSystemEditor · 真 Element Plus 挂载冒烟（md 业务系统 §三.1）', () => {
  it('新建态：挂载不抛、console.error 零调用，标题「新建业务系统」，底部【取消】【保存】', async () => {
    const el = await open(BizSystemEditor, { bizId: null })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(title(el)).toBe('新建业务系统')
    expect(footerBtns(el)).toEqual(['取消', '保存'])
    expect(admin.getBizSystem).not.toHaveBeenCalled()
  })

  it('编辑态：挂载不抛、console.error 零调用，拉详情与专属技能，标题「编辑业务系统」，底部【取消】【保存】', async () => {
    const el = await open(BizSystemEditor, { bizId: 'biz_1' })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(admin.getBizSystem).toHaveBeenCalledWith('biz_1')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1')
    expect(title(el)).toBe('编辑业务系统')
    expect(footerBtns(el)).toEqual(['取消', '保存'])
    expect(el.textContent).toContain('客户记录')
  })
})
