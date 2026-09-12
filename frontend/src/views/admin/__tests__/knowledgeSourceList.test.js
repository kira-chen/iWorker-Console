// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * KnowledgeSourceList.vue（数据源管理子页，AdminKnowledgeBase 容器 ?tab=source）列表契约。
 *
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 * - §四.2 列表字段：概要（上传=文档数 / API·MCP=未验证·已连通·连接失败，md §八.1 L417）/ 状态（启用·停用）/ 被引用；
 * - §四.2 操作矩阵：查看·编辑固定；上传类+文档管理；被引用时删除置灰并提示「正被知识库引用，请先解除引用」（逐字）；
 *   删除二次确认「删除后配置无法恢复，确认删除？」与 toast「数据源已删除」；
 * - §四.1 状态筛选（启用 / 停用）随查询下发；
 * - §二.2 L42-43 刷新保留：查询条件与分页位置落 URL query（srcKw / srcType / srcSt / srcP；547d3e5），与知识库子页键互清。
 *
 * vue-router 以 mock 注入（routeMock.query 可按用例改写）；StatusTag / ListToolbar / ListStates / ListPagination
 * 为组件局部 import 的真组件（全局同名桩无效）。
 */
const api = { listKnowledgeSources: vi.fn(), deleteKnowledgeSource: vi.fn() }
vi.mock('@/api/knowledgeBase', () => api)
const msg = { success: vi.fn(), error: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))
// vue-router：query 可按用例改写（2026-09-12 审计 E1 补：此前不 mock，组件走 route?. 空值旁路，状态保持零覆盖）
const routeMock = { query: {} }
const routerMock = { replace: vi.fn() }
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))
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
  { id: 'ks_3', name: '法规 MCP', sourceType: 'MCP', status: 'DISABLED', verifyStatus: 'FAILED', referencedBy: [] },
  // 2026-09-08 决议第 9 项：mock 派生 summary 优先；MCP 已连通附所选工具名；新建未测试=未验证
  { id: 'ks_4', name: '知识 MCP', sourceType: 'MCP', status: 'ENABLED', verifyStatus: 'SUCCESS', summary: '已连通 · search_documents、hybrid_search', config: { tools: ['search_documents', 'hybrid_search'] }, referencedBy: [] },
  { id: 'ks_5', name: '新建接口', sourceType: 'API', status: 'ENABLED', verifyStatus: 'UNVERIFIED', referencedBy: [] }
]

beforeEach(() => {
  vi.clearAllMocks()
  routeMock.query = { tab: 'source' }
  api.listKnowledgeSources.mockResolvedValue({ list: LIST, total: LIST.length })
  api.deleteKnowledgeSource.mockResolvedValue(null)
  msgBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('KnowledgeSourceList 列表契约（md §四.1-§四.2 / §八.1）', () => {
  it('概要列：上传=文档数（千分位），API=已连通，MCP 失败=连接失败', async () => {
    await mount()
    expect(cell(rowByName('产品资料'), '概要')).toBe('1,284 篇文档')
    expect(cell(rowByName('国标接口'), '概要')).toBe('已连通')
    expect(cell(rowByName('法规 MCP'), '概要')).toBe('连接失败')
  })

  it('概要列（2026-09-08 决议第 9 项 md §八.1）：MCP 已连通附工具名；新建未测试=未验证；失败行警示样式', async () => {
    await mount()
    expect(cell(rowByName('知识 MCP'), '概要')).toBe('已连通 · search_documents、hybrid_search')
    expect(cell(rowByName('新建接口'), '概要')).toBe('未验证')
    expect(rowByName('知识 MCP').querySelector('.t-cell[data-label="概要"] span').className).toContain('src-ok')
    expect(rowByName('法规 MCP').querySelector('.t-cell[data-label="概要"] span').className).toContain('src-bad')
    expect(rowByName('新建接口').querySelector('.t-cell[data-label="概要"] span').className).toContain('cell-na')
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

  /**
   * 2026-09-12 测试审计补缺口 E1：查询条件与分页位置的刷新保持（md §二.2 L42-43；实现 547d3e5：
   * 键名加 src 前缀 srcKw / srcType / srcSt / srcP，与知识库子页 kw / kbType / st / p 互清）。
   */
  describe('E1 URL query 状态保持（md §二.2 L42-43）', () => {
    it('带 srcKw / srcType / srcSt / srcP 的地址刷新进入 → 首拉即按 {keyword, sourceType, status, page:2} 取数并回显', async () => {
      api.listKnowledgeSources.mockResolvedValue({ list: LIST, total: 20 }) // 20 条 → 有第 2 页
      routeMock.query = { tab: 'source', srcKw: '接口', srcType: 'API', srcSt: 'ENABLED', srcP: '2' }
      await mount()
      expect(api.listKnowledgeSources.mock.calls[0][0]).toEqual(
        expect.objectContaining({ keyword: '接口', sourceType: 'API', status: 'ENABLED', page: 2 })
      )
      expect(container.querySelector('input').value).toBe('接口')
      expect(container.querySelector('.list-pager .page-btn.active')?.textContent.trim()).toBe('2')
    })

    it('输入关键词 → 地址栏回写 srcKw，且清掉知识库子页的 kw / kbType / st / p；tab 保留', async () => {
      routeMock.query = { tab: 'source', kw: '产品', kbType: 'EXPERT', st: 'PUBLISHED', p: '3' }
      await mount()
      routerMock.replace.mockClear()
      const input = container.querySelector('input')
      input.value = '接口'
      input.dispatchEvent(new Event('input'))
      await flush()
      const q = routerMock.replace.mock.calls.at(-1)[0].query
      expect(q).toEqual({ tab: 'source', srcKw: '接口' })
      for (const k of ['kw', 'kbType', 'st', 'p']) expect(q).not.toHaveProperty(k)
    })

    it('切状态筛选 → 回写 srcSt；翻到第 2 页 → 回写 srcP=2 并取数 page=2；回第 1 页 → srcP 清除', async () => {
      api.listKnowledgeSources.mockResolvedValue({ list: LIST, total: 20 })
      await mount()
      routerMock.replace.mockClear()
      const statusSelect = [...container.querySelectorAll('select')][1]
      statusSelect.value = 'DISABLED'
      statusSelect.dispatchEvent(new Event('change'))
      await flush()
      expect(routerMock.replace.mock.calls.at(-1)[0].query).toEqual({ tab: 'source', srcSt: 'DISABLED' })
      container.querySelector('.list-pager [aria-label="下一页"]').click()
      await flush()
      expect(api.listKnowledgeSources.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({ status: 'DISABLED', page: 2 }))
      expect(routerMock.replace.mock.calls.at(-1)[0].query).toEqual({ tab: 'source', srcSt: 'DISABLED', srcP: '2' })
      container.querySelector('.list-pager [aria-label="上一页"]').click()
      await flush()
      expect(routerMock.replace.mock.calls.at(-1)[0].query).toEqual({ tab: 'source', srcSt: 'DISABLED' })
    })
  })
})
