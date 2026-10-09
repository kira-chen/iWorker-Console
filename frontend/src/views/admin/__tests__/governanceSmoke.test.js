// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * 治理组五页真实挂载冒烟（2026-10-08 /test-audit 补缺口新建）。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/05治理/ 下：
 *  - 审核中心 prd.审核中心.md §一（标题 / 页面说明）+ §三（待审核列表）；
 *  - 我的申请 prd.我的申请.md §一 + §三；
 *  - 用户技能审核 prd.用户技能审核.md 页头 + 审核记录列表；
 *  - 字段字典 prd.字段字典.md §一 + §2.2（技能分类选项）；
 *  - 用户反馈 prd.用户反馈.md 页头 + 反馈列表。
 *
 * 各页的桩测（unifiedReview / myApplications / userSkillReviews / fieldManagement / adminFeedback.test.js）把
 * el-table 等全部桩掉，拦不住组件 setup 期错误、子组件 props 形状不对这类白屏故障。这里用 helpers/smokeMount
 * 真装 Element Plus、**不 mock 数据层**（走 api 门面 → 各 xxxMock 种子，DEV 下即 demo 的真实取数链路），断言：
 * 挂载不抛、console.error 零调用、页头标题 + 说明在、一条种子行文案出现在列表里。
 * 种子行文案从对应 mock 模块现取（与门面同一模块实例），种子改了不用跟着改本文件。
 */

// 本机 Node 26 下 jsdom 的 localStorage 为 undefined（见 versionMock.test.js 注释）；stores/user 建 store 时要读它
const makeStorage = () => {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

let mounted, errorSpy
beforeEach(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  }
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  errorSpy.mockRestore()
  document.body.innerHTML = ''
})

async function mountPage(Component) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }]
  })
  await router.push('/')
  await router.isReady()
  expect(() => {
    mounted = mountReal(Component, {}, { plugins: [router, createPinia()] })
  }).not.toThrow()
  await flushAll(8)
}
const title = () => mounted.container.querySelector('.page-header-title').textContent.trim()
const subtitle = () => mounted.container.querySelector('.page-header-sub').textContent.trim()
/** mock 自带 80～300ms 延迟，等种子行渲染进来。 */
const waitText = (text) => vi.waitFor(() => expect(mounted.container.textContent).toContain(text), { timeout: 3000 })

describe('治理五页 · 真实 Element Plus 挂载冒烟', () => {
  it('审核中心：挂载不抛、console.error 零调用；页头「审核中心」+ 说明；待审列表出现种子行', async () => {
    const seed = (await (await import('@/api/reviewsMock')).listReviews()).list[0].name
    await mountPage((await import('@/views/admin/UnifiedReview.vue')).default)
    await waitText(seed)
    expect(title()).toBe('审核中心')
    expect(subtitle()).toContain('审核系统配置员提交的连接器、技能、模型、岗位与专家发布、停用申请')
    expect(mounted.container.querySelector('.el-table')).toBeTruthy()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('我的申请：挂载不抛、console.error 零调用；页头「我的申请」+ 说明；申请列表出现种子行', async () => {
    const seed = (await (await import('@/api/myApplicationsMock')).listMyApplications()).list[0].objectName
    await mountPage((await import('@/views/admin/MyApplications.vue')).default)
    await waitText(seed)
    expect(title()).toBe('我的申请')
    expect(subtitle()).toBe('查看和跟踪自己从各业务模块提交的审核申请')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('用户技能审核：挂载不抛、console.error 零调用；页头「用户技能审核」+ 说明；审核记录出现种子行', async () => {
    const first = (await (await import('@/api/skillReviewMock')).listReviewApplications({ page: 1, size: 50 })).list[0]
    const seed = first.skillName || first.name
    expect(seed).toBeTruthy()
    await mountPage((await import('@/views/admin/UserSkillReviews.vue')).default)
    await waitText(seed)
    expect(title()).toBe('用户技能审核')
    expect(subtitle()).toBe('审核用户上传的自定义技能，处理高风险检测记录，并设置风险尺度。')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('字段字典：挂载不抛、console.error 零调用；页头「字段字典」+ 说明；两分组与技能分类首个选项在', async () => {
    const seed = (await (await import('@/api/fieldDictMock')).listFieldDict()).skillCategory[0].name
    await mountPage((await import('@/views/admin/FieldManagement.vue')).default)
    await waitText(seed)
    expect(title()).toBe('字段字典')
    expect(subtitle()).toBe('集中维护平台各类可配置字段字典。「编辑」进入后可增删改该字段下的选项值。')
    expect([...mounted.container.querySelectorAll('.aps-group-name')].map((n) => n.textContent.trim())).toEqual(['平台技能', '专家'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('用户反馈：挂载不抛、console.error 零调用；页头「用户反馈」+ 说明；反馈列表出现种子行', async () => {
    const seed = (await (await import('@/api/feedbackMock')).listFeedbacks()).list[0].username
    await mountPage((await import('@/views/admin/AdminFeedback.vue')).default)
    await waitText(seed)
    expect(title()).toBe('用户反馈')
    expect(subtitle()).toBe('查看客户端用户提交的意见反馈与截图附件')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
