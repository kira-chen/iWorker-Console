// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * 「技能」页（三类合一）单测。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §一 / §二.1 L47 / §二.2 L54 / §二.3.1 L61-65 / §四；
 * 文末两个 describe（操作列行渲染 + 右钉列守卫 / 版本管理适配器 + 排序切换）为审计 T49①/T54 新增，
 * 行数据直接注入 rows、适配器为纯函数。
 * 真实 ElementPlus 挂载冒烟见 adminSkillsUnifiedSmoke.test.js。
 *
 * 【2026-09-12 审计 J4 闭环：去掉 stubEnv('VITE_SKILL_MOCK','0')】
 * 此前 7 条「端点分支」用例断的是 demo 永远不走的真实端点（/fde/admin-skills、三套命名空间的 request 调用），
 * 页面层对 mock 路径零用例。现在数据一律走真 unifiedSkillMock（demo 默认路径），用例改断**用户可见结果**：
 * 删除后行消失 + toast、停用后状态列「审核中」、撤回后恢复、类型切换只剩该类型且回第 1 页、深链只出未被引用的
 * 岗位私有行、翻页切片…；@/api/request 仍换成桩，只用来断言「真实端点零调用」。
 * unifiedSkillMock 是模块级共享内存：破坏性用例一律自建技能行；动到种子（sk_302 / sk_303 / sk_308）的用例
 * 在 afterEach 用 _reset 复位，避免随机顺序下互相污染。
 * mock 各写点内置 delay(60~120ms)，用 settle() 真等再冲刷渲染队列。
 *
 * 2026-09-01 PRD 对齐改造取代旧口径（页面按交互原型 v2 最终覆写态重构，本文件整体重写）：
 * - 类型词表：岗位私有 / 市场技能 / 通用技能；三类统一三态（未发布/审核中/已发布）；
 * - 旧「本体状态开关 toggleStatus / 下架 offlineSkill / 上架 onlineSkill / canRemove 删除门控」全部废弃：
 *   操作列按三态出按钮（固定 查看/编辑；未发布 发布+删除；审核中 撤回；已发布 停用+版本管理）；
 * - 停用 = 提交停用审核（stopSkill，被引用拦截 alert）；删除确认文案统一、被引用拦截 alert；
 * - 分类筛选固定 11 类（fieldDict 同源）对全部类型开放，类型切换不再清分类（只清引用筛选）；
 * - 查看/编辑同标签路由跳转（router.push；查看 = 编辑路由 + ?view=1），不再 window.open 新标签；
 * - 发布就绪门与编辑页共用 skillPublishReadiness（api/unifiedSkill.js）。
 */

// 真实端点桩：demo 路径下一次都不该被调到（每条用例末尾靠 vi.clearAllMocks 归零）
const realGet = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
const realPost = vi.fn(() => Promise.resolve({}))
const realDelete = vi.fn(() => Promise.resolve({}))
vi.mock('@/api/request', () => ({
  default: { get: (...a) => realGet(...a), post: (...a) => realPost(...a), put: vi.fn(), delete: (...a) => realDelete(...a) },
  // unifiedSkillMock 用 new ApiError({ code, message }) 抛错：桩必须接同一形状，否则 e.message 变 [object Object]
  ApiError: class ApiError extends Error {
    constructor({ code, message } = {}) {
      super(message)
      this.code = code
    }
  }
}))

// 真 unifiedSkillMock，仅把 listUnifiedSkills 包一层 vi.fn 以便断请求次数 / 下发参数（行为不变）
const listSpy = vi.fn()
vi.mock('@/api/unifiedSkillMock', async (importOriginal) => {
  const actual = await importOriginal()
  listSpy.mockImplementation(actual.listUnifiedSkills)
  return { ...actual, listUnifiedSkills: (...a) => listSpy(...a) }
})
const skillMock = await import('@/api/unifiedSkillMock')

