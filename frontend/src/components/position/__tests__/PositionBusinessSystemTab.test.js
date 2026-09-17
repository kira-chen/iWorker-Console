// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive, inject, unref, computed } from 'vue'

/**
 * PositionBusinessSystemTab（岗位详情「连接器」页签，2026-09-15 重构为三区域）—— 单测。
 * 对齐新组件逻辑：
 *  - 三区域：岗位私有 MCP / 岗位私有 API / 岗位私有业务系统；
 *  - 各区域只展示 store.basic.connectorMcpIds / connectorApiIds / businessSystemIds 命中的条目；
 *  - 无绑定时不调 API、显空态文案；
 *  - 【＋ 新增】→ 绑定弹窗（搜索 + 确认绑定）；【查看】→ 只读编辑器；【移除】→ ElMessageBox 确认后移除；
 *  - 只读态隐藏【＋ 新增】和【移除】。
 */

const store = reactive({
  positionId: 5,
  basic: {
    connectorMcpIds: ['mcp_1'],
    connectorApiIds: ['api_1'],
    businessSystemIds: ['biz_1']
  }
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))

vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))

const listMcp = vi.fn()
const listBizSystems = vi.fn()
vi.mock('@/api/admin', () => ({
  listMcp: (...a) => listMcp(...a),
  listBizSystems: (...a) => listBizSystems(...a)
}))

const listApis = vi.fn()
vi.mock('@/api/apiConnector', () => ({ listApis: (...a) => listApis(...a) }))

vi.mock('@/components/admin/McpEditor.vue', () => ({
  default: {
    name: 'McpEditor',
    props: ['visible', 'mcpId', 'readonly'],
    emits: ['update:visible'],
    setup: (props) => () => h('div', {
      class: 'stub-mcp-editor',
      'data-visible': String(!!props.visible),
      'data-id': props.mcpId ?? '',
      'data-readonly': String(!!props.readonly)
    })
  }
}))
vi.mock('@/components/admin/ApiEditor.vue', () => ({
  default: {
    name: 'ApiEditor',
    props: ['visible', 'apiId', 'readonly'],
    emits: ['update:visible'],
    setup: (props) => () => h('div', {
      class: 'stub-api-editor',
      'data-visible': String(!!props.visible),
      'data-id': props.apiId ?? '',
      'data-readonly': String(!!props.readonly)
    })
  }
}))
vi.mock('@/components/admin/BizSystemEditor.vue', () => ({
  default: {
    name: 'BizSystemEditor',
    props: ['visible', 'bizId', 'readonly'],
    emits: ['update:visible'],
    setup: (props) => () => h('div', {
      class: 'stub-biz-editor',
      'data-visible': String(!!props.visible),
      'data-id': props.bizId ?? '',
      'data-readonly': String(!!props.readonly)
    })
  }
}))

const PositionBusinessSystemTab = (await import('@/components/position/PositionBusinessSystemTab.vue')).default

const ALL_MCPS = [
  { id: 'mcp_1', name: 'CRM MCP', description: '客户数据接口', icon: '⚙', tools: [{}, {}], updatedAt: '2026-08-24T15:40:00+08:00' },
  { id: 'mcp_2', name: 'ERP MCP', description: 'ERP 数据接口', icon: '▤', tools: [{}], updatedAt: '2026-08-20T09:00:00+08:00' }
]
const ALL_APIS = [
  { id: 'api_1', name: '报销查询', description: '按报销单号查询审批状态', method: 'GET', icon: '', updatedAt: '2026-08-24T15:40:00+08:00' },
  { id: 'api_2', name: '合同审批', description: '提交合同审批申请', method: 'POST', icon: '', updatedAt: '2026-08-20T09:00:00+08:00' }
]
const ALL_BIZS = [
  { id: 'biz_1', name: 'CRM 系统', description: '客户管理', icon: '◎', loginUrl: 'https://crm.example.com', updatedAt: '2026-08-24T15:40:00+08:00' },
  { id: 'biz_2', name: 'ERP 系统', description: '进销存管理', icon: '▤', loginUrl: 'https://erp.example.com', updatedAt: '2026-08-20T09:00:00+08:00' }
]

