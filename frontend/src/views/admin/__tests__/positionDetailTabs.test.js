// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * PositionDetailTabs · 9-Tab 信息架构契约（2026-08-22 白板→Tab 改造）。
 * 只钉页面这一层：9 个 sheet 页都在、label 正确；未实现的「知识 / 运行」显「开发中」占位；
 * 已有功能 Tab 内联了对应编辑器/组件（非弹窗入口）。不测子组件内部（全桩）。
 */

const store = {
  positionId: 5,
  loading: false,
  error: '',
  basic: { positionId: 5, name: '销售', status: 'draft', persona: '', claimDesc: [], intakeSchema: [], recommendedQuestions: ['', '', '', ''] },
  agents: [],
  allSkills: [],
  isPublished: false,
  detail: { positionId: 5, status: 'draft' },
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
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '5' }, query: {}, meta: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: () => {}
}))
vi.mock('@/api/position', () => ({
  createPosition: vi.fn(), publishPosition: vi.fn(() => Promise.resolve({})), getNextVersionLabel: vi.fn(() => Promise.resolve('v1.0.0')), listPositionPublications: vi.fn(() => Promise.resolve([]))
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve([])) }))
vi.mock('@/composables/useVersionPublish', () => ({
  useVersionPublish: () => ({ versionLabel: { value: '' }, releaseNotes: { value: '' }, prevMaxLabel: { value: '' }, versionAtMax: { value: false }, nextLabelLoading: { value: false }, primeNextLabel: vi.fn(), reset: vi.fn() })
}))
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false }))

// 重组件/编辑器全桩（只关心 Tab 骨架）
for (const p of [
  '@/components/admin/AdminRail.vue', '@/components/StatusTag.vue', '@/components/ThemeToggle.vue',
  '@/components/position/PositionIdentityCard.vue', '@/components/position/AgentLane.vue',
  '@/components/position/SkillPickerDialog.vue', '@/components/position/PersonaEditDialog.vue',
  '@/components/position/IntakeEditDialog.vue', '@/components/position/PublishCheckDialog.vue',
  '@/components/position/PositionVersionHistoryDialog.vue', '@/components/position/PositionDataTableStage.vue',
  '@/components/position/PositionSampleTaskStage.vue', '@/components/position/ClaimDescEditor.vue',
  '@/components/position/RecommendedQuestionsEditor.vue', '@/components/position/SkillMilkdownEditor.vue',
  '@/components/position/IntakeFieldEditor.vue', '@/components/test/EffectTestStage.vue'
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
    'el-form', 'el-form-item', 'el-select', 'el-option', 'el-switch', 'el-tag', 'el-table']) app.component(t, passthrough(t))
  // el-table-column 的 #default 是行作用域插槽（需 { row }）；本组测试只钉 Tab 骨架，不渲染行内容，
  // 故桩成不调用插槽的空节点——否则真组件会以 undefined 作用域触发 "Cannot destructure property 'row'"。
  app.component('el-table-column', { name: 'el-table-column', props: ['prop', 'label'], template: '<div class="el-table-column"></div>' })
  app.directive('loading', {})
  app.mount(container)
  await nextTick(); await Promise.resolve(); await nextTick()
  return container
}
beforeEach(() => { store.load.mockClear() })
afterEach(() => { app?.unmount(); container?.remove() })

describe('PositionDetailTabs · 9-Tab 结构', () => {
  it('渲染全部 9 个 sheet 页，label 与顺序正确', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.el-tab-pane')].map((p) => p.getAttribute('data-label'))
    expect(labels).toEqual(['人格', '采集字段', '工作档案', '知识', 'Agent 与技能', '自动化任务', '运行', '版本', '效果测试'])
  })

  it('「人格」Tab 内联「岗位描述」编辑分区（2026-08-26 开放 expert.description 后台编辑入口）', async () => {
    await mount()
    const persona = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'persona')
    expect(persona?.textContent).toContain('岗位描述')
    expect(persona?.querySelector('.pd-desc-input')).toBeTruthy()
  })

  it('顶栏（2026-08-28 统筹）：「返回」+ 分隔 + 可编辑名称；无技能搜索框、无「还差 N 项」进度条、无自动保存文案', async () => {
    await mount()
    const top = container.querySelector('.topbar')
    expect(top.querySelector('.tb-back').textContent.trim()).toBe('← 返回')
    expect(top.querySelector('.tb-sep')).toBeTruthy()
    expect(top.querySelector('.tb-name-input')).toBeTruthy()
    expect(top.textContent).not.toContain('搜技能')
    expect(top.textContent).not.toContain('还差')
    expect(top.textContent).not.toContain('自动保存')
    // 未改动时不显「有未保存的修改」；且不会自动触发 saveBasic
    expect(top.querySelector('.tb-dirty').textContent.trim()).toBe('')
    expect(store.saveBasic).not.toHaveBeenCalled()
  })

  it('未实现的「知识」「运行」显「开发中」占位', async () => {
    await mount()
    const paneText = (name) => [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === name)?.textContent || ''
    expect(paneText('knowledge')).toContain('开发中')
    expect(paneText('runtime')).toContain('开发中')
  })

  it('效果测试在 EFFECT_TEST_ENABLED=false 时显「开发中」占位（不擅自开启被关链路）', async () => {
    await mount()
    const et = [...container.querySelectorAll('.el-tab-pane')].find((p) => p.getAttribute('data-name') === 'effectTest')
    expect(et?.textContent).toContain('开发中')
  })
})
