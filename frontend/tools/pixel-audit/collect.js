/**
 * 盒模型采集器
 * ==========================================================================
 * 在浏览器页面里跑，把一个容器的「盒模型全量属性」抓成一个扁平对象：
 * 位置 / 宽高 / 四边 padding / 四边 margin / 四边 border（宽 + 色）/ 圆角 /
 * 底色 / gap / 字号字重行高。
 *
 * 这里是全工具最重要的一块：三个探针坑全部落在本文件的 resolveOne / collectOne。
 * 每个坑的来历见对应函数上方的注释。
 */

/** 采集哪些 CSS 属性。顺序即报告里的输出顺序。 */
export const COLLECTED_PROPS = [
  // 几何（相对于「审计单元根容器」的坐标，见 collectOne 里的说明）
  'x', 'y', 'width', 'height',
  // 内距
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // 外距
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  // 边框：宽 + 色（只有宽没有色，会漏掉「边框在但颜色不对」这类差异）
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  // 圆角
  'border-radius',
  // 底色 —— 坑 2 的主战场
  'background-color',
  // 间距
  'gap', 'row-gap', 'column-gap',
  // 字
  'font-size', 'font-weight', 'line-height', 'color'
]

/**
 * 注入到浏览器页面里执行的采集函数。
 *
 * 【为什么写成一个自包含的大函数、还用 var】
 * page.evaluate 会把这个函数序列化后丢进浏览器里跑，所以它：
 *   - 不能引用本文件里的任何外部变量（props 只能靠参数传进去）；
 *   - 不能 import 任何东西；
 *   - 里面的所有辅助函数都得写在函数体内部。
 * 看起来不如拆成小模块好看，但这是 evaluate 的硬约束，不是随手写的。
 */
