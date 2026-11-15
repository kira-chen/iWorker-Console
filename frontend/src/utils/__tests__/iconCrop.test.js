// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ICON_MAX_BYTES,
  ICON_OUTPUT_SIZE,
  ICON_MIN_SIDE,
  ICON_RECOMMENDED_SIDE,
  ICON_UPLOAD_HINT,
  validateIconFile,
  isSvgIcon,
  checkIconDimensions,
  coverScale,
  clampOffset,
  centerOffset,
  zoomAroundCenter,
  sourceRect,
  cropToPngDataUrl
} from '@/utils/iconCrop'

/**
 * PRD「图标统一规则」纯逻辑层契约（2026-09-02 全站拍板）。
 * 2026-09-12 补 md 出处：docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家.md §三.2 基本信息「图标配置统一规则」
 * 之「上传图标」条（格式 PNG/JPG/JPEG/WebP/GIF/SVG、≤5 MB、方形裁剪 + 缩放、【使用该区域】生成 256×256 PNG）
 * 与「异常处理」条（"请选择图片文件"/"图片不能超过 5 MB"）；技能 §三.4 / 模型 §三.2 引同一规则。
 * 1. 类型/大小校验与逐字文案：「请选择图片文件」「图片不能超过 5 MB」；
 * 2. cover 裁剪几何：铺满视口、位移夹取、缩放保持中心、源区换算；
 * 3. cropToPngDataUrl 恒输出 256×256 PNG。
 * 4. 2026-11-10 产品优化需求-202611 修改点 16（R12）原图尺寸：短边 < 128 不可用（逐字「图片尺寸过小，请上传不小于 128×128 的图片」）、
 *    128–255 可用但提示「图片尺寸偏小，生成的图标可能模糊」、≥ 256 无提示、SVG 不受限；常驻提示文案逐字。
 *    尺寸判断是纯函数入参（原图宽高数字），不涉及 DOM 排版。
 */

