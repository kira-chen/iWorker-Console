import request from './request'
import * as mock from './positionMock'
import * as skillMock from './unifiedSkillMock'

/**
 * 岗位管理 API 层（FDE 配置侧，契约「岗位管理-接口契约」/api/fde/**）。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】项目已降级为纯前端 demo，岗位数据默认走
 * 内存 mock（positionMock.js；`VITE_POS_MOCK=0` 可关闭走真实接口路径，模式同 apiConnector.js）。
 * 分流范围：
 * - AdminPositions.vue 列表页与 AdminPositionAssignments.vue 所调接口
 *   （含版本管理侧栏 versionAdapter 所调的 publish/withdraw/next-label/publications/delist/relist）；
 * - 2026-09-02 起补齐 PositionDetailTabs 工作台链路：getPosition / updatePosition、Agent CRUD、
 *   技能引用 assign/detach、平台技能候选（样例任务编辑器用）。工作档案 / 样例任务见
 *   dataTable.js / sampleTask.js（同一 VITE_POS_MOCK 开关）。
 *
 * 错误处理约定（沿用 admin.js 范式，契约 §0）：
 * - 读接口走全局拦截器（失败弹 toast）。
 * - 写接口加 `skipGlobalError: true` → 失败抛 ApiError（带 code/message/field），
 *   由组件做字段级红框回显（按 field）/ 1002 上限入口禁用 / 1003 弹窗内提示。
 * - 列表过滤走后端 query（keyword/status），前端不本地二次过滤。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_POS_MOCK !== '0'
// 技能模块 mock（2026-09-01 PRD 对齐改造）：岗位私有技能的详情/编辑/删除/工具坞走 unifiedSkillMock，
// 与「技能」页 / 技能编辑器共用同一内存真相源（开关独立于岗位 mock：VITE_SKILL_MOCK=0 关闭）。
const USE_SKILL_MOCK = import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'
const W = { skipGlobalError: true }

/* ============================ 岗位 CRUD + 状态流转（契约 §1） ============================ */

// 1.1 岗位列表（服务端分页/检索/筛选）。params: { page(1-based,默认1), size(默认12), keyword?, status?, sort? }
// status ∈ all|draft|reviewing|published（2026-09-01 三态展示口径）；sort ∈ asc|desc（按最近更新时间）。
// 返回 ListVO { list=当前页切片, total=过滤后总数 }（对齐 listSkills 范式）。
export function listPositions(params = {}) {
  if (USE_MOCK) return mock.listPositions(params)
  return request.get('/fde/positions', { params })
}

// 1.2 岗位详情（树形，含 Agent→技能）
export function getPosition(id) {
  if (USE_MOCK) return mock.getPosition(id)
  return request.get(`/fde/positions/${id}`)
}

// 1.3 新建岗位（初始 draft，可一次性带 intakeSchema）
export function createPosition(payload) {
  if (USE_MOCK) return mock.createPosition(payload)
  return request.post('/fde/positions', payload, W)
}

// 1.4 编辑岗位基本信息 / 采集 schema（部分更新）
export function updatePosition(id, payload) {
  if (USE_MOCK) return mock.updatePosition(id, payload)
  return request.put(`/fde/positions/${id}`, payload, W)
}

// 1.6.1 发布（draft→published，前置校验不通过 1003，引用 UNHEALTHY 工具 warnings 不阻断）。
// N5（客户端会谈 R2）：发布须带展示版本号 + 升级说明 payload { versionLabel, releaseNotes }。
// 格式/唯一/必填校验由后端发布门统一处理，前端拿 skipGlobalError 抛出的 ApiError 就地提示（含格式样例）。
export function publishPosition(id, payload = {}) {
  if (USE_MOCK) return mock.publishPosition(id, payload)
  return request.post(`/fde/positions/${id}/publish`, payload, W)
}

// 1.6.1b 建议的下一个展示版本号（2026-09-02 起语义化 vX.Y.Z：无历史 → v1.0.0；上版 patch+1；无法建议 → 返回 null）。
// 发布弹窗打开时调用自动带出建议号。读接口：走全局拦截器。
export function getNextVersionLabel(id) {
  if (USE_MOCK) return mock.getNextVersionLabel(id)
  return request.get(`/fde/positions/${id}/next-version-label`)
}

// 1.6.2 下架（published→draft，回 affectedUserCount）
export function unpublishPosition(id) {
  if (USE_MOCK) return mock.unpublishPosition(id)
  return request.post(`/fde/positions/${id}/unpublish`, {}, W)
}

