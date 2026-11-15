// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'
import { passthrough } from './helpers/commonStubs'

/**
 * 「技能」页（三类合一）单测。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §一 / §二.1 列表展示 / §二.2 排序规则 / §二.3.1 操作按钮展示规则 / §四；
 * 文末两个 describe（操作列行渲染 + 右钉列守卫 / 版本管理适配器 + 排序切换）为审计 T49①/T54 新增，
 * 行数据直接注入 rows、适配器为纯函数。
 * 真实 ElementPlus 挂载冒烟见 adminSkillsUnifiedSmoke.test.js。
 *
 * 【2026-09-12 审计 J4 闭环：去掉 stubEnv('VITE_SKILL_MOCK','0')】
 * 此前 7 条「端点分支」用例断的是 demo 永远不走的真实端点（/fde/admin-skills、三套命名空间的 request 调用），
 * 页面层对 mock 路径零用例。现在数据一律走真 unifiedSkillMock（demo 默认路径），用例改断**用户可见结果**：
 * 删除后行消失 + toast、停用后状态列「审核中」、撤回后恢复、类型切换只剩该类型且回第 1 页、翻页切片…；@/api/request 仍换成桩，只用来断言「真实端点零调用」。
 * unifiedSkillMock 是模块级共享内存：破坏性用例一律自建技能行；动到种子（sk_302 / sk_303 / sk_308）的用例
 * 在 afterEach 用 _reset 复位，避免随机顺序下互相污染。
 * mock 各写点内置 delay(60~120ms)，用 settle() 真等再冲刷渲染队列。
 *
 * 2026-09-01 PRD 对齐改造取代旧口径（页面按交互原型 v2 最终覆写态重构，本文件整体重写）：
 * - 类型词表：岗位私有 / 市场技能 / 通用技能；三类统一三态（未发布/审核中/已发布）；
 * - 旧「本体状态开关 toggleStatus / 下架 offlineSkill / 上架 onlineSkill / canRemove 删除门控」全部废弃：
 *   操作列按三态出按钮（固定 查看/编辑；未发布 发布+删除；审核中 撤回；已发布 停用+版本管理）；
 * - 停用 = 提交停用审核（stopSkill，被引用拦截 alert（现为弹窗内拦截））；删除确认文案统一、被引用拦截 alert；
 * - 分类筛选固定 11 类（fieldDict 同源）对全部类型开放，类型切换不再清分类；
 * - 查看/编辑同标签路由跳转（router.push；查看 = 编辑路由 + ?view=1），不再 window.open 新标签；
 * - 发布就绪门与编辑页共用 skillPublishReadiness（api/unifiedSkill.js）。
 *
 * 2026-10-12 对齐 prd.技能.md §3.5.1「强制回收（停用时勾选）」：强制回收不再是独立按钮，改为【停用】弹窗里的勾选项，
 * 与普通停用同走审核（审核通过才生效）；文末 describe 走真 DeactivateDialog（el-dialog / el-checkbox / el-input 换成可交互桩）
 * 覆盖「停用 → 勾选强制回收 → 填原因 → 提交强制回收审核」流程，与未发布行「已回收」标签。
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
const delistSpy = vi.fn()
vi.mock('@/api/unifiedSkillMock', async (importOriginal) => {
  const actual = await importOriginal()
  listSpy.mockImplementation(actual.listUnifiedSkills)
  // 停用接口（强制回收也走它，载荷 { forceRevoke, reason }）同样包一层 spy（默认透传真 mock，个别用例 mockRejectedValueOnce 等改写）
  delistSpy.mockImplementation(actual.delistSkill)
  return { ...actual, listUnifiedSkills: (...a) => listSpy(...a), delistSkill: (...a) => delistSpy(...a) }
})
const skillMock = await import('@/api/unifiedSkillMock')

// 2026-09-01：分类选项改走 fieldDict 同源字典（固定 11 类）。
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
  skillMock._reset('sk_303', { pendingAction: null, pendingVersion: '', pendingReleaseNotes: '', pendingRevokeReason: '' })
  skillMock._reset('sk_302', { pendingAction: 'publish', pendingVersion: 'v1.5.0', pendingReleaseNotes: '补充经营异常归因说明' })
  skillMock._reset('sk_308', { pendingAction: 'publish', pendingVersion: 'v1.0.0', pendingReleaseNotes: '首次发布' })
  // 强制回收端到端用例动过 303（审核通过后落「已回收」）：恢复为已发布且无回收信息
  skillMock._reset('sk_303', { status: 'published', delisted: false, revoked: null })
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
/**
 * 自建一行「已发布 · 无引用」技能（提交首发 → 审核通过）。2026-11-10 起种子 303 会议纪要整理被通用专家「企业知识助手」引用，
 * 普通停用会被引用拦截，「停用成功」类用例不再借种子 303。
 * 建出的行删不掉（已发布不可删），用例结束后把它的更新时间沉到最早（见下方 afterEach）：jsdom 下每页只有 7 条，
 * 不沉底的话会把按 id 取首屏种子行的其它用例（302 / 303 / 308 / 309）挤到第 2 页。
 */
const sinkAfterTest = []
async function mkPublishedSkill(name, type = 'SYSTEM_DEFAULT') {
  const id = await mkSkill(name, type)
  sinkAfterTest.push(id)
  await skillMock.updateSkill(id, { icon: '🧪', skillMd: '# 正文\n\n最小可发布内容。' })
  await skillMock.publishSkill(id, { releaseNotes: '首发' })
  expect(skillMock.applySkillReviewResult(id, 'FIRST_PUBLISH', true)).toBe(true)
  return id
}
afterEach(() => {
  sinkAfterTest.splice(0).forEach((id) => skillMock._reset(id, { updatedAt: '2000-01-01 00:00' }))
})
const rowById = (vm, id) => vm.rows.find((r) => r.id === id)

// 行 VO 的引用字段（2026-11-10 起分组）：positionRefNames = 引用它的岗位，expertRefNames = 引用它的专家；refCount / refNames 为两组合计
const noRefs = { refCount: 0, refNames: [], positionRefNames: [], expertRefNames: [] }
const rowPosition = { id: 'sk_p', type: 'POSITION', name: '岗位技能A', status: 'draft', ...noRefs, publications: [], toolCount: 1 }
const rowPlatform = { id: 'sk_m', type: 'PLATFORM', name: '平台技能B', status: 'draft', ...noRefs, publications: [], toolCount: 2 }
const rowSystem = { id: 'sk_s', type: 'SYSTEM_DEFAULT', name: '内置技能C', status: 'draft', ...noRefs, publications: [], toolCount: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  routeQuery = {}
  listFieldDictSpy.mockResolvedValue({ skillCategory: [{ name: '办公效率' }] })
  confirmSpy.mockResolvedValue()
  window.open = openSpy
})

