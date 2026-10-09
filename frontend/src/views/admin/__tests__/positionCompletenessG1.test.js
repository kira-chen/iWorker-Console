// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, computed, provide, inject } from 'vue'

/**
 * 岗位详情 · md §9.1 完整性校验（2026-09-09 PRD 复核·G1 / A1，负责人 Q11 新决策）行为契约。
 *
 * 决策原文：「岗位详情页的必填项有①人格页面的必填字段必须要填；②Agent与技能必须要有；
 * ③自动化任务至少要有1个；在『保存』和『提交发布』时都要进行完整性校验。」
 * 二轮补充确认走 B 方案 —— 保存时只提示不拦，提交发布时才硬拦。
 *
 * 本组钉三件事：
 *  ① 【发布岗位】九项任一缺失 → 不开发布弹窗、toast「请先填写：…」、自动切到第一个缺失项所在页签；
 *  ② 【保存】执行同一套九项校验但**不阻断**：保存照常完成，顶部提示条列出未完成项（可关、可点跳页签）；
 *  ③ 九项齐备时保存不出提示条、发布放行到发布前检查弹窗。
 *
 * 2026-10-09 /test-audit 补缺口 E3（岗位 PRD §8 / §9.1「被强制回收」）：页面用 revokedConnectorNames(store.basic) 实时取值喂发布前检查，
 *  引用了已回收的连接器 / 技能 → 清单里出阻断行「引用的「X」已被回收，请移除后再发布」（见文末 describe）。
 *
 * 另钉 A19（Q455）：知识页签【检索测试】原地开弹窗、不 router.push。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §8.1–§8.3 / §9.1 第 5 项补：
 *  - 【保存】载荷带连接器页签三份引用清单 connectorMcpIds / connectorApiIds / businessSystemIds（yuepu#7①④ 回归）；
 *  - 第 5 项「示例问题」缺一条 → 阻断、toast 点名「3 条示例问题」、切人格页签，且空着的那一格标红（pd-eq-err）。
 */

import { ElMessage } from 'element-plus'
import { passthrough, elTabs, elTabPane } from './helpers/commonStubs'
import { forceRevokeMcpService, __resetMcpMock } from '@/api/mcpConnectorMock'
import { resetAccessAuditMock } from '@/api/accessAuditMock'

const basicFull = () => ({
  positionId: 5, name: '销售', icon: '▤', status: 'draft', persona: '',
  claimDesc: [], claimDescriptions: ['自动汇总经营数据'],
  exampleQuestions: ['q1', 'q2', 'q3'],
  description: '负责销售线索跟进', positionSop: '1. 理解意图',
  businessSystemIds: [], intakeSchema: [{ label: '负责区域', key: 'region', type: 'text', required: true, options: [] }]
})
const agentsFull = () => [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [{ skillId: 1, name: 's' }] }]

