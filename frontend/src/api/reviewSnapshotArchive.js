/**
 * 审核版本快照的「历史归档」公共件（2026-10-19 yuepu#76：保留历史快照）
 * ============================================================================
 * 【为什么有这个文件】
 * md `prd.我的申请.md` §详情：岗位 / 专家 / 专家团 / 技能的申请详情「读取提交时的版本快照」。
 * 原实现每个对象只存一份快照（单槽位），审核有结论或撤回就删，之后在「我的申请」回看已处理的申请，
 * 快照没了，回落读对象**当前**配置——看到的不是当时提交的内容。
 *
 * 【做法】各提交模块（岗位 / 专家 / 专家团 / 技能）在原有 reviewSnapshots（对象 id → 在审快照，审核中心据此判「快照缺失」）
 * 之外再持有一份 snapshotArchive（对象 id → 历史快照数组，旧→新）。审核有结论 / 撤回时，在审快照**移入归档**而不是删除。
 * 每份快照带 key（`对象id#序号`），提交时随审核行、我的申请行一起落 snapshotKey；回看某条申请时按 key 精确取回。
 *
 * 只管「在审快照 ↔ 归档」的搬运与查找，快照内容仍由各模块自己生成。
 */

/** 为对象的下一份快照生成 key：`对象id#序号`，序号 = 已归档数 + 在审 1 份 + 1，只增不减（归档只进不出）。 */
export function nextSnapshotKey(live, archive, id) {
  const n = (archive[String(id)]?.length || 0) + (live[String(id)] ? 1 : 0) + 1
  return `${id}#${n}`
}

/** 在审快照移入归档（无在审快照则什么都不做）。 */
export function archiveSnapshot(live, archive, id) {
  const k = String(id)
  const snap = live[k]
  if (!snap) return
  ;(archive[k] ||= []).push(snap)
  delete live[k]
}

/**
 * 查快照：不传 key → 只看在审快照（审核中心用）；传 key → 在审与归档里按 key 精确匹配，找不到返回 null
 * （调用方回落读当前配置，如种子里没有快照的历史申请）。返回深拷贝。
 */
export function findSnapshot(live, archive, id, key) {
  const k = String(id)
  let hit = null
  if (key == null || key === '') hit = live[k] || null
  else hit = [live[k], ...(archive[k] || [])].find((s) => s && s.key === key) || null
  return hit ? JSON.parse(JSON.stringify(hit)) : null
}
