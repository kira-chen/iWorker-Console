// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { passthrough } from '../../../views/admin/__tests__/helpers/commonStubs'

/**
 * PositionAgentSkillTab（岗位详情「Agent 与技能」页签）组件级单测 —— 2026-10-08 补测新建。
 *
 * 对齐口径（唯一）：docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md
 *  - §6.1 二级表格：Agent 一级行（名称 / 职责描述 / 【编辑】【删除】）、技能二级子行；最多 20 个 Agent，达上限【新增 Agent】置灰禁用；
 *  - §6.2 新建 / 编辑同一抽屉：标题「新建 Agent」/「编辑 Agent」；名称必填 ≤64、占位「如：客户洞察」；
 *         职责描述必填 ≤2000、占位「决定主实例把子任务委派给这个 Agent 时的执行口径」；底部【取消】【新建】/【取消】【保存】；保存后「Agent 已保存」；
 *  - §6.3 删除确认文案逐字 +【确认删除】+「Agent 已删除」；
 *  - §6.4 技能引用：抽屉勾选、候选仅「已发布且未被当前岗位引用过的岗位私有技能」、每 Agent ≤100、计数「已勾选：N/100」、
 *         达上限未勾选项置灰 + 提示「每个 Agent 最多引用 100 个技能」；子行展示技能名称 / 技能分类 / 工具数量；
 *         【移除】确认逐字；子行【编辑】进入技能详情页（§11 跨模块跳转、可返回岗位详情）；
 *  - §10 审核中全部页签只读；§12 保存失败提示「保存失败」并保留当前编辑内容；
 *  - 《各模块必填选填字段一览表.md》#5.1 Agent 名称 ≤64、#5.2 Agent 职责描述 ≤2000；三.#2 技能分类取值（AI Agent / … / 数据分析 / 知识管理）。
 *
 * 覆盖点：正常路径（二维表渲染、抽屉新建/编辑/差集同步、删除、移除、跳转）、边界（空列表、20 个 Agent、100 个技能、工具数兜底）、
 * 异常路径（技能库加载失败 + loading 态、保存/删除/移除失败、确认框取消、ensurePersisted 拦截）、只读态（查看按钮 / 只读抽屉）。
 * 疑似缺陷以 it.fails 按 md 期望钉桩（见文末 describe）。
 *
 * 依赖打桩：usePositionStore（reactive 桩）、@/api/position.listSkills、vue-router、element-plus 的 ElMessage/ElMessageBox、
 * DrawerEditor（轻桩：visible 时渲染默认插槽 + footer）；Element Plus 组件以最小桩注册（el-table 按 data 渲染列插槽）。
 */

const defaultAgents = () => [
  {
    agentId: 'ag_1',
    name: '经营分析 Agent',
    description: '汇总经营指标并识别异常',
    skills: [
      { skillId: 302, name: '客户画像分析', category: 'QUERY', toolCount: 3 },
      { skillId: 303, name: '报销自动填单', category: 'OPERATION', referencedTools: [{ id: 't1' }, { id: 't2' }] }
    ]
  }
]

const store = reactive({
  positionId: 5,
  agents: defaultAgents(),
  load: vi.fn(),
  addAgent: vi.fn(),
  patchAgent: vi.fn(),
  removeAgent: vi.fn(),
  assignSkillToAgent: vi.fn(),
  detachSkillFromAgent: vi.fn(),
  reorderSkillsLocal: vi.fn(),
  patchSkill: vi.fn()
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn() }
}))
const routerPush = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))

const skillFixture = (n, base = 300) =>
  Array.from({ length: n }, (_, i) => ({ id: base + i, name: `技能${i}`, description: i === 1 ? '' : `描述${i}`, status: 'published' }))
const listSkills = vi.fn()
vi.mock('@/api/position', () => ({ listSkills: (...a) => listSkills(...a) }))

vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title', 'size', 'appendToBody'],
    setup: (props, { slots }) => () =>
      props.visible
        ? h('div', { class: 'drawer', 'data-title': props.title, 'data-size': props.size }, [
            slots.default?.(),
            h('div', { class: 'drawer-foot' }, slots.footer?.())
          ])
        : null
  }
}))

