// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminSkillsUnified.vue 真实挂载冒烟（2026-09-12 测试审计 T49②）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §一 导航栏 L9-16 / §二.1 列表展示 L40-48。
 *
 * 与 adminSkillsUnified.test.js（全桩 + stubEnv 关 mock）互补：这里 app.use(ElementPlus) 真装、
 * 真 el-table / ListToolbar / ListStates / ListPagination / StatusTag / PageHeader / VersionDrawer / SkillCreateDialog，
 * 数据走真实 unifiedSkillMock 种子（demo 默认 mock 路径），只把 @/api/request（axios+router 链）与 vue-router 换成桩；
 * 守住「页面能挂起来、探针文案在、控制台零 error」（桩测拦不住 setup 期错误 / 子组件 props 形状不对）。
 */

vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor({ code, message } = {}) {
      super(message)
      this.code = code
    }
  }
}))
// 部分桩：SkillCreateDialog → api/skillFiles → stores/user → @/router 需要真 createRouter，只覆写页面用的两个 hook
const push = vi.fn()
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push, resolve: vi.fn(() => ({ href: '#' })) }),
  useRoute: () => ({ meta: {}, name: 'AdminSkillsUnified', query: {} })
}))

const AdminSkillsUnified = (await import('@/views/admin/AdminSkillsUnified.vue')).default

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('AdminSkillsUnified · 真实挂载冒烟（真 Element Plus，数据走 unifiedSkillMock 种子）', () => {
  it('挂载不抛：页头「技能」+ 说明、搜索框占位、筛选占位、【新建技能】、表头「最新版本」、种子行渲染、分页条在、console.error 零调用（md §一 / §二.1）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => { mounted = mountReal(AdminSkillsUnified) }).not.toThrow()
    await flushAll(12)
    // mock 层 delay(120ms) 后列表才回来
    await new Promise((r) => setTimeout(r, 200))
    await flushAll(6)
    const { container } = mounted
    const text = container.textContent

    // 页头与说明（md L9-10）
    expect(text).toContain('技能')
    expect(text).toContain('平台全部技能 —— 通用技能 / 岗位私有 / 市场技能 统一管理')
    // 搜索框占位（md L11）+ 三个筛选占位（md L12-14）+ 查询 / 新建入口（md L15-16）
    expect(container.querySelector('input[placeholder="搜索技能名称或描述"]')).toBeTruthy()
    // EP 2.14 el-select 占位渲染为 .el-select__placeholder 文本
    const selectPlaceholders = [...container.querySelectorAll('.el-select__placeholder')].map((el) => el.textContent.trim())
    expect(selectPlaceholders).toEqual(expect.arrayContaining(['全部技能类型', '全部技能分类', '全部状态']))
    expect(text).toContain('查询')
    expect(text).toContain('新建技能')
    // 表头（md L40-48）：真 el-table 表头含 技能名 / 状态 / 技能描述 / 技能类型 / 技能分类 / 工具数 / 引用情况 / 最新版本 / 最近更新时间 / 操作
    const heads = [...container.querySelectorAll('.el-table__header th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim())
    for (const h of ['技能名', '状态', '技能描述', '技能类型', '技能分类', '工具数', '引用情况', '最新版本', '操作']) {
      expect(heads.some((t) => t.includes(h)), `表头缺「${h}」`).toBe(true)
    }
    expect(heads.some((t) => t.includes('最近更新时间'))).toBe(true)
    // 真 el-table 渲染出种子行：状态标签三态文案与操作按钮在
    const rows = container.querySelectorAll('.el-table__body tr.el-table__row')
    expect(rows.length).toBeGreaterThan(0)
    expect(text).toContain('日报周报生成') // unifiedSkillMock 种子 sk_301
    expect(text).toContain('已发布')
    expect(text).toContain('查看')
    expect(text).toContain('编辑')
    // 引用情况（md L45）：sk_301 被 2 个岗位引用
    expect(text).toContain('2 个岗位引用')
    // 统一分页条真渲染
    expect(container.querySelector('.list-pager')).toBeTruthy()
    // 控制台零错误（含 Vue 警告——props 形状/未注册组件都会以 warn 冒出来）
    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([])
  })

  it('点【新建技能】→ 真 el-dialog 打开「新建技能」弹窗，技能类型三选项 + 「建成后不可更改」提示在（md §三.2 L151-152），console.error 零调用', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReal(AdminSkillsUnified)
    await flushAll(12)
    await new Promise((r) => setTimeout(r, 200))
    await flushAll(6)
    const create = [...mounted.container.querySelectorAll('.lt-create')].find((b) => b.textContent.includes('新建技能'))
    expect(create).toBeTruthy()
    create.click()
    await flushAll(10)
    const body = document.body.textContent
    expect(body).toContain('新建技能')
    expect(body).toContain('岗位私有')
    expect(body).toContain('市场技能')
    expect(body).toContain('通用技能')
    expect(body).toContain('建成后不可更改')
    expect(errSpy).not.toHaveBeenCalled()
  })
})
