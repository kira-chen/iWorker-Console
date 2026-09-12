// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ToolDock 工具坞：按 skillSource 分流数据源（platform / system 走各自通道的 toolPicker，fde 走 listToolPicker）。
 *
 * 2026-09-12 头注更新：原头注引用的「GET /api/fde/skills/tool-picker 403 / FDE_WORKBENCH 门 / SYS_CONFIG 门」
 * 属已退役的后端鉴权语境（发布单元 2026-09-01 一并退役），本仓为纯前端 demo，api 层由 mock 支撑；
 * 现只守「分流正确」这一件事：platform → platformSkillApi.toolPicker，system → systemSkillApi.toolPicker，
 * 两者绝不调 fde 的 listToolPicker（否则岗位无关的平台技能会带着 positionId 去查岗位工具）。
 *
 * 页签集：平台 / 系统技能编辑器恒传 props.tabs=ADMIN_TOOL_TABS（MCP / API / 业务系统），组件内「平台族只留两页签」
 * 的默认分支运行时不可达，已于 2026-09-12 随死码清理删除（审计 J13，2 条用例同删）；不传 tabs 时的默认四页签仍活
 * （业务系统技能 admin-context=false 走它），文末保留其零回归对照用例。
 *
 * 不引 @vue/test-utils：createApp 挂 jsdom + 存根 el 图标 / v-loading 指令。
 */

const listToolPickerMock = vi.fn()
const listPlatformToolPickerMock = vi.fn()
const listSystemToolPickerMock = vi.fn()

vi.mock('@/api/position', () => ({
  listToolPicker: (...a) => listToolPickerMock(...a)
}))
// V89 后 ToolDock 改走通道命名空间 api（platformSkillApi/systemSkillApi.toolPicker），按前缀分流
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { toolPicker: (...a) => listPlatformToolPickerMock(...a) },
  systemSkillApi: { toolPicker: (...a) => listSystemToolPickerMock(...a) }
}))
vi.mock('@/api/dataTable', () => ({
  listDataTables: vi.fn(),
  getDataTable: vi.fn()
}))

import ToolDock from '@/components/position/ToolDock.vue'

const iconStub = { template: '<i><slot /></i>' }
const stubs = {
  'el-icon': iconStub,
  'el-dialog': { template: '<div><slot /></div>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot /></div>' }
}

let container
let app

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(ToolDock, {
        collapsed: false,
        // 平台技能无岗位 → positionId null；数据源 platform
        positionId: null,
        skillName: '平台技能',
        skillSource: 'platform',
        ...props,
        onInsert: () => {}
      })
  })
  app.directive('loading', {})
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}

describe('ToolDock 平台族数据源分流（platform / system 各走自己的 toolPicker，不调 FDE 门）', () => {
  beforeEach(() => {
    listToolPickerMock.mockReset()
    listPlatformToolPickerMock.mockReset()
    listPlatformToolPickerMock.mockResolvedValue([])
    listSystemToolPickerMock.mockReset()
    listSystemToolPickerMock.mockResolvedValue([])
  })
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('初始拉 listPlatformToolPicker(type=MCP)，绝不调 FDE 门 listToolPicker', async () => {
    mount()
    await nextTick()
    await nextTick()
    expect(listPlatformToolPickerMock).toHaveBeenCalled()
    expect(listPlatformToolPickerMock.mock.calls[0][0]).toMatchObject({ type: 'MCP' })
    // 平台数据源不接 positionId
    expect(listPlatformToolPickerMock.mock.calls[0][0]).not.toHaveProperty('positionId')
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('切到 API tab：调 listPlatformToolPicker(type=API)', async () => {
    const el = mount()
    await nextTick()
    const apiTab = [...el.querySelectorAll('.dock-tab')].find((t) => t.textContent.trim() === 'API')
    expect(apiTab).toBeTruthy()
    apiTab.click()
    await nextTick()
    await nextTick()
    const calledApi = listPlatformToolPickerMock.mock.calls.some((c) => c[0]?.type === 'API')
    expect(calledApi).toBe(true)
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })
})

/**
 * 默认页签（不传 tabs）：恒为 FDE 四页签，与 skillSource 无关（J13 2026-09-12 删平台族两页签分支后的现状）。
 * 业务系统技能编辑器（AdminSkillEditPage admin-context=false → tabs=null）走这里，须保持四页签零回归。
 */
describe('ToolDock 默认页签（不传 tabs 恒四页签，skillSource 只决定数据源）', () => {
  beforeEach(() => {
    listToolPickerMock.mockReset()
    listPlatformToolPickerMock.mockReset()
    listPlatformToolPickerMock.mockResolvedValue([])
    listSystemToolPickerMock.mockReset()
    listSystemToolPickerMock.mockResolvedValue([])
  })
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('system 模式（V89 系统默认技能）：tool-picker 走 systemSkillApi（系统前缀），不调 platform / FDE 门', async () => {
    mount({ skillSource: 'system' })
    await nextTick()
    await nextTick()
    expect(listSystemToolPickerMock).toHaveBeenCalled()
    expect(listSystemToolPickerMock.mock.calls[0][0]).toMatchObject({ type: 'MCP' })
    expect(listPlatformToolPickerMock).not.toHaveBeenCalled()
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('FDE 模式（默认 skillSource）渲染四 tab 且走 FDE listToolPicker（业务系统技能零回归对照）', async () => {
    listToolPickerMock.mockResolvedValue([])
    const el = mount({ skillSource: 'fde', positionId: 5 })
    await nextTick()
    await nextTick()
    const labels = [...el.querySelectorAll('.dock-tab')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['MCP', 'API', '数据表', '业务系统'])
    expect(listToolPickerMock).toHaveBeenCalled()
    expect(listPlatformToolPickerMock).not.toHaveBeenCalled()
  })
})
