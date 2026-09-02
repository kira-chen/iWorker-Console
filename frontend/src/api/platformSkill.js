import request from './request'
import * as mock from './unifiedSkillMock'

/**
 * 平台技能 API 层（系统配置员侧，V34 平台级技能与发布 切片1）。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】项目为纯前端 demo：两套通道命名空间
 * （platformSkillApi / systemSkillApi）默认走 unifiedSkillMock 内存 mock
 * （`VITE_SKILL_MOCK=0` 可关闭走真实接口路径）。mock 按技能 id 落同一存储，
 * 通道判别由数据行 type 承载（demo 不再模拟「跨通道 404」守卫）。
 *
 * 前缀 /api/fde/platform-skills（归 SYS_CONFIG 模块）。响应结构与 FDE 技能对齐
 * （列表 PlatformSkillListItem / 详情 SkillDetailVO），仅数据源不同：仅 origin=PLATFORM、无岗位归属。
 *
 * 错误处理约定沿用 position.js / admin.js 范式：
 * - 读接口走全局拦截器（失败弹 toast）。
 * - 写接口加 skipGlobalError → 失败抛 ApiError（带 code/message/field），交编辑器/页面自处理。
 *
 * 切片1：技能本体 CRUD（status 为本体 draft/published）。
 * 切片2：发布到 FDE 工作台 / 用户端 + 启停（提交审核 publish / 撤回 withdraw / 下架 delist / 重新上架 relist）。
 *        发布态读出挂在 list/detail 的 publications:[{target,status,...}]（详见 utils/skillPublication）。
 */
const W = { skipGlobalError: true }
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'

/* ==================== V89 通道前缀分段隔离：同构 API 工厂 ====================
 * 市场技能（/fde/platform-skills）与系统默认技能（/fde/system-skills）后端为「一个技能内核，两扇门」——
 * 端点形状完全同构，仅前缀不同（通道由前缀决定，跨通道 id 一律 404）。前端据此用同一工厂产出两套命名空间，
 * 组件按视图通道整体切换（AdminSkillsUnified / AdminSkillEditPage / VersionDrawer 适配器），不再传 channel 参数。 */
function makeChannelSkillApi(base) {
  return {
    // 列表（keyword/status 走后端过滤，扁平；通道由前缀钉死）
    list: (params = {}) => request.get(base, { params }),
    // 新建（仅 name 必填，origin=PLATFORM / 通道 / 无岗位由后端强制，code 自动生成）→ 跳编辑器
    create: (payload) => request.post(base, payload, W),
    // 详情（含 referencedTools[] 白名单回显；positionId 恒 null）
    get: (skillId) => (USE_MOCK ? mock.getSkillDetail(skillId) : request.get(`${base}/${skillId}`)),
    // 工具坞 tool-picker（SYS_CONFIG 门；集合端点无 id 通道守卫，但前缀随通道保持纯净）
    toolPicker: (params = {}) =>
      USE_MOCK ? mock.toolPicker(params) : request.get(`${base}/tool-picker`, { params }),
    // 编辑本体（name/skillMd/description 等部分更新；可能回 warnings）
    update: (skillId, payload) =>
      USE_MOCK ? mock.updateSkill(skillId, payload) : request.put(`${base}/${skillId}`, payload, W),
    // 删除（软删 + 引用保护）
    remove: (skillId) => (USE_MOCK ? mock.removeSkill(skillId) : request.delete(`${base}/${skillId}`, W)),
    // 提交发布（去分端·单轨）：body { bump, releaseNotes } → 审核中（demo 停在审核中）
    publish: (skillId, { bump, releaseNotes }) =>
      USE_MOCK
        ? mock.publishSkill(skillId, { bump, releaseNotes })
        : request.post(`${base}/${skillId}/publish`, { bump, releaseNotes }, W),
    // 「下一个建议版本号」（恒非空 vX.Y.Z；首发 v1.0.0）
    nextVersionLabel: (skillId) =>
      USE_MOCK ? mock.nextVersionLabel(skillId) : request.get(`${base}/${skillId}/next-version-label`),
    // 撤回在审提交（发布/停用同入口；按 version 空/非空恢复 未发布/已发布）
    withdrawPublish: (skillId) =>
      USE_MOCK ? mock.withdrawPublish(skillId) : request.delete(`${base}/${skillId}/publish`, W),
    // 技能级停用（V100：提交停用审核，审核通过前客户端仍可使用）/ 重新上架
    delist: (skillId) => (USE_MOCK ? mock.delistSkill(skillId) : request.post(`${base}/${skillId}/delist`, {}, W)),
    relist: (skillId) => (USE_MOCK ? mock.relistSkill(skillId) : request.post(`${base}/${skillId}/relist`, {}, W)),
    // 版本历史 + 单版本禁用/启用（真实路径 target ∈ FDE_WORKBENCH | USER_END；mock 单轨忽略 target）
    listSnapshots: (skillId, target) =>
      USE_MOCK ? mock.listSnapshots(skillId) : request.get(`${base}/${skillId}/snapshots`, { params: { target } }),
    delistSnapshot: (skillId, version, target) =>
      USE_MOCK
        ? mock.delistSnapshot(skillId, version)
        : request.post(`${base}/${skillId}/snapshots/${version}/delist`, { target }, W),
    relistSnapshot: (skillId, version, target) =>
      USE_MOCK
        ? mock.relistSnapshot(skillId, version)
        : request.post(`${base}/${skillId}/snapshots/${version}/relist`, { target }, W)
  }
}

