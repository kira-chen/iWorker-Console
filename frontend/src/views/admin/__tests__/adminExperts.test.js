// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'

/**
 * AdminExperts.vue 单测。
 * 2026-09-01 PRD 对齐改造取代旧口径（原断言基于：二态状态列 / 「版本发布」单入口 /
 * 查影响面+回填名强确认删除 / 「平台技能」措辞），本文件按新契约重写：
 * - 三态展示映射（未发布/审核中/已发布）并入专家名列；分类列 / 最新版本「-」占位；
 * - 操作列按状态：查看+编辑恒显（审核中编辑置灰）、未发布=发布/删除、审核中=撤回、已发布=停用/版本管理；
 * - 删除/停用降级普通二次确认（N 取行 skillCount，不再调 delete-impact）；
 * - 「查看」开只读抽屉；发布门措辞「市场技能」；版本抽屉适配器带专家词表（版本管理/启用/禁用）。
 */

vi.mock('@element-plus/icons-vue', () => ({ Plus: {}, Search: {} }))

const listExperts = vi.fn()
const deleteExpert = vi.fn()
const unpublishExpert = vi.fn()
const withdrawExpert = vi.fn()
vi.mock('@/api/domainExpert', () => ({
  listExperts: (...a) => listExperts(...a),
  deleteExpert: (...a) => deleteExpert(...a),
  unpublishExpert: (...a) => unpublishExpert(...a),
  withdrawExpert: (...a) => withdrawExpert(...a),
  // 版本抽屉适配器所需（本页只组装 adapter，不直接调用）
  publishExpert: vi.fn(),
  getExpertNextVersionLabel: vi.fn(),
  listExpertPublications: vi.fn(),
  delistExpertPublication: vi.fn(),
  relistExpertPublication: vi.fn()
}))

// 抽屉本体另有独立单测（expertEditor.test.js）；本页只验「开没开、带的哪个 id、是否只读」。
const editorProps = vi.fn()
vi.mock('@/components/admin/ExpertEditor.vue', () => ({
  default: {
    name: 'ExpertEditor',
    props: { visible: Boolean, expertId: [String, Number, null], readonly: Boolean },
    emits: ['saved', 'publish'],
    setup(props) {
      return () => {
        editorProps(props.visible, props.expertId, props.readonly)
        return props.visible
          ? h('div', { class: 'expert-editor', 'data-readonly': String(props.readonly) }, String(props.expertId))
          : null
      }
    }
  }
}))

// 版本管理侧栏（统一 VersionDrawer）：本页只验「开没开、带的哪个专家、词表参数」。
vi.mock('@/components/admin/VersionDrawer.vue', () => ({
  default: {
    name: 'VersionDrawer',
    props: { modelValue: Boolean, adapter: { type: Object, default: null } },
    emits: ['done'],
    setup(props, { emit }) {
      return () =>
        props.modelValue
          ? h('div', {
              class: 'version-dialog',
              'data-title': props.adapter?.title || '',
              'data-delist-term': props.adapter?.delistTerm || '',
              'data-entity-key': props.adapter?.entityKey || '',
              'data-state': props.adapter?.deriveView?.()?.label || '',
              onDone: () => emit('done')
            }, String(props.adapter?.id ?? ''))
          : null
    }
  }
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))
vi.mock('@/assets/connector.css', () => ({}))
vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span><slot name="actions" /></div>'
  }
}))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' }
}))

const AdminExperts = (await import('@/views/admin/AdminExperts.vue')).default

