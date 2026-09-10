/**
 * 审计单元配置（声明式）
 * ==========================================================================
 * 【加一个新页面的审计 = 往 units 数组里加一个对象，不需要改工具代码。】
 *
 * 一个「审计单元」= 一屏要对表的内容，含四件事：
 *   1. name / key   —— 单元名（报告里显示）与 --unit= 过滤用的 key
 *   2. proto        —— 原型侧：怎么点进这一屏（steps）+ 根容器选择器
 *   3. app          —— 现状侧：URL + 怎么点进这一屏 + 根容器选择器
 *   4. containers   —— 容器映射表 { 语义名: { proto: 选择器, app: 选择器 } }
 *
 * 【steps 支持的动作】（见 runner.js 的 runStep）
 *   { click: '选择器' }            点击（自动等元素可见）
 *   { waitFor: '选择器' }          等元素出现且有实际尺寸
 *   { waitTimeout: 300 }           硬等（毫秒，慎用，优先用 waitFor）
 *   { eval: 'JS 表达式' }          在页面里跑一段 JS（原型的状态机常用）
 *
 * ------------------------------------------------------------------
 * 【坑 3：原型导航陷阱】—— 本文件是这个坑的落点
 * ------------------------------------------------------------------
 * 原型是【单文件多层覆写】：同一个渲染函数（renderPosPane / posTabs / agentsPane…）
 * 在文件里被重新定义很多次，后定义的覆盖先定义的。两个直接后果：
 *
 * (a) 【不能读被覆盖的旧层源码】。举例：原型 L1856 的 agentsPane 是泳道看板，
 *     但它被后面的层覆盖掉了，最终生效态是与现状同构的二级表格。
 *     2026-09-10 的排查明确记过：「若对照源码旧层会严重误判」。
 *     → 工具的做法是【只认运行时渲染出来的最终 DOM】，从不解析原型源码。
 *
 * (b) 【进入路径要用结构选择器，不要用文字匹配】。原型侧栏是
 *     button[data-module="positions"] 这种带 data 属性的结构入口；
 *     用「文字里含『岗位』」去找，会同时命中「岗位」和「岗位管理」两个菜单项
 *     （而「岗位管理」在原型里根本没接模块，点了只弹一句 toast）。
 *     行内同理：进详情用 [data-action="position-edit"][data-id="401"]，
 *     切页签用 [data-pd-action="tab"][data-tab="intake"]。
 * ------------------------------------------------------------------
 */

/** 原型文件路径（相对仓库根） */
export const PROTO_HTML = 'docs/PRD/数字员工管理端PRD/数字员工管理端交互原型.html'

/** 现状 dev 服务地址，可用环境变量 PIXEL_AUDIT_BASE 覆盖 */
export const APP_BASE = process.env.PIXEL_AUDIT_BASE || 'http://localhost:5173'

/** 演示岗位：两侧 id 都是 401「经营分析岗」（已发布可编辑态） */
const POSITION_ID = 401

/** 原型侧：从首屏点到岗位详情（结构选择器，见上文坑 3） */
const protoEnterPosition = [
  { click: 'button[data-module="positions"]' },
  { waitFor: `[data-action="position-edit"][data-id="${POSITION_ID}"]` },
  { click: `[data-action="position-edit"][data-id="${POSITION_ID}"]` },
  { waitFor: '.pd2-shell .pd2-tabs' }
]