export function collectInPage (args) {
  var props = args.props
  var mapping = args.mapping      // { 语义名: 选择器 }
  var rootSelector = args.rootSelector
  var visibleOnly = args.visibleOnly

  // ------------------------------------------------------------------
  // 【坑 1：隐藏面板陷阱】
  // ------------------------------------------------------------------
  // Element Plus 的 el-tabs 默认把所有页签的 pane 同时渲染在 DOM 里，
  // 只有当前页签那一个是可见的，其余用 display:none 之类藏着。
  // 于是 document.querySelector('.pd-card') 很可能抓到的是【隐藏页签里的
  // 那张卡】——它的 getBoundingClientRect() 宽高全是 0，getComputedStyle
  // 拿到的 padding 也可能是 0 或初始值。
  //
  // 后果不是「少报一条」，而是【整张差异表作废】：所有属性都会显示成
  // 「原型有值 / 现状 0」，看起来像页面全塌了，实际上页面好好的。
  // 2026-09-10 A 路首轮就踩到：搜索框实测 176px 是隐藏 pane 的假读数，
  // 修掉探针后实测与原型逐值一致（见 PRD-review/2026-09-10.md 该批次段）。
  //
  // 解法：先在候选里筛出「有实际尺寸的那一个」再往下查询。
  // ------------------------------------------------------------------
  function hasRealSize (el) {
    var r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    var cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    // 祖先链上有 display:none 的，自身 rect 也会是 0，上面已经拦掉；
    // 这里再拦一道 EP 给隐藏 pane 挂的 aria-hidden。
    if (el.closest('[aria-hidden="true"]')) return false
    return true
  }

  function pickVisible (nodes) {
    var list = Array.prototype.slice.call(nodes)
    if (!visibleOnly) return list[0] || null
    for (var i = 0; i < list.length; i++) {
      if (hasRealSize(list[i])) return list[i]
    }
    return null
  }

  // 根容器：所有坐标都相对它算，这样原型和现状即使整页偏移不同也能比。
  var rootCandidates = rootSelector ? document.querySelectorAll(rootSelector) : [document.body]
  var root = pickVisible(rootCandidates)
  if (!root) {
    return { error: '根容器未命中或不可见：' + rootSelector }
  }
  var rootRect = root.getBoundingClientRect()

  /**
   * 读一个元素的全部属性。
   * @param el    主元素
   * @param outer 可选：外层元素的读数。用于 Element Plus 表格单元格——
   *              内距在 td > .cell 上、而边框与底色在 td 上，两层合起来
   *              才等于原型那一个 td。传入时：padding/宽高/位置取 el（.cell），
   *              border-* 与 background-color 取 outer（td）。
   */
  function readOne (el, outer) {
    var cs = getComputedStyle(el)
    var rect = el.getBoundingClientRect()
    var out = {}
    for (var i = 0; i < props.length; i++) {
      var p = props[i]
      if (p === 'x') out[p] = Math.round(rect.left - rootRect.left) + 'px'
      else if (p === 'y') out[p] = Math.round(rect.top - rootRect.top) + 'px'
      else if (p === 'width') out[p] = Math.round(rect.width) + 'px'
      else if (p === 'height') out[p] = Math.round(rect.height) + 'px'
      else out[p] = cs.getPropertyValue(p).trim()
    }
    // 附带两个「上下文」字段，供 report.js 判断某条差异是否有视觉意义：
    // display —— gap 只在 flex/grid 上生效
    // __hasText —— 元素自己有没有直接的文字节点；没有的话 line-height / color
    //              的差异不产生任何视觉差（纯布局容器）
    out.display = cs.display
    var hasText = false
    for (var k = 0; k < el.childNodes.length; k++) {
      var node = el.childNodes[k]
      if (node.nodeType === 3 && node.textContent.trim()) { hasText = true; break }
    }
    out.__hasText = hasText
    // 合层：边框与底色仍以外层（td）为准，内距/几何用内层（.cell）
    if (outer) {
      for (var m = 0; m < props.length; m++) {
        var q = props[m]
        if (/^border-/.test(q) || q === 'background-color') out[q] = outer[q]
      }
    }
    return out
  }

  // ------------------------------------------------------------------
  // 【坑 2：底色归属陷阱】
  // ------------------------------------------------------------------
  // 表格行底色，原型写在 <tr> 上；Element Plus 写在 <td> 上，而且 EP 的 td
  // 自带一层背景色，会盖住 tr 上的底色——也就是说，就算你在现状的 tr 上
  // 设了底色，肉眼也看不见，实际生效的是 td。
  //
  // 如果只采 tr 比 tr，会得出「原型 tr 有底色、现状 tr 是 transparent」→
  // 报一条「底色丢失」的【假差异】；反过来只采 td 比 td，又会得出
  // 「原型 td 透明、现状 td 有色」→ 报一条假的「多余底色」。
  //
  // 2026-09-10 B 路真正的硬伤（Agent 行底纹一直是哑的，因为代码引用了
  // tokens.css 里根本不存在的 --bg-subtle/--fill-subtle）就是在同时采
  // tr 与 td 之后才辨出来的：两边都 transparent，那才是真丢。
  //
  // 解法：容器选择器命中 tr/td 这类表格行元素时，把 tr 与它第一个 td
  // 都采下来，各自成一行，行名带 [tr] / [td] 后缀，并附一句说明。
  // ------------------------------------------------------------------
  function isTableRowish (el) {
    var tag = el.tagName.toLowerCase()
    return tag === 'tr' || tag === 'td' || tag === 'th'
  }

  var result = {}
  var notes = []
  var names = Object.keys(mapping)
  for (var n = 0; n < names.length; n++) {
    var name = names[n]
    var sel = mapping[name]
    var el = pickVisible(root.querySelectorAll(sel))
    if (!el) {
      result[name] = { __missing: true }
      continue
    }
    if (isTableRowish(el)) {
      var tr = el.tagName.toLowerCase() === 'tr' ? el : el.closest('tr')
      var td = el.tagName.toLowerCase() === 'tr'
        ? el.querySelector('td, th')
        : el
      if (tr) result[name + ' [tr]'] = readOne(tr)
      if (td) result[name + ' [td]'] = readOne(td)
      // 第三层：Element Plus 的单元格内距不在 td 上，而在 td > .cell 上
      // （td 自身 padding 为 0）。只比 td 会把「内距全丢」当成真差异报出来
      // —— 2026-09-10 实跑首版就报了 8 条这样的假差异。原型没有 .cell 这层，
      // 所以拿现状的 .cell 去和原型的 td 比才是同一回事。
      var cellApp = td ? td.querySelector(':scope > .cell') : null
      if (cellApp) {
        result[name + ' [td]'] = readOne(cellApp, readOne(td))
        notes.push(name + '：Element Plus 单元格内距在 td > .cell 上（td 自身为 0），已改采 .cell 与原型 td 对比')
      }
      notes.push(name + '：表格行元素，已同时采 tr 与 td（原型底色写 tr、Element Plus 写 td 且 td 底色会盖住 tr，只比一边会得出假差异）')
      if (!tr && !td) result[name] = readOne(el)
    } else {
      result[name] = readOne(el)
    }
  }
  return { boxes: result, notes: notes }
}


/**
 * 在给定 page 上采集一组容器。
 * @param {import('@playwright/test').Page} page
 * @param {object} opts { mapping, rootSelector, visibleOnly }
 */
export async function collectBoxes (page, { mapping, rootSelector, visibleOnly = true }) {
  const out = await page.evaluate(collectInPage, {
    props: COLLECTED_PROPS,
    mapping,
    rootSelector,
    visibleOnly
  })
  if (!out) throw new Error('采集脚本没有返回结果（page.evaluate 返回 undefined）')
  if (out.error) throw new Error(out.error)
  return out
}
