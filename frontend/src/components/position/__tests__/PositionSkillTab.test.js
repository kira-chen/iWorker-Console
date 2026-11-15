// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { passthrough } from '../../../views/admin/__tests__/helpers/commonStubs'

/**
 * PositionSkillTab（岗位详情「技能」页签）组件级单测。
 *
 * 对齐口径：docs/PRD/数字员工管理端PRD/产品优化需求-202611.md 修改点 1「岗位直接引用技能，取消 Agent」（R1）——
 *  - 列表：单层表格，一行一个技能，展示技能名称、技能分类、工具数量，行内【编辑】【移除】；
 *    【编辑】进入技能编辑页，编辑完成后可【← 返回】回到岗位详情页的「技能」页签；
 *  - 添加：右上角【添加技能】打开选择抽屉，标题「添加技能」；候选排除本岗位已经引用的；
 *    抽屉内展示「已勾选 N · 已引用 M / 上限 100」；
 *  - 强制回收：引用保留，名称旁加红色「已回收」标签，悬停展示回收原因、操作人和时间；由管理员手动移除；
 *  - 空状态：「暂无技能 · 点「添加技能」引用岗位私有技能」；
 *  - 新建、编辑、删除 Agent 的入口、抽屉和提示一并删除。
 * 未改动的口径沿用 02岗位/岗位/prd.岗位.md：§10 审核中全部页签只读；§12 异常提示。
 *
 * 分工：移除被自动化任务引用时的拦截、未引用时的确认文案与「技能已移除」、100 个上限（抽屉内联提示 + 满额置灰）、
 * 技能分类列「未分类」/「—」由同目录 PositionSkillTabRules.test.js 守，本文件不重复。
 *
 * 历史：本文件由 PositionAgentSkillTab.test.js（「Agent 与技能」页签，2026-10-08 补测新建）改名而来；
 * 2026-11-12 随 R1 取消 Agent 改写——纯 Agent 的用例（Agent 行 / 抽屉 / 删除 / 20 个上限 / 差集同步）删除，
 * 仍有效的规则改测岗位直接引用技能的模型；原 views/admin/__tests__/positionAgentTab4C.test.js 里的
 * 「已回收」标签用例并入本文件。
 *
 * 依赖打桩：usePositionStore（reactive 桩，skills[] + attachSkill / detachSkill）、
 * @/api/position 的 listPositionSkillCandidates / checkDetachPositionSkill、vue-router、element-plus 的 ElMessage / ElMessageBox、
 * DrawerEditor（轻桩：visible 时渲染默认插槽 + footer）；Element Plus 组件以最小桩注册（el-table 按 data 渲染列插槽）。
 */

const defaultSkills = () => [
  { skillId: 302, name: '客户画像分析', displayCategoryName: '数据分析', toolCount: 3 },
  { skillId: 303, name: '报销自动填单', displayCategoryName: '办公效率', referencedTools: [{ id: 't1' }, { id: 't2' }] }
]

const store = reactive({
  positionId: 5,
  skills: defaultSkills(),
  attachSkill: vi.fn(),
  detachSkill: vi.fn()
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), alert: vi.fn() }
}))
const routerPush = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))

const candidateFixture = (n, base = 400) =>
  Array.from({ length: n }, (_, i) => ({ id: base + i, name: `候选技能${i}`, description: `描述${i}` }))
const listPositionSkillCandidates = vi.fn()
const checkDetachPositionSkill = vi.fn()
vi.mock('@/api/position', () => ({
  listPositionSkillCandidates: (...a) => listPositionSkillCandidates(...a),
  checkDetachPositionSkill: (...a) => checkDetachPositionSkill(...a)
}))

vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title', 'size', 'appendToBody'],
    setup: (props, { slots }) => () =>
      props.visible
        ? h('div', { class: 'drawer', 'data-title': props.title }, [
            slots.default?.(),
            h('div', { class: 'drawer-foot' }, slots.footer?.())
          ])
        : null
  }
}))