// V103 审核（ADMIN）/ 撤回（提交人）。审核台按行 type 分流到这里。
export function approvePosition(id) {
  return request.post(`/fde/positions/${id}/approve`, {}, W)
}
export function rejectPosition(id, comment) {
  return request.post(`/fde/positions/${id}/reject`, { comment }, W)
}
export function withdrawPosition(id) {
  if (USE_MOCK) return mock.withdrawPosition(id)
  return request.post(`/fde/positions/${id}/withdraw`, {}, W)
}

// 1.6.3 删除影响面（强确认弹窗用）
export function getDeleteImpact(id) {
  if (USE_MOCK) return mock.getDeleteImpact(id)
  return request.get(`/fde/positions/${id}/delete-impact`)
}

// 1.6.4 删除（2026-09-01 Q5 降级：列表页改普通二次确认，confirmName 仅真实接口路径保留）
export function deletePosition(id, confirmName) {
  if (USE_MOCK) return mock.deletePosition(id)
  return request.delete(`/fde/positions/${id}`, { ...W, data: { confirmName } })
}

/* ============================ 岗位版本历史 + 下线/恢复（契约 §1.7 · P2-③） ============================ */
// 每次 publish 追加一版整包快照；本组端点供 SYS_CONFIG/FDE 查看历史、手动下线/恢复。
// 岗位非 published / 不存在 → 404。下线只翻 status，不删对象、已下载客户端不受影响。

// 1.7.1 岗位版本历史（ACTIVE/DELISTED 均列，version DESC）→ PositionPublicationVO[]
export function listPositionPublications(positionId) {
  if (USE_MOCK) return mock.listPositionPublications(positionId)
  return request.get(`/fde/positions/${positionId}/publications`)
}

// 1.7.2 禁用某历史版本（status=DELISTED）。非 ACTIVE → 409；最后一个启用版本 mock 侧拦截。
export function delistPositionPublication(positionId, version) {
  if (USE_MOCK) return mock.delistPositionPublication(positionId, version)
  return request.post(`/fde/positions/${positionId}/publications/${version}/delist`, {}, W)
}

// 1.7.3 启用某历史版本（status=ACTIVE）。非 DELISTED → 409；mock 侧同时禁用其余启用版本（互斥）。
export function relistPositionPublication(positionId, version) {
  if (USE_MOCK) return mock.relistPositionPublication(positionId, version)
  return request.post(`/fde/positions/${positionId}/publications/${version}/relist`, {}, W)
}

/* ============================ 批量指派岗位给用户（FDE 后台默认开通，提案 20260721-2） ============================ */

// 1.9 批量指派：把已发布岗位默认开通给一批已登记用户。冲突「跳过并报告」；dryRun=true 仅预演不落库。
// payload: { userIds:[usr_...], dryRun }
// 返回 { positionId, dryRun, assigned[], skipped[], invalid[] }，条目 { userId, reason?, currentPositionId? }。
// reason 取值：ALREADY_ASSIGNED / HAS_OTHER_ACTIVE_BINDING（+currentPositionId）/ USER_NOT_FOUND / USER_DISABLED。
export function assignPositionToUsers(positionId, payload) {
  return request.post(`/fde/positions/${positionId}/assign`, payload, W)
}

// 1.9b 可指派用户搜索（选人下拉数据源）——落 FDE_WORKBENCH 模块，FDE/ADMIN 可用（区别于 ADMIN 专属的 /fde/users）。
// payload: { keyword?, page?(默认1), size?(默认20, 上限50) }；返回 ListVO { list:[{id,username,displayName}], total }。
// 读接口：走全局错误提示（无 W）。用 POST 避免与 GET /fde/positions/{id}（岗位详情）路径冲突。
export function searchAssignableUsers(payload = {}) {
  return request.post('/fde/positions/assignable-users', payload)
}

/* ============================ 图标三路径（契约 §1.5） ============================ */

// 1.5.1 图标库清单（demo mock：固定 emoji 库，供技能/岗位图标选择器直接可用）
export function getIconLibrary() {
  if (USE_SKILL_MOCK) {
    const icons = ['▤', '⌕', '◎', '§', '✦', '◈', '📊', '📝', '📋', '🧾', '🗂', '🤖', '🛠', '📈', '🧠', '🔍', '🗓', '📦', '✉️', '📚', '⚖️']
    return Promise.resolve(icons.map((e, i) => ({ id: `ic_${i}`, url: e, name: '' })))
  }
  return request.get('/fde/icon-library')
}

// 1.5.2 上传图标（multipart file，png/jpg/svg ≤1MB；超规格 400）
export function uploadIcon(file) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/fde/positions/icon/upload', fd, {
    ...W,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// 1.5.3 AI 生成图标（P1/可降级：available=false 时前端灰掉入口）
