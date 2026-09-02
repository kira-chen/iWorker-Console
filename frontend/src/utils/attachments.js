/**
 * 解析 history 回看的 attachments（生成物卡片）。
 *
 * 后端 MessageVO.attachments 是 JSON 字符串 [{name,type,size,url}]（与 reasoningTrace 同约定，可空）。
 * 容错：null/空串/非法 JSON/非数组 → 一律回退 []，绝不抛错（回看不能因脏数据崩）。
 * 已是数组（如某些上游已解析）→ 原样透传。
 *
 * @param {string|Array|null|undefined} raw
 * @returns {Array<Object>}
 */
export function parseAttachments(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
