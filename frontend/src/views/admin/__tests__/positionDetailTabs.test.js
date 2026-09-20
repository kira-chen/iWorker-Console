// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

/**
 * PositionDetailTabs · 页签信息架构契约（对齐 md 岗位 §1.2 顶栏 / §1.3 页签；2026-09-12 审计 T26/T53 修头注、补顶栏用例）。
 *
 * - 页签集合：md §1.3 七页签（人格 / 采集字段 / 工作档案 / 知识 / Agent 与技能 / 自动化任务 / 业务系统）
 *   + demo 扩展「运行」「效果测试」两占位 = 9 个（2026-09-10 负责人选 C「9 页签全留」）；「版本」页签已删。
 *   md §1.3 页签 name `tasks`（2026-09-12 审计 J8③ 已由 `sampleTasks` 改齐），本组不钉 name。
 * - 人格页签为 md §2 六区块（岗位图标 / 岗位描述 / 领用页文案 / 示例问题 / 岗位 SOP / 岗位人格）。
 * - 知识页签不再是「开发中」占位（轻量列表 + 跳知识库模块）。
 * - 顶栏（md §1.2 L144-145）：已发布岗位显版本号 / 未发布不显；有未保存修改显「有未保存的修改」。
 * - 只读态（query.view=1）/ 审核中：顶部隐藏【保存】【发布岗位】。
 * 只钉页面这一层，不测子组件内部（全桩）。
 */

// reactive：顶栏脏检查 isDirty 是 computed，store.basic 被 patchBasic 整体替换后须能触发重算
const store = reactive({
  positionId: 5,
  loading: false,
  error: '',
  basic: { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', businessSystemIds: [], intakeSchema: [] },
  agents: [],
  allSkills: [],
  isPublished: false,
  detail: { positionId: 5, status: 'draft', pendingAction: null },
  checkInput: {},
  load: vi.fn(() => Promise.resolve()),
  reset: vi.fn(),
  saveBasic: vi.fn(() => Promise.resolve({ warnings: [] })),
  hydrate: vi.fn()
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), prompt: vi.fn() }
}))
// 路由 mock：query 可按用例改写（只读态用 view=1）
const routeMock = { params: { id: '5' }, query: {}, meta: {} }
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: () => {},
  // 2026-09-10：新增的业务系统页签经 api/admin → api/request → src/router 拖入真实 router 模块，
  // 整模块 mock 后需喂它能跑通的工厂（口径同 components/admin/__tests__/expertEditor.test.js）。
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  createWebHistory: () => ({})
}))
const listPublicationsSpy = vi.fn(() => Promise.resolve([]))
vi.mock('@/api/position', () => ({
  createPosition: vi.fn(), publishPosition: vi.fn(() => Promise.resolve({})), getNextVersionLabel: vi.fn(() => Promise.resolve('v1.0.0')), listPositionPublications: (...a) => listPublicationsSpy(...a)
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve([])) }))
// 2026-09-09 PRD 复核·G1（A1）：完整性校验第 6 项要自动化任务条数，详情页挂载即独立预取
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: vi.fn(() => Promise.resolve({ list: [] })) }))
// 知识页签只读列表（2026-09-04 新增）：懒加载，Tab 骨架测试给空列表即可
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn(() => Promise.resolve({ list: [], total: 0 })) }))
vi.mock('@/composables/useVersionPublish', () => ({
  useVersionPublish: () => ({ versionLabel: { value: '' }, releaseNotes: { value: '' }, prevMaxLabel: { value: '' }, versionAtMax: { value: false }, nextLabelLoading: { value: false }, primeNextLabel: vi.fn(), reset: vi.fn() })
}))
// featureFlags 局部 mock 必须与真实模块的导出保持一致，否则引用它的组件加载即报错。
// 2026-09-12 负责人决策 3（审计 J2）：FRONT_RUNTIME_ENABLED 随员工端整体退役删除，本 mock 同步去掉该键。
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false, MCP_AUTH_CONFIG_ENABLED: true }))

// 重组件/编辑器全桩（只关心 Tab 骨架）
for (const p of [
  '@/components/admin/AdminRail.vue', '@/components/StatusTag.vue', '@/components/ThemeToggle.vue',
  '@/components/position/PublishCheckDialog.vue',
  '@/components/position/PositionDataTableStage.vue',
  '@/components/position/PositionSampleTaskStage.vue', '@/components/position/ClaimNotesEditor.vue',
  '@/components/position/IconPickerPopover.vue',
  '@/components/position/SkillMilkdownEditor.vue', '@/components/test/EffectTestStage.vue',
  // 2026-09-09 PRD 复核·G1（A19）：知识页签【检索测试】改原地弹窗后新引入，同样全桩
  '@/components/admin/KnowledgeSearchDialog.vue',
  // 2026-09-15 连接器页签重构：PositionBusinessSystemTab 引入 McpEditor 等重组件，全桩避免拖入 featureFlags 副作用
  '@/components/position/PositionBusinessSystemTab.vue'
]) {
  vi.doMock(p, () => ({ default: { name: 'Stub', setup: () => () => h('div', { class: 'stub' }) } }))
}

