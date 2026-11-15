/**
 * 技能引用工具的连接器发布态（产品优化需求-202611 修改点 13（R4））。
 *
 * 技能编辑页的工具候选放开到「未发布 / 审核中 / 已发布」三态的连接器后，有三处要用同一套口径：
 *   ① 工具卡名称旁的状态标签（未发布标「未发布」、审核中标「审核中」、已发布不标）；
 *   ② 「本技能已引用」区同样的标签；
 *   ③ 技能提交发布时的阻断校验（版本管理弹窗提示 + 【提交发布】不可点，mock 发布接口兜底）。
 * ①② 在组件里、③ 同时在页面和 mock 里，抽到这里免得判定和文案各写一份、改一处漏一处。
 *
 * pubState 取值见 TOOL_PUB_STATE；已停用、已强制回收的连接器不进候选，已引用时 pubState 为 null
 * （由 checkStatus=DISABLED 给「已停用」提示，不在这里管）。
 */
import { TRI_STATE_META } from './publishTriState'

export const TOOL_PUB_STATE = Object.freeze({
  UNPUBLISHED: 'UNPUBLISHED',
  REVIEWING: 'REVIEWING',
  PUBLISHED: 'PUBLISHED'
})

/**
 * 名称旁的发布态标签：未发布 / 审核中返回 { label, type }（与连接器列表的三态同词同色）；
 * 已发布、null 或未知值返回 null（不标）。
 */
export function toolPubTag(pubState) {
  if (pubState === TOOL_PUB_STATE.UNPUBLISHED || pubState === TOOL_PUB_STATE.REVIEWING) return TRI_STATE_META[pubState]
  return null
}

/**
 * 技能发布阻断提示：tools 为 [{ code, bizName, pubState }]，其中引用了未发布或审核中连接器的进提示；
 * 没有这类工具返回空串（放行）。
 * 文案取草案原句「引用的「名称」尚未发布，请先发布该连接器或移除引用」；同时有多个时名称用顿号并列在同一句里。
 */
export function unpublishedToolsMessage(tools) {
  const names = (Array.isArray(tools) ? tools : [])
    .filter((t) => t && toolPubTag(t.pubState))
    .map((t) => `「${t.bizName || t.code}」`)
  if (!names.length) return ''
  return `引用的${names.join('、')}尚未发布，请先发布该连接器或移除引用`
}
