// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

/**
 * 「技能」页（三类合一）单测。
 *
 * 2026-09-01 PRD 对齐改造取代旧口径（页面按交互原型 v2 最终覆写态重构，本文件整体重写）：
 * - 类型词表：岗位私有 / 市场技能 / 通用技能；三类统一三态（未发布/审核中/已发布）；
 * - 旧「本体状态开关 toggleStatus / 下架 offlineSkill / 上架 onlineSkill / canRemove 删除门控」全部废弃：
 *   操作列按三态出按钮（固定 查看/编辑；未发布 发布+删除；审核中 撤回；已发布 停用+版本管理）；
 * - 停用 = 提交停用审核（stopSkill，被引用拦截 alert）；删除确认文案统一、被引用拦截 alert；
 * - 分类筛选固定 8 类（fieldDict 同源）对全部类型开放，类型切换不再清分类（只清引用筛选）；
 * - 查看/编辑同标签路由跳转（router.push；查看 = 编辑路由 + ?view=1），不再 window.open 新标签；
 * - 发布就绪门与编辑页共用 skillPublishReadiness（api/unifiedSkill.js）。
 *
 * 覆盖重点（沿用「绝不串前缀」范式）：读只走聚合端点；写操作分流矩阵三类各自命名空间零串台。
 */

const listUnifiedSpy = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
vi.mock('@/api/request', () => ({
  default: { get: (...a) => listUnifiedSpy(...a) },
  ApiError: class ApiError extends Error {}
}))

// 三套命名空间各自打点：断言写操作绝不串台。
const positionRemove = vi.fn(() => Promise.resolve())
const positionSetStatus = vi.fn(() => Promise.resolve())
const positionCreate = vi.fn(() => Promise.resolve({ skillId: 'sk_new_p' }))
vi.mock('@/api/position', () => ({
  listSkills: vi.fn(),
  createStandaloneSkill: (...a) => positionCreate(...a),
  updateSkill: vi.fn(),
  deleteSkill: (...a) => positionRemove(...a),
  setSkillStatus: (...a) => positionSetStatus(...a),
  // 效果测试入口用（feature flag 关闭中，仅供页面 import 解构）
  getSkill: vi.fn(() => Promise.resolve(null))
}))

const platformRemove = vi.fn(() => Promise.resolve())
const platformDelist = vi.fn(() => Promise.resolve())
const platformWithdraw = vi.fn(() => Promise.resolve())
const platformCreate = vi.fn(() => Promise.resolve({ skillId: 'sk_new_m' }))
const systemRemove = vi.fn(() => Promise.resolve())
const systemDelist = vi.fn(() => Promise.resolve())
const systemWithdraw = vi.fn(() => Promise.resolve())
const systemCreate = vi.fn(() => Promise.resolve({ skillId: 'sk_new_s' }))
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: {
    list: vi.fn(),
    create: (...a) => platformCreate(...a),
    remove: (...a) => platformRemove(...a),
    delist: (...a) => platformDelist(...a),
    withdrawPublish: (...a) => platformWithdraw(...a),
    relist: vi.fn()
  },
  systemSkillApi: {
    list: vi.fn(),
    create: (...a) => systemCreate(...a),
    remove: (...a) => systemRemove(...a),
    delist: (...a) => systemDelist(...a),
    withdrawPublish: (...a) => systemWithdraw(...a),
    relist: vi.fn()
  }
}))

// 2026-09-01：分类选项改走 fieldDict 同源字典（固定 8 类）；skillCategory.js 列表接口不再被本页调用。
const listSkillCategoriesSpy = vi.fn(() => Promise.resolve([]))
vi.mock('@/api/skillCategory', () => ({ listSkillCategories: (...a) => listSkillCategoriesSpy(...a) }))
const listFieldDictSpy = vi.fn(() => Promise.resolve({ skillCategory: [{ name: '办公效率' }] }))
vi.mock('@/api/fieldDict', () => ({ listFieldDict: (...a) => listFieldDictSpy(...a) }))

