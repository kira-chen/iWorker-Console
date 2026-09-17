/**
 * 豁免清单（pixel-audit 的一等公民）
 * ==========================================================================
 *
 * 【这是什么】
 * 「原型与现状确实有差异，但负责人已经拍板不改」的那些差异，登记在这里。
 * 跑批时命中豁免的差异不进主差异表，单独归到报告的「豁免命中」一节。
 *
 * 【为什么要单独一个文件】
 * 2026-09-10 的岗位详情像素级对齐批次里，T1/T2/T3 三类差异是负责人明确
 * 拍板「不做」的（改则全站共享层波及）。如果不登记，下一轮跑批会把它们
 * 当新问题重新报一遍，白白消耗一轮人力去查一个已经有结论的东西。
 *
 * 【维护规矩（硬要求）】
 * 1. 新增豁免必须先经负责人裁决，不允许开发自行判断「这个差异无所谓」就加。
 * 2. 每条必须填全 5 个字段：id / 标题 / decidedOn（裁决日期）/ decidedBy（裁决人）
 *    / source（出处：裁决所在 commit 号或当时的 PRD-review 日期；台账会归档，优先写 commit），缺一不可。
 * 3. match() 就是「判定条件」——什么样的差异算这一类，用代码写死，
 *    而不是靠人读文字去理解，避免下一个人把范围放大或缩小。
 * 4. 豁免不是永久静默：跑批会统计每条的命中数，0 命中的会被显式提示
 *    「可能已失效/多余，请复核」——防止豁免清单腐烂成僵尸配置。
 *    （比如某条豁免对应的代码后来被重写了，差异本身消失了，那这条豁免
 *      就该删掉，而不是留在文件里给人一种「这里还有历史包袱」的错觉。）
 */

/** 属性分组：把 collect.js 采到的属性名归类，便于 match() 按类判定 */
const TABLE_DENSITY_PROPS = [
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'height', 'font-size', 'line-height'
]

const RADIUS_PROPS = ['border-radius']

const SPACING_PROPS = [
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap'
]

/** 从 "9px" / "18px" 这类值里取数字；取不到返回 null */
function px (value) {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value || '').trim())
  return m ? Number(m[1]) : null
}

/**
 * 豁免条目。每条形如：
 *   {
 *     id, title, decidedOn, decidedBy, source, condition（判定条件的大白话说明）,
 *     match(diff) -> boolean
 *   }
 * match 收到的 diff 形如：
 *   { unit, container, selectorProto, selectorApp, prop, proto, app }
 */
