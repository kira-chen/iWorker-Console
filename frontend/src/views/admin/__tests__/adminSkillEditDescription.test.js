// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * §11.4-2：PUT 载荷补 description —— 验证 AdminSkillEditPage.autoSave 提交的 payload 含 description。
 * FDE 路径走 store.patchSkill(skillId, payload)；断言 payload 携带 description（面板权威）。
 */

// 路由：FDE（非 platform）。push 用稳定 spy（断言 #3 返回路由回列表）。
const routerPushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' }, meta: { skillSource: undefined } }),
  useRouter: () => ({ push: routerPushSpy }),
  // 组①：离开拦截路由守卫（注册即可，测试不触发离开）。
  onBeforeRouteLeave: () => {}
}))

// store：fetchSkillDetail 返回含 description 的详情；patchSkill 为 spy。
const patchSkillSpy = vi.fn(() => Promise.resolve({ skill: { referencedTools: [], category: 'QUERY' } }))
// 注：skillId 必须与路由参数同型（字符串）——applyTree 竞态护栏做严格比较（skill.value?.skillId !== skillId），
// 数字 7 会被当过期详情丢弃 → syncEntryCache 不跑 → entry 误判脏（生产 id 全线为 sk_* 字符串，无此问题）。
const fetchSkillDetailSpy = vi.fn(() =>
  Promise.resolve({
    skillId: '7',
    name: '客户回访',
    description: '回访技能',
    triggers: ['回访'],
    // N2：示例问题已填，autoSave 不被 N2 必填门拦（本用例只验 description 载荷，非 N2）。
    exampleQuestion: '帮我回访一下今天的客户',
    // 2026-09-01 PRD 对齐改造取代旧口径：saveConfig 新增保存门（清单20：分类必选），
    // 分类必须已选，否则配置保存被就地拦下、patchSkill 不会发出（本用例只验 description 载荷）。
    displayCategoryId: '数据分析',
    skillMd: '---\nname: 客户回访\ndescription: 回访技能\n---\n# 正文',
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

// API：文件树/导出等（页面 onMounted 会 listSkillFiles）。
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: vi.fn(() => Promise.resolve({ skillId: 7, entryPath: 'SKILL.md', files: [] })),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '' })),
  saveSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } }))
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
// deletePlatformSkill 保留：本文件「死接线清理」用例仍断言其恒不被调（历史删除入口回归锁）。
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: vi.fn(), update: vi.fn() },
  systemSkillApi: { get: vi.fn(), update: vi.fn() },
  deletePlatformSkill: vi.fn()
}))
// N8：AdminSkillEditPage 现额外引 @/api/admin（业务系统技能数据源）→ 必须存根，否则会拉真实 @/api/request→@/router 触发 createRouter。
vi.mock('@/api/admin', () => ({ getBizSystemOwnedSkillDetail: vi.fn(), updateBizSystemOwnedSkill: vi.fn() }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), prompt: vi.fn() }
}))
// 子组件全部存根（隔离 Milkdown/树/工具坞），暴露 update:skill / delete-skill / back / save-config 触发器。
let emitUpdateSkill = null
let emitDeleteSkill = null
let emitBack = null
let emitSaveConfig = null
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill', 'backLabel', 'autosaveText', 'showClose', 'configDirty', 'configSaving'],
    emits: ['update:skill', 'delete-skill', 'back', 'save-config'],
    setup(props, { emit }) {
      emitUpdateSkill = (patch) => emit('update:skill', { ...props.skill, ...patch })
      emitDeleteSkill = () => emit('delete-skill', props.skill?.skillId)
      emitBack = () => emit('back')
      emitSaveConfig = () => emit('save-config')
      // 渲染 back/autosave/configDirty 透传值供断言下沉到 topline。
      return () =>
        h('div', { class: 'stub-focus', 'data-back': props.backLabel, 'data-autosave': props.autosaveText, 'data-showclose': String(props.showClose), 'data-configdirty': String(props.configDirty) })
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

// 动作条用到 el-dropdown/el-icon 等 EP 组件 → 提供轻量存根（el-dropdown 暴露 command 派发供删除测试）。
import { provide, inject } from 'vue'
const topbarStubs = {
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  'el-dropdown': {
    emits: ['command'],
    setup(_, { slots, emit }) {
      provide('elcmd', (c) => emit('command', c))
      return () => h('div', { class: 'el-dropdown' }, [slots.default?.(), slots.dropdown?.()])
    }
  },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': {
    props: { command: { type: [String, Number], default: '' } },
    setup(props, { slots }) {
      const fire = inject('elcmd', null)
      return () => h('div', { class: 'dd-item', 'data-command': props.command, onClick: () => fire?.(props.command) }, slots.default?.())
    }
  }
}

let app, container
function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminSkillEditPage)
  for (const [n, c] of Object.entries(topbarStubs)) app.component(n, c)
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
  emitUpdateSkill = null
  emitSaveConfig = null
})

