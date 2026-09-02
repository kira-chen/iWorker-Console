/**
 * 图标上传 + 方形裁剪的纯逻辑层（PRD「图标统一规则」，2026-09-02 负责人拍板全站执行）。
 *
 * 规则来源：docs/prd/PRD-20260828/02岗位/岗位/prd.岗位.md「图标」一节（各模块 md 重复出现，内容一致）：
 * - 上传支持 PNG / JPG / JPEG / WebP / GIF / SVG，单文件 ≤5MB；
 * - 异常文案逐字：「请选择图片文件」「图片不能超过 5 MB」；
 * - 裁剪：方形选区（拖动图片 + 缩放滑杆），输出 256×256 PNG（GIF/SVG 同样走 canvas 静态化）。
 *
 * 几何模型（avatar-cropper 范式）：正方形视口（viewport）固定，图片以 cover 比例铺满并可
 * 拖动 / 缩放；offset 为图片左上角相对视口左上角的位移（≤0），裁剪即取视口下方的源区域。
 * 全部函数为纯函数（除 cropToPngDataUrl 依赖 canvas），便于单测。
 */

export const ICON_MAX_BYTES = 5 * 1024 * 1024 // 5MB
export const ICON_OUTPUT_SIZE = 256

const ICON_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const ICON_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i

// 文件输入框 accept（MIME + 后缀双写，兼容不同浏览器的过滤实现）
export const ICON_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml'

/**
 * 校验上传文件（MIME 优先，后缀兜底）。
 * @returns {string} 空串=通过；否则为 PRD 逐字错误文案。
 */
export function validateIconFile(file) {
  if (!file) return '请选择图片文件'
  const typeOk = ICON_MIME_TYPES.includes(file.type) || ICON_EXT_RE.test(file.name || '')
  if (!typeOk) return '请选择图片文件'
  if (file.size > ICON_MAX_BYTES) return '图片不能超过 5 MB'
  return ''
}

/** cover 基准缩放：短边恰好铺满正方形视口。 */
export function coverScale(natW, natH, viewport) {
  if (!natW || !natH) return 1
  return viewport / Math.min(natW, natH)
}

/** 位移夹取：保证图片始终盖满视口（offset ∈ [viewport - disp, 0]）。 */
export function clampOffset(x, y, natW, natH, scale, viewport) {
  const dispW = natW * scale
  const dispH = natH * scale
  return {
    x: Math.min(0, Math.max(viewport - dispW, x)),
    y: Math.min(0, Math.max(viewport - dispH, y))
  }
}

/** 初始位移：图片居中于视口。 */
export function centerOffset(natW, natH, scale, viewport) {
  return {
    x: (viewport - natW * scale) / 2,
    y: (viewport - natH * scale) / 2
  }
}

/** 缩放时保持视口中心不动的位移换算（s1 → s2），结果未夹取，调用方再 clampOffset。 */
export function zoomAroundCenter(offset, s1, s2, viewport) {
  if (!s1) return { ...offset }
  const k = s2 / s1
  return {
    x: viewport / 2 - (viewport / 2 - offset.x) * k,
    y: viewport / 2 - (viewport / 2 - offset.y) * k
  }
}

/** 由当前位移/缩放换算源图上的裁剪区（自然像素坐标，正方形）。 */
export function sourceRect(offset, scale, viewport) {
  return {
    sx: -offset.x / scale,
    sy: -offset.y / scale,
    sw: viewport / scale,
    sh: viewport / scale
  }
}

/**
 * 将源图的选区绘制为 outSize×outSize 的 PNG dataURL。
 * GIF 取首帧、SVG 栅格化 —— canvas.drawImage 天然满足「统一出静态 PNG」。
 * canvas 不可用（如受限环境）时抛错，由调用方兜底提示。
 */
export function cropToPngDataUrl(img, rect, outSize = ICON_OUTPUT_SIZE) {
  const canvas = document.createElement('canvas')
  canvas.width = outSize
  canvas.height = outSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outSize, outSize)
  return canvas.toDataURL('image/png')
}
