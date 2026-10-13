import request from './request'
import * as mock from './expertTeamMock'

/**
 * 「专家团」模块 API 层（管理端「专家 › 专家团」视图；规则见 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md）。
 *
 * 专家团 = 一组已发布的专家 + 可选团长。发布 / 审核 / 版本 / 停用 / 强制回收的状态机与专家同构
 * （api/domainExpert.js），区别是团引用专家 id 而非技能，且团类型决定成员候选范围。
 *
 * 【demo mock】项目为纯前端 demo，数据默认走内存 mock（expertTeamMock.js），与专家共用开关
 * `VITE_EXPERT_MOCK=0`（关闭则走下面的真实接口路径，模式同 domainExpert.js）。
 *
 * 错误处理约定同 domainExpert.js：读接口走全局拦截器；写接口加 skipGlobalError（W），抛 ApiError
 * （带 code/message/field），由页面做字段级红框。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_EXPERT_MOCK !== '0'
const W = { skipGlobalError: true }

/* ---------- 团 CRUD ---------- */

// 列表（服务端分页）。params: { keyword?, type?, category?, status?(''|draft|review|published), sort?, page, size }
export function listTeams(params) {
  if (USE_MOCK) return mock.listTeams(params)
  return request.get('/fde/expert-teams', { params })
}

// 详情（含成员明细 members[]、团长职责、协作关系、示例问题 exampleQuestions[3]）
export function getTeam(teamId) {
  if (USE_MOCK) return mock.getTeam(teamId)
  return request.get(`/fde/expert-teams/${teamId}`)
}

// 新建（body: { name, type, positionIds, avatar, backgroundColor, category, intro, members:[{expertId,duty}],
//   leaderId, leaderDuty, collab, exampleQuestions[3] }）。初始未发布。
export function createTeam(payload) {
  if (USE_MOCK) return mock.createTeam(payload)
  return request.post('/fde/expert-teams', payload, W)
}

// 编辑（部分更新）。团类型创建后不可改。
export function updateTeam(teamId, payload) {
  if (USE_MOCK) return mock.updateTeam(teamId, payload)
  return request.put(`/fde/expert-teams/${teamId}`, payload, W)
}

// 删除（仅未发布且无审核中）。返回被解除的成员引用数。
export function deleteTeam(teamId) {
  if (USE_MOCK) return mock.deleteTeam(teamId)
  return request.delete(`/fde/expert-teams/${teamId}`, W)
}

/* ---------- 成员候选 / 与专家联动 ---------- */

// 成员候选：已发布专家，按团类型限定范围。params: { type, keyword? }
export function listTeamMemberCandidates(params) {
  if (USE_MOCK) return mock.listTeamMemberCandidates(params)
  return request.get('/fde/expert-teams/member-candidates', { params })
}

// 引用某专家的团清单（专家停用 / 强制回收提示、删除拦截用）。返回 [{ id, name, status }]
export async function listTeamsReferencingExpert(expertId) {
  if (USE_MOCK) return mock.listTeamsReferencingExpert(expertId)
  return request.get(`/fde/experts/${expertId}/teams`)
}

// 岗位自动化任务「执行动作 = 专家团」的候选团（已发布的岗位团 + 通用团）。返回 [{ id, name, type, leaderId, leaderName }]
export function listTeamsForAutomation(positionId) {
  if (USE_MOCK) return mock.listTeamsForAutomation(positionId)
  return request.get(`/fde/positions/${positionId}/automation-teams`)
}

/* ---------- 发布 / 版本 ---------- */

export function publishTeam(teamId, payload) {
  if (USE_MOCK) return mock.publishTeam(teamId, payload)
  return request.post(`/fde/expert-teams/${teamId}/publish`, payload, W)
}

export function getTeamNextVersionLabel(teamId) {
  if (USE_MOCK) return mock.getTeamNextVersionLabel(teamId)
  return request.get(`/fde/expert-teams/${teamId}/next-version-label`)
}

// 停用 → 提交停用审核；payload { forceRevoke, reason }：勾选强制回收时与普通停用走同一条审核，通过后才回收（PRD §二.3.6）
export function unpublishTeam(teamId, payload = {}) {
  if (USE_MOCK) return mock.unpublishTeam(teamId, payload)
  return request.post(`/fde/expert-teams/${teamId}/unpublish`, payload, W)
}

export function withdrawTeam(teamId) {
  if (USE_MOCK) return mock.withdrawTeam(teamId)
  return request.post(`/fde/expert-teams/${teamId}/withdraw`, {}, W)
}

// 版本历史（新→旧）。与专家一样按 publicationId 定位禁用 / 启用。
export function listTeamPublications(teamId) {
  if (USE_MOCK) return mock.listTeamPublications(teamId)
  return request.get(`/fde/expert-teams/${teamId}/publications`)
}

export function delistTeamPublication(teamId, publicationId) {
  if (USE_MOCK) return mock.delistTeamPublication(teamId, publicationId)
  return request.post(`/fde/expert-teams/${teamId}/publications/${publicationId}/delist`, {}, W)
}

export function relistTeamPublication(teamId, publicationId) {
  if (USE_MOCK) return mock.relistTeamPublication(teamId, publicationId)
  return request.post(`/fde/expert-teams/${teamId}/publications/${publicationId}/relist`, {}, W)
}

// 发布前检查（md §三.8 检查 1–3：必填项齐全、成员均已发布、岗位私有成员覆盖团所属岗位）。同步函数，
// 返回 { field, message } 或 null。仅 mock 路径本地算；真实接口路径由服务端在 publish 时校验，这里放行。
export function checkTeamPublishable(team) {
  if (USE_MOCK) return mock.checkTeamPublishable(team)
  return null
}
