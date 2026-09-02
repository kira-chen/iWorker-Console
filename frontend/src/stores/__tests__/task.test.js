import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// store 依赖 @/api/task 的网络层；本测试只关心轮询定时器的生命周期，
// 故把 API 全部 mock 成可控的空 resolve，避免真实请求/拦截器介入。
vi.mock('@/api/task', () => ({
  listTasks: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  getTask: vi.fn(() => Promise.resolve({})),
  setTaskStatus: vi.fn(() => Promise.resolve({})),
  deleteTask: vi.fn(() => Promise.resolve()),
  runTaskNow: vi.fn(() => Promise.resolve({ executionId: 'x' })),
  listExecutions: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  // 默认回填仍为 RUNNING，避免 refreshExecution 把活跃执行刷成终态而影响起轮询判据；
  // 个别用例可按需覆盖此返回。
  getExecution: vi.fn((id, execId) => Promise.resolve({ id: execId, status: 'RUNNING' }))
}))

import { useTaskStore } from '@/stores/task'

/**
 * 轮询定时器生命周期测试。
 *
 * 目的：防「组件卸载/离开页面未清理轮询」类内存泄漏回归。
 * store 把 listTimer/execTimer 收敛在闭包内，页面 onBeforeUnmount 调
 * stopListPolling / resetDetail(→stopExecPolling) 释放；这里用 fake timers
 * + spy on setInterval/clearInterval 验证起停语义。
 */
