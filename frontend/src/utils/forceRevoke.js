/**
 * 强制回收（技能 / 专家 / MCP / API / 业务系统共用）——回收原因校验 + 回收信息构造。
 *
 * 对应 PRD 各模块「强制回收（停用时勾选）」小节：强制回收是【停用】弹窗里的勾选项，与普通停用同走审核，
 * 审核通过后对象回到「未发布」并带「已回收」标记；原因必填（≤500 字）。
 * 弹窗交互在 components/admin/DeactivateDialog.vue；五个 mock 在审核通过时用本文件构造回收信息。
 */
import { nowMinuteText } from '@/utils/datetime'
import { currentDemoUsername } from '@/utils/demoIdentity'

export const FORCE_REVOKE_REASON_MAX = 500

/** 回收原因校验：合法返回 ''，否则返回提示文案（弹窗与 mock 共用，两侧口径一致）。 */
export function validateRevokeReason(reason) {
  const t = String(reason || '').trim()
  if (!t) return '请输入回收原因'
  if (t.length > FORCE_REVOKE_REASON_MAX) return `回收原因最多 ${FORCE_REVOKE_REASON_MAX} 字`
  return ''
}

/** 回收信息（mock 侧在审核通过时写进对象的 `revoked` 字段）：原因 + 时间 + 操作人。 */
export function makeRevokedInfo(reason, operator = currentDemoUsername()) {
  return { reason, at: nowMinuteText(), operator }
}

/** 「已回收」悬停说明文案：原因 · 操作人 · 时间。 */
export function revokedTip(info) {
  if (!info) return ''
  return `回收原因：${info.reason}（${info.operator || '管理员'} · ${info.at}）`
}