const confirmSpy = vi.fn(() => Promise.resolve())
const promptSpy = vi.fn(() => Promise.resolve({ value: 'x' }))
const alertSpy = vi.fn(() => Promise.resolve())
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: {
    confirm: (...a) => confirmSpy(...a),
    prompt: (...a) => promptSpy(...a),
    alert: (...a) => alertSpy(...a)
  }
}))

const openSpy = vi.fn()
const pushSpy = vi.fn()
const resolveSpy = vi.fn(({ name, params }) => ({ href: `/#/${name}/${params?.id}` }))
let routeQuery = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ resolve: resolveSpy, push: (...a) => pushSpy(...a) }),
  useRoute: () => ({ meta: {}, name: 'AdminSkillsUnified', query: routeQuery })
}))

vi.mock('@/components/StatusTag.vue', () => ({ default: { template: '<span><slot /></span>' } }))
vi.mock('@/components/PageHeader.vue', () => ({
  default: { name: 'PageHeader', props: ['title', 'subtitle'], template: '<div :data-title="title" />' }
}))
vi.mock('@/components/admin/VersionDrawer.vue', () => ({ default: { props: ['modelValue', 'adapter'], template: '<div />' } }))
vi.mock('@/components/skill/SkillCreateDialog.vue', () => ({
  default: {
    name: 'SkillCreateDialog',
    props: ['modelValue', 'title', 'typeOptions'],
    template: '<div class="create-dialog-stub" />'
  }
}))

// 2026-09-01 PRD 对齐改造取代旧口径：技能页数据层已加 demo mock 分流（VITE_SKILL_MOCK），
// 测试环境 DEV=true 会短路真实端点与写分流。本文件验证的正是真实端点与分流矩阵，故显式关掉 mock。
vi.stubEnv('VITE_SKILL_MOCK', '0')

const Page = (await import('@/views/admin/AdminSkillsUnified.vue')).default

const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const stubs = {
  'el-input': { name: 'el-input', props: ['modelValue'], template: '<div><slot name="prefix" /></div>' },
  'el-select': { name: 'el-select', props: ['modelValue', 'disabled'], template: '<div><slot /></div>' },
  'el-option': passthrough('el-option'),
  'el-button': { name: 'el-button', template: '<button><slot /></button>' },
  'el-table': passthrough('el-table'),
  // 只渲染 header 插槽：默认插槽是 row 作用域插槽，无 row 数据时渲染会炸（沿用既有技能页测试范式）。
  'el-table-column': {
    name: 'el-table-column',
    props: { label: { type: String, default: '' }, prop: { type: String, default: '' } },
    template: '<div class="el-table-column" :data-label="label"><slot name="header" /></div>'
  },
  'el-tag': passthrough('el-tag'),
  'el-icon': passthrough('el-icon'),
  'el-tooltip': passthrough('el-tooltip'),
  'el-pagination': passthrough('el-pagination'),
  'el-dialog': passthrough('el-dialog'),
  'el-radio-group': passthrough('el-radio-group'),
  'el-radio': passthrough('el-radio'),
  Search: passthrough('Search'),
  Plus: passthrough('Plus')
}

/** 返回 setupState（`<script setup>` 的内部绑定不挂在 mount 返回的 proxy 上，须走 _instance）。 */
// 挂载的 app/host 记账：本页在 onMounted 注册 window focus / visibilitychange 监听，
// 不卸载会让监听跨用例累积（一次事件触发 N 次 fetchList，断言计数必错）。
let mountedApp = null
let mountedHost = null

async function mountPage() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(Page)
  Object.entries(stubs).forEach(([k, v]) => app.component(k, v))
  app.mount(host)
  mountedApp = app
  mountedHost = host
  await nextTick()
  await nextTick()
  return app._instance.setupState
}

afterEach(() => {
  mountedApp?.unmount()
  mountedHost?.remove()
  mountedApp = null
  mountedHost = null
})