const PositionDetailTabs = (await import('@/views/admin/PositionDetailTabs.vue')).default

// el-tabs / el-tab-pane 轻桩：渲染所有 pane 的 label + 内容（便于断言）
const elTabs = { name: 'el-tabs', props: ['modelValue'], template: '<div class="el-tabs"><slot /></div>' }
const elTabPane = { name: 'el-tab-pane', props: ['label', 'name'], template: '<div class="el-tab-pane" :data-label="label" :data-name="name"><slot /></div>' }
const passthrough = (t) => ({ name: t, template: `<div class="${t}"><slot /></div>` })

let app, container
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  app = createApp(PositionDetailTabs)
  app.component('el-tabs', elTabs); app.component('el-tab-pane', elTabPane)
  for (const t of ['el-button', 'el-skeleton', 'el-empty',
    'el-form', 'el-form-item', 'el-select', 'el-option', 'el-switch', 'el-tag', 'el-table',
    'el-icon', 'el-dialog', 'el-tooltip']) app.component(t, passthrough(t))
  // el-input 轻桩：透传 class + 能发 update:modelValue，顶栏岗位名就地编辑用它触发脏检查
  app.component('el-input', {
    name: 'el-input', props: ['modelValue', 'maxlength', 'placeholder', 'disabled'], emits: ['update:modelValue'],
    template: '<input class="el-input" :maxlength="maxlength" :placeholder="placeholder" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })
  // el-table-column 的 #default 是行作用域插槽（需 { row }）；本组测试只钉 Tab 骨架，不渲染行内容，
  // 故桩成不调用插槽的空节点——否则真组件会以 undefined 作用域触发 "Cannot destructure property 'row'"。
  app.component('el-table-column', { name: 'el-table-column', props: ['prop', 'label'], template: '<div class="el-table-column"></div>' })
  app.directive('loading', {})
  app.mount(container)
  await nextTick(); await Promise.resolve(); await nextTick()
  return container
}
beforeEach(() => {
  store.load.mockClear(); store.saveBasic.mockClear(); routeMock.query = {}; store.detail.pendingAction = null
  store.isPublished = false
  store.loading = false
  store.detail = { positionId: 5, status: 'draft', pendingAction: null }
  store.basic = { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', businessSystemIds: [], intakeSchema: [] }
  listPublicationsSpy.mockClear()
  listPublicationsSpy.mockImplementation(() => Promise.resolve([]))
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('PositionDetailTabs · 页签结构（md 岗位 §1.3 七页签，2026-09-15 连接器替换业务系统/运行/效果测试）', () => {
  // 页签集合的裁决沿革（改这条断言前先读完，它是历次裁决的载体）：
  // - 2026-09-09：移除「业务系统」与「版本」；「运行」「效果测试」保持空置占位。
  // - 2026-09-10 上午：负责人就页签数拍板「维持现状 8 个，页签数量上 html 原型不作准」。
  // - 2026-09-10 下午：业务系统页签带完整逻辑重新实现（引用/查看/排序，数据经
  //   store.basic.businessSystemIds 落库），负责人复核后裁决「**选 C · 9 页签全留**」。
  // - 2026-09-15 重构：「连接器」三区域页签取代「业务系统」，「运行」「效果测试」移除，共 7 页签。
  it('渲染 md §1.3 七页签（2026-09-15 连接器替换业务系统/运行/效果测试移除），label 与顺序正确', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.el-tab-pane')].map((p) => p.getAttribute('data-label'))
    expect(labels).toEqual(['人格', '采集字段', '工作档案', '知识', 'Agent 与技能', '自动化任务', '连接器'])
    expect(labels).not.toContain('版本')
  })

  it('「人格」Tab 含 md §2 七区块：岗位名称 / 岗位图标 / 岗位描述 / 领用页文案 / 示例问题 / 岗位 SOP / 岗位人格（2026-09-08 PRD-20260908 对齐：认领说明改名；岗位名称从顶栏移入）', async () => {
    await mount()
    const persona = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'persona')
    for (const sec of ['岗位名称', '岗位图标', '岗位描述', '领用页文案', '示例问题', '岗位 SOP', '岗位人格']) {
      expect(persona?.textContent).toContain(sec)
    }
    expect(persona?.textContent).not.toContain('岗位认领说明')
    expect(persona?.textContent).toContain('员工领用时看到的卖点，可多条，最多 6 条')
    expect(persona?.querySelector('.pd-desc-input')).toBeTruthy()
    // 示例问题为 3 格 + 区级【AI 生成】
    expect(persona?.querySelectorAll('.pd-eq-row').length).toBe(3)
    expect(persona?.textContent).toContain('AI 生成')
  })

  it('顶栏：「返回」+ 分隔 + 静态名称显示 + 保存/发布岗位；未改动时不显「有未保存的修改」', async () => {
    await mount()
    const top = container.querySelector('.topbar')
    expect(top.querySelector('.tb-back').textContent.trim()).toBe('← 返回')
    expect(top.querySelector('.tb-sep')).toBeTruthy()
    expect(top.querySelector('.tb-name-display')).toBeTruthy()
    expect(top.querySelector('.tb-name-input')).toBeFalsy()
    expect(top.textContent).toContain('保存')
    expect(top.textContent).toContain('发布岗位')
    expect(top.querySelector('.tb-dirty').textContent.trim()).toBe('')
    expect(store.saveBasic).not.toHaveBeenCalled()
  })

  it('人格Tab名称改动后 → 顶栏显「有未保存的修改」（md §1.2 L145）；未改动时隐藏', async () => {
    await mount()
    expect(container.querySelector('.tb-dirty').textContent.trim()).toBe('')
    // 岗位名称编辑框已移入人格Tab；直接改 store 触发 dirty 检测
    store.basic = { ...store.basic, name: '销售岗' }
    await nextTick(); await nextTick()
    expect(container.querySelector('.tb-dirty').textContent.trim()).toBe('有未保存的修改')
    expect(container.querySelector('.tb-dirty').classList.contains('on')).toBe(true)
  })

  it('已发布岗位 → 顶栏展示当前在架版本号（如 v2.1.0，md §1.2 L144）', async () => {
    store.isPublished = true
    store.detail = { positionId: 5, status: 'published', pendingAction: null }
    listPublicationsSpy.mockImplementation(() => Promise.resolve([
      { version: 2, versionLabel: 'v2.1.0', status: 'ACTIVE' },
      { version: 1, versionLabel: 'v2.0.0', status: 'DELISTED' }
    ]))
    await mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(listPublicationsSpy).toHaveBeenCalledWith(5)
    expect(container.querySelector('.tb-version')?.textContent.trim()).toBe('v2.1.0')
  })

  it('未发布岗位 → 顶栏不展示版本号（md §1.2 L144）', async () => {
    await mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(container.querySelector('.tb-version')).toBeNull()
  })

  // 待办 yuepu#12①：冷加载约 300ms 内 store.basic 仍为 null，此时点【保存】/【发布岗位】会在 ensurePersisted 里
  // 读 store.basic.name → TypeError（pageerror）。详情就绪前两个按钮须禁用，就绪后才可点。
  it('详情加载完成前（store.basic 为空）：顶栏【保存】【发布岗位】禁用；加载完成后可点', async () => {
    const topBtns = () => [...container.querySelectorAll('.topbar .tb-r .el-button')]
    const isDisabled = (b) => b.getAttribute('disabled') === 'true' || b.getAttribute('disabled') === ''
    store.basic = null
    store.loading = true
    await mount()
    expect(topBtns().map((b) => b.textContent.trim())).toEqual(['保存', '发布岗位'])
    expect(topBtns().every(isDisabled)).toBe(true)

    store.basic = { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', businessSystemIds: [], intakeSchema: [] }
    store.loading = false
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(topBtns().some(isDisabled)).toBe(false)
  })

  it('只读态（query.view=1，列表【查看】进入）：顶部隐藏【保存】【发布岗位】', async () => {
    routeMock.query = { view: '1' }
    await mount()
    const top = container.querySelector('.topbar')
    expect(top.textContent).not.toContain('保存')
    expect(top.textContent).not.toContain('发布岗位')
  })

  it('审核中（detail.pendingAction 非空）：同样隐藏【保存】【发布岗位】', async () => {
    store.detail.pendingAction = 'PUBLISH'
    await mount()
    const top = container.querySelector('.topbar')
    expect(top.textContent).not.toContain('保存')
    expect(top.textContent).not.toContain('发布岗位')
  })

  it('「知识」为只读列表（区块头 + 工具栏【查询】，无新建 / 编辑入口，md §5.2 已删）', async () => {
    await mount()
    const paneText = (name) => [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === name)?.textContent || ''
    expect(paneText('knowledge')).not.toContain('开发中')
    expect(paneText('knowledge')).toContain('该岗位可见范围内的知识库')
    expect(paneText('knowledge')).toContain('查询')
    expect(paneText('knowledge')).not.toContain('新建知识库')
  })

  // 「运行」「效果测试」页签已于 2026-09-15 移除

  it('「连接器」页签渲染（PositionBusinessSystemTab 已桩）；「运行」「效果测试」页签不再存在', async () => {
    await mount()
    const panes = [...container.querySelectorAll('.el-tab-pane')]
    expect(panes.find((p) => p.getAttribute('data-name') === 'businessSystems')).toBeTruthy()
    expect(panes.find((p) => p.getAttribute('data-name') === 'runtime')).toBeUndefined()
    expect(panes.find((p) => p.getAttribute('data-name') === 'effectTest')).toBeUndefined()
  })
})
