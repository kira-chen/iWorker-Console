// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * 组① 离开未保存拦截（数据安全路径）单测护栏：
 *  - flushAllDirty 覆盖「所有」dirty 文件（entry + 多个非 entry），全成功后放行（不弹 confirm）；
 *  - onBeforeRouteLeave 在 flush 后仍有残留（某文件保存失败）时弹 confirm，并按用户选择决定放行/留下。
 */

// 捕获页面注册的 onBeforeRouteLeave 守卫回调，供测试手动触发「离开」。
let leaveGuard = null
const routerPushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' }, meta: { skillSource: undefined } }),
  useRouter: () => ({ push: routerPushSpy }),
  onBeforeRouteLeave: (cb) => {
    leaveGuard = cb
  }
}))

// store：FDE 详情 + patchSkill（entry/技能级保存）。默认成功；可被单测改为失败。
const patchSkillSpy = vi.fn(() => Promise.resolve({ skill: { referencedTools: [], category: 'QUERY' } }))
const fetchSkillDetailSpy = vi.fn(() =>
  Promise.resolve({
    skillId: 7,
    name: '客户回访',
    description: '',
    triggers: [],
    skillMd: '# 正文',
    referencedTools: [],
    agentId: null,
    positionId: null,
    category: 'QUERY'
  })
)
vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({
    agents: [],
    basic: null,
    fetchSkillDetail: fetchSkillDetailSpy,
    patchSkill: patchSkillSpy,
    load: vi.fn(() => Promise.resolve()),
    reset: vi.fn()
  })
}))

// 文件树：含一个非 entry .md，供制造「非 entry 文件 dirty」。
const saveSkillFileSpy = vi.fn(() => Promise.resolve({ tree: { files: [] }, treeChanged: false, refsChanged: false }))
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: vi.fn(() =>
    Promise.resolve({
      skillId: 7,
      entryPath: 'SKILL.md',
      files: [
        { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
        { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false }
      ]
    })
  ),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '旧内容' })),
  saveSkillFile: saveSkillFileSpy
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
// V89 通道前缀分段隔离后编辑页改用命名空间 API（channelApi.get/update）。
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: vi.fn(), update: vi.fn() },
  systemSkillApi: { get: vi.fn(), update: vi.fn() }
}))
// N8：AdminSkillEditPage 现额外引 @/api/admin（业务系统技能数据源）→ 必须存根，否则会拉真实 @/api/request→@/router 触发 createRouter。
vi.mock('@/api/admin', () => ({ getBizSystemOwnedSkillDetail: vi.fn(), updateBizSystemOwnedSkill: vi.fn() }))

const confirmSpy = vi.fn(() => Promise.resolve())
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: (...a) => confirmSpy(...a), prompt: vi.fn() }
}))

// 子组件存根：暴露 update:skill / update:activeFileContent / select-file 触发器。
let emitUpdateSkill = null
let emitUpdateContent = null
let emitSelectFile = null
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill', 'activeFilePath', 'saveStatus'],
    emits: ['update:skill', 'update:activeFileContent', 'select-file'],
    setup(props, { emit }) {
      emitUpdateSkill = (patch) => emit('update:skill', { ...props.skill, ...patch })
      emitUpdateContent = (v) => emit('update:activeFileContent', v)
      emitSelectFile = (p) => emit('select-file', p)
      return () => h('div', { class: 'stub-focus', 'data-phase': props.saveStatus?.phase })
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
  leaveGuard = null
  patchSkillSpy.mockImplementation(() => Promise.resolve({ skill: { referencedTools: [], category: 'QUERY' } }))
  saveSkillFileSpy.mockImplementation(() => Promise.resolve({ tree: { files: [] }, treeChanged: false, refsChanged: false }))
  confirmSpy.mockImplementation(() => Promise.resolve())
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  emitUpdateSkill = emitUpdateContent = emitSelectFile = null
})

describe('AdminSkillEditPage · 组① 离开未保存拦截', () => {
  it('flushAllDirty 覆盖所有 dirty 文件：entry(改 skillMd) + 非 entry(改内容) 全部被保存', async () => {
    mount()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(typeof leaveGuard).toBe('function')

    // 1) 改 entry（SKILL.md）→ entry dirty。
    emitUpdateSkill({ skillMd: '# 正文改动' })
    // 2) 切到非 entry 文件（等其内容装载完成）再改其内容 → 该文件 dirty。
    emitSelectFile('references/a.md')
    for (let i = 0; i < 6; i++) await Promise.resolve()
    emitUpdateContent('改了子文件')
    await Promise.resolve()

    // 触发离开守卫（不等 2s debounce）→ flushAllDirty 立即 flush 全部 dirty。
    const result = await leaveGuard()

    // entry 走 patchSkill、非 entry 走 saveSkillFile，二者都被调用（覆盖所有 dirty）。
    expect(patchSkillSpy).toHaveBeenCalled()
    expect(saveSkillFileSpy).toHaveBeenCalledWith(7, expect.objectContaining({ path: 'references/a.md' }), 'fde')
    // 全成功 → 无残留 → 放行、不弹 confirm。
    expect(result).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('flush 后仍有残留（保存失败）→ onBeforeRouteLeave 弹 confirm；用户确认→放行', async () => {
    // entry 保存失败 → flush 后 entry 仍 dirty（残留）。
    patchSkillSpy.mockImplementation(() => Promise.reject(new Error('网络错')))
    mount()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    emitUpdateSkill({ skillMd: '# 改动但会保存失败' })
    await Promise.resolve()

    confirmSpy.mockImplementation(() => Promise.resolve()) // 用户点「仍然离开」
    const result = await leaveGuard()

    expect(patchSkillSpy).toHaveBeenCalled() // 尽力 flush 过
    expect(confirmSpy).toHaveBeenCalled() // 有残留 → 弹 confirm
    expect(result).toBe(true) // 用户确认 → 放行
  })

  it('flush 后仍有残留 + 用户取消 confirm → 留在编辑器（守卫返回 false）', async () => {
    saveSkillFileSpy.mockImplementation(() => Promise.reject(new Error('保存失败')))
    mount()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    emitSelectFile('references/a.md')
    await Promise.resolve(); await Promise.resolve()
    emitUpdateContent('改了但保存会失败')
    await Promise.resolve()

    confirmSpy.mockImplementation(() => Promise.reject(new Error('cancel'))) // 用户点「留下继续编辑」
    const result = await leaveGuard()

    expect(confirmSpy).toHaveBeenCalled()
    expect(result).toBe(false) // 取消 → 留下
  })

  it('无未保存改动 → 守卫直接放行，不 flush、不弹 confirm', async () => {
    mount()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const result = await leaveGuard()
    expect(result).toBe(true)
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(saveSkillFileSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
