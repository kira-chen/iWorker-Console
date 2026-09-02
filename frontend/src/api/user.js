import request from './request'

// 读当前用户资料（Settings 个人资料）
// 契约（Sprint1 新增）：GET /api/users/me -> ResultVO<UserProfileVO>
// 约定字段（与后端 UserProfileVO 契约一致）：{ displayName, email, profile: { dept, position, avatar } }，
// userId 由 JWT 解析不入参。（applyProfile 兼容历史 name 字段，但契约以 displayName 为准）
export function getMyProfile() {
  return request.get('/users/me')
}

// 更新当前用户资料
// 契约（Sprint1 新增）：PUT /api/users/me -> ResultVO<UserProfileVO>
// 仅传可改字段（姓名/邮箱/部门/岗位/头像）；userId 由 JWT 解析不入参（防越权）。
export function updateMyProfile(payload) {
  return request.put('/users/me', payload)
}
