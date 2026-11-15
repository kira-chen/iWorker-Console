// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ToolDock 工具坞 · 连接器发布态（产品优化需求-202611 修改点 13（R4））。
 *
 * 技能编辑页（SkillFocusEditor 在 adminContext 下传 includeUnpublished）候选放开到未发布 / 审核中的连接器：
 * - 两条数据源（FDE listToolPicker / 平台族通道 toolPicker）都带 includeUnpublished，不传 prop 时不带（候选口径不变）；
 * - 工具卡名称旁标「未发布」「审核中」，已发布不标；健康标识照旧。
 * 数据层只桩 api（返回固定工具项），断言落在请求参数与卡片上用户可见的文案。
 */
const listToolPickerMock = vi.fn()
const platformToolPickerMock = vi.fn()

vi.mock('@/api/position', () => ({
  listToolPicker: (...a) => listToolPickerMock(...a)
}))
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { toolPicker: (...a) => platformToolPickerMock(...a) },
  systemSkillApi: { toolPicker: (...a) => platformToolPickerMock(...a) }
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(), getDataTable: vi.fn() }))

import ToolDock from '@/components/position/ToolDock.vue'

const stubs = {
  'el-icon': { template: '<i><slot /></i>' },
  'el-dialog': { template: '<div><slot /></div>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot /></div>' },
  'router-link': { template: '<a><slot /></a>' }
}

const TOOLS = [
  { code: 'mcp__draft', bizName: '草稿 MCP', description: '', displayStatus: 'HEALTHY', pubState: 'UNPUBLISHED' },
  { code: 'mcp__review', bizName: '在审 MCP', description: '', displayStatus: 'UNKNOWN', pubState: 'REVIEWING' },
  { code: 'mcp__live', bizName: '上线 MCP', description: '', displayStatus: 'HEALTHY', pubState: 'PUBLISHED' }
]

let container
let app
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(ToolDock, {
        collapsed: false,
        positionId: null,
        skillSource: 'platform',
        tabs: ['MCP', 'API', 'BIZ_SYSTEM'],
        connectorEmptyLink: true,
        ...props
      })
  })
  app.directive('loading', {})
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  // fetchTools 是 async：等请求 resolve + 渲染
  for (let i = 0; i < 4; i++) await nextTick()
  return container
}
const cardOf = (el, name) => [...el.querySelectorAll('.dtool')].find((c) => c.querySelector('.dtool-name')?.textContent.trim() === name)

beforeEach(() => {
  listToolPickerMock.mockReset()
  listToolPickerMock.mockResolvedValue(TOOLS)
  platformToolPickerMock.mockReset()
  platformToolPickerMock.mockResolvedValue(TOOLS)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ToolDock 候选含未发布 / 审核中的连接器（R4）', () => {
  it.each([
    ['平台族通道（市场 / 通用技能）', 'platform', platformToolPickerMock],
    ['FDE 通道（岗位私有技能）', 'fde', listToolPickerMock]
  ])('includeUnpublished 开启 → %s的 tool-picker 请求带 includeUnpublished: true', async (_n, skillSource, spy) => {
    await mount({ skillSource, includeUnpublished: true })
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'MCP', includeUnpublished: true })
  })

  it('不传 includeUnpublished（默认）→ 请求不带该参数，候选口径不变', async () => {
    await mount({ skillSource: 'platform' })
    expect(platformToolPickerMock).toHaveBeenCalled()
    expect(platformToolPickerMock.mock.calls[0][0]).not.toHaveProperty('includeUnpublished')
  })

  it('工具卡名称旁标发布态：未发布标「未发布」、审核中标「审核中」、已发布不标；健康标识照旧', async () => {
    const el = await mount({ includeUnpublished: true })
    const draft = cardOf(el, '草稿 MCP')
    const review = cardOf(el, '在审 MCP')
    const live = cardOf(el, '上线 MCP')
    expect(draft.querySelector('.pubtag')?.textContent.trim()).toBe('未发布')
    expect(review.querySelector('.pubtag')?.textContent.trim()).toBe('审核中')
    expect(live.querySelector('.pubtag')).toBeNull()
    // 标签紧贴名称（名称的下一个兄弟节点），健康标识仍在
    expect(draft.querySelector('.dtool-name').nextElementSibling.classList.contains('pubtag')).toBe(true)
    expect(live.querySelector('.health')?.textContent).toContain('连接正常')
  })
})
