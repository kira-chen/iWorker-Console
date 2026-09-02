import request from './request'
import * as mock from './loginLogMock'

/**
 * 访问审计（登录明细）API 层（系统管理员 ADMIN 专属）。
 *
 * 纯前端 demo：默认走 loginLogMock 内存 mock（`VITE_GOV_MOCK=0` 可关闭走真实接口路径，
 * 仅供未来接回后端时切换）。2026-09-01 PRD 对齐轮起，查询参数改为
 * keyword/status/sortField/sortDir/page/size，字段命名对齐原型（loginAt/logoutAt）；
 * 未来后端接入时按此签名补契约（原 /fde/users/login-logs 的 userId 过滤已废弃）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'

// 登录明细列表。返回 { list, total }。
export function listLoginLogs(params = {}) {
  if (USE_MOCK) return mock.listLoginLogs(params)
  return request.get('/fde/users/login-logs', { params })
}
