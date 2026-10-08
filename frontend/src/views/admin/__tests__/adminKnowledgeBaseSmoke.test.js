// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { h, reactive } from 'vue'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminKnowledgeBase.vue（知识库容器页）真实 Element Plus 挂载冒烟 —— 2026-10-08 测试审计补缺口。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §二.1（标题「知识库」）/
 * §二.2（两个页签「知识库管理」「数据源管理」）。
 * adminKnowledgeBaseShell.test.js 把 el-tabs 桩掉了，这里用真 el-tabs；两个子页仍以桩替代（各有真实挂载冒烟）。
 */
vi.mock('@/views/admin/KnowledgeBaseList.vue', () => ({ default: { name: 'StubKb', render: () => h('div', { class: 'stub-kb' }, 'kb 子页') } }))
vi.mock('@/views/admin/KnowledgeSourceList.vue', () => ({ default: { name: 'StubSrc', render: () => h('div', { class: 'stub-src' }, 'source 子页') } }))
const routeMock = reactive({ query: {} })
const routerMock = { replace: vi.fn((loc) => { routeMock.query = { ...loc.query } }) }
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))

const AdminKnowledgeBase = (await import('@/views/admin/AdminKnowledgeBase.vue')).default

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('AdminKnowledgeBase · 真实 el-tabs 挂载冒烟', () => {
  it('挂载不抛、console.error 零调用；标题与两个页签文案在，默认落「知识库管理」子页', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    routeMock.query = {}
    expect(() => (mounted = mountReal(AdminKnowledgeBase))).not.toThrow()
    await flushAll(8)
    const tabs = [...mounted.container.querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
    expect(tabs).toEqual(['知识库管理', '数据源管理'])
    expect(mounted.container.textContent).toContain('知识库')
    expect(mounted.container.querySelector('.stub-kb')).toBeTruthy()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('点「数据源管理」页签 → 地址参数切到 tab=source，并显示数据源子页', async () => {
    routeMock.query = { tab: 'kb' }
    mounted = mountReal(AdminKnowledgeBase)
    await flushAll(8)
    ;[...mounted.container.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.trim() === '数据源管理').click()
    await flushAll(8)
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'source' } })
    expect(mounted.container.querySelector('.stub-src')).toBeTruthy()
  })
})
