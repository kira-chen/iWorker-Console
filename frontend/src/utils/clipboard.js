/**
 * 复制文本到剪贴板（渠道页回调地址、权限清单等「复制」按钮共用）。
 * 优先用 Clipboard API；不可用（非安全上下文 / 旧浏览器 / jsdom）时退回隐藏 textarea + execCommand。
 * @param {string} text
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到兜底
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy')
    ta.remove()
    return !!ok
  } catch {
    return false
  }
}
