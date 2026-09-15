/**
 * 统一发布审核台前端元数据（V39 S4）——类型/子类型/状态的展示文案与 StatusTag 颜色映射。
 *
 * 单一来源：统一审核台的「类型」列徽标在此集中维护。
 * 2026-09-12 死码清理（审计 J13）：MODEL_ACTION_LABEL / reviewStatusMeta / REVIEW_STATUS_OPTIONS 三个零调用方导出
 * 已删（AdminPositionAssignments 自带同名本地实现），随之不再 import marketMeta。
 */

// 行类型 type（后端 UnifiedReviewItemVO.type）
export const REVIEW_TYPE_TOOL = 'TOOL'
export const REVIEW_TYPE_SKILL = 'SKILL'
export const REVIEW_TYPE_MODEL = 'MODEL'             // V98：模型发布/停用均须过审
export const REVIEW_TYPE_BIZ_SYSTEM = 'BIZ_SYSTEM'   // V93：业务系统连接器发布
export const REVIEW_TYPE_POSITION = 'POSITION'       // V103：岗位纳入审核
export const REVIEW_TYPE_EXPERT = 'EXPERT'           // V104：专家纳入审核
export const REVIEW_TYPE_KNOWLEDGE_BASE = 'KNOWLEDGE_BASE' // 2026-09-09 A6：知识库纳入审核（md §二.2/§3.1）

// 类型筛选下拉（含「全部」由前端置空 value 表达）
export const REVIEW_TYPE_OPTIONS = [
  { value: 'TOOL', label: '工具' },
  { value: 'SKILL', label: '技能' },
  { value: 'BIZ_SYSTEM', label: '业务系统' },
  { value: 'MODEL', label: '模型' },
  { value: 'POSITION', label: '岗位' },
  { value: 'EXPERT', label: '专家' }
]

// 类型 → 主徽标文案 + StatusTag type（工具=info / 技能=accent / 业务系统=success）
export function typeLabel(type) {
  if (type === REVIEW_TYPE_SKILL) return '技能'
  if (type === REVIEW_TYPE_BIZ_SYSTEM) return '业务系统'
  if (type === REVIEW_TYPE_MODEL) return '模型'
  if (type === REVIEW_TYPE_POSITION) return '岗位'
  if (type === REVIEW_TYPE_EXPERT) return '专家'
  return '工具'
}
export function typeTagType(type) {
  if (type === REVIEW_TYPE_SKILL) return 'accent'
  if (type === REVIEW_TYPE_BIZ_SYSTEM) return 'success'
  if (type === REVIEW_TYPE_MODEL) return 'warning'
  if (type === REVIEW_TYPE_POSITION) return 'accent'
  if (type === REVIEW_TYPE_EXPERT) return 'success'
  return 'info'
}

/* ==================================================================================
 * 2026-09-01 PRD 对齐改造（审核中心 / 我的申请，基准 = 交互原型 v2 五模块 renderReviews /
 * renderMyApplications）：以下为治理两页新口径的展示词表与筛选映射。
 * 上方旧口径导出（REVIEW_TYPE_* / REVIEW_TYPE_OPTIONS / typeLabel / typeTagType）当前亦无调用方，
 * 本轮（2026-09-12 J13）只按清单删了 MODEL_ACTION_LABEL / reviewStatusMeta / REVIEW_STATUS_OPTIONS，其余留待下批裁决；
 * 新页面一律用下面这套。
 * ================================================================================== */

/* ---------------- 审核中心（review-center） ---------------- */

// 业务类型筛选八项（md `prd.审核中心.md` §二.2 / §3.1：岗位、专家、技能、知识库、MCP、API、业务系统、模型；
// MCP/API 由 TOOL+subType 拆分。2026-09-09 PRD 复核 A6（Q265③「知识库也需要发布审核」）：补「知识库」）
export const REVIEW_BIZ_TYPE_OPTIONS = [
  { value: 'POSITION', label: '岗位' },
  { value: 'EXPERT', label: '专家' },
  { value: 'SKILL', label: '技能' },
  { value: 'KNOWLEDGE_BASE', label: '知识库' },
  { value: 'CONNECTOR_MCP', label: 'MCP' },
  { value: 'CONNECTOR_API', label: 'API' },
  { value: 'CONNECTOR_BIZ', label: '业务系统' },
  { value: 'MODEL', label: '模型' }
]

// 业务类型筛选匹配（原型 reviewTypeMatch 逐字对应）
export function reviewTypeMatch(row, v) {
  if (!v) return true
  if (v === 'CONNECTOR_MCP') return row.type === 'TOOL' && row.subType === 'MCP'
  if (v === 'CONNECTOR_API') return row.type === 'TOOL' && row.subType !== 'MCP'
  if (v === 'CONNECTOR_BIZ') return row.type === 'BIZ_SYSTEM'
  return row.type === v
}

