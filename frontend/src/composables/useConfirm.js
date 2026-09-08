import { ElMessageBox } from 'element-plus'

/**
 * 管理后台确认弹窗统一封装（2026-09-08 原型复刻批次 1 · A8）。
 *
 * 【形态】照原型 L15 `.modal` + L186 `modal()`：居中 440px 白卡、圆角 8、**无 warning 图标**、
 * h3 标题 + p 正文、右下角 取消(plain) / 确认(primary)，无右上 ×。样式由 customClass
 * `admin-confirm` 落在 assets/admin-shell.css（消息框 teleport 到 body，只能全局写）。
 *
 * 【与原型的差别】原型确认键一律绿 primary，不按危险 / 警告变色（属简化）；代码既有约定
 * 删除类用 danger 红、停用类用 warning 橙——**保留**（负责人：危险档不搬原型）。调用方传
 * `danger: true` / `warning: true` 即可，不再各自拼 confirmButtonClass。
 *
 * 【签名不变】内部仍是 `ElMessageBox.confirm(message, title, options)` /
 * `ElMessageBox.alert(message, title, options)`，页面单测对 ElMessageBox 的 mock 与断言照旧成立。
 *
 * 用法：
 *   const ok = await confirmDialog('删除后「X」将不可用，确认删除？', '删除岗位', { confirmText: '删除', danger: true })
 *   if (!ok) return
 *   await alertDialog('该岗位已被 3 个用户领用，需先解除领用后再删除', '删除岗位', { confirmText: '知道了' })
 *
 * 本批接入岗位列表 / 岗位管理；其余页面的 ElMessageBox 直调归后续批次逐页切换。
 */

/** 公共选项：去图标、去 ×、统一 customClass，按钮文案默认 取消 / 确定 */
function baseOptions({ confirmText, cancelText, danger, warning, extra }) {
  const opts = {
    customClass: 'admin-confirm',
    showClose: false,
    confirmButtonText: confirmText || '确定',
    cancelButtonText: cancelText || '取消',
    ...(extra || {})
  }
  if (danger) opts.confirmButtonClass = 'el-button--danger'
  else if (warning) opts.confirmButtonClass = 'el-button--warning'
  return opts
}

/**
 * 两键确认。resolve true = 确认，false = 取消 / 关闭。
 * @param {string|Function|import('vue').VNode} message 正文（字符串或 h() 渲染函数）
 * @param {string} title 标题
 * @param {Object} [options]
 * @param {string} [options.confirmText='确定']
 * @param {string} [options.cancelText='取消']
 * @param {boolean} [options.danger] 确认键红档（删除类）
 * @param {boolean} [options.warning] 确认键橙档（停用类）
 * @param {Object} [options.extra] 透传给 ElMessageBox 的其它选项
 */
export async function confirmDialog(message, title, options = {}) {
  try {
    await ElMessageBox.confirm(message, title, baseOptions(options))
    return true
  } catch {
    return false
  }
}

/**
 * 单键提示（如领用护栏「知道了」）。resolve 后即关闭，无返回值语义。
 */
export async function alertDialog(message, title, options = {}) {
  try {
    await ElMessageBox.alert(message, title, baseOptions({ confirmText: '知道了', ...options }))
  } catch {
    /* 关闭即可 */
  }
}

/** 组合式入口（与 useAdminList 等同风格），返回两个方法。 */
export function useConfirm() {
  return { confirmDialog, alertDialog }
}
