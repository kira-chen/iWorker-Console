// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminInstances.vue（实例管理）真实挂载单测。
 * 2026-10-08 对齐 04运行/实例管理/prd.实例管理.md §五 / §七 / §九：三种查看方式（按规格 / 按岗位 / 实例明细）、
 * 四张指标卡、实例明细列与实例详情；本页只管实例，不含任务 / 排队 / 会话。
 * 状态机缺边（启动中→运行中/空闲、回收中→移除）见待办 clcao#2，此处不覆盖。
 * 只 mock @/api/instance；指标卡用例改喂 instanceMock 真种子以核对真实计数。
 */

// instanceMock 带 localStorage 持久化，jsdom 下置空（同 instanceMock.test.js）
vi.mock('@/api/mockPersist', () => ({ attachPersist: () => vi.fn() }))
const seed = await import('@/api/instanceMock')

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
  it('真实挂载展示实例汇总：查看方式正好三种、四张指标卡按种子计数；实例明细表头不含任务 / 排队 / 会话', async () => {
    // 喂 instanceMock 真种子（5 个实例：运行中 ins-240901；空闲 ins-240902、ins-240904；异常 ins-240903；
    // 启动中 ins-240905；实际≠生效规格只有 ins-240904「标准→重」）
    seed.__resetInstanceMock()
    api.listInstances.mockResolvedValue(await seed.listInstances({ size: 200 }))
    const container = await mountPage()
    expect(container.textContent).toContain('实例管理')
    expect(api.listInstances).toHaveBeenCalledWith({ size: 200 })
    // 查看方式：正好三项，不多不少
    const viewOptions = [...container.querySelectorAll('.view-switch .el-radio-button')].map((b) => b.textContent.trim())
    expect(viewOptions).toEqual(['按规格', '按岗位', '实例明细'])
    // 四张指标卡：标签与数字
    const cards = [...container.querySelectorAll('.metric-card')].map((c) => [c.querySelector('span').textContent.trim(), c.querySelector('strong').textContent.trim()])
    expect(cards).toEqual([['运行中', '1'], ['空闲', '2'], ['异常', '1'], ['规格待生效', '1']])
    // 切到实例明细：表头只有实例维度的列，没有任务 / 排队 / 会话
    container.querySelectorAll('.view-switch .el-radio-button')[2].querySelector('input').click()
    await flushAll(12)
    const headers = [...container.querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim()).filter(Boolean)
    expect(headers).toContain('实例状态')
    expect(headers).toContain('当前实际规格')
    for (const word of ['任务', '排队', '会话']) {
      expect(headers.filter((h) => h.includes(word))).toEqual([])
    }
  })

  it('实例深链进入明细并打开对应实例详情', async () => {
    const container = await mountPage({ view: 'detail', instance: 'ins-2' })
    expect(container.textContent).toContain('实例详情 · 李琳')
    expect(container.textContent).toContain('当前实际规格')
    expect(container.textContent).toContain('当前生效规格')
    expect(container.textContent).toContain('操作记录')
  })
})
