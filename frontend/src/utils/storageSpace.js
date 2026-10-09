/**
 * 存储空间页（04运行 › 存储空间）两个页签共用的展示常量与格式化。
 * 状态判定在 storageSpaceMock（已用 ≥ 总量 90% 为预警，≥ 总量为已满），这里只管怎么展示。
 */

/** 员工存储状态 → 文案 + StatusTag 类型 */
export const STORAGE_STATE = {
  NORMAL: { label: '正常', tag: 'success' },
  WARN: { label: '预警', tag: 'warning' },
  FULL: { label: '已满', tag: 'danger' },
  UNKNOWN: { label: '未统计', tag: 'info' }
}

/** 扩容申请状态 → 文案 + StatusTag 类型 */
export const REQUEST_STATE = {
  PENDING: { label: '待处理', tag: 'warning' },
  APPROVED: { label: '已同意', tag: 'success' },
  REJECTED: { label: '已拒绝', tag: 'danger' }
}

/** 调整容量、批量设置、同意扩容的输入框最小值（GB），减号减到它就不能再减 */
export const QUOTA_MIN_GB = 1
/** 容量数值展示：整数不带小数点，其余保留 1 位；空值显示「—」。 */
export function fmtGb(value) {
  if (value == null) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)} GB`
}