/**
 * 原型侧：切到某个页签。
 *
 * 【坑 3 的活教材，务必读完再改这里】
 *
 * (1) 页签按钮的属性【不是】源码里写的 `data-pd-action="tab"`。
 *     原型 L1872 的 renderPositionDetail 确实渲染 data-pd-action，但那一层被后面的
 *     「pfix」层整个覆盖了。本工具第一版照 L1872 源码写，6 个单元全部超时跑挂。
 *
 * (2) 更阴的是：**同一个页签栏的属性会变**。刚进详情时是 `data-pfix="tab"`；
 *     切到工作档案之后，页签栏被另一层重新渲染成了 `data-pd-action="tab"`。
 *     也就是说【写死任何一个属性都会在某个时刻失效】。
 *     → 所以这里用 `[data-pfix="tab"], [data-pd-action="tab"]` 两个都认，
 *       按 data-tab 值定位，谁在生效就点谁。
 *
 * (3) 页签顺序在最终态是 人格/采集字段/工作档案/知识/Agent与技能/自动化任务/业务系统，
 *     与源码里 posTabs 变量的声明顺序也不一致。
 *
 * 结论固化成规矩：原型侧的任何选择器，都必须来自【浏览器里跑出来的最终 DOM】，
 * 不许从 html 源码眼读；而且要考虑到最终 DOM 本身会随交互被别的层重画。
 */
const protoTab = (tab) => [
  { click: `[data-pfix="tab"][data-tab="${tab}"], [data-pd-action="tab"][data-tab="${tab}"]` },
  { waitFor: '.pd2-content > div' },
  { waitTimeout: 250 }
]

/**
 * 现状侧：切到某个页签。
 * Element Plus 的页签是 el-tabs 的 header 项，用可见文本定位——现状侧没有
 * 多层覆写问题，且 EP 不给页签挂稳定的 data 属性，文本是最稳的锚点。
 */
const appTab = (label) => [
  { click: `.pd-tabs .el-tabs__item:has-text("${label}")` },
  // 【坑 1 在等待环节的化身】
  // 不能等 `.el-tab-pane` —— el-tabs 把 8 个 pane 全 attach 在 DOM 里，
  // locator.first() 命中的永远是第一个（persona），切到别的页签时它是隐藏的，
  // 于是这一步会一直等到超时。（实测报错原文：
  //  「34 × locator resolved to hidden <div id="pane-persona" aria-hidden="true">」）
  // → 必须把隐藏的排除掉，只等「当前真正显示出来的那个 pane」。
  { waitFor: '.pd-tabs .el-tab-pane:not([aria-hidden="true"])' },
  { waitTimeout: 300 }
]