export function aiGenerateIcon(positionName) {
  return request.post('/fde/positions/icon/ai-generate', { positionName }, W)
}

// 1.5.4 AI 生图能力探测（初始化即探测，无生图模型则入口一开始就灰显，避免首次仍可点一次）
// 后端已补 GET /fde/positions/icon/ai-availability（返回 { available }）。
// 探测性调用：走 skipGlobalError，失败彻底静默（仅由调用方 catch 降级为 available=true），
// 避免探测抖动/网关 404 弹出全局红条（与历史「接口不存在」误报同源的纵深防御）。
export function probeAiIconAvailability() {
  if (USE_SKILL_MOCK) return Promise.resolve({ available: false }) // demo 无生图模型：入口灰显
  return request.get('/fde/positions/icon/ai-availability', W)
}

/* ============================ Agent CRUD（契约 §2） ============================ */

// 2.1 新建 Agent（岗位内 name 唯一 1005，≤20 1002）
export function createAgent(positionId, payload) {
  if (USE_MOCK) return mock.createAgent(positionId, payload)
  return request.post(`/fde/positions/${positionId}/agents`, payload, W)
}

// 2.2 编辑 Agent（部分更新；name/description/sortOrder）
export function updateAgent(agentId, payload) {
  if (USE_MOCK) return mock.updateAgent(agentId, payload)
  return request.put(`/fde/agents/${agentId}`, payload, W)
}

// 2.3 删除 Agent（新口径：其下技能彻底脱离岗位变游离技能，回 orphanedSkillCount = 受影响技能数）
export function deleteAgent(agentId) {
  if (USE_MOCK) return mock.deleteAgent(agentId)
  return request.delete(`/fde/agents/${agentId}`, W)
}

/* ============================ 技能列表 / 状态（技能管理菜单，契约 §2） ============================ */

// 技能列表（keyword/status 走后端过滤，扁平）。技能管理页 AdminSkills 用。
export function listSkills(params = {}) {
  if (USE_SKILL_MOCK) {
    // 本端点 status 口径是 published/draft，unifiedSkillMock 三态是 PUBLISHED/UNPUBLISHED/REVIEWING → 映射后透传；
    // 行补 code 字段（demo：code=技能 id），SkillPickerDialog 标签展示用，不在 mock 里造第二份真相。
    const statusMap = { published: 'PUBLISHED', draft: 'UNPUBLISHED', reviewing: 'REVIEWING' }
    const { status, ...rest } = params
    return skillMock
      .listUnifiedSkills({ ...rest, ...(status ? { status: statusMap[status] || status } : {}), type: 'POSITION' })
      .then((d) => ({ ...d, list: (d?.list || []).map((r) => ({ ...r, code: r.code || String(r.id) })) }))
  }
  return request.get('/fde/skills', { params })
}

// 发布 / 撤回草稿（status: published | draft）。
// 2026-09-01：岗位私有技能已接入统一审核状态机，本开关仅作兼容保留（mock 路径直改本体态）。
export function setSkillStatus(id, status) {
  if (USE_SKILL_MOCK) {
    skillMock._reset(id, { status })
    return Promise.resolve({ skillId: id, status })
  }
  return request.put(`/fde/skills/${id}/status`, { status }, W)
}

/* ============================ 技能 CRUD（契约 §3） ============================ */

// 3.1 新建技能（归属 Agent；可能回 data.warnings[]）
export function createSkill(agentId, payload) {
  return request.post(`/fde/agents/${agentId}/skills`, payload, W)
}

// 3.1b 新建游离技能（无岗位/无 Agent 归属，技能菜单「新建」入口）。仅 name 必填，code 自动生成。
export function createStandaloneSkill(payload) {
  if (USE_SKILL_MOCK) {
    return skillMock.createSkill({
      name: payload?.name,
      type: 'POSITION',
      categoryName: payload?.categoryName || payload?.displayCategoryId
    })
  }
  return request.post('/fde/skills', payload, W)
}

// 3.2 编辑技能（仅改 name/triggers/skillMd 等技能本体；可能回 warnings）
// 注意：Agent 归属变更/重分配统一走 assignSkill（PUT /skills/{id}/assign），不再走此端点的 targetAgentId。
export function updateSkill(skillId, payload) {
  if (USE_SKILL_MOCK) return skillMock.updateSkill(skillId, payload)
  return request.put(`/fde/skills/${skillId}`, payload, W)
}

// 3.2.1 分配 / 改挂 Agent（未绑定→Agent 重分配 + 已绑定跨泳道迁移统一端点）
// 错误码：1002 该 Agent 技能数上限；1003 跨岗位非法。
export function assignSkill(skillId, targetAgentId) {
  if (USE_MOCK) return mock.assignSkill(skillId, targetAgentId)
  return request.put(`/fde/skills/${skillId}/assign`, { targetAgentId }, W)
}