const { ElMessage, ElMessageBox } = await import('element-plus')
const PositionSkillTab = (await import('@/components/position/PositionSkillTab.vue')).default

/* ---------------- Element Plus 最小桩 ---------------- */
const elButton = {
  name: 'el-button',
  props: ['disabled', 'type', 'link', 'size', 'loading'],
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-loading="String(!!loading)" @click="$emit(\'click\')"><slot /></button>'
}
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'placeholder', 'clearable'],
  emits: ['update:modelValue'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elCheckbox = {
  name: 'el-checkbox',
  props: ['modelValue', 'disabled'],
  emits: ['change'],
  template: '<label class="el-checkbox" :data-checked="String(!!modelValue)"><input type="checkbox" :disabled="disabled" @change="$emit(\'change\')" /><slot /></label>'
}
// el-table：按 data 渲染列插槽；tableRows 以 getter 注入，store 变化时行跟随重渲；空数据渲染 empty-text。
const elTable = {
  name: 'el-table',
  props: ['data', 'emptyText', 'rowKey'],
  provide() { return { tableRows: () => this.data || [] } },
  template: '<div class="el-table"><div v-if="!(data || []).length" class="el-table__empty">{{ emptyText }}</div><slot /></div>'
}
const elTableColumn = {
  name: 'el-table-column',
  props: ['label', 'width', 'minWidth', 'align', 'fixed'],
  inject: ['tableRows'],
  setup(props, { slots }) {
    return function () {
      return h('div', { class: 'el-table-column', 'data-label': props.label },
        this.tableRows().map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default?.({ row }))))
    }
  }
}
// el-tooltip：把 content 落到 data-tip 上，便于断言悬停内容
const elTooltip = { name: 'el-tooltip', props: ['content', 'placement'], template: '<span class="tip" :data-tip="content"><slot /></span>' }

let app, container
async function mount(props = {}, { ensurePersisted } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionSkillTab, props) })
  if (ensurePersisted) app.provide('pdEnsurePersisted', ensurePersisted)
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.component('el-checkbox', elCheckbox)
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  app.component('el-tag', passthrough('el-tag'))
  app.component('el-tooltip', elTooltip)
  // v-loading：把绑定值落到 data-loading，便于断言 loading 态
  app.directive('loading', {
    mounted: (el, b) => el.setAttribute('data-loading', String(!!b.value)),
    updated: (el, b) => el.setAttribute('data-loading', String(!!b.value))
  })
  app.mount(container)
  await flush()
  return container
}
const flush = async () => {
  for (let i = 0; i < 6; i++) { await nextTick(); await Promise.resolve() }
}

