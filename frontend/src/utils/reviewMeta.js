/**
 * 统一发布审核台前端元数据（V39 S4）——类型/子类型/状态的展示文案与 StatusTag 颜色映射。
 *
 * 单一来源：统一审核台的「类型」列徽标在此集中维护。状态(status)四态徽标、目标(target)/读写性质
 * (writeClass) 均复用 utils/marketMeta，不重复定义（工具/技能状态枚举一致，避免两套漂移）。
 */
import { statusMeta as listingStatusMeta } from '@/utils/marketMeta'

// 行类型 type（后端 UnifiedReviewItemVO.type）
export const REVIEW_TYPE_TOOL = 'TOOL'
export const REVIEW_TYPE_SKILL = 'SKILL'
export const REVIEW_TYPE_MODEL = 'MODEL'             // V98：模型发布/停用均须过审
export const REVIEW_TYPE_BIZ_SYSTEM = 'BIZ_SYSTEM'   // V93：业务系统连接器发布
export const REVIEW_TYPE_POSITION = 'POSITION'       // V103：岗位纳入审核
export const REVIEW_TYPE_EXPERT = 'EXPERT'           // V104：专家纳入审核

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

/** 模型待审动作 → 中文（审核台子类型位；两者影响相反，必须让审核员一眼分辨）。 */
export const MODEL_ACTION_LABEL = { PUBLISH: '发布', DELIST: '停用' }

// 审核态 → 文案 + StatusTag type。四态对称展现，复用 marketMeta 的 LISTING_STATUS_META
// （PENDING_REVIEW=warning / PUBLISHED=success / REJECTED=danger / DELISTED=info），
// 工具与技能状态枚举一致，技能行同样适用。
export function reviewStatusMeta(status) {
  return listingStatusMeta(status)
}

// 状态筛选下拉（含「全部」由前端置空 value 表达 → 不传 status，后端返四态全集）
export const REVIEW_STATUS_OPTIONS = [
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'DELISTED', label: '已下架' }
]

/* ==================================================================================
 * 2026-09-01 PRD 对齐改造（审核中心 / 我的申请，基准 = 交互原型 v2 五模块 renderReviews /
 * renderMyApplications）：以下为治理两页新口径的展示词表与筛选映射。
 * 上方旧口径导出保留（marketMeta 等旁路仍引用），新页面一律用下面这套。
 * ================================================================================== */

/* ---------------- 审核中心（review-center） ---------------- */

// 业务类型筛选七项（原型 typeOptions 逐字照抄；MCP/API 由 TOOL+subType 拆分）
export const REVIEW_BIZ_TYPE_OPTIONS = [
  { value: 'POSITION', label: '岗位' },
  { value: 'EXPERT', label: '专家' },
  { value: 'SKILL', label: '技能' },
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

// 业务类型标签文案（原型 typeLabel：SKILL 带来源后缀，TOOL 直显 MCP/API 不带「连接器·」前缀
// ——2026-09-01 疑点1 处置：显示用原型词）
export function reviewBizTypeLabel(row) {
  if (row.type === 'SKILL') {
    return '技能·' + (row.platformSource === 'USER_UPLOADED' ? '用户上传' : '平台创建')
  }
  if (row.type === 'TOOL') return row.subType === 'MCP' ? 'MCP' : 'API'
  if (row.type === 'BIZ_SYSTEM') return '业务系统'
  if (row.type === 'MODEL') return '模型'
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

// 业务类型筛选（原型 types 数组顺序：专家/岗位/技能/MCP/API/业务系统/模型）
export const MYAPP_BIZ_TYPE_OPTIONS = [
  { value: 'EXPERT', label: '专家' },
  { value: 'POSITION', label: '岗位' },
  { value: 'SKILL', label: '技能' },
  { value: 'MCP', label: 'MCP' },
  { value: 'API', label: 'API' },
  { value: 'BIZ_SYSTEM', label: '业务系统' },
  { value: 'MODEL', label: '模型' }
]

// 业务类型标签文案（原型 myBusinessLabel）
export function myAppBizTypeLabel(t) {
  return (
    {
      EXPERT: '专家',
      POSITION: '岗位',
      SKILL: '技能',
      MCP: 'MCP',
      API: 'API',
      BIZ_SYSTEM: '业务系统',
      MODEL: '模型',
      OTHER: '其他'
    }[t] || t
  )
}

// 业务类型 → StatusTag 色（原型 myBusinessKind，色系与审核中心同口径）
export function myAppBizTypeTagType(t) {
  if (['MCP', 'API', 'BIZ_SYSTEM'].includes(t)) return 'accent'
  if (t === 'SKILL') return 'success'
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
