/**
 * 驾驶舱「使用情况」页签的数值展示（PRD prd.驾驶舱.md 第五～七节）。
 */

/** Token 数缩写：≥ 100 万用 M、≥ 1 千用 K（各 1 位小数），其余原样；空值给 "—"。 */
export function fmtTokens(n) {
  if (n == null) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

/** 千分位整数；空值给 "—"。 */
export function fmtCount(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US')
}

/** 百分比（1 位小数）；null 表示「没有可算的数据」，展示 "—"。 */
export function fmtPct(v) {
  return v == null ? '—' : `${v.toFixed(1)}%`
}

/**
 * 较上一周期的变化：null → "—"，0 → "持平"，否则 "↑ 5.2%" / "↓ 3.1 个百分点"。
 * 用量类指标传 unit='%'（相对变化），比率类指标（失败率、点踩率）传 unit=' 个百分点'（差值）。
 */
export function fmtChange(v, unit = '%') {
  if (v == null) return '—'
  if (v === 0) return '持平'
  return `${v > 0 ? '↑' : '↓'} ${Math.abs(v)}${unit}`
}

/** 首响耗时「P50 / P95」，如 "1.2s / 4.8s"。 */
export function fmtLatency(p50, p95) {
  return p50 == null ? '—' : `${p50.toFixed(1)}s / ${p95.toFixed(1)}s`
}

/** 趋势图纵轴取整上界：向上取到 1 / 2 / 5 × 10^n，保证网格线刻度好读。 */
export function niceMax(max) {
  if (!(max > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  const f = max / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * exp
}
