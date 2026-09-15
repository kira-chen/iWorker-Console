// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * 岗位详情「Agent 与技能」页签 · 2026-09-09 原型复刻批次 4C 行为契约。
 *
 * 形态基准（负责人 Q383 决议 + 《待决策问题清单-20260908-补充说明》第 5 条「采纳 A」）：
 * 二维表 —— 行维度 = Agent（◆ 前缀）与其下技能（· 前缀）两级，列维度 = 名称 / 职责描述·分类 /
 * 工具 / 操作；分类只是技能行上的一个属性列，不做 ◆ 分类分组的三级结构。
 *
 * 本组钉四件事：
 *  #13 表格包在卡片里（卡头「Agent 与技能」+ 弱色说明 + 右侧【＋ 新增 Agent】）；
 *  #14 新建与编辑走同一抽屉（680px），抽屉内含「引用技能」勾选区，Agent 行不再有【＋技能】；
 *      技能上限 LIMITS.SKILL_MAX（Q378 决议 100），达上限未勾选项置灰 + 计数「已勾选：N/100」；
 *  #15 技能行【编辑】= 同页路由跳转（不开新标签），并带来源岗位/页签 query；
 *      字段上限按 md §6.2：名称 64、职责描述必填 ≤500（Q25④⑤）。
 *
 * 2026-09-12 测试审计（T24 / T53）对齐 md 岗位 §6.1-§6.4：
 *  - SKILL_MAX 钉字面 100 + 文案「每个 Agent 最多引用 100 个技能」（md §6.4 L354；09-08 裁决），不再只对常量断言；
 *  - AGENT_MAX 20「已达 20 个上限」置灰（§6.1）、删除确认 + 「Agent 已删除」（§6.3）、
 *    「Agent 已保存」（§6.2）、移除确认「仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？」（§6.4）。
 */

import { LIMITS } from '@/utils/positionModel'

const defaultAgents = () => [
  { agentId: 'ag_1', name: '经营分析 Agent', description: '汇总经营指标并识别异常', skills: [{ skillId: 302, name: '客户画像分析', category: 'QUERY', referencedTools: [] }] }
]
const store = {
  positionId: 5,
  loading: false,
  error: '',
  basic: { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', businessSystemIds: [], intakeSchema: [] },
  agents: defaultAgents(),
  allSkills: [],
  isPublished: false,
  detail: { positionId: 5, status: 'draft', pendingAction: null },
  checkInput: {},
  load: vi.fn(() => Promise.resolve()),
  reset: vi.fn(),
  saveBasic: vi.fn(() => Promise.resolve({ warnings: [] })),
  hydrate: vi.fn(),
  addAgent: vi.fn((p) => Promise.resolve({ agentId: 'ag_new', ...p, skills: [] })),
  patchAgent: vi.fn(() => Promise.resolve({})),
  removeAgent: vi.fn(() => Promise.resolve({})),
  assignSkillToAgent: vi.fn(() => Promise.resolve({})),
  detachSkillFromAgent: vi.fn(() => Promise.resolve())
}
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), prompt: vi.fn() }
}))
const routerPushSpy = vi.fn()
const routeMock = { params: { id: '5' }, query: {}, meta: {} }
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: routerPushSpy, replace: vi.fn(), resolve: () => ({ href: '/x' }) }),
  onBeforeRouteLeave: () => {},
  // 2026-09-10：新增的业务系统页签经 api/admin → api/request → src/router 拖入真实 router 模块，
  // 整模块 mock 后需喂它能跑通的工厂（口径同 components/admin/__tests__/expertEditor.test.js）。
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  createWebHistory: () => ({})
}))
// 抽屉「引用技能」候选来自 listSkills（已发布 FDE 技能），与旧 SkillPickerDialog 同源。
const skillFixture = (n, base = 300) =>
  Array.from({ length: n }, (_, i) => ({ id: base + i, name: `技能${i}`, description: `描述${i}`, code: `sk_${i}`, status: 'published' }))