const { ElMessage, ElMessageBox } = await import('element-plus')
const PositionAgentSkillTab = (await import('@/components/position/PositionAgentSkillTab.vue')).default

/* ---------------- Element Plus 最小桩 ---------------- */
const elButton = {
  name: 'el-button',
  props: ['disabled', 'type', 'link', 'size', 'loading'],
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" :data-loading="String(!!loading)" @click="$emit(\'click\')"><slot /></button>'
}
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'maxlength', 'placeholder', 'type', 'rows', 'showWordLimit', 'clearable'],
  emits: ['update:modelValue'],
  template:
    '<input class="el-input" :data-type="type || \'text\'" :maxlength="maxlength" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elForm = { name: 'el-form', props: ['disabled', 'labelPosition'], template: '<form class="el-form" :data-disabled="String(!!disabled)"><slot /></form>' }
const elFormItem = { name: 'el-form-item', props: { label: String, required: Boolean }, template: '<div class="el-form-item" :data-label="label" :data-required="String(!!required)"><slot /></div>' }
const elCheckbox = {
  name: 'el-checkbox',
  props: ['modelValue', 'disabled'],
  emits: ['change'],
  template: '<label class="el-checkbox" :data-checked="String(!!modelValue)" :data-disabled="String(!!disabled)"><input type="checkbox" :disabled="disabled" @change="$emit(\'change\')" /><slot /></label>'
}
// el-table：按 data 渲染列插槽；tableRows 以 getter 注入，store 变化时行跟随重渲；空数据渲染 empty-text。
const elTable = {
  name: 'el-table',
  props: ['data', 'emptyText', 'rowKey', 'rowClassName'],
  provide() { return { tableRows: () => this.data || [] } },
  template: '<div class="el-table"><div v-if="!(data || []).length" class="el-table__empty">{{ emptyText }}</div><slot /></div>'
}
const elTableColumn = {
  name: 'el-table-column',
  props: ['label', 'prop', 'width', 'minWidth', 'align', 'fixed'],
  inject: ['tableRows'],
  setup(props, { slots }) {
    return function () {
      const rows = this.tableRows()
      return h('div', { class: 'el-table-column', 'data-label': props.label },
        rows.map((row, i) => h('div', { class: 'cell', 'data-row': i, 'data-kind': row.kind }, slots.default?.({ row }))))
    }
  }
}

let app, container
async function mount(props = {}, { ensurePersisted } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionAgentSkillTab, props) })
  if (ensurePersisted) app.provide('pdEnsurePersisted', ensurePersisted)
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.component('el-form', elForm)
  app.component('el-form-item', elFormItem)
  app.component('el-checkbox', elCheckbox)
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  app.component('el-tag', passthrough('el-tag'))
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
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve() }
}

/* ---------------- DOM 小工具 ---------------- */
const col = (label) => [...container.querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === label)
const cellTexts = (label) => [...col(label).querySelectorAll('.cell')].map((c) => c.textContent.trim())
const headBtn = () => container.querySelector('.pd-card-head .el-button')
async function clickRowOp(rowIdx, text) {
  const cell = [...col('操作').querySelectorAll('.cell')][rowIdx]
  const btn = [...cell.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
  btn.click()
  await flush()
}
const drawer = () => container.querySelector('.drawer')
const nameInput = () => drawer().querySelector('.el-input[maxlength="64"]')
const descInput = () => drawer().querySelector('.el-input[maxlength="2000"]')
const searchInput = () => drawer().querySelector('.el-input[placeholder="搜索技能名称、描述或标识"]')
async function type(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}
const footBtns = () => [...drawer().querySelectorAll('.drawer-foot .el-button')]
const footBtn = (text) => footBtns().find((b) => b.textContent.trim() === text)
async function clickFoot(text) {
  footBtn(text).click()
  await flush()
}
const boxes = () => [...drawer().querySelectorAll('.el-checkbox')]
const checked = () => boxes().map((b) => b.getAttribute('data-checked') === 'true')
async function toggleBox(i) {
  // 直接派发 change：绕过 disabled 也能验证组件内兜底闸
  boxes()[i].querySelector('input').dispatchEvent(new Event('change'))
  await flush()
}
async function clickNewAgent() {
  headBtn().click()
  await flush()
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.agents = defaultAgents()
  listSkills.mockImplementation(() => Promise.resolve({ list: skillFixture(3) }))
  store.addAgent.mockImplementation((p) => Promise.resolve({ agentId: 'ag_new', ...p, skills: [] }))
  store.patchAgent.mockResolvedValue({})
  store.removeAgent.mockResolvedValue({})
  store.assignSkillToAgent.mockResolvedValue({})
  store.detachSkillFromAgent.mockResolvedValue(undefined)
  ElMessageBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  vi.useRealTimers()
})

