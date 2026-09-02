import request from './request'

/**
 * 双模块报表 API 层（设计 §6.2）。
 *
 * 两个模块概览接口均为只读 GET，走全局错误拦截器（失败弹 toast 即可）；
 * 角色门由后端按模块把关（FDE/ADMIN 与 SYS_CONFIG/ADMIN），前端不重复判权。
 *
 * 出参结构（ResultVO.data，由拦截器解包）：
 *   FDE：     { summary:{...}, distributions:{ skillByCategory, positionClaimTop }, generatedAt }
 *   系统配置： { summary:{...}, distributions:{ healthDistribution, marketByStatus, favoriteTop }, generatedAt }
 */

// FDE 工作台概览（门：FDE/ADMIN）
export function getFdeOverview() {
  return request.get('/fde/reports/fde/overview')
}

// 系统配置概览（门：SYS_CONFIG/ADMIN）
export function getSysConfigOverview() {
  return request.get('/fde/reports/sysconfig/overview')
}