describe('?keyword= 深链归一（2026-09-23 待办 yuepu#22）', () => {
  it('同名参数重复（数组）→ keyword 取第一个且恒为字符串，页面能正常加载', async () => {
    routeQuery = { keyword: ['行业', '合同'] }
    const vm = await mountLoaded()
    expect(vm.query.keyword).toBe('行业')
    expect(vm.rows.map((r) => r.name)).toContain('行业研究助手')
  })
})

describe('空态分两态（待办 yuepu#32⑤：md 补「首次暂无数据」，与专家、模型页一致）', () => {
  const emptyText = () => mountedHost.querySelector('[data-testid="list-empty"]')?.textContent.trim()
  // listSpy 的实现会跨用例残留（clearAllMocks 不复位实现）：本组把它换成空列表，结束后必须还原成真 mock
  let realImpl
  beforeEach(() => { realImpl = listSpy.getMockImplementation() })
  afterEach(() => { listSpy.mockImplementation(realImpl) })

  it('没有任何筛选条件而无数据 → 「还没有技能，点击「新建技能」创建第一个」', async () => {
    listSpy.mockImplementation(async () => ({ list: [], total: 0 }))
    await mountLoaded()
    expect(emptyText()).toBe('还没有技能，点击「新建技能」创建第一个')
  })

  it('带搜索 / 筛选条件而无命中 → 「没有符合条件的技能」', async () => {
    listSpy.mockImplementation(async () => ({ list: [], total: 0 }))
    routeQuery = { keyword: '不存在的技能' }
    await mountLoaded()
    expect(emptyText()).toBe('没有符合条件的技能')
  })
})

describe('读：数据走真 unifiedSkillMock（demo 默认路径），真实端点零调用', () => {
  it('挂载即从 mock 取回种子行（默认按最近更新时间由近到远、切到动态每页条数），/fde/admin-skills 等真实端点零调用（md §二.1「每页条数按窗口高度动态计算」/ §二.2「默认按最近更新时间由近到远排列」）', async () => {
    const vm = await mountLoaded()
    expect(realGet).not.toHaveBeenCalled()
    expect(vm.total).toBeGreaterThanOrEqual(9) // 9 条种子（其它用例可能自建行，只断下限）
    expect(vm.rows.length).toBe(Math.min(vm.total, vm.pageSize))
    expect(vm.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['行业研究助手', '合同风险检查']))
    const times = vm.rows.map((r) => r.updatedAt)
    expect([...times].sort().reverse()).toEqual(times) // desc
  })

  // 分类固定 11 类（fieldDict 同源）对全部类型开放，类型切换不再清分类。
  it('类型切换 → 只剩该类型行且回第 1 页；分类保留并生效', async () => {
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

  it('停用（提交停用审核）：确认文案对齐 md §二.3.5「停用「技能名」需提交停用审核。审核通过前客户端仍可使用。」（历史出处：原型） → 状态列「审核中」+ toast「已提交停用审核」；撤回 → 恢复「已发布」+ toast「已撤回」（md §二.3.4「待审停用撤回后回到已发布」「撤回成功提示已撤回」/ §二.3.5）', async () => {
    // 自建已发布、无引用的通用技能（种子 303 自 2026-11-10 起被通用专家引用，普通停用会被拦）
    const id = await mkPublishedSkill('J4停用·通用技能')
    const vm = await mountLoaded()
    const row = rowById(vm, id)
    expect(vm.displayStateLabel(row)).toBe('已发布')
    vm.stopSkill(row) // 打开停用确认弹窗（DeactivateDialog），正文即 PRD 文案
    await nextTick()
    expect(document.querySelector('[data-test="dd-plain"]').textContent).toBe('停用「J4停用·通用技能」需提交停用审核。审核通过前客户端仍可使用。')
    await vm.confirmStop({ forceRevoke: false, reason: '' })
    await settle()
    expect(delistSpy).toHaveBeenCalledWith(id, { forceRevoke: false, reason: '' })
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenLastCalledWith('已提交停用审核')
    expect(vm.displayStateLabel(rowById(vm, id))).toBe('审核中')
    expect(skillMock._getRaw(id).pendingAction).toBe('stop')

    await vm.withdraw(rowById(vm, id))
    await settle()
    expect(confirmSpy.mock.calls.at(-1)[0]).toBe('撤回本次提交后将回到修改前状态。确认撤回？')
    expect(ElMessage.success).toHaveBeenLastCalledWith('已撤回')
    expect(vm.displayStateLabel(rowById(vm, id))).toBe('已发布')
    expect(realPost).not.toHaveBeenCalled()
    expect(realDelete).not.toHaveBeenCalled()
  })

  it('撤回在审提交按 version 空/非空恢复：首发在审的岗位私有 308 → 「未发布」；新版在审的市场技能 302 → 「已发布」（md §二.3.4「撤回后根据 version 字段判断恢复状态」）', async () => {
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
    // 种子 307（市场技能，被 1 个专家引用）：页面前置拦截看的是行上的引用分组字段（positionRefNames / expertRefNames），这里模拟列表字段缺失
    // 绕过前置门，由真 mock 的引用保护兜底拒绝（307 更新时间最早、不在首页，直接构造行）
    const row = { id: 'sk_307', type: 'PLATFORM', name: '竞品信息汇总', ...noRefs, publications: [] }
    await vm.remove(row)
    await settle()
    expect(alertSpy.mock.calls.at(-1)[1]).toBe('无法删除')
    expect(alertSpy.mock.calls.at(-1)[0]).toContain('引用')
    expect((await skillMock.getSkillDetail('sk_307')).name).toBe('竞品信息汇总')
  })

  // 拦截文案同 utils/skillRefs.skillRefBlockMessage：按引用方分组列数量与清单（2026-11-10 起岗位私有技能也可能被专家引用）
  it('岗位私有只被岗位引用 → 拦截 alert「该技能被 N 个岗位引用（清单）…」，不出「专家」，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPosition, refCount: 2, positionRefNames: ['销售顾问岗位', '财务运营岗位'], refNames: ['销售顾问岗位', '财务运营岗位'] })
    expect(realDelete).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy.mock.calls.at(-1)[1]).toBe('删除技能')
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('该技能被 2 个岗位引用（销售顾问岗位、财务运营岗位），需先解除引用后再删除。')
  })

  it('市场技能被专家引用 → 拦截 alert 提示专家数与清单，不发删除请求', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowPlatform, refCount: 2, expertRefNames: ['经营分析专家', '法务审阅专家'], refNames: ['经营分析专家', '法务审阅专家'] })
    expect(realDelete).not.toHaveBeenCalled()
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('该技能被 2 个专家引用（经营分析专家、法务审阅专家），需先解除引用后再删除。')
  })

  it('岗位私有同时被岗位和专家引用 → 拦截文案两组都列（岗位在前，清单以分号分组）', async () => {
    const vm = await mountPage()
    await vm.remove({
      ...rowPosition,
      refCount: 3,
      positionRefNames: ['经营分析岗', '财务审核岗'],
      expertRefNames: ['经营数据核查专家'],
      refNames: ['经营分析岗', '财务审核岗', '经营数据核查专家']
    })
    expect(realDelete).not.toHaveBeenCalled()
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('该技能被 2 个岗位、1 个专家引用（经营分析岗、财务审核岗；经营数据核查专家），需先解除引用后再删除。')
  })

  it('通用技能被专家引用 → 同样拦截删除（此前通用技能不参与引用、从不拦）', async () => {
    const vm = await mountPage()
    await vm.remove({ ...rowSystem, refCount: 1, expertRefNames: ['企业知识助手'], refNames: ['企业知识助手'] })
    expect(realDelete).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('该技能被 1 个专家引用（企业知识助手），需先解除引用后再删除。')
  })
})

