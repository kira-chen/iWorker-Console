// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * PositionDetailTabs · 页签信息架构契约。
 *
 * 2026-09-04 PRD-20260903 对齐重写（原 9-Tab 断言过时）：
 * - 新 PRD 七页签序：人格 / 采集字段 / 工作档案 / 知识 / Agent 与技能 / 自动化任务 / 业务系统；
 *   其后保留 demo 既有扩展页签 运行 / 效果测试 / 版本（版本=Q2 冻结）。
 * - 人格页签为 md 三.2 六区块（岗位描述 / 岗位图标 / 岗位认领说明 / 示例问题 / 岗位 SOP / 岗位人格）。
 * - 知识页签不再是「开发中」占位（轻量列表 + 跳知识库模块）。
 * - 只读态（query.view=1）：顶部隐藏【保存】【发布岗位】。
 * 只钉页面这一层，不测子组件内部（全桩）。
 */

const store = {
  positionId: 5,
  loading: false,
  error: '',
  basic: { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', businessSystemIds: [], intakeSchema: [], recommendedQuestions: ['', '', '', ''] },
  agents: [],
  allSkills: [],
  isPublished: false,
  detail: { positionId: 5, status: 'draft', pendingAction: null },
  checkInput: {},
  load: vi.fn(() => Promise.resolve()),
  reset: vi.fn(),
  saveBasic: vi.fn(() => Promise.resolve({ warnings: [] })),
  hydrate: vi.fn()
}
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
  onBeforeRouteLeave: () => {}
}))
vi.mock('@/api/position', () => ({
  createPosition: vi.fn(), publishPosition: vi.fn(() => Promise.resolve({})), getNextVersionLabel: vi.fn(() => Promise.resolve('v1.0.0')), listPositionPublications: vi.fn(() => Promise.resolve([]))
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve([])) }))
// 知识页签只读列表（2026-09-04 新增）：懒加载，Tab 骨架测试给空列表即可
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn(() => Promise.resolve({ list: [], total: 0 })) }))
vi.mock('@/composables/useVersionPublish', () => ({
  useVersionPublish: () => ({ versionLabel: { value: '' }, releaseNotes: { value: '' }, prevMaxLabel: { value: '' }, versionAtMax: { value: false }, nextLabelLoading: { value: false }, primeNextLabel: vi.fn(), reset: vi.fn() })
}))
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false }))

// 重组件/编辑器全桩（只关心 Tab 骨架）
for (const p of [
  '@/components/admin/AdminRail.vue', '@/components/StatusTag.vue', '@/components/ThemeToggle.vue',
  '@/components/position/SkillPickerDialog.vue', '@/components/position/PublishCheckDialog.vue',
  '@/components/position/PositionVersionHistoryDialog.vue', '@/components/position/PositionDataTableStage.vue',
  '@/components/position/PositionSampleTaskStage.vue', '@/components/position/ClaimNotesEditor.vue',
  '@/components/position/IconPickerPopover.vue', '@/components/position/PositionBizSystemsPane.vue',
  '@/components/position/SkillMilkdownEditor.vue', '@/components/test/EffectTestStage.vue'
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
  for (const t of ['el-button', 'el-input', 'el-skeleton', 'el-empty',
    'el-form', 'el-form-item', 'el-select', 'el-option', 'el-switch', 'el-tag', 'el-table',
    'el-icon', 'el-dialog', 'el-tooltip']) app.component(t, passthrough(t))
  // el-table-column 的 #default 是行作用域插槽（需 { row }）；本组测试只钉 Tab 骨架，不渲染行内容，
  // 故桩成不调用插槽的空节点——否则真组件会以 undefined 作用域触发 "Cannot destructure property 'row'"。
  app.component('el-table-column', { name: 'el-table-column', props: ['prop', 'label'], template: '<div class="el-table-column"></div>' })
  app.directive('loading', {})
  app.mount(container)
  await nextTick(); await Promise.resolve(); await nextTick()
  return container
}
beforeEach(() => { store.load.mockClear(); store.saveBasic.mockClear(); routeMock.query = {}; store.detail.pendingAction = null })
afterEach(() => { app?.unmount(); container?.remove() })

describe('PositionDetailTabs · 页签结构（2026-09-04 PRD-20260903 对齐）', () => {
  it('渲染新 PRD 七页签 + demo 扩展三页签，label 与顺序正确', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.el-tab-pane')].map((p) => p.getAttribute('data-label'))
    expect(labels).toEqual(['人格', '采集字段', '工作档案', '知识', 'Agent 与技能', '自动化任务', '业务系统', '运行', '效果测试', '版本'])
  })

  it('「人格」Tab 含 md 三.2 六区块：岗位描述 / 岗位图标 / 岗位认领说明 / 示例问题 / 岗位 SOP / 岗位人格', async () => {
    await mount()
    const persona = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'persona')
    for (const sec of ['岗位描述', '岗位图标', '岗位认领说明', '示例问题', '岗位 SOP', '岗位人格']) {
      expect(persona?.textContent).toContain(sec)
    }
    expect(persona?.querySelector('.pd-desc-input')).toBeTruthy()
    // 示例问题为 3 格 + 区级【AI 生成】
    expect(persona?.querySelectorAll('.pd-eq-row').length).toBe(3)
    expect(persona?.textContent).toContain('AI 生成')
  })

  it('顶栏：「返回」+ 分隔 + 可编辑名称 + 保存/发布岗位；未改动时不显「有未保存的修改」', async () => {
    await mount()
    const top = container.querySelector('.topbar')
    expect(top.querySelector('.tb-back').textContent.trim()).toBe('← 返回')
    expect(top.querySelector('.tb-sep')).toBeTruthy()
    expect(top.querySelector('.tb-name-input')).toBeTruthy()
    expect(top.textContent).toContain('保存')
    expect(top.textContent).toContain('发布岗位')
    expect(top.querySelector('.tb-dirty').textContent.trim()).toBe('')
    expect(store.saveBasic).not.toHaveBeenCalled()
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

  it('「知识」不再是开发中占位（轻量列表 + 新建知识库入口）；「运行」仍为占位', async () => {
    await mount()
    const paneText = (name) => [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === name)?.textContent || ''
    expect(paneText('knowledge')).not.toContain('开发中')
    expect(paneText('knowledge')).toContain('新建知识库')
    expect(paneText('runtime')).toContain('开发中')
  })

  it('「业务系统」页签挂载引用面板（PositionBizSystemsPane，桩渲染）', async () => {
    await mount()
    const biz = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'bizSystems')
    expect(biz?.querySelector('.stub')).toBeTruthy()
  })

  it('效果测试在 EFFECT_TEST_ENABLED=false 时显「开发中」占位（不擅自开启被关链路）', async () => {
    await mount()
    const et = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'effectTest')
    expect(et?.textContent).toContain('开发中')
  })
})
