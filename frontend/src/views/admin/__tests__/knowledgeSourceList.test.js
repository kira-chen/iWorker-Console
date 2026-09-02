// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * KnowledgeSourceList.vue（数据源管理子页）列表契约（2026-08-31 建）。
 * 覆盖：概要列口径（上传=文档数 / API·MCP=连通性）、启停状态标签、被引用列、
 * 删除保护（被引用禁删 + tooltip 兜底）、行内两键。
 */
const api = { listKnowledgeSources: vi.fn(), deleteKnowledgeSource: vi.fn() }
vi.mock('@/api/knowledgeBase', () => api)
const msg = { success: vi.fn(), error: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))
vi.mock('@/components/admin/KnowledgeSourceEditor.vue', () => ({
  default: { name: 'KnowledgeSourceEditor', props: ['visible', 'sourceId'], template: '<div class="stub-editor" :data-visible="visible" :data-id="sourceId" />' }
}))
vi.mock('@/components/admin/KnowledgeSourceDocsDrawer.vue', () => ({
  default: { name: 'KnowledgeSourceDocsDrawer', props: ['visible', 'source'], template: '<div class="stub-docs" :data-visible="visible" :data-id="source?.id" />' }
}))

const stubs = {
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-select': { props: ['modelValue'], emits: ['update:modelValue', 'change'], template: '<select @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><slot /></select>' },
  'el-option': { props: ['value'], template: '<option :value="value" />' },
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
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve() }
  return container
}
const rowByName = (name) => [...container.querySelectorAll('.t-row')].find((el) => el.textContent.includes(name))
const cell = (rowEl, label) => rowEl.querySelector(`.t-cell[data-label="${label}"]`)?.textContent.trim()

const LIST = [
  { id: 'ks_1', name: '产品资料', sourceType: 'UPLOAD', status: 'ENABLED', docCount: 1284, referencedBy: [{ id: 'kb_1', name: '产品库' }, { id: 'kb_2', name: '售前库' }] },
  { id: 'ks_2', name: '国标接口', sourceType: 'API', status: 'ENABLED', verifyStatus: 'SUCCESS', referencedBy: [] },
  { id: 'ks_3', name: '法规 MCP', sourceType: 'MCP', status: 'DISABLED', verifyStatus: 'FAILED', referencedBy: [] }
]

beforeEach(() => {
  api.listKnowledgeSources.mockReset()
  api.listKnowledgeSources.mockResolvedValue({ list: LIST, total: LIST.length })
  api.deleteKnowledgeSource.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('KnowledgeSourceList 列表契约', () => {
  it('概要列：上传=文档数（千分位），API=连通结论，MCP 失败=连接失败', async () => {
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

  it('被引用列列出引用库名；删除键被引用时禁用且 tooltip 说明', async () => {
    await mount()
    expect(cell(rowByName('产品资料'), '被引用')).toBe('产品库、售前库')
    const refBtns = [...rowByName('产品资料').querySelectorAll('.el-button')]
    const delBtn = refBtns.find((b) => b.textContent.includes('删除'))
    expect(delBtn.disabled).toBe(true)
    const freeDel = [...rowByName('国标接口').querySelectorAll('.el-button')].find((b) => b.textContent.includes('删除'))
    expect(freeDel.disabled).toBe(false)
  })

  it('操作列：上传类=配置·文档管理·删除，API/MCP 无「文档管理」入口；点文档管理开文档抽屉带行', async () => {
    await mount()
    const label = (n) => [...rowByName(n).querySelectorAll('.el-button')].map((b) => b.textContent.trim())
    expect(label('产品资料')).toEqual(['配置', '文档管理', '删除'])
    expect(label('国标接口')).toEqual(['配置', '删除'])
    const docBtn = [...rowByName('产品资料').querySelectorAll('.el-button')].find((b) => b.textContent.includes('文档管理'))
    docBtn.click()
    await nextTick()
    const drawer = container.querySelector('.stub-docs')
    expect(drawer.dataset.visible).toBe('true')
    expect(drawer.dataset.id).toBe('ks_1')
  })

  it('点配置开抽屉带 id', async () => {
    await mount()
    const btn = [...rowByName('国标接口').querySelectorAll('.el-button')].find((b) => b.textContent.includes('配置'))
    btn.click()
    await nextTick()
    const editor = container.querySelector('.stub-editor')
    expect(editor.dataset.visible).toBe('true')
    expect(editor.dataset.id).toBe('ks_2')
  })
})
