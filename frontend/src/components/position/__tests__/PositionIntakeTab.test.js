// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive, computed, inject, unref } from 'vue'

/**
 * PositionIntakeTab（岗位详情「采集字段」页签）—— 2026-09-12 测试审计 T53 新建，对齐 md 岗位 §3.1 / §3.2 / §3.3：
 *  - 已有 10 个 → 【＋ 新增采集字段】置灰；卡头副题「员工领用时填写，最多 10 个」；
 *  - 抽屉标题：新增「新增采集字段」/ 编辑「编辑采集字段」；字段名 maxlength 40 + 占位「如：客户公司名称」；
 *  - 单/多选全空选项 → toast「请至少填写一个选项」且不落库；
 *  - 保存 → 「采集字段已保存」+ 列表新增一行（key 留空自动生成）；
 *  - 删除 → 确认「删除该采集字段？删除后员工领用时不再采集该项。」+【删除】→ 「采集字段已删除」；取消不删。
 * 数据走 usePositionStore（reactive 桩，intakeSchema 挂 store.basic）；el-table 用逐行桩；DrawerEditor 轻桩。
 */

const store = reactive({
  positionId: 5,
  basic: { positionId: 5, name: '经营分析岗', intakeSchema: [] }
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))
// DrawerEditor 轻桩：visible 时渲染默认插槽 + footer，并把 title 落到 data-title
vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title', 'size', 'appendToBody'],
    emits: ['update:visible'],
    setup: (props, { slots }) => () =>
      props.visible
        ? h('div', { class: 'drawer', 'data-title': props.title, 'data-size': props.size }, [slots.default?.(), h('div', { class: 'drawer-foot' }, slots.footer?.())])
        : null
  }
}))

const PositionIntakeTab = (await import('@/components/position/PositionIntakeTab.vue')).default

const elButton = {
  name: 'el-button',
  props: ['disabled', 'type', 'link', 'size'],
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
}
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'maxlength', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input class="el-input" :maxlength="maxlength" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elSelect = {
  name: 'el-select',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
}
const elOption = { name: 'el-option', props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' }
const elSwitch = { name: 'el-switch', props: ['modelValue'], emits: ['update:modelValue'], template: '<button class="el-switch" @click="$emit(\'update:modelValue\', !modelValue)" />' }
const passthrough = (t) => ({ name: t, template: `<div class="${t}"><slot /></div>` })
// el-table 逐行桩：按 data 渲染列插槽（含 $index）；provide 一个 computed 让 data 换新数组后列也跟着重渲
const elTable = {
  name: 'el-table',
  props: ['data', 'emptyText'],
  provide() { return { tableRows: computed(() => this.data) } },
  template: '<div class="el-table" :data-empty-text="emptyText"><slot /></div>'
}
const elTableColumn = {
  name: 'el-table-column',
  props: ['label', 'prop', 'type'],
  setup(props, { slots }) {
    const tableRows = inject('tableRows', null)
    return () => {
      const rows = unref(tableRows) || []
      return h('div', { class: 'el-table-column', 'data-label': props.label },
        rows.map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default ? slots.default({ row, $index: i }) : (props.prop ? row[props.prop] : ''))))
    }
  }
}

let app, container
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionIntakeTab, props) })
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-switch', elSwitch)
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  for (const t of ['el-form', 'el-form-item']) app.component(t, passthrough(t))
  app.mount(container)
  await nextTick()
  return container
}
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
const headBtn = () => [...container.querySelectorAll('.pd-card-head .el-button')].find((b) => b.textContent.includes('新增采集字段'))
const drawer = () => container.querySelector('.drawer')
const drawerInputByPlaceholder = (p) => [...drawer().querySelectorAll('.el-input')].find((i) => i.getAttribute('placeholder') === p)
async function type(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}
async function clickFoot(text) {
  ;[...drawer().querySelectorAll('.drawer-foot .el-button')].find((b) => b.textContent.trim() === text).click()
  await flush()
}
const col = (label) => [...container.querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === label)
async function clickRowOp(rowIdx, text) {
  const cell = [...col('操作').querySelectorAll('.cell')][rowIdx]
  ;[...cell.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text).click()
  await flush()
}
const row = (label, over = {}) => ({ label, key: '', type: 'text', required: false, options: [], ...over })

