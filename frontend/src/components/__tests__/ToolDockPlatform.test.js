// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ToolDock 平台技能数据源（V34 切片2 修补）回归保护。
 *
 * 背景：平台技能编辑器复用 FDE 技能编辑器（SkillFocusEditor + ToolDock），但工具坞原写死调
 * GET /api/fde/skills/tool-picker（FDE_WORKBENCH 门）→ 系统配置员打该端点 403。
 * 修复：skillSource='platform' 时工具坞改调 listPlatformToolPicker（/fde/platform-skills/tool-picker，
 * SYS_CONFIG 门，只 MCP/API），且只渲染 MCP/API 两个 tab。
 *
 * 本测试断言（platform 模式）：
 * 1) 只渲染 MCP / API 两个 tab（无 数据表 / 业务系统）。
 * 2) 初始即调 listPlatformToolPicker（type=MCP），绝不调 listToolPicker（FDE 门）。
 * 3) 切到 API tab：调 listPlatformToolPicker(type=API)。
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

describe('ToolDock 平台技能数据源（403 修补回归保护）', () => {
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

  it('平台模式只渲染 MCP / API 两个 tab（无数据表 / 业务系统）', async () => {
    const el = mount()
    await nextTick()
    const labels = [...el.querySelectorAll('.dock-tab')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['MCP', 'API'])
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

  it('system 模式（V89 系统默认技能）同平台族：两 tab，tool-picker 走 systemSkillApi（系统前缀）', async () => {
    const el = mount({ skillSource: 'system' })
    await nextTick()
    await nextTick()
    const labels = [...el.querySelectorAll('.dock-tab')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['MCP', 'API'])
    expect(listSystemToolPickerMock).toHaveBeenCalled()
    expect(listSystemToolPickerMock.mock.calls[0][0]).toMatchObject({ type: 'MCP' })
    expect(listPlatformToolPickerMock).not.toHaveBeenCalled()
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('FDE 模式（默认 skillSource）仍渲染四 tab 且走 FDE listToolPicker（零回归对照）', async () => {
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
