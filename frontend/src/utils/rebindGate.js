/**
 * 更换专家强确认弹窗「确认按钮点亮」判定（单一真相源，供组件与单测共用）。
 *
 * 点亮条件（全部满足）：
 *  - preview 已就绪（非 loading、非 error）
 *  - 非「选回当前专家」（sameAsCurrent=false）——选回当前不触发换绑
 *  - 已显式勾选「我已知晓将永久清除且不可恢复」（acknowledged=true）——强确认门槛
 *  - 未在提交中（submitting=false）——防重复提交
 *
 * 任一不满足即置灰，避免误触不可恢复操作。
 */
export function canConfirmRebind({ loading, error, sameAsCurrent, acknowledged, submitting }) {
  return (
    !loading &&
    !error &&
    !sameAsCurrent &&
    acknowledged === true &&
    !submitting
  )
}