const store = {
  positionId: 5,
  loading: false,
  error: '',
  basic: basicFull(),
  agents: agentsFull(),
  allSkills: [],
  isPublished: false,
  detail: { positionId: 5, status: 'draft', pendingAction: null },
  get checkInput() {
    return {
      name: this.basic.name, icon: this.basic.icon, description: this.basic.description, claimDescriptions: this.basic.claimDescriptions, positionSop: this.basic.positionSop,
      exampleQuestions: this.basic.exampleQuestions, intakeSchema: this.basic.intakeSchema, agents: this.agents
    }
  },
  load: vi.fn(() => Promise.resolve()),
  reset: vi.fn(),
  saveBasic: vi.fn(() => Promise.resolve({ warnings: [] })),
  hydrate: vi.fn()
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
const getNextVersionLabelSpy = vi.fn(() => Promise.resolve('v1.0.0'))
vi.mock('@/api/position', () => ({
  createPosition: vi.fn(), publishPosition: vi.fn(() => Promise.resolve({})),
  getNextVersionLabel: (...a) => getNextVersionLabelSpy(...a),
  listPositionPublications: vi.fn(() => Promise.resolve([])),
  listSkills: vi.fn(() => Promise.resolve({ list: [] }))
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve([])) }))
// 自动化任务条数：md §9.1 第 9 条的入参，详情页挂载即独立预取（不依赖是否访问过该页签）
const listSampleTasksSpy = vi.fn(() => Promise.resolve({ list: [{ id: 1 }] }))
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: (...a) => listSampleTasksSpy(...a) }))
// 知识页签一条已发布知识库，供 A19【检索测试】用例点
vi.mock('@/api/knowledgeBase', () => ({
  // scopeRefId 与本文件其它 positionId:5 的夹具同源（2026-09-23 待办 yuepu#9④：知识页签改按
  // scopeRefId 联查岗位 id，不再按 scopeRefName 字符串匹配岗位名）
  listKnowledgeBases: vi.fn(() => Promise.resolve({ list: [{ id: 'kb_1', name: '销售知识库', scopeRefId: 5, scopeRefName: '销售', status: 'PUBLISHED' }], total: 1 }))
}))
vi.mock('@/composables/useVersionPublish', () => ({
  useVersionPublish: () => ({
    versionLabel: { value: 'v1.0.0' }, releaseNotes: { value: '' }, atMax: { value: false },
    nextLoading: { value: false }, bump: { value: 'NONE' }, firstPublish: { value: true },
    setBump: vi.fn(), load: vi.fn()
  })
}))
// featureFlags 局部 mock 必须与真实模块的导出保持一致，否则引用它的组件加载即报错。
// 2026-09-12 负责人决策 3（审计 J2）：FRONT_RUNTIME_ENABLED 随员工端整体退役删除，本 mock 同步去掉该键。
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false, MCP_AUTH_CONFIG_ENABLED: true }))

for (const p of [
  '@/components/admin/AdminRail.vue', '@/components/StatusTag.vue', '@/components/ThemeToggle.vue',
  '@/components/position/PositionDataTableStage.vue',
  '@/components/position/PositionSampleTaskStage.vue', '@/components/position/ClaimNotesEditor.vue',
  '@/components/position/IconPickerPopover.vue',
  '@/components/position/SkillMilkdownEditor.vue', '@/components/test/EffectTestStage.vue'
]) {
  vi.doMock(p, () => ({ default: { name: 'Stub', setup: () => () => h('div', { class: 'stub' }) } }))
}
// 发布前检查弹窗 / 检索测试弹窗：桩成「仅 visible 时渲染」的探针，便于断言开没开
const visProbe = (cls, prop) => ({
  default: {
    name: cls, props: [prop, 'kb', 'check', 'positionName'],
    // 带 check 的探针把清单每行的 detail 渲成 <p class="probe-item">，便于断言发布前检查里出了哪些行
    setup: (props) => () => (props[prop]
      ? h('div', { class: cls }, (props.check?.items || []).map((i) => h('p', { class: 'probe-item', 'data-ok': String(i.ok) }, i.detail)))
      : null)
  }
})
vi.doMock('@/components/position/PublishCheckDialog.vue', () => visProbe('publish-check-dialog', 'visible'))
vi.doMock('@/components/admin/KnowledgeSearchDialog.vue', () => visProbe('kb-search-dialog', 'visible'))

const PositionDetailTabs = (await import('@/views/admin/PositionDetailTabs.vue')).default


let app, container
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  app = createApp(PositionDetailTabs)
  app.component('el-tabs', elTabs); app.component('el-tab-pane', elTabPane)
  for (const t of ['el-skeleton', 'el-empty', 'el-form', 'el-form-item', 'el-select', 'el-option',
    'el-switch', 'el-tag', 'el-icon', 'el-dialog', 'el-tooltip', 'el-checkbox']) app.component(t, passthrough(t))
  app.component('el-button', {
    name: 'el-button', props: ['disabled', 'type', 'link', 'size', 'loading'], emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  })
  app.component('el-input', {
    name: 'el-input', props: ['modelValue', 'maxlength', 'placeholder', 'type', 'rows'],
    template: '<input class="el-input" :maxlength="maxlength" :placeholder="placeholder" :value="modelValue" />'
  })
  // el-table 真渲行：provide 一个 computed（而非快照数组），否则异步到达的行渲染不出来。
  app.component('el-table', {
    name: 'el-table', props: ['data', 'emptyText'],
    setup(props, { slots }) {
      provide('tableRows', computed(() => props.data || []))
      return () => h('div', { class: 'el-table' }, slots.default?.())
    }
  })
  app.component('el-table-column', {
    name: 'el-table-column', props: ['label', 'prop'],
    setup(props, { slots }) {
      const rows = inject('tableRows')
      return () => h('div', { class: 'el-table-column', 'data-label': props.label },
        (rows?.value || []).map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default?.({ row }))))
    }
  })
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }

