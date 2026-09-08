// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * 4C #15（2026-09-09 原型复刻批次 4C）：从岗位详情「Agent 与技能」页签行内【编辑】进技能整页编辑器
 * （?fromPosition=<岗位 id>&fromTab=agents），「← 返回」应回到该岗位详情的来源页签，
 * 而不是落到技能列表 —— md §6.4「编辑完成后可【← 返回】回到岗位详情页」。
 */
const routerPushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '9' }, meta: { skillSource: 'platform' }, query: { fromPosition: '5', fromTab: 'agents' } }),
  useRouter: () => ({ push: routerPushSpy }),
  // 组①：离开拦截路由守卫（注册即可，测试不触发离开）。
  onBeforeRouteLeave: () => {}
}))

// 平台路径：详情/保存走 platformSkill api。
// V89 通道前缀分段隔离后编辑页改用命名空间 API（channelApi.get/update）。
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: {
    get: vi.fn(() =>
      Promise.resolve({ skillId: 9, name: 'P', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: 'QUERY', publications: [] })
    ),
    update: vi.fn(() => Promise.resolve({ referencedTools: [], category: 'QUERY' }))
  },
  systemSkillApi: { get: vi.fn(), update: vi.fn() }
}))
// N8：AdminSkillEditPage 现额外引 @/api/admin（业务系统技能数据源）→ 必须存根，否则会拉真实 @/api/request→@/router 触发 createRouter。
vi.mock('@/api/admin', () => ({ getBizSystemOwnedSkillDetail: vi.fn(), updateBizSystemOwnedSkill: vi.fn() }))
vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({ agents: [], basic: null, fetchSkillDetail: vi.fn(), patchSkill: vi.fn(), load: vi.fn(() => Promise.resolve()), reset: vi.fn() })
}))
vi.mock('@/api/position', () => ({ deleteSkill: vi.fn() }))
vi.mock('@/api/skillCategory', () => ({ listSkillCategories: vi.fn(() => Promise.resolve([])), setSkillCategory: vi.fn(() => Promise.resolve()) }))

// 2026-09-01 PRD 对齐改造取代旧口径：AdminSkillEditPage 新增引 @/api/fieldDict（技能分类同源字典）
// 与 @/api/unifiedSkill（apiFor 分流 / 发布态派生）→ 必须存根，
// 否则会拉真实 @/api/request → @/router 触发 createRouter（本文件 vue-router 为部分 mock）。
vi.mock('@/api/fieldDict', () => ({ listFieldDict: vi.fn(() => Promise.resolve({ skillCategory: [] })) }))
vi.mock('@/api/unifiedSkill', () => ({
  apiFor: () => ({}),
  SKILL_TYPE: { POSITION: 'POSITION', PLATFORM: 'PLATFORM', SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' },
  skillPublishReadiness: () => ({ ready: true, missing: [] }),
  deriveSkillDisplayView: () => ({})
}))
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: vi.fn(() => Promise.resolve({ skillId: 9, entryPath: 'SKILL.md', files: [] })),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '' })),
  saveSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } }))
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), prompt: vi.fn() }
}))
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
let emitBack = null
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill', 'backLabel'],
    emits: ['back'],
    setup(props, { emit }) {
      emitBack = () => emit('back')
      return () => h('div', { class: 'stub-focus', 'data-back': props.backLabel })
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

let app, container
function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminSkillEditPage)
  app.mount(container)
  return container
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  app?.unmount()
  container?.remove()
  emitBack = null
})

describe('AdminSkillEditPage · 4C #15 岗位借用态返回', () => {
  it('带 ?fromPosition/?fromTab 时 back → 回岗位详情的来源页签（不落技能列表、不 window.close）', async () => {
    const closeSpy = vi.fn()
    window.close = closeSpy
    mount()
    await vi.runOnlyPendingTimersAsync()
    expect(typeof emitBack).toBe('function')
    emitBack()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(routerPushSpy).toHaveBeenCalledWith({
      name: 'PositionWorkbench', params: { id: '5' }, query: { tab: 'agents' }
    })
    expect(routerPushSpy).not.toHaveBeenCalledWith({ name: 'AdminSkillsUnified' })
    expect(closeSpy).not.toHaveBeenCalled()
  })
})
