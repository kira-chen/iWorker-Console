import request from './request'
import * as mock from './positionAssignmentMock'
import * as appMock from './positionApplicationsMock'

/**
 * 岗位分配 API 层（FDE 工作台）——以用户为核心管理「用户 ↔ 绑定岗位」。
 *
 * 2026-09-15 改版（页签合并）：移除 approve / reject / listApplications 接口；
 * 新增 markApplicationAssigned（分配完成后标记申请已处理）。
 *
 * 【demo mock】纯前端 demo，本页数据默认走内存 mock（`VITE_POS_MOCK=0` 可关闭）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'
const W = { skipGlobalError: true }

// 分配列表：分页 + keyword / status / hasPendingRequest 过滤。
// 返回 ListVO { list:[{userId,username,displayName,status,positionId,positionName,
//   hasPendingRequest,pendingRequestId,pendingRequestAt}], total }
export function listPositionAssignments(params = {}) {
  if (USE_MOCK) return mock.listPositionAssignments(params)
  return request.get('/fde/position-assignments', { params })
}

// 设置某用户绑定岗位（保存即时生效）。positionId 非空=首绑/换绑；null/空=解绑。
export function setUserPosition(userId, positionId) {
  if (USE_MOCK) return mock.setUserPosition(userId, positionId)
  return request.put(`/fde/position-assignments/${userId}`, { positionId: positionId || null }, W)
}

// 待分配申请数量（工具栏筛选按钮徽标）；返回 { count }。
export function countPendingApplications() {
  if (USE_MOCK) return appMock.countPendingApplications()
  return request.get('/fde/position-applications/pending-count')
}

// 分配完成回执：绑定已由 setUserPosition 落库，申请标记 ASSIGNED 留痕。
export function markApplicationAssigned(id) {
  if (USE_MOCK) return appMock.markApplicationAssigned(id)
  return request.post(`/fde/position-applications/${id}/assign`, {}, W)
}
