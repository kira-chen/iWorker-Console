// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * KnowledgeBaseList.vue（知识库管理子页）列表契约。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§三 对齐重写：
 * - 列口径：数据源「上传 ×N / API ×N / MCP ×N」/ 文档数仅上传引用 / 可见范围派生 / 三态 pendingAction 优先；
 * - 操作矩阵：查看·编辑固定；审核中+撤回；未发布+发布·删除；已发布+停用·检索测试；
 * - 四类确认弹窗与 toast 文案逐字照 md §三.4.3；
 * - 跨模块 query（md §三.8）：positionId 进入即筛岗位类型并向编辑器传岗位锁。
 */
const api = {
  listKnowledgeBases: vi.fn(),
  getKnowledgeBase: vi.fn(),
  publishKnowledgeBase: vi.fn(),
  delistKnowledgeBase: vi.fn(),
  withdrawKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn()
}
vi.mock('@/api/knowledgeBase', () => api)
const msg = { success: vi.fn(), error: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

// vue-router：query 可按用例改写
const routeMock = { query: {} }
const routerMock = { replace: vi.fn() }
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))

vi.mock('@/components/admin/KnowledgeBaseEditor.vue', () => ({
  default: {
    name: 'KnowledgeBaseEditor',
    props: ['visible', 'kbId', 'mode', 'positionLock'],
    template: '<div class="stub-editor" :data-visible="visible" :data-id="kbId" :data-mode="mode" :data-lock="positionLock?.id || \'\'" />'
  }
}))
vi.mock('@/components/admin/KnowledgeSearchDialog.vue', () => ({
  default: { name: 'KnowledgeSearchDialog', props: ['visible', 'kb'], template: '<div class="stub-search" :data-visible="visible" :data-id="kb?.id" />' }
}))

const stubs = {
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  'el-select': { props: ['modelValue'], emits: ['update:modelValue', 'change'], template: '<select @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\')"><slot /></select>' },
  'el-option': { props: ['value'], template: '<option :value="value" />' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': { props: ['content', 'disabled'], template: '<span class="el-tooltip"><slot /></span>' },
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
  await flush()
  return container
}
async function flush(n = 6) {
  for (let i = 0; i < n; i++) { await nextTick(); await Promise.resolve() }
}
const rowByName = (name) => [...container.querySelectorAll('.t-row')].find((el) => el.textContent.includes(name))
const cell = (rowEl, label) => rowEl.querySelector(`.t-cell[data-label="${label}"]`)?.textContent.trim()
const opBtns = (rowEl) => [...rowEl.querySelectorAll('.t-cell[data-label="操作"] .el-button')]
const opLabels = (rowEl) => opBtns(rowEl).map((b) => b.textContent.trim())
const clickOp = async (rowEl, text) => {
  opBtns(rowEl).find((b) => b.textContent.trim() === text).click()
  await flush()
}

const LIST = [
  { id: 'kb_1', name: '产品库', kbType: 'ENTERPRISE', description: '全线产品资料', status: 'PUBLISHED', pendingAction: null, docCount: 1284, sources: [{ sourceType: 'MCP', status: 'ENABLED' }, { sourceType: 'UPLOAD', status: 'ENABLED' }] },
  { id: 'kb_2', name: '法规库', kbType: 'ENTERPRISE', description: '', status: 'DRAFT', pendingAction: 'PUBLISH', docCount: 0, sources: [{ sourceType: 'API', status: 'ENABLED' }] },
  { id: 'kb_3', name: '话术库', kbType: 'POSITION', scopeRefName: '销售顾问', description: '', status: 'PUBLISHED', pendingAction: 'DELIST', docCount: 3, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }, { sourceType: 'API', status: 'DISABLED' }] },
  { id: 'kb_4', name: '空库', kbType: 'EXPERT', scopeRefName: '', description: '', status: 'DRAFT', pendingAction: null, docCount: 0, sources: [] }
]