beforeEach(() => {
  vi.clearAllMocks()
  store.basic = { positionId: 5, name: '经营分析岗', intakeSchema: [row('客户公司名称', { key: 'company' })] }
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('采集字段页签 · 列表与上限（md §3.1）', () => {
  it('卡头副题「员工领用时填写，最多 10 个」；1 条时【＋ 新增采集字段】可点；空态文案「暂无采集字段，点「新增采集字段」添加」', async () => {
    await mount()
    expect(container.querySelector('.pd-card-sub').textContent.trim()).toBe('员工领用时填写，最多 10 个')
    expect(headBtn().disabled).toBe(false)
    expect(container.querySelector('.el-table').getAttribute('data-empty-text')).toBe('暂无采集字段，点「新增采集字段」添加')
    expect([...col('字段名').querySelectorAll('.cell')].map((c) => c.textContent.trim())).toEqual(['客户公司名称'])
  })

  it('已有 10 个 → 【＋ 新增采集字段】置灰（md §3.1 上限）', async () => {
    store.basic.intakeSchema = Array.from({ length: 10 }, (_, i) => row(`字段${i}`, { key: `f${i}` }))
    await mount()
    expect(headBtn().disabled).toBe(true)
    expect(col('字段名').querySelectorAll('.cell')).toHaveLength(10)
  })

  it('只读态 → 无【＋ 新增采集字段】，操作列显「只读」，空态文案不引导点按钮', async () => {
    await mount({ isReadonly: true })
    expect(headBtn()).toBeUndefined()
    expect(col('操作').querySelector('.cell').textContent.trim()).toBe('只读')
    expect(container.querySelector('.el-table').getAttribute('data-empty-text')).toBe('暂无采集字段')
  })
})

describe('采集字段页签 · 新增 / 编辑抽屉（md §3.2）', () => {
  it('点【＋ 新增采集字段】→ 抽屉标题「新增采集字段」、480px；字段名 maxlength 40 + 占位「如：客户公司名称」；key 占位「auto」；底部【取消】【保存】', async () => {
    await mount()
    headBtn().click()
    await flush()
    expect(drawer()).toBeTruthy()
    expect(drawer().getAttribute('data-title')).toBe('新增采集字段')
    expect(drawer().getAttribute('data-size')).toBe('480px')
    const name = drawerInputByPlaceholder('如：客户公司名称')
    expect(name).toBeTruthy()
    expect(name.getAttribute('maxlength')).toBe('40')
    expect(drawerInputByPlaceholder('auto')).toBeTruthy()
    expect([...drawer().querySelectorAll('.drawer-foot .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '保存'])
    // 类型下拉六项照 md
    expect([...drawer().querySelectorAll('.el-select option')].map((o) => o.textContent.trim())).toEqual(['单行文本', '多行文本', '单选', '多选', '数字', '日期'])
  })

  it('行内【编辑】→ 抽屉标题「编辑采集字段」且回填字段名 / key', async () => {
    await mount()
    await clickRowOp(0, '编辑')
    expect(drawer().getAttribute('data-title')).toBe('编辑采集字段')
    expect(drawerInputByPlaceholder('如：客户公司名称').value).toBe('客户公司名称')
    expect([...drawer().querySelectorAll('.el-input')].some((i) => i.value === 'company')).toBe(true)
  })

  it('字段名留空点【保存】→ warning「请填写字段名」，不落库、抽屉不关', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    headBtn().click()
    await flush()
    await clickFoot('保存')
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写字段名')
    expect(store.basic.intakeSchema).toHaveLength(1)
    expect(drawer()).toBeTruthy()
  })

  it('类型选「单选」且选项全空 → 【保存】被拦 toast「请至少填写一个选项」（md §3.2）', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    headBtn().click()
    await flush()
    await type(drawerInputByPlaceholder('如：客户公司名称'), '所属区域')
    const sel = drawer().querySelector('.el-select')
    sel.value = 'single_select'
    sel.dispatchEvent(new Event('change'))
    await flush()
    // 选项区出现，添加两个空选项
    const addOpt = [...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.includes('添加选项'))
    expect(addOpt).toBeTruthy()
    addOpt.click(); await flush()
    addOpt.click(); await flush()
    await clickFoot('保存')
    expect(ElMessage.warning).toHaveBeenCalledWith('请至少填写一个选项')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(store.basic.intakeSchema).toHaveLength(1)
  })

  it('单选填一个选项后【保存】→ 落库（空选项被过滤、key 由字段名自动生成）+ toast「采集字段已保存」+ 抽屉关 + 列表多一行', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    headBtn().click()
    await flush()
    await type(drawerInputByPlaceholder('如：客户公司名称'), 'Region')
    const sel = drawer().querySelector('.el-select')
    sel.value = 'single_select'
    sel.dispatchEvent(new Event('change'))
    await flush()
    const addOpt = [...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.includes('添加选项'))
    addOpt.click(); await flush()
    addOpt.click(); await flush()
    await type(drawerInputByPlaceholder('选项内容'), '华东')
    await clickFoot('保存')
    expect(ElMessage.success).toHaveBeenCalledWith('采集字段已保存')
    expect(drawer()).toBeNull()
    expect(store.basic.intakeSchema).toHaveLength(2)
    expect(store.basic.intakeSchema[1]).toMatchObject({ label: 'Region', key: 'region', type: 'single_select', options: ['华东'] })
    expect([...col('字段名').querySelectorAll('.cell')].map((c) => c.textContent.trim())).toEqual(['客户公司名称', 'Region'])
    expect([...col('选项').querySelectorAll('.cell')][1].textContent.trim()).toBe('华东')
  })

  it('抽屉【取消】→ 关闭且不落库', async () => {
    await mount()
    headBtn().click()
    await flush()
    await type(drawerInputByPlaceholder('如：客户公司名称'), '不该保存')
    await clickFoot('取消')
    expect(drawer()).toBeNull()
    expect(store.basic.intakeSchema).toHaveLength(1)
  })
})

describe('采集字段页签 · 删除（md §3.3）', () => {
  it('行内【删除】→ 确认「删除该采集字段？删除后员工领用时不再采集该项。」+【删除】→ 行移除 + toast「采集字段已删除」', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    await mount()
    await clickRowOp(0, '删除')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除该采集字段？删除后员工领用时不再采集该项。',
      '删除字段',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(store.basic.intakeSchema).toEqual([])
    expect(ElMessage.success).toHaveBeenCalledWith('采集字段已删除')
    expect(col('字段名').querySelectorAll('.cell')).toHaveLength(0)
  })

  it('删除确认点取消 → 行保留、无 toast', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    await clickRowOp(0, '删除')
    expect(store.basic.intakeSchema).toHaveLength(1)
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
