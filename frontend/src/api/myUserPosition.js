import request from './request'

// 读有效专家视图（合并 + 来源标记 + 总览）
// 契约：GET /api/my-positions/{positionId} -> ResultVO<EffectivePositionVO>
export function getEffectivePosition(positionId) {
  return request.get(`/my-positions/${positionId}`)
}

// 改字段覆盖（US-6 收窄：白名单仅 persona + buddyName）
// 契约：PUT /api/my-positions/{positionId}/fields -> ResultVO<EffectivePositionVO>
// 说明：后端写入口已收窄为只接受 persona / buddyName，其余字段即使传入也丢弃。
export function updatePositionFields(positionId, fields) {
  return request.put(`/my-positions/${positionId}/fields`, fields)
}

// 单字段还原
// 契约：DELETE /api/my-positions/{positionId}/fields/{field} -> ResultVO<EffectivePositionVO>
export function resetField(positionId, field) {
  return request.delete(`/my-positions/${positionId}/fields/${field}`)
}

// 整体还原（清空全部个性化）
// 契约：DELETE /api/my-positions/{positionId}/personalization -> ResultVO<EffectivePositionVO>
export function resetAll(positionId) {
  return request.delete(`/my-positions/${positionId}/personalization`)
}
