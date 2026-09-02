import request from './request'

/**
 * 员工侧「领用 + 采集」API 层（契约「岗位管理-接口契约」§5，前缀 /api/my-positions）。
 *
 * 错误处理约定（沿用 position.js / admin.js 范式，契约 §0）：
 * - 读接口（intake-schema）走全局拦截器（失败弹 toast）。
 * - 写接口（claim / intake-values）加 `skipGlobalError: true` → 失败抛 ApiError
 *   （带 code/message/field），由组件做字段级红框回显（按 field，如 intakeValues.region）。
 *   - 1004：必填采集字段未填 / 类型校验失败 → 字段级回显。
 *   - 1003：岗位非 published（draft 不可领）→ 弹窗提示。
 *   - 1007：绑定已失效 → 引导重领（拦截器层另有兜底）。
 */
const W = { skipGlobalError: true }

// 5.1 领用前取采集 schema（供领用页渲染采集表单）
// GET /api/my-positions/{positionId}/intake-schema -> ResultVO<IntakeSchemaVO>
export function getIntakeSchema(positionId) {
  return request.get(`/my-positions/${positionId}/intake-schema`)
}

// 5.2 领用（bind + intakeValues），双校验
// POST /api/my-positions/{positionId}/claim -> ResultVO<MyPositionVO>
export function claimPosition(positionId, intakeValues) {
  return request.post(`/my-positions/${positionId}/claim`, { intakeValues }, W)
}

// 5.3 领用后改采集值（重走必填/类型校验）
// PUT /api/my-positions/{positionId}/intake-values -> ResultVO<MyPositionVO>
export function updateIntakeValues(positionId, intakeValues) {
  return request.put(`/my-positions/${positionId}/intake-values`, { intakeValues }, W)
}

// 7.1 当前绑定岗位（含失效状态 + 已填采集值），改采集值入口读已填值用
// GET /api/my-positions/current -> ResultVO<{bindingActive, position, intakeValues}>
export function getCurrentPosition() {
  return request.get('/my-positions/current')
}

/* ============================ 业务系统登录态托管（切片3b，员工侧） ============================ */
// 前缀 /api/my-positions/biz-credentials。按用户隔离；后端绝不回显凭据明文。
// 状态 state ∈ NOT_HOSTED 未连接 / VALID 已连接 / EXPIRED 已过期请重新登录。

// 当前用户全部托管状态列表（仅含已托管的业务系统，绝不回显凭据）
export function listBizCredentials() {
  return request.get('/my-positions/biz-credentials')
}

// 某业务系统的托管状态
export function getBizCredentialStatus(bizSystemId) {
  return request.get(`/my-positions/biz-credentials/${bizSystemId}`)
}

// 提交 / 更新登录态托管（credential 明文仅在内存流转 → 后端立即加密落库）
// payload: { bizSystemId, credential, expiresAt? }
export function hostBizCredential(payload) {
  return request.post('/my-positions/biz-credentials', payload, W)
}

// 解除托管（用户主动断开连接，二次确认后调用）
export function deleteBizCredential(bizSystemId) {
  return request.delete(`/my-positions/biz-credentials/${bizSystemId}`, W)
}
