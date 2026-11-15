/**
 * 技能被引用情况（2026-11-10 起）：专家按类型可引用岗位私有 / 市场 / 通用技能，岗位私有技能可能同时被岗位和专家引用。
 *
 * 入参是技能列表 VO 的 { positionRefNames, expertRefNames }（mock 侧传同形对象）。列表「引用情况」、引用清单弹窗、
 * 停用 / 删除的引用拦截文案都从这里取，免得页面和数据层各拼一套、口径对不上。
 */

/** 按引用方分组，只留有引用的组：[{ subject: '岗位' | '专家', names }] */
export function skillRefGroups(row) {
  const groups = []
  const pos = Array.isArray(row?.positionRefNames) ? row.positionRefNames : []
  const exp = Array.isArray(row?.expertRefNames) ? row.expertRefNames : []
  if (pos.length) groups.push({ subject: '岗位', names: pos })
  if (exp.length) groups.push({ subject: '专家', names: exp })
  return groups
}

/** 引用总数（岗位 + 专家）。 */
export function skillRefCount(row) {
  return skillRefGroups(row).reduce((n, g) => n + g.names.length, 0)
}

/** 引用方描述，供停用弹窗「当前已被 N 个{引用方}引用」：「岗位 / 专家」或单一一方。 */
export function skillRefSubjects(row) {
  return skillRefGroups(row)
    .map((g) => g.subject)
    .join(' / ')
}

/** 停用 / 删除被引用时的拦截文案：「该技能被 2 个岗位、1 个专家引用（经营分析岗、财务审核岗；经营数据核查专家），需先解除引用后再停用。」 */
export function skillRefBlockMessage(row, action) {
  const groups = skillRefGroups(row)
  if (!groups.length) return ''
  const head = groups.map((g) => `${g.names.length} 个${g.subject}`).join('、')
  const names = groups.map((g) => g.names.join('、')).join('；')
  return `该技能被 ${head}引用（${names}），需先解除引用后再${action}。`
}
