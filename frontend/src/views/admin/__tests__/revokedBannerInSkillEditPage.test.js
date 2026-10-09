// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { createPinia } from 'pinia'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminSkillEditPage.vue 顶部「已回收」提示条（RevokedBanner）。
 *
 * 2026-10-09 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §3.5.1「强制回收」（/test-audit 补缺口 A6）：
 * 被强制回收的技能，编辑 / 查看页顶部展示「该技能已于 {时间} 被强制回收：{原因}」；未被回收则不展示。
 * 页面模板挂载条件：`skill?.revoked` 非空才挂。
 *
 * 挂载方式同 adminSkillEditPageSmoke.test.js（真 Element Plus + 真 SkillFocusEditor，数据走真 unifiedSkillMock 的 sk_302），
 * 用 _reset 给种子技能写 / 清 revoked，用例间复位；只把 @/api/request 与 vue-router 换成桩。
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
const push = vi.fn()
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push, resolve: vi.fn(() => ({ href: '#' })) }),
  useRoute: () => ({ meta: { skillSource: 'platform' }, params: { id: 'sk_302' }, query: {}, name: 'AdminSkillEdit' }),
  onBeforeRouteLeave: vi.fn()
}))

const skillMock = await import('@/api/unifiedSkillMock')
const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

const REVOKED = { reason: '技能内含违规内容', at: '2026-10-09 09:30', operator: 'admin' }

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  skillMock._reset('sk_302', { revoked: null })
  vi.restoreAllMocks()
})

async function openPage() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] })
  await flushAll(12)
  // mock 层有 delay，详情回来后才渲染顶行与提示条
  await new Promise((r) => setTimeout(r, 400))
  await flushAll(8)
  return mounted.container
}

describe('AdminSkillEditPage · 已回收提示条（prd.技能.md §3.5.1）', () => {
  it('打开一个被强制回收的技能 → 页面顶部提示「该技能已于 2026-10-09 09:30 被强制回收：技能内含违规内容」', async () => {
    skillMock._reset('sk_302', { revoked: REVOKED })
    const el = await openPage()
    expect(el.textContent).toContain('经营数据分析') // 页面确实加载到了这条技能
    expect(el.querySelector('.revoked-banner')?.textContent.trim()).toBe('该技能已于 2026-10-09 09:30 被强制回收：技能内含违规内容')
  })

  it('打开一个没被回收过的技能 → 不出现提示条', async () => {
    const el = await openPage()
    expect(el.textContent).toContain('经营数据分析')
    expect(el.querySelector('.revoked-banner')).toBeNull()
  })
})