const defaultSkillList = () => Promise.resolve({ list: skillFixture(3) })
const listSkillsSpy = vi.fn(defaultSkillList)
vi.mock('@/api/position', () => ({
  createPosition: vi.fn(), publishPosition: vi.fn(() => Promise.resolve({})),
  getNextVersionLabel: vi.fn(() => Promise.resolve('v1.0.0')), listPositionPublications: vi.fn(() => Promise.resolve([])),
  listSkills: (...a) => listSkillsSpy(...a)
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve([])) }))
// 2026-09-09 PRD 复核·G1（A1）：完整性校验第 6 项要自动化任务条数，详情页挂载即独立预取
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: vi.fn(() => Promise.resolve({ list: [] })) }))
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn(() => Promise.resolve({ list: [], total: 0 })) }))
vi.mock('@/composables/useVersionPublish', () => ({
  useVersionPublish: () => ({ versionLabel: { value: '' }, releaseNotes: { value: '' }, prevMaxLabel: { value: '' }, versionAtMax: { value: false }, nextLabelLoading: { value: false }, primeNextLabel: vi.fn(), reset: vi.fn() })
}))
// featureFlags 局部 mock 必须与真实模块的导出保持一致，否则引用它的组件加载即报错。
// 2026-09-12 负责人决策 3（审计 J2）：FRONT_RUNTIME_ENABLED 随员工端整体退役删除，本 mock 同步去掉该键。
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false }))

for (const p of [
  '@/components/admin/AdminRail.vue', '@/components/StatusTag.vue', '@/components/ThemeToggle.vue',
  '@/components/position/PublishCheckDialog.vue',
  '@/components/position/PositionDataTableStage.vue',
  '@/components/position/PositionSampleTaskStage.vue', '@/components/position/ClaimNotesEditor.vue',
  '@/components/position/IconPickerPopover.vue',
  '@/components/position/SkillMilkdownEditor.vue', '@/components/test/EffectTestStage.vue',
  // 2026-09-09 PRD 复核·G1（A19）：知识页签【检索测试】改原地弹窗后新引入，同样全桩
  '@/components/admin/KnowledgeSearchDialog.vue'
]) {
  vi.doMock(p, () => ({ default: { name: 'Stub', setup: () => () => h('div', { class: 'stub' }) } }))
}
// DrawerEditor 轻桩：仅在 visible 时渲染默认插槽 + footer，便于断言抽屉内容与尺寸。
vi.doMock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title', 'size', 'appendToBody'],
    setup: (props, { slots }) => () =>
      props.visible
        ? h('div', { class: 'drawer', 'data-title': props.title, 'data-size': props.size }, [slots.default?.(), h('div', { class: 'drawer-foot' }, slots.footer?.())])
        : null
  }
}))

const PositionDetailTabs = (await import('@/views/admin/PositionDetailTabs.vue')).default

// modelValue 落到 data-active 上：便于断言初始激活页签（#15 返回落点）
const elTabs = { name: 'el-tabs', props: ['modelValue'], template: '<div class="el-tabs" :data-active="modelValue"><slot /></div>' }
const elTabPane = { name: 'el-tab-pane', props: ['label', 'name'], template: '<div class="el-tab-pane" :data-label="label" :data-name="name"><slot /></div>' }
const passthrough = (t) => ({ name: t, template: `<div class="${t}"><slot /></div>` })

let app, container, vm
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  app = createApp(PositionDetailTabs)
  app.component('el-tabs', elTabs); app.component('el-tab-pane', elTabPane)
  for (const t of ['el-skeleton', 'el-empty', 'el-form', 'el-form-item', 'el-select', 'el-option',
    'el-switch', 'el-tag', 'el-icon', 'el-dialog', 'el-tooltip']) app.component(t, passthrough(t))
  app.component('el-button', {
    // 声明 emits：否则父层 @click 既被 $emit 触发又经 attrs 透传到根 <button> 原生 click，处理函数会跑两次
    name: 'el-button', props: ['disabled', 'type', 'link', 'size', 'loading'], emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  })
  app.component('el-input', {
    name: 'el-input', props: ['modelValue', 'maxlength', 'placeholder', 'type', 'rows'],
    template: '<input class="el-input" :maxlength="maxlength" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })
  app.component('el-checkbox', {
    name: 'el-checkbox', props: ['modelValue', 'disabled'],
    template: '<label class="el-checkbox" :data-checked="modelValue" :data-disabled="disabled"><input type="checkbox" :disabled="disabled" @change="$emit(\'change\')" /><slot /></label>'
  })
  // el-table 真渲行：本组要断言二维表的两级行（◆ / ·），故按 data 渲染列插槽。
  app.component('el-table', {
    name: 'el-table', props: ['data', 'emptyText'],
    provide() { return { tableRows: this.data } },
    template: '<div class="el-table"><slot /></div>'
  })
  app.component('el-table-column', {
    name: 'el-table-column', props: ['label', 'prop'], inject: ['tableRows'],
    setup(props, { slots }) {
      return function () {
        const rows = this.tableRows || []
        return h('div', { class: 'el-table-column', 'data-label': props.label },
          rows.map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default?.({ row }))))
      }
    }
  })
  app.directive('loading', {})
  vm = app.mount(container)
  await nextTick(); await Promise.resolve(); await nextTick()
  return container
}
const agentPane = () => [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'agents')
const col = (label) => [...agentPane().querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === label)