// 3.3 技能详情（含 referencedTools[] 白名单回显 + checkStatus 四态）
export function getSkill(skillId) {
  if (USE_SKILL_MOCK) return skillMock.getSkillDetail(skillId)
  return request.get(`/fde/skills/${skillId}`)
}

// 3.4 删除技能（二次确认后调用；mock 路径含引用拦截）
export function deleteSkill(skillId) {
  if (USE_SKILL_MOCK) return skillMock.removeSkill(skillId)
  return request.delete(`/fde/skills/${skillId}`, W)
}

// 3.4.1 解绑技能（设计 §5.3 v1.2：岗位页「删除技能」实为非破坏性解绑——清 skill.agent_id、保留实体，
// 技能转入未绑定/收纳区可重绑，不删实体）。区别于 deleteSkill（软删 deleted=true）。
export function unbindSkill(skillId) {
  return request.put(`/fde/skills/${skillId}/unbind`, {}, W)
}

// 3.4.2 从指定 Agent 移除对某 FDE 技能的引用（V84 引用模型，可逆：删引用行、技能本体留库可再引用）。
// 白板技能卡「移除」走此端点（取代旧 unbindSkill 的「彻底游离、不可逆」语义）。
export function detachSkill(agentId, skillId) {
  if (USE_MOCK) return mock.detachSkill(agentId, skillId)
  return request.delete(`/fde/agents/${agentId}/skills/${skillId}`, W)
}

// 3.5 工具选择面板数据源（四类 Tab + 搜索；数据表传 positionId 过滤防越权）
// type ∈ MCP|API|TABLE|BIZ_SYSTEM
export function listToolPicker(params = {}) {
  if (USE_SKILL_MOCK) return skillMock.toolPicker(params)
  return request.get('/fde/skills/tool-picker', { params })
}

/* ============================ 平台技能候选（FDE_WORKBENCH 侧只读） ============================ */
// 2026-08-23：FDE「平台技能」只读浏览 Tab 与「复制到我的工作台」（copyPlatformSkill）已整体下线
// （负责人定：FDE 不再复用平台技能）。本组候选端点**保留**——「样例任务」编辑器仍用它做
// 「引用平台技能」（SampleTaskEditor.vue，后端契约 SampleTaskUpsertRequest.skillRefs），
// 与已下线的「FDE 取材」不是同一回事，删了会连带搞挂样例任务。

// 候选平台技能（已发布到 FDE_WORKBENCH 且当前 PUBLISHED；keyword 可选）→ PlatformSkillCandidateVO[]
// 读接口：走全局错误提示。
export function listPlatformSkillCandidates(keyword) {
  if (USE_SKILL_MOCK) {
    // demo：候选 = unifiedSkillMock 中已发布的平台技能（单一真相源），映射为 PlatformSkillCandidateVO
    return skillMock
      .listUnifiedSkills({ type: 'PLATFORM', status: 'PUBLISHED', size: 200, ...(keyword ? { keyword } : {}) })
      .then((d) =>
        (d?.list || []).map((s) => ({
          id: s.id,
          skillId: s.id,
          code: String(s.id),
          name: s.name,
          description: s.description || '',
          category: s.displayCategoryName || '',
          updatedAt: s.updatedAt
        }))
      )
  }
  const params = keyword ? { keyword } : {}
  return request.get('/fde/platform-skill-candidates', { params })
}

/* ============================ 平台技能只读浏览 + 复制（FDE 工作台双 Tab，设计 §4.4） ============================ */
// 平台技能 Tab 全程走 /api/fde 门（FDE_WORKBENCH），与 listPlatformSkillCandidates 同组、同门；
// 绝不走 platformSkill.js（那是 SYS_CONFIG 写端点）。详情/文件树/文件内容为只读端点。

// 平台技能只读详情（主体字段）→ SkillDetailVO。不可见/不存在 → 404（读接口走全局提示）。
export function getPlatformCandidateDetail(id) {
  return request.get(`/fde/platform-skill-candidates/${id}`)
}

// 平台技能包文件树（只读）→ SkillFileTreeVO。读接口走全局提示。
export function getPlatformCandidateFiles(id) {
  return request.get(`/fde/platform-skill-candidates/${id}/files`)
}

// 平台技能包单文件内容（只读）→ SkillFileContentVO。path 须 URL-encode（含 / 与中文）。
export function getPlatformCandidateFileContent(id, path) {
  return request.get(`/fde/platform-skill-candidates/${id}/files/content`, { params: { path } })
}

