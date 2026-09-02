import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listTasks,
  getTask,
  setTaskStatus,
  deleteTask,
  runTaskNow,
  listExecutions,
  getExecution
} from '@/api/task'
import { isTaskRunning, isExecActive } from '@/utils/taskStatus'

/**
 * 定时任务状态管理。
 *
 * 轮询分工（契约 §2 前端轮询口径）：
 *  - 列表轮询（startListPolling）：存在「运行中」行时 5s 重拉列表，刷各行 lastRunStatus/lastRunAt/nextRunAt；
 *    全部终态则自动停。
 *  - 单条执行轮询（pollExecution）：run-now / 详情运行中执行，对单条调 §4.2，避免整页刷新；
 *    终态（非 RUNNING/RETRYING）即停。
 *
 * 列表与详情各持一份独立状态；轮询定时器收敛在 store，页面卸载时调 stopXxxPolling 释放。
 */
const POLL_MS = 5000

export const useTaskStore = defineStore('task', () => {
  /* ---------------- 列表态 ---------------- */
  const tasks = ref([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(20)
  const listLoading = ref(false)
  const listError = ref(false)
  let listTimer = null

  /* ---------------- 详情态 ---------------- */
  const detail = ref(null)
  const detailLoading = ref(false)
  const detailError = ref(false)

  // 执行记录（分页累加）
  const executions = ref([])
  const execTotal = ref(0)
  const execPage = ref(1)
  const execSize = ref(10)
  const execLoading = ref(false)
  const execError = ref(false)
  let execTimer = null

  /* ================= 列表 ================= */
  async function fetchList(p = page.value) {
    page.value = p
    listLoading.value = true
    listError.value = false
    try {
      const data = await listTasks({ page: page.value, size: size.value })
      tasks.value = data?.items || []
      total.value = data?.total || 0
    } catch (e) {
      listError.value = true
    } finally {
      listLoading.value = false
    }
  }

  // 静默重拉（轮询用，不触发 loading 骨架，避免列表闪烁）
  async function refreshListSilent() {
    try {
      const data = await listTasks({ page: page.value, size: size.value })
      tasks.value = data?.items || []
      total.value = data?.total || 0
    } catch (e) {
      /* 轮询失败静默，下次再试 */
    }
    syncListPolling()
  }

  // 据当前列表是否有「运行中」行，自动起停列表轮询
  function syncListPolling() {
    const anyRunning = tasks.value.some(isTaskRunning)
    if (anyRunning && !listTimer) {
      listTimer = setInterval(refreshListSilent, POLL_MS)
    } else if (!anyRunning && listTimer) {
      clearInterval(listTimer)
      listTimer = null
    }
  }

  function stopListPolling() {
    if (listTimer) {
      clearInterval(listTimer)
      listTimer = null
    }
  }

  /* ================= 详情 ================= */
  async function fetchDetail(id) {
    detailLoading.value = true
    detailError.value = false
    detail.value = null
    try {
      detail.value = await getTask(id)
    } catch (e) {
      detailError.value = true
    } finally {
      detailLoading.value = false
    }
  }

  // 仅刷新概览（操作后回填状态/统计，不重置执行记录列表）
  async function refreshDetailSilent(id) {
    try {
      detail.value = await getTask(id)
    } catch (e) {
      /* 静默 */
    }
  }

  /* ============= 执行记录分页 ============= */
  // reset=true 从第 1 页重载（进入详情/操作后）；否则加载下一页追加
  async function fetchExecutions(id, { reset = false } = {}) {
    if (reset) {
      execPage.value = 1
      executions.value = []
      execTotal.value = 0
    }
    execLoading.value = true
    execError.value = false
    try {
      const data = await listExecutions(id, { page: execPage.value, size: execSize.value })
      const items = data?.items || []
      executions.value = reset ? items : executions.value.concat(items)
      execTotal.value = data?.total || 0
    } catch (e) {
      execError.value = true
    } finally {
      execLoading.value = false
    }
    syncExecPolling(id)
  }

  function loadMoreExecutions(id) {
    if (executions.value.length >= execTotal.value || execLoading.value) return
    execPage.value += 1
    return fetchExecutions(id)
  }

  // 用单条详情接口刷新某条执行记录（含 trace），原位替换
  async function refreshExecution(id, execId) {
    try {
      const fresh = await getExecution(id, execId)
      const idx = executions.value.findIndex((e) => e.id === fresh.id)
      if (idx !== -1) {
        // 保留可能已加载的 trace；以最新返回为准（含 trace）
        executions.value[idx] = { ...executions.value[idx], ...fresh }
      } else {
        // run-now 新建的执行尚未在列表中：置顶插入
        executions.value.unshift(fresh)
        execTotal.value += 1
      }
      return fresh
    } catch (e) {
      return null
    }
  }

  // 据当前已加载执行记录是否有非终态，自动起停单条轮询（轮询所有活跃执行的单条详情）
  function syncExecPolling(id) {
    const active = executions.value.filter((e) => isExecActive(e.status))
    if (active.length && !execTimer) {
      execTimer = setInterval(async () => {
        const running = executions.value.filter((e) => isExecActive(e.status))
        if (!running.length) {
          stopExecPolling()
          // 收尾再刷一次概览，更新 runCount/lastRun*
          refreshDetailSilent(id)
          return
        }
        for (const e of running) {
          await refreshExecution(id, e.id)
        }
        // 全部转终态后刷新概览
        if (!executions.value.some((x) => isExecActive(x.status))) {
          refreshDetailSilent(id)
        }
      }, POLL_MS)
    } else if (!active.length && execTimer) {
      stopExecPolling()
    }
  }

  function stopExecPolling() {
    if (execTimer) {
      clearInterval(execTimer)
      execTimer = null
    }
  }

  // run-now 后：把新执行置顶并启动轮询
  async function afterRunNow(id, execId) {
    await refreshExecution(id, execId)
    syncExecPolling(id)
  }

  /* ============= 操作（薄封装，错误抛给页面提示） ============= */
  async function toggleStatus(id, status) {
    const vo = await setTaskStatus(id, status)
    // 同步列表行（若在列表中）
    const idx = tasks.value.findIndex((t) => t.id === id)
    if (idx !== -1) tasks.value[idx] = { ...tasks.value[idx], ...vo }
    if (detail.value?.id === id) detail.value = { ...detail.value, ...vo }
    syncListPolling()
    return vo
  }

  async function removeTask(id) {
    await deleteTask(id)
    tasks.value = tasks.value.filter((t) => t.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  async function triggerRunNow(id) {
    const data = await runTaskNow(id)
    return data?.executionId
  }

  // 重置详情态（离开详情页时调用，避免脏数据残留）
  function resetDetail() {
    stopExecPolling()
    detail.value = null
    detailError.value = false
    executions.value = []
    execTotal.value = 0
    execPage.value = 1
    execError.value = false
  }

  return {
    // 列表
    tasks,
    total,
    page,
    size,
    listLoading,
    listError,
    fetchList,
    refreshListSilent,
    syncListPolling,
    stopListPolling,
    // 详情
    detail,
    detailLoading,
    detailError,
    fetchDetail,
    refreshDetailSilent,
    // 执行记录
    executions,
    execTotal,
    execLoading,
    execError,
    fetchExecutions,
    loadMoreExecutions,
    refreshExecution,
    afterRunNow,
    stopExecPolling,
    // 操作
    toggleStatus,
    removeTask,
    triggerRunNow,
    resetDetail
  }
})
