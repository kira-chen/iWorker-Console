/**
 * MCP 真实运行时——连接态映射与工具拉取合并规则（接口契约 §1.3 / §4）。
 * 纯函数，无副作用，供 AdminMcp / McpEditor 复用并单测覆盖。
 */

/**
 * 三态连接标签映射（契约 §1.3）。
 * ok → success/连接正常；failed → danger/连接异常；unknown / 缺省 → info/未探测。
 * 该标签仅表示最近探测结果，不代表运行时放行（放行看 status=active）。
 */
const CONN_META = {
  ok: { tag: 'success', label: '连接正常' },
  failed: { tag: 'danger', label: '连接异常' },
  unknown: { tag: 'info', label: '未探测' }
}

export function connMeta(connStatus) {
  return CONN_META[connStatus] || CONN_META.unknown
}

/* ============================ 检活四态（切片3a，契约 §4.1 / §5.1） ============================ */
// 工具列表/详情统一下发 displayStatus 四态：DISABLED|UNKNOWN|HEALTHY|UNHEALTHY。
// 前端不自拼优先级，直接消费后端 displayStatus；后端未补该字段时（联调过渡）由
// 旧三态 connStatus + status 派生兜底（DISABLED 盖过检活态），保证零回归 + 前向兼容。
const STATUS_TO_DISPLAY = { ok: 'HEALTHY', failed: 'UNHEALTHY', unknown: 'UNKNOWN' }

/**
 * 归一某行/某工具的 displayStatus 四态。
 * 优先取后端 displayStatus（契约权威）；缺省时：status=disabled/inactive → DISABLED，
 * 否则按旧 connStatus 三态映射，再缺省 UNKNOWN。
 * @param {Object} row 工具行（可能含 displayStatus / status / connStatus）
 * @returns {'HEALTHY'|'UNHEALTHY'|'UNKNOWN'|'DISABLED'}
 */
export function resolveDisplayStatus(row) {
  const r = row || {}
  const ds = r.displayStatus || r.checkStatus
  if (ds === 'HEALTHY' || ds === 'UNHEALTHY' || ds === 'UNKNOWN' || ds === 'DISABLED') return ds
  // 派生兜底
  if (r.status === 'disabled' || r.status === 'inactive') return 'DISABLED'
  return STATUS_TO_DISPLAY[r.connStatus] || 'UNKNOWN'
}

/**
 * 行是否需要红点提示（契约 §4.1：redDot=true ⇔ displayStatus=UNHEALTHY）。
 * 优先取后端 redDot；缺省时由归一后的四态推导。
 */
export function isRedDot(row) {
  const r = row || {}
  if (typeof r.redDot === 'boolean') return r.redDot
  return resolveDisplayStatus(r) === 'UNHEALTHY'
}

/**
 * 统计一组工具行中需红点（UNHEALTHY）的数量（页头/Tab 角标用）。
 */
export function countUnhealthy(rows) {
  return (rows || []).reduce((n, r) => (isRedDot(r) ? n + 1 : n), 0)
}

/* ============================ 使用统计格式化（MCP 数据结构扩展 · 展示规格 §3.1.1 D/E） ============================ */
// 列表与抽屉共用的纯函数；除零 / null / NaN / Infinity / ms→s / 千分位 / 百分比一处收口，
// 模板只读判定结果，绝不外泄 NaN/null/Infinity（设计 §4.6 派生指标无样本返回 null）。

/**
 * 入参是否为「可用于格式化的有限数值」。null/undefined/NaN/±Infinity/非数值 一律 false。
 */
function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 调用次数：千分位分组。无效值（null/undefined/NaN/Infinity）→ '0'（次数本身缺省按 0 计）。
 * @param {number} n
 * @returns {string} 如 '1,280' / '0'
 */
export function fmtCount(n) {
  if (!isFiniteNum(n)) return '0'
  return Math.trunc(n).toLocaleString('en-US')
}

/**
 * 平均耗时（ms）：null/无样本 → '—'；<1000ms 显 'X ms'（整数）；≥1000ms 换算 'Y.y s'（保留 1 位）。
 * @param {number|null} ms
 * @returns {string} 如 '820 ms' / '1.4 s' / '—'
 */
export function fmtDuration(ms) {
  if (!isFiniteNum(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/**
 * 成功率（0~1 小数）：null/无样本 → '—'；整百显 '100%'（不补 .0）；否则保留 1 位小数 + '%'。
 * 不染色（健康度交给 line1 HealthTag）。越界值（>1/<0）按裁剪后展示，杜绝异常外泄。
 * @param {number|null} rate
 * @returns {string} 如 '99.2%' / '100%' / '0%' / '—'
 */
export function fmtPercent(rate) {
  if (!isFiniteNum(rate)) return '—'
  const pct = Math.min(100, Math.max(0, rate * 100))
  if (Number.isInteger(pct)) return `${pct}%`
  return `${pct.toFixed(1)}%`
}

/**
 * 该行是否有调用记录（callCount>0）。用于列表「暂无调用」收敛判定（§3.1.1 E）。
 * 后端字段未就绪时 callCount 为 undefined → false → 显「暂无调用」，零回归。
 * @param {Object} row
 * @returns {boolean}
 */
export function hasUsage(row) {
  const c = row && row.callCount
  return isFiniteNum(c) && c > 0
}

/**
 * 拉取工具后刷新展示区（工具清单只读化：server 返回即权威全集，契约 §3/§4 同规则）。
 * 以 fetched 为骨架逐工具处理（保 server 返回序）：
 *  - name / description / inputSchema：一律以服务端为准（只读权威字段）。
 *  - writeClass（FDE 唯一可标注字段）按 name 合并：现有标注（含未保存的界面改动）→ 服务端携带值
 *   （已存 = 后端合并结果；草稿 = 后端启发式回填，写类词表单一来源在后端 McpToolsCacheMerger）
 *    → READ 兜底（正常不触发，防御）。
 *  - 服务端本次未返回的现有工具：删除（server 已不提供，不再保留手动占位）。
 *
 * @param {Array} current 展示区现有工具 [{ name, writeClass?, ... }]
 * @param {Array} fetched 服务端返回工具 [{ name, description?, inputSchema?, writeClass? }]
 * @returns {Array} 合并后的工具数组（顺序 = 服务端返回序）
 */
export function mergeFetchedTools(current = [], fetched = []) {
  const currentByName = new Map()
  for (const c of current || []) {
    if (c && c.name != null && c.name !== '') currentByName.set(c.name, c)
  }
  const merged = []
  for (const f of fetched || []) {
    if (!f || f.name == null || f.name === '') continue
    const c = currentByName.get(f.name)
    const cWc = c && (c.writeClass === 'READ' || c.writeClass === 'WRITE') ? c.writeClass : null
    const fWc = f.writeClass === 'READ' || f.writeClass === 'WRITE' ? f.writeClass : null
    merged.push({
      name: f.name,
      description: f.description || '',
      // 2026-09-04 PRD-20260903 对齐：server 显示名 title 随拉取结果透传（工具卡双层标题；无则空串回落代码名）
      title: f.title || '',
      inputSchema: f.inputSchema,
      writeClass: cWc || fWc || 'READ'
    })
  }
  return merged
}
