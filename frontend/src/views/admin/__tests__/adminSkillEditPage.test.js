// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject } from 'vue'

/**
 * AdminSkillEditPage 页面级单测（2026-09-12 审计 T32：原 adminSkillEdit{BackPlatform,BackPosition,Description,
 * LeaveGuard,Q2Diff,SourceMatrix} 6 文件 22 条合并为本文件；用例内容不减，旧编号在 describe/用例名内括注）。
 *
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md：
 *  - §三.1 L139-141 进入方式（【查看】= 编辑路由 ?view=1 只读态；【编辑】= 编辑态）/ 返回回到技能列表；
 *  - §三.3 L176-177 【保存】成功提示「技能配置已保存」；只读态不展示分类修改 / 默认安装 / 发布 / 保存；
 *  - §三.6 SKILL.md 文件树操作（Q2 工具引用 diff）；
 *  - 一览表 §三 L58/L61/L62 保存门（名称 ≤64 / 分类必选 / 描述 ≤2000 / 示例问题 ≤60）。
 *
 * 公共桩：vue-router 用 hoisted routeState（meta/params/query 按 describe 切换）+ leaveGuard 捕获；
 * stores/position 的 fetchSkillDetail/patchSkill 为可切实现的 spy；SkillFocusEditor 桩取各文件 props/emits 并集，
 * 经 hoisted focus 对象暴露触发器与透传 props。
 */

/* ---------------- vue-router：路由态可切 + 捕获离开守卫 ---------------- */
const routeState = vi.hoisted(() => ({ meta: {}, params: { id: '7' }, query: {} }))
const routerPushSpy = vi.fn()
const leaveGuardRef = vi.hoisted(() => ({ cb: null }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeState.params, meta: routeState.meta, query: routeState.query }),
  useRouter: () => ({ push: routerPushSpy }),
  onBeforeRouteLeave: (cb) => {
    leaveGuardRef.cb = cb
  }
}))

/* ---------------- 数据源：position store / platformSkill / admin(bizSystem) ---------------- */
// 注：skillId 必须与路由参数同型（字符串）——applyTree 竞态护栏做严格比较（skill.value?.skillId !== skillId），
// 数字 7 会被当过期详情丢弃 → syncEntryCache 不跑 → entry 误判脏（生产 id 全线为 sk_* 字符串，无此问题）。
const FDE_DETAIL = () => ({
  skillId: '7',
  name: '客户回访',
  description: '回访技能',
  triggers: ['回访'],
  // 示例问题已填 + 分类已选：保存门（一览表 §三）全部通过，便于「保存」类用例只验载荷。
  exampleQuestion: '帮我回访一下今天的客户',
  displayCategoryId: '数据分析',
  skillMd: '---\nname: 客户回访\ndescription: 回访技能\n---\n# 正文',
  referencedTools: [],
  agentId: null,
  positionId: null,
  category: 'QUERY'
})
const fetchSkillDetailSpy = vi.fn()
const patchSkillSpy = vi.fn()
vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({
    agents: [],
    basic: null,
    fetchSkillDetail: (...a) => fetchSkillDetailSpy(...a),
    patchSkill: (...a) => patchSkillSpy(...a),
    load: vi.fn(() => Promise.resolve()),
    reset: vi.fn()
  })
}))

