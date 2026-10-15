// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { createPinia } from 'pinia'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminSkillEditPage.vue 真实挂载冒烟（2026-10-08 /test-audit 补缺口）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.1 进入方式（顶部【← 返回】）/
 *   §三.3 顶行组成（「技能名称：」label + 技能名）/ §三.8 时间信息。
 *
 * 与 adminSkillEditPage.test.js（SkillFocusEditor 整体桩、数据源全 spy）互补：这里 app.use(ElementPlus) 真装、
 * 页面 + 真实 SkillFocusEditor（含 SkillFileTree / ToolDock / SkillMilkdownEditor 等子组件）一起挂，
 * 数据走真实 unifiedSkillMock 的 sk_302（市场技能，demo 默认 mock 路径），只把 @/api/request（axios + router 链）
 * 与 vue-router 换成桩；守住「页面能挂起来、顶行探针文案在、控制台零 error」。
 * Milkdown 编辑器未桩（jsdom 下可跑起来，若日后跑不起再桩并在此注明）。
 * 本仓 jsdom 环境 globalThis.localStorage 为 undefined，而 stores/user.js 直读 localStorage（浏览器恒有，非产品缺陷），
 * 故导入页面前注入内存版存储（同 unifiedSkillMock.test.js 写法），文件结束还原。
 */
const memStore = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    get length() { return memStore.size },
    key: (i) => [...memStore.keys()][i] ?? null,
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k),
    clear: () => memStore.clear()
  },
  writable: true,
  configurable: true
})
afterAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
})

vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor({ code, message } = {}) {
      super(message)
      this.code = code
    }
  }
}))
// 部分桩：stores/user → @/router 需要真 createRouter，只覆写页面用的三个 hook
const push = vi.fn()
// 用例可改 id：默认市场技能 sk_302
const routeState = vi.hoisted(() => ({ id: 'sk_302' }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push, resolve: vi.fn(() => ({ href: '#' })) }),
  useRoute: () => ({ meta: { skillSource: 'platform' }, params: routeState, query: {}, name: 'AdminSkillEdit' }),
  onBeforeRouteLeave: vi.fn()
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

/** 在组件树里按 SFC 名找子组件实例（取其 props）。 */
function findInstance(vnode, name) {
  if (!vnode) return null
  if (vnode.component) {
    const t = vnode.component.type
    if ((t.__name || t.name) === name) return vnode.component
    return findInstance(vnode.component.subTree, name)
  }
  if (Array.isArray(vnode.children)) {
    for (const c of vnode.children) {
      const r = findInstance(c, name)
      if (r) return r
    }
  }
  return null
}

let mounted
afterEach(() => {
  routeState.id = 'sk_302' // 无论上一条是否失败，都还原默认技能，避免乱序时串味
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('AdminSkillEditPage · 真实挂载冒烟（真 Element Plus + 真 SkillFocusEditor，数据走 unifiedSkillMock sk_302）', () => {
  it('挂载不抛：顶行「← 返回」「技能名称：」与技能名在、底部时间信息在，console.error 零调用（md §三.1 / §三.3 / §三.8）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => { mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] }) }).not.toThrow()
    await flushAll(12)
    // mock 层有 delay，详情 / 文件树回来后才渲染顶行与时间条
    await new Promise((r) => setTimeout(r, 400))
    await flushAll(8)
    const { container } = mounted
    const text = container.textContent

    expect(container.querySelector('.topline-back')?.textContent.trim()).toBe('← 返回')
    expect(text).toContain('技能名称：')
    expect(text).toContain('经营数据分析') // sk_302 种子技能名
    expect(container.querySelector('.se-meta')?.textContent).toContain('最新版本：')
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('示例问题输入框占位逐字为 md §三.4「填 1 个终端用户会问的问题」（yuepu#63④）', async () => {
    const { createSkill } = await import('@/api/unifiedSkillMock')
    const { skillId } = await createSkill({ name: '占位校验' + Date.now(), type: 'PLATFORM', categoryName: '办公效率' }) // 草稿可编辑，示例问题框才渲染
    routeState.id = skillId
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] })
    await flushAll(12)
    await new Promise((r) => setTimeout(r, 400))
    await flushAll(8)
    expect(mounted.container.querySelector('input[placeholder="填 1 个终端用户会问的问题"]')).toBeTruthy()
  })

  it('市场技能未选分类 → 版本弹窗前置拦截提示逐字为 md §四.1「…按规则不可提交发布」，不带多余后半句（yuepu#63②）', async () => {
    const { createSkill } = await import('@/api/unifiedSkillMock')
    // 新建一条草稿市场技能再清空分类 → displayCategoryId 为空（不动共享种子）
    const { skillId } = await createSkill({ name: '无分类校验' + Date.now(), type: 'PLATFORM', categoryName: '办公效率' })
    const { _reset } = await import('@/api/unifiedSkillMock')
    _reset(skillId, { category: '' })
    routeState.id = skillId
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] })
    await flushAll(12)
    await new Promise((r) => setTimeout(r, 400))
    await flushAll(8)
    // 版本抽屉组件拿到的适配器就是页面 versionAdapter；submitGate 即抽屉前置拦截文案
    const drawer = findInstance(mounted.app._instance.subTree, 'VersionDrawer')
    expect(drawer.props.adapter.submitGate()).toBe('该技能还未选择「技能分类」，按规则不可提交发布')
  })

  it('岗位私有技能（sk_301）顶行 = 返回 / 技能名称 / 技能名 / 类别标签，不多出恒为「岗位」的标签（md §三.3 顶行组成；yuepu#63⑤）', async () => {
    routeState.id = 'sk_301'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] })
    await flushAll(12)
    await new Promise((r) => setTimeout(r, 400))
    await flushAll(8)
    const { container } = mounted
    expect(container.textContent).toContain('日报周报生成') // 前提：确实挂的是岗位私有技能
    expect(container.querySelector('.eh-position-tag')).toBeNull()
  })
})
