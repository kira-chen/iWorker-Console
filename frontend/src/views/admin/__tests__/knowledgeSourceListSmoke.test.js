// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * KnowledgeSourceList.vue 真实 Element Plus 挂载冒烟 —— 2026-10-08 测试审计补缺口。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §四.1（右上角【新建数据源】）/
 * §四.2（概要：上传「N 篇文档」；API/MCP「已连通」「连接失败」）。
 * 不桩任何组件；api 层不 mock，走真实 knowledgeBaseMock 种子（真 250ms 延迟）。
 */
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))

const KnowledgeSourceList = (await import('@/views/admin/KnowledgeSourceList.vue')).default

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})
const rowOf = (name) => [...mounted.container.querySelectorAll('.el-table__body tr')].find((tr) => tr.textContent.includes(name))

describe('KnowledgeSourceList · 真实挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；【新建数据源】在，种子行概要按类型展示', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => (mounted = mountReal(KnowledgeSourceList))).not.toThrow()
    await flushAll(6)
    await vi.waitFor(() => expect(rowOf('产品资料')).toBeTruthy(), { timeout: 3000 })
    expect(mounted.container.querySelector('.lt-create').textContent.trim()).toBe('新建数据源')
    expect(rowOf('产品资料').textContent).toContain('3 篇文档')
    expect(rowOf('国标检索接口').textContent).toContain('已连通')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