const platformGet = vi.fn()
const platformUpdate = vi.fn()
const systemGet = vi.fn()
const deletePlatformSkill = vi.fn()
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: (...a) => platformGet(...a), update: (...a) => platformUpdate(...a) },
  systemSkillApi: { get: (...a) => systemGet(...a), update: vi.fn() },
  // deletePlatformSkill 保留：「死接线清理」用例仍断言其恒不被调（历史删除入口回归锁）。
  deletePlatformSkill: (...a) => deletePlatformSkill(...a)
}))
const bizGet = vi.fn()
vi.mock('@/api/admin', () => ({
  getBizSystemOwnedSkillDetail: (...a) => bizGet(...a),
  updateBizSystemOwnedSkill: vi.fn()
}))
const deleteSkill = vi.fn()
vi.mock('@/api/position', () => ({ deleteSkill: (...a) => deleteSkill(...a) }))
vi.mock('@/api/skillCategory', () => ({
  listSkillCategories: vi.fn(() => Promise.resolve([])),
  setSkillCategory: vi.fn(() => Promise.resolve())
}))
// AdminSkillEditPage 引 @/api/fieldDict（技能分类同源字典）与 @/api/unifiedSkill（apiFor 分流 / 发布态派生）
// → 必须存根，否则会拉真实 @/api/request → @/router 触发 createRouter（本文件 vue-router 为部分 mock）。
vi.mock('@/api/fieldDict', () => ({ listFieldDict: vi.fn(() => Promise.resolve({ skillCategory: [] })) }))
vi.mock('@/api/unifiedSkill', () => ({
  apiFor: () => ({}),
  SKILL_TYPE: { POSITION: 'POSITION', PLATFORM: 'PLATFORM', SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' },
  skillPublishReadiness: () => ({ ready: true, missing: [] }),
  deriveSkillDisplayView: () => ({})
}))

/* ---------------- 文件层 ---------------- */
const listSkillFiles = vi.fn()
const getSkillFile = vi.fn()
const saveSkillFileSpy = vi.fn()
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: (...a) => listSkillFiles(...a),
  getSkillFile: (...a) => getSkillFile(...a),
  saveSkillFile: (...a) => saveSkillFileSpy(...a),
  downloadSkillFile: vi.fn()
}))