// 2026-09-01：分类选项改走 fieldDict 同源字典（固定 11 类）；skillCategory.js 列表接口不再被本页调用。
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
  // 动过种子的用例复位（随机顺序下不互相污染）：303 已发布无在途；302 已发布 + 新版在审；308 首发在审
  skillMock._reset('sk_303', { pendingAction: null, pendingVersion: '', pendingReleaseNotes: '' })
  skillMock._reset('sk_302', { pendingAction: 'publish', pendingVersion: 'v1.5.0', pendingReleaseNotes: '补充经营异常归因说明' })
  skillMock._reset('sk_308', { pendingAction: 'publish', pendingVersion: 'v1.0.0', pendingReleaseNotes: '首次发布' })
})

/** 真等 mock 的 delay（≤120ms）落库，再冲刷渲染队列。 */
async function settle(ms = 160) {
  await new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 4; i++) await nextTick()
}
/** 挂载 + 等首屏列表从 mock 回来。 */
async function mountLoaded() {
  const vm = await mountPage()
  await settle()
  return vm
}
/** 自建一行技能（破坏性用例专用，不动种子）。 */
async function mkSkill(name, type) {
  const { skillId } = await skillMock.createSkill({ name, type, categoryName: '办公效率' })
  return skillId
}
const rowById = (vm, id) => vm.rows.find((r) => r.id === id)

const rowPosition = { id: 'sk_p', type: 'POSITION', name: '岗位技能A', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 1 }
const rowPlatform = { id: 'sk_m', type: 'PLATFORM', name: '平台技能B', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 2 }
const rowSystem = { id: 'sk_s', type: 'SYSTEM_DEFAULT', name: '内置技能C', status: 'draft', refCount: 0, refNames: [], publications: [], toolCount: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  routeQuery = {}
  listFieldDictSpy.mockResolvedValue({ skillCategory: [{ name: '办公效率' }] })
  confirmSpy.mockResolvedValue()
  window.open = openSpy
})

describe('读：数据走真 unifiedSkillMock（demo 默认路径），真实端点零调用', () => {
  it('挂载即从 mock 取回种子行（默认按最近更新时间由近到远、切到动态每页条数），/fde/admin-skills 等真实端点零调用（md §二.1 L47）', async () => {
    const vm = await mountLoaded()
    expect(realGet).not.toHaveBeenCalled()
    expect(vm.total).toBeGreaterThanOrEqual(9) // 9 条种子（其它用例可能自建行，只断下限）
    expect(vm.rows.length).toBe(Math.min(vm.total, vm.pageSize))
    expect(vm.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['行业研究助手', '合同风险检查']))
    const times = vm.rows.map((r) => r.updatedAt)
    expect([...times].sort().reverse()).toEqual(times) // desc
  })

  // 分类固定 11 类（fieldDict 同源）对全部类型开放，类型切换不再清分类；被清的是「引用状态」筛选。
  it('类型切换 → 列表只剩该类型行且回第 1 页；分类保留（并生效）、引用筛选被清', async () => {
    const vm = await mountLoaded()
    vm.query.type = 'POSITION'
    await settle()
    vm.page = 3
    vm.query.categoryId = '办公效率'
    vm.query.type = 'SYSTEM_DEFAULT'
    await settle()
    expect(vm.query.categoryId).toBe('办公效率') // 分类词表三类通用，不清
    expect(vm.page).toBe(1)
    expect(vm.rows.length).toBeGreaterThan(0)
    expect(vm.rows.every((r) => r.type === 'SYSTEM_DEFAULT' && r.displayCategoryId === '办公效率')).toBe(true)
    expect(vm.rows.map((r) => r.name)).toContain('会议纪要整理') // 种子 303：通用技能 · 办公效率
    expect(realGet).not.toHaveBeenCalled()
  })
})