describe('二级表格展示（md §6.1 / §6.4）', () => {
  it('Agent 为一级行（◆ 名称 + 职责描述），其引用技能为二级子行（· 名称 + 分类 + 工具数量）', async () => {
    await mount()
    expect(cellTexts('AGENT / 技能')).toEqual(['◆ 经营分析 Agent', '· 客户画像分析', '· 报销自动填单'])
    expect(cellTexts('职责描述 / 分类')).toEqual(['汇总经营指标并识别异常', '查询类', '操作类'])
    // Agent 行工具列为占位「—」；技能子行展示工具数量：toolCount 优先，缺省时数 referencedTools
    expect(cellTexts('工具')).toEqual(['—', '3', '2'])
  })

  it('技能子行既无 toolCount 也无 referencedTools → 工具数量按 0 展示；Agent 无职责描述 → 「—」', async () => {
    store.agents = [{ agentId: 'ag_9', name: 'A9', description: '', skills: [{ skillId: 900, name: '空工具技能', category: null }] }]
    await mount()
    expect(cellTexts('工具')).toEqual(['—', '0'])
    expect(cellTexts('职责描述 / 分类')).toEqual(['—', '—'])
  })

  it('卡头标题「Agent 与技能」+ 说明 +【＋ 新增 Agent】；Agent 行操作【编辑】【删除】，技能子行操作【编辑】【移除】', async () => {
    await mount()
    const head = container.querySelector('.pd-card-head')
    expect(head.querySelector('.pd-card-title').textContent).toBe('Agent 与技能')
    expect(head.textContent).toContain('每个 Agent 是一组技能 · 主实例按职责描述委派子任务')
    expect(headBtn().textContent.trim()).toBe('＋ 新增 Agent')
    expect(headBtn().disabled).toBe(false)
    const ops = [...col('操作').querySelectorAll('.cell')].map((c) => [...c.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
    expect(ops).toEqual([['编辑', '删除'], ['编辑', '移除'], ['编辑', '移除']])
    // §6.3：删除为 danger-link 样式
    const delBtn = [...col('操作').querySelectorAll('.cell')][0].querySelectorAll('.el-button')[1]
    expect(delBtn.getAttribute('data-type')).toBe('danger')
  })

  it('空列表：无 Agent 时表格展示空态文案，【＋ 新增 Agent】可用', async () => {
    store.agents = []
    await mount()
    expect(container.querySelector('.el-table__empty').textContent).toBe('暂无 Agent，点「＋ 新增 Agent」创建')
    expect(cellTexts('AGENT / 技能')).toEqual([])
    expect(headBtn().disabled).toBe(false)
  })

  it('边界：已有 20 个 Agent → 【新增 Agent】置灰禁用，文案「已达 20 个上限」（md §6.1）', async () => {
    store.agents = Array.from({ length: 20 }, (_, i) => ({ agentId: `ag_${i}`, name: `A${i}`, description: `d${i}`, skills: [] }))
    await mount()
    expect(headBtn().disabled).toBe(true)
    expect(headBtn().textContent.trim()).toBe('已达 20 个上限')
  })

  it('边界：19 个 Agent → 【＋ 新增 Agent】仍可点并能打开新建抽屉', async () => {
    store.agents = Array.from({ length: 19 }, (_, i) => ({ agentId: `ag_${i}`, name: `A${i}`, description: `d${i}`, skills: [] }))
    await mount()
    expect(headBtn().disabled).toBe(false)
    await clickNewAgent()
    expect(drawer().getAttribute('data-title')).toBe('新建 Agent')
  })

  it('落库编排期间 Agent 数被补到 20（并发新增）→ 不开抽屉并提示「单岗位最多 20 个 Agent」', async () => {
    store.agents = Array.from({ length: 19 }, (_, i) => ({ agentId: `ag_${i}`, name: `A${i}`, description: `d${i}`, skills: [] }))
    const ensurePersisted = vi.fn(async () => {
      store.agents.push({ agentId: 'ag_19', name: 'A19', description: 'd', skills: [] })
      return true
    })
    await mount({}, { ensurePersisted })
    await clickNewAgent()
    expect(ensurePersisted).toHaveBeenCalledTimes(1)
    expect(ElMessage.warning).toHaveBeenCalledWith('单岗位最多 20 个 Agent')
    expect(drawer()).toBeNull()
  })

  it('新建态岗位未能先落库（父层 ensurePersisted 返回 false）→ 不打开抽屉、不拉技能库', async () => {
    const ensurePersisted = vi.fn(async () => false)
    await mount({}, { ensurePersisted })
    await clickNewAgent()
    expect(ensurePersisted).toHaveBeenCalledTimes(1)
    expect(drawer()).toBeNull()
    expect(listSkills).not.toHaveBeenCalled()
  })
})

describe('新增 / 编辑 Agent 抽屉（md §6.2 + 字段一览表 #5.1/#5.2）', () => {
  it('点【＋ 新增 Agent】→ 680px 抽屉「新建 Agent」，名称/职责为空，字段上限与占位照 md，底部【取消】【新建】', async () => {
    await mount()
    await clickNewAgent()
    expect(drawer().getAttribute('data-title')).toBe('新建 Agent')
    expect(drawer().getAttribute('data-size')).toBe('680px')
    expect(nameInput().value).toBe('')
    expect(nameInput().getAttribute('placeholder')).toBe('如：客户洞察')
    expect(descInput().value).toBe('')
    expect(descInput().getAttribute('data-type')).toBe('textarea')
    expect(descInput().getAttribute('placeholder')).toBe('决定主实例把子任务委派给这个 Agent 时的执行口径')
    // 两字段均标必填
    const items = [...drawer().querySelectorAll('.el-form-item')].map((i) => [i.getAttribute('data-label'), i.getAttribute('data-required')])
    expect(items).toEqual([['Agent 名称', 'true'], ['职责描述', 'true']])
    expect(footBtns().map((b) => b.textContent.trim())).toEqual(['取消', '新建'])
  })

  it('打开抽屉即拉技能库候选：listSkills({ page:1, size:200, status:"published" })，候选渲染名称与描述（空描述显示「暂无描述」）', async () => {
    store.agents = [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [] }] // 本岗位尚无引用，候选全量展示
    await mount()
    await clickNewAgent()
    expect(listSkills).toHaveBeenCalledWith({ page: 1, size: 200, status: 'published' })
    expect(boxes().map((b) => b.querySelector('strong').textContent)).toEqual(['技能0', '技能1', '技能2'])
    expect(boxes().map((b) => b.querySelector('small').textContent)).toEqual(['描述0', '暂无描述', '描述2'])
    expect(drawer().textContent).toContain('已勾选：0/100')
  })

  it('候选接口直接返回数组时同样渲染', async () => {
    listSkills.mockImplementation(() => Promise.resolve(skillFixture(2, 500)))
    store.agents = [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [] }]
    await mount()
    await clickNewAgent()
    expect(boxes().map((b) => b.querySelector('strong').textContent)).toEqual(['技能0', '技能1'])
  })

  it('新建：填名称 + 职责 + 勾 1 个技能 →【新建】先 addAgent 再 assign 到新 Agent，toast「Agent 已保存」并关闭抽屉', async () => {
    await mount()
    await clickNewAgent()
    await type(nameInput(), '  客户洞察  ')
    await type(descInput(), '负责客户洞察')
    await toggleBox(1)
    expect(drawer().textContent).toContain('已勾选：1/100')
    await clickFoot('新建')
    // 名称首尾空白去除；sortOrder 追加到末尾
    expect(store.addAgent).toHaveBeenCalledWith({ name: '客户洞察', description: '负责客户洞察', sortOrder: 1 })
    expect(store.assignSkillToAgent).toHaveBeenCalledWith(301, 'ag_new')
    expect(store.detachSkillFromAgent).not.toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已保存')
    expect(drawer()).toBeNull()
  })

  it('必填：名称为空（仅空白）→ 提示「请填写 Agent 名称」，不落库、抽屉不关', async () => {
    await mount()
    await clickNewAgent()
    await type(nameInput(), '   ')
    await type(descInput(), '职责')
    await clickFoot('新建')
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写 Agent 名称')
    expect(store.addAgent).not.toHaveBeenCalled()
    expect(drawer()).not.toBeNull()
  })

  it('必填：职责描述为空 → 提示「请填写职责描述」，不落库', async () => {
    await mount()
    await clickNewAgent()
    await type(nameInput(), '客户洞察')
    await clickFoot('新建')
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写职责描述')
    expect(store.addAgent).not.toHaveBeenCalled()
  })

  it('编辑：标题「编辑 Agent」、回填名称/职责、预勾已引用技能，底部【取消】【保存】', async () => {
    listSkills.mockImplementation(() => Promise.resolve({ list: skillFixture(4, 300) })) // 300..303
    await mount()
    await clickRowOp(0, '编辑')
    expect(drawer().getAttribute('data-title')).toBe('编辑 Agent')
    expect(nameInput().value).toBe('经营分析 Agent')
    expect(descInput().value).toBe('汇总经营指标并识别异常')
    expect(checked()).toEqual([false, false, true, true])
    expect(drawer().textContent).toContain('已勾选：2/100')
    expect(footBtns().map((b) => b.textContent.trim())).toEqual(['取消', '保存'])
  })

  it('编辑保存按勾选差集增量同步：新勾 → assign(skillId, agentId)，取消 → detach(agentId, skillId)，未变动的不调', async () => {
    listSkills.mockImplementation(() => Promise.resolve({ list: skillFixture(4, 300) }))
    await mount()
    await clickRowOp(0, '编辑')
    await toggleBox(2) // 取消 302
    await toggleBox(0) // 新勾 300
    await type(nameInput(), '经营分析 Agent v2')
    await clickFoot('保存')
    expect(store.patchAgent).toHaveBeenCalledWith('ag_1', { name: '经营分析 Agent v2', description: '汇总经营指标并识别异常' })
    expect(store.assignSkillToAgent).toHaveBeenCalledTimes(1)
    expect(store.assignSkillToAgent).toHaveBeenCalledWith(300, 'ag_1')
    expect(store.detachSkillFromAgent).toHaveBeenCalledTimes(1)
    expect(store.detachSkillFromAgent).toHaveBeenCalledWith('ag_1', 302)
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已保存')
  })

  it('保存中【保存】按钮为 loading 态，完成后恢复', async () => {
    const d = deferred()
    store.patchAgent.mockImplementation(() => d.promise)
    await mount()
    await clickRowOp(0, '编辑')
    footBtn('保存').click()
    await flush()
    expect(footBtn('保存').getAttribute('data-loading')).toBe('true')
    d.resolve({})
    await flush()
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已保存')
    expect(drawer()).toBeNull()
  })

  it('异常：保存失败（无具体原因）→ 提示「保存失败」，抽屉保持打开并保留已填内容（md §12）', async () => {
    store.patchAgent.mockRejectedValue({})
    await mount()
    await clickRowOp(0, '编辑')
    await type(descInput(), '改过的职责')
    await clickFoot('保存')
    expect(ElMessage.error).toHaveBeenCalledWith('保存失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(drawer()).not.toBeNull()
    expect(descInput().value).toBe('改过的职责')
    expect(footBtn('保存').getAttribute('data-loading')).toBe('false')
  })

  it('异常：后端返回错误信息 → 透出该信息', async () => {
    store.addAgent.mockRejectedValue(new Error('Agent 名已存在'))
    await mount()
    await clickNewAgent()
    await type(nameInput(), '经营分析 Agent')
    await type(descInput(), '职责')
    await clickFoot('新建')
    expect(ElMessage.error).toHaveBeenCalledWith('Agent 名已存在')
    expect(store.assignSkillToAgent).not.toHaveBeenCalled()
  })

  it('【取消】关闭抽屉且不落库', async () => {
    await mount()
    await clickRowOp(0, '编辑')
    await type(nameInput(), '改名')
    await clickFoot('取消')
    expect(drawer()).toBeNull()
    expect(store.patchAgent).not.toHaveBeenCalled()
  })
})

describe('技能候选加载态 / 失败 / 搜索（md §6.4 · §12）', () => {
  it('loading 态：候选拉取中勾选区为 loading，返回后解除', async () => {
    const d = deferred()
    listSkills.mockImplementation(() => d.promise)
    await mount()
    await clickNewAgent()
    const list = drawer().querySelector('.pd-agent-skill-list')
    expect(list.getAttribute('data-loading')).toBe('true')
    // 加载中不提前给空态
    expect(drawer().querySelector('.pd-agent-skill-empty')).toBeNull()
    d.resolve({ list: skillFixture(2) })
    await flush()
    expect(drawer().querySelector('.pd-agent-skill-list').getAttribute('data-loading')).toBe('false')
    expect(boxes()).toHaveLength(2)
  })

  it('异常：技能库加载失败 → 错误提示「加载技能库失败」、候选清空并给空态、loading 解除', async () => {
    listSkills.mockImplementation(() => Promise.reject({}))
    await mount()
    await clickNewAgent()
    expect(ElMessage.error).toHaveBeenCalledWith('加载技能库失败')
    expect(boxes()).toHaveLength(0)
    expect(drawer().querySelector('.pd-agent-skill-empty').textContent.trim()).toBe('暂无可引用的岗位私有技能')
    expect(drawer().querySelector('.pd-agent-skill-list').getAttribute('data-loading')).toBe('false')
  })

  it('异常：加载失败带具体原因 → 透出原因', async () => {
    listSkills.mockImplementation(() => Promise.reject(new Error('网络异常')))
    await mount()
    await clickNewAgent()
    expect(ElMessage.error).toHaveBeenCalledWith('网络异常')
  })

  it('空候选 → 「暂无可引用的岗位私有技能」', async () => {
    listSkills.mockImplementation(() => Promise.resolve({ list: [] }))
    await mount()
    await clickNewAgent()
    expect(drawer().querySelector('.pd-agent-skill-empty').textContent.trim()).toBe('暂无可引用的岗位私有技能')
  })

  it('搜索：输入关键词 300ms 防抖后带 keyword 重拉（首尾空白去除），连续输入只拉最后一次', async () => {
    vi.useFakeTimers()
    await mount()
    await clickNewAgent()
    expect(listSkills).toHaveBeenCalledTimes(1)
    await type(searchInput(), '画')
    vi.advanceTimersByTime(100)
    await type(searchInput(), ' 画像 ')
    vi.advanceTimersByTime(299)
    await flush()
    expect(listSkills).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await flush()
    expect(listSkills).toHaveBeenCalledTimes(2)
    expect(listSkills).toHaveBeenLastCalledWith({ page: 1, size: 200, status: 'published', keyword: '画像' })
  })
})

describe('单 Agent 技能上限 100（md §6.4）', () => {
  it('勾满 100 → 计数「已勾选：100/100」，未勾选项置灰；绕过置灰再勾不生效并提示「每个 Agent 最多引用 100 个技能」；取消不受限', async () => {
    listSkills.mockImplementation(() => Promise.resolve({ list: skillFixture(101, 9000) }))
    await mount()
    await clickNewAgent()
    for (let i = 0; i < 100; i++) await toggleBox(i)
    expect(drawer().textContent).toContain('已勾选：100/100')
    expect(boxes()[0].getAttribute('data-disabled')).toBe('false')
    expect(boxes()[100].getAttribute('data-disabled')).toBe('true')
    await toggleBox(100)
    expect(checked().filter(Boolean)).toHaveLength(100)
    expect(checked()[100]).toBe(false)
    expect(ElMessage.warning).toHaveBeenCalledWith('每个 Agent 最多引用 100 个技能')
    await toggleBox(0)
    expect(checked().filter(Boolean)).toHaveLength(99)
    expect(boxes()[100].getAttribute('data-disabled')).toBe('false')
  })
})

describe('删除 Agent（md §6.3）', () => {
  it('【删除】→ 确认框逐字 +【确认删除】→ removeAgent(agentId) + toast「Agent 已删除」', async () => {
    await mount()
    await clickRowOp(0, '删除')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除该 Agent 后会解除其技能关联，技能本身不会被删除。确认删除？',
      '删除 Agent',
      expect.objectContaining({ confirmButtonText: '确认删除', type: 'warning' })
    )
    expect(store.removeAgent).toHaveBeenCalledWith('ag_1')
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已删除')
  })

  it('确认框点取消 → 不删除、无提示', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    await clickRowOp(0, '删除')
    expect(store.removeAgent).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('异常：删除失败 → 提示「删除失败」（有原因透出原因）', async () => {
    store.removeAgent.mockRejectedValueOnce({})
    await mount()
    await clickRowOp(0, '删除')
    expect(ElMessage.error).toHaveBeenCalledWith('删除失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
    store.removeAgent.mockRejectedValueOnce(new Error('岗位审核中不可删除'))
    await clickRowOp(0, '删除')
    expect(ElMessage.error).toHaveBeenLastCalledWith('岗位审核中不可删除')
  })
})

describe('技能子行：移除 / 编辑跳转（md §6.4 / §11）', () => {
  it('【移除】→ 确认框逐字「仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？」→ detach(agentId, skillId) + toast「已移除」', async () => {
    await mount()
    await clickRowOp(2, '移除')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？',
      '移除技能',
      expect.objectContaining({ confirmButtonText: '移除', cancelButtonText: '取消' })
    )
    expect(store.detachSkillFromAgent).toHaveBeenCalledWith('ag_1', 303)
    expect(ElMessage.success).toHaveBeenCalledWith('已移除')
  })

  it('【移除】确认框取消 → 不解除关联', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    await clickRowOp(1, '移除')
    expect(store.detachSkillFromAgent).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('异常：移除失败 → 提示「移除失败」（有原因透出原因）', async () => {
    store.detachSkillFromAgent.mockRejectedValueOnce({})
    await mount()
    await clickRowOp(1, '移除')
    expect(ElMessage.error).toHaveBeenCalledWith('移除失败')
    store.detachSkillFromAgent.mockRejectedValueOnce(new Error('技能不存在'))
    await clickRowOp(1, '移除')
    expect(ElMessage.error).toHaveBeenLastCalledWith('技能不存在')
  })

  it('技能子行【编辑】→ 同页跳技能详情页，query 带来源岗位与页签（返回回到岗位详情 Agent 页签）', async () => {
    await mount()
    await clickRowOp(1, '编辑')
    expect(routerPush).toHaveBeenCalledWith({
      name: 'AdminSkillEdit',
      params: { id: 302 },
      query: { fromPosition: '5', fromTab: 'agents' }
    })
  })
})

describe('只读态（md §10 审核中全部页签只读 / 列表【查看】进入）', () => {
  it('不出【新增 Agent】；Agent 行与技能子行操作只剩【查看】，无编辑/删除/移除', async () => {
    await mount({ isReadonly: true })
    expect(container.querySelector('.pd-card-head .el-button')).toBeNull()
    const ops = [...col('操作').querySelectorAll('.cell')].map((c) => [...c.querySelectorAll('.el-button')].map((b) => b.textContent.trim()))
    expect(ops).toEqual([['查看'], ['查看'], ['查看']])
  })

  it('Agent 行【查看】→ 抽屉「查看 Agent」：表单禁用、技能复选框全禁用、勾选无效，底部仅【关闭】', async () => {
    listSkills.mockImplementation(() => Promise.resolve({ list: skillFixture(4, 300) }))
    await mount({ isReadonly: true })
    await clickRowOp(0, '查看')
    expect(drawer().getAttribute('data-title')).toBe('查看 Agent')
    expect(drawer().querySelector('.el-form').getAttribute('data-disabled')).toBe('true')
    expect(nameInput().value).toBe('经营分析 Agent')
    expect(boxes().every((b) => b.getAttribute('data-disabled') === 'true')).toBe(true)
    expect(checked()).toEqual([false, false, true, true])
    await toggleBox(0)
    expect(checked()).toEqual([false, false, true, true])
    expect(footBtns().map((b) => b.textContent.trim())).toEqual(['关闭'])
    await clickFoot('关闭')
    expect(drawer()).toBeNull()
    expect(store.patchAgent).not.toHaveBeenCalled()
  })

  it('技能子行【查看】→ 跳技能详情页查看态（view=1），带来源岗位与页签', async () => {
    await mount({ isReadonly: true })
    await clickRowOp(2, '查看')
    expect(routerPush).toHaveBeenCalledWith({
      name: 'AdminSkillEdit',
      params: { id: 303 },
      query: { fromPosition: '5', fromTab: 'agents', view: '1' }
    })
  })
})

describe('Agent 抽屉候选排除本岗位已引用技能（md §6.4，yuepu#60⑥）+ 技能分类列（yuepu#61②）', () => {
  it('新建 Agent：候选不含本岗位其他 Agent 已引用的技能（md §6.4「同一岗位内同一技能只引用一次」）', async () => {
    // 候选 300/301/302；302 已被 ag_1 引用
    await mount()
    await clickNewAgent()
    expect(drawer().getAttribute('data-title')).toBe('新建 Agent')
    expect(boxes().map((b) => b.querySelector('strong').textContent)).toEqual(['技能0', '技能1'])
  })

  it('编辑第二个 Agent：看不到第一个 Agent 的技能，但保留自己已引用的（可取消勾选）', async () => {
    store.agents = [
      { agentId: 'ag_1', name: 'A', description: 'd', skills: [{ skillId: 302, name: '技能2', category: 'QUERY', toolCount: 1 }] },
      { agentId: 'ag_2', name: 'B', description: 'd', skills: [{ skillId: 301, name: '技能1', category: 'QUERY', toolCount: 1 }] }
    ]
    await mount()
    await clickRowOp(2, '编辑') // 行序：A、A 下技能、B、B 下技能
    expect(nameInput().value).toBe('B')
    expect(boxes().map((b) => b.querySelector('strong').textContent)).toEqual(['技能0', '技能1'])
    expect(checked()).toEqual([false, true])
  })

  it.fails('技能子行应展示技能分类（如「数据分析」）（疑似缺陷：分类列只认 OPERATION/QUERY 派生类别，md 技能分类取值渲染为空标签；md §6.4「技能子行展示：技能名称、技能分类、工具数量」+ 一览表 三.#2 技能分类取值）', async () => {
    store.agents = [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [{ skillId: 302, name: '经营数据分析', category: '数据分析', toolCount: 5 }] }]
    await mount()
    // 前提：技能子行已渲染
    expect(cellTexts('AGENT / 技能')).toEqual(['◆ A', '· 经营数据分析'])
    // md 期望：分类列展示技能分类原值
    expect(cellTexts('职责描述 / 分类')[1]).toBe('数据分析')
  })
})
