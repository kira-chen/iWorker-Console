/**
 * 差异比对 + 报告生成
 * ==========================================================================
 * 输入：两侧（原型 / 现状）的采集结果
 * 输出：① 主差异表（Markdown 文本）② 豁免命中小节 ③ 豁免自证统计
 *       ④ 机器可读 JSON（便于下一轮跟上一轮对比，看差异是变多还是变少）
 */

import { COLLECTED_PROPS } from './collect.js'
import { matchExemption, auditExemptions } from './exemptions.js'

/**
 * 严格模式：保留 y/height 差异（默认滤除，理由见 isIrrelevant 的 (f)）。
 * 用法：npm run audit:pixel -- --strict
 */
const STRICT = process.argv.includes('--strict')

/**
 * 值归一：把不影响观感的写法差异抹平，避免刷屏式假差异。
 * - 颜色：rgb(0, 0, 0) / rgba(0,0,0,1) 统一成 rgb(0,0,0)；全透明统一成 transparent
 * - 长度：'0px' 与 '0' 统一；小数抹到 0.5px（浏览器光栅化会给出 11.9998px 这种）
 * - normal/auto 这类关键字原样保留
 */
export function normalize (prop, raw) {
  let v = String(raw == null ? '' : raw).trim()
  if (!v) return ''

  // 颜色：统一成 rgb()/rgba() 的紧凑写法
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(v)
  if (rgba) {
    const parts = rgba[1].split(',').map((s) => s.trim())
    const [r, g, b] = parts
    const a = parts.length > 3 ? Number(parts[3]) : 1
    if (a === 0) return 'transparent'
    return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`
  }

  // 长度：抹到 0.5px 精度（光栅化噪声不算差异）
  const pxv = /^(-?\d+(?:\.\d+)?)px$/.exec(v)
  if (pxv) {
    const n = Math.round(Number(pxv[1]) * 2) / 2
    return n === 0 ? '0' : `${n}px`
  }
  if (v === '0') return '0'

  // 字重：normal/bold 与数字互认
  if (prop === 'font-weight') {
    if (v === 'normal') return '400'
    if (v === 'bold') return '700'
  }
  return v
}

/**
 * 判断一条属性是否算「有差异」。
 * 几何属性（x/y/width/height）允许 tolerancePx 容差——两边是不同的渲染引擎路径，
 * 1px 级抖动逐条报出来只会淹没真问题。盒模型属性（padding/border 等）不给容差。
 */
function isDifferent (prop, protoVal, appVal, tolerancePx) {
  const p = normalize(prop, protoVal)
  const a = normalize(prop, appVal)
  if (p === a) return false

  const GEOM = ['x', 'y', 'width', 'height']
  if (GEOM.includes(prop) && tolerancePx > 0) {
    const pn = parseFloat(p)
    const an = parseFloat(a)
    if (Number.isFinite(pn) && Number.isFinite(an) && Math.abs(pn - an) <= tolerancePx) return false
  }

  // 近似色：每个通道差 ≤2 视为同色。
  // 站内令牌是从原型取色后按设计规范落的整数值，常见 rgb(221,228,224) vs
  // 原型 rgb(223,229,225) 这种一两级的差 —— 屏幕上分辨不出来，报出来只是噪声。
  // 差得多的（比如整体色相不同、或一边透明）仍然照报。
  if (/color$/.test(prop)) {
    const near = nearColor(p, a, 2)
    if (near) return false
  }
  return true
}

/** 两个 rgb()/rgba() 是否逐通道都差在 delta 以内（alpha 必须相同） */
function nearColor (p, a, delta) {
  const parse = (s) => {
    const m = /^rgba?\(([-\d.]+),([-\d.]+),([-\d.]+)(?:,([\d.]+))?\)$/.exec(String(s).replace(/\s/g, ''))
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null
  }
  const pc = parse(p); const ac = parse(a)
  if (!pc || !ac) return false
  if (Math.abs(pc[3] - ac[3]) > 0.01) return false
  return Math.abs(pc[0] - ac[0]) <= delta &&
         Math.abs(pc[1] - ac[1]) <= delta &&
         Math.abs(pc[2] - ac[2]) <= delta
}

/**
 * 「这条差异其实没有意义」的判定 —— 属性无关差异（irrelevant diff）。
 * ==========================================================================
 * 这不是豁免（豁免 = 真差异但不改），而是【这条差异在视觉上根本不存在】，
 * 报出来纯属噪声，会淹没真问题。首轮实跑 45 条主差异里有 30 多条是这种。
 *
 * 三类：
 *  (a) 边框宽度是 0 时的 border-color —— CSS 里没设边框色就取 currentColor，
 *      于是「原型文字色 vs 我们文字色」被当成四条边框色差异报出来。
 *      边框宽度都是 0，这四条颜色一个像素都画不出来。
 *  (b) 非 flex/grid 容器上的 gap —— 不生效。原型读出 'normal'，我们读出 '24px'，
 *      但两边都不会因此挪动一个像素。
 *  (c) line-height: 'normal' vs 具体 px —— 只有在这个元素【自己有文字】时才有意义。
 *      纯布局容器（div 套 div）上的 line-height 差异不产生视觉差。
 */
function isIrrelevant (prop, protoBox, appBox) {
  // (a) 边框色：两侧对应边的宽度都是 0 → 这条颜色画不出来
  const borderColor = /^border-(top|right|bottom|left)-color$/.exec(prop)
  if (borderColor) {
    const side = borderColor[1]
    const pw = parseFloat(normalize('w', protoBox[`border-${side}-width`])) || 0
    const aw = parseFloat(normalize('w', appBox[`border-${side}-width`])) || 0
    if (pw === 0 && aw === 0) return true
  }

  // (b) gap：①两侧都不是 flex/grid 就不生效；②只有一侧是 flex/grid —— 这是
  //     「子元素间距记在谁头上」的写法差异（原型用子元素 margin-bottom，我们用
  //     父容器 gap），子元素的实际位置仍由各自条目的 x/y 比对兜底，故不算差异。
  if (['gap', 'row-gap', 'column-gap'].includes(prop)) {
    const isLayout = (box) => /flex|grid/.test(String(box.display || ''))
    if (!isLayout(protoBox) || !isLayout(appBox)) return true
  }

  // (c) line-height：容器自身没有直接文字节点时无视觉意义
  if (prop === 'line-height') {
    if (!protoBox.__hasText && !appBox.__hasText) return true
  }

  // (d) color：同上，元素自身没有直接文字就不产生视觉差
  if (prop === 'color') {
    if (!protoBox.__hasText && !appBox.__hasText) return true
  }

  // ------------------------------------------------------------------
  // (e) 【殊途同归】padding / margin 写法不同，但外框几何完全一致
  // ------------------------------------------------------------------
  // 实跑发现的第四类噪声：原型把留白放在【外层】容器的 padding 上，
  // 我们放在【内层】容器的 padding 上。两边最终的 x/y/宽高一模一样，
  // 只是「留白记在谁头上」不同 —— 屏幕上一个像素的差别都没有。
  //
  // 实例：岗位详情面板根，原型 .pd2-content 带 padding 22px 28px 42px、
  // .pd2-pane 自己 padding 0；我们 .pd-pane 自带 padding 20px/40px。
  // 两边实测都是 x=312 / width=1180，完全对齐，但逐属性比会报出
  // padding-top / padding-bottom / margin-left / margin-right 四条假差异，
  // ×5 个页签 = 20 条噪声。
  //
  // 判定：这个容器的 x/y/宽高【四项全都一致】时，它的 padding/margin
  // 差异不影响自身外框，降级为无关差异。
  // 注意：内部子元素的位置仍然会被各自的容器条目单独比到，所以这样过滤
  // 不会漏掉「内距变了导致里面的东西挪位」——那种情况子元素的 x/y 会报出来。
  // 判定基准只取【横向】x/width：纵向 y/height 受数据条数影响（见下方 (f)），
  // 把它们纳入判定会让本规则几乎永远不成立 —— 实测「面板根」的这四条假差异
  // 在 6 个页签各重复一次，正是被 y 挡住导致的。横向一致即可证明留白等价。
  if (/^(padding|margin)-/.test(prop)) {
    const sameBox = ['x', 'width'].every(
      (k) => normalize(k, protoBox[k]) === normalize(k, appBox[k])
    )
    if (sameBox) return true
  }

  // ------------------------------------------------------------------
  // (f) 【数据量差异】纵向几何 y / height
  // ------------------------------------------------------------------
  // 两边 mock 种子不同（原型 3 条采集字段、我们 2 条；知识库行数与文案长度也不同），
  // 内容一多一少，容器高度和后续元素的 y 必然不同 —— 这是数据差异，不是样式缺陷。
  // 而真正的样式问题会体现在【横向几何】(x/width) 与盒模型属性上：
  // 栏宽窄了 102px、描边色不对、卡头内距不对，都不受数据条数影响。
  //
  // 依据：2026-09-10 首轮实跑 194 条主差异里，人格页签独占 26 条，而人格页签
  // 恰恰是负责人认可「已对齐」的样例 —— 逐条看下来全是 y/height 与由此派生的
  // 噪声。若不滤掉，真差异会被淹没，工具就失去意义（报告没人看 = 白做）。
  //
  // 代价与兜底：若某天真出现「高度写死错了」这类纵向样式 bug，本规则会漏报。
  // 兜底是 height 的显式写死值（min-height/max-height）仍在采集范围内单独比对，
  // 且横向几何与盒模型属性不受影响。需要查纵向问题时，用 --strict 关掉本规则。
  if (['y', 'height'].includes(prop) && !STRICT) return true

  return false
}


/**
 * 比对一个审计单元的两侧采集结果。
 * @returns {{ diffs: Array, exempted: Array, missing: Array, notes: string[] }}
 */
export function diffUnit (unitName, protoResult, appResult, { tolerancePx = 1 } = {}) {
  const diffs = []
  const exempted = []
  const missing = []
  let irrelevantCount = 0

  const protoBoxes = protoResult.boxes || {}
  const appBoxes = appResult.boxes || {}

  // 容器全集：两侧任一有的都要过一遍，这样「某侧根本没这个容器」也报得出来
  const containers = Array.from(new Set([...Object.keys(protoBoxes), ...Object.keys(appBoxes)]))

  for (const container of containers) {
    const p = protoBoxes[container]
    const a = appBoxes[container]

    // 某一侧容器没命中：这是比「属性值不同」更严重的信号（选择器写错，或结构真的缺了），
    // 单独归到 missing，不混进属性差异表。
    if (!p || p.__missing || !a || a.__missing) {
      missing.push({
        unit: unitName,
        container,
        protoFound: !!(p && !p.__missing),
        appFound: !!(a && !a.__missing)
      })
      continue
    }

    for (const prop of COLLECTED_PROPS) {
      if (!isDifferent(prop, p[prop], a[prop], tolerancePx)) continue
      // 属性无关差异：视觉上不存在的差异不进任何一张表，只计数（见 isIrrelevant 注释）
      if (isIrrelevant(prop, p, a)) { irrelevantCount++; continue }
      const diff = {
        unit: unitName,
        container,
        prop,
        proto: normalize(prop, p[prop]),
        app: normalize(prop, a[prop]),
        selectorProto: protoResult.selectors?.[container] || '',
        selectorApp: appResult.selectors?.[container] || ''
      }
      const ex = matchExemption(diff)
      if (ex) exempted.push({ ...diff, exemptionId: ex.id, exemptionTitle: ex.title })
      else diffs.push(diff)
    }
  }

  return {
    diffs,
    exempted,
    missing,
    irrelevantCount,
    notes: [...(protoResult.notes || []), ...(appResult.notes || [])]
  }
}

/** Markdown 表格转义：竖线会截断单元格 */
function esc (s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|')
}

/**
 * 生成完整报告（Markdown 文本）。
 * @param {Array} unitResults  每项 { unit, diffs, exempted, missing, notes, error? }
 */
export function renderReport (unitResults, meta = {}) {
  const L = []
  const totalDiffs = unitResults.reduce((n, u) => n + (u.diffs?.length || 0), 0)
  const totalExempt = unitResults.reduce((n, u) => n + (u.exempted?.length || 0), 0)
  const totalMissing = unitResults.reduce((n, u) => n + (u.missing?.length || 0), 0)
  const totalIrrelevant = unitResults.reduce((n, u) => n + (u.irrelevantCount || 0), 0)
  const errored = unitResults.filter((u) => u.error)

  L.push('# 像素级对齐差异报告（pixel-audit）')
  L.push('')
  L.push(`- 跑批时间：${meta.startedAt || new Date().toISOString()}`)
  L.push(`- 审计单元：${unitResults.length} 个${meta.filter ? `（--unit=${meta.filter}）` : ''}`)
  L.push(`- **主差异：${totalDiffs} 条**（需要处理的）`)
  L.push(`- 已豁免：${totalExempt} 条（负责人已拍板不改，见文末豁免节）`)
  L.push(`- 已滤除的属性无关差异：${totalIrrelevant} 条（0 宽边框的颜色、非 flex 容器的 gap、无文字容器的行高/字色 —— 视觉上不存在，不必看）`)
  L.push(`- 容器未命中：${totalMissing} 条`)
  if (errored.length) L.push(`- ⚠️ 跑挂的单元：${errored.length} 个`)
  L.push('')

  // ---------- 一、主差异表 ----------
  L.push('## 一、主差异表')
  L.push('')
  if (totalDiffs === 0) {
    L.push('主差异表为空 —— 本轮所抓容器的盒模型与原型逐项一致（豁免项另计）。')
    L.push('')
  } else {
    for (const u of unitResults) {
      if (!u.diffs?.length) continue
      L.push(`### ${u.unit}（${u.diffs.length} 条）`)
      L.push('')
      L.push('| 容器 | 属性 | 原型值 | 现状值 |')
      L.push('| --- | --- | --- | --- |')
      for (const d of u.diffs) {
        L.push(`| ${esc(d.container)} | ${esc(d.prop)} | ${esc(d.proto)} | ${esc(d.app)} |`)
      }
      L.push('')
    }
  }

  // ---------- 二、容器未命中 ----------
  L.push('## 二、容器未命中')
  L.push('')
  if (totalMissing === 0) {
    L.push('无。两侧容器映射表全部命中。')
    L.push('')
  } else {
    L.push('> 未命中 = 选择器没抓到，或那一侧结构里确实没有这个容器。')
    L.push('> **先怀疑选择器（尤其是隐藏 pane 那个坑），再怀疑结构。**')
    L.push('')
    L.push('| 单元 | 容器 | 原型侧 | 现状侧 |')
    L.push('| --- | --- | --- | --- |')
    for (const u of unitResults) {
      for (const m of u.missing || []) {
        L.push(`| ${esc(u.unit)} | ${esc(m.container)} | ${m.protoFound ? '命中' : '**未命中**'} | ${m.appFound ? '命中' : '**未命中**'} |`)
      }
    }
    L.push('')
  }

  // ---------- 三、跑挂的单元 ----------
  if (errored.length) {
    L.push('## 三、跑挂的单元')
    L.push('')
    for (const u of errored) {
      L.push(`- **${u.unit}**：${u.error}`)
    }
    L.push('')
  }

  // ---------- 四、豁免命中 ----------
  L.push('## 四、豁免命中（负责人已拍板不改，不进主差异表）')
  L.push('')
  if (totalExempt === 0) {
    L.push('本轮没有任何差异命中豁免。')
    L.push('')
  } else {
    const byEx = new Map()
    for (const u of unitResults) {
      for (const e of u.exempted || []) {
        if (!byEx.has(e.exemptionId)) byEx.set(e.exemptionId, [])
        byEx.get(e.exemptionId).push({ ...e, unit: u.unit })
      }
    }
    for (const [id, items] of byEx) {
      L.push(`### ${id} · ${esc(items[0].exemptionTitle)}（命中 ${items.length} 条）`)
      L.push('')
      L.push('| 单元 | 容器 | 属性 | 原型值 | 现状值 |')
      L.push('| --- | --- | --- | --- | --- |')
      for (const e of items) {
        L.push(`| ${esc(e.unit)} | ${esc(e.container)} | ${esc(e.prop)} | ${esc(e.proto)} | ${esc(e.app)} |`)
      }
      L.push('')
    }
  }

  // ---------- 五、豁免自证 ----------
  const hitCounts = new Map()
  for (const u of unitResults) {
    for (const e of u.exempted || []) {
      hitCounts.set(e.exemptionId, (hitCounts.get(e.exemptionId) || 0) + 1)
    }
  }
  const audit = auditExemptions(hitCounts)

  L.push('## 五、豁免自证统计')
  L.push('')
  L.push('> 豁免不是永久静默：每条都要能证明自己这一轮确实拦下了东西。')
  L.push('> **0 命中的必须复核** —— 要么差异本身已经没了（该删这条豁免），')
  L.push('> 要么本轮跑的单元没覆盖到它管的地方（该扩配置）。')
  L.push('')
  L.push('| 豁免 | 标题 | 裁决日期 | 裁决人 | 出处 | 本轮命中 | 结论 |')
  L.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const a of audit) {
    const verdict = a.stale ? '⚠️ **可能已失效/多余，请复核**' : '有效'
    L.push(`| ${a.id} | ${esc(a.title)} | ${a.decidedOn} | ${a.decidedBy} | ${esc(a.source)} | ${a.hits} | ${verdict} |`)
  }
  L.push('')
  const stale = audit.filter((a) => a.stale)
  if (stale.length) {
    L.push(`**⚠️ ${stale.length} 条豁免本轮 0 命中：${stale.map((s) => s.id).join('、')}。请复核后决定删除或扩大跑批范围。**`)
    L.push('')
  }

  // ---------- 六、采集说明 ----------
  const allNotes = Array.from(new Set(unitResults.flatMap((u) => u.notes || [])))
  if (allNotes.length) {
    L.push('## 六、采集说明（探针在本轮做的特殊处理）')
    L.push('')
    for (const n of allNotes) L.push(`- ${n}`)
    L.push('')
  }

  return L.join('\n')
}