const ROW_KEY = Symbol('row')
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-table' }, props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: i })))
  }
}
const RowCells = {
  props: { row: { type: Object, required: true }, colSlot: { type: Function, required: true } },
  setup(props) {
    provide(ROW_KEY, props.row)
    return () => h('div', { class: 'el-row' }, props.colSlot?.())
  }
}
const tableColStub = {
  name: 'el-table-column',
  props: { label: { type: String, default: '' }, prop: { type: String, default: '' } },
  setup(props, { slots }) {
    const row = inject(ROW_KEY, null)
    return () => h('div', { class: 'el-table-column' }, [row ? slots.default?.({ row }) : slots.header?.()])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, title: String },
  emits: ['click'],
  template:
    '<button class="el-button" :disabled="disabled" :title="title" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminExperts)
  for (const t of ['el-input', 'el-select', 'el-option', 'el-pagination', 'el-icon']) {
    app.component(t, passthrough(t))
  }
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
  app.component('el-button', elButton)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const rowEls = () => [...container.querySelectorAll('.el-row')]
const rowBtn = (row, text) => [...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

// 三行覆盖三态：已发布 / 未发布（0 技能）/ 审核中
const EXPERTS = [
  { id: 201, name: '经营分析专家', intro: '汇总经营数据', avatar: '▤', category: '投资', skillCount: 2, status: 'published', pendingAction: null, latestVersionLabel: 'v2.3.0', updatedAt: '2026-08-24T14:12:00+08:00' },
  { id: 203, name: '法务审阅专家', intro: '辅助审阅合同', avatar: '§', category: '法律', skillCount: 0, status: 'draft', pendingAction: null, latestVersionLabel: '', updatedAt: '2026-08-22T10:30:00+08:00' },
  { id: 204, name: '研究报告专家', intro: '行业研究', avatar: '◎', category: '投资', skillCount: 2, status: 'published', pendingAction: 'PUBLISH', latestVersionLabel: 'v1.1.0', updatedAt: '2026-08-24T09:18:00+08:00' }
]

beforeEach(() => {
  editorProps.mockReset()
  listExperts.mockReset().mockResolvedValue({ list: EXPERTS, total: 3 })
  deleteExpert.mockReset()
  unpublishExpert.mockReset()
  withdrawExpert.mockReset()
  ElMessageBox.confirm.mockReset()
  ElMessageBox.alert.mockReset()
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
  ElMessage.warning.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminExperts（2026-09-01 PRD 对齐）', () => {
  it('subtitle 用「市场技能」措辞；挂载拉列表（默认按最近更新时间降序）', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent)
      .toBe('把多个市场技能归类整合成一个可交付单元，只引用市场技能，与 FDE 技能互不影响')
    expect(container.textContent).not.toContain('平台技能')
    expect(listExperts).toHaveBeenCalledWith(expect.objectContaining({ sort: 'desc' }))
  })

  it('行渲染：状态标签并入专家名列（三态映射）；分类列；最新版本无版本显「-」', async () => {
    await mount()
    const rows = rowEls()
    expect(rows).toHaveLength(3)
    // 三态映射：已发布 / 未发布 / 审核中（不再出现「草稿」「发布审核中」旧词）
    expect(rows[0].querySelector('.status-tag').textContent).toBe('已发布')
    expect(rows[1].querySelector('.status-tag').textContent).toBe('未发布')
    expect(rows[2].querySelector('.status-tag').textContent).toBe('审核中')
    expect(container.textContent).not.toContain('草稿')
    // 名称列内含头像 + 名称 + 标签同格
    expect(rows[0].querySelector('.ex-primary .ex-avatar')).toBeTruthy()
    expect(rows[0].textContent).toContain('投资') // 分类列
    expect(rows[1].textContent).toContain('-') // 无版本占位
  })

  it('加载失败 → 「加载失败」；无数据 → 「还没有专家，点击「新建专家」创建第一个」', async () => {
    listExperts.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    app.unmount(); container.remove()

    listExperts.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('还没有专家，点击「新建专家」创建第一个')
  })

  it('操作列按状态：已发布=查看/编辑/停用/版本管理；未发布=查看/编辑/发布/删除；审核中=查看/编辑(置灰)/撤回', async () => {
    await mount()
    const [pub, draft, review] = rowEls()
    expect([...pub.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
      .toEqual(['查看', '编辑', '停用', '版本管理'])
    expect([...draft.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
      .toEqual(['查看', '编辑', '发布', '删除'])
    expect([...review.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
      .toEqual(['查看', '编辑', '撤回'])
    // 审核中编辑置灰 + title 提示；删除按钮带二次确认 title
    const reviewEdit = rowBtn(review, '编辑')
    expect(reviewEdit.disabled).toBe(true)
    expect(reviewEdit.title).toBe('审核中不可编辑')
    expect(rowBtn(draft, '删除').title).toBe('删除前需二次确认')
  })

  it('「查看」→ 开只读抽屉；「编辑」/专家名点击 → 开编辑抽屉', async () => {
    await mount()
    rowBtn(rowEls()[0], '查看').click()
    await nextTick()
    let editor = container.querySelector('.expert-editor')
    expect(editor.textContent).toBe('201')
    expect(editor.dataset.readonly).toBe('true')

    rowBtn(rowEls()[0], '编辑').click()
    await nextTick()
    editor = container.querySelector('.expert-editor')
    expect(editor.dataset.readonly).toBe('false')

    // 专家名点击与「编辑」同入口
    app.unmount(); container.remove()
    await mount()
    container.querySelector('.ex-name').click()
    await nextTick()
    expect(container.querySelector('.expert-editor').textContent).toBe('201')
  })

  it('新建：开空抽屉（expertId=null）', async () => {
    await mount()
    const createBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('新建专家'))
    createBtn.click()
    await nextTick()
    expect(container.querySelector('.expert-editor').textContent).toBe('null')
  })

  it('未发布 0 技能点「发布」→ 「至少引用 1 个市场技能才能发布」拦下，不开侧栏', async () => {
    await mount()
    rowBtn(rowEls()[1], '发布').click()
    await nextTick()
    expect(ElMessage.warning).toHaveBeenCalledWith('至少引用 1 个市场技能才能发布')
    expect(container.querySelector('.version-dialog')).toBeNull()
  })

  it('已发布点「版本管理」→ 开侧栏，适配器带专家词表（版本管理/禁用/专家名称）', async () => {
    await mount()
    rowBtn(rowEls()[0], '版本管理').click()
    await nextTick()
    const dlg = container.querySelector('.version-dialog')
    expect(dlg.textContent).toBe('201')
    expect(dlg.dataset.title).toBe('版本管理')
    expect(dlg.dataset.delistTerm).toBe('禁用')
    expect(dlg.dataset.entityKey).toBe('专家名称')
    // 发布走独立侧栏，不顺带开编辑抽屉
    expect(container.querySelector('.expert-editor')).toBeNull()
  })

  it('版本动作完成 → 重拉列表并回写抽屉持有的行（发布态不停留在旧值）', async () => {
    await mount()
    rowBtn(rowEls()[0], '版本管理').click()
    await nextTick()
    expect(container.querySelector('.version-dialog').dataset.state).toBe('已发布')

    listExperts.mockResolvedValueOnce({
      list: [{ ...EXPERTS[0], pendingAction: 'PUBLISH' }, EXPERTS[1], EXPERTS[2]],
      total: 3
    })
    container.querySelector('.version-dialog').dispatchEvent(new CustomEvent('done'))
    await flush()
    expect(listExperts).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.version-dialog').dataset.state).toBe('已发布 · 新版审核中')
  })

  it('删除：普通二次确认（N 取行 skillCount，不再调 delete-impact）→ deleteExpert → 「专家已删除」', async () => {
    ElMessageBox.confirm.mockResolvedValueOnce()
    deleteExpert.mockResolvedValueOnce(0)
    await mount()
    rowBtn(rowEls()[1], '删除').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除「法务审阅专家」后会解除 0 条市场技能引用，技能本体不受影响。确认删除？',
      '删除专家',
      expect.objectContaining({ confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
    )
    expect(deleteExpert).toHaveBeenCalledWith(203)
    expect(ElMessage.success).toHaveBeenCalledWith('专家已删除')
    expect(listExperts).toHaveBeenCalledTimes(2)
  })

  it('停用：普通二次确认【提交停用审核】→ unpublishExpert → 「已提交停用审核」', async () => {
    ElMessageBox.confirm.mockResolvedValueOnce()
    unpublishExpert.mockResolvedValueOnce({})
    await mount()
    rowBtn(rowEls()[0], '停用').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '停用「经营分析专家」需提交审核。审核通过前客户端仍可使用。',
      '停用专家',
      expect.objectContaining({ confirmButtonText: '提交停用审核' })
    )
    expect(unpublishExpert).toHaveBeenCalledWith(201)
    expect(ElMessage.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('列表撤回：确认文案照原型 → withdrawExpert → 「审核申请已撤回」+ 重拉', async () => {
    ElMessageBox.confirm.mockResolvedValueOnce()
    withdrawExpert.mockResolvedValueOnce({})
    await mount()
    rowBtn(rowEls()[2], '撤回').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '「研究报告专家」当前处于审核中。撤回后回到修改前状态。',
      '撤回审核申请',
      expect.objectContaining({ confirmButtonText: '撤回申请' })
    )
    expect(withdrawExpert).toHaveBeenCalledWith(204)
    expect(ElMessage.success).toHaveBeenCalledWith('审核申请已撤回')
    expect(listExperts).toHaveBeenCalledTimes(2)
  })

  it('取消确认 → 不打接口', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    rowBtn(rowEls()[1], '删除').click()
    await flush()
    expect(deleteExpert).not.toHaveBeenCalled()
  })
})
