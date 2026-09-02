import { ElDialog, ElDrawer, ElMessageBox } from 'element-plus'

// 全局关闭弹窗的 Esc 关闭行为：中文输入法候选态按 Esc（仅想取消本次输入）会连带关掉弹窗，
// 故约定应用内弹窗一律不响应 Esc（点遮罩/✕/取消按钮等显式关闭不受影响）。
// 须在任何弹窗首次挂载前调用（main.js 入口处）。
let applied = false

export function disableDialogEsc() {
  if (applied) return
  applied = true
  // ElDialog 与 ElDrawer 的 closeOnPressEscape 共享同一 prop 定义对象，双写以防未来版本解耦。
  ElDialog.props.closeOnPressEscape.default = false
  ElDrawer.props.closeOnPressEscape.default = false
  // MessageBox 的默认值在其内部组件里改不到，包一层公开 API 注入；调用方显式传入时以调用方为准。
  for (const boxType of ['alert', 'confirm', 'prompt']) {
    const original = ElMessageBox[boxType]
    ElMessageBox[boxType] = (message, title, options, appContext) => {
      if (title !== null && typeof title === 'object') {
        title = { closeOnPressEscape: false, ...title }
      } else {
        options = { closeOnPressEscape: false, ...(options || {}) }
      }
      return original(message, title, options, appContext)
    }
  }
}
