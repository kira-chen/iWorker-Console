import request from './request'

// 会话列表（倒序、分页）
// 契约：GET /api/sessions?page=&size= -> ResultVO<Page<SessionVO>>
export function listSessions(page = 1, size = 20) {
  return request.get('/sessions', { params: { page, size } })
}

// 会话详情（含 ReAct 轨迹、生成物）
// 契约：GET /api/sessions/{id} -> ResultVO<SessionDetailVO>
export function getSessionDetail(id) {
  return request.get(`/sessions/${id}`)
}

// 继续对话（上下文定位）
// 契约：POST /api/sessions/{id}/continue -> ResultVO<ContinueVO>
export function continueSession(id) {
  return request.post(`/sessions/${id}/continue`)
}

// 删除会话（软删除）
// 契约：DELETE /api/sessions/{id} -> ResultVO<Void>
export function deleteSession(id) {
  return request.delete(`/sessions/${id}`)
}