const rowPosition = { id: 'sk_p', type: 'POSITION', name: '岗位技能A', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 1 }
const rowPlatform = { id: 'sk_m', type: 'PLATFORM', name: '平台技能B', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 2 }
const rowSystem = { id: 'sk_s', type: 'SYSTEM_DEFAULT', name: '内置技能C', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  routeQuery = {}
  listUnifiedSpy.mockResolvedValue({ list: [], total: 0 })
  listFieldDictSpy.mockResolvedValue({ skillCategory: [{ name: '办公效率' }] })
  confirmSpy.mockResolvedValue()
  window.open = openSpy
})

describe('读：只走聚合端点', () => {
  it('挂载即调 /fde/admin-skills，不碰三个原列表端点', async () => {
    await mountPage()
    expect(listUnifiedSpy).toHaveBeenCalledWith('/fde/admin-skills', expect.anything())
    const position = await import('@/api/position')
    const platform = await import('@/api/platformSkill')
    expect(position.listSkills).not.toHaveBeenCalled()
    expect(platform.platformSkillApi.list).not.toHaveBeenCalled()
    expect(platform.systemSkillApi.list).not.toHaveBeenCalled()
  })

  // 分类固定 8 类（fieldDict 同源）对全部类型开放，类型切换不再清分类；被清的是「引用状态」筛选。
  it('类型切换 → 带 type 重拉且回第 1 页；分类保留、引用筛选被清', async () => {
    const vm = await mountPage()
    vm.query.type = 'POSITION'
    await nextTick()
    vm.page = 3
    vm.query.categoryId = '办公效率'
    vm.query.referenced = 'yes'
    vm.query.type = 'SYSTEM_DEFAULT'
    await nextTick()
    await nextTick()
    expect(vm.query.categoryId).toBe('办公效率') // 分类词表三类通用，不清
    expect(vm.query.referenced).toBe('')        // 引用筛选只对岗位私有有意义 → 被清
    expect(vm.page).toBe(1)
    const lastCall = listUnifiedSpy.mock.calls.at(-1)
    expect(lastCall[1].params.type).toBe('SYSTEM_DEFAULT')
    expect(lastCall[1].params.categoryId).toBe('办公效率')
  })
})

describe('写：分流矩阵（绝不串命名空间）', () => {
  it('岗位私有行删除 → 只调 position 端点', async () => {
    const vm = await mountPage()
    await vm.remove(rowPosition)
    expect(positionRemove).toHaveBeenCalledWith('sk_p')
    expect(platformRemove).not.toHaveBeenCalled()
    expect(systemRemove).not.toHaveBeenCalled()
  })

  it('市场技能行删除 → 只调 platform 端点', async () => {
    const vm = await mountPage()
    await vm.remove(rowPlatform)
    expect(platformRemove).toHaveBeenCalledWith('sk_m')
    expect(positionRemove).not.toHaveBeenCalled()
    expect(systemRemove).not.toHaveBeenCalled()
  })

  it('通用技能行删除 → 只调 system 端点（不落平台前缀，否则后端 404）', async () => {
    const vm = await mountPage()
    await vm.remove(rowSystem)
    expect(systemRemove).toHaveBeenCalledWith('sk_s')
    expect(platformRemove).not.toHaveBeenCalled()
    expect(positionRemove).not.toHaveBeenCalled()
  })

  // 本体状态开关（toggleStatus）已随统一审核状态机废弃：停用统一走 stopSkill 提交停用审核。
  it('停用（提交停用审核）按行类型打各自前缀，绝不落本体状态开关', async () => {
    const vm = await mountPage()
    await vm.stopSkill({ ...rowSystem, publications: [{ target: 'USER_END', status: 'PUBLISHED' }] })
    expect(systemDelist).toHaveBeenCalledWith('sk_s')
    expect(platformDelist).not.toHaveBeenCalled()
    expect(positionSetStatus).not.toHaveBeenCalled()

    await vm.stopSkill({ ...rowPlatform, publications: [{ target: 'USER_END', status: 'PUBLISHED' }] })
    expect(platformDelist).toHaveBeenCalledWith('sk_m')
  })
})

