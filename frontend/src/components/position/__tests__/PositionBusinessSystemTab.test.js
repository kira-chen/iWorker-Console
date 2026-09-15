// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive, inject, unref, computed } from 'vue'

/**
 * PositionBusinessSystemTab（岗位详情「业务系统」页签，0de8fe9 带逻辑重新实现）—— 2026-09-12 测试审计 T53 新建，
 * 对齐 md 岗位 §8.1 / §8.2 / §8.3 / §11：
 *  - 引用列表只出 store.basic.businessSystemIds 命中的已发布业务系统；空态「暂无引用的业务系统」；
 *  - 【＋ 新业务系统】→ 弹窗「引用业务系统」，只列已发布且未被当前岗位引用的，可按名称搜索；
 *  - 勾选后【确认引用】→ 写 businessSystemIds + toast「引用成功」+ 列表新增该行；未勾选 → warning「请选择要引用的业务系统」；
 *  - 只读态隐藏【＋ 新业务系统】；行内仅【查看】→ 打开只读抽屉（复用 BizSystemEditor，readonly=true，editingId=该行 id）。
 * 数据走 usePositionStore（reactive 桩）；@/api/admin.listBizSystems mock；BizSystemEditor 轻桩记录 props；el-table 逐行桩。
 */

const store = reactive({
  positionId: 5,
  basic: { positionId: 5, name: '经营分析岗', businessSystemIds: ['biz_2101'] }
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))
const listBizSystems = vi.fn()
vi.mock('@/api/admin', () => ({ listBizSystems: (...a) => listBizSystems(...a) }))
vi.mock('@/components/admin/BizSystemEditor.vue', () => ({
  default: {
    name: 'BizSystemEditor',
    props: ['visible', 'editingId', 'readonly'],
    emits: ['update:visible'],
    setup: (props) => () => h('div', { class: 'biz-viewer', 'data-visible': String(!!props.visible), 'data-id': props.editingId ?? '', 'data-readonly': String(!!props.readonly) })
  }
}))

const PositionBusinessSystemTab = (await import('@/components/position/PositionBusinessSystemTab.vue')).default

// 已发布业务系统 3 条：biz_2101 已被引用、biz_2102 / biz_2103 未引用
const PUBLISHED = [
  { id: 'biz_2101', name: 'CRM 客户系统', icon: '◎', description: '客户资料与跟进记录', loginUrl: 'https://crm.example.com', bizPagesCount: 3, updatedAt: '2026-08-24T14:12:00+08:00' },
  { id: 'biz_2102', name: 'ERP 进销存', icon: '▤', description: '库存与订单', loginUrl: 'https://erp.example.com', bizPagesCount: 0, updatedAt: '2026-08-20T09:00:00+08:00' },
  { id: 'biz_2103', name: '工单系统', icon: '✎', description: '售后工单', loginUrl: 'https://ticket.example.com', bizPagesCount: 1, updatedAt: '2026-08-22T09:00:00+08:00' }
]

