import request from './request'

// 拉取当前用户可见的全局专家列表
export function listPositions() {
  return request.get('/positions')
}

// 绑定某个专家为本人岗位专家（首登）
export function bindPosition(positionId) {
  return request.post('/positions/bind', { positionId })
}
