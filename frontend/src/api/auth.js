import request from './request'

// 账密登录：返回 { token, user }（契约约定）
export function login(payload) {
  return request.post('/auth/login', payload)
}

// 修改密码（登录态）：body { oldPassword, newPassword }。
// 走 skipGlobalError：由改密弹窗/页面自处理错误（旧密码错误等按 message 就地提示），成功后前端清 mustChangePassword。
export function changePassword(payload) {
  return request.post('/auth/change-password', payload, { skipGlobalError: true })
}

// 说明：JWT 无状态，后端不提供 /auth/logout，登出仅清本地态（见 stores/user.js）。