export const units = [
  // ────────────────────────────────────────────────────────────────
  // ① 人格
  // ────────────────────────────────────────────────────────────────
  {
    key: 'persona',
    name: '岗位详情 · 人格页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('persona')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('人格')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.pd2-pane', app: '.pd-pane' },
      首张白卡: { proto: '.pd2-section', app: '.pd-card' },
      卡头: { proto: '.pd2-section-head', app: '.pd-card-head' },
      卡体: { proto: '.pd2-section-body', app: '.pd-card-body' }
    }
  },

  // ────────────────────────────────────────────────────────────────
  // ② 采集字段
  // 注：原型这一屏的卡头是 .pd2-list-head（不是 .pd2-section-head）——
  //     同样是最终生效态实测所得，源码里两种都能搜到。
  // ────────────────────────────────────────────────────────────────
  {
    key: 'intake',
    name: '岗位详情 · 采集字段页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('intake')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('采集字段')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.pd2-pane', app: '.pd-pane' },
      白卡: { proto: '.pd2-section', app: '.pd-card' },
      卡头: { proto: '.pd2-list-head', app: '.pd-card-head' },
      表格: { proto: '.pd2-table', app: '.pd-table .el-table__inner-wrapper' },
      // 行一级选择器会触发 collect.js 的 tr/td 双采（坑 2）
      表格首行: { proto: '.pd2-table tbody tr', app: '.pd-table .el-table__body tbody tr' }
    }
  },

  // ────────────────────────────────────────────────────────────────
  // ③ 知识
  // ────────────────────────────────────────────────────────────────
  {
    key: 'knowledge',
    name: '岗位详情 · 知识页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('knowledge')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('知识')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.pd2-pane', app: '.pd-pane' },
      白卡: { proto: '.pd2-section', app: '.pd-card' },
      卡头: { proto: '.pd2-list-head', app: '.pd-card-head' },
      工具栏: { proto: '.pd2-kb-toolbar', app: '.pd-kb-toolbar' },
      搜索框: { proto: '.pd2-kb-toolbar .search', app: '.pd-kb-search' },
      状态下拉: { proto: '.pd2-kb-toolbar select.select', app: '.pd-kb-status' },
      表格: { proto: 'table.kb2-table', app: '.pd-table .el-table__inner-wrapper' },
      表格首行: { proto: 'table.kb2-table tbody tr', app: '.pd-table .el-table__body tbody tr' }
    }
  },

  // ────────────────────────────────────────────────────────────────
  // ④ Agent 与技能
  // 【坑 3 再次命中】原型这一屏最终生效态用的是 .sync-agent-card / .sync-table，
  // 既不是源码 L1856 的泳道看板，也不是通用的 .pd2-section / .pd2-table。
  // 09-10 的排查报告原话：「若对照源码旧层会严重误判」。
  // ────────────────────────────────────────────────────────────────
  {
    key: 'agents',
    name: '岗位详情 · Agent 与技能页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('agents')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('Agent 与技能')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.pd2-pane', app: '.pd-pane' },
      白卡: { proto: '.sync-agent-card', app: '.pd-card' },
      卡头: { proto: '.sync-agent-card-head', app: '.pd-card-head' },
      卡体: { proto: '.sync-agent-card-body', app: '.pd-card-body' },
      表格: { proto: 'table.sync-table', app: '.pd-table .el-table__inner-wrapper' },
      // Agent 行底纹：2026-09-10 B 路的硬伤（引用了 tokens.css 里不存在的
      // --bg-subtle / --fill-subtle，实测底色 transparent）就出在这一行上，
      // 必须走 tr/td 双采才辨得出「真丢」还是「只是写在另一个元素上」。
      Agent行: { proto: 'tr.sync-agent-row', app: '.pd-table .el-table__body tbody tr' }
    }
  },

  // ────────────────────────────────────────────────────────────────
  // ⑤ 自动化任务（M 系列两栏卡片化的落点）
  // ────────────────────────────────────────────────────────────────
  {
    key: 'tasks',
    name: '岗位详情 · 自动化任务页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('tasks')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('自动化任务')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.pd2-pane', app: '.pd-pane' },
      两栏布局: { proto: '.pd2-task-layout', app: '.st-body' },
      左栏任务列表: { proto: '.pd2-task-list', app: '.st-col-list' },
      右栏编辑器: { proto: '.pd2-task-detail', app: '.st-col-edit' },
      任务卡首项: { proto: '.pd2-task-item', app: '.st-item' }
    }
  },

  // ────────────────────────────────────────────────────────────────
  // ⑥ 工作档案（B 路「两栏整体窄 102px」硬伤的落点）
  // 【坑 3 第三次命中】原型这一屏最终生效态整套用 wp3-* 前缀，
  // 源码里的 .pd2-profile-grid / .pd2-profile-side 全是被覆盖的旧层。
  // ────────────────────────────────────────────────────────────────
  {
    key: 'workProfile',
    name: '岗位详情 · 工作档案页签',
    proto: {
      steps: [...protoEnterPosition, ...protoTab('workProfile')],
      root: '.pd2-content'
    },
    app: {
      url: `/admin/positions/${POSITION_ID}/workbench`,
      steps: [{ waitFor: '.pd-tabs' }, ...appTab('工作档案')],
      root: '.el-tabs__content'
    },
    containers: {
      面板根: { proto: '.wp3-pane', app: '.pd-pane' },
      两栏网格: { proto: '.wp3-grid', app: '.wd-grid' },
      左栏档案列表: { proto: '.wp3-side', app: '.wd-side' },
      右栏主区: { proto: '.wp3-grid > main', app: '.wd-main' },
      档案卡首项: { proto: '.wp3-profile-card', app: '.wd-profile-card' },
      分区白卡: { proto: '.wp3-sec', app: '.wd-sec' },
      分区头: { proto: '.wp3-head', app: '.wd-sec-head' },
      分区体: { proto: '.wp3-body', app: '.wd-sec-body' }
    }
  }
]

export default units
