/**
 * 技能派生类别（OPERATION 操作类 / QUERY 查询类）展示口径——纯函数，前端单一真相。
 *
 * 类别由后端按「是否引用数据表/业务系统」派生（只读，前端不提供编辑入口）：
 * - OPERATION 操作类：可代用户办事/写库 → 用警示/强调色（warning）凸显其「会动数据」。
 * - QUERY 查询类：只读问答 → 中性灰（info）。
 *
 * 颜色统一走 StatusTag 的语义色（tokens.css 令牌，双主题自动适配），不写死颜色值。
 */

export const SKILL_CATEGORY = Object.freeze({
  OPERATION: 'OPERATION',
  QUERY: 'QUERY'
})

/** 中文标签（未知/空 → null，调用方据此不渲染标签）。 */
export function categoryLabel(category) {
  if (category === SKILL_CATEGORY.OPERATION) return '操作类'
  if (category === SKILL_CATEGORY.QUERY) return '查询类'
  return null
}

/** StatusTag type：操作类=warning(警示/强调)、查询类=info(中性)。 */
export function categoryTagType(category) {
  return category === SKILL_CATEGORY.OPERATION ? 'warning' : 'info'
}

/** 是否有可展示的类别（非空且为已知取值）。 */
export function hasCategory(category) {
  return categoryLabel(category) !== null
}

/**
 * 类别含义说明（tooltip 文案，单一真相）：供技能列表「类别」列表头 + 整页编辑器顶部标签复用。
 * 口径与后端派生一致：引用数据表/业务系统=操作类（会读写），否则查询类（只读问答）。
 */
export const CATEGORY_TOOLTIP =
  '操作类：会读写数据表 / 业务系统；查询类：只读问答（由是否引用数据表/业务系统自动派生，不可手改）'
