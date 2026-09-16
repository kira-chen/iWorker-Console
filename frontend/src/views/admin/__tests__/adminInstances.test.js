// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

const api = { listInstances: vi.fn(), operateInstance: vi.fn() }
vi.mock('@/api/instance', () => api)

const AdminInstances = (await import('@/views/admin/AdminInstances.vue')).default

const rows = [
  { id: 'ins-1', name: '张敏', username: 'zhangmin', position: '经营分析岗', status: 'RUNNING', actualSpec: '重', effectiveSpec: '重', cpu: '4 核 / 16 Gi', usage: '2.8 核 / 9.6 Gi', startedAt: '2026-09-16 09:12', active: '2026-09-16 15:28', updatedAt: '2026-09-16 15:30', error: '—', operable: false, operationHint: '实例当前繁忙', records: [] },
  { id: 'ins-2', name: '李琳', username: 'lilin', position: '客户成功岗', status: 'IDLE', actualSpec: '标准', effectiveSpec: '重', cpu: '2 核 / 4 Gi', usage: '0.2 核 / 0.8 Gi', startedAt: '2026-09-16 08:40', active: '2026-09-16 14:56', updatedAt: '2026-09-16 15:30', error: '—', operable: true, operationHint: '', records: [] }
]

let mounted
beforeEach(() => {
  vi.clearAllMocks()
  api.listInstances.mockResolvedValue({ list: rows, total: rows.length, updatedAt: '2026-09-16 15:30' })
  api.operateInstance.mockResolvedValue({})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

async function mountPage(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/instances', name: 'AdminInstances', component: AdminInstances }]
  })
  await router.push({ name: 'AdminInstances', query })
  await router.isReady()
  mounted = mountReal(AdminInstances, {}, { plugins: [router] })
  await flushAll(12)
  return mounted.container
}

describe('AdminInstances · 实例管理范围纠偏', () => {
  it('真实挂载展示实例汇总，不再出现会话页签、任务情况和关联会话', async () => {
    const container = await mountPage()
    const text = container.textContent
    expect(text).toContain('实例管理')
    expect(text).toContain('按规格')
    expect(text).toContain('按岗位')
    expect(text).toContain('实例明细')
    expect(text).toContain('运行中')
    expect(text).toContain('规格待生效')
    expect(text).not.toContain('会话页签')
    expect(text).not.toContain('任务情况')
    expect(text).not.toContain('关联会话')
    expect(api.listInstances).toHaveBeenCalledWith({ size: 200 })
  })

  it('实例深链进入明细并打开对应实例详情', async () => {
    const container = await mountPage({ view: 'detail', instance: 'ins-2' })
    expect(container.textContent).toContain('实例详情 · 李琳')
    expect(container.textContent).toContain('当前实际规格')
    expect(container.textContent).toContain('当前生效规格')
    expect(container.textContent).toContain('操作记录')
  })
})