const elButton = { name: 'el-button', props: ['type', 'link'], emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
const elInput = { name: 'el-input', props: ['modelValue', 'placeholder'], emits: ['update:modelValue'], template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' }
const elDialog = { name: 'el-dialog', props: ['modelValue', 'title', 'width'], template: '<div v-if="modelValue" class="el-dialog" :data-title="title" :data-width="width"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>' }
// checkbox-group / checkbox：点 checkbox 把 label 加入/移出 group 的 modelValue
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
  template: '<div class="el-table" :data-empty-text="emptyText" :data-count="(data || []).length"><slot /></div>'
}
const elTableColumn = {
  name: 'el-table-column', props: ['label', 'prop'],
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
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const col = (label) => [...container.querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === label)
const names = () => [...col('业务系统').querySelectorAll('.cell .biz-name')].map((n) => n.textContent.trim())
const addBtn = () => [...container.querySelectorAll('.pd-list-head .el-button')].find((b) => b.textContent.includes('新业务系统'))
const dialog = () => container.querySelector('.el-dialog')
const dialogItems = () => [...dialog().querySelectorAll('.ref-item')].map((it) => it.querySelector('.ref-item-name').textContent.trim())

beforeEach(() => {
  vi.clearAllMocks()
  listBizSystems.mockResolvedValue({ list: PUBLISHED, total: PUBLISHED.length })
  store.basic = { positionId: 5, name: '经营分析岗', businessSystemIds: ['biz_2101'] }
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('业务系统页签 · 引用列表（md §8.1）', () => {
  it('只列 businessSystemIds 命中的已发布业务系统（图标 + 名称 / 登录地址 / 业务页 / 时间 / 操作）', async () => {
    await mount()
    expect(listBizSystems).toHaveBeenCalledWith({ status: 'PUBLISHED' })
    expect(names()).toEqual(['CRM 客户系统'])
    expect(col('业务系统').querySelector('.cell .biz-icon').textContent.trim()).toBe('◎')
    expect(col('登录地址').querySelector('.cell a').getAttribute('href')).toBe('https://crm.example.com')
    expect(col('业务页').querySelector('.cell').textContent.trim()).toBe('3 个')
    expect(container.querySelector('.time-sort').textContent).toContain('最近更新时间')
    expect(container.querySelector('.pd-list-sub').textContent.trim()).toBe('该岗位引用的已发布业务系统列表')
  })

  it('未引用任何业务系统 → 不取详情、空态文案「暂无引用的业务系统」', async () => {
    store.basic.businessSystemIds = []
    await mount()
    expect(listBizSystems).not.toHaveBeenCalled()
    expect(container.querySelector('.el-table').getAttribute('data-empty-text')).toBe('暂无引用的业务系统')
    expect(container.querySelector('.el-table').getAttribute('data-count')).toBe('0')
  })

  it('行内操作仅【查看】（无移除）；点【查看】→ 打开只读抽屉 BizSystemEditor(readonly, editingId=该行)（md §8.3 / §11）', async () => {
    await mount()
    const opBtns = [...col('操作').querySelectorAll('.cell .el-button')].map((b) => b.textContent.trim())
    expect(opBtns).toEqual(['查看'])
    expect(container.querySelector('.biz-viewer').getAttribute('data-visible')).toBe('false')
    col('操作').querySelector('.cell .el-button').click()
    await flush()
    const viewer = container.querySelector('.biz-viewer')
    expect(viewer.getAttribute('data-visible')).toBe('true')
    expect(viewer.getAttribute('data-id')).toBe('biz_2101')
    expect(viewer.getAttribute('data-readonly')).toBe('true')
  })

  it('只读态 → 隐藏【＋ 新业务系统】，列表与【查看】仍在（md §8.2 末条）', async () => {
    await mount({ isReadonly: true })
    expect(addBtn()).toBeUndefined()
    expect(names()).toEqual(['CRM 客户系统'])
    expect([...col('操作').querySelectorAll('.cell .el-button')].map((b) => b.textContent.trim())).toEqual(['查看'])
  })
})

describe('业务系统页签 · 引用弹窗（md §8.2）', () => {
  it('点【＋ 新业务系统】→ 弹窗「引用业务系统」700px，只列已发布且未被引用的 2 条（含图标 / 名称 / 描述）+ 搜索框', async () => {
    await mount()
    addBtn().click()
    await flush()
    expect(dialog()).toBeTruthy()
    expect(dialog().getAttribute('data-title')).toBe('引用业务系统')
    expect(dialog().getAttribute('data-width')).toBe('700px')
    expect(dialogItems()).toEqual(['ERP 进销存', '工单系统'])
    expect(dialog().textContent).not.toContain('CRM 客户系统')
    expect(dialog().querySelector('.ref-item .ref-item-desc').textContent.trim()).toBe('库存与订单')
    expect(dialog().querySelector('.el-input').getAttribute('placeholder')).toBe('搜索业务系统名称')
    expect([...dialog().querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '确认引用'])
  })

  it('弹窗搜索按名称过滤：输「工单」只剩工单系统；无命中显「未找到匹配的业务系统」', async () => {
    await mount()
    addBtn().click()
    await flush()
    const search = dialog().querySelector('.el-input')
    search.value = '工单'
    search.dispatchEvent(new Event('input'))
    await flush()
    expect(dialogItems()).toEqual(['工单系统'])
    search.value = '不存在'
    search.dispatchEvent(new Event('input'))
    await flush()
    expect(dialogItems()).toEqual([])
    expect(dialog().querySelector('.ref-empty').textContent.trim()).toBe('未找到匹配的业务系统')
  })

  it('勾选 ERP 后【确认引用】→ businessSystemIds 追加 biz_2102 + toast「引用成功」+ 弹窗关 + 列表多出 ERP 行', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    addBtn().click()
    await flush()
    dialog().querySelectorAll('.ref-item .el-checkbox')[0].click()
    await flush()
    expect(dialog().querySelectorAll('.ref-item .el-checkbox')[0].getAttribute('data-checked')).toBe('true')
    ;[...dialog().querySelectorAll('.dlg-footer .el-button')].find((b) => b.textContent.trim() === '确认引用').click()
    await flush()
    expect(store.basic.businessSystemIds).toEqual(['biz_2101', 'biz_2102'])
    expect(ElMessage.success).toHaveBeenCalledWith('引用成功')
    expect(dialog()).toBeNull()
    // 列表重拉后按最近更新时间倒序：CRM(08-24) 在前、ERP(08-20) 在后
    expect(names()).toEqual(['CRM 客户系统', 'ERP 进销存'])
  })

  it('未勾选直接【确认引用】→ warning「请选择要引用的业务系统」，不写 store、弹窗不关', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    addBtn().click()
    await flush()
    ;[...dialog().querySelectorAll('.dlg-footer .el-button')].find((b) => b.textContent.trim() === '确认引用').click()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要引用的业务系统')
    expect(store.basic.businessSystemIds).toEqual(['biz_2101'])
    expect(dialog()).toBeTruthy()
  })

  it('全部已引用 → 弹窗空态「暂无可引用的业务系统」', async () => {
    store.basic.businessSystemIds = ['biz_2101', 'biz_2102', 'biz_2103']
    await mount()
    addBtn().click()
    await flush()
    expect(dialogItems()).toEqual([])
    expect(dialog().querySelector('.ref-empty').textContent.trim()).toBe('暂无可引用的业务系统')
  })
})
