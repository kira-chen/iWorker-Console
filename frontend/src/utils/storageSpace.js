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

/** 默认容量的出厂值（2026-10-12 起暂定 1 GB，管理员可在容量分配页修改，范围同单员工 1–20 GB） */
export const DEFAULT_QUOTA_GB = 1

/** 磁盘总量的出厂值（GB）：当前版本按物理总量分配、不超分，各员工容量之和不得超过它；管理员可修改 */
export const DISK_TOTAL_GB = 1000

/** 拒绝原因最多字数（与驳回原因、回收原因同口径）；输入框限长，超出无法继续输入 */
export const REJECT_REASON_MAX = 500

/** 调整容量、批量设置、同意扩容的输入框最小值（GB），减号减到它就不能再减 */
export const QUOTA_MIN_GB = 1
/** 单个员工容量上限（GB）：调整容量、批量设置、同意扩容都不能超过，输入框加到它就不能再加 */
export const QUOTA_MAX_GB = 20

/**
 * 调小容量的下限：不得低于员工当前已用（容量是整数 GB，已用 2.7 GB 时下限为 3 GB）；没有统计结果（已用为空）时只受最小值约束。
 * 页面输入框的 min 与 mock 校验共用这一份。
 */
export function quotaFloorGb(usedGb) {
  return usedGb == null ? QUOTA_MIN_GB : Math.max(QUOTA_MIN_GB, Math.ceil(usedGb))
}

/** 容量数值展示：整数不带小数点，其余保留 1 位；空值显示「—」。 */
export function fmtGb(value) {
  if (value == null) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)} GB`
}

/**
 * 容量输入框的校验：返回提示文案，合法返回空串。页面输入弹窗与 mock 共用这一份，文案不会两边漂移。
 * 输入框不设 precision（小数原样保留），所以「只能填整数」由这里提示；小于下限时输入框会先把值拉回下限，
 * 「不能小于」主要给绕过页面的调用兜底。
 */
export function quotaInputError(value, min = QUOTA_MIN_GB, max = QUOTA_MAX_GB) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '请输入正整数'
  const n = Number(value)
  if (!Number.isInteger(n)) return '容量只能填整数'
  if (n < min) return `容量不能小于 ${min} GB`
  if (n > max) return `容量不能大于 ${max} GB`
  return ''
}