const elButton = { name: 'el-button', props: ['type', 'link', 'size'], emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
const elInput = { name: 'el-input', props: ['modelValue', 'placeholder', 'clearable'], emits: ['update:modelValue'], template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' }
const elDialog = { name: 'el-dialog', props: ['modelValue', 'title', 'width', 'closeOnClickModal'], template: '<div v-if="modelValue" class="el-dialog" :data-title="title"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>' }
const elCheckboxGroup = {
  name: 'el-checkbox-group', props: ['modelValue'], emits: ['update:modelValue'],
  provide() { return { cbxGroup: { get: () => this.modelValue, set: (v) => this.$emit('update:modelValue', v) } } },
  template: '<div class="el-checkbox-group"><slot /></div>'
}
const elCheckbox = {
  name: 'el-checkbox', props: ['label'], inject: ['cbxGroup'],
  methods: { toggle() { const cur = this.cbxGroup.get() || []; this.cbxGroup.set(cur.includes(this.label) ? cur.filter((x) => x !== this.label) : [...cur, this.label]) } },
  template: '<label class="el-checkbox" :data-checked="String((cbxGroup.get() || []).includes(label))" @click="toggle"><slot /></label>'
}
const elTable = {
  name: 'el-table', props: ['data', 'emptyText'],
  provide() { return { tableRows: computed(() => this.data) } },
  template: '<div class="el-table" :data-count="(data || []).length"><slot /></div>'
}
const elTableColumn = {
  name: 'el-table-column', props: ['label', 'prop', 'minWidth', 'width', 'fixed', 'align', 'showOverflowTooltip', 'className', 'labelClassName', 'rowKey'],
  setup(props, { slots }) {
    const tableRows = inject('tableRows', null)
    return () => {
      const rows = unref(tableRows) || []
      return h('div', { class: 'el-table-column', 'data-label': props.label }, [
        h('div', { class: 'th' }, slots.header?.()),
        ...rows.map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default?.({ row })))
      ])
    }
  }
}
const elTag = { name: 'el-tag', props: ['size', 'type', 'effect'], template: '<span class="el-tag"><slot /></span>' }

let app, container
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionBusinessSystemTab, props) })
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.component('el-dialog', elDialog)
  app.component('el-checkbox-group', elCheckboxGroup)
  app.component('el-checkbox', elCheckbox)
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  app.component('el-tag', elTag)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }

