import request from './request'
import * as mock from './positionAssignmentMock'

/**
 * 岗位分配 API 层（FDE 工作台，提案 20260721-2）——以用户为核心管理「用户 ↔ 绑定岗位」。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】纯前端 demo，本页数据默认走内存 mock
 * （positionAssignmentMock.js，与 positionMock.js 岗位种子联动；`VITE_POS_MOCK=0` 可关闭）。
 *
 * 错误处理约定（同 position.js）：
 * - 读接口（列表）走全局拦截器，失败弹 toast。
 * - 写接口加 skipGlobalError（W）→ 失败抛 ApiError，由弹窗就地提示。
 * 落 /api/fde/position-assignments（AdminRoleGuard 映射 FDE_WORKBENCH → FDE/ADMIN 可访问）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'
const W = { skipGlobalError: true }

// 分配列表：分页 + keyword（用户名/显示名）+ status（active/disabled）过滤，走后端。
// 返回 ListVO { list:[{userId,username,displayName,status,positionId,positionName}], total }（未绑定则 positionId/positionName 为 null）。
export function listPositionAssignments(params = {}) {
  if (USE_MOCK) return mock.listPositionAssignments(params)
  return request.get('/fde/position-assignments', { params })
}

// 设置某用户绑定岗位（保存即时生效）。positionId 非空=首绑/换绑；null/空=解绑。
export function setUserPosition(userId, positionId) {
  if (USE_MOCK) return mock.setUserPosition(userId, positionId)
  return request.put(`/fde/position-assignments/${userId}`, { positionId: positionId || null }, W)
}