// 业务类型标签文案（md `prd.审核中心.md` §3.1「业务类型：岗位、专家、技能、知识库、MCP、API、业务系统、模型」；
// TOOL 直显 MCP/API 不带「连接器·」前缀）。
// 2026-09-09 PRD 复核 A7（Q262「不加，当前没有这个业务逻辑」）：技能不再按来源细分，
// 原「技能·平台创建 / 技能·用户上传」后缀去除，统一显示「技能」。
export function reviewBizTypeLabel(row) {
  if (row.type === 'SKILL') return '技能'
  if (row.type === 'TOOL') return row.subType === 'MCP' ? 'MCP' : 'API'
  if (row.type === 'BIZ_SYSTEM') return '业务系统'
  if (row.type === 'MODEL') return '模型'
  if (row.type === 'KNOWLEDGE_BASE') return '知识库'
  return { POSITION: '岗位', EXPERT: '专家' }[row.type] || row.type
}

// 业务类型 → StatusTag 色（原型 typeKind：blue→accent / green→success / orange→warning /
// purple→purple / gray→info；本站无独立蓝 token，「蓝」按报告口径映射 accent）
export function reviewBizTypeTagType(type) {
  if (type === 'TOOL' || type === 'BIZ_SYSTEM') return 'accent'
  if (type === 'SKILL') return 'success'
  if (type === 'MODEL') return 'warning'
  if (type === 'POSITION') return 'purple'
  if (type === 'EXPERT') return 'info'
  // 知识库（2026-09-09 A6 新增）：StatusTag 只有六色且已被七类占满，按「同属内容资产」与技能共用绿系
  if (type === 'KNOWLEDGE_BASE') return 'success'
  return 'info'
}

// 申请类型（requestAction）三项 + 文案 + 色（DELIST 橙 / 其余绿）
export const REQUEST_ACTION_OPTIONS = [
  { value: 'FIRST_PUBLISH', label: '首次发布' },
  { value: 'VERSION_PUBLISH', label: '新版本发布' },
  { value: 'DELIST', label: '停用' }
]
export function requestActionLabel(action) {
  return { FIRST_PUBLISH: '首次发布', VERSION_PUBLISH: '新版本发布', DELIST: '停用' }[action] || action
}
export function requestActionTagType(action) {
  return action === 'DELIST' ? 'warning' : 'success'
}

/* ---------------- 我的申请（my-applications） ---------------- */

// 业务类型筛选（md `prd.我的申请.md` §二.2 / §3.1：专家、岗位、技能、知识库、MCP、API、业务系统、模型。
// 2026-09-09 PRD 复核 A6：补「知识库」）
export const MYAPP_BIZ_TYPE_OPTIONS = [
  { value: 'EXPERT', label: '专家' },
  { value: 'POSITION', label: '岗位' },
  { value: 'SKILL', label: '技能' },
  { value: 'KNOWLEDGE_BASE', label: '知识库' },
  { value: 'MCP', label: 'MCP' },
  { value: 'API', label: 'API' },
  { value: 'BIZ_SYSTEM', label: '业务系统' },
  { value: 'MODEL', label: '模型' }
]

// 业务类型标签文案（2026-09-08 决议第 8 项：业务类型不含「其他」，OTHER 映射删除；
// 2026-09-09 A6：补 KNOWLEDGE_BASE）
export function myAppBizTypeLabel(t) {
  return (
    {
      EXPERT: '专家',
      POSITION: '岗位',
      SKILL: '技能',
      KNOWLEDGE_BASE: '知识库',
      MCP: 'MCP',
      API: 'API',
      BIZ_SYSTEM: '业务系统',
      MODEL: '模型'
    }[t] || t
  )
}

// 业务类型 → StatusTag 色（色系与审核中心同口径：知识库与技能共用绿系，见 reviewBizTypeTagType）
export function myAppBizTypeTagType(t) {
  if (['MCP', 'API', 'BIZ_SYSTEM'].includes(t)) return 'accent'
  if (t === 'SKILL' || t === 'KNOWLEDGE_BASE') return 'success'
  if (t === 'MODEL') return 'warning'
  if (t === 'POSITION') return 'purple'
  return 'info'
}

// 审核结果四态（原型 myResultMeta：待审核橙/已通过绿/已驳回红/已撤回灰）
export const MYAPP_RESULT_OPTIONS = [
  { value: 'PENDING', label: '待审核' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'WITHDRAWN', label: '已撤回' }
]
export function myAppResultMeta(result) {
  return (
    {
      PENDING: { label: '待审核', type: 'warning' },
      APPROVED: { label: '已通过', type: 'success' },
      REJECTED: { label: '已驳回', type: 'danger' },
      WITHDRAWN: { label: '已撤回', type: 'info' }
    }[result] || { label: result, type: 'info' }
  )
}