describe('写：三类行的删除 / 停用 / 撤回都落到真 mock（用户可见结果），真实端点零调用', () => {
  it('三类行删除 → 确认文案统一「删除后「X」将不可用，确认删除？」→ 行从列表消失 + toast「技能已删除」+ mock 里查不到', async () => {
    const ids = {
      POSITION: await mkSkill('J4删除·岗位私有', 'POSITION'),
      PLATFORM: await mkSkill('J4删除·市场技能', 'PLATFORM'),
      SYSTEM_DEFAULT: await mkSkill('J4删除·通用技能', 'SYSTEM_DEFAULT')
    }
    const vm = await mountLoaded()
    const { ElMessage } = await import('element-plus')
    for (const [type, id] of Object.entries(ids)) {
      const row = rowById(vm, id)
      expect(row?.type).toBe(type)
      await vm.remove(row)
      await settle()
      expect(confirmSpy.mock.calls.at(-1)[0]).toBe(`删除后「${row.name}」将不可用，确认删除？`)
      expect(ElMessage.success).toHaveBeenLastCalledWith('技能已删除')
      expect(rowById(vm, id)).toBeUndefined()
      await expect(skillMock.getSkillDetail(id)).rejects.toThrow('技能不存在')
    }
    expect(realDelete).not.toHaveBeenCalled()
    expect(realPost).not.toHaveBeenCalled()
  })

  it('停用（提交停用审核）：确认文案对齐原型 → 状态列「审核中」+ toast「已提交停用审核」；撤回 → 恢复「已发布」+ toast「已撤回」（md §二.2 L119 / §二.3.5）', async () => {
    const vm = await mountLoaded()
    const row = rowById(vm, 'sk_303') // 种子 303：通用技能 · 已发布 · 无引用
    expect(vm.displayStateLabel(row)).toBe('已发布')
    await vm.stopSkill(row)
    await settle()
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('停用「会议纪要整理」需提交停用审核。审核通过前客户端仍可使用。')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenLastCalledWith('已提交停用审核')
    expect(vm.displayStateLabel(rowById(vm, 'sk_303'))).toBe('审核中')
    expect(skillMock._getRaw('sk_303').pendingAction).toBe('stop')

    await vm.withdraw(rowById(vm, 'sk_303'))
    await settle()
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('撤回本次提交后将回到修改前状态。确认撤回？')
    expect(ElMessage.success).toHaveBeenLastCalledWith('已撤回')
    expect(vm.displayStateLabel(rowById(vm, 'sk_303'))).toBe('已发布')
    expect(realPost).not.toHaveBeenCalled()
    expect(realDelete).not.toHaveBeenCalled()
  })

  it('撤回在审提交按 version 空/非空恢复：首发在审的岗位私有 308 → 「未发布」；新版在审的市场技能 302 → 「已发布」（md §二.2 L119）', async () => {
    const vm = await mountLoaded()
    expect(vm.displayStateLabel(rowById(vm, 'sk_308'))).toBe('审核中')
    await vm.withdraw(rowById(vm, 'sk_308'))
    await settle()
    expect(vm.displayStateLabel(rowById(vm, 'sk_308'))).toBe('未发布')

    expect(vm.displayStateLabel(rowById(vm, 'sk_302'))).toBe('审核中')
    await vm.withdraw(rowById(vm, 'sk_302'))
    await settle()
    expect(vm.displayStateLabel(rowById(vm, 'sk_302'))).toBe('已发布')
    expect(vm.latestVersion(rowById(vm, 'sk_302'))).toBe('v1.4.0') // 线上版本不受撤回影响
    expect(realDelete).not.toHaveBeenCalled()
  })
})

