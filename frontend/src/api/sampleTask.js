import request from './request'
import * as mock from './sampleTaskMock'

/**
 * 岗位级「样例定时任务」FDE 侧配置 API 层。
 *
 * 【demo mock（2026-09-02 岗位工作台补 mock）】纯前端 demo 下默认走内存 mock（sampleTaskMock.js），
 * 开关与岗位 mock 同一枚：`VITE_POS_MOCK=0` 关闭走真实接口路径（样例任务是岗位工作台的子资源，
 * 与岗位详情树同开同关）。
 *
 * 技术方案 §4：全部接口嵌在 `/api/fde/positions/{positionId}/sample-tasks/...` 前缀下
 * （天然命中 AdminRoleGuard 已注册的 `/api/fde/positions` 前缀 → FDE_WORKBENCH 鉴权；
 * 不新开顶层 `/api/fde/sample-tasks` 前缀，否则命不中白名单被 403）。单资源操作也带
 * `positions/{positionId}` 父段并做归属校验（跨岗访问 → NOT_FOUND）。
 *
 * baseURL 由 request 拦截器统一前缀 `/api`，故此处路径不含 `/api`。
 *
 * 错误处理约定（沿用 dataTable.js / task.js）：
 * - 读接口走全局拦截器（失败弹 toast）。
 * - 写接口加 `skipGlobalError: true`——绕过全局 toast，失败抛 ApiError（携带 field / data）交调用方自处理。
 *
 * 字段口径：
 * - schedule 内部 times/onceAt/startDate/endDate 为「无时区本地墙钟」（SchedulePicker 保证）。
 * - toolRefs 元素为 { type, code, bizName }。
 * - skillRefs 元素为 { platformSkillId, name }（引用平台技能，origin=PLATFORM 已发布给 FDE）。
 * - 样例仅定义型字段，无运行态（无 nextFireAt / runCount / lastRunAt 等）。
 */

// 写接口统一配置：绕过全局错误提示，交编辑器/调用方自处理
const W = { skipGlobalError: true }

// demo mock 开关（与 position.js 同枚：岗位工作台整体 mock）
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'

const base = (positionId) => `/fde/positions/${positionId}/sample-tasks`

/* ============================ 查 ============================ */

// 4.1 列表（岗位下全部样例，按 sort_order,id 升序）-> ResultVO<ListVO<SampleTaskVO>>
// data: { list:[{ id, positionId, name, remark, status, scheduleType, scheduleSummary,
//   schedule, sopDoc, toolRefs, sortOrder, createdAt, updatedAt }], total? }
export function listSampleTasks(positionId) {
  if (USE_MOCK) return mock.listSampleTasks(positionId)
  return request.get(base(positionId))
}

// 4.2 详情（回填编辑表单，含 schedule）-> ResultVO<SampleTaskVO>
export function getSampleTask(positionId, sampleId) {
  if (USE_MOCK) return mock.getSampleTask(positionId, sampleId)
  return request.get(`${base(positionId)}/${sampleId}`)
}

/* ============================ 增 / 改 ============================ */

// 4.3 新建（挂岗位下创建，sortOrder 追加末尾）-> ResultVO<SampleTaskVO>
// payload（SampleTaskUpsertRequest）：{ name, remark?, schedule, sopDoc, toolRefs?[{type,code,bizName?}], skillRefs?[{platformSkillId,name?}], enable? }
// 响应可携 data.warnings（工具健康度 / 软上限 sample_over_soft_limit，不阻断）。
export function createSampleTask(positionId, payload) {
  if (USE_MOCK) return mock.createSampleTask(positionId, payload)
  return request.post(base(positionId), payload, W)
}

// 4.4 编辑（全量覆盖，请求体同创建）-> ResultVO<SampleTaskVO>
export function updateSampleTask(positionId, sampleId, payload) {
  if (USE_MOCK) return mock.updateSampleTask(positionId, sampleId, payload)
  return request.put(`${base(positionId)}/${sampleId}`, payload, W)
}

/* ============================ 排序 ============================ */

// 4.5 排序（按 orderedIds 重写 sort_order；集合须与岗位内现存一致）-> ResultVO<Void>
export function reorderSampleTasks(positionId, orderedIds) {
  if (USE_MOCK) return mock.reorderSampleTasks(positionId, orderedIds)
  return request.put(`${base(positionId)}/reorder`, { orderedIds }, W)
}

/* ============================ 删 / 启停 ============================ */

// 4.6 删除（软删）-> ResultVO<Void>
export function deleteSampleTask(positionId, sampleId) {
  if (USE_MOCK) return mock.deleteSampleTask(positionId, sampleId)
  return request.delete(`${base(positionId)}/${sampleId}`, W)
}

// 4.7 启停（status ∈ ENABLED | DISABLED）-> ResultVO<Void>
export function setSampleTaskStatus(positionId, sampleId, status) {
  if (USE_MOCK) return mock.setSampleTaskStatus(positionId, sampleId, status)
  return request.put(`${base(positionId)}/${sampleId}/status`, { status }, W)
}

/* ============================ 调度预览 / 试跑 ============================ */

// 4.8 调度预览（FDE 门，无副作用）-> ResultVO<SchedulePreviewVO>{ summary, nextRunTimes[] }
// payload: { schedule, count?=3 }（与用户前台 /tasks/preview-schedule 等价，换 FDE 门继承鉴权）。
export function previewSampleSchedule(positionId, payload) {
  if (USE_MOCK) return mock.previewSampleSchedule(positionId, payload)
  return request.post(`${base(positionId)}/preview-schedule`, payload, W)
}

// 4.9 试跑（headless runOnce 一次）-> ResultVO<SampleTaskTestRunVO>
// 响应（AttemptResult 口径）：{ success, resultSummary/summary, steps[], failureReason? }
// body 可携草稿定义便于未保存也能试跑；此处以已保存 sampleId 触发。
export function testRunSampleTask(positionId, sampleId, payload = null) {
  if (USE_MOCK) return mock.testRunSampleTask(positionId, sampleId, payload)
  return request.post(`${base(positionId)}/${sampleId}/test-run`, payload, W)
}
