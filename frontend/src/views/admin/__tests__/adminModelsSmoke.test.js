// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminModels.vue 真实挂载冒烟（2026-09-12 测试审计 T50）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md §一.1 页面标题与说明 / §二.1 列表展示 / §二.3.4 验证列。
 *
 * 与 adminModels.test.js（全桩）互补：这里 app.use(ElementPlus) 真装、真 el-table / ListPagination /
 * HealthTag / StatusTag / ModelConfigEditDialog，只 mock api 层；守住「页面能挂起来、探针文案在、控制台零 error」。
 */

const api = {
  listModels: vi.fn(),
  deleteModel: vi.fn(),
  verifyModel: vi.fn(),
  publishModel: vi.fn(),
  delistModel: vi.fn(),
  withdrawModel: vi.fn(),
  setDefaultModel: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn()
}
vi.mock('@/api/adminModel', () => api)

const AdminModels = (await import('@/views/admin/AdminModels.vue')).default

const LIST = [
  {
    id: 'md_101', name: 'DeepSeek R1', icon: '◎', providerName: 'deepseek', category: 'TEXT',
    contextWindow: 64000, defaultTemperature: 0.6, status: 'PUBLISHED', pendingAction: null, isDefault: true,
    verifyStatus: 'SUCCESS', verifiedAt: '2026-08-24T09:46:00+08:00', verifyLatencyMs: 112,
    updatedAt: '2026-08-24T09:48:00+08:00'
  },
  {
    id: 'md_105', name: '营销文生图', icon: '▧', providerName: 'other', category: 'IMAGE_GEN',
    contextWindow: 4096, defaultTemperature: 1, status: 'DRAFT', pendingAction: null, isDefault: false,
    verifyStatus: 'UNVERIFIED', verifiedAt: null, updatedAt: '2026-08-20T15:20:00+08:00'
  }
]

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('AdminModels · 真实挂载冒烟（真 Element Plus，只 mock api）', () => {
  it('挂载不抛：页头「模型」+ 说明、种子行「DeepSeek R1」、验证列「连接正常」/「未探测」、分页条在、console.error 零调用（md §一.1 / §二.1）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.listModels.mockResolvedValue({ list: LIST, total: LIST.length })

    expect(() => { mounted = mountReal(AdminModels) }).not.toThrow()
    await flushAll(10)
    const text = mounted.container.textContent

    // 页头 + 说明（md §一.1）
    expect(text).toContain('模型')
    expect(text).toContain('接入 OpenAI 协议第三方大模型：配置鉴权 → 验证连通性 → 上架后开放客户端下载')
    expect(text).toContain('接入模型')
    // 真 el-table 渲染出行：名称 / 状态 / 类别标签 / 上下文简写 / 温度
    const rows = mounted.container.querySelectorAll('.el-table__body tr.el-table__row')
    expect(rows.length).toBe(2)
    expect(text).toContain('DeepSeek R1')
    expect(text).toContain('默认')
    expect(text).toContain('已发布')
    expect(text).toContain('未发布')
    expect(text).toContain('文本生成')
    expect(text).toContain('文生图')
    expect(text).toContain('0.6')
    // 验证列（md §二.3.4）：真 HealthTag 四态文案
    expect(text).toContain('连接正常')
    expect(text).toContain('未探测')
    expect(mounted.container.querySelectorAll('.md-vc-refresh').length).toBe(2)
    // 操作列按状态（md §二.3.1）：已发布默认行 3 个、未发布未验证行 4 个（发布禁用）
    const opsTexts = [...rows].map((r) => [...r.querySelectorAll('.tbl-ops .el-button')].map((b) => b.textContent.trim()))
    expect(opsTexts[0]).toEqual(['查看', '编辑', '停用'])
    expect(opsTexts[1]).toEqual(['查看', '编辑', '发布', '删除'])
    expect([...rows[1].querySelectorAll('.tbl-ops .el-button')].find((b) => b.textContent.trim() === '发布').disabled).toBe(true)
    // 统一分页条（ListPagination）真渲染：共 N 条数据
    expect(mounted.container.querySelector('.list-pager')).toBeTruthy()
    expect(mounted.container.querySelector('.list-pager-info').textContent).toContain('共 2 ')
    // 控制台零错误（含 Vue 警告——props 形状/未注册组件都会以 warn 冒出来）
    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([])
  })

  it('点「接入模型」→ 真 el-drawer 打开「接入模型」抽屉（md §一.1 / §三.1），console.error 零调用', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.listModels.mockResolvedValue({ list: LIST, total: LIST.length })
    mounted = mountReal(AdminModels)
    await flushAll(10)
    const create = [...mounted.container.querySelectorAll('.lt-create')].find((b) => b.textContent.includes('接入模型'))
    create.click()
    await flushAll(10)
    // el-drawer 默认挂在页面内（DrawerEditor 非 appendToBody），标题在 .de-head-title
    const title = document.body.querySelector('.de-head-title')
    expect(title?.textContent).toBe('接入模型')
    expect(document.body.textContent).toContain('基本信息')
    expect(document.body.textContent).toContain('连接与鉴权')
    expect(errSpy).not.toHaveBeenCalled()
  })
})