// 删除确认文案统一（不再按类型措辞）；被引用行改为拦截 alert（携引用主体、数量与清单），删除请求根本不发。
describe('文案：删除确认统一、被引用拦截按主体措辞', () => {
  it('删除失败（mock 拒绝：被引用的种子 307）→ alert「无法删除」携 mock 文案，技能仍在', async () => {
    const vm = await mountLoaded()
    // 种子 307（市场技能，被 1 个专家引用）：页面前置拦截看的是行上的 refCount 字段，这里模拟列表字段缺失
    // 绕过前置门，由真 mock 的引用保护兜底拒绝（307 更新时间最早、不在首页，直接构造行）
    const row = { id: 'sk_307', type: 'PLATFORM', name: '竞品信息汇总', refCount: 0, refNames: [], publications: [] }
    await vm.remove(row)
    await settle()
    expect(alertSpy.mock.calls.at(-1)[1]).toBe('无法删除')
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('引用')
    expect((await skillMock.getSkillDetail('sk_307')).name).toBe('竞品信息汇总')
  })

  it('岗位私有被引用 → 拦截 alert 提示岗位数与清单，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPosition, refCount: 8, refNames: ['销售顾问岗位'] })
    expect(realDelete).not.toHaveBeenCalled()
    const msg = alertSpy.mock.calls.at(-1)[0]
    expect(msg).toContain('8 个岗位引用')
    expect(msg).toContain('销售顾问岗位')
    expect(msg).toContain('需先解除引用后再删除')
    expect(msg).not.toContain('专家')
  })

  it('市场技能被专家引用 → 拦截 alert 提示专家数，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPlatform, refCount: 2, refNames: [] })
    expect(realDelete).not.toHaveBeenCalled()
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

  it('撤回 / 停用取消确认 → 不落任何写操作、状态不变', async () => {
    const vm = await mountLoaded()
    confirmSpy.mockRejectedValue(new Error('cancel'))
    await vm.withdraw(rowById(vm, 'sk_302'))
    await vm.stopSkill(rowById(vm, 'sk_303'))
    await settle()
    expect(vm.displayStateLabel(rowById(vm, 'sk_302'))).toBe('审核中')
    expect(vm.displayStateLabel(rowById(vm, 'sk_303'))).toBe('已发布')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('停用后 mock 已被引用的行（种子 309 停用在审）不再出「停用」；停用被引用行走前置 alert 不发请求', async () => {
    const vm = await mountLoaded()
    expect(vm.isReviewing(rowById(vm, 'sk_309'))).toBe(true)
    const before = skillMock._getRaw('sk_302').pendingAction
    await vm.stopSkill(rowById(vm, 'sk_302')) // 302 被 3 个专家引用 → 前置拦截
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('3 个专家引用')
    expect(skillMock._getRaw('sk_302').pendingAction).toBe(before)
  })

  it('停用被引用 → 拦截 alert（含引用清单），不发请求', async () => {
    const vm = await mountPage()
    await vm.stopSkill({
      ...rowPlatform,
      refCount: 2,
      refNames: ['经营分析专家', '法务合规专家'],
      publications: [{ target: 'USER_END', status: 'PUBLISHED' }]
    })
    expect(realPost).not.toHaveBeenCalled()
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

describe('分类选项 / 自动刷新 / 分页', () => {
  // 2026-09-01：分类选项改从 fieldDict（skillCategory 字段）同源取，demo 用「分类名」充当 id。
  it('挂载从 fieldDict 拉分类选项（名即 id）；skillCategory.js 列表接口零调用', async () => {
    const vm = await mountPage()
    expect(listFieldDictSpy).toHaveBeenCalled()
    expect(listSkillCategoriesSpy).not.toHaveBeenCalled()
    expect(vm.categoryOptions).toEqual([{ id: '办公效率', name: '办公效率' }])
  })

  it('分类选项拉取失败 → 降级为空数组，不阻断列表（种子行照常出来）', async () => {
    listFieldDictSpy.mockRejectedValueOnce(new Error('boom'))
    const vm = await mountLoaded()
    expect(vm.categoryOptions).toEqual([])
    expect(vm.rows.length).toBeGreaterThan(0)   // 列表照常
  })

  it('纯 focus（未曾隐藏）不刷新；隐藏过再 focus → 刷新', async () => {
    await mountLoaded()
    const before = listSpy.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(listSpy.mock.calls.length).toBe(before)   // 未曾隐藏 → 不刷新

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(listSpy.mock.calls.length).toBe(before + 1)
  })

  it('分页：按每页条数切片；翻到第 2 页换一批行；搜索（reload）回第 1 页', async () => {
    const vm = await mountLoaded()
    vm.pageSize = 4
    vm.fetchList()
    await settle()
    expect(vm.page).toBe(1)
    expect(vm.rows.length).toBe(4)
    const firstPageIds = vm.rows.map((r) => r.id)

    vm.page = 2
    vm.fetchList()
    await settle()
    expect(listSpy.mock.calls.at(-1)[0]).toMatchObject({ page: 2, size: 4 })
    expect(vm.rows.length).toBeGreaterThan(0)
    expect(vm.rows.some((r) => firstPageIds.includes(r.id))).toBe(false) // 第 2 页是另一批

    vm.reload()   // 搜索回第 1 页
    await settle()
    expect(vm.page).toBe(1)
    expect(vm.rows.map((r) => r.id)).toEqual(firstPageIds)
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

  it('三类 createFn（新签名 { name, categoryName }）→ 真 mock 建出对应类型、带分类的空白技能（md §二.2 L152）', async () => {
    const vm = await mountPage()
    const byType = Object.fromEntries(vm.createTypeOptions.map((o) => [o.value, o]))
    for (const type of ['POSITION', 'PLATFORM', 'SYSTEM_DEFAULT']) {
      const { skillId } = await byType[type].createFn({ name: `J4新建·${type}`, categoryName: '办公效率' })
      const d = await skillMock.getSkillDetail(skillId)
      expect(d.type).toBe(type)
      expect(d.displayCategoryId).toBe('办公效率')
      expect(d.publications).toEqual([]) // 初始未发布
      await skillMock.removeSkill(skillId) // 收尾，不污染其它用例的列表
    }
    expect(realPost).not.toHaveBeenCalled()
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

  // 2026-09-04 PRD-20260903 对齐：toast 文案「编辑」改带直引号（照新原型逐字）
  it('zip 导入完成统一返回列表：toast「已导入 N 个技能包，请从列表点击"编辑"继续配置」+ 刷列表不跳编辑页', async () => {
    const vm = await mountPage()
    pushSpy.mockClear()
    const before = listSpy.mock.calls.length
    vm.onSkillsCreatedBatch({ skillIds: ['sk_a', 'sk_b'], skillType: 'PLATFORM' })
    await nextTick()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已导入 2 个技能包，请从列表点击"编辑"继续配置')
    expect(pushSpy).not.toHaveBeenCalled()
    expect(listSpy.mock.calls.length).toBe(before + 1)
  })
})

/* ====================================================================================== */
// 2026-09-12 审计 T49①：操作列真正渲染出来的按钮 / 置灰 / title（md §二.3.1 L61-65），此前只断言 isReviewing 等谓词。
// 行数据直接注入 rows（useAdminList 的 ref），不经列表数据源。
describe('操作列行渲染：三态按钮组合 + 置灰 title（md L61-65）+ 右钉列只有「操作」一列（fe11191 防回归）', () => {
  const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
  const rowStubs = {
    ...stubs,
    'el-table': tableStub,
    'el-table-column': tableColStub,
    // 透传 disabled / title（HTML 属性透传到根 button，便于断言置灰与悬停提示）
    'el-button': { name: 'el-button', props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' }
  }
  async function mountRows(rowsData) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Page)
    Object.entries(rowStubs).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host
    await nextTick()
    await nextTick()
    const vm = app._instance.setupState
    vm.rows = rowsData
    await nextTick()
    await nextTick()
    return { vm, host }
  }
  const ready = { displayCategoryId: '办公效率', icon: '▤', description: 'd', exampleQuestion: 'q', hasSkillMd: true }
  const unpublishedReady = { ...rowPlatform, ...ready, id: 'r_unpub', name: '未发布就绪' }
  const unpublishedMissing = { ...rowPlatform, id: 'r_miss', name: '', displayCategoryId: null, icon: '', description: '', exampleQuestion: '', hasSkillMd: false }
  const reviewing = { ...rowPlatform, ...ready, id: 'r_rev', name: '审核中技能', publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] }
  const published = { ...rowPlatform, ...ready, id: 'r_pub', name: '已发布技能', versionLabel: 'v1.0.0', publications: [{ target: 'USER_END', status: 'PUBLISHED' }] }
  const opsCellOf = (host, id) => {
    const row = [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes(id))
    return row.querySelector('.el-table-column[data-label="操作"]')
  }
  const btnTexts = (cell) => [...cell.querySelectorAll('button')].map((b) => b.textContent.trim())
  const btn = (cell, t) => [...cell.querySelectorAll('button')].find((b) => b.textContent.trim() === t)

  it('未发布 → 查看 / 编辑 / 发布 / 删除 4 个按钮；【删除】title「删除前需二次确认」；就绪时【发布】可点且 title 为发布说明（md L63）', async () => {
    const { host } = await mountRows([unpublishedReady])
    const cell = opsCellOf(host, '未发布就绪')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '发布', '删除'])
    expect(btn(cell, '编辑').disabled).toBe(false)
    expect(btn(cell, '发布').disabled).toBe(false)
    expect(btn(cell, '发布').getAttribute('title')).toBe('发布将提交审核，审核通过后生成版本快照并上线')
    expect(btn(cell, '删除').getAttribute('title')).toBe('删除前需二次确认')
  })

  it('未发布缺必填项 → 【发布】置灰，title「请先补齐必填项：…」列出缺项（md L59/L138）', async () => {
    const { host } = await mountRows([unpublishedMissing])
    const cell = opsCellOf(host, '—') // 名称空，用占位符行定位
    const pub = btn(cell, '发布')
    expect(pub.disabled).toBe(true)
    expect(pub.getAttribute('title')).toContain('请先补齐必填项：')
    expect(pub.getAttribute('title')).toContain('技能名称')
    expect(pub.getAttribute('title')).toContain('SKILL.md')
  })

  it('审核中 → 查看 / 编辑（置灰，title「审核中不可编辑」）/ 撤回 共 3 个；不出发布/删除/停用/版本管理（md L61/L64/L68）', async () => {
    const { host } = await mountRows([reviewing])
    const cell = opsCellOf(host, '审核中技能')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '撤回'])
    const edit = btn(cell, '编辑')
    expect(edit.disabled).toBe(true)
    expect(edit.getAttribute('title')).toBe('审核中不可编辑')
  })

  it('已发布 → 查看 / 编辑 / 停用 / 版本管理 4 个；【编辑】可点、无 title（md L65）', async () => {
    const { host } = await mountRows([published])
    const cell = opsCellOf(host, '已发布技能')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '停用', '版本管理'])
    expect(btn(cell, '编辑').disabled).toBe(false)
    expect(btn(cell, '编辑').getAttribute('title') || '').toBe('')
    // 最新版本列展示当前已发布版本号（md L46）
    const row = [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes('已发布技能'))
    expect(row.querySelector('.el-table-column[data-label="最新版本"]').textContent).toContain('v1.0.0')
  })

  // 2026-09-12 审计 J1 闭环：09-11 拍板（38c3567）按设计图拆出独立状态列，写法照 adminMcp.test.js「列结构」用例
  it('列序：状态为独立列且紧跟「技能名」列之后（09-11 拍板 · 审计 J1）', async () => {
    const { host } = await mountRows([published])
    const labels = [...host.querySelectorAll('.t-head')].map((h) => h.getAttribute('data-label'))
    expect(labels).toContain('状态')
    expect(labels.indexOf('状态')).toBe(labels.indexOf('技能名') + 1)
    const row = [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes('已发布技能'))
    expect(row.querySelector('.el-table-column[data-label="状态"]').textContent).toContain('已发布')
  })

  it('右钉（fixed）列只有「操作」一列——最近更新时间等列不再右钉（fe11191「三列看不见」防回归）', async () => {
    const { host } = await mountRows([published])
    const fixedHeads = [...host.querySelectorAll('.t-head[data-fixed]')]
    expect(fixedHeads.length).toBe(1)
    expect(fixedHeads.map((h) => h.getAttribute('data-label'))).toEqual(['操作'])
    expect(fixedHeads[0].getAttribute('data-fixed')).toBe('right')
    // 「工具数 / 引用情况 / 最新版本」三列表头仍在
    const labels = [...host.querySelectorAll('.t-head')].map((h) => h.getAttribute('data-label'))
    expect(labels).toEqual(expect.arrayContaining(['工具数', '引用情况', '最新版本']))
  })
})

/* ====================================================================================== */
// 2026-09-12 审计 T54：版本管理适配器（VersionDrawer 在本文件为桩，此前 versionAdapter 零用例）+ 「最近更新时间」列头排序切换。
describe('版本管理适配器（md §四）+ 最近更新时间列头排序（md L47/L54）', () => {
  it('打开版本管理 → 适配器 title「版本管理」、用词 禁用/启用/已启用、最后启用版守卫 tip 逐字（md §四.3 L253-254）', async () => {
    const vm = await mountPage()
    const row = { ...rowPlatform, displayCategoryId: '办公效率', publications: [{ target: 'USER_END', status: 'PUBLISHED' }] }
    vm.openVersionManage(row)
    expect(vm.verMgrVisible).toBe(true)
    const a = vm.versionAdapter
    expect(a.title).toBe('版本管理')
    expect(a.entityLabel).toBe('技能')
    expect(a.name).toBe('平台技能B')
    expect(a.delistTerm).toBe('禁用')
    expect(a.relistTerm).toBe('启用')
    expect(a.activeLabel).toBe('已启用')
    expect(a.guardLastActive).toBe(true)
    expect(a.lastActiveTip).toBe('当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能')
    expect(a.exclusiveActive).toBe(true)
    // 顶部状态标签收拢为三态：已发布 → 可提交新版
    expect(a.deriveView()).toMatchObject({ label: '已发布', actions: ['submit'] })
    // 分类已选 → 无前置门
    expect(a.submitGate()).toBe('')
  })

  it('市场技能未选分类 → submitGate 给出拦截提示（含 md L231「该技能还未选择「技能分类」，按规则不可提交发布」）；通用/岗位私有不设此门', async () => {
    const vm = await mountPage()
    vm.openVersionManage({ ...rowPlatform, displayCategoryId: null })
    // 2026-09-12 审计 K18 闭环：逐字 md L231（原多出的「请到技能编辑页…」一句已删）
    expect(vm.versionAdapter.submitGate()).toBe('该技能还未选择「技能分类」，按规则不可提交发布')
    vm.openVersionManage({ ...rowSystem, displayCategoryId: null })
    expect(vm.versionAdapter.submitGate()).toBe('')
    vm.openVersionManage({ ...rowPosition, displayCategoryId: null })
    expect(vm.versionAdapter.submitGate()).toBe('')
  })

  it('审核中行 → deriveView 显「审核中」且动作仅撤回；撤回确认文案按首发/新版分场景', async () => {
    const vm = await mountPage()
    vm.openVersionManage({ ...rowPlatform, publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] })
    const a = vm.versionAdapter
    expect(a.deriveView()).toMatchObject({ state: 'REVIEWING', label: '审核中', actions: ['withdraw'] })
    expect(a.withdrawText('REVIEWING')).toBe('撤回发布申请后将回到未发布态。确认撤回？')
    expect(a.withdrawText('PUBLISHED_REVIEWING')).toBe('撤回在审新版后，改动回到「未提交」状态，线上版本不受影响。确认撤回？')
  })

  it('未打开版本管理 → 适配器为 null', async () => {
    const vm = await mountPage()
    expect(vm.verMgrSkill).toBe(null)
    expect(vm.versionAdapter).toBe(null)
  })

  it('默认按最近更新时间由近到远（sort=desc、箭头 ↓）；点列头 toggleSort → asc、箭头 ↑；再点回 desc（md L54）', async () => {
    const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Page)
    Object.entries({ ...stubs, 'el-table': tableStub, 'el-table-column': tableColStub }).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host
    await nextTick()
    await nextTick()
    const vm = app._instance.setupState
    vm.rows = [rowPlatform] // 空列表时 ListStates 显空态不渲染表格，先注入一行让表头出来
    await nextTick()
    await nextTick()
    expect(vm.query.sort).toBe('desc')
    expect(vm.sortArrow).toBe('↓')
    const headBtn = host.querySelector('.time-sort')
    expect(headBtn.textContent.replace(/\s+/g, ' ').trim()).toBe('最近更新时间 ↓')
    headBtn.click()
    await nextTick()
    expect(vm.query.sort).toBe('asc')
    expect(vm.sortArrow).toBe('↑')
    expect(host.querySelector('.time-sort').textContent.replace(/\s+/g, ' ').trim()).toBe('最近更新时间 ↑')
    headBtn.click()
    await nextTick()
    expect(vm.query.sort).toBe('desc')
  })
})
