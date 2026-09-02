import request from './request'

/**
 * 定时任务模块 API 层（契约：docs/api/定时任务-接口契约.md，基址 /api/tasks）。
 *
 * 错误处理约定（对齐 admin.js）：
 * - 读接口走全局拦截器（失败弹 toast 即可）。
 * - 写接口（建/编辑/启停/删/run-now/preview）加 `skipGlobalError`，失败抛 ApiError
 *   交由表单/页面自处理（红框定位或局部提示），不弹全局 toast。
 *
 * 鉴权：JWT 由 request 拦截器统一注入；请求体一律不传 userId（防越权，契约 §0）。
 * 时间口径（契约 §0.3）：schedule 内部 times/onceAt/startDate/endDate 为「无时区本地墙钟」；
 * 记录类出参 lastRunAt/nextRunAt/startedAt/nextRunTimes 为带时区 ISO-8601。
 */

// 写接口统一配置：绕过全局错误提示，交调用方自处理
const W = { skipGlobalError: true }

// 1. 创建任务（含草稿）-> ResultVO<TaskVO>
// payload: { name, remark?, schedule, sopDoc, toolRefs?[{type,code,bizName?}], enable? }
export function createTask(payload) {
  return request.post('/tasks', payload, W)
}

// 2. 任务列表（分页）-> ResultVO<Page<TaskVO>>
// params: { page=1, size=20, status? }
export function listTasks(params = {}) {
  return request.get('/tasks', { params })
}

// 3. 任务详情（概览，不含执行记录）-> ResultVO<TaskDetailVO>
export function getTask(id) {
  return request.get(`/tasks/${id}`)
}

// 5.2 编辑任务（全量覆盖，请求体同创建）-> ResultVO<TaskVO>（P1）
export function updateTask(id, payload) {
  return request.put(`/tasks/${id}`, payload, W)
}

// 5.1 启用 / 停用 -> ResultVO<TaskVO>。status ∈ ENABLED | DISABLED
export function setTaskStatus(id, status) {
  return request.patch(`/tasks/${id}/status`, { status }, W)
}

// 5.3 删除任务（硬删 + 级联删执行记录）-> ResultVO<null>
export function deleteTask(id) {
  return request.delete(`/tasks/${id}`, W)
}

// 5.4 立即执行一次（异步触发）-> ResultVO<{ executionId }>
export function runTaskNow(id) {
  return request.post(`/tasks/${id}/run-now`, null, W)
}

// 4. 执行记录分页（不含 trace）-> ResultVO<Page<ExecutionVO>>
export function listExecutions(id, params = {}) {
  return request.get(`/tasks/${id}/executions`, { params })
}

// 4.2 单条执行详情（含 trace，详情/轮询用）-> ResultVO<ExecutionDetailVO>
export function getExecution(id, execId) {
  return request.get(`/tasks/${id}/executions/${execId}`)
}

// 6. 调度预览下 N 次 -> ResultVO<SchedulePreviewVO>（P1）
// payload: { schedule, count?=3 }；count 上限 10
export function previewSchedule(payload) {
  return request.post('/tasks/preview-schedule', payload, W)
}

// 7. 可引用工具列表（前台只读）-> ResultVO<AvailableToolsVO>{ mock, mcp, api }
export function listAvailableTools() {
  return request.get('/tasks/available-tools')
}