beforeEach(() => {
  vi.clearAllMocks()
  routeMock.query = {}
  api.listKnowledgeBases.mockResolvedValue({ list: LIST, total: LIST.length })
  api.publishKnowledgeBase.mockResolvedValue({})
  api.delistKnowledgeBase.mockResolvedValue({})
  api.withdrawKnowledgeBase.mockResolvedValue({})
  api.deleteKnowledgeBase.mockResolvedValue(null)
  msgBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('KnowledgeBaseList 列表契约（2026-09-04 PRD-20260903 对齐）', () => {
  it('数据源列按已启用类型汇总「上传 ×N / API ×N / MCP ×N」；无引用显示 —', async () => {
    await mount()
    expect(cell(rowByName('产品库'), '数据源')).toBe('上传 ×1 / MCP ×1')
    expect(cell(rowByName('话术库'), '数据源')).toBe('上传 ×1') // 停用的 API 引用不计入
    expect(cell(rowByName('空库'), '数据源')).toBe('—')
  })

  it('文档数仅对引用上传源的库展示，其余 —；可见范围随类型派生', async () => {
    await mount()
    expect(cell(rowByName('产品库'), '文档数')).toBe('1,284')
    expect(cell(rowByName('法规库'), '文档数')).toBe('—')
    expect(cell(rowByName('产品库'), '可见范围')).toBe('全员')
    expect(cell(rowByName('话术库'), '可见范围')).toBe('岗位：销售顾问')
    expect(cell(rowByName('空库'), '可见范围')).toBe('专家：未指定')
  })

  it('三态：pendingAction 优先判「审核中」（待发布与待停用统一展示审核中）', async () => {
    await mount()
    const tag = (n) => rowByName(n).querySelector('.status-tag, [class*="st--"]')
    expect(tag('产品库').textContent.trim()).toBe('已发布')
    expect(tag('法规库').textContent.trim()).toBe('审核中')
    expect(tag('话术库').textContent.trim()).toBe('审核中')
    expect(tag('空库').textContent.trim()).toBe('未发布')
  })

  it('操作矩阵（md §三.2）：查看·编辑固定；审核中+撤回；未发布+发布·删除；已发布+停用·检索测试', async () => {
    await mount()
    expect(opLabels(rowByName('产品库'))).toEqual(['查看', '编辑', '停用', '检索测试'])
    expect(opLabels(rowByName('法规库'))).toEqual(['查看', '编辑', '撤回'])
    expect(opLabels(rowByName('空库'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('查看 / 编辑分别以 view / edit 模式打开抽屉；检索测试开弹窗带行', async () => {
    await mount()
    await clickOp(rowByName('产品库'), '查看')
    let editor = container.querySelector('.stub-editor')
    expect(editor.dataset.visible).toBe('true')
    expect(editor.dataset.id).toBe('kb_1')
    expect(editor.dataset.mode).toBe('view')
    await clickOp(rowByName('产品库'), '编辑')
    editor = container.querySelector('.stub-editor')
    expect(editor.dataset.mode).toBe('edit')
    await clickOp(rowByName('产品库'), '检索测试')
    expect(container.querySelector('.stub-search').dataset.id).toBe('kb_1')
  })

  it('发布确认弹窗与 toast 逐字照 md：确认后调发布接口并提示「已提交发布，等待审核」', async () => {
    await mount()
    await clickOp(rowByName('空库'), '发布')
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '提交后进入审核流程，审核通过后对可见范围生效。确认提交？',
      '提交发布',
      expect.objectContaining({ confirmButtonText: '提交发布' })
    )
    expect(api.publishKnowledgeBase).toHaveBeenCalledWith('kb_4')
    expect(msg.success).toHaveBeenCalledWith('已提交发布，等待审核')
  })

  it('停用 / 撤回 / 删除确认弹窗与 toast 逐字照 md', async () => {
    await mount()
    await clickOp(rowByName('产品库'), '停用')
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '提交停用后进入审核，审核通过前该知识库对可见范围仍然生效。确认提交？',
      '提交停用',
      expect.objectContaining({ confirmButtonText: '提交停用' })
    )
    expect(api.delistKnowledgeBase).toHaveBeenCalledWith('kb_1')
    expect(msg.success).toHaveBeenCalledWith('已提交停用，等待审核')

    await clickOp(rowByName('法规库'), '撤回')
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '撤回本次提交后将回到修改前状态。确认撤回？',
      '撤回提交',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(api.withdrawKnowledgeBase).toHaveBeenCalledWith('kb_2')
    expect(msg.success).toHaveBeenCalledWith('已撤回')

    await clickOp(rowByName('空库'), '删除')
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后配置无法恢复，确认删除？',
      '删除知识库',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(api.deleteKnowledgeBase).toHaveBeenCalledWith('kb_4')
    expect(msg.success).toHaveBeenCalledWith('知识库已删除')
  })

  it('取消确认弹窗则不发请求', async () => {
    msgBox.confirm.mockRejectedValue('cancel')
    await mount()
    await clickOp(rowByName('空库'), '删除')
    expect(api.deleteKnowledgeBase).not.toHaveBeenCalled()
  })

  it('首屏取数下发分页参数；搜索与筛选走后端 query 且回第 1 页', async () => {
    await mount()
    expect(api.listKnowledgeBases).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 20 }))
    const input = container.querySelector('input')
    input.value = '产品'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    ;[...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查询').click()
    await flush()
    const last = api.listKnowledgeBases.mock.calls.at(-1)[0]
    expect(last).toEqual(expect.objectContaining({ keyword: '产品', page: 1 }))
  })

  it('岗位上下文 query（md §三.8）：进入即筛岗位类型；新建抽屉拿到岗位锁', async () => {
    routeMock.query = { tab: 'kb', positionId: 'ps_1', positionName: '销售顾问' }
    await mount()
    const last = api.listKnowledgeBases.mock.calls.at(-1)[0]
    expect(last).toEqual(expect.objectContaining({ kbType: 'POSITION' }))
    ;[...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('新建知识库')).click()
    await flush()
    const editor = container.querySelector('.stub-editor')
    expect(editor.dataset.visible).toBe('true')
    expect(editor.dataset.lock).toBe('ps_1')
  })

  it('query 带 action=create 时打开新建抽屉，并把一次性参数从地址栏清除', async () => {
    routeMock.query = { tab: 'kb', action: 'create' }
    await mount()
    expect(container.querySelector('.stub-editor').dataset.visible).toBe('true')
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'kb' } })
  })
})