export const exemptions = [
  {
    id: 'T1',
    title: '全站表格密度（表头/行高/单元格内距/字号）与原型差一档',
    decidedOn: '2026-09-10',
    decidedBy: '负责人',
    source: 'git 335aff7（2026-09-10 台账，已归档）· 「四页签逐像素对齐批次」待裁决 T1 + 文末拍板行',
    condition:
      '表格类容器（选择器命中 table / thead / tbody / tr / td / th / .el-table / .pd-table / .pd2-table）' +
      '上的密度属性（四边 padding、height、font-size、line-height）差异。' +
      '这套值由 theme.css + admin-shell.css 统一定义、26 个组件共用，改则全站波及。',
    match (diff) {
      const isTableScope = /(^|[\s.#>])(table|thead|tbody|tr|td|th)\b|el-table|pd-table|pd2-table/i
        .test(`${diff.selectorProto} ${diff.selectorApp} ${diff.container}`)
      return isTableScope && TABLE_DENSITY_PROPS.includes(diff.prop)
    }
  },

  {
    id: 'T2',
    title: '抽屉 body padding：站内共享 DrawerEditor 统一 22/28/34，与原型【部分壳】不一致',
    decidedOn: '2026-09-10',
    decidedBy: '负责人',
    source: 'git 335aff7（2026-09-10 台账，已归档）· 「四页签逐像素对齐批次」待裁决 T2 + 文末拍板行',
    // 【适用范围实测收窄，2026-09-10 全站扫描】原标题写成「vs 原型 20px 24px 30px」，
    // 容易被读成「全站抽屉都差这一档」。实测并非如此：原型里抽屉壳不止一种——
    //   · 专家新建抽屉、知识库 proto2-drawer → 20/24/30，与站内不同（本豁免要挡的就是这两类）
    //   · 角色/用户技能审核/审核中心/我的申请 四处 → 22/28/34/28，与站内共享 DrawerEditor 完全一致，零差异
    // 所以本豁免只在「原型用了另一种壳」的抽屉上命中；其余抽屉本就对齐，不需要豁免。
    // 全站 31 单元实跑命中 5 条，全部落在上述两类壳，符合预期。
    condition:
      '抽屉【正文区那一层本身】（.drawer-body / .el-drawer__body / .proto2-drawer-body，' +
      '或语义名叫「抽屉正文」的容器）的 padding 差异。' +
      '出自全站共享的 DrawerEditor，改则全站抽屉一起变。' +
      '【范围限定】只认正文区这一层，不含抽屉里的任何子元素 —— 见下方 match() 注释。',
    match (diff) {
      // ── 2026-09-10 第二批跑批修正：原判定条件过宽 ──────────────────
      // 原写法是 /drawer/i 扫【整串选择器 + 容器名】，只要沾上 drawer 三个字母
      // 就算数。实跑后果：专家新建抽屉那一轮「T2 命中 4 条」，4 条全是底栏
      // 取消/主按钮的 padding-top/bottom —— 它们的现状选择器写作
      // `.el-drawer__footer .el-button…`，含 "drawer"，于是被整片豁免掉了。
      // 而 T2 真正要豁免的 .el-drawer__body 那一条（padding-bottom 28px vs 34px）
      // 当时正被 report.js 的 (e) 规则吞掉，压根没进判定。
      // 结果就是：豁免看着"有效"，实际拦的是不该拦的东西，还顺手把
      // 「底栏按钮内距不一致」这条真差异藏了起来。
      // → 收窄到【正文区那一层本身】，用锚定到元素末尾的选择器匹配。
      const scope = `${diff.selectorProto} ${diff.selectorApp}`
      const isDrawerBodyItself =
        /(^|[\s,])(\.drawer-body|\.el-drawer__body|\.proto2-drawer-body)\s*(,|$)/.test(scope) ||
        diff.container === '抽屉正文'
      return isDrawerBodyItself && diff.prop.startsWith('padding-')
    }
  },

  {
    id: 'T3',
    title: '无对应令牌的原型值（9px 圆角 / 18px 系间距 / EP 按钮尺寸圆角与品牌绿）',
    decidedOn: '2026-09-10',
    decidedBy: '负责人',
    source: 'git 335aff7（2026-09-10 台账，已归档）· 「四页签逐像素对齐批次」待裁决 T3 + 文末拍板行',
    condition:
      '原型用了站内设计令牌里根本没有的值，按「找不到令牌不自造」维持站内规范。三小类：' +
      '(a) 圆角：原型 9px、站内 8px（差 1px 且原型值不是 4px 梯度上的数）；' +
      '(b) 间距：原型落在 18px 这类非 4px 梯度值上、站内取相邻梯度值（16/20），差 ≤4px；' +
      '(c) 按钮：Element Plus small 尺寸按钮的高/圆角/品牌绿色值与原型自绘按钮不一致。',
    match (diff) {
      // (a) 圆角：原型非 4 的倍数（如 9px），站内是 4 的倍数（如 8px）
      if (RADIUS_PROPS.includes(diff.prop)) {
        const p = px(diff.proto); const a = px(diff.app)
        if (p != null && a != null && p % 4 !== 0 && a % 4 === 0 && Math.abs(p - a) <= 2) return true
      }
      // (b) 间距：原型非 4px 梯度（18px 这类），站内取相邻梯度，差 ≤4px
      if (SPACING_PROPS.includes(diff.prop)) {
        const p = px(diff.proto); const a = px(diff.app)
        if (p != null && a != null && p % 4 !== 0 && a % 4 === 0 && Math.abs(p - a) <= 4) return true
      }
      // (c) 按钮：EP small 与原型自绘按钮的尺寸/圆角/绿值
      const isButton = /button|\.el-button|\.primary\b|\.plain\b/i
        .test(`${diff.selectorProto} ${diff.selectorApp} ${diff.container}`)
      if (isButton && ['height', 'border-radius', 'background-color', 'color'].includes(diff.prop)) return true
      return false
    }
  }
]

/**
 * 对一条差异做豁免判定。
 * @returns 命中的豁免条目，或 null（= 进主差异表）
 */
export function matchExemption (diff) {
  for (const ex of exemptions) {
    let hit = false
    try {
      hit = ex.match(diff)
    } catch (err) {
      // 豁免的判定条件写错了不该拖垮整轮跑批：报一声，当作没命中
      console.warn(`[pixel-audit] 豁免 ${ex.id} 的 match() 抛错，本条按未命中处理：${err.message}`)
    }
    if (hit) return ex
  }
  return null
}

/**
 * 豁免自证：统计每条豁免这一轮被命中多少次，0 命中的标为「请复核」。
 * @param {Map<string, number>} hitCounts  id -> 命中数
 */
export function auditExemptions (hitCounts) {
  return exemptions.map((ex) => {
    const hits = hitCounts.get(ex.id) || 0
    return {
      id: ex.id,
      title: ex.title,
      decidedOn: ex.decidedOn,
      decidedBy: ex.decidedBy,
      source: ex.source,
      hits,
      // 0 命中 = 这条豁免这一轮没拦下任何东西。可能是差异已经消失（该删），
      // 也可能是本轮跑的单元根本没覆盖到它管的地方（该扩配置）。两种都要人来看。
      stale: hits === 0
    }
  })
}