// 删除确认文案统一（不再按类型措辞）；被引用行改为拦截 alert（携引用主体、数量与清单），删除请求根本不发。
describe('文案：删除确认统一、被引用拦截按主体措辞', () => {
  it('删除确认文案统一「删除后「X」将不可用，确认删除？」，成功 toast「技能已删除」', async () => {
    const vm = await mountPage()
    await vm.remove(rowSystem)
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('删除后「内置技能C」将不可用，确认删除？')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('技能已删除')
  })

  it('岗位私有被引用 → 拦截 alert 提示岗位数与清单，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPosition, refCount: 8, refNames: ['销售顾问岗位'] })
    expect(positionRemove).not.toHaveBeenCalled()
    const msg = alertSpy.mock.calls.at(-1)[0]
    expect(msg).toContain('8 个岗位引用')
    expect(msg).toContain('销售顾问岗位')
    expect(msg).toContain('需先解除引用后再删除')
    expect(msg).not.toContain('专家')
  })

  it('市场技能被专家引用 → 拦截 alert 提示专家数，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPlatform, refCount: 2, refNames: [] })
    expect(platformRemove).not.toHaveBeenCalled()
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('2 个专家引用')
  })
})

// 查看/编辑同标签路由跳转；引用情况列「N 个{岗位|专家}引用」（refSubject/refCountOf 派生，点开引用清单弹窗）。
describe('查看/编辑跳转与引用情况派生', () => {
  it('三类各跳各自的编辑路由（同标签 router.push，绝不 window.open）', async () => {
    const vm = await mountPage()
    vm.openEdit(rowPosition)
    vm.openEdit(rowPlatform)
    vm.openEdit(rowSystem)
    const names = pushSpy.mock.calls.map((c) => c[0].name)
    expect(names).toEqual(['AdminSkillEdit', 'SysConfigSkillEdit', 'SysConfigSystemSkillEdit'])
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('「查看」= 编辑路由 + ?view=1 只读（三类技能均有查看入口）', async () => {
    const vm = await mountPage()
    vm.openView(rowPlatform)
    expect(pushSpy).toHaveBeenCalledWith({
      name: 'SysConfigSkillEdit',
      params: { id: 'sk_m' },
      query: { view: '1' }
    })
  })

  it('审核中行编辑被兜底拦下（按钮已置灰，此处防函数级绕过）', async () => {
    const vm = await mountPage()
    vm.openEdit({ ...rowPlatform, publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] })
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('引用主体按类型：岗位私有→岗位、市场技能→专家；计数优先 refCount 新字段', async () => {
    const vm = await mountPage()
    expect(vm.refSubject({ type: 'POSITION' })).toBe('岗位')
    expect(vm.refSubject({ type: 'PLATFORM' })).toBe('专家')
    expect(vm.refCountOf({ type: 'POSITION', refCount: 3 })).toBe(3)
    expect(vm.refCountOf({ type: 'POSITION', referencedByPositionCount: 8 })).toBe(8)
    expect(vm.refCountOf({ type: 'PLATFORM', referencedByExpertCount: 2 })).toBe(2)
  })

  // 回归守护（2026-08-23 实库对账查出）：expert_skill 是 V21 弃用表，新模型不写，
  // 存量残留不得让岗位私有技能凭空算出「专家」引用。
  it('岗位私有绝不按「专家」计数——弃用表 expert_skill 的残值不得回流 UI', async () => {
    const vm = await mountPage()
    expect(vm.refSubject({ type: 'POSITION' })).toBe('岗位')
    expect(
      vm.refCountOf({ type: 'POSITION', referencedByPositionCount: 0, referencedByExpertCount: 7 })
    ).toBe(0)
  })

  it('引用清单弹窗：标题按主体切换，正文名称顿号连接', async () => {
    const vm = await mountPage()
    vm.openRefs({ type: 'POSITION', refCount: 2, refNames: ['销售顾问岗位', '财务运营岗位'] })
    expect(vm.refsVisible).toBe(true)
    expect(vm.refsTitle).toBe('被岗位引用')
    expect(vm.refsText).toBe('销售顾问岗位、财务运营岗位')
    vm.openRefs({ type: 'PLATFORM', refCount: 1, refNames: ['法务合规专家'] })
    expect(vm.refsTitle).toBe('被专家引用')
  })
})

describe('状态列：内部 7 态收拢为对外 3 态', () => {
  const pub = (status, reviewPending = false) => [{ target: 'USER_END', status, reviewPending }]

  it('已发布 ← PUBLISHED 且无新版在审', async () => {
    const vm = await mountPage()
    const row = { type: 'PLATFORM', publications: pub('PUBLISHED') }
    expect(vm.displayStateLabel(row)).toBe('已发布')
    expect(vm.displayStateTag(row)).toBe('success')
  })

  it('审核中 ← 首发在审 / 已发布+新版在审 / 已下架+新版在审', async () => {
    const vm = await mountPage()
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: pub('PENDING_REVIEW') })).toBe('审核中')
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: pub('PUBLISHED', true) })).toBe('审核中')
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: pub('DELISTED', true) })).toBe('审核中')
  })

  it('未发布 ← 初始（无发布行）/ 已驳回 / 已下架', async () => {
    const vm = await mountPage()
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: [] })).toBe('未发布')
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: pub('REJECTED') })).toBe('未发布')
    expect(vm.displayStateLabel({ type: 'PLATFORM', publications: pub('DELISTED') })).toBe('未发布')
  })

  // 2026-09-01：岗位私有已接入同构状态机（mock 派生 publications）——三态口径与平台族一致；
  // 无 publications 的存量行按本体 status 兜底。
  it('岗位私有走同构状态机；无 publications 的存量行按本体 status 兜底', async () => {
    const vm = await mountPage()
    expect(vm.displayStateLabel({ type: 'POSITION', publications: pub('PENDING_REVIEW') })).toBe('审核中')
    expect(vm.displayStateLabel({ type: 'POSITION', status: 'published', publications: null })).toBe('已发布')
    expect(vm.displayStateLabel({ type: 'POSITION', status: 'draft', publications: null })).toBe('未发布')
  })

  it('三态之外不产生任何其它文案（收拢完备性）', async () => {
    const vm = await mountPage()
    const all = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'DELISTED'].flatMap((s) => [
      { type: 'PLATFORM', publications: pub(s, false) },
      { type: 'PLATFORM', publications: pub(s, true) }
    ])
    const labels = new Set(all.map((r) => vm.displayStateLabel(r)))
    expect([...labels].every((l) => ['已发布', '审核中', '未发布'].includes(l))).toBe(true)
  })
})