const section = (title) => [...container.querySelectorAll('.conn-section')].find(s => s.querySelector('.section-title')?.textContent === title)
const sectionBtn = (sec, text) => [...sec.querySelectorAll('.el-button')].find(b => b.textContent.trim().includes(text))
const sectionNames = (sec) => [...sec.querySelectorAll('.el-table-column[data-label="名称"] .cell .mc-name')].map(n => n.textContent.trim())
const dlg = (title) => [...container.querySelectorAll('.el-dialog')].find(d => d.getAttribute('data-title') === title)
const dlgItems = (d) => [...d.querySelectorAll('.bind-item .bind-name')].map(n => n.textContent.trim())
const dlgBtn = (d, text) => [...d.querySelectorAll('.dlg-footer .el-button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  vi.clearAllMocks()
  listMcp.mockResolvedValue({ list: ALL_MCPS, total: ALL_MCPS.length })
  listApis.mockResolvedValue({ list: ALL_APIS, total: ALL_APIS.length })
  listBizSystems.mockResolvedValue({ list: ALL_BIZS, total: ALL_BIZS.length })
  store.basic = {
    connectorMcpIds: ['mcp_1'],
    connectorApiIds: ['api_1'],
    businessSystemIds: ['biz_1']
  }
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('连接器页签 · 三区域展示', () => {
  it('三区域标题渲染：岗位私有 MCP / 岗位私有 API / 岗位私有业务系统', async () => {
    await mount()
    expect(section('岗位私有 MCP')).toBeTruthy()
    expect(section('岗位私有 API')).toBeTruthy()
    expect(section('岗位私有业务系统')).toBeTruthy()
  })

  it('各区域只展示已绑定条目（各 1 条），未绑定条目不出现', async () => {
    await mount()
    expect(listMcp).toHaveBeenCalledWith({})
    expect(listApis).toHaveBeenCalledWith({})
    expect(listBizSystems).toHaveBeenCalledWith({})
    expect(sectionNames(section('岗位私有 MCP'))).toEqual(['CRM MCP'])
    expect(sectionNames(section('岗位私有 API'))).toEqual(['报销查询'])
    expect(sectionNames(section('岗位私有业务系统'))).toEqual(['CRM 系统'])
  })

  it('无绑定时各区域不调 API，显空态文案', async () => {
    store.basic = { connectorMcpIds: [], connectorApiIds: [], businessSystemIds: [] }
    await mount()
    expect(listMcp).not.toHaveBeenCalled()
    expect(listApis).not.toHaveBeenCalled()
    expect(listBizSystems).not.toHaveBeenCalled()
    expect(section('岗位私有 MCP').textContent).toContain('暂无绑定的私有 MCP')
    expect(section('岗位私有 API').textContent).toContain('暂无绑定的私有 API')
    expect(section('岗位私有业务系统').textContent).toContain('暂无绑定的业务系统')
  })
})

describe('连接器页签 · MCP 区域操作', () => {
  it('【查看】→ McpEditor 以 readonly=true、mcpId=该行 id 打开', async () => {
    await mount()
    expect(container.querySelector('.stub-mcp-editor').getAttribute('data-visible')).toBe('false')
    sectionBtn(section('岗位私有 MCP'), '查看').click()
    await flush()
    const editor = container.querySelector('.stub-mcp-editor')
    expect(editor.getAttribute('data-visible')).toBe('true')
    expect(editor.getAttribute('data-id')).toBe('mcp_1')
    expect(editor.getAttribute('data-readonly')).toBe('true')
  })

  it('【移除】→ ElMessageBox 确认后 store 移除该 id + toast「已移除」', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    sectionBtn(section('岗位私有 MCP'), '移除').click()
    await flush()
    expect(store.basic.connectorMcpIds).toEqual([])
    expect(ElMessage.success).toHaveBeenCalledWith('已移除')
  })

  it('【＋ 新增】→ 弹窗「绑定私有 MCP」，只列未绑定 MCP（mcp_2），搜索「ERP」保留、「不存在」清空并显空态', async () => {
    await mount()
    sectionBtn(section('岗位私有 MCP'), '新增').click()
    await flush()
    const d = dlg('绑定私有 MCP')
    expect(d).toBeTruthy()
    expect(dlgItems(d)).toEqual(['ERP MCP'])
    const searchInput = d.querySelector('.el-input')
    searchInput.value = 'ERP'
    searchInput.dispatchEvent(new Event('input'))
    await flush()
    expect(dlgItems(d)).toEqual(['ERP MCP'])
    searchInput.value = '不存在'
    searchInput.dispatchEvent(new Event('input'))
    await flush()
    expect(dlgItems(d)).toEqual([])
    expect(d.querySelector('.bind-empty').textContent).toContain('未找到匹配的 MCP')
  })

  it('弹窗勾选 ERP MCP 后【确认绑定】→ store 追加 mcp_2 + toast「绑定成功」+ 弹窗关', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    sectionBtn(section('岗位私有 MCP'), '新增').click()
    await flush()
    const d = dlg('绑定私有 MCP')
    // 重置搜索确保列表显示，点击第一个 checkbox（ERP MCP）
    d.querySelector('.el-checkbox').click()
    await flush()
    expect(d.querySelector('.el-checkbox').getAttribute('data-checked')).toBe('true')
    dlgBtn(d, '确认绑定').click()
    await flush()
    expect(store.basic.connectorMcpIds).toEqual(['mcp_1', 'mcp_2'])
    expect(ElMessage.success).toHaveBeenCalledWith('绑定成功')
    expect(dlg('绑定私有 MCP')).toBeUndefined()
  })

  it('未勾选直接【确认绑定】→ warning「请选择要绑定的 MCP」，不改 store，弹窗不关', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    sectionBtn(section('岗位私有 MCP'), '新增').click()
    await flush()
    const d = dlg('绑定私有 MCP')
    dlgBtn(d, '确认绑定').click()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要绑定的 MCP')
    expect(store.basic.connectorMcpIds).toEqual(['mcp_1'])
    expect(dlg('绑定私有 MCP')).toBeTruthy()
  })
})

describe('连接器页签 · 只读态', () => {
  it('只读态：三区域均无【＋ 新增】和【移除】按钮，【查看】仍保留', async () => {
    await mount({ isReadonly: true })
    for (const title of ['岗位私有 MCP', '岗位私有 API', '岗位私有业务系统']) {
      const sec = section(title)
      expect(sectionBtn(sec, '新增')).toBeUndefined()
      expect(sectionBtn(sec, '移除')).toBeUndefined()
      expect(sectionBtn(sec, '查看')).toBeTruthy()
    }
  })
})
