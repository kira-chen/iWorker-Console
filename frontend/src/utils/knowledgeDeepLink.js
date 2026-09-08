/**
 * 岗位详情 / 专家抽屉 → 知识库列表页 的跨模块深链 query（2026-09-08 原型复刻批次 1 · C-H2）。
 *
 * 【修的 bug】此前发送端（PositionDetailTabs / ExpertEditor）发 `kbAction` / `fromPositionId` /
 * `fromPositionName`，消费端（KnowledgeBaseList）读 `action` / `positionId` / `positionName`——
 * 键名不对齐，跳过去只切到知识库 tab，抽屉 / 检索测试弹窗不会打开、岗位上下文也不生效。
 * 三方统一走这里的一套键名，任何一方改键都会在单测里暴露。
 *
 * 【键】（消费端口径，md 知识库 §三.8）
 *   tab           固定 'kb'
 *   action        'view' | 'edit' | 'search' | 'create'（一次性消费后从地址栏清除）
 *   kbId          目标知识库 id（view / edit / search 必带）
 *   positionId    岗位上下文（进入即筛「岗位知识库」，新建时类型锁岗位、可见范围锁该岗位；保留在地址栏）
 *   positionName  岗位名（仅展示）
 */
export const KB_QUERY = Object.freeze({
  TAB: 'tab',
  ACTION: 'action',
  KB_ID: 'kbId',
  POSITION_ID: 'positionId',
  POSITION_NAME: 'positionName'
})

export const KB_TAB = 'kb'

/**
 * 拼知识库深链 query。空值键不写入（地址栏干净，消费端按「有没有」判断）。
 * @param {Object} p
 * @param {'view'|'edit'|'search'|'create'} [p.action]
 * @param {string|number} [p.kbId]
 * @param {string|number} [p.positionId]
 * @param {string} [p.positionName]
 */
export function buildKbQuery({ action, kbId, positionId, positionName } = {}) {
  const q = { [KB_QUERY.TAB]: KB_TAB }
  if (action) q[KB_QUERY.ACTION] = action
  if (kbId != null && kbId !== '') q[KB_QUERY.KB_ID] = String(kbId)
  if (positionId != null && positionId !== '') q[KB_QUERY.POSITION_ID] = String(positionId)
  if (positionName) q[KB_QUERY.POSITION_NAME] = String(positionName)
  return q
}

/** 知识库列表页路由跳转参数（name + query），发送端直接 router.push(kbRouteLocation({...})) */
export function kbRouteLocation(params) {
  return { name: 'AdminKnowledgeBase', query: buildKbQuery(params) }
}

/**
 * 消费端解析：从 route.query 取出深链参数（键名单一来源）。
 * @returns {{ action: string|null, kbId: string|null, positionId: string|null, positionName: string }}
 */
export function parseKbQuery(query = {}) {
  const q = query || {}
  return {
    action: q[KB_QUERY.ACTION] ? String(q[KB_QUERY.ACTION]) : null,
    kbId: q[KB_QUERY.KB_ID] ? String(q[KB_QUERY.KB_ID]) : null,
    positionId: q[KB_QUERY.POSITION_ID] ? String(q[KB_QUERY.POSITION_ID]) : null,
    positionName: q[KB_QUERY.POSITION_NAME] ? String(q[KB_QUERY.POSITION_NAME]) : ''
  }
}