/** 市场技能（平台技能页）命名空间。 */
export const platformSkillApi = makeChannelSkillApi('/fde/platform-skills')
/** 系统默认技能页命名空间（V89）：同构端点，前缀 /fde/system-skills，通道后端钉死。 */
export const systemSkillApi = makeChannelSkillApi('/fde/system-skills')

// 平台技能列表（仅 PLATFORM 市场通道；keyword/status 走后端过滤，扁平）
export function listPlatformSkills(params = {}) {
  return platformSkillApi.list(params)
}

/* ==================== V92 用户上传待确认技能 ====================
 * 前缀 /fde/platform-skill-uploads（归 SYS_CONFIG 模块）。客户端用户经 POST /api/market/skill-commit 上传的技能
 * 先落 upload_review_state=PENDING_CONFIRM（不进平台技能列表），admin 在本单独页确认后转正进平台技能列表。 */

// 用户上传待确认技能列表（分页 + keyword 可选）
export function listPendingUploadSkills(params = {}) {
  return request.get('/fde/platform-skill-uploads', { params })
}

// 确认一个用户上传技能（待确认 → 已确认，转正进平台技能列表）；失败抛 ApiError 交页面自处理
export function confirmUploadedSkill(skillId) {
  return request.post(`/fde/platform-skill-uploads/${skillId}/confirm`, {}, W)
}

// 新建平台技能（仅 name 必填，origin=PLATFORM / 无岗位由后端强制，code 自动生成）→ 跳编辑器
export function createPlatformSkill(payload) {
  return platformSkillApi.create(payload)
}

// 平台技能详情（含 referencedTools[] 白名单回显 + checkStatus 四态；positionId 恒 null）
export function getPlatformSkill(skillId) {
  return request.get(`/fde/platform-skills/${skillId}`)
}

// 编辑平台技能本体（name/triggers/skillMd/description 等部分更新；可能回 warnings）
export function updatePlatformSkill(skillId, payload) {
  return request.put(`/fde/platform-skills/${skillId}`, payload, W)
}

// 删除平台技能（软删 + 引用保护，被 FDE 引用阻断 403）
export function deletePlatformSkill(skillId) {
  return request.delete(`/fde/platform-skills/${skillId}`, W)
}

// 平台技能工具坞数据源（SYS_CONFIG 门）：只返 MCP/API（平台技能无岗位，不支持数据表/业务系统）。
// 与 FDE 的 /fde/skills/tool-picker（FDE 门）分段隔离——平台编辑器工具坞改调此端点，避免打 FDE 门被 403。
// 不接 positionId（平台技能无岗位归属）。params: { type ∈ MCP|API, keyword? }
export function listPlatformToolPicker(params = {}) {
  return request.get('/fde/platform-skills/tool-picker', { params })
}

/* ============================ 发布 / 启停（去分端·单轨） ============================ */

// 提交发布（去分端·单轨）：body { bump: 'NONE'|'MINOR'|'MAJOR', releaseNotes }。
// bump 驱动版本号进位（NONE=patch+1 / MINOR / MAJOR，由后端算最终 vX.Y.Z）；releaseNotes 必填。
// 返回发布态 VO 列表。不再有 targets / 手填 versionLabel。
export function publishPlatformSkill(skillId, { bump, releaseNotes }) {
  return request.post(`/fde/platform-skills/${skillId}/publish`, { bump, releaseNotes }, W)
}

// 技能发布页「下一个建议版本号」（NONE 进位建议号，恒非空 vX.Y.Z；首发返回 v1.0.0）。
export function nextPlatformVersionLabel(skillId) {
  return request.get(`/fde/platform-skills/${skillId}/next-version-label`)
}

// 撤回在审提交（去 target）：首发在审=删行回未发布；新版在审=仅作废提交，线上不动。
export function withdrawPlatformSkillPublish(skillId) {
  return request.delete(`/fde/platform-skills/${skillId}/publish`, W)
}

// 下架（PUBLISHED→DELISTED，技能级统一下架，去 target）。
export function delistPlatformSkill(skillId) {
  return request.post(`/fde/platform-skills/${skillId}/delist`, {}, W)
}

// 重新上架（DELISTED→PUBLISHED，去 target）。
export function relistPlatformSkill(skillId) {
  return request.post(`/fde/platform-skills/${skillId}/relist`, {}, W)
}

/* ==================== 版本历史 + 下线/恢复（管理侧，设计 §6.6 A/B · P2-③） ==================== */
// 审核通过（approve）即生成一条不可变版本快照（整包存对象存储）；本组端点供 SYS_CONFIG/ADMIN
// 查看历史版本、手动下线/恢复某历史版本。下线只翻 status，不删对象、已下载客户端不受影响。

// 平台技能版本历史（某 target 全部快照，version DESC，ACTIVE/DELISTED 均列）→ SkillSnapshotVO[]
// target ∈ FDE_WORKBENCH | USER_END（管理侧两 target 都可查）。读接口：走全局错误提示。
export function listPlatformSkillSnapshots(skillId, target) {
  return request.get(`/fde/platform-skills/${skillId}/snapshots`, { params: { target } })
}

// 下线某历史版本（status=DELISTED；对象不删）。非 ACTIVE → 409。body: { target }。
export function delistPlatformSkillSnapshot(skillId, version, target) {
  return request.post(`/fde/platform-skills/${skillId}/snapshots/${version}/delist`, { target }, W)
}

// 恢复某历史版本（status=ACTIVE）。非 DELISTED → 409。body: { target }。
export function relistPlatformSkillSnapshot(skillId, version, target) {
  return request.post(`/fde/platform-skills/${skillId}/snapshots/${version}/relist`, { target }, W)
}
