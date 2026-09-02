/**
 * 定时任务模块状态徽标 + 时间格式化（单一事实来源，列表/详情共用，避免两端各写一套）。
 *
 * 大小写约定（契约 §0.2）：task / execution 业务级状态一律大写枚举；
 * trace step 运行态小写（由 ReActSteps 自行消费，不在此处理）。
 */

// 任务状态徽标：颜色语义 type 对齐 el-tag（success/info/warning/danger），label 中文人话
const TASK_STATUS_META = {
  ENABLED: { label: '启用', type: 'success' },
  DISABLED: { label: '停用', type: 'info' },
  DRAFT: { label: '草稿', type: 'warning' }
}

// 执行状态徽标
const EXEC_STATUS_META = {
  RUNNING: { label: '运行中', type: 'primary' },
  RETRYING: { label: '重试中', type: 'warning' },
  SUCCEEDED: { label: '成功', type: 'success' },
  FAILED: { label: '失败', type: 'danger' },
  SKIPPED: { label: '本次跳过', type: 'info' }
}

const FALLBACK_META = { label: '未知', type: 'info' }

/**
 * 任务状态徽标。
 * 特殊口径（PRD §6/列表）：ONCE 任务跑完后后端置 DISABLED，前端展示「已完成」更贴语义。
 * @param {string} status 任务状态（大写）
 * @param {object} task 可选，用于 ONCE 已完成判定（scheduleType==='ONCE' && runCount>0）
 */
export function taskStatusMeta(status, task) {
  if (
    status === 'DISABLED' &&
    task &&
    task.scheduleType === 'ONCE' &&
    Number(task.runCount) > 0
  ) {
    return { label: '已完成', type: 'info' }
  }
  return TASK_STATUS_META[status] || FALLBACK_META
}

// 执行状态徽标
export function execStatusMeta(status) {
  return EXEC_STATUS_META[status] || FALLBACK_META
}

// 执行是否处于非终态（运行中/重试中）—— 轮询停止判据
export function isExecActive(status) {
  return status === 'RUNNING' || status === 'RETRYING'
}

// 一条任务的「最近一次执行结果」是否仍在跑（列表轮询是否继续的判据）
export function isTaskRunning(task) {
  return isExecActive(task?.lastRunStatus)
}

/**
 * 格式化带时区 ISO-8601 时刻为本地可读 `YYYY-MM-DD HH:mm`。
 * 仅用于「记录类」时刻（lastRunAt/nextRunAt/startedAt/finishedAt/nextRunTimes）。
 */
export function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 耗时毫秒 → 人话（与 ReActSteps 一致：>=1s 用 x.xs，否则 xxms）。运行中 null 返回空。
export function fmtDuration(ms) {
  if (ms == null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
