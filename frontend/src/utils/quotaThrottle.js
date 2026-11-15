/**
 * 配额与限流 · 共用常量与校验（04运行 › 配额与限流，PRD prd.配额与限流.md §三.1）。
 * 页面与 mock 共用同一份规则：页面点【保存】时先校验，mock 再兜一次，防绕过页面写入非法值。
 */

/** 消息合并等待时长：出厂默认 5 秒，只接受 1–30 的整数（PRD §三.1、待确认 #2） */
export const MERGE_WAIT_DEFAULT_SEC = 5
export const MERGE_WAIT_MIN_SEC = 1
export const MERGE_WAIT_MAX_SEC = 30

/** 配置项名称：页面字段名与访问审计的操作对象共用 */
export const MERGE_WAIT_LABEL = '消息合并等待时长'

const INTEGER = /^\d+$/

/**
 * 校验输入框里的原始文本。不自动取整、不自动拉回范围（PRD §三.1 校验）。
 * @param {string|number|null|undefined} raw
 * @returns {string} 错误文案；合法返回空串
 */
export function mergeWaitInputError(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return '请填写消息合并等待时长'
  if (!INTEGER.test(text)) return `请填写 ${MERGE_WAIT_MIN_SEC}–${MERGE_WAIT_MAX_SEC} 之间的整数`
  const n = Number(text)
  if (n < MERGE_WAIT_MIN_SEC || n > MERGE_WAIT_MAX_SEC) return `请填写 ${MERGE_WAIT_MIN_SEC}–${MERGE_WAIT_MAX_SEC} 之间的整数`
  return ''
}

/** 访问审计「变更内容」：原值 → 新值，如「5 秒 → 8 秒」 */
export function mergeWaitChangeText(from, to) {
  return `${from} 秒 → ${to} 秒`
}
