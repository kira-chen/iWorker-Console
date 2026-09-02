import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'element-plus/dist/index.css'
import '@/assets/tokens.css'
import '@/assets/theme.css'
import tokensRaw from '@/assets/tokens.css?raw'
import themeRaw from '@/assets/theme.css?raw'

/**
 * 视觉效果守卫 · 主题令牌总闸（真浏览器，双主题，2026-08-08 扩充批）。
 *
 * Notion 双主题体系 = tokens.css（design tokens 单一真相）+ theme.css（EP 变量映射）。
 * 展示端历史事故里有一整类根因是令牌层松动：token 改名/删除后引用侧 var() 静默解析为空、
 * 表面色被改成半透明（固定列透底的根因形态）、暗色可读性回退。三类各设一道断言：
 *
 *  1. 引用完整性：两个样式文件里全部 var(--x) 引用（含 fallback 形态里的引用），在双主题下
 *     都必须解析出非空值——token 改名漏改引用侧即红；
 *  2. 表面不透明契约：--bg-app/surface/elevated/sunken 是「承载内容的表面」，必须完全不透明
 *     （半透明表面 = sticky/fixed 元素透底这类 bug 的温床；--bg-hover/active 半透明是有意设计，不在此列）；
 *  3. 关键对比度（WCAG 口径）：正文/次级文本对表面 ≥ 4.5/3，强调色对其浅填充 ≥ 3——
 *     暗色主题「看不清」类回退在 CI 即红。
 */

/** 从两份样式源码里抽出全部被引用的自定义属性名（含 var(--a, var(--b)) 嵌套里的每一个）。 */
function referencedTokens() {
  const names = new Set()
  for (const src of [tokensRaw, themeRaw]) {
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
      names.add(m[1])
    }
  }
  return [...names]
}

/** 探针元素读取任意 CSS 表达式的计算色值。 */
function computedColor(expr) {
  const probe = document.createElement('div')
  probe.style.color = expr
  document.body.appendChild(probe)
  const v = getComputedStyle(probe).color
  probe.remove()
  return v
}

function parseRgb(cssColor) {
  const m = cssColor.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b, a = 1] = m[1].split(',').map((s) => parseFloat(s))
  return { r, g, b, a }
}

/** WCAG 相对亮度 + 对比度。 */
function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function tokenValue(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

describe.each(['light', 'dark'])('主题令牌总闸 · %s', (theme) => {
  // 同 tableFixedColumnOpacity（2026-08-24 修间歇性假红）：describe.each 的两个 beforeAll 在
  // 文件加载期一并注册，light/dark 可能互相抢跑覆盖 <html> 上的 data-theme。
  // 改 beforeEach 紧贴用例执行 + afterEach 清理全局态，避免污染同 worker 内后续文件。
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', theme)
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('引用完整性：tokens.css/theme.css 里每个 var(--x) 都解析出非空值', () => {
    const missing = referencedTokens().filter((name) => tokenValue(name) === '')
    expect(missing).toEqual([])
  })

  it('表面不透明契约：bg-app/surface/elevated/sunken 必须完全不透明（alpha=1）', () => {
    for (const name of ['--bg-app', '--bg-surface', '--bg-elevated', '--bg-sunken']) {
      const rgb = parseRgb(computedColor(`var(${name})`))
      expect(rgb, `${name} 应可解析为颜色`).toBeTruthy()
      expect(rgb.a, `${name} 必须不透明（半透明表面是 sticky 透底类 bug 的温床）`).toBe(1)
    }
  })

  it('关键对比度：正文 ≥4.5、次级 ≥3（对表面色）；强调色对浅填充 ≥3', () => {
    const surface = parseRgb(computedColor('var(--bg-surface)'))
    const text = parseRgb(computedColor('var(--c-text)'))
    const muted = parseRgb(computedColor('var(--c-text-muted)'))
    const accent = parseRgb(computedColor('var(--c-accent)'))
    const accentFill = parseRgb(computedColor('var(--c-accent-fill)'))

    expect(contrast(text, surface), '正文对表面（WCAG AA 正文）').toBeGreaterThanOrEqual(4.5)
    expect(contrast(muted, surface), '次级文本对表面（WCAG AA 大字/UI）').toBeGreaterThanOrEqual(3)
    expect(contrast(accent, accentFill), '强调色对其浅填充（plain 按钮/标签可辨）').toBeGreaterThanOrEqual(3)
  })
})