/* ---- DOM 驱动小工具（只走用户可见路径，不碰 <script setup> 内部绑定） ---- */
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
// 点某行「操作」列里文案匹配的按钮（rowIdx：0=Agent 行，1=其下技能行）
async function clickRowOp(rowIdx, text) {
  const cell = [...col('操作').querySelectorAll('.cell')][rowIdx]
  const btn = [...cell.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
  btn.click()
  await flush()
}
const clickAgentRowOp = clickRowOp
const clickSkillRowOp = clickRowOp
async function clickNewAgent() {
  const btn = [...agentPane().querySelectorAll('.pd-card-head .el-button')].find((b) => b.textContent.includes('新增 Agent'))
  btn.click()
  await flush()
}
// 抽屉里按 maxlength 定位输入框（64=Agent 名称，500=职责描述）
const drawerInput = (maxlength) =>
  [...container.querySelectorAll('.drawer .el-input')].find((i) => i.getAttribute('maxlength') === maxlength)
async function type(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}
async function clickDrawerFoot(text) {
  const btn = [...container.querySelectorAll('.drawer .drawer-foot .el-button')].find((b) => b.textContent.trim() === text)
  btn.click()
  await flush()
}
const skillBoxes = () => [...container.querySelectorAll('.drawer .el-checkbox')]
const checkedStates = () => skillBoxes().map((b) => b.getAttribute('data-checked') === 'true')
async function toggleBox(i) {
  // 直接派发 change：绕过 disabled 也能验证组件内的兜底闸
  skillBoxes()[i].querySelector('input').dispatchEvent(new Event('change'))
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 会清掉实现，逐用例复位默认候选（个别用例再自行改）
  listSkillsSpy.mockImplementation(defaultSkillList)
  store.addAgent.mockImplementation((p) => Promise.resolve({ agentId: 'ag_new', ...p, skills: [] }))
  store.patchAgent.mockResolvedValue({})
  store.assignSkillToAgent.mockResolvedValue({})
  store.detachSkillFromAgent.mockResolvedValue(undefined)
  store.load.mockResolvedValue()
  store.saveBasic.mockResolvedValue({ warnings: [] })
  routeMock.query = {}
  store.detail.pendingAction = null
  store.agents = defaultAgents()
  store.removeAgent.mockResolvedValue({})
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('Agent 与技能页签 · 二维表（4C #13）', () => {
  it('行维度两级：Agent 行 ◆ 前缀、技能行 · 前缀；分类是技能行的属性列不是独立层级', async () => {
    await mount()
    const nameCells = [...col('AGENT / 技能').querySelectorAll('.cell')].map((c) => c.textContent.trim())
    expect(nameCells).toEqual(['◆ 经营分析 Agent', '· 客户画像分析'])
    // 第二列在两级上承载不同语义：Agent 行=职责描述，技能行=分类标签
    const secondCol = [...col('职责描述 / 分类').querySelectorAll('.cell')].map((c) => c.textContent.trim())
    expect(secondCol[0]).toBe('汇总经营指标并识别异常')
    expect(secondCol[1]).not.toBe('')
  })

  it('表格包在卡片里：卡头含标题 + 弱色说明 + 【＋ 新增 Agent】', async () => {
    await mount()
    const head = agentPane().querySelector('.pd-card-head')
    expect(head).toBeTruthy()
    expect(head.textContent).toContain('Agent 与技能')
    expect(head.textContent).toContain('每个 Agent 是一组技能 · 主实例按职责描述委派子任务')
    expect(head.textContent).toContain('＋ 新增 Agent')
    // 表格确实在这张卡的卡体内
    expect(agentPane().querySelector('.pd-card .pd-card-body .el-table')).toBeTruthy()
  })

  it('Agent 行操作只剩【编辑】【删除】——原型 L4025 已删的【＋技能】不再出现', async () => {
    await mount()
    const opCells = [...col('操作').querySelectorAll('.cell')].map((c) => c.textContent)
    expect(opCells[0]).toContain('编辑')
    expect(opCells[0]).toContain('删除')
    expect(opCells[0]).not.toContain('＋技能')
    // 技能行：编辑 + 移除
    expect(opCells[1]).toContain('编辑')
    expect(opCells[1]).toContain('移除')
  })
})

describe('Agent 抽屉 · 新建/编辑同一抽屉 + 引用技能勾选（4C #14）', () => {
  it('点【＋ 新增 Agent】开 680px 抽屉，标题「新建 Agent」，含引用技能勾选区与计数', async () => {
    await mount()
    await clickNewAgent()
    const drawer = container.querySelector('.drawer')
    expect(drawer).toBeTruthy()
    expect(drawer.getAttribute('data-title')).toBe('新建 Agent')
    expect(drawer.getAttribute('data-size')).toBe('680px')
    expect(drawer.textContent).toContain('引用技能')
    expect(drawer.textContent).toContain(`已勾选：0/${LIMITS.SKILL_MAX}`)
    expect(listSkillsSpy).toHaveBeenCalled()
  })

  it('技能上限字面为 100（md §6.4 L354；09-08 裁决由 20 改 100）：常量 + 抽屉计数「已勾选：0/100」', async () => {
    expect(LIMITS.SKILL_MAX).toBe(100)
    await mount()
    await clickNewAgent()
    expect(container.querySelector('.drawer').textContent).toContain('已勾选：0/100')
  })

  it('编辑 Agent：抽屉回填名称/职责，并预勾该 Agent 已引用的技能', async () => {
    await mount()
    await clickAgentRowOp(0, '编辑')
    const drawer = container.querySelector('.drawer')
    expect(drawer.getAttribute('data-title')).toBe('编辑 Agent')
    expect(drawerInput('64').value).toBe('经营分析 Agent')
    expect(drawerInput('500').value).toBe('汇总经营指标并识别异常')
    // 已引用的 302 预勾（候选表里 300/301/302 三条，最后一条为已引用）
    expect(checkedStates()).toEqual([false, false, true])
    expect(drawer.textContent).toContain(`已勾选：1/${LIMITS.SKILL_MAX}`)
  })

  it('字段上限按 md §6.2：名称 64、职责描述 500（不取原型的 60/300）', async () => {
    await mount()
    await clickAgentRowOp(0, '编辑')
    const maxes = [...container.querySelectorAll('.drawer .el-input')].map((i) => i.getAttribute('maxlength'))
    expect(maxes).toContain('64')
    expect(maxes).toContain('500')
    expect(maxes).not.toContain('60')
    expect(maxes).not.toContain('300')
  })

  it('职责描述必填：留空不落库、给提示（md §6.2）', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    await clickNewAgent()
    await type(drawerInput('64'), '新 A')
    await clickDrawerFoot('新建')
    expect(store.addAgent).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写职责描述')
  })

  it('保存按勾选差集增量同步引用：新增走 assign、取消走 detach', async () => {
    await mount()
    await clickAgentRowOp(0, '编辑')
    await toggleBox(2) // 取消已引用的 302
    await toggleBox(0) // 新勾 300
    await clickDrawerFoot('保存')
    expect(store.patchAgent).toHaveBeenCalledWith('ag_1', { name: '经营分析 Agent', description: '汇总经营指标并识别异常' })
    expect(store.assignSkillToAgent).toHaveBeenCalledWith(300, 'ag_1')
    expect(store.detachSkillFromAgent).toHaveBeenCalledWith('ag_1', 302)
  })

  it('新建 Agent：先建再把勾选的技能挂到新 Agent 上', async () => {
    await mount()
    await clickNewAgent()
    await type(drawerInput('64'), '新 A')
    await type(drawerInput('500'), '职责')
    await toggleBox(1) // 勾 301
    await clickDrawerFoot('新建')
    expect(store.addAgent).toHaveBeenCalledWith(expect.objectContaining({ name: '新 A', description: '职责' }))
    expect(store.assignSkillToAgent).toHaveBeenCalledWith(301, 'ag_new')
  })

  it(`达 ${LIMITS.SKILL_MAX} 条上限：未勾选项置灰、再勾无效并提示（Q378）`, async () => {
    const { ElMessage } = await import('element-plus')
    // 候选给满 SKILL_MAX + 1 条，勾满前 SKILL_MAX 条后，剩下那条应置灰
    listSkillsSpy.mockImplementation(() => Promise.resolve({ list: skillFixture(LIMITS.SKILL_MAX + 1, 9000) }))
    await mount()
    await clickNewAgent()
    for (let i = 0; i < LIMITS.SKILL_MAX; i++) await toggleBox(i)
    expect(container.querySelector('.drawer').textContent).toContain(`已勾选：${LIMITS.SKILL_MAX}/${LIMITS.SKILL_MAX}`)
    const boxes = [...container.querySelectorAll('.drawer .el-checkbox')]
    // 已勾选的不置灰（可取消），未勾选的那条置灰
    expect(boxes[0].getAttribute('data-disabled')).toBe('false')
    expect(boxes[LIMITS.SKILL_MAX].getAttribute('data-disabled')).toBe('true')
    // 兜底闸：绕过 disabled 再勾一条不进 draft，给 md §6.4 文案
    await toggleBox(LIMITS.SKILL_MAX)
    expect(checkedStates().filter(Boolean).length).toBe(LIMITS.SKILL_MAX)
    // 文案钉字面（md §6.4 L354），常量改回 20 这里必须红
    expect(ElMessage.warning).toHaveBeenCalledWith('每个 Agent 最多引用 100 个技能')
    // 取消不受上限影响
    await toggleBox(0)
    expect(checkedStates().filter(Boolean).length).toBe(LIMITS.SKILL_MAX - 1)
  })
})

describe('Agent 增删改文案与上限（md 岗位 §6.1-§6.4；2026-09-12 审计 T53）', () => {
  it('Agent 已满 20 个 → 卡头按钮置灰且文案「已达 20 个上限」（md §6.1）', async () => {
    expect(LIMITS.AGENT_MAX).toBe(20)
    store.agents = Array.from({ length: 20 }, (_, i) => ({ agentId: `ag_${i}`, name: `Agent${i}`, description: `职责${i}`, skills: [] }))
    await mount()
    const btn = [...agentPane().querySelectorAll('.pd-card-head .el-button')].find((b) => b.textContent.includes('已达 20 个上限'))
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)
    expect(agentPane().querySelector('.pd-card-head').textContent).not.toContain('＋ 新增 Agent')
  })

  it('Agent 19 个 → 仍出【＋ 新增 Agent】可点（上限 20 为硬上限，未达即可建）', async () => {
    store.agents = Array.from({ length: 19 }, (_, i) => ({ agentId: `ag_${i}`, name: `Agent${i}`, description: `职责${i}`, skills: [] }))
    await mount()
    const btn = [...agentPane().querySelectorAll('.pd-card-head .el-button')].find((b) => b.textContent.includes('＋ 新增 Agent'))
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)
  })

  it('Agent 行【删除】→ 确认框逐字「删除该 Agent 后会解除其技能关联，技能本身不会被删除。确认删除？」+ 【确认删除】→ 删除后 toast「Agent 已删除」（md §6.3）', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    await mount()
    await clickAgentRowOp(0, '删除')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除该 Agent 后会解除其技能关联，技能本身不会被删除。确认删除？',
      '删除 Agent',
      expect.objectContaining({ confirmButtonText: '确认删除' })
    )
    expect(store.removeAgent).toHaveBeenCalledWith('ag_1')
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已删除')
  })

  it('Agent 行【删除】在确认框点取消 → 不删、无 toast', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    await clickAgentRowOp(0, '删除')
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(store.removeAgent).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('抽屉【保存】成功 → toast「Agent 已保存」且抽屉关闭（md §6.2）', async () => {
    const { ElMessage } = await import('element-plus')
    await mount()
    await clickAgentRowOp(0, '编辑')
    await clickDrawerFoot('保存')
    expect(ElMessage.success).toHaveBeenCalledWith('Agent 已保存')
    expect(container.querySelector('.drawer')).toBeNull()
  })

  it('技能行【移除】→ 确认框逐字「仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？」+ 【移除】→ detach 后 toast「已移除」（md §6.4）', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    await mount()
    await clickSkillRowOp(1, '移除')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？',
      '移除技能',
      expect.objectContaining({ confirmButtonText: '移除' })
    )
    expect(store.detachSkillFromAgent).toHaveBeenCalledWith('ag_1', 302)
    expect(ElMessage.success).toHaveBeenCalledWith('已移除')
  })
})

describe('技能整页编辑 · 同页跳转 + 返回回本页签（4C #15）', () => {
  it('技能行【编辑】= router.push（带来源岗位/页签），不再 window.open 开新标签', async () => {
    const openSpy = vi.fn()
    window.open = openSpy
    await mount()
    await clickSkillRowOp(1, '编辑')
    expect(openSpy).not.toHaveBeenCalled()
    expect(routerPushSpy).toHaveBeenCalledWith({
      name: 'AdminSkillEdit', params: { id: 302 }, query: { fromPosition: '5', fromTab: 'agents' }
    })
  })

  it('带 ?tab=agents 进入岗位详情时初始停在「Agent 与技能」页签（返回落点）', async () => {
    routeMock.query = { tab: 'agents' }
    await mount()
    // el-tabs 桩把 modelValue 落到 data-active：断言组件把初始激活页签定在 agents
    expect(container.querySelector('.el-tabs').getAttribute('data-active')).toBe('agents')
  })
})