describe('task store · 轮询定时器生命周期', () => {
  let setSpy
  let clearSpy

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    setSpy = vi.spyOn(globalThis, 'setInterval')
    clearSpy = vi.spyOn(globalThis, 'clearInterval')
  })

  afterEach(() => {
    setSpy.mockRestore()
    clearSpy.mockRestore()
    vi.useRealTimers()
  })

  /* ================= 列表轮询 ================= */
  describe('列表轮询 syncListPolling / stopListPolling', () => {
    it('存在 RUNNING 行时起轮询：listTimer 被设置（setInterval 调用一次）', () => {
      const store = useTaskStore()
      store.tasks = [{ id: 1, lastRunStatus: 'RUNNING' }]

      store.syncListPolling()

      expect(setSpy).toHaveBeenCalledTimes(1)
      expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    })

    it('无活跃行（全终态）时不起轮询', () => {
      const store = useTaskStore()
      store.tasks = [
        { id: 1, lastRunStatus: 'SUCCEEDED' },
        { id: 2, lastRunStatus: 'FAILED' }
      ]

      store.syncListPolling()

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('stopListPolling 清理定时器：clearInterval 被调用（模拟组件卸载）', () => {
      const store = useTaskStore()
      store.tasks = [{ id: 1, lastRunStatus: 'RUNNING' }]
      store.syncListPolling()
      expect(setSpy).toHaveBeenCalledTimes(1)

      store.stopListPolling()

      expect(clearSpy).toHaveBeenCalledTimes(1)
      // 已清理：再次 stop 不应重复 clear（timer 已置 null）
      store.stopListPolling()
      expect(clearSpy).toHaveBeenCalledTimes(1)
    })

    it('重复起轮询不产生多个 interval（!listTimer 守卫）', () => {
      const store = useTaskStore()
      store.tasks = [{ id: 1, lastRunStatus: 'RUNNING' }]

      store.syncListPolling()
      store.syncListPolling()
      store.syncListPolling()

      expect(setSpy).toHaveBeenCalledTimes(1)
    })

    it('运行中行转终态后再 sync：自动停轮询（clearInterval）', () => {
      const store = useTaskStore()
      store.tasks = [{ id: 1, lastRunStatus: 'RUNNING' }]
      store.syncListPolling()
      expect(setSpy).toHaveBeenCalledTimes(1)

      // 该行跑完
      store.tasks = [{ id: 1, lastRunStatus: 'SUCCEEDED' }]
      store.syncListPolling()

      expect(clearSpy).toHaveBeenCalledTimes(1)
    })
  })

  /* ================= 执行轮询 ================= */
  describe('执行轮询 fetchExecutions(syncExecPolling) / stopExecPolling', () => {
    it('存在活跃执行（RUNNING）时起轮询：execTimer 被设置', async () => {
      const store = useTaskStore()
      store.executions = [{ id: 'e1', status: 'RUNNING' }]

      // syncExecPolling 是内部函数，由 afterRunNow 收尾触发；
      // 据当前 executions 是否有非终态决定起停（getExecution mock 回填仍为 RUNNING）。
      await store.afterRunNow('t1', 'e1')

      expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
      // 起了恰好一个执行轮询
      expect(setSpy).toHaveBeenCalledTimes(1)
    })

    it('无活跃执行时不起轮询', async () => {
      const { getExecution } = await import('@/api/task')
      getExecution.mockResolvedValueOnce({ id: 'e1', status: 'SUCCEEDED' })

      const store = useTaskStore()
      store.executions = [{ id: 'e1', status: 'SUCCEEDED' }]

      await store.afterRunNow('t1', 'e1')

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('stopExecPolling 清理定时器：clearInterval 被调用且幂等', async () => {
      const store = useTaskStore()
      store.executions = [{ id: 'e1', status: 'RUNNING' }]
      await store.afterRunNow('t1', 'e1')
      expect(setSpy).toHaveBeenCalledTimes(1)

      store.stopExecPolling()
      expect(clearSpy).toHaveBeenCalledTimes(1)
      store.stopExecPolling()
      expect(clearSpy).toHaveBeenCalledTimes(1)
    })

    it('重复起执行轮询不产生多个 interval（!execTimer 守卫）', async () => {
      const store = useTaskStore()
      store.executions = [{ id: 'e1', status: 'RUNNING' }]

      await store.afterRunNow('t1', 'e1')
      await store.afterRunNow('t1', 'e1')

      expect(setSpy).toHaveBeenCalledTimes(1)
    })

    it('resetDetail（离开详情页/组件卸载）会停执行轮询', async () => {
      const store = useTaskStore()
      store.executions = [{ id: 'e1', status: 'RUNNING' }]
      await store.afterRunNow('t1', 'e1')
      expect(setSpy).toHaveBeenCalledTimes(1)

      store.resetDetail()

      expect(clearSpy).toHaveBeenCalledTimes(1)
      // 详情态被清空
      expect(store.executions).toEqual([])
      expect(store.detail).toBeNull()
    })
  })

  /**
   * 数据流守卫（2026-08-08 变异审计补）。
   *
   * 背景：本文件原有 10 例**全部只测轮询定时器生命周期**，不碰数据加载与状态回填——
   * 实测把 store 内前 5 处 `.value` 赋值全部掏空，10 例无一翻红（真实覆盖缺口，非假绿）。
   * 本组补上「请求 → 状态回填 → 失败态」这条主链路。
   */
  describe('数据流：请求 → 状态回填 → 失败态', () => {
    it('fetchList 成功：回填 tasks/total 并落 loading 态', async () => {
      const api = await import('@/api/task')
      api.listTasks.mockResolvedValueOnce({ items: [{ id: 't1' }, { id: 't2' }], total: 7 })
      const store = useTaskStore()
      await store.fetchList(2)
      expect(store.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
      expect(store.total).toBe(7)
      expect(store.page).toBe(2)
      expect(store.listLoading).toBe(false)
      expect(store.listError).toBe(false)
    })

    it('fetchList 失败：置 listError、不抛出、loading 归位（防卡骨架）', async () => {
      const api = await import('@/api/task')
      api.listTasks.mockRejectedValueOnce(new Error('boom'))
      const store = useTaskStore()
      await store.fetchList(1)
      expect(store.listError).toBe(true)
      expect(store.listLoading).toBe(false)
    })

    it('fetchList 空结果：归一为空数组与 0，不产生 undefined', async () => {
      const api = await import('@/api/task')
      api.listTasks.mockResolvedValueOnce({})
      const store = useTaskStore()
      await store.fetchList(1)
      expect(store.tasks).toEqual([])
      expect(store.total).toBe(0)
    })

    it('refreshListSilent 静默重拉：回填数据但不触发 loading 骨架（防列表闪烁）', async () => {
      const api = await import('@/api/task')
      api.listTasks.mockResolvedValueOnce({ items: [{ id: 'a' }], total: 1 })
      const store = useTaskStore()
      await store.refreshListSilent()
      expect(store.tasks.map((t) => t.id)).toEqual(['a'])
      expect(store.listLoading, '静默刷新不得置 loading').toBe(false)
    })

    it('refreshListSilent 失败：静默吞掉，不置 listError（下次轮询再试）', async () => {
      const api = await import('@/api/task')
      api.listTasks.mockRejectedValueOnce(new Error('net'))
      const store = useTaskStore()
      await store.refreshListSilent()
      expect(store.listError, '轮询失败不应打扰用户').toBe(false)
    })
  })
})