// 查看/编辑同标签路由跳转；引用情况（2026-11-10 起按岗位 / 专家分组，口径见 utils/skillRefs；点开引用清单弹窗）。
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

  it('引用计数 = 岗位引用 + 专家引用（三类技能都按名单分组计数，岗位私有技能也可能被专家引用）', async () => {
    const vm = await mountPage()
    expect(vm.refCountOf({ type: 'POSITION', positionRefNames: ['经营分析岗', '财务审核岗'], expertRefNames: ['经营数据核查专家'] })).toBe(3)
    expect(vm.refCountOf({ type: 'PLATFORM', positionRefNames: [], expertRefNames: ['经营分析专家', '法务审阅专家'] })).toBe(2)
    expect(vm.refCountOf({ type: 'SYSTEM_DEFAULT', positionRefNames: [], expertRefNames: ['企业知识助手'] })).toBe(1)
    expect(vm.refCountOf(rowSystem)).toBe(0)
  })

  // 回归守护（2026-08-23 实库对账查出 expert_skill 弃用表残值）：计数只认引用名分组，
  // 旧计数字段（referencedBy*Count / refCount）上的残值不得让行凭空算出引用。
  it('计数只按引用名分组——旧计数字段残值不回流 UI', async () => {
    const vm = await mountPage()
    expect(vm.refCountOf({ type: 'POSITION', referencedByPositionCount: 0, referencedByExpertCount: 7 })).toBe(0)
    expect(vm.refCountOf({ type: 'PLATFORM', refCount: 5, referencedByExpertCount: 5 })).toBe(0)
  })

  it('引用清单弹窗：标题按实际有的引用方切换（被岗位 / 被专家 / 被岗位和专家引用），正文一组一行、名称顿号连接', async () => {
    const vm = await mountPage()
    const bodyLines = () => [...mountedHost.querySelectorAll('.sk-refs-body')].map((p) => p.textContent.trim())
    vm.openRefs({ type: 'POSITION', positionRefNames: ['销售顾问岗位', '财务运营岗位'], expertRefNames: [] })
    await nextTick()
    expect(vm.refsVisible).toBe(true)
    expect(vm.refsTitle).toBe('被岗位引用')
    expect(bodyLines()).toEqual(['岗位：销售顾问岗位、财务运营岗位'])
    vm.openRefs({ type: 'SYSTEM_DEFAULT', positionRefNames: [], expertRefNames: ['企业知识助手'] })
    await nextTick()
    expect(vm.refsTitle).toBe('被专家引用')
    expect(bodyLines()).toEqual(['专家：企业知识助手'])
    vm.openRefs({ type: 'POSITION', positionRefNames: ['经营分析岗', '财务审核岗'], expertRefNames: ['经营数据核查专家'] })
    await nextTick()
    expect(vm.refsTitle).toBe('被岗位和专家引用')
    expect(bodyLines()).toEqual(['岗位：经营分析岗、财务审核岗', '专家：经营数据核查专家'])
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
describe('操作列：三态判定 + 发布就绪门（md §二.3.1 按钮展示规则 / §二.3.3 发布前置条件「任一未完成时不执行发布，【发布】置灰并提示待补齐项」；历史出处：原型 skillActions 最终覆写态）', () => {
  const pub = (status, extra = {}) => [{ target: 'USER_END', status, ...extra }]

  it('三态判定：未发布可删可发；审核中只撤回；已发布停用+版本管理', async () => {
    const vm = await mountPage()
    expect(vm.isUnpublished({ type: 'PLATFORM', publications: [] })).toBe(true)
    expect(vm.isReviewing({ type: 'PLATFORM', publications: pub('PENDING_REVIEW') })).toBe(true)
    expect(vm.isPublished({ type: 'PLATFORM', publications: pub('PUBLISHED') })).toBe(true)
    // 待审停用（PUBLISHED + pendingAction=DELIST）归审核中——不得再出「停用」入口（重复提交 409）
    expect(vm.isReviewing({ type: 'PLATFORM', publications: pub('PUBLISHED', { pendingAction: 'DELIST' }) })).toBe(true)
  })

  it('发布就绪门：必填齐 → 就绪提示；缺项 → 「请先补齐必填项：…」按 md §二.3.3「技能名称、技能类型、技能分类、图标、描述、示例问题或 SKILL.md」同序列出缺项（历史出处：原型同序）', async () => {
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
    vm.stopSkill(rowById(vm, 'sk_303'))
    await nextTick()
    expect(vm.stopDialogVisible).toBe(true)
    vm.stopDialogVisible = false // 点弹窗【取消】/ 关闭
    await settle()
    expect(delistSpy).not.toHaveBeenCalled()
    expect(vm.displayStateLabel(rowById(vm, 'sk_302'))).toBe('审核中')
    expect(vm.displayStateLabel(rowById(vm, 'sk_303'))).toBe('已发布')
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('停用后 mock 已被引用的行（种子 309 停用在审）不再出「停用」；停用被引用行在停用弹窗内拦截（不发请求）', async () => {
    const vm = await mountLoaded()
    expect(vm.isReviewing(rowById(vm, 'sk_309'))).toBe(true)
    const before = skillMock._getRaw('sk_302').pendingAction
    vm.stopSkill(rowById(vm, 'sk_302')) // 302 被 4 个专家引用（2026-11-09 补种子专家 205）→ 弹窗内拦截文案
    await nextTick()
    expect(document.querySelector('[data-test="dd-blocked"]').textContent).toContain('4 个专家引用')
    expect(delistSpy).not.toHaveBeenCalled()
    expect(skillMock._getRaw('sk_302').pendingAction).toBe(before)
  })

  it('停用被引用 → 弹窗内拦截文案（含引用清单），不发请求', async () => {
    const vm = await mountPage()
    vm.stopSkill({
      ...rowPlatform,
      refCount: 2,
      expertRefNames: ['经营分析专家', '法务合规专家'],
      refNames: ['经营分析专家', '法务合规专家'],
      publications: [{ target: 'USER_END', status: 'PUBLISHED' }]
    })
    await nextTick()
    expect(realPost).not.toHaveBeenCalled()
    expect(delistSpy).not.toHaveBeenCalled()
    expect(document.querySelector('[data-test="dd-blocked"]').textContent).toBe('该技能被 2 个专家引用（经营分析专家、法务合规专家），需先解除引用后再停用。')
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
  it('挂载从 fieldDict 拉分类选项（名即 id）', async () => {
    const vm = await mountPage()
    expect(listFieldDictSpy).toHaveBeenCalled()
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

  it('三类 createFn（新签名 { name, categoryName }）→ 真 mock 建出对应类型、带分类的空白技能（md §三.2 手动创建「空白技能仅带入创建弹窗中已填写的技能类型、技能分类和技能名称」）', async () => {
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

  // 2026-09-04 曾改成带直引号（照旧原型）；#63① 已对齐 md 技能 §三.2，现为无引号：「请从列表点击编辑继续配置」
  it('zip 导入完成统一返回列表：toast「已导入 N 个技能包，请从列表点击编辑继续配置」+ 刷列表不跳编辑页', async () => {
    const vm = await mountPage()
    pushSpy.mockClear()
    const before = listSpy.mock.calls.length
    vm.onSkillsCreatedBatch({ skillIds: ['sk_a', 'sk_b'], skillType: 'PLATFORM' })
    await nextTick()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已导入 2 个技能包，请从列表点击编辑继续配置')
    expect(pushSpy).not.toHaveBeenCalled()
    expect(listSpy.mock.calls.length).toBe(before + 1)
  })
})

/* ====================================================================================== */
// 2026-09-12 审计 T49①：操作列真正渲染出来的按钮 / 置灰 / title（md §二.3.1 操作按钮展示规则），此前只断言 isReviewing 等谓词。
// 行数据直接注入 rows（useAdminList 的 ref），不经列表数据源。
describe('操作列行渲染：三态按钮组合 + 置灰 title（md §二.3.1）+ 右钉列只有「操作」一列（fe11191 防回归）', () => {
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

  it('未发布 → 查看 / 编辑 / 发布 / 删除 4 个按钮；【删除】title「删除前需二次确认」；就绪时【发布】可点且 title 为发布说明（md §二.3.1「未发布：【查看】【编辑】【发布】【删除】，共 4 个按钮」及两处悬停提示）', async () => {
    const { host } = await mountRows([unpublishedReady])
    const cell = opsCellOf(host, '未发布就绪')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '发布', '删除'])
    expect(btn(cell, '编辑').disabled).toBe(false)
    expect(btn(cell, '发布').disabled).toBe(false)
    expect(btn(cell, '发布').getAttribute('title')).toBe('发布将提交审核，审核通过后生成版本快照并上线')
    expect(btn(cell, '删除').getAttribute('title')).toBe('删除前需二次确认')
  })

  it('未发布缺必填项 → 【发布】置灰，title「请先补齐必填项：…」列出缺项（md §二.3.3「…任一未完成时不执行发布，【发布】置灰并提示待补齐项」/ §三.3 发布）', async () => {
    const { host } = await mountRows([unpublishedMissing])
    const cell = opsCellOf(host, '—') // 名称空，用占位符行定位
    const pub = btn(cell, '发布')
    expect(pub.disabled).toBe(true)
    expect(pub.getAttribute('title')).toContain('请先补齐必填项：')
    expect(pub.getAttribute('title')).toContain('技能名称')
    expect(pub.getAttribute('title')).toContain('SKILL.md')
  })

  it('审核中 → 查看 / 编辑（置灰，title「审核中不可编辑」）/ 撤回 共 3 个；不出发布/删除/停用/版本管理（md §二.3.1「审核中【编辑】置灰并提示审核中不可编辑」「审核中：【查看】【编辑】（置灰）【撤回】，共 3 个按钮」）', async () => {
    const { host } = await mountRows([reviewing])
    const cell = opsCellOf(host, '审核中技能')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '撤回'])
    const edit = btn(cell, '编辑')
    expect(edit.disabled).toBe(true)
    expect(edit.getAttribute('title')).toBe('审核中不可编辑')
  })

  it('已发布 → 查看 / 编辑 / 停用 / 版本管理 4 个，不再有独立【强制回收】按钮（强制回收并入停用弹窗勾选项）；【编辑】可点、无 title（md §二.3.1「已发布：【查看】【编辑】【停用】【版本管理】，共 4 个按钮」）', async () => {
    const { host } = await mountRows([published])
    const cell = opsCellOf(host, '已发布技能')
    expect(btnTexts(cell)).toEqual(['查看', '编辑', '停用', '版本管理'])
    expect(btn(cell, '编辑').disabled).toBe(false)
    expect(btn(cell, '编辑').getAttribute('title') || '').toBe('')
    // 最新版本列展示当前已发布版本号（md §二.1「最新版本：展示当前已发布版本号」）
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
// 2026-11-10 专家按类型引用技能：「引用情况」列按引用方分组、一组一行（「2 个岗位引用」「1 个专家引用」，单元格里不加「·」）；
// 三类技能都可能被专家引用，通用技能不再显「—」，无引用一律「暂无引用」；点开引用清单弹窗。行数据直接注入 rows。
describe('引用情况列渲染：按岗位 / 专家分组一组一行，点开引用清单弹窗', () => {
  const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
  const rowStubs = {
    ...stubs,
    'el-table': tableStub,
    'el-table-column': tableColStub,
    // 弹窗随 v-model 显隐，标题落 data-title 便于断言
    'el-dialog': { name: 'el-dialog', props: ['modelValue', 'title'], template: '<div v-if="modelValue" class="dlg" :data-title="title"><slot /></div>' }
  }
  async function mountRows(rowsData) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Page)
    Object.entries(rowStubs).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host
    await settle() // 等真 mock 首屏列表回来，免得稍后返回的列表盖掉注入的行
    const vm = app._instance.setupState
    vm.rows = rowsData
    await nextTick()
    await nextTick()
    return { vm, host }
  }
  const refCell = (host, name) =>
    [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name)).querySelector('.el-table-column[data-label="引用情况"]')
  const refLines = (cell) => [...cell.querySelectorAll('.sk-ref-lines > span')].map((s) => s.textContent.trim())
  const both = {
    ...rowPosition,
    id: 'r_both',
    name: '岗位和专家都引用',
    refCount: 3,
    positionRefNames: ['经营分析岗', '财务审核岗'],
    expertRefNames: ['经营数据核查专家'],
    refNames: ['经营分析岗', '财务审核岗', '经营数据核查专家']
  }
  const systemByExpert = { ...rowSystem, id: 'r_sys_ref', name: '被专家引用的通用技能', refCount: 1, expertRefNames: ['企业知识助手'], refNames: ['企业知识助手'] }

  it('岗位私有技能同时被岗位和专家引用 → 两行「2 个岗位引用」「1 个专家引用」，单元格不加「·」', async () => {
    const { host } = await mountRows([both])
    const cell = refCell(host, '岗位和专家都引用')
    expect(refLines(cell)).toEqual(['2 个岗位引用', '1 个专家引用'])
    expect(cell.textContent).not.toContain('·')
  })

  it('市场技能「不在市场展示」→ 技能名旁标「不在市场展示」；没打开的不标（产品优化需求-202611 R14）', async () => {
    const hidden = { ...rowPlatform, id: 'r_hidden', name: '只给专家用的技能', hideFromMarket: true }
    const shown = { ...rowPlatform, id: 'r_shown', name: '市场里能看到的技能', hideFromMarket: false }
    const { host } = await mountRows([hidden, shown])
    const nameCell = (name) =>
      [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name)).querySelector('.el-table-column[data-label="技能名"]')
    expect(nameCell('只给专家用的技能').querySelector('.sk-hide-tag')?.textContent.trim()).toBe('不在市场展示')
    expect(nameCell('市场里能看到的技能').querySelector('.sk-hide-tag')).toBeNull()
  })

  it('通用技能被专家引用 → 「1 个专家引用」，不再显「—」', async () => {
    const { host } = await mountRows([systemByExpert])
    const cell = refCell(host, '被专家引用的通用技能')
    expect(refLines(cell)).toEqual(['1 个专家引用'])
    expect(cell.textContent).not.toContain('—')
  })

  it('三类技能无引用 → 一律「暂无引用」（通用技能也不再显「—」），没有可点开的引用按钮', async () => {
    const { host } = await mountRows([rowPosition, rowPlatform, rowSystem])
    for (const name of ['岗位技能A', '平台技能B', '内置技能C']) {
      const cell = refCell(host, name)
      expect(cell.textContent.trim()).toBe('暂无引用')
      expect(cell.querySelector('.sk-ref-btn')).toBeNull()
    }
  })

  it('点「引用情况」→ 弹窗标题「被岗位和专家引用」，正文一组一行「岗位：…」「专家：…」', async () => {
    const { host } = await mountRows([both])
    expect(host.querySelector('.dlg')).toBeNull()
    refCell(host, '岗位和专家都引用').querySelector('.sk-ref-btn').click()
    await nextTick()
    expect(host.querySelector('.dlg').getAttribute('data-title')).toBe('被岗位和专家引用')
    expect([...host.querySelectorAll('.dlg .sk-refs-body')].map((p) => p.textContent.trim())).toEqual([
      '岗位：经营分析岗、财务审核岗',
      '专家：经营数据核查专家'
    ])
  })
})

// 产品优化需求-202611 修改点 15 / 字段字典 md「删除技能分类后，使用该分类的存量技能显示为"未分类"」：
// 数据层对已删的分类给空分类名（unifiedSkillMock 读时派生），列表把空分类显示成「未分类」（此前显示「—」）
describe('技能分类列：没有有效分类 → 「未分类」（产品优化需求-202611 修改点 15）', () => {
  const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
  const rowStubs = { ...stubs, 'el-table': tableStub, 'el-table-column': tableColStub }
  async function mountRows(rowsData) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Page)
    Object.entries(rowStubs).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host
    await settle() // 等真 mock 首屏列表回来，免得稍后返回的列表盖掉注入的行
    app._instance.setupState.rows = rowsData
    await nextTick()
    await nextTick()
    return host
  }
  const catCell = (host, name) =>
    [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name)).querySelector('.el-table-column[data-label="技能分类"]')

  it('分类名为空（分类已在字段字典删掉）→ 显示「未分类」；有分类的照常显示分类名', async () => {
    const orphan = { ...rowPlatform, id: 'r_orphan', name: '分类被删的技能', displayCategoryId: '设计多媒体', displayCategoryName: '' }
    const normal = { ...rowPlatform, id: 'r_normal', name: '有分类的技能', displayCategoryId: '数据分析', displayCategoryName: '数据分析' }
    const host = await mountRows([orphan, normal])
    expect(catCell(host, '分类被删的技能').textContent.trim()).toBe('未分类')
    expect(catCell(host, '有分类的技能').textContent.trim()).toBe('数据分析')
  })
})

/* ====================================================================================== */
// 2026-09-12 审计 T54：版本管理适配器（VersionDrawer 在本文件为桩，此前 versionAdapter 零用例）+ 「最近更新时间」列头排序切换。
describe('版本管理适配器（md §四）+ 最近更新时间列头排序（md §二.1「最近更新时间…支持点击列头排序」/ §二.2 排序规则）', () => {
  it('打开版本管理 → 适配器 title「版本管理」、用词 禁用/启用/已启用、最后启用版守卫 tip 逐字（md §四.3「已启用版本展示【禁用】，已禁用版本展示【启用】」「最后一个启用版本不可禁用，提示…」）', async () => {
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

  it('市场技能未选分类 → submitGate 给出拦截提示（含 md §四.1「该技能还未选择「技能分类」，按规则不可提交发布」）；通用/岗位私有不设此门', async () => {
    const vm = await mountPage()
    vm.openVersionManage({ ...rowPlatform, displayCategoryId: null })
    // 2026-09-12 审计 K18 闭环：逐字 md §四.1 市场技能未选分类拦截提示（原多出的「请到技能编辑页…」一句已删）
    expect(vm.versionAdapter.submitGate()).toBe('该技能还未选择「技能分类」，按规则不可提交发布')
    vm.openVersionManage({ ...rowSystem, displayCategoryId: null })
    expect(vm.versionAdapter.submitGate()).toBe('')
    vm.openVersionManage({ ...rowPosition, displayCategoryId: null })
    expect(vm.versionAdapter.submitGate()).toBe('')
  })

  // 产品优化需求-202611 修改点 13（R4）：引用了未发布 / 审核中的连接器 → 版本管理弹窗展示阻断提示、【提交发布】不可点（阻断，R4-3 暂按）。
  // 行数据取真 mock 的列表行（unpublishedTools 由 mock 按连接器实时发布态给出），不手拼。
  it('R4：未发布行引用了未发布的连接器 → 【发布】不因此置灰、照常打开版本管理弹窗，前置门给出「引用的「名称」尚未发布…」', async () => {
    const vm = await mountPage()
    const { skillId } = await skillMock.createSkill({ name: 'R4列表首发校验', type: 'PLATFORM', categoryName: '办公效率' })
    sinkAfterTest.push(skillId) // 自建行用完沉底，不把首屏种子行挤到第 2 页
    await skillMock.updateSkill(skillId, { icon: '🧪', description: 'd', exampleQuestion: 'q', skillMd: '# 正文\n\n@tool[mcp__mail_center]\n@tool[mcp__knowledge_hub]\n' })
    const row = (await skillMock.listUnifiedSkills({ keyword: 'R4列表首发校验', size: 10 })).list[0]
    expect(vm.readinessOf(row).ready).toBe(true) // 必填项齐全：【发布】可点
    vm.openPublish(row)
    expect(vm.verMgrVisible).toBe(true)
    expect(vm.versionAdapter.submitGate()).toBe('引用的「邮件中心 MCP」尚未发布，请先发布该连接器或移除引用')
  })

  it('R4：已发布行【版本管理】同样校验——种子 sk_305 引用了从未发布的邮件中心 MCP，前置门拦下新版本提交', async () => {
    const vm = await mountPage()
    const row = (await skillMock.listUnifiedSkills({ keyword: '客户拜访准备', size: 10 })).list.find((r) => r.id === 'sk_305')
    expect(vm.isPublished(row)).toBe(true) // 前提：已发布，走【版本管理】入口
    vm.openVersionManage(row)
    expect(vm.versionAdapter.submitGate()).toBe('引用的「邮件中心 MCP」尚未发布，请先发布该连接器或移除引用')
  })

  it('R4：引用的连接器都已发布 → 不因工具设门（市场技能已选分类时前置门为空）', async () => {
    const vm = await mountPage()
    const { skillId } = await skillMock.createSkill({ name: 'R4列表放行', type: 'PLATFORM', categoryName: '办公效率' })
    sinkAfterTest.push(skillId)
    await skillMock.updateSkill(skillId, { icon: '🧪', description: 'd', exampleQuestion: 'q', skillMd: '# 正文\n\n@tool[mcp__knowledge_hub]\n' })
    const row = (await skillMock.listUnifiedSkills({ keyword: 'R4列表放行', size: 10 })).list[0]
    vm.openPublish(row)
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

  it('默认按最近更新时间由近到远（sort=desc、箭头 ↓）；点列头 toggleSort → asc、箭头 ↑；再点回 desc（md §二.2「默认按最近更新时间由近到远排列，点击列头切换升降序」）', async () => {
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

// PRD 技能 §3.5.1：已发布行【停用】→ 弹窗勾选「强制回收」→ 填原因 → 【提交强制回收审核】→ 与普通停用同走审核，通过才回「未发布」并带「已回收」标记
describe('强制回收（prd.技能.md §3.5.1：停用弹窗勾选项，同走审核、原因必填、无二次确认、不受引用拦截）', () => {
  const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
  const rowStubs = {
    ...stubs,
    'el-table': tableStub,
    'el-table-column': tableColStub,
    'el-button': { name: 'el-button', props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
    // 以下三个桩让真 DeactivateDialog 可交互：弹窗随 v-model 显隐，勾选框 / 原因框双向绑定
    'el-dialog': { name: 'el-dialog', props: ['modelValue', 'title'], template: '<div v-if="modelValue" class="dlg" :data-title="title"><slot /><slot name="footer" /></div>' },
    'el-checkbox': {
      name: 'el-checkbox',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<label><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /><slot /></label>'
    },
    'el-input': {
      name: 'el-input',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    }
  }
  /** 挂载 → 等真 mock 首屏列表回来（否则稍后返回的列表会盖掉注入的行）→ 可选注入行。 */
  async function mountAndInject(rowsData) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Page)
    Object.entries(rowStubs).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host
    await settle()
    const vm = app._instance.setupState
    if (rowsData) {
      vm.rows = rowsData
      await nextTick()
      await nextTick()
    }
    return { vm, host }
  }
  const ready = { displayCategoryId: '办公效率', icon: '▤', description: 'd', exampleQuestion: 'q', hasSkillMd: true }
  const expertNames = ['经营分析专家', '法务合规专家', '投研助理专家']
  const publishedRow = { ...rowPlatform, ...ready, id: 'r_pub', name: '已发布技能', versionLabel: 'v1.0.0', refCount: 3, expertRefNames: expertNames, refNames: expertNames, publications: [{ target: 'USER_END', status: 'PUBLISHED' }] }
  const draftRow = { ...rowPlatform, ...ready, id: 'r_draft', name: '未发布技能' }
  const rowOf = (host, name) => [...host.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name))
  const opBtn = (host, name, text) =>
    [...rowOf(host, name).querySelectorAll('.el-table-column[data-label="操作"] button')].find((b) => b.textContent.trim() === text)
  const stateCell = (host, name) => rowOf(host, name).querySelector('.el-table-column[data-label="状态"]')
  // 弹窗内的操作
  const dd = (host, sel) => host.querySelector(sel)
  async function tickForceCheck(host, on = true) {
    const input = dd(host, '[data-test="dd-force-check"] input')
    input.checked = on
    input.dispatchEvent(new Event('change'))
    await nextTick()
  }
  async function typeReason(host, text) {
    const ta = dd(host, '.dlg textarea') // 页面搜索框也是 el-input 桩，限定在弹窗内
    ta.value = text
    ta.dispatchEvent(new Event('input'))
    await nextTick()
  }

  it('端到端：会议纪要整理点【停用】→ 勾选强制回收 → 填原因 → 提交；toast「已提交强制回收审核」、接口带 {forceRevoke, reason}，该行进入「审核中」（审核通过前无「已回收」）；审核通过后才变「未发布」并带回收信息', async () => {
    // 按名称搜出 303：jsdom 下每页 7 条，其它用例自建的技能（更新时间更近）会把 303 挤出首屏
    routeQuery = { keyword: '会议纪要整理' }
    const { vm, host } = await mountAndInject()
    expect(stateCell(host, '会议纪要整理').textContent).toContain('已发布')
    const before = listSpy.mock.calls.length
    opBtn(host, '会议纪要整理', '停用').click()
    await nextTick()
    await tickForceCheck(host)
    expect(dd(host, '.dlg').getAttribute('data-title')).toBe('强制回收技能')
    await typeReason(host, '技能内含违规内容')
    dd(host, '[data-test="dd-confirm"]').click()
    await settle(450) // 停用写点 + 随后的列表重取各带 60~120ms 的 mock 延迟
    expect(delistSpy).toHaveBeenCalledWith('sk_303', { forceRevoke: true, reason: '技能内含违规内容' })
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已提交强制回收审核')
    expect(dd(host, '.dlg')).toBeNull() // 成功后弹窗关闭
    expect(listSpy.mock.calls.length).toBeGreaterThan(before)
    // 审核通过前：与普通停用一致，审核中、不带「已回收」
    let row = rowById(vm, 'sk_303')
    expect(vm.displayStateLabel(row)).toBe('审核中')
    expect(row.revoked).toBeNull()
    // 审核通过 → 才生效
    skillMock.applySkillReviewResult('sk_303', 'DELIST', true)
    await vm.fetchList()
    await settle()
    row = rowById(vm, 'sk_303')
    expect(vm.displayStateLabel(row)).toBe('未发布')
    expect(row.revoked).toMatchObject({ reason: '技能内含违规内容' })
    expect(realPost).not.toHaveBeenCalled()
  })

  it('普通停用（不勾选）→ 正文 PRD 文案 + 确认按钮【提交停用审核】；提交后 toast「已提交停用审核」、接口不带回收原因', async () => {
    // 自建已发布、无引用的通用技能（种子 303 自 2026-11-10 起被通用专家引用，普通停用会被拦）
    const id = await mkPublishedSkill('普通停用·通用技能')
    const { host } = await mountAndInject()
    opBtn(host, '普通停用·通用技能', '停用').click()
    await nextTick()
    expect(dd(host, '.dlg').getAttribute('data-title')).toBe('停用技能')
    expect(dd(host, '[data-test="dd-plain"]').textContent).toBe('停用「普通停用·通用技能」需提交停用审核。审核通过前客户端仍可使用。')
    expect(dd(host, '[data-test="dd-blocked"]')).toBeNull()
    expect(dd(host, '[data-test="dd-confirm"]').textContent).toBe('提交停用审核')
    dd(host, '[data-test="dd-confirm"]').click()
    await settle(450)
    expect(delistSpy).toHaveBeenCalledWith(id, { forceRevoke: false, reason: '' })
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.success).toHaveBeenCalledWith('已提交停用审核')
    expect(skillMock._getRaw(id).pendingRevokeReason || '').toBe('')
  })

  // 2026-11-10：通用技能被专家引用后，普通停用同样被拦（此前通用技能不参与引用，从不拦）；强制回收仍放行（端到端见上一条）
  it('种子 303 会议纪要整理（通用技能，被企业知识助手引用）→ 停用弹窗显示拦截文案、【提交停用审核】禁用，不调接口', async () => {
    // 取真 mock 的行 VO 注入（不靠首屏分页：jsdom 下每页 7 条，其它用例自建的行会把 303 挤到第 2 页）
    const row303 = (await skillMock.listUnifiedSkills({ size: 1000 })).list.find((r) => r.id === 'sk_303')
    const { host } = await mountAndInject([row303])
    opBtn(host, '会议纪要整理', '停用').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-blocked"]').textContent).toBe('该技能被 1 个专家引用（企业知识助手），需先解除引用后再停用。')
    expect(dd(host, '[data-test="dd-confirm"]').disabled).toBe(true)
    expect(delistSpy).not.toHaveBeenCalled()
  })

  it('被引用的技能：弹窗默认显示拦截文案且【提交停用审核】禁用；勾选强制回收后放行（按钮变【提交强制回收审核】，影响范围「已被 3 个专家引用」），不受引用拦截', async () => {
    const { host } = await mountAndInject([publishedRow])
    opBtn(host, '已发布技能', '停用').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-blocked"]').textContent).toContain('该技能被 3 个专家引用')
    expect(dd(host, '[data-test="dd-confirm"]').disabled).toBe(true)
    await tickForceCheck(host)
    expect(dd(host, '[data-test="dd-blocked"]')).toBeNull()
    expect(dd(host, '.dlg').textContent).toContain('已被 3 个专家引用')
    expect(dd(host, '[data-test="dd-confirm"]').disabled).toBe(false)
    expect(dd(host, '[data-test="dd-confirm"]').textContent).toBe('提交强制回收审核')
  })

  it('岗位私有技能只被岗位引用：停用弹窗引用方描述为「岗位」，不是写死的「岗位 / 专家」（/prd-import Q6，口径同列表「引用情况」）', async () => {
    const positions = ['经营分析岗', '财务审核岗']
    const positionPublished = { ...publishedRow, id: 'r_pos_pub', name: '岗位私有已发布技能', type: 'POSITION', refCount: 2, positionRefNames: positions, expertRefNames: [], refNames: positions }
    const { host } = await mountAndInject([positionPublished])
    opBtn(host, '岗位私有已发布技能', '停用').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-blocked"]').textContent).toBe('该技能被 2 个岗位引用（经营分析岗、财务审核岗），需先解除引用后再停用。')
    await tickForceCheck(host)
    expect(dd(host, '.dlg').textContent).toContain('已被 2 个岗位引用')
  })

  it('岗位私有技能同时被岗位和专家引用：停用拦截文案两组都列；勾选强制回收后影响范围「已被 3 个岗位 / 专家引用」', async () => {
    const both = {
      ...publishedRow,
      id: 'r_pos_both',
      name: '岗位和专家都引用的技能',
      type: 'POSITION',
      refCount: 3,
      positionRefNames: ['经营分析岗', '财务审核岗'],
      expertRefNames: ['经营数据核查专家'],
      refNames: ['经营分析岗', '财务审核岗', '经营数据核查专家']
    }
    const { host } = await mountAndInject([both])
    opBtn(host, '岗位和专家都引用的技能', '停用').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-blocked"]').textContent).toBe('该技能被 2 个岗位、1 个专家引用（经营分析岗、财务审核岗；经营数据核查专家），需先解除引用后再停用。')
    await tickForceCheck(host)
    expect(dd(host, '.dlg').textContent).toContain('已被 3 个岗位 / 专家引用')
  })

  it('勾选强制回收后出现红色警示：写明审核通过后生效且不可撤销，并点明“已获得该技能的员工将失去它”；未勾选时没有该警示', async () => {
    const { host } = await mountAndInject([{ ...publishedRow, ...noRefs }])
    opBtn(host, '已发布技能', '停用').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-danger"]')).toBeNull()
    await tickForceCheck(host)
    const danger = dd(host, '[data-test="dd-danger"]')
    expect(danger.textContent).toContain('已获得该技能的员工将失去它')
    expect(danger.textContent).toContain('审核通过后生效')
  })

  // T4：岗位私有技能走 positionSkillApi.delist，必须把 { forceRevoke, reason } 透传给 mock（曾有只传 id 的包装会丢掉强制回收）
  it('岗位私有技能行：停用弹窗勾选强制回收并提交 → positionSkillApi.delist 把 { forceRevoke:true, reason } 一并交给 delistSkill', async () => {
    const positionPublished = { ...publishedRow, ...noRefs, id: 'r_pos_rev', name: '岗位私有回收技能', type: 'POSITION' }
    delistSpy.mockResolvedValueOnce({}) // 注入行不在 mock 里，只验证入参透传
    const { host } = await mountAndInject([positionPublished])
    opBtn(host, '岗位私有回收技能', '停用').click()
    await nextTick()
    await tickForceCheck(host)
    await typeReason(host, '岗位技能越权')
    dd(host, '[data-test="dd-confirm"]').click()
    await settle(0)
    expect(delistSpy).toHaveBeenCalledWith('r_pos_rev', { forceRevoke: true, reason: '岗位技能越权' })
  })

  it('原因必填：勾选后不填点提交 → 弹窗内提示「请输入回收原因」，不调接口、不关弹窗', async () => {
    const { host } = await mountAndInject([publishedRow])
    opBtn(host, '已发布技能', '停用').click()
    await nextTick()
    await tickForceCheck(host)
    dd(host, '[data-test="dd-confirm"]').click()
    await nextTick()
    expect(dd(host, '[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(delistSpy).not.toHaveBeenCalled()
    expect(dd(host, '.dlg')).not.toBeNull()
  })

  it('取消 → 不调接口、不弹成功提示、不重新取列表', async () => {
    const { vm, host } = await mountAndInject([publishedRow])
    const before = listSpy.mock.calls.length
    opBtn(host, '已发布技能', '停用').click()
    await nextTick()
    vm.stopDialogVisible = false
    await settle(0)
    const { ElMessage } = await import('element-plus')
    expect(delistSpy).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(listSpy.mock.calls.length).toBe(before)
  })

  it('接口失败（如已有在审提交）→ 错误提示取 message 原文「已有在审提交，请先撤回或等待审核结论」；无 message → 「操作失败」，不弹成功提示、弹窗保留可重试', async () => {
    const { vm, host } = await mountAndInject([{ ...publishedRow, ...noRefs }])
    const { ElMessage } = await import('element-plus')
    delistSpy.mockRejectedValueOnce(new Error('已有在审提交，请先撤回或等待审核结论'))
    opBtn(host, '已发布技能', '停用').click()
    await nextTick()
    await tickForceCheck(host)
    await typeReason(host, '原因')
    dd(host, '[data-test="dd-confirm"]').click()
    await settle(0)
    expect(delistSpy).toHaveBeenCalledWith('r_pub', { forceRevoke: true, reason: '原因' })
    expect(ElMessage.error).toHaveBeenCalledWith('已有在审提交，请先撤回或等待审核结论')
    expect(dd(host, '.dlg')).not.toBeNull()
    delistSpy.mockRejectedValueOnce(new Error(''))
    dd(host, '[data-test="dd-confirm"]').click()
    await settle(0)
    expect(ElMessage.error).toHaveBeenLastCalledWith('操作失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('未发布且带回收信息的行：状态列出现「已回收」标签，悬停写明原因 / 操作人 / 时间；已发布行、从未回收的未发布行都没有', async () => {
    const revoked = { reason: '技能内含违规内容', at: '2026-10-09 09:30', operator: 'admin' }
    const { host } = await mountAndInject([
      { ...draftRow, id: 'r_rev', name: '已回收技能', revoked },
      publishedRow,
      draftRow
    ])
    const tag = stateCell(host, '已回收技能').querySelector('.revoked-tag')
    expect(tag?.textContent).toBe('已回收')
    expect(tag.parentElement.getAttribute('content')).toBe('回收原因：技能内含违规内容（admin · 2026-10-09 09:30）')
    expect(stateCell(host, '已发布技能').querySelector('.revoked-tag')).toBeNull()
    expect(stateCell(host, '未发布技能').querySelector('.revoked-tag')).toBeNull()
  })
})