/* ---------------- element-plus ---------------- */
const elMessageFn = vi.fn()
const ElMessage = Object.assign(elMessageFn, { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
const confirmSpy = vi.fn(() => Promise.resolve())
vi.mock('element-plus', () => ({
  ElMessage,
  ElMessageBox: { confirm: (...a) => confirmSpy(...a), prompt: vi.fn() }
}))

/* ---------------- 子组件桩：SkillFocusEditor（props/emits 并集，触发器挂 hoisted focus） ---------------- */
const focus = vi.hoisted(() => ({
  props: null,
  updateSkill: null,
  deleteSkill: null,
  back: null,
  saveConfig: null,
  updateContent: null,
  selectFile: null,
  treeChanged: null,
  fileDeleted: null
}))
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: [
      'skill', 'backLabel', 'autosaveText', 'configDirty', 'configSaving',
      'skillSource', 'publications', 'hideMarketFields', 'activeFilePath', 'saveStatus', 'readonly'
    ],
    emits: ['update:skill', 'delete-skill', 'back', 'save-config', 'update:activeFileContent', 'select-file', 'tree-changed', 'file-deleted'],
    setup(props, { emit }) {
      focus.updateSkill = (patch) => emit('update:skill', { ...props.skill, ...patch })
      focus.deleteSkill = () => emit('delete-skill', props.skill?.skillId)
      focus.back = () => emit('back')
      focus.saveConfig = () => emit('save-config')
      focus.updateContent = (v) => emit('update:activeFileContent', v)
      focus.selectFile = (p) => emit('select-file', p)
      focus.treeChanged = (saveVO, meta) => emit('tree-changed', saveVO, meta)
      focus.fileDeleted = (path, saveVO) => emit('file-deleted', path, saveVO)
      return () => {
        focus.props = props
        return h('div', {
          class: 'stub-focus',
          'data-back': props.backLabel,
          'data-autosave': props.autosaveText,
          'data-configdirty': String(props.configDirty),
          'data-readonly': String(props.readonly),
          'data-phase': props.saveStatus?.phase
        })
      }
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

// 动作条用到 el-dropdown/el-icon 等 EP 组件 → 轻量存根（el-dropdown 暴露 command 派发）。
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
/** 详情/树两路并发 promise 链 flush（真计时器）。 */
async function ready(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
  routeState.meta = {}
  routeState.params = { id: '7' }
  routeState.query = {}
  leaveGuardRef.cb = null
  focus.props = null
  fetchSkillDetailSpy.mockImplementation(() => Promise.resolve(FDE_DETAIL()))
  patchSkillSpy.mockImplementation(() => Promise.resolve({ skill: { referencedTools: [], category: 'QUERY' } }))
  platformGet.mockResolvedValue({ skillId: '9', name: 'P', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: 'QUERY', publications: [] })
  platformUpdate.mockResolvedValue({ referencedTools: [], category: 'QUERY' })
  systemGet.mockResolvedValue({ skillId: 'sk_1', name: 'S', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: null, publications: [] })
  bizGet.mockResolvedValue({ skillId: 'sk_1', name: 'S', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: null, publications: [] })
  listSkillFiles.mockImplementation((id) => Promise.resolve({ skillId: id, entryPath: 'SKILL.md', files: [] }))
  getSkillFile.mockResolvedValue({ content: '' })
  saveSkillFileSpy.mockImplementation(() => Promise.resolve({ tree: { files: [] }, treeChanged: false, refsChanged: false }))
  confirmSpy.mockImplementation(() => Promise.resolve())
})
afterEach(() => {
  vi.useRealTimers()
  app?.unmount()
  container?.remove()
})

/* ====================================================================================== */
describe('数据源分流（原 SourceMatrix · 接线守卫：路由 meta → 编辑器 skill-source + 树 source + 详情命名空间穷举）', () => {
  const DETAIL = { skillId: 'sk_1', name: 'S', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: null, publications: [] }
  async function mountWith(meta, params = { id: 'sk_1' }) {
    routeState.meta = meta
    routeState.params = params
    mount()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }
  beforeEach(() => {
    fetchSkillDetailSpy.mockResolvedValue(DETAIL)
    platformGet.mockResolvedValue(DETAIL)
    listSkillFiles.mockResolvedValue({ skillId: 'sk_1', entryPath: 'SKILL.md', files: [] })
  })

  it('FDE（meta 无 skillSource）→ 编辑器 source=fde，树走 fde，详情走 position store', async () => {
    await mountWith({})
    expect(focus.props.skillSource).toBe('fde')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'fde')
    expect(fetchSkillDetailSpy).toHaveBeenCalledWith('sk_1')
    expect(platformGet).not.toHaveBeenCalled()
    expect(systemGet).not.toHaveBeenCalled()
  })

  it('平台市场（skillSource=platform）→ 编辑器 source=platform，树走 platform，详情走 platformSkillApi', async () => {
    await mountWith({ skillSource: 'platform' })
    expect(focus.props.skillSource).toBe('platform')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'platform')
    expect(platformGet).toHaveBeenCalledWith('sk_1')
    expect(systemGet).not.toHaveBeenCalled()
  })

  it('系统默认（platform + skillChannel=system）→ 编辑器 source=system，树走 system，详情走 systemSkillApi', async () => {
    await mountWith({ skillSource: 'platform', skillChannel: 'system' })
    expect(focus.props.skillSource).toBe('system')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'system')
    expect(systemGet).toHaveBeenCalledWith('sk_1')
    expect(platformGet).not.toHaveBeenCalled()
  })

  it('业务系统技能（skillSource=bizSystem）→ 无文件端点不拉树，详情走 biz-systems 端点', async () => {
    await mountWith({ skillSource: 'bizSystem' }, { id: 'sk_1', bizId: 'bs_1' })
    expect(listSkillFiles).not.toHaveBeenCalled()
    expect(bizGet).toHaveBeenCalledWith('bs_1', 'sk_1')
    expect(platformGet).not.toHaveBeenCalled()
    expect(systemGet).not.toHaveBeenCalled()
  })
})

