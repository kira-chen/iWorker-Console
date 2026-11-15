/**
 * 图标上传 + 方形裁剪的纯逻辑层（PRD「图标统一规则」，2026-09-02 负责人拍板全站执行）。
 *
 * 规则来源：docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md「图标」一节（各模块 md 重复出现，内容一致）：
 * - 上传支持 PNG / JPG / JPEG / WebP / GIF / SVG，单文件 ≤5MB；
 * - 异常文案逐字：「请选择图片文件」「图片不能超过 5 MB」；
 * - 裁剪：方形选区（拖动图片 + 缩放滑杆），输出 256×256 PNG（GIF/SVG 同样走 canvas 静态化）。
 *
 * 产品优化需求-202611 修改点 16（R12）补原图尺寸规则（岗位、专家、专家团、技能、模型、MCP、API、业务系统、
 * 知识库共用本文件，R12-1 暂按最小 128、建议 256）：
 * - 原图短边 < 128 px 不可用，提示「图片尺寸过小，请上传不小于 128×128 的图片」；
 * - 短边 128–255 px 可用，裁剪界面提示「图片尺寸偏小，生成的图标可能模糊」；
 * - SVG 是矢量图，放大不失真，不受尺寸限制；
 * - 【上传图标】按钮旁常驻提示见 ICON_UPLOAD_HINT；
 * - 输出保持 256×256 PNG（R12-2 暂按）；GIF 只取第一帧、SVG 转成 PNG（R12-3 继续支持两种格式），
 *   都由 cropToPngDataUrl 的 canvas.drawImage 完成。
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

// 原图尺寸（R12）：短边低于 MIN 不可用；低于 RECOMMENDED 可用但提示可能模糊（输出 256，原图小于 256 就得放大）
export const ICON_MIN_SIDE = 128
export const ICON_RECOMMENDED_SIDE = 256

// 【上传图标】按钮旁的常驻提示（R12，逐字），IconField / IconPickerPopover 共用
export const ICON_UPLOAD_HINT = '支持 PNG、JPG、WebP、GIF、SVG，不超过 5 MB，建议 1:1、不小于 256×256'

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

/** 是否 SVG（MIME 优先，后缀兜底，口径同 validateIconFile）：SVG 不做原图尺寸校验。 */
export function isSvgIcon(file) {
  return file?.type === 'image/svg+xml' || /\.svg$/i.test(file?.name || '')
}

/**
 * 原图尺寸校验（R12）：图片读出宽高后、进裁剪界面前调用。
 * @param {number} natW 原图宽（px）
 * @param {number} natH 原图高（px）
 * @param {{ svg?: boolean }} opts svg=true 时不受尺寸限制
 * @returns {{ error: string, warning: string }} error 非空=不可用（不进裁剪）；warning 非空=可用，裁剪界面展示该提示
 */
export function checkIconDimensions(natW, natH, { svg = false } = {}) {
  if (svg) return { error: '', warning: '' }
  const side = Math.min(natW || 0, natH || 0)
  if (side < ICON_MIN_SIDE) {
    return { error: `图片尺寸过小，请上传不小于 ${ICON_MIN_SIDE}×${ICON_MIN_SIDE} 的图片`, warning: '' }
  }
  if (side < ICON_RECOMMENDED_SIDE) return { error: '', warning: '图片尺寸偏小，生成的图标可能模糊' }
  return { error: '', warning: '' }
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
