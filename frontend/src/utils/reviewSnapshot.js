/**
 * 治理侧 · 审核版本快照读取口（2026-09-09 PRD 复核·G3G6 · A5）。
 *
 * 【职责边界（负责人 2026-09-09 批注）】
 *   「要不要快照是由提交模块决定的，而不在审核中心/我的申请做存储处理。
 *     例如：技能/专家/岗位单独存储了审核版本的快照」
 * 即：**快照由各提交模块自己存**（岗位 `api/positionMock.js`、专家 `api/domainExpertMock.js`、
 * 技能 `api/unifiedSkillMock.js` 各自持有 reviewSnapshots 表，在「提交发布 / 提交停用」时写入、
 * 「撤回」时销毁，并随各自的 localStorage 一起持久化）；审核中心与我的申请**只读取展示、不做存储**。
 * 本文件就是那个「只读」的读取口，不含任何写入能力。
 *
 * 【md 依据】
 * - `prd.审核中心.md` §四 L48：「岗位、专家、技能三类业务对象由所属业务模块在提交审核时生成版本快照，
 *   审核详情读取该快照；知识库、MCP、API、业务系统、模型不生成快照，审核详情读取业务模块的当前配置。」
 * - `prd.审核中心.md` §七 L102：「业务快照缺失（岗位 / 专家 / 技能）→ 阻止审核并提示联系提交人重新提交。」
 *
 * 【为什么用动态 import】沿用 GovObjectDetail / PositionViewDrawer 既有范式：静态引 api/* 会把
 * api/request → @/router 链条带进引用方页面的单测模块图，动态引可避免。
 */

/** 需要版本快照的三类业务对象（md §四 L48）。其余类型读业务模块当前配置。 */
export const SNAPSHOT_KINDS = Object.freeze(['POSITION', 'EXPERT', 'SKILL'])

/** 该业务类型是否由提交模块生成版本快照。 */
export function needsSnapshot(kind) {
  return SNAPSHOT_KINDS.includes(String(kind || ''))
}

/** 快照缺失时的统一提示（md §七 L102）。 */
export const SNAPSHOT_MISSING_HINT = '该申请的版本快照缺失，无法查看提交时的配置，请联系提交人重新提交后再审核。'

/**
 * 读取某业务对象提交审核时的版本快照。
 * @param {string} kind POSITION | EXPERT | SKILL（其余类型一律返回 null，按当前配置取数）
 * @param {number|string} refId 业务实体 id
 * @returns {Promise<Object|null>} { kind, refId, requestAction, version, submittedAt, detail } 或 null
 */
export async function loadReviewSnapshot(kind, refId) {
  if (!needsSnapshot(kind) || refId == null || refId === '') return null
  try {
    if (kind === 'POSITION') {
      const { getPositionReviewSnapshot } = await import('@/api/positionMock')
      return getPositionReviewSnapshot(refId)
    }
    if (kind === 'EXPERT') {
      const { getExpertReviewSnapshot } = await import('@/api/domainExpertMock')
      return getExpertReviewSnapshot(refId)
    }
    const { getSkillReviewSnapshot } = await import('@/api/unifiedSkillMock')
    return getSkillReviewSnapshot(refId)
  } catch (e) {
    // 模块加载失败（理论上不会）→ 视同快照缺失，交由调用方按 md §七 阻止审核
    return null
  }
}
