// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * KnowledgeBaseList.vue（知识库管理子页）列表契约（2026-08-28 建；2026-08-31 随双子页改造迁移，
 * 数据源改为独立对象引用：sources 为解析后的引用，带 status 启停位而非 enabled）。
 * 覆盖：列渲染口径（数据源连排 / 文档数只对上传源 / 可见范围派生 / 三态 pendingAction 优先）、
 * 行内仅「配置 · 检索测试」两键、筛选与搜索回第 1 页。存根写法同 adminModels.test.js。
 */
const api = { listKnowledgeBases: vi.fn() }
vi.mock('@/api/knowledgeBase', () => api)
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))
vi.mock('@/components/admin/KnowledgeBaseEditor.vue', () => ({
  default: { name: 'KnowledgeBaseEditor', props: ['visible', 'kbId'], template: '<div class="stub-editor" :data-visible="visible" :data-id="kbId" />' }
}))
vi.mock('@/components/admin/KnowledgeSearchDialog.vue', () => ({
  default: { name: 'KnowledgeSearchDialog', props: ['visible', 'kb'], template: '<div class="stub-search" :data-visible="visible" :data-id="kb?.id" />' }
}))

const stubs = {
  PageHeader: { template: '<div class="page-header" />' },
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-select': { props: ['modelValue'], emits: ['update:modelValue', 'change'], template: '<select @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><slot /></select>' },
  'el-option': { props: ['value'], template: '<option :value="value" />' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-button': { props: ['disabled', 'type', 'link'], emits: ['click'], template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' }
}

const KnowledgeBaseList = (await import('@/views/admin/KnowledgeBaseList.vue')).default

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(KnowledgeBaseList) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  const RowScope = { props: ['row'], provide() { return { tableRow: () => this.row } }, template: '<div class="t-row"><slot /></div>' }
  app.component('RowScope', RowScope)
  app.component('el-table', { components: { RowScope }, props: ['data'], template: '<div class="el-table"><RowScope v-for="(row, i) in (data || [])" :key="i" :row="row"><slot :row="row" /></RowScope></div>' })
  app.component('el-table-column', {
    props: ['label'],
    inject: { tableRow: { default: null } },
    computed: { row() { return this.tableRow ? this.tableRow() : null } },
    template: '<div class="t-cell" :data-label="label"><slot v-if="row" :row="row" /></div>'
  })
  app.directive('loading', { mounted() {}, updated() {} })
  app.mount(container)
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve() }
  return container
}
const rowByName = (name) => [...container.querySelectorAll('.t-row')].find((el) => el.textContent.includes(name))
const cell = (rowEl, label) => rowEl.querySelector(`.t-cell[data-label="${label}"]`)?.textContent.trim()
const btns = (rowEl) => [...rowEl.querySelectorAll('.el-button')].map((b) => b.textContent.trim())

const LIST = [
  { id: 'kb_1', name: '产品库', kbType: 'ENTERPRISE', status: 'PUBLISHED', pendingAction: null, docCount: 1284, sources: [{ sourceType: 'MCP', status: 'ENABLED' }, { sourceType: 'UPLOAD', status: 'ENABLED' }] },
  { id: 'kb_2', name: '法规库', kbType: 'ENTERPRISE', status: 'DRAFT', pendingAction: 'PUBLISH', docCount: 0, sources: [{ sourceType: 'API', status: 'ENABLED' }] },
  { id: 'kb_3', name: '话术库', kbType: 'POSITION', scopeRefName: '销售顾问', status: 'PUBLISHED', pendingAction: 'DELIST', docCount: 3, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }, { sourceType: 'API', status: 'DISABLED' }] },
  { id: 'kb_4', name: '空库', kbType: 'EXPERT', scopeRefName: '', status: 'DRAFT', pendingAction: null, docCount: 0, sources: [] }
]

beforeEach(() => {
  api.listKnowledgeBases.mockReset()
  api.listKnowledgeBases.mockResolvedValue({ list: LIST, total: LIST.length })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('KnowledgeBaseList 列表契约', () => {
  it('数据源按「上传 · API · MCP」固定顺序连排，仅列启用中的引用；无引用显示 —', async () => {
    await mount()
    expect(cell(rowByName('产品库'), '数据源')).toBe('上传 · MCP')
    expect(cell(rowByName('话术库'), '数据源')).toBe('上传')
    expect(cell(rowByName('空库'), '数据源')).toBe('—')
  })

  it('文档数只对启用了上传源的库展示，其余 —', async () => {
    await mount()
    expect(cell(rowByName('产品库'), '文档')).toBe('1,284')
    expect(cell(rowByName('法规库'), '文档')).toBe('—')
  })

  it('可见范围随类型派生：企业=全员；岗位/专家=前缀 + 名称（未指定兜底）', async () => {
    await mount()
    expect(cell(rowByName('产品库'), '可见范围')).toBe('全员')
    expect(cell(rowByName('话术库'), '可见范围')).toBe('岗位：销售顾问')
    expect(cell(rowByName('空库'), '可见范围')).toBe('专家：未指定')
  })

  it('三态：pendingAction 优先判「审核中」（含待审停用的已发布行）', async () => {
    await mount()
    const tag = (n) => rowByName(n).querySelector('.status-tag, .st')
    expect(tag('产品库').textContent).toBe('已发布')
    expect(tag('法规库').textContent).toBe('审核中')
    expect(tag('话术库').textContent).toBe('审核中')
    expect(tag('话术库').className).toContain('st--warning')
    expect(tag('空库').textContent).toBe('未发布')
  })

  it('行内只有「配置」「检索测试」两键；点配置开抽屉带 id，点检索测试开弹窗带行', async () => {
    await mount()
    const row = rowByName('产品库')
    expect(btns(row)).toEqual(['配置', '检索测试'])
    row.querySelectorAll('.el-button')[0].click()
    await nextTick()
    const editor = container.querySelector('.stub-editor')
    expect(editor.dataset.visible).toBe('true')
    expect(editor.dataset.id).toBe('kb_1')
    row.querySelectorAll('.el-button')[1].click()
    await nextTick()
    expect(container.querySelector('.stub-search').dataset.id).toBe('kb_1')
  })

  it('首屏取数下发分页参数；搜索与筛选走后端 query 且回第 1 页', async () => {
    await mount()
    expect(api.listKnowledgeBases).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 20 }))
    const input = container.querySelector('input')
    input.value = '产品'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    container.querySelectorAll('.el-button')[0].click() // 查询
    await nextTick()
    const last = api.listKnowledgeBases.mock.calls.at(-1)[0]
    expect(last).toEqual(expect.objectContaining({ keyword: '产品', page: 1 }))
  })
})