/**
 * 生成机器可读 JSON（便于下一轮跟上一轮对比）。
 *
 * 【为什么 meta 与 body 分开】
 * 工具的价值建立在「同样的代码跑出同样的结果」上——结果会漂移的检查器，
 * 报出来的差异没人敢信。所以除 meta（跑批时间等每次必然不同的信息）外，
 * 其余内容必须逐字节可复现。校验办法（README 有写）：
 *   npm run audit:pixel && cp out/report.json /tmp/a.json
 *   npm run audit:pixel && node -e "const a=require('/tmp/a.json'),b=require('./tools/pixel-audit/out/report.json');
 *     const s=o=>JSON.stringify({...o,meta:undefined});
 *     console.log(s(a)===s(b)?'STABLE':'DRIFT')"
 * 2026-09-10 实测：连跑两次除 meta.startedAt 外逐字节一致（194/28/0/184/0）。
 * 若哪天出现 DRIFT，多半是探针又踩到了懒渲染/隐藏容器时机（见 README 三个坑），
 * 应先修工具再信报告。
 */
export function renderJson (unitResults, meta = {}) {
  const hitCounts = new Map()
  for (const u of unitResults) {
    for (const e of u.exempted || []) {
      hitCounts.set(e.exemptionId, (hitCounts.get(e.exemptionId) || 0) + 1)
    }
  }
  return {
    meta: {
      startedAt: meta.startedAt || new Date().toISOString(),
      filter: meta.filter || null,
      unitCount: unitResults.length
    },
    summary: {
      diffs: unitResults.reduce((n, u) => n + (u.diffs?.length || 0), 0),
      exempted: unitResults.reduce((n, u) => n + (u.exempted?.length || 0), 0),
      missing: unitResults.reduce((n, u) => n + (u.missing?.length || 0), 0),
      irrelevant: unitResults.reduce((n, u) => n + (u.irrelevantCount || 0), 0),
      errors: unitResults.filter((u) => u.error).length
    },
    units: unitResults.map((u) => ({
      unit: u.unit,
      error: u.error || null,
      diffs: u.diffs || [],
      exempted: u.exempted || [],
      missing: u.missing || [],
      irrelevantCount: u.irrelevantCount || 0,
      notes: u.notes || []
    })),
    exemptionAudit: auditExemptions(hitCounts)
  }
}