/* ====================================================================================== */
describe('返回（md §三.1 L139 【← 返回】回到技能列表并刷新；原 BackPlatform / BackPosition / Description #3）', () => {
  beforeEach(() => vi.useFakeTimers())

  it('FDE 视图 back → 路由回技能列表 AdminSkillsUnified、不 window.close（原 Description #3）', async () => {
    const closeSpy = vi.fn()
    window.close = closeSpy
    mount()
    await vi.runOnlyPendingTimersAsync()
    expect(focus.props.backLabel).toBe('← 返回')
    focus.back()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(routerPushSpy).toHaveBeenCalledWith({ name: 'AdminSkillsUnified' })
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('平台视图（meta.skillSource=platform）back → 同样回 AdminSkillsUnified（三类技能同一列表，md §一 L17），不 window.close（原 BackPlatform）', async () => {
    routeState.meta = { skillSource: 'platform' }
    routeState.params = { id: '9' }
    const closeSpy = vi.fn()
    window.close = closeSpy
    mount()
    await vi.runOnlyPendingTimersAsync()
    expect(platformGet).toHaveBeenCalledWith('9')
    focus.back()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(routerPushSpy).toHaveBeenCalledWith({ name: 'AdminSkillsUnified' })
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('岗位借用态 ?fromPosition/?fromTab → back 回岗位详情的来源页签（不落技能列表、不 window.close）（原 BackPosition 4C #15）', async () => {
    routeState.meta = { skillSource: 'platform' }
    routeState.params = { id: '9' }
    routeState.query = { fromPosition: '5', fromTab: 'agents' }
    const closeSpy = vi.fn()
    window.close = closeSpy
    mount()
    await vi.runOnlyPendingTimersAsync()
    focus.back()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(routerPushSpy).toHaveBeenCalledWith({ name: 'PositionWorkbench', params: { id: '5' }, query: { tab: 'agents' } })
    expect(routerPushSpy).not.toHaveBeenCalledWith({ name: 'AdminSkillsUnified' })
    expect(closeSpy).not.toHaveBeenCalled()
  })
})

/* ====================================================================================== */
describe('保存（md §三.3 L176 配置手动保存 + 一览表 §三 保存门；原 Description 配置保存 / 单行融合）', () => {
  beforeEach(() => vi.useFakeTimers())

  it('改描述不 debounce 自动保存（只标脏）；点【保存】→ 配置 PUT 含 description、不带 triggers/skillMd，成功提示「技能配置已保存」（md L176）', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()
    expect(fetchSkillDetailSpy).toHaveBeenCalledWith('7')
    // 改 description → 只标脏，不排自动保存。
    focus.updateSkill({ description: '新的描述' })
    await vi.advanceTimersByTimeAsync(2100)
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(container.querySelector('.stub-focus').getAttribute('data-configdirty')).toBe('true')

    // 手动「保存」→ PUT 提交含 description 的配置载荷，且不带 skillMd（正文走文档自动保存；
    // 保存还会冲刷 entry，但本例 SKILL.md 无脏改动 → 冲刷跳过，仅一次配置 PUT）。
    focus.saveConfig()
    await vi.runOnlyPendingTimersAsync()
    expect(patchSkillSpy).toHaveBeenCalledTimes(1)
    const [skillId, payload] = patchSkillSpy.mock.calls.at(-1)
    expect(skillId).toBe('7')
    expect(payload).toHaveProperty('description', '新的描述')
    expect(payload).toHaveProperty('name')
    // 触发词入口已下线（2026-08-13），配置保存不得携带 triggers（空技能透传 [] 会误触后端 N1 保存门）。
    expect(payload).not.toHaveProperty('triggers')
    expect(payload).toHaveProperty('exampleQuestion', '帮我回访一下今天的客户')
    expect(payload).toHaveProperty('defaultInstall')
    expect(payload).not.toHaveProperty('skillMd')
    // 用户可见结果：成功 toast 逐字 + 脏标归零
    expect(ElMessage.success).toHaveBeenCalledWith('技能配置已保存')
    expect(container.querySelector('.stub-focus').getAttribute('data-configdirty')).toBe('false')
  })

  it('改 SKILL.md 正文 → 2s debounce 自动保存，PUT 只带 skillMd', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()
    focus.updateSkill({ skillMd: '# 新正文' })
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

  it('SKILL.md 有未保存改动时点【保存】→ 配置 PUT + skillMd 冲刷 PUT 各一次（不等 2s debounce）', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()
    focus.updateSkill({ skillMd: '# 改了还没自动保存的正文' })
    focus.saveConfig()
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

  describe('保存门（一览表 §三 L58 名称 ≤64 / L61 描述 ≤2000 / L62 示例问题 ≤300 / 分类必选）：拦下不发 PUT、warning 提示补齐', () => {
    it('技能名称超过 64 字符 → warning「请填写不超过 64 个字符的技能名称」，不发配置 PUT', async () => {
      mount()
      await vi.runOnlyPendingTimersAsync()
      focus.updateSkill({ name: '名'.repeat(65) })
      focus.saveConfig()
      await vi.runOnlyPendingTimersAsync()
      expect(ElMessage.warning).toHaveBeenCalledWith('请填写不超过 64 个字符的技能名称')
      expect(patchSkillSpy).not.toHaveBeenCalled()
      expect(ElMessage.success).not.toHaveBeenCalled()
    })

    it('技能分类为空 → warning「请选择技能分类」，不发配置 PUT', async () => {
      mount()
      await vi.runOnlyPendingTimersAsync()
      focus.updateSkill({ displayCategoryId: null })
      focus.saveConfig()
      await vi.runOnlyPendingTimersAsync()
      expect(ElMessage.warning).toHaveBeenCalledWith('请选择技能分类')
      expect(patchSkillSpy).not.toHaveBeenCalled()
    })

    it('描述超过 2000 字符 → warning「请填写不超过 2000 个字符的技能描述」，不发配置 PUT', async () => {
      mount()
      await vi.runOnlyPendingTimersAsync()
      focus.updateSkill({ description: '描'.repeat(2001) })
      focus.saveConfig()
      await vi.runOnlyPendingTimersAsync()
      expect(ElMessage.warning).toHaveBeenCalledWith('请填写不超过 2000 个字符的技能描述')
      expect(patchSkillSpy).not.toHaveBeenCalled()
    })

    it('示例问题超过 300 字符 → warning「请填写不超过 300 个字符的示例问题」，不发配置 PUT', async () => {
      mount()
      await vi.runOnlyPendingTimersAsync()
      focus.updateSkill({ exampleQuestion: '问'.repeat(301) })
      focus.saveConfig()
      await vi.runOnlyPendingTimersAsync()
      expect(ElMessage.warning).toHaveBeenCalledWith('请填写不超过 300 个字符的示例问题')
      expect(patchSkillSpy).not.toHaveBeenCalled()
    })
  })

  describe('单行融合收口（去独立 topbar band，返回/保存下沉 SkillFocusEditor 顶行；原 Description）', () => {
    it('不再渲染独立 topbar band（返回/保存/技能名全在 SkillFocusEditor 极简顶行一行内）', async () => {
      const el = mount()
      await vi.runOnlyPendingTimersAsync()
      expect(el.querySelector('.topbar')).toBeNull()
      expect(el.querySelector('.tb-back')).toBeNull()
      expect(el.querySelector('.tb-name')).toBeNull()
      expect(el.querySelector('.tb-more')).toBeNull()
    })

    it('返回文案一律「← 返回」透传进 SkillFocusEditor（md L139 顶部【← 返回】；showClose 开关已退役，2026-09-12 J14）', async () => {
      const el = mount()
      await vi.runOnlyPendingTimersAsync()
      const f = el.querySelector('.stub-focus')
      expect(f.getAttribute('data-back')).toBe('← 返回')
      // J14：整页形态不再靠 show-close=false 表达，父级不应再传该 prop
      expect(focus.props.showClose).toBeUndefined()
      expect(el.querySelector('.stub-focus').getAttribute('show-close')).toBeNull()
    })

    it('整页无删除入口：父级不接线 @delete-skill（该 emit 已随 J14 退役，此处模拟旧组件仍发出的兜底），不触发删除（删除收口到列表页，md §二.3.6）', async () => {
      mount()
      await vi.runOnlyPendingTimersAsync()
      focus.deleteSkill()
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
      expect(deleteSkill).not.toHaveBeenCalled()
      expect(deletePlatformSkill).not.toHaveBeenCalled()
    })
  })
})

/* ====================================================================================== */
describe('离开拦截（原 LeaveGuard 组①：flushAllDirty 覆盖全部 dirty 文件；残留时弹 confirm 按用户选择放行/留下）', () => {
  const TWO_FILES = {
    skillId: '7',
    entryPath: 'SKILL.md',
    files: [
      { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
      { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false }
    ]
  }
  beforeEach(() => {
    listSkillFiles.mockResolvedValue(TWO_FILES)
    getSkillFile.mockResolvedValue({ content: '旧内容' })
  })

  it('flushAllDirty 覆盖所有 dirty 文件：entry(改 skillMd) + 非 entry(改内容) 全部被保存，全成功放行不弹 confirm', async () => {
    mount()
    await ready(3)
    expect(typeof leaveGuardRef.cb).toBe('function')
    focus.updateSkill({ skillMd: '# 正文改动' })
    focus.selectFile('references/a.md')
    await ready(6)
    focus.updateContent('改了子文件')
    await Promise.resolve()

    const result = await leaveGuardRef.cb()
    expect(patchSkillSpy).toHaveBeenCalled()
    expect(saveSkillFileSpy).toHaveBeenCalledWith('7', expect.objectContaining({ path: 'references/a.md' }), 'fde')
    expect(result).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('flush 后仍有残留（entry 保存失败）→ 弹 confirm；用户确认「仍然离开」→ 放行', async () => {
    patchSkillSpy.mockImplementation(() => Promise.reject(new Error('网络错')))
    mount()
    await ready(3)
    focus.updateSkill({ skillMd: '# 改动但会保存失败' })
    await Promise.resolve()
    confirmSpy.mockImplementation(() => Promise.resolve())
    const result = await leaveGuardRef.cb()
    expect(patchSkillSpy).toHaveBeenCalled()
    expect(confirmSpy).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('flush 后仍有残留（子文件保存失败）+ 用户取消 confirm → 留在编辑器（守卫返回 false）', async () => {
    saveSkillFileSpy.mockImplementation(() => Promise.reject(new Error('保存失败')))
    mount()
    await ready(3)
    focus.selectFile('references/a.md')
    await ready(2)
    focus.updateContent('改了但保存会失败')
    await Promise.resolve()
    confirmSpy.mockImplementation(() => Promise.reject(new Error('cancel')))
    const result = await leaveGuardRef.cb()
    expect(confirmSpy).toHaveBeenCalled()
    expect(result).toBe(false)
  })

  it('无未保存改动 → 守卫直接放行，不 flush、不弹 confirm', async () => {
    mount()
    await ready(3)
    const result = await leaveGuardRef.cb()
    expect(result).toBe(true)
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(saveSkillFileSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

/* ====================================================================================== */
describe('工具引用 diff（原 Q2Diff：「已移出工具」提示遵守 refsChanged 铁律，md §三.6 文件树操作）', () => {
  // 技能详情：已引用 3 个数据表工具（模拟线上场景）。
  const REFERENCED = [
    { code: 'table__crm_visit__query', bizName: '客户交互记录表-查询', checkStatus: 'HEALTHY', known: true },
    { code: 'table__case__query', bizName: '案例主表-查询', checkStatus: 'HEALTHY', known: true },
    { code: 'table__product__query', bizName: '产品目录-查询', checkStatus: 'HEALTHY', known: true }
  ]
  beforeEach(() => {
    fetchSkillDetailSpy.mockImplementation(() =>
      Promise.resolve({ ...FDE_DETAIL(), name: '客户技能', referencedTools: REFERENCED, category: 'OPERATION' })
    )
    patchSkillSpy.mockImplementation(() => Promise.resolve({ skill: { referencedTools: REFERENCED, category: 'OPERATION' } }))
    listSkillFiles.mockResolvedValue({
      skillId: '7',
      entryPath: 'SKILL.md',
      files: [
        { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
        { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false },
        { path: 'data.json', name: 'data.json', fileType: 'json', isEntry: false }
      ]
    })
  })
  // 是否弹了「已移出」warning（callable ElMessage({type:'warning',message:含「已移出」})）。
  const movedOutToastFired = () =>
    elMessageFn.mock.calls.some(([arg]) => arg && /已移出本技能运行时白名单/.test(arg.message || ''))

  it('纯目录操作（新建文件夹）refsChanged=false、referencedTools=null → 不弹「已移出」', async () => {
    mount()
    await ready()
    focus.treeChanged(
      { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null },
      { kind: 'folder-create', dir: 'newdir' }
    )
    await ready()
    expect(movedOutToastFired(), '纯目录操作不应弹「已移出」').toBe(false)
  })

  it('删 .json（refsChanged=false）→ 不弹「已移出」，仍给「已删除」成功提示', async () => {
    mount()
    await ready()
    focus.fileDeleted('data.json', { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null })
    await ready()
    expect(movedOutToastFired(), '删 .json 不应弹「已移出」').toBe(false)
    expect(ElMessage.success).toHaveBeenCalledWith('已删除')
  })

  it('删 .md 真移出工具（refsChanged=true，referencedTools 少了若干）→ 弹「已移出」并点名被移出工具', async () => {
    mount()
    await ready()
    focus.fileDeleted('references/a.md', { tree: { files: [] }, treeChanged: true, refsChanged: true, referencedTools: [REFERENCED[0]] })
    await ready()
    expect(movedOutToastFired(), '真移出应弹「已移出」').toBe(true)
    const moved = elMessageFn.mock.calls.find(([a]) => /已移出/.test(a?.message || ''))[0]
    expect(moved.message).toContain('案例主表-查询')
    expect(moved.message).toContain('产品目录-查询')
  })

  it('缺省（无 refsChanged 字段）但带全量 referencedTools → 仍走 diff（兼容不变）', async () => {
    mount()
    await ready()
    focus.fileDeleted('references/a.md', { tree: { files: [] }, treeChanged: true, referencedTools: [REFERENCED[0], REFERENCED[1]] })
    await ready()
    expect(movedOutToastFired(), '带全量 referencedTools 仍 diff').toBe(true)
  })

  it('删文件夹 refsChanged=false、referencedTools=null → 不弹「已移出」（误报根因路径）', async () => {
    mount()
    await ready()
    focus.treeChanged(
      { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null },
      { kind: 'folder-delete', removedPrefix: 'references' }
    )
    await ready()
    expect(movedOutToastFired(), '删纯目录不应误报').toBe(false)
  })
})

/* ====================================================================================== */
describe('只读态（md §三.1 L139 【查看】= 编辑路由 ?view=1；§三.3 L177 只读态不保存）', () => {
  beforeEach(() => {
    routeState.query = { view: '1' }
    vi.useFakeTimers()
  })

  it('?view=1 → SkillFocusEditor 收到 readonly=true；改动回吐被忽略（不置脏、不自动保存）；点【保存】不发 PUT、无提示', async () => {
    const el = mount()
    await vi.runOnlyPendingTimersAsync()
    expect(fetchSkillDetailSpy).toHaveBeenCalledWith('7')
    expect(focus.props.readonly).toBe(true)
    expect(el.querySelector('.stub-focus').getAttribute('data-readonly')).toBe('true')
    // 正文回吐 → 只读态忽略，2s 后不自动 PUT
    focus.updateSkill({ skillMd: '# 只读态下的改动' })
    await vi.advanceTimersByTimeAsync(2100)
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(el.querySelector('.stub-focus').getAttribute('data-configdirty')).toBe('false')
    // 保存链路短路：不发 PUT、不弹任何 toast
    focus.saveConfig()
    await vi.runOnlyPendingTimersAsync()
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('?view=1 → 离开守卫直接放行（无写入、无脏），不 flush、不弹 confirm', async () => {
    mount()
    await vi.runOnlyPendingTimersAsync()
    focus.updateSkill({ skillMd: '# 改动' })
    const result = await leaveGuardRef.cb()
    expect(result).toBe(true)
    expect(patchSkillSpy).not.toHaveBeenCalled()
    expect(saveSkillFileSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('无 ?view 参数（【编辑】入口）→ readonly=false，改动正常置脏', async () => {
    routeState.query = {}
    const el = mount()
    await vi.runOnlyPendingTimersAsync()
    expect(focus.props.readonly).toBe(false)
    focus.updateSkill({ description: '编辑态改动' })
    await vi.runOnlyPendingTimersAsync()
    expect(el.querySelector('.stub-focus').getAttribute('data-configdirty')).toBe('true')
  })
})