describe('validateIconFile（类型/大小校验，逐字文案）', () => {
  const f = (type, name, size = 100) => ({ type, name, size })

  it('PNG/JPG/JPEG/WebP/GIF/SVG（MIME）均通过', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
      expect(validateIconFile(f(t, 'a'))).toBe('')
    }
  })

  it('MIME 缺失时按后缀兜底通过', () => {
    for (const n of ['a.png', 'a.jpg', 'a.JPEG', 'a.webp', 'a.gif', 'a.svg']) {
      expect(validateIconFile(f('', n))).toBe('')
    }
  })

  it('非图片文件 → 「请选择图片文件」', () => {
    expect(validateIconFile(f('text/plain', 'a.txt'))).toBe('请选择图片文件')
    expect(validateIconFile(f('application/pdf', 'a.pdf'))).toBe('请选择图片文件')
    expect(validateIconFile(null)).toBe('请选择图片文件')
  })

  it('超过 5MB → 「图片不能超过 5 MB」；恰为 5MB 放行', () => {
    expect(validateIconFile(f('image/png', 'a.png', ICON_MAX_BYTES + 1))).toBe('图片不能超过 5 MB')
    expect(validateIconFile(f('image/png', 'a.png', ICON_MAX_BYTES))).toBe('')
    expect(ICON_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('原图尺寸校验（R12，最小 128 / 建议 256）', () => {
  it('阈值取 PRD 值：最小 128、建议 256', () => {
    expect(ICON_MIN_SIDE).toBe(128)
    expect(ICON_RECOMMENDED_SIDE).toBe(256)
  })

  it('短边 < 128 → 不可用，逐字「图片尺寸过小，请上传不小于 128×128 的图片」（宽或高任一边不足都算）', () => {
    const tooSmall = { error: '图片尺寸过小，请上传不小于 128×128 的图片', warning: '' }
    expect(checkIconDimensions(127, 127)).toEqual(tooSmall)
    expect(checkIconDimensions(1024, 127)).toEqual(tooSmall)
    expect(checkIconDimensions(100, 800)).toEqual(tooSmall)
  })

  it('短边 128–255 → 可用，提示「图片尺寸偏小，生成的图标可能模糊」', () => {
    const small = { error: '', warning: '图片尺寸偏小，生成的图标可能模糊' }
    expect(checkIconDimensions(128, 128)).toEqual(small)
    expect(checkIconDimensions(255, 600)).toEqual(small)
  })

  it('短边 ≥ 256 → 可用且无提示', () => {
    expect(checkIconDimensions(256, 256)).toEqual({ error: '', warning: '' })
    expect(checkIconDimensions(1920, 1080)).toEqual({ error: '', warning: '' })
  })

  it('SVG 不受尺寸限制：再小也不报错、不提示', () => {
    expect(checkIconDimensions(16, 16, { svg: true })).toEqual({ error: '', warning: '' })
    expect(checkIconDimensions(200, 200, { svg: true })).toEqual({ error: '', warning: '' })
  })

  it('isSvgIcon：MIME 为 image/svg+xml 或后缀 .svg 即 SVG，其余不是', () => {
    expect(isSvgIcon({ type: 'image/svg+xml', name: 'a' })).toBe(true)
    expect(isSvgIcon({ type: '', name: 'logo.SVG' })).toBe(true)
    expect(isSvgIcon({ type: 'image/png', name: 'a.png' })).toBe(false)
    expect(isSvgIcon(null)).toBe(false)
  })

  it('【上传图标】旁常驻提示文案逐字', () => {
    expect(ICON_UPLOAD_HINT).toBe('支持 PNG、JPG、WebP、GIF、SVG，不超过 5 MB，建议 1:1、不小于 256×256')
  })
})

describe('裁剪几何（cover 视口模型）', () => {
  const V = 280

  it('coverScale：短边恰好铺满视口', () => {
    expect(coverScale(560, 280, V)).toBe(1) // 短边 280
    expect(coverScale(140, 700, V)).toBe(2) // 短边 140
  })

  it('clampOffset：位移限制在 [viewport - disp, 0]', () => {
    // 560×280 @1x：disp 560×280 → x ∈ [-280, 0]，y 恒 0
    expect(clampOffset(-999, -5, 560, 280, 1, V)).toEqual({ x: -280, y: 0 })
    expect(clampOffset(10, 10, 560, 280, 1, V)).toEqual({ x: 0, y: 0 })
  })

  it('centerOffset：图片居中', () => {
    expect(centerOffset(560, 280, 1, V)).toEqual({ x: -140, y: 0 })
  })

  it('zoomAroundCenter：缩放前后视口中心对应的源点不变', () => {
    const s1 = 1
    const s2 = 2
    const off = { x: -100, y: -40 }
    const next = zoomAroundCenter(off, s1, s2, V)
    // 中心源点：( V/2 - off ) / s 不变
    expect((V / 2 - next.x) / s2).toBeCloseTo((V / 2 - off.x) / s1)
    expect((V / 2 - next.y) / s2).toBeCloseTo((V / 2 - off.y) / s1)
  })

  it('sourceRect：位移/缩放 → 源图正方形选区', () => {
    const r1 = sourceRect({ x: -140, y: 0 }, 1, V)
    expect(r1.sx).toBe(140)
    expect(r1.sy).toBeCloseTo(0) // -0 与 0 数值等价
    expect(r1.sw).toBe(280)
    expect(r1.sh).toBe(280)
    expect(sourceRect({ x: -70, y: -35 }, 2, V)).toEqual({ sx: 35, sy: 17.5, sw: 140, sh: 140 })
  })
})

describe('cropToPngDataUrl（256×256 PNG 输出）', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockCanvas() {
    const ctx = { drawImage: vi.fn() }
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx), toDataURL: vi.fn(() => 'data:image/png;base64,TEST') }
    const orig = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : orig(tag)))
    return { canvas, ctx }
  }

  it('默认输出 256×256，drawImage 选区透传，toDataURL 为 image/png', () => {
    const { canvas, ctx } = mockCanvas()
    const img = {}
    const rect = { sx: 10, sy: 20, sw: 100, sh: 100 }
    const url = cropToPngDataUrl(img, rect)
    expect(canvas.width).toBe(ICON_OUTPUT_SIZE)
    expect(canvas.height).toBe(ICON_OUTPUT_SIZE)
    expect(ICON_OUTPUT_SIZE).toBe(256)
    expect(ctx.drawImage).toHaveBeenCalledWith(img, 10, 20, 100, 100, 0, 0, 256, 256)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
    expect(url).toBe('data:image/png;base64,TEST')
  })

  it('canvas 不可用时抛错（由组件层兜底提示）', () => {
    const orig = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      tag === 'canvas' ? { getContext: () => null } : orig(tag)
    )
    expect(() => cropToPngDataUrl({}, { sx: 0, sy: 0, sw: 1, sh: 1 })).toThrow()
  })
})