describe('状态列：V100 停用审核态（回归守护）', () => {
  const delisting = [{ target: 'USER_END', status: 'PUBLISHED', pendingAction: 'DELIST' }]

  it('待审停用（status=PUBLISHED + pendingAction=DELIST）显「审核中」，不得显「未发布」', async () => {
    // 历史 bug：PUB_STATE_TO_DISPLAY 漏 PUBLISHED_DELISTING 键 → 兜底成「未发布」，
    // 而该技能线上仍在服务，状态列与操作列自相矛盾。
    const vm = await mountPage()
    const row = { type: 'PLATFORM', publications: delisting }
    expect(vm.displayStateLabel(row)).toBe('审核中')
  })

  it('映射表覆盖 derivePlatformState 的全部返回态（新增态不得静默兜底）', async () => {
    const vm = await mountPage()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = [
      [{ target: 'USER_END', status: 'PENDING_REVIEW' }],
      [{ target: 'USER_END', status: 'PUBLISHED' }],
      [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: true }],
      [{ target: 'USER_END', status: 'PUBLISHED', pendingAction: 'DELIST' }],
      [{ target: 'USER_END', status: 'REJECTED' }],
      [{ target: 'USER_END', status: 'DELISTED' }],
      [{ target: 'USER_END', status: 'DELISTED', reviewPending: true }],
      []
    ]
    for (const publications of all) {
      const label = vm.displayStateLabel({ type: 'PLATFORM', publications })
      expect(['已发布', '审核中', '未发布']).toContain(label)
    }
    // 全部命中映射表 → 一次 warn 都不该有
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

// 2026-09-01 PRD 对齐改造取代旧口径（canRemove 已废弃）：操作列按三态出按钮。
describe('操作列：三态判定 + 发布就绪门（原型 skillActions 最终覆写态）', () => {
  const pub = (status, extra = {}) => [{ target: 'USER_END', status, ...extra }]

  it('三态判定：未发布可删可发；审核中只撤回；已发布停用+版本管理', async () => {
    const vm = await mountPage()
    expect(vm.isUnpublished({ type: 'PLATFORM', publications: [] })).toBe(true)
    expect(vm.isReviewing({ type: 'PLATFORM', publications: pub('PENDING_REVIEW') })).toBe(true)
    expect(vm.isPublished({ type: 'PLATFORM', publications: pub('PUBLISHED') })).toBe(true)
    // 待审停用（PUBLISHED + pendingAction=DELIST）归审核中——不得再出「停用」入口（重复提交 409）
    expect(vm.isReviewing({ type: 'PLATFORM', publications: pub('PUBLISHED', { pendingAction: 'DELIST' }) })).toBe(true)
  })

  it('发布就绪门：必填齐 → 就绪提示；缺项 → 「请先补齐必填项：…」按原型同序列出缺项', async () => {
    const vm = await mountPage()
    const ready = {
      type: 'PLATFORM', name: 'X', displayCategoryId: '办公效率', icon: '▤',
      description: 'd', exampleQuestion: 'q', hasSkillMd: true, publications: []
    }
    expect(vm.readinessOf(ready).ready).toBe(true)
    expect(vm.publishTitle(ready)).toBe('发布将提交审核，审核通过后生成版本快照并上线')

    const missing = { type: 'PLATFORM', name: '', displayCategoryId: null, icon: '', description: '', exampleQuestion: '', hasSkillMd: false, publications: [] }
    const r = vm.readinessOf(missing)
    expect(r.ready).toBe(false)
    expect(vm.publishTitle(missing)).toContain('请先补齐必填项：')
    expect(r.missing).toEqual(['技能名称', '技能分类', '图标', '技能描述', '示例问题', 'SKILL.md'])
  })

  it('未就绪时 openPublish 被门拦下，不开版本管理抽屉', async () => {
    const vm = await mountPage()
    vm.openPublish({ type: 'PLATFORM', name: '', publications: [] })
    expect(vm.verMgrVisible).toBe(false)
  })

  it('撤回：确认后按行类型分流 withdrawPublish，toast「已撤回」', async () => {
    const vm = await mountPage()
    await vm.withdraw({ ...rowPlatform, publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] })
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('撤回本次提交后将回到修改前状态。确认撤回？')
    expect(platformWithdraw).toHaveBeenCalledWith('sk_m')
    expect(systemWithdraw).not.toHaveBeenCalled()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已撤回')
  })

  it('停用确认文案对齐原型，成功 toast「已提交停用审核」', async () => {
    const vm = await mountPage()
    await vm.stopSkill({ ...rowPlatform, publications: [{ target: 'USER_END', status: 'PUBLISHED' }] })
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('停用「平台技能B」需提交停用审核。审核通过前客户端仍可使用。')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('停用被引用 → 拦截 alert（含引用清单），不发请求', async () => {
    const vm = await mountPage()
    await vm.stopSkill({
      ...rowPlatform,
      refCount: 2,
      refNames: ['经营分析专家', '法务合规专家'],
      publications: [{ target: 'USER_END', status: 'PUBLISHED' }]
    })
    expect(platformDelist).not.toHaveBeenCalled()
    const msg = alertSpy.mock.calls.at(-1)[0]
    expect(msg).toContain('2 个专家引用')
    expect(msg).toContain('经营分析专家、法务合规专家')
    expect(msg).toContain('需先解除引用后再停用')
  })
})

describe('最新版本列：展示当前已发布的版本号', () => {
  it('新版在审时仍显线上那一版（不显在审的新版号）', async () => {
    const vm = await mountPage()
    const row = {
      type: 'PLATFORM',
      versionLabel: 'v1.0.0',
      publications: [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: true }]
    }
    expect(vm.displayStateLabel(row)).toBe('审核中')
    expect(vm.latestVersion(row)).toBe('v1.0.0')   // 线上实际在服务的版本
  })

  it('尚无已发布版本 → 空（列上显占位符）', async () => {
    const vm = await mountPage()
    expect(vm.latestVersion({ type: 'POSITION', versionLabel: null })).toBe('')
    expect(vm.latestVersion({ type: 'PLATFORM', versionLabel: null, publications: [] })).toBe('')
  })
})

describe('P0-4：引用状态筛选 + ?referenced 深链（疑点7 保留）', () => {
  it('深链 ?referenced=no → 自动落「岗位私有 + 未被引用」，参数正确下发', async () => {
    routeQuery = { referenced: 'no' }
    const vm = await mountPage()
    expect(vm.query.type).toBe('POSITION')
    expect(vm.query.referenced).toBe('no')
    const params = listUnifiedSpy.mock.calls.at(-1)[1].params
    expect(params.type).toBe('POSITION')
    expect(params.referenced).toBe(false)   // 'no' → 布尔 false
  })

  it('深链只预置一次、不重复请求首屏', async () => {
    routeQuery = { referenced: 'no' }
    await mountPage()
    await nextTick()
    await nextTick()
    expect(listUnifiedSpy.mock.calls.length).toBe(1)
  })

  it('非岗位私有类型不下发 referenced（否则平台族会被整体判为未被引用）', async () => {
    const vm = await mountPage()
    vm.query.referenced = 'no'
    vm.query.type = 'PLATFORM'
    await nextTick()
    await nextTick()
    expect(listUnifiedSpy.mock.calls.at(-1)[1].params.referenced).toBeUndefined()
  })

  it('切离岗位私有时清空引用状态筛选值', async () => {
    const vm = await mountPage()
    vm.query.type = 'POSITION'
    await nextTick()
    vm.query.referenced = 'yes'
    vm.query.type = 'SYSTEM_DEFAULT'
    await nextTick()
    await nextTick()
    expect(vm.query.referenced).toBe('')
  })

  it('引用状态筛选仅岗位私有可用', async () => {
    const vm = await mountPage()
    expect(vm.referencedFilterEnabled).toBe(false)   // 默认「全部技能类型」
    vm.query.type = 'POSITION'
    await nextTick()
    expect(vm.referencedFilterEnabled).toBe(true)
  })
})

describe('分类选项 / 自动刷新 / 分页', () => {
  // 2026-09-01：分类选项改从 fieldDict（skillCategory 字段）同源取，demo 用「分类名」充当 id。
  it('挂载从 fieldDict 拉分类选项（名即 id）；skillCategory.js 列表接口零调用', async () => {
    const vm = await mountPage()
    expect(listFieldDictSpy).toHaveBeenCalled()
    expect(listSkillCategoriesSpy).not.toHaveBeenCalled()
    expect(vm.categoryOptions).toEqual([{ id: '办公效率', name: '办公效率' }])
  })

  it('分类选项拉取失败 → 降级为空数组，不阻断列表', async () => {
    listFieldDictSpy.mockRejectedValueOnce(new Error('boom'))
    const vm = await mountPage()
    expect(vm.categoryOptions).toEqual([])
    expect(listUnifiedSpy).toHaveBeenCalled()   // 列表照常
  })

  it('纯 focus（未曾隐藏）不刷新；隐藏过再 focus → 刷新', async () => {
    await mountPage()
    const before = listUnifiedSpy.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(listUnifiedSpy.mock.calls.length).toBe(before)   // 未曾隐藏 → 不刷新

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(listUnifiedSpy.mock.calls.length).toBe(before + 1)
  })

  it('列表带 page/size；翻页与搜索各自重拉', async () => {
    const vm = await mountPage()
    expect(listUnifiedSpy.mock.calls.at(-1)[1].params).toMatchObject({ page: 1 })

    vm.page = 2
    vm.fetchList()
    await nextTick()
    expect(listUnifiedSpy.mock.calls.at(-1)[1].params.page).toBe(2)

    vm.reload()   // 搜索回第 1 页
    await nextTick()
    expect(listUnifiedSpy.mock.calls.at(-1)[1].params.page).toBe(1)
  })
})

// 2026-09-01：新建弹窗每包/手动均必选技能分类（fieldDict 同源），createFn 契约升级为
// ({ name, categoryName })（统一走 createSkillOfType，mock 关闭时按旧端点契约仅传 name）；
// 手动创建成功 → toast + 同标签进编辑页；zip 导入完成统一返回列表。
describe('新建：类型 + 每包独立分类（2026-09-01）', () => {
  it('typeOptions 覆盖三类且顺序按 md（岗位私有/市场技能/通用技能），各自 source 正确', async () => {
    const vm = await mountPage()
    const opts = vm.createTypeOptions
    expect(opts.map((o) => o.value)).toEqual(['POSITION', 'PLATFORM', 'SYSTEM_DEFAULT'])
    expect(opts.map((o) => o.label)).toEqual(['岗位私有', '市场技能', '通用技能'])
    const byType = Object.fromEntries(opts.map((o) => [o.value, o]))
    expect(byType.SYSTEM_DEFAULT.source).toBe('system')
    expect(byType.PLATFORM.source).toBe('platform')
    expect(byType.POSITION.source).toBe('fde')
  })

  it('三类各映射到各自的建空技能函数（新签名 { name, categoryName }）', async () => {
    const vm = await mountPage()
    const byType = Object.fromEntries(vm.createTypeOptions.map((o) => [o.value, o]))
    await byType.POSITION.createFn({ name: '技能X', categoryName: '办公效率' })
    // mock 关闭（VITE_SKILL_MOCK=0）时走真实端点契约：仅传 name（分类由编辑页补）
    expect(positionCreate).toHaveBeenCalledWith({ name: '技能X' })
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  it('不再有前置类型窗与二次确认：openCreate 直接开弹窗、不弹 confirm', async () => {
    const vm = await mountPage()
    confirmSpy.mockClear()
    vm.openCreate()
    await nextTick()
    expect(vm.createVisible).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('手动创建成功：toast「技能已创建，已进入编辑页」+ 按回传 skillType 同标签进编辑页', async () => {
    const vm = await mountPage()
    pushSpy.mockClear()
    vm.onSkillCreated({ skillId: 'sk_new', skillType: 'SYSTEM_DEFAULT' })
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('技能已创建，已进入编辑页')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'SysConfigSystemSkillEdit', params: { id: 'sk_new' } })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('zip 导入完成统一返回列表：toast「已导入 N 个技能包，请从列表点击编辑继续配置」+ 刷列表不跳编辑页', async () => {
    const vm = await mountPage()
    pushSpy.mockClear()
    const before = listUnifiedSpy.mock.calls.length
    vm.onSkillsCreatedBatch({ skillIds: ['sk_a', 'sk_b'], skillType: 'PLATFORM' })
    await nextTick()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已导入 2 个技能包，请从列表点击编辑继续配置')
    expect(pushSpy).not.toHaveBeenCalled()
    expect(listUnifiedSpy.mock.calls.length).toBe(before + 1)
  })
})
