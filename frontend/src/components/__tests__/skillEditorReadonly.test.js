// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * 只读态（平台技能 Tab 只读详情）组件级写入口关闭清单回归保护（设计 §4.2）：
 * - ToolDock(readonly)：不渲染 picker（搜索/Tab/插入），不拉工具清单；
 * - SkillFileTree(readonly)：不渲染节点 ⋯ 菜单 + 不渲染底部导出 zip 入口。
 * 写入口须 v-if 不渲染（非置灰），漏一个就「只读页能改」。
 */

const listToolPickerMock = vi.fn(() => Promise.resolve([]))
const listPlatformToolPickerMock = vi.fn(() => Promise.resolve([]))
vi.mock('@/api/position', () => ({ listToolPicker: (...a) => listToolPickerMock(...a) }))
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { toolPicker: (...a) => listPlatformToolPickerMock(...a) },
  systemSkillApi: { toolPicker: (...a) => listPlatformToolPickerMock(...a) }
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(), getDataTable: vi.fn() }))
vi.mock('@/api/skillFiles', () => ({
  saveSkillFile: vi.fn(), deleteSkillFile: vi.fn(), renameSkillFile: vi.fn(), exportSkillZip: vi.fn()
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), prompt: vi.fn() }
}))

const ToolDock = (await import('@/components/position/ToolDock.vue')).default
const SkillFileTree = (await import('@/components/position/SkillFileTree.vue')).default

const iconStub = { template: '<i><slot /></i>' }
// el-dropdown 存根渲染 #dropdown 插槽内容，以便断言「⋯ 菜单存在与否」。
const dropdownStub = { name: 'el-dropdown', template: '<div class="el-dropdown"><slot /><slot name="dropdown" /></div>' }
const stubs = {
  'el-icon': iconStub,
  'el-dialog': { template: '<div><slot /></div>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot /></div>' },
  'el-dropdown': dropdownStub,
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': { template: '<div class="el-dropdown-item"><slot /></div>' },
  'el-tree': {
    name: 'el-tree', props: ['data'],
    template: '<div class="el-tree"><template v-for="n in data" :key="n.path"><slot :node="{ expanded:false }" :data="n" /></template></div>'
  },
  'el-tooltip': { template: '<div><slot /></div>' },
  'el-skeleton': { template: '<div />' },
  'el-button': { template: '<button><slot /></button>' }
}

let container, app
function mount(component, props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(component, props) })
  app.directive('loading', {})
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { app?.unmount(); container?.remove() })

describe('ToolDock(readonly) · picker 写入口不渲染', () => {
  it('readonly → 无搜索框 / 无 Tab / 无插入按钮，且不拉工具清单', async () => {
    const el = mount(ToolDock, { collapsed: false, readonly: true, skillSource: 'platform-candidate', referencedView: [] })
    await nextTick(); await nextTick()
    expect(el.querySelector('.dock-search')).toBe(null)
    expect(el.querySelector('.dock-tab')).toBe(null)
    expect(el.querySelector('.dtool-insert')).toBe(null)
    expect(listToolPickerMock).not.toHaveBeenCalled()
    expect(listPlatformToolPickerMock).not.toHaveBeenCalled()
  })
  it('非只读 → picker 正常渲染（搜索框在）', async () => {
    const el = mount(ToolDock, { collapsed: false, readonly: false, skillSource: 'fde', positionId: 1, referencedView: [] })
    await nextTick(); await nextTick()
    expect(el.querySelector('.dock-search')).toBeTruthy()
  })
})

describe('SkillFileTree(readonly) · 写入口不渲染', () => {
  const files = [{ path: 'SKILL.md', name: 'SKILL.md', isEntry: true, fileType: 'md' }]
  it('readonly → 无节点 ⋯ 菜单、无底部导出 zip 入口', async () => {
    const el = mount(SkillFileTree, { skillId: 1, files, source: 'platform-candidate', readonly: true })
    await nextTick()
    expect(el.querySelector('.ft-more')).toBe(null)
    expect(el.querySelector('.ft-foot')).toBe(null)
  })
  it('非只读 → ⋯ 菜单 + 底部导出入口都在', async () => {
    const el = mount(SkillFileTree, { skillId: 1, files, source: 'fde', readonly: false })
    await nextTick()
    expect(el.querySelector('.ft-more')).toBeTruthy()
    expect(el.querySelector('.ft-foot')).toBeTruthy()
  })
})