describe('AdminSkillEditPage · 配置手动保存（2026-07-08：文档自动、配置手动）', () => {
  it('改描述不再 debounce autoSave（配置改动只标脏 configDirty，不自动 PUT）', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()
    expect(fetchSkillDetailSpy).toHaveBeenCalledWith('7')
    expect(typeof emitUpdateSkill).toBe('function')

    // 改 description → 只标脏，不排自动保存。
    emitUpdateSkill({ description: '新的描述' })
    await vi.advanceTimersByTimeAsync(2100)
    expect(patchSkillSpy).not.toHaveBeenCalled()

    // 手动「保存」→ PUT 提交含 description 的配置载荷，且不带 skillMd（正文走文档自动保存；
    // 2026-08-17 起保存还会冲刷 entry，但本例 SKILL.md 无脏改动 → 冲刷跳过，仅一次配置 PUT）。
    emitSaveConfig()
    await vi.runOnlyPendingTimersAsync()

    expect(patchSkillSpy).toHaveBeenCalledTimes(1)
    const [skillId, payload] = patchSkillSpy.mock.calls.at(-1)
    expect(skillId).toBe('7')
    expect(payload).toHaveProperty('description', '新的描述')
    expect(payload).toHaveProperty('name')
    // 2026-08-17：触发词入口已下线，配置保存不得携带 triggers——
    // 空技能透传 [] 会误触后端 N1「显式编辑必 ≥1」保存门，把配置保存拦死。
    expect(payload).not.toHaveProperty('triggers')
    expect(payload).toHaveProperty('exampleQuestion', '帮我回访一下今天的客户')
    expect(payload).toHaveProperty('defaultInstall')
    // 配置保存不携带正文（skillMd 由文档区自动保存独立提交）。
    expect(payload).not.toHaveProperty('skillMd')
  })

  it('改 SKILL.md 正文 → 2s debounce 自动保存，PUT 只带 skillMd', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()

    emitUpdateSkill({ skillMd: '# 新正文' })
    await vi.advanceTimersByTimeAsync(2100)

    expect(patchSkillSpy).toHaveBeenCalled()
    const [skillId, payload] = patchSkillSpy.mock.calls.at(-1)
    expect(skillId).toBe('7')
    expect(payload).toHaveProperty('skillMd', '# 新正文')
    // 文档自动保存不带配置字段（避免把未手动保存的配置一起提交）。
    expect(payload).not.toHaveProperty('name')
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('triggers')
    expect(payload).not.toHaveProperty('exampleQuestion')
  })

  // 2026-08-17 规格：点「保存」同时冲刷 SKILL.md 未保存正文（不等 2s debounce）。
  it('SKILL.md 有未保存改动时点「保存」→ 配置 PUT + skillMd 冲刷 PUT 各一次', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()

    // 改正文（debounce 2s 尚未到点）→ 立即点「保存」。
    emitUpdateSkill({ skillMd: '# 改了还没自动保存的正文' })
    emitSaveConfig()
    await vi.runOnlyPendingTimersAsync()

    expect(patchSkillSpy).toHaveBeenCalledTimes(2)
    const payloads = patchSkillSpy.mock.calls.map(([, p]) => p)
    const cfg = payloads.find((p) => 'description' in p)
    const md = payloads.find((p) => 'skillMd' in p)
    expect(cfg).toBeTruthy()
    expect(cfg).not.toHaveProperty('skillMd')
    expect(md).toHaveProperty('skillMd', '# 改了还没自动保存的正文')
    // 冲刷已清 debounce：再走 2s 不应产生第三次 PUT。
    await vi.advanceTimersByTimeAsync(2100)
    expect(patchSkillSpy).toHaveBeenCalledTimes(2)
  })
})

describe('AdminSkillEditPage · 单行融合收口（去独立 topbar band，返回/保存/删除下沉 topline）', () => {
  it('不再渲染独立 topbar band（返回/保存/技能名全在 SkillFocusEditor 极简顶行一行内）', async () => {
    const el = mount()
    await vi.runOnlyPendingTimersAsync()
    // 独立 topbar band 及其元素已拆除
    expect(el.querySelector('.topbar')).toBeNull()
    expect(el.querySelector('.tb-back')).toBeNull()
    expect(el.querySelector('.tb-name')).toBeNull()
    expect(el.querySelector('.tb-more')).toBeNull()
  })

  it('#2 返回文案一律「← 返回」+ 自动保存提示下沉/透传进 SkillFocusEditor（back-label / autosave-text props）', async () => {
    const el = mount()
    await vi.runOnlyPendingTimersAsync()
    const focus = el.querySelector('.stub-focus')
    expect(focus.getAttribute('data-back')).toBe('← 返回') // #2：FDE/平台一律「← 返回」
    expect(focus.getAttribute('data-showclose')).toBe('false') // 整页 = showClose=false
  })

  it('整页无删除入口：父级不再接线 @delete-skill，即使被 emit 也不触发删除（删除收口到工作台 show-close=true）', async () => {
    const { deleteSkill } = await import('@/api/position')
    const { deletePlatformSkill } = await import('@/api/platformSkill')
    mount()
    await vi.runOnlyPendingTimersAsync()
    // 整页编辑器 show-close=false → SkillFocusEditor 删除 ⋯ 不渲染，且本页已撤掉 @delete-skill 监听（死接线清理）。
    // 即便子组件存根强行 emit delete-skill，父级也无监听响应，删除端点恒不被调用。
    emitDeleteSkill()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(deleteSkill).not.toHaveBeenCalled()
    expect(deletePlatformSkill).not.toHaveBeenCalled()
    expect(typeof emitBack).toBe('function')
  })

  it('#3 back（FDE）→ 路由回 AdminSkills、不再 window.close（在当前标签返回列表）', async () => {
    const closeSpy = vi.fn()
    window.close = closeSpy
    routerPushSpy.mockClear()
    mount()
    await vi.runOnlyPendingTimersAsync()
    emitBack()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    // FDE（skillSource undefined）→ 路由回技能管理列表 AdminSkills
    expect(routerPushSpy).toHaveBeenCalledWith({ name: 'AdminSkillsUnified' })
    // 不再关标签
    expect(closeSpy).not.toHaveBeenCalled()
  })
})
