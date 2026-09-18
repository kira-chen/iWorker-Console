/**
 * 审核接线公共件（2026-09-18 R1 修复：审核联动主线接通）
 * ============================================================================
 * 【为什么有这个文件】
 * 09-18 逻辑审查发现：除知识库与 MCP 停用外，岗位 / 专家 / 技能 / API / 业务系统 / 模型 提交发布或停用后
 * 都**没有**向审核中心（reviewsMock）和「我的申请」（myApplicationsMock）写行，撤回也不摘行——
 * 对象停在「审核中」，审核员看不到，只能撤回。每个模块各自 import 两个 mock 再各写一遍
 * 「建两行 / 撤两行 / 判申请类型」很容易再漏一个，所以收成一处。
 *
 * 【三件事】
 *   enrollReview()    提交发布 / 停用 → 同时落审核中心行 + 我的申请行（同一对象仍在审时覆盖，不重复建）
 *   unenrollReview()  撤回 → 摘审核中心行 + 我的申请行置「已撤回」
 *   reviewActionMatches()  审核落地前核对：审核行的申请类型必须与对象自身在途事项同向
 *                     （发布 vs 停用），不同向说明两边已脱节，宁可拒绝落地也不能把停用申请当发布落
 *
 * 【依赖方向】
 * 各业务 mock → 本文件 → reviewsMock / myApplicationsMock（静态）；
 * reviewsMock / myApplicationsMock → 各业务 mock 只用动态 import（见 reviewsMock LOADERS 注释），不成环。
 */
import { submitReviewRow, cancelReviewRow } from './reviewsMock'
import { submitApplicationRow, withdrawApplicationRow } from './myApplicationsMock'

/** 「我的申请」业务类型 → 审核中心 type / subType（连接器两件套在审核中心是 TOOL + subType） */
function reviewTypeOf(businessType) {
  if (businessType === 'MCP' || businessType === 'API') return { type: 'TOOL', subType: businessType }
  return { type: businessType }
}

/**
 * 提交端：一次调用同时落两张表。
 * @param {Object} p
 * @param {string} p.businessType  POSITION | EXPERT | SKILL | KNOWLEDGE_BASE | MCP | API | BIZ_SYSTEM | MODEL
 * @param {string|number} p.refId  业务实体 id
 * @param {string} p.name
 * @param {string} [p.description]
 * @param {'FIRST_PUBLISH'|'VERSION_PUBLISH'|'DELIST'} p.requestAction
 * @param {string} [p.version]      申请版本，无版本概念的模块传 '—'
 * @param {string} [p.versionNotes] 升级说明 / 申请说明（我的申请详情展示）
 * @param {string} [p.submittedAt]  不传取当前分钟
 */
export function enrollReview(p) {
  const { type, subType } = reviewTypeOf(p.businessType)
  submitReviewRow({
    type,
    ...(subType ? { subType } : {}),
    refId: p.refId,
    name: p.name,
    description: p.description || '',
    requestAction: p.requestAction,
    version: p.version || '—',
    ...(p.submittedAt ? { submittedAt: p.submittedAt } : {})
  })
  submitApplicationRow({
    businessType: p.businessType,
    refId: p.refId,
    objectName: p.name,
    description: p.description || '',
    applicationType: p.requestAction,
    version: p.version || '—',
    versionNotes: p.versionNotes || '',
    ...(p.submittedAt ? { submittedAt: p.submittedAt } : {})
  })
}

/** 撤回端：摘审核中心待审行，我的申请行置「已撤回」（行保留，md 我的申请 §3.1）。 */
export function unenrollReview(businessType, refId) {
  const { type } = reviewTypeOf(businessType)
  cancelReviewRow(type, refId)
  withdrawApplicationRow(businessType, refId)
}

/**
 * 首次发布还是新版本发布：曾经审核通过并发布过（有版本历史 / 有版本号）就是新版本发布。
 * @param {boolean} hasPublishedBefore
 */
export function publishActionOf(hasPublishedBefore) {
  return hasPublishedBefore ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH'
}

/** 把各模块五花八门的 pendingAction 归一为「是不是停用」：PUBLISH/publish → false，DELIST/DEACTIVATE/stop → true。 */
export function isDelistAction(action) {
  const a = String(action || '').toUpperCase()
  return a === 'DELIST' || a === 'DEACTIVATE' || a === 'STOP'
}

/**
 * 审核落地前的一致性核对：审核行说的是发布还是停用，必须与对象自己记的在途事项同向。
 * 对象没有在途事项、或方向不同，都返回 false → reviewsMock 据此拒绝落地并保持审核行不变。
 */
export function reviewActionMatches(requestAction, pendingAction) {
  if (!pendingAction) return false
  return isDelistAction(requestAction) === isDelistAction(pendingAction)
}