const topBtn = (text) => [...container.querySelectorAll('.topbar .el-button')].find((b) => b.textContent.trim() === text)
const clickTop = async (text) => { topBtn(text).click(); await flush() }
const banner = () => container.querySelector('.pd-complete-banner')
const activeTab = () => container.querySelector('.el-tabs').getAttribute('data-active')
const lastWarn = () => ElMessage.warning.mock.calls.at(-1)?.[0] || ''

beforeEach(() => {
  vi.clearAllMocks()
  store.basic = basicFull()
  store.agents = agentsFull()
  store.load.mockResolvedValue()
  store.saveBasic.mockResolvedValue({ warnings: [] })
  listSampleTasksSpy.mockResolvedValue({ list: [{ id: 1 }] })
  routeMock.query = {}
  store.detail.pendingAction = null
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('A1 · 【发布岗位】按 md §9.1 九项硬阻断', () => {
  it('九项齐备 → 放行到发布前检查弹窗，无 toast', async () => {
    await mount()
    expect(banner()).toBeNull()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeTruthy()
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('发布前自动保存被采集字段校验拦下（key 重复）→ 不开发布弹窗、不发保存请求、toast 提示并切到采集字段页签（2026-09-18 待办 yuepu#13·岗位 P3：此前静默失败照样弹发布窗）', async () => {
    store.basic.intakeSchema = [
      { label: '区域', key: 'region', type: 'text', required: true, options: [] },
      { label: '大区', key: 'region', type: 'text', required: false, options: [] }
    ]
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(store.saveBasic).not.toHaveBeenCalled()
    expect(lastWarn()).toBe('采集字段有误，请修正后再发布')
    expect(activeTab()).toBe('intake')
  })

  it('发布前自动保存请求失败 → 不开发布弹窗，toast 提示保存失败（发布的会是上次落库的旧内容）', async () => {
    store.saveBasic.mockRejectedValueOnce(new Error('网络异常'))
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(ElMessage.error).toHaveBeenCalledWith('岗位配置保存失败，请稍后重试后再发布')
  })

  it('缺人格必填项 → 阻断、不开弹窗、toast 点名缺项、定位人格页签', async () => {
    store.basic.description = ''
    store.basic.positionSop = '  '
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：岗位描述、岗位 SOP')
    expect(activeTab()).toBe('persona')
  })

  it('第 2 项：岗位图标为空 → 阻断、不开弹窗、toast 点名、定位人格页签（2026-09-21 负责人拍板必填）', async () => {
    store.basic.icon = ''
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：岗位图标')
    expect(activeTab()).toBe('persona')
  })

  it('第 4 项：领用页文案为空 → 阻断、不开弹窗、toast 点名、定位人格页签（2026-09-21 负责人拍板必填）', async () => {
    store.basic.claimDescriptions = []
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：领用页文案')
    expect(activeTab()).toBe('persona')
  })

  it('第 5 项：3 条示例问题缺第 2 条 → 阻断、不开弹窗、toast 点名「3 条示例问题」、定位人格页签', async () => {
    store.basic.exampleQuestions = ['q1', '', 'q3']
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toContain('3 条示例问题')
    expect(lastWarn()).toBe('请先填写：3 条示例问题')
    expect(activeTab()).toBe('persona')
  })

  it('第 5 项阻断后 → 人格页签里空着的那格示例问题标红（pd-eq-err），已填的两格不标', async () => {
    store.basic.exampleQuestions = ['q1', '', 'q3']
    await mount()
    const eqInputs = () => [...container.querySelectorAll('.pd-eq-row .el-input')]
    expect(eqInputs()).toHaveLength(3)
    expect(eqInputs().some((i) => i.classList.contains('pd-eq-err'))).toBe(false) // 发布前不标红
    await clickTop('发布岗位')
    expect(eqInputs().map((i) => i.classList.contains('pd-eq-err'))).toEqual([false, true, false])
  })

  it('第 7 项：采集字段为空 → 阻断、不开弹窗、toast 点名、定位「采集字段」页签（2026-09-21 负责人拍板必填至少 1 个，原不参与阻断）', async () => {
    store.basic.intakeSchema = []
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：采集字段')
    expect(activeTab()).toBe('intake')
  })

  it('第 8 项：无 Agent / Agent 无技能 → 阻断并定位「Agent 与技能」页签', async () => {
    store.agents = [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [] }]
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：Agent 与技能')
    expect(activeTab()).toBe('agents')
  })

  it('第 9 项：自动化任务 0 条 → 阻断并定位「自动化任务」页签', async () => {
    listSampleTasksSpy.mockResolvedValue({ list: [] })
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeNull()
    expect(lastWarn()).toBe('请先填写：自动化任务')
    expect(activeTab()).toBe('tasks')
  })

  it('多项缺失 → toast 按 md 列举顺序全列，定位到第一个缺失项所在页签', async () => {
    store.basic.name = ''
    store.agents = []
    listSampleTasksSpy.mockResolvedValue({ list: [] })
    await mount()
    await clickTop('发布岗位')
    expect(lastWarn()).toBe('请先填写：岗位名称、Agent 与技能、自动化任务')
    expect(activeTab()).toBe('persona')
  })
})

describe('A1 · 【保存】执行同一套校验但不阻断（md §9.1 末段提示条）', () => {
  it('有未完成项 → 保存照常完成 + 顶部提示条列出未完成项（不阻断、不 toast 阻断语）', async () => {
    store.basic.positionSop = ''
    listSampleTasksSpy.mockResolvedValue({ list: [] })
    await mount()
    expect(banner()).toBeNull() // 保存前不打扰
    await clickTop('保存')
    expect(store.saveBasic).toHaveBeenCalledTimes(1) // 一次点击只保存一次（el-button 桩已声明 emits）
    expect(ElMessage.success).toHaveBeenCalledWith('岗位配置已保存')
    const b = banner()
    expect(b).toBeTruthy()
    expect(b.textContent).toContain('尚未完成')
    expect(b.textContent).toContain('岗位 SOP')
    expect(b.textContent).toContain('自动化任务')
    expect(b.textContent).not.toContain('岗位名称')
  })

  it('提示条条目可点跳到该项所在页签；× 可关闭', async () => {
    store.agents = []
    await mount()
    await clickTop('保存')
    const item = banner().querySelector('.pd-cb-item')
    expect(item.textContent).toBe('Agent 与技能')
    item.click(); await flush()
    expect(activeTab()).toBe('agents')
    banner().querySelector('.pd-cb-close').click(); await flush()
    expect(banner()).toBeNull()
  })

  it('【保存】载荷带上连接器页签的三份引用清单：岗位私有 MCP / API / 业务系统（md §8.1–§8.3；yuepu#7①④ 回归，此前保存即丢）', async () => {
    store.basic.connectorMcpIds = ['expense_mcp']
    store.basic.connectorApiIds = ['api_1101', 'api_1102']
    store.basic.businessSystemIds = ['biz_2101']
    await mount()
    await clickTop('保存')
    expect(store.saveBasic).toHaveBeenCalledTimes(1)
    expect(store.saveBasic).toHaveBeenCalledWith(expect.objectContaining({
      connectorMcpIds: ['expense_mcp'],
      connectorApiIds: ['api_1101', 'api_1102'],
      businessSystemIds: ['biz_2101']
    }))
    expect(ElMessage.success).toHaveBeenCalledWith('岗位配置已保存')
  })

  it('九项齐备保存 → 不出提示条', async () => {
    await mount()
    await clickTop('保存')
    expect(store.saveBasic).toHaveBeenCalled()
    expect(banner()).toBeNull()
  })

  it('只读态不出提示条（无保存/发布入口）', async () => {
    routeMock.query = { view: '1' }
    store.basic.positionSop = ''
    await mount()
    expect(topBtn('保存')).toBeUndefined()
    expect(banner()).toBeNull()
  })
})

describe('A19 · 知识页签【检索测试】原地弹窗（md §5.2 / Q455）', () => {
  // 知识页签为懒加载（首次切到该页签才拉列表），故用例先把 activeTab 切过去。
  const kbOpBtn = (text) => {
    const pane = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'knowledge')
    const opCol = [...pane.querySelectorAll('.el-table-column')].find((c) => c.getAttribute('data-label') === '操作')
    return [...(opCol?.querySelectorAll('.el-button') || [])].find((b) => b.textContent.trim() === text)
  }
  // 切页签：走「保存后提示条条目点击」以外的通用路径——直接点某个未完成项不合适，
  // 这里用 el-tabs 桩的 modelValue 无法反向驱动，故借 A1 的定位副作用：清空 Agent 后点发布即切到 agents，
  // 再清空条件已不适用；改为直接触发组件内 watch —— 用最朴素的办法：让发布阻断定位到 knowledge 不可行，
  // 因此本组通过「先渲染再手动 dispatch」不可达。改用 route.query.tab 指定初始页签（组件支持）。
  async function mountOnKnowledge() {
    routeMock.query = { tab: 'knowledge' }
    await mount()
    await flush(); await flush()
  }

  it('【检索测试】就地开 KnowledgeSearchDialog，不跳模块', async () => {
    await mountOnKnowledge()
    expect(container.querySelector('.kb-search-dialog')).toBeNull()
    kbOpBtn('检索测试').click()
    await flush()
    expect(container.querySelector('.kb-search-dialog')).toBeTruthy()
    expect(routerPushSpy).not.toHaveBeenCalled()
  })

  it('【查看】跳知识库模块并带深链打开查看抽屉（md §5.2 / §11）：name=AdminKnowledgeBase，query 带 action=view + kbId + 岗位上下文', async () => {
    await mountOnKnowledge()
    kbOpBtn('查看').click()
    await flush()
    expect(routerPushSpy).toHaveBeenCalledTimes(1)
    expect(routerPushSpy).toHaveBeenCalledWith({
      name: 'AdminKnowledgeBase',
      query: { tab: 'kb', action: 'view', kbId: 'kb_1', positionId: '5', positionName: '销售' }
    })
    expect(container.querySelector('.kb-search-dialog')).toBeNull()
  })
})

describe('E3 · 发布前检查：引用了已被强制回收的对象 → 阻断行（岗位 PRD §8 / §9.1）', () => {
  afterEach(() => { __resetMcpMock(); resetAccessAuditMock() })
  const probeRows = () => [...container.querySelectorAll('.publish-check-dialog .probe-item')]
  const revokedRows = () => probeRows().filter((p) => p.textContent.includes('已被回收'))

  it('岗位引用的 MCP 已被强制回收 → 点【发布岗位】弹出的检查清单里出「引用的「X」已被回收，请移除后再发布」且为未通过', async () => {
    store.basic = { ...basicFull(), connectorMcpIds: ['expense_mcp'] }
    await forceRevokeMcpService('expense_mcp', '凭据泄露')
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeTruthy()
    const rows = revokedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/^引用的「.+」已被回收，请移除后再发布$/)
    expect(rows[0].getAttribute('data-ok')).toBe('false')
  })

  it('岗位引用的 MCP 未被回收 → 清单里没有「已被回收」行', async () => {
    store.basic = { ...basicFull(), connectorMcpIds: ['expense_mcp'] }
    await mount()
    await clickTop('发布岗位')
    expect(container.querySelector('.publish-check-dialog')).toBeTruthy()
    expect(revokedRows()).toHaveLength(0)
  })

  it('Agent 下的技能带回收标记 → 清单里同样出「引用的「技能名」已被回收，请移除后再发布」', async () => {
    store.agents = [{ agentId: 'ag_1', name: 'A', description: 'd', skills: [
      { skillId: 1, name: '日报周报生成', revoked: { reason: '风险', at: '2026-09-30 10:00', operator: 'admin' } }
    ] }]
    await mount()
    await clickTop('发布岗位')
    const rows = revokedRows()
    expect(rows.map((p) => p.textContent)).toEqual(['引用的「日报周报生成」已被回收，请移除后再发布'])
  })
})
