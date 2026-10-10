/**
 * 展示格式化工具：文件大小 / 时间 / 相对时间（全站单一实现）。
 * 2026-10-10 J7：员工端个人空间文档（09-13 退役）遗留的来源 / 状态 / 类型映射死导出已删除。
 */

// 字节 → 人类可读
export function fmtSize(bytes) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  // 大数（>=100）取整更易读，其余保留一位小数。
  // 注：bytes<1024 已在上方提前 return，故此处 i===0 表示 KB 档而非「字节」，不应强制取整。
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

// ISO 时间 → YYYY-MM-DD HH:mm（2026-09-09 收编：正本迁至 utils/datetime.fmtMinute，导出名保持不变）
export { fmtMinute as fmtTime } from './datetime'

/**
 * ISO 时间 → 相对时间（「刚刚 / N 秒前 / N 分钟前 / N 小时前 / N 天前」）。
 *
 * 用于「这条信息有多新」比「具体哪一刻」更重要的场景——例如模型的最近验证时间：
 * 管理员真正要判断的是「这个『正常』还可信吗」，`3 分钟前` 比 `2026-08-20 14:32` 直观。
 * 绝对时间仍应以 tooltip / 次要位置并存，便于精确追溯。
 *
 * 口径与 `components/position/SaveStatusIndicator.vue` 的相对时间一致（同一套措辞，
 * 全站单一实现——该组件的本地实现已改为引用此函数）。
 *
 * @param {string|number|Date|null} iso ISO 字符串 / 时间戳 / Date
 * @param {number} [nowMs] 参照时刻（默认 Date.now()），供组件按 tick 刷新与单测注入
 * @returns {string} 空值返回 ''
 */
export function fmtRelative(iso, nowMs) {
  if (!iso) return ''
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, (nowMs ?? Date.now()) - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}
