// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * KnowledgeSourceList.vue（数据源管理子页）列表契约。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§四 对齐重写：
 * - 概要列口径（上传=文档数 / API·MCP=连通性，失败警示）；
 * - 状态筛选（启用 / 停用，新原型后置精修层）；
 * - 操作矩阵：查看·编辑固定；上传类+文档管理；被引用时删除置灰并提示
 *   「正被知识库引用，请先解除引用」（逐字照 md）；
 * - 删除二次确认「删除后配置无法恢复，确认删除？」与 toast「数据源已删除」。
 */
const api = { listKnowledgeSources: vi.fn(), deleteKnowledgeSource: vi.fn() }
vi.mock('@/api/knowledgeBase', () => api)
const msg = { success: vi.fn(), error: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))
vi.mock('@/components/admin/KnowledgeSourceEditor.vue', () => ({
  default: {
    name: 'KnowledgeSourceEditor',
    props: ['visible', 'sourceId', 'mode'],
    template: '<div class="stub-editor" :data-visible="visible" :data-id="sourceId" :data-mode="mode" />'
  }
}))
vi.mock('@/components/admin/KnowledgeSourceDocsDrawer.vue', () => ({
  default: { name: 'KnowledgeSourceDocsDrawer', props: ['visible', 'source'], template: '<div class="stub-docs" :data-visible="visible" :data-id="source?.id" />' }
}))

const stubs = {
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-select': { props: ['modelValue'], emits: ['update:modelValue', 'change'], template: '<select @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><slot /></select>' },
  'el-option': { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': { props: ['content', 'disabled'], template: '<span class="el-tooltip" :data-tip="content" :data-tip-off="disabled ? 1 : 0"><slot /></span>' },
  'el-button': {
    props: ['disabled', 'type', 'link'],
    emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}

const KnowledgeSourceList = (await import('@/views/admin/KnowledgeSourceList.vue')).default

let app, container
async function flush(n = 6) {
  for (let i = 0; i < n; i++) { await nextTick(); await Promise.resolve() }
}
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(KnowledgeSourceList) })
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
  await flush()
  return container
}
const rowByName = (name) => [...container.querySelectorAll('.t-row')].find((el) => el.textContent.includes(name))
const cell = (rowEl, label) => rowEl.querySelector(`.t-cell[data-label="${label}"]`)?.textContent.trim()
const opBtns = (rowEl) => [...rowEl.querySelectorAll('.t-cell[data-label="操作"] .el-button')]
const opLabels = (rowEl) => opBtns(rowEl).map((b) => b.textContent.trim())

const LIST = [
  { id: 'ks_1', name: '产品资料', sourceType: 'UPLOAD', status: 'ENABLED', docCount: 1284, referencedBy: [{ id: 'kb_1', name: '产品库' }, { id: 'kb_2', name: '售前库' }] },
  { id: 'ks_2', name: '国标接口', sourceType: 'API', status: 'ENABLED', verifyStatus: 'SUCCESS', referencedBy: [] },
  { id: 'ks_3', name: '法规 MCP', sourceType: 'MCP', status: 'DISABLED', verifyStatus: 'FAILED', referencedBy: [] }
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listKnowledgeSources.mockResolvedValue({ list: LIST, total: LIST.length })
  api.deleteKnowledgeSource.mockResolvedValue(null)
  msgBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('KnowledgeSourceList 列表契约（2026-09-04 PRD-20260903 对齐）', () => {
  it('概要列：上传=文档数（千分位），API=已连通，MCP 失败=连接失败', async () => {
    await mount()
    expect(cell(rowByName('产品资料'), '概要')).toBe('1,284 篇文档')
    expect(cell(rowByName('国标接口'), '概要')).toBe('已连通')
    expect(cell(rowByName('法规 MCP'), '概要')).toBe('连接失败')
  })

  it('状态标签：ENABLED=启用(success)，DISABLED=停用(info)', async () => {
    await mount()
    // StatusTag 为直接 import 的真组件（存根不生效），按其渲染类名断言
    const tag = (n) => rowByName(n).querySelector('[class*="st--"]')
    expect(tag('产品资料').className).toContain('st--success')
    expect(tag('法规 MCP').className).toContain('st--info')
    expect(tag('法规 MCP').textContent.trim()).toBe('停用')
  })

  it('被引用列列出引用库名；被引用时删除置灰并提示「正被知识库引用，请先解除引用」（md §四.2 逐字）', async () => {
    await mount()
    expect(cell(rowByName('产品资料'), '被引用')).toBe('产品库、售前库')
    const delBtn = opBtns(rowByName('产品资料')).find((b) => b.textContent.includes('删除'))
    expect(delBtn.disabled).toBe(true)
    const tip = rowByName('产品资料').querySelector('.el-tooltip')
    expect(tip.dataset.tip).toBe('正被知识库引用，请先解除引用')
    expect(tip.dataset.tipOff).toBe('0')
    const freeDel = opBtns(rowByName('国标接口')).find((b) => b.textContent.includes('删除'))
    expect(freeDel.disabled).toBe(false)
  })

  it('操作矩阵（md §四.2）：查看·编辑固定；上传类+文档管理；点文档管理开文档抽屉带行', async () => {
    await mount()
    expect(opLabels(rowByName('产品资料'))).toEqual(['查看', '编辑', '文档管理', '删除'])
    expect(opLabels(rowByName('国标接口'))).toEqual(['查看', '编辑', '删除'])
    opBtns(rowByName('产品资料')).find((b) => b.textContent.includes('文档管理')).click()
    await flush()
    const drawer = container.querySelector('.stub-docs')
    expect(drawer.dataset.visible).toBe('true')
    expect(drawer.dataset.id).toBe('ks_1')
  })

  it('查看以 view 模式、编辑以 edit 模式打开配置抽屉', async () => {
    await mount()
    opBtns(rowByName('国标接口')).find((b) => b.textContent.trim() === '查看').click()
    await flush()
    let editor = container.querySelector('.stub-editor')
    expect(editor.dataset.visible).toBe('true')
    expect(editor.dataset.id).toBe('ks_2')
    expect(editor.dataset.mode).toBe('view')
    opBtns(rowByName('国标接口')).find((b) => b.textContent.trim() === '编辑').click()
    await flush()
    editor = container.querySelector('.stub-editor')
    expect(editor.dataset.mode).toBe('edit')
  })

  it('删除二次确认「删除后配置无法恢复，确认删除？」，成功 toast「数据源已删除」', async () => {
    await mount()
    opBtns(rowByName('国标接口')).find((b) => b.textContent.includes('删除')).click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后配置无法恢复，确认删除？',
      '删除数据源',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(api.deleteKnowledgeSource).toHaveBeenCalledWith('ks_2')
    expect(msg.success).toHaveBeenCalledWith('数据源已删除')
  })

  it('状态筛选（启用 / 停用，后置精修层）随查询下发', async () => {
    await mount()
    const selects = [...container.querySelectorAll('select')]
    const statusSelect = selects[1] // 顺序：类型、状态
    statusSelect.value = 'DISABLED'
    statusSelect.dispatchEvent(new Event('change'))
    await flush()
    const last = api.listKnowledgeSources.mock.calls.at(-1)[0]
    expect(last).toEqual(expect.objectContaining({ status: 'DISABLED', page: 1 }))
  })
})
