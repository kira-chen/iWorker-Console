import request from './request'
import * as mock from './userPositionMock'

// 纯前端 demo：无后端、vite 未配 proxy，真实请求会落到 SPA fallback 拿回 index.html。
// 与 position.js 同构的 mock 分流（VITE_POS_MOCK=0 可关闭走真实后端）。
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'

// 拉取当前用户可见的全局岗位列表
export function listPositions() {
  if (USE_MOCK) return mock.listPositions()
  return request.get('/positions')
}

// 绑定某个岗位为本人岗位（首登）
export function bindPosition(positionId) {
  if (USE_MOCK) return mock.bindPosition(positionId)
  return request.post('/positions/bind', { positionId })
}