/* ---------------- DOM 小工具 ---------------- */
const col = (label) => [...container.querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === label)
const cellTexts = (label) => [...col(label).querySelectorAll('.cell')].map((c) => c.textContent.trim())
const rowOps = () => [...col('操作').querySelectorAll('.cell')].map((c) => [...c.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
const headBtn = () => container.querySelector('.pd-card-head .el-button')
async function clickRowOp(rowIdx, text) {
  const cell = [...col('操作').querySelectorAll('.cell')][rowIdx]
  ;[...cell.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text).click()
  await flush()
}
async function openAdd() {
  headBtn().click()
  await flush()
}
const drawer = () => container.querySelector('.drawer')
const boxes = () => [...drawer().querySelectorAll('.el-checkbox')]
const boxNames = () => boxes().map((b) => b.querySelector('strong').textContent.trim())
async function toggleBox(i) {
  boxes()[i].querySelector('input').dispatchEvent(new Event('change'))
  await flush()
}
async function clickFoot(text) {
  ;[...drawer().querySelectorAll('.drawer-foot .el-button')].find((b) => b.textContent.trim() === text).click()
  await flush()
}
const pickList = () => drawer().querySelector('.pd-skill-pick-list')

beforeEach(() => {
  vi.clearAllMocks()
  store.skills = defaultSkills()
  listPositionSkillCandidates.mockImplementation(() => Promise.resolve(candidateFixture(3)))
  checkDetachPositionSkill.mockResolvedValue('')
  store.attachSkill.mockResolvedValue({})
  store.detachSkill.mockResolvedValue(undefined)
  ElMessageBox.confirm.mockResolvedValue('confirm')
  ElMessageBox.alert.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  vi.useRealTimers()
})

describe('技能列表：单层表格，一行一个技能（修改点 1「技能」页签）', () => {
  it('列为 技能名称 / 技能分类 / 工具数量 / 操作，每个引用的技能一行；工具数量 = 技能引用的工具条数（无工具记 0）', async () => {
    store.skills = [...defaultSkills(), { skillId: 304, name: '空工具技能', displayCategoryName: '办公效率' }]
    await mount()
    const labels = [...container.querySelectorAll('.el-table-column')].map((c) => c.getAttribute('data-label'))
    expect(labels).toEqual(['技能名称', '技能分类', '工具数量', '操作'])
    expect(cellTexts('技能名称')).toEqual(['客户画像分析', '报销自动填单', '空工具技能'])
    expect(cellTexts('技能分类')).toEqual(['数据分析', '办公效率', '办公效率'])
    expect(cellTexts('工具数量')).toEqual(['3', '2', '0'])
  })

  it('卡头标题「技能」+ 右上角【添加技能】；行内【编辑】【移除】；页签里不再出现任何 Agent 入口或字样', async () => {
    await mount()
    expect(container.querySelector('.pd-card-head .pd-card-title').textContent.trim()).toBe('技能')
    expect(headBtn().textContent.trim().replace(/^＋\s*/, '')).toBe('添加技能')
    expect(headBtn().disabled).toBe(false)
    expect(rowOps()).toEqual([['编辑', '移除'], ['编辑', '移除']])
    expect(container.textContent).not.toContain('Agent')
  })

  it('空列表 → 空状态「暂无技能 · 点「添加技能」引用岗位私有技能」，【添加技能】可用', async () => {
    store.skills = []
    await mount()
    expect(container.querySelector('.el-table__empty').textContent.trim()).toBe('暂无技能 · 点「添加技能」引用岗位私有技能')
    expect(headBtn().disabled).toBe(false)
  })
})

describe('添加技能抽屉（修改点 1「添加」「候选范围」「上限」）', () => {
  it('点【添加技能】→ 抽屉标题「添加技能」，按本岗位取候选，计数「已勾选 N · 已引用 M / 上限 100」随勾选变化', async () => {
    await mount()
    await openAdd()
    expect(drawer().getAttribute('data-title')).toBe('添加技能')
    expect(listPositionSkillCandidates).toHaveBeenCalledWith(5, undefined)
    expect(boxNames()).toEqual(['候选技能0', '候选技能1', '候选技能2'])
    expect(drawer().textContent).toContain('已勾选 0 · 已引用 2 / 上限 100')
    await toggleBox(1)
    expect(drawer().textContent).toContain('已勾选 1 · 已引用 2 / 上限 100')
  })

  it('候选排除本岗位已经引用的技能（同一岗位内同一技能只引用一次）', async () => {
    listPositionSkillCandidates.mockImplementation(() => Promise.resolve([
      { id: 302, name: '客户画像分析', description: '' },
      { id: 400, name: '候选技能0', description: '' }
    ]))
    await mount()
    await openAdd()
    expect(boxNames()).toEqual(['候选技能0'])
  })

  it('勾选 2 个 →【添加】逐个引用到岗位，提示成功并关闭抽屉', async () => {
    await mount()
    await openAdd()
    await toggleBox(0)
    await toggleBox(2)
    await clickFoot('添加')
    expect(store.attachSkill.mock.calls).toEqual([[400], [402]])
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(drawer()).toBeNull()
  })

  it('新建态岗位未能先落库（父层 ensurePersisted 返回 false）→ 不打开抽屉、不拉候选', async () => {
    const ensurePersisted = vi.fn(async () => false)
    await mount({}, { ensurePersisted })
    await openAdd()
    expect(ensurePersisted).toHaveBeenCalledTimes(1)
    expect(drawer()).toBeNull()
    expect(listPositionSkillCandidates).not.toHaveBeenCalled()
  })

  it('搜索：输入关键词 300ms 后按去掉首尾空白的关键词重取候选', async () => {
    vi.useFakeTimers()
    await mount()
    await openAdd()
    expect(listPositionSkillCandidates).toHaveBeenCalledTimes(1)
    const input = drawer().querySelector('.el-input')
    input.value = ' 画像 '
    input.dispatchEvent(new Event('input'))
    await flush()
    vi.advanceTimersByTime(299)
    await flush()
    expect(listPositionSkillCandidates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await flush()
    expect(listPositionSkillCandidates).toHaveBeenCalledTimes(2)
    expect(listPositionSkillCandidates).toHaveBeenLastCalledWith(5, '画像')
  })

  it('异常：候选加载失败 → 提示失败原因、候选清空、loading 解除', async () => {
    listPositionSkillCandidates.mockImplementation(() => Promise.reject(new Error('网络异常')))
    await mount()
    await openAdd()
    expect(ElMessage.error).toHaveBeenCalledWith('网络异常')
    expect(boxes()).toHaveLength(0)
    expect(pickList().getAttribute('data-loading')).toBe('false')
  })
})

describe('移除 / 编辑（修改点 1「移除」「列表」）', () => {
  it('【移除】确认框点取消 → 不解除引用、无成功提示', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    await clickRowOp(1, '移除')
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(store.detachSkill).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('异常：移除失败 → 提示失败原因，不出「技能已移除」', async () => {
    store.detachSkill.mockRejectedValueOnce(new Error('技能不存在'))
    await mount()
    await clickRowOp(1, '移除')
    expect(store.detachSkill).toHaveBeenCalledWith(303)
    expect(ElMessage.error).toHaveBeenCalledWith('技能不存在')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('【编辑】→ 同页跳技能编辑页，query 带来源岗位与「技能」页签（返回回到岗位详情「技能」页签）', async () => {
    await mount()
    await clickRowOp(0, '编辑')
    expect(routerPush).toHaveBeenCalledWith({
      name: 'AdminSkillEdit',
      params: { id: 302 },
      query: { fromPosition: '5', fromTab: 'skills' }
    })
  })
})

describe('技能被强制回收（修改点 1「强制回收」）', () => {
  it('被回收的技能名称旁出「已回收」，悬停「回收原因：{原因}（{操作人} · {时间}）」，【移除】仍可用；未回收的不出标签', async () => {
    store.skills = [
      { skillId: 1, name: '已回收技能', displayCategoryName: '数据分析', toolCount: 0, revoked: { reason: '输出异常', at: '2026-09-30 10:00', operator: 'admin' } },
      { skillId: 2, name: '正常技能', displayCategoryName: '数据分析', toolCount: 0, revoked: null }
    ]
    await mount()
    const names = [...col('技能名称').querySelectorAll('.cell')]
    const tag = names[0].querySelector('.revoked-tag')
    expect(tag?.textContent.trim()).toBe('已回收')
    expect(tag.closest('.tip').getAttribute('data-tip')).toBe('回收原因：输出异常（admin · 2026-09-30 10:00）')
    expect(names[1].querySelector('.revoked-tag')).toBeNull()
    expect(rowOps()[0]).toContain('移除')
  })
})

describe('只读态（prd.岗位.md §10 审核中全部页签只读 / 列表【查看】进入）', () => {
  it('不出【添加技能】；行内操作只剩【查看】，无编辑 / 移除', async () => {
    await mount({ isReadonly: true })
    expect(headBtn()).toBeNull()
    expect(rowOps()).toEqual([['查看'], ['查看']])
  })

  it('【查看】→ 跳技能编辑页查看态（view=1），带来源岗位与「技能」页签', async () => {
    await mount({ isReadonly: true })
    await clickRowOp(1, '查看')
    expect(routerPush).toHaveBeenCalledWith({
      name: 'AdminSkillEdit',
      params: { id: 303 },
      query: { fromPosition: '5', fromTab: 'skills', view: '1' }
    })
  })
})
