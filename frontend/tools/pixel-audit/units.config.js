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
  },

  // ══════════════════════════════════════════════════════════════════
  // 【第二批：全站列表页 · 2026-09-10 扩配置】
  // ══════════════════════════════════════════════════════════════════
  //
  // 覆盖专家 / 技能 / 知识库 / 连接器（MCP·API·业务系统）/ 模型 五个模块，
  // 每个模块拆「列表屏」+「新建抽屉/弹窗」两类单元。
  //
  // ── 坑 3 在本批的三次实证（都是「源码眼读会错、跑起来才对」）────────
  //
  // (1) 侧栏「知识库」：html 源码 L129-130 里这个 button 【没有 data-module】
  //     （`<button class="nav-item"><span class="nav-ic">▤</span>…知识库</button>`），
  //     照源码写会以为只能靠文字匹配。但最终生效态里它是
  //     `data-module="knowledge"` —— 侧栏被后面的层整个重画过。
  //     同理「岗位管理」源码里没有 data-module，最终态是 data-module="position-assignments"。
  //     → 五个模块入口全部实测确认可用结构选择器，无一需要文字匹配。
  //
  // (2) 原型的模块骨架【不统一】，不能套一份模板：
  //     - 专家/技能/模型：.module-toolbar + .table-wrap + .fm5-pager
  //     - 连接器：      .toolbar（不带 module- 前缀）+ .pager
  //     - 知识库：      .kb2-toolbar + .pager，且自带一层 .kb2-tabs 页签
  //     状态标签也不统一：专家是 .status-neutral.status-live，其余四个是 .tag.green。
  //
  // (3) 抽屉不是一种东西，四种壳：
  //     - 专家/连接器/模型：.mask.open > section.drawer（.drawer-head/body/foot）
  //     - 知识库：          .proto2-mask.open > .proto2-drawer（proto2-drawer-head/body/foot）
  //     - 技能：            .modal-mask.open > section.modal.wide（是弹窗不是抽屉）
  //
  // ── 现状侧的对应陷阱（坑 1 的新变体）────────────────────────────
  //
  // (A) 【el-tabs 内容不在 el-tabs__content 里】。连接器与知识库页把页签正文
  //     渲染在 el-tabs 外面的 .connector-body / .kb-body 上，
  //     el-tabs__content 实测高度为 0 且 [HIDDEN]。
  //     → 这两个模块的 root 必须写 .connector-body / .kb-body，
  //       照岗位详情那样写 .el-tabs__content 会直接「根容器未命中或不可见」跑挂。
  //     → 页签切换也不点 el-tabs__item，直接用 URL query（?tab=api）进，更稳。
  //
  // (B) 【抽屉 overlay 同时存在 4~8 个，只有一个可见】。实测 /admin/experts
  //     点开新建后 document 里有 8 个 .el-overlay/.el-drawer，7 个宽高为 0。
  //     collect.js 的 pickVisible 会挑出可见那个，但【选择器不能写 .el-drawer 就完事】
  //     ——要靠 pickVisible，所以这里照常写类名即可，勿改成 :first-child 之类。
  //
  // (C) 现状侧五个模块共用 .list-page 骨架（.page-header / .list-toolbar /
  //     .table-wrap / .list-pager），抽屉共用 DrawerEditor（.de-drawer +
  //     .el-drawer__header/__body/__footer）。这正是「系统性差异」会成批出现的原因。
  // ══════════════════════════════════════════════════════════════════

  /** 现状侧列表页的公共容器映射（五个模块共用 .list-page 骨架） */
  ...(() => {
    /**
     * 生成一个「列表屏」单元。
     * @param cfg.protoToolbar  原型工具栏选择器（三种：.module-toolbar/.toolbar/.kb2-toolbar）
     * @param cfg.protoTable    原型表格选择器
     * @param cfg.protoPager    原型分页选择器（.fm5-pager 或 .pager）
     * @param cfg.protoTag      原型状态标签选择器（专家与其余四个不同）
     * @param cfg.appRoot       现状根（普通页 .list-page，带页签的页 .connector-body/.kb-body）
     */
    const listUnit = (cfg) => ({
      key: cfg.key,
      name: cfg.name,
      // 【root 必须两侧对称，否则整列 x 全是假差异】
      // 首跑实测：proto root 写 .page、app root 写 .list-page 时，专家页 75 条主差异里
      // 有 12 条是「x 差 34px」，且【每个容器都差同一个 34px】。
      // 排查结论：两侧 .page 都是 padding: 26px 34px 48px（逐字节相同），
      // 而现状多包了一层 padding:0 的 .list-page。于是原型侧 x 从 .page 内容框外沿算起
      // （子元素 x=34），现状侧从 .list-page 算起（子元素 x=0）——
      // 两边绝对坐标实测都是 x=238 / width=1328，【完全对齐】。
      // 34px 纯粹是「根选在了 padding 的哪一侧」造成的探针假差异。
      // → 两侧 root 统一取 .page（现状的 .page 与原型同名同值），
      //   .list-page 降为一个普通被测容器，它自身的内距差异照样比得到。
      proto: { steps: cfg.protoSteps, root: '.page' },
      app: { url: cfg.appUrl, steps: cfg.appSteps, root: '.page' },
      containers: {
        // 现状比原型多一层 .list-page/.connector-body/.kb-body 包装：
        // 单列一行比它自身的盒模型，确保「多包一层」若真带来内距差异不会漏报。
        内容包装层: { proto: cfg.protoWrap || '.page > div:last-child', app: cfg.appRoot || '.list-page' },
        页头: { proto: '.page-head', app: '.page-header' },
        // 现状比原型多一层 .page-header-text 包装，且它是 shrink-to-fit（宽=内容宽），
        // 原型的 h1/p 则是块级铺满 1328px。首跑因此报了 2 条 width 假差异
        // （标题/副文案各一条；实测两侧 x 都是 238、都是单行，视觉完全一致）。
        // → 单列这一行把包装层本身比出来（它若真该铺满，width 差异照报不漏），
        //   标题/副文案两行保留，专用于比字号/字重/行高/字色这些真看得出来的属性。
        页头文本包装: { proto: '.page-head', app: '.page-header-text' },
        页头标题: { proto: '.page-head h1', app: '.page-header-title' },
        页头副文案: { proto: '.page-head p', app: '.page-header-sub' },
        工具栏: { proto: cfg.protoToolbar, app: '.list-toolbar' },
        // 【Element Plus 输入类控件：真正的盒子在 __wrapper 那一层】
        // 首跑实测：.el-select / .el-input 外层是 padding:0 / border:0 / 背景透明的
        // 纯定位壳，描边、圆角、白底、内距全在 .el-select__wrapper / .el-input__wrapper 上。
        // 拿外壳去比原型的 <select> / .search，会报出 8 条假差异
        //（四边 border-width 1px vs 0、四边 border-color、border-radius 8px vs 0、
        //  background-color 白 vs transparent、左右 padding 12px vs 0），
        // 这是「选错层」而非真差异 —— 和坑 2 的 td/.cell 是同一类问题。
        // → 一律对到 __wrapper 层。
        // 另注：EP 用 `box-shadow: 0 0 0 1px inset` 画描边，不是 border-width，
        // 所以 border-width 一栏两侧都会是 0 ——「描边色不一致」这类差异要看
        // 下面「描边阴影」这一行，不能只看 border-*。
        搜索框: { proto: `${cfg.protoToolbar} .search`, app: '.list-toolbar .lt-search .el-input__wrapper' },
        筛选下拉: { proto: `${cfg.protoToolbar} select.select`, app: '.list-toolbar .lt-filter .el-select__wrapper' },
        查询按钮: { proto: `${cfg.protoToolbar} button.plain`, app: '.list-toolbar .el-button:not(.el-button--primary)' },
        新建按钮: { proto: `${cfg.protoToolbar} button.primary`, app: '.list-toolbar .lt-create' },
        表格外框: { proto: '.table-wrap', app: '.table-wrap' },
        表格: { proto: cfg.protoTable, app: '.el-table__inner-wrapper' },
        // 行一级选择器 → 触发 collect.js 的 tr/td/.cell 三层双采（坑 2）
        表头行: { proto: `${cfg.protoTable} thead tr`, app: '.el-table__header-wrapper thead tr' },
        表格首行: { proto: `${cfg.protoTable} tbody tr`, app: '.el-table__body-wrapper tbody tr' },
        状态标签: { proto: cfg.protoTag, app: '.el-table__body-wrapper .status-tag' },
        分页区: { proto: cfg.protoPager, app: '.list-pager' },
        ...(cfg.extraContainers || {})
      }
    })

    /**
     * 生成一个「新建抽屉/弹窗」单元。
     * 【本批加它的直接目的】：上一轮 T2（共享 DrawerEditor 的 body padding）
     * 0 命中，报告标了「⚠️ 可能已失效/多余」。但 6 个岗位详情单元一个抽屉都没覆盖，
     * 所以 0 命中证明不了任何事 —— 属于 README「豁免自证」里说的第二种情况
     * （该扩配置，而不是该删豁免）。本批把五个模块的抽屉全接上，让 T2 有机会被验证。
     */
    const drawerUnit = (cfg) => ({
      key: cfg.key,
      name: cfg.name,
      proto: { steps: cfg.protoSteps, root: cfg.protoMask },
      app: { url: cfg.appUrl, steps: cfg.appSteps, root: cfg.appRoot },
      containers: cfg.containers
    })

    // ── 原型侧进入路径（结构选择器，全部来自最终生效 DOM 实测）──
    const protoModule = (m) => [
      { click: `button[data-module="${m}"]` },
      { waitFor: '.page .page-head' },
      { waitTimeout: 300 }
    ]
    // 原型连接器页签：最终态属性是 [data-tab=...]（实测，非源码 data-action）
    const protoConnTab = (t) => [
      { click: `.tabs button.tab[data-tab="${t}"]` },
      { waitFor: '.page > div:last-child' },
      { waitTimeout: 350 }
    ]
    // 现状侧列表页就绪：等表格骨架真正有尺寸（不是等 attached）
    const appList = (extra = []) => [
      { waitFor: '.list-page .list-toolbar' },
      ...extra,
      { waitTimeout: 400 }
    ]

    // 三种抽屉壳的容器映射
    const drawerContainers = (protoPrefix) => ({
      抽屉体: { proto: `section.drawer, .${protoPrefix}-drawer`, app: '.de-drawer' },
      抽屉头: { proto: `.drawer-head, .${protoPrefix}-drawer-head`, app: '.el-drawer__header' },
      抽屉正文: { proto: `.drawer-body, .${protoPrefix}-drawer-body`, app: '.el-drawer__body' },
      抽屉底栏: { proto: `.drawer-foot, .${protoPrefix}-drawer-foot`, app: '.el-drawer__footer' },
      首张分区卡: { proto: '.section-card, .proto2-form-sec', app: '.section-card' },
      // 知识库抽屉这一层的类名与其余三个抽屉【不同】：其余是 .section-title，
      // 知识库（proto2-* 那套壳）是 .proto2-form-title —— 实测所得，
      // 首跑写死 .section-title 时知识库抽屉这一行「原型侧未命中」。
      分区标题: { proto: '.section-title, .proto2-form-title', app: '.section-title' },
      取消按钮: { proto: 'button.plain', app: '.el-drawer__footer .el-button:not(.el-button--primary)' },
      主按钮: { proto: 'button.primary', app: '.el-drawer__footer .el-button--primary' }
    })

    return [
      // ────────────────────────────────────────────────────────────
      // ⑦ 专家列表页
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'experts',
        name: '专家 · 列表页',
        protoSteps: protoModule('experts'),
        appUrl: '/admin/experts',
        appSteps: appList(),
        protoToolbar: '.module-toolbar',
        protoTable: 'table.expert-table',
        protoPager: '.fm5-pager',
        // 专家模块的状态标签类名与其余四个模块【不一样】（实测：
        // 专家是 .status-neutral.status-live，其余是 .tag.green）——
        // 这是原型侧的历史分层遗留，照最终生效态写。
        protoTag: 'tbody .status-live, tbody .status-neutral'
      }),

      // ⑧ 专家 · 新建抽屉（T2 豁免的验证点之一）
      drawerUnit({
        key: 'expertsDrawer',
        name: '专家 · 新建抽屉',
        protoSteps: [
          ...protoModule('experts'),
          { click: '[data-action="expert-new"]' },
          { waitFor: '.mask.open section.drawer' },
          { waitTimeout: 400 }
        ],
        protoMask: '.mask.open',
        appUrl: '/admin/experts',
        appSteps: [
          ...appList(),
          { click: '.list-toolbar .lt-create' },
          { waitFor: '.de-drawer.open .el-drawer__body' },
          { waitTimeout: 500 }
        ],
        appRoot: '.el-overlay.is-drawer',
        containers: drawerContainers('x')
      }),

      // ────────────────────────────────────────────────────────────
      // ⑨ 技能列表页
      // 注：原型工具栏是 .module-toolbar.skill-toolbar，表格 .skill-table
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'skills',
        name: '技能 · 列表页',
        protoSteps: protoModule('skills'),
        appUrl: '/admin/skills-all',
        appSteps: appList(),
        protoToolbar: '.module-toolbar',
        protoTable: 'table.skill-table',
        protoPager: '.fm5-pager',
        protoTag: 'tbody span.tag'
      }),

      // ⑩ 技能 · 新建弹窗
      // 【与其余四个不同】原型这里是【弹窗】(.modal-mask > section.modal.wide)、
      // 现状是 el-dialog，不是抽屉。所以 T2（抽屉 body padding）在本单元不该命中，
      // 这正好是 T2 判定范围的反向验证。
      {
        key: 'skillsDialog',
        name: '技能 · 新建弹窗',
        proto: {
          steps: [
            ...protoModule('skills'),
            { click: '[data-action="skill-new"]' },
            { waitFor: '.modal-mask.open section.modal' },
            { waitTimeout: 400 }
          ],
          root: '.modal-mask.open'
        },
        app: {
          url: '/admin/skills-all',
          steps: [
            ...appList(),
            { click: '.list-toolbar .lt-create' },
            { waitFor: '.el-dialog.skill-create-dialog' },
            { waitTimeout: 500 }
          ],
          root: '.el-overlay.el-modal-dialog'
        },
        containers: {
          弹窗体: { proto: 'section.modal', app: '.el-dialog' },
          弹窗头: { proto: 'section.modal > h3', app: '.el-dialog__header' },
          弹窗正文: { proto: '.modal-content', app: '.el-dialog__body' },
          弹窗底栏: { proto: '.modal-actions', app: '.el-dialog__footer, .el-dialog__body + div' },
          取消按钮: { proto: '.modal-actions button.plain', app: '.el-dialog .el-button:not(.el-button--primary)' },
          主按钮: { proto: '.modal-actions button.primary', app: '.el-dialog .el-button--primary' }
        }
      },

      // ────────────────────────────────────────────────────────────
      // ⑪ 知识库列表页
      // 【坑 1 变体 A】现状侧正文在 .kb-body，不在 el-tabs__content（实测后者 0 高度）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'knowledgeBase',
        name: '知识库 · 知识库管理页签',
        protoSteps: [
          ...protoModule('knowledge'),
          { click: '.kb2-tabs [data-tab="kb"]' },
          { waitFor: '.kb2-toolbar' },
          { waitTimeout: 300 }
        ],
        appUrl: '/admin/knowledge-base?tab=kb',
        appSteps: [{ waitFor: '.kb-body .list-toolbar' }, { waitTimeout: 400 }],
        appRoot: '.kb-body',
        protoToolbar: '.kb2-toolbar',
        protoTable: 'table.kb2-table',
        protoPager: '.pager',
        protoTag: 'tbody span.tag',
        extraContainers: {
          // 页签栏：原型 .kb2-tabs，现状 el-tabs 的 header（正文另挂 .kb-body）
          页签栏: { proto: '.kb2-tabs', app: '.kb-tabs .el-tabs__header' },
          选中页签: { proto: '.kb2-tab.active', app: '.kb-tabs .el-tabs__item.is-active' }
        }
      }),

      // ⑫ 知识库 · 新建抽屉
      // 原型这里的抽屉壳是 proto2-* 前缀（与专家/连接器/模型的 .drawer 不同）
      drawerUnit({
        key: 'knowledgeBaseDrawer',
        name: '知识库 · 新建抽屉',
        protoSteps: [
          ...protoModule('knowledge'),
          { click: '[data-kb-action="new-kb"]' },
          { waitFor: '.proto2-mask.open .proto2-drawer' },
          { waitTimeout: 400 }
        ],
        protoMask: '.proto2-mask.open',
        appUrl: '/admin/knowledge-base?tab=kb',
        appSteps: [
          { waitFor: '.kb-body .list-toolbar' },
          { click: '.kb-body .list-toolbar .lt-create' },
          { waitFor: '.de-drawer.open .el-drawer__body' },
          { waitTimeout: 500 }
        ],
        appRoot: '.el-overlay.is-drawer',
        containers: drawerContainers('proto2')
      }),

      // ────────────────────────────────────────────────────────────
      // ⑬ 连接器 · MCP 页签
      // 【坑 1 变体 A】现状正文在 .connector-body；页签用 URL query 进最稳
      // 【原型骨架不同】工具栏是 .toolbar（不带 module- 前缀）、分页是 .pager
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'connectorMcp',
        name: '连接器 · MCP 页签',
        protoSteps: [...protoModule('mcp'), ...protoConnTab('mcp')],
        appUrl: '/admin/connector?tab=mcp',
        appSteps: [{ waitFor: '.connector-body .list-toolbar' }, { waitTimeout: 400 }],
        appRoot: '.connector-body',
        protoToolbar: '.toolbar',
        protoTable: 'table.compact-mcp-table',
        protoPager: '.pager',
        protoTag: 'tbody span.tag',
        extraContainers: {
          页签栏: { proto: '.tabs', app: '.connector-tabs .el-tabs__header' },
          选中页签: { proto: '.tabs .tab.active', app: '.connector-tabs .el-tabs__item.is-active' },
          健康标签: { proto: 'tbody .status-connection', app: '.el-table__body-wrapper .health-tag' }
        }
      }),

      // ⑭ 连接器 · API 页签
      // 【本页不是普通表格】两侧都是「服务提供系统分组 + 组内表格」：
      // 原型 section.connector-group / .connector-group-head / .connector-group-body，
      // 现状 .aps-group / .aps-group-head / .aps-group-body（均为实测最终态）。
      {
        key: 'connectorApi',
        name: '连接器 · API 页签',
        proto: { steps: [...protoModule('mcp'), ...protoConnTab('api')], root: '.page' },
        app: {
          url: '/admin/connector?tab=api',
          steps: [{ waitFor: '.connector-body .aps-group' }, { waitTimeout: 400 }],
          // root 两侧对称取 .page（理由见 listUnit 上方注释）
          root: '.page'
        },
        containers: {
          内容包装层: { proto: '.page > div:last-child', app: '.connector-body' },
          页头: { proto: '.page-head', app: '.page-header' },
          工具栏: { proto: '.module-toolbar', app: '.list-toolbar' },
          搜索框: { proto: '.module-toolbar .search', app: '.list-toolbar .lt-search' },
          筛选下拉: { proto: '.module-toolbar select.select', app: '.list-toolbar .lt-filter' },
          新建按钮: { proto: '.module-toolbar button.primary', app: '.list-toolbar .lt-create' },
          分组卡: { proto: 'section.connector-group', app: '.aps-group' },
          分组头: { proto: '.connector-group-head', app: '.aps-group-head' },
          分组名: { proto: '.connector-group-name', app: '.aps-group-name' },
          分组描述: { proto: '.connector-group-desc', app: '.aps-group-desc' },
          分组计数: { proto: '.connector-group-count', app: '.aps-group-count' },
          分组操作区: { proto: '.connector-group-actions', app: '.aps-group-actions' },
          分组体: { proto: '.connector-group-body', app: '.aps-group-body' },
          组内表格外框: { proto: '.connector-group-body .table-wrap', app: '.aps-table-wrap' },
          组内表头行: { proto: 'table.api-table thead tr', app: '.aps-table-wrap .el-table__header-wrapper thead tr' },
          组内表格首行: { proto: 'table.api-table tbody tr', app: '.aps-table-wrap .el-table__body-wrapper tbody tr' }
        }
      },

      // ⑮ 连接器 · 业务系统页签
      //
      // 【已知且属实的「原型侧未命中」：分页区】—— 不是选择器写错。
      // 实测原型这一屏 `.page > div:last-child` 的直系子元素只有
      // .module-toolbar 与 .table-wrap 两个，【根本没有分页控件】；
      // 现状侧则照全站统一分页控件的口径渲染了 .list-pager。
      // 保留这一行不删：它报出来的「原型无 / 现状有」正是一条要给负责人看的
      // 结构性差异（对照 2026-09-08「全站统一分页控件（动态条数）」的拍板，
      // 现状多出分页多半是对的，但该由人确认，不由工具替人抹掉）。
      listUnit({
        key: 'connectorBiz',
        name: '连接器 · 业务系统页签',
        protoSteps: [...protoModule('mcp'), ...protoConnTab('biz')],
        appUrl: '/admin/connector?tab=biz',
        appSteps: [{ waitFor: '.connector-body .table-wrap' }, { waitTimeout: 400 }],
        appRoot: '.connector-body',
        protoToolbar: '.module-toolbar',
        protoTable: 'table.biz-table',
        protoPager: '.pager',
        protoTag: 'tbody span.tag'
      }),

      // ⑯ 连接器 · 新建 MCP 抽屉（T2 验证点）
      drawerUnit({
        key: 'connectorDrawer',
        name: '连接器 · 新建 MCP 抽屉',
        protoSteps: [
          ...protoModule('mcp'),
          ...protoConnTab('mcp'),
          { click: '.toolbar button.primary' },
          { waitFor: '.mask.open section.drawer' },
          { waitTimeout: 400 }
        ],
        protoMask: '.mask.open',
        appUrl: '/admin/connector?tab=mcp',
        appSteps: [
          { waitFor: '.connector-body .list-toolbar' },
          { click: '.connector-body .list-toolbar .lt-create' },
          { waitFor: '.de-drawer.open .el-drawer__body' },
          { waitTimeout: 500 }
        ],
        appRoot: '.el-overlay.is-drawer',
        containers: drawerContainers('x')
      }),

      // ────────────────────────────────────────────────────────────
      // ⑰ 模型列表页
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'models',
        name: '模型 · 列表页',
        protoSteps: protoModule('models'),
        appUrl: '/admin/models',
        appSteps: appList(),
        protoToolbar: '.module-toolbar',
        protoTable: 'table.module-table',
        protoPager: '.fm5-pager',
        protoTag: 'tbody span.tag',
        extraContainers: {
          // 【同一个「连接正常」标签，两个模块的原型类名不一样】
          // 连接器 MCP 页是 .status-connection，模型页是 .verify —— 实测所得。
          // 首跑只写 .status-connection 时，模型页这一行「原型侧未命中」。
          健康标签: { proto: 'tbody .status-connection, tbody .verify', app: '.el-table__body-wrapper .health-tag' }
        }
      }),

      // ⑱ 模型 · 接入抽屉（T2 验证点）
      drawerUnit({
        key: 'modelsDrawer',
        name: '模型 · 接入模型抽屉',
        protoSteps: [
          ...protoModule('models'),
          { click: '[data-action="model-new"]' },
          { waitFor: '.mask.open section.drawer' },
          { waitTimeout: 400 }
        ],
        protoMask: '.mask.open',
        appUrl: '/admin/models',
        appSteps: [
          ...appList(),
          { click: '.list-toolbar .lt-create' },
          { waitFor: '.de-drawer.open .el-drawer__body' },
          { waitTimeout: 500 }
        ],
        appRoot: '.el-overlay.is-drawer',
        containers: drawerContainers('x')
      })
    ]
  })(),

  // ══════════════════════════════════════════════════════════════════
  // 【第三批：治理/组织域 · 2026-09-10 扩配置】
  // ══════════════════════════════════════════════════════════════════
  //
  // 覆盖八个模块：岗位【列表页】/ 岗位管理 / 我的申请 / 审核中心 /
  // 用户技能审核 / 字段字典 / 用户 / 角色与权限。
  // 每个模块拆「列表屏」+（有抽屉/弹窗的）「抽屉·弹窗屏」两类单元。
  //
  // ── 本批的原型侧实测结论（坑 3：全部来自浏览器最终 DOM，未读源码）──
  //
  // (1) 八个 data-module 入口【全部存在】，无一「原型缺失」。实测一览：
  //     positions / position-assignments / my-applications / review-center /
  //     skillAudit / field-dictionary / users / roles。
  //
  // (2) 原型骨架分【两代】，混在一起，不能套一份模板：
  //     - 老代（module- 系）：岗位 / 用户技能审核 / 用户 / 角色
  //       → .module-toolbar + .table-wrap + table.table + .fm5-pager
  //     - 新代（fm5- 系）：岗位管理 / 我的申请 / 审核中心
  //       → .fm5-toolbar + .table-wrap + table.fm5-table + .fm5-pager
  //     状态标签同样分代：老代 .tag.yellow / .status-switch / .tag.gray，
  //     新代统一 .fm5-tag（.green/.orange/.blue/.gray）。
  //
  // (3) 【字段字典两侧都没有表格/工具栏/分页】。原型是
  //     section.fm5-field-group（组头 + .fm5-field-card 卡片），
  //     现状是 .conn-list > .aps-group（.aps-group-head + .aps-group-body）。
  //     所以它【不能走 listUnit 模板】，单独写容器映射，不硬凑表格选择器。
  //
  // (4) 【原型侧三处「有按钮但没接实现」】—— 点了不出任何抽屉/弹窗，
  //     属 README 说的「原型缺失」，如实记录，不硬凑选择器、不加对应单元：
  //       - 岗位「＋ 新建岗位」[data-action="position-new"]：点击后 DOM 无变化
  //       - 岗位管理「修改绑定」[data-five-action="pa-edit"]：同上
  //         （现状侧是有的：.el-dialog 改绑弹窗）
  //       - 字段字典「✎ 编辑」[data-five-action="field-edit"]：同上
  //     → 这三处只保留列表屏单元，抽屉屏不做。
  //
  // (5) 原型侧【真正能打开的四个壳】（本批 T2 验证点就靠它们）：
  //       - 用户技能审核「风险设置」 → #drawer（.drawer-head/body/foot）
  //       - 我的申请「查看」        → #drawer.readonly
  //       - 审核中心「查看」        → #drawer.readonly
  //       - 角色「＋ 新建角色」      → #drawer
  //       - 用户「＋ 新建用户」      → .modal-mask.open > section.modal.wide（弹窗，非抽屉）
  //
  // ── 现状侧陷阱（坑 1 在本批的化身）────────────────────────────
  //
  // (A) 【岗位管理页的页签正文不在 el-tab-pane 里】。实测
  //     `.el-tab-pane` 共 2 个、可见 0 个；真正可见的正文是它旁边的
  //     `.pm-pane-assignments`（v-if 兄弟节点，不是 EP 的 pane）。
  //     同时 DOM 里 .el-table 有 2 个、.list-pager 有 2 个，各只有 1 个可见。
  //     → 本批把该页所有选择器【一律限定在 .pm-pane-assignments 下】，
  //       不依赖 pickVisible 兜底，让配置本身自解释。
  //
  // (B) 现状侧八个页面里七个共用 .list-page 骨架
  //     （.page-header / .list-toolbar / .table-wrap / .list-pager），
  //     抽屉共用 DrawerEditor（.de-drawer + .el-drawer__header/__body/__footer）。
  //     所以【系统性差异会成批复现】—— 这正是本轮扫描最该看的产出。
  // ══════════════════════════════════════════════════════════════════
  ...(() => {
    // ── 原型侧进入路径（结构选择器，实测最终生效 DOM）──
    const protoModule = (m) => [
      { click: `button[data-module="${m}"]` },
      { waitFor: '.page .page-head' },
      { waitTimeout: 300 }
    ]

    // ── 现状侧列表页就绪：等骨架真的有尺寸（不是等 attached，见坑 1）──
    const appList = (extra = []) => [
      { waitFor: '.list-page .page-header' },
      ...extra,
      { waitTimeout: 400 }
    ]

    /**
     * 「列表屏」单元生成器（治理/组织域版）。
     *
     * 与第二批的 listUnit 分开写，不复用——因为本批原型骨架分老代/新代两套，
     * 且岗位管理页的现状侧选择器全部要加 .pm-pane-assignments 前缀，
     * 硬塞进上一批的模板反而更难读。DEMO 工程以「研发读得懂」为准（见根 CLAUDE.md 大原则）。
     *
     * @param cfg.protoToolbar  原型工具栏（老代 .module-toolbar / 新代 .fm5-toolbar）
     * @param cfg.protoTable    原型表格（table.position-table / table.fm5-table / …）
     * @param cfg.protoTag      原型状态标签（老代与新代类名不同，见上文 (2)）
     * @param cfg.appScope      现状侧选择器前缀（仅岗位管理页需要，见上文 (A)）
     * @param cfg.hasCreate     该页是否有「新建/主操作」按钮（角色、岗位、用户、技能审核有）
     */
    const listUnit = (cfg) => {
      const S = cfg.appScope ? `${cfg.appScope} ` : ''
      const containers = {
        // 页面根 = root 本身（collect.js 会先用 root.matches 认出这一点）
        页面根: { proto: '.page', app: '.page' },
        // 现状比原型多包的一层：原型 .page 直接放页头/工具栏，
        // 现状中间还有个 .list-page。单列出来，好看清「多这一层带不带留白」。
        内容层: { proto: '.page > div:last-child', app: '.list-page' },
        页头: { proto: '.page-head', app: '.page-header' },
        页头标题: { proto: '.page-head h1', app: '.page-header-title' },
        页头副文案: { proto: '.page-head p', app: '.page-header-sub' },
        工具栏: { proto: cfg.protoToolbar, app: `${S}.list-toolbar` },
        // 【搜索框/筛选下拉必须对到 __wrapper 内层】——与坑 2 的 td/.cell 同类问题。
        // Element Plus 把内距、圆角、底色、描边【全放在 .el-input__wrapper /
        // .el-select__wrapper 上】，外层的 .lt-search / .lt-filter 实测是
        // 透明、0 内距、0 圆角的裸盒子。拿它去比原型那个自带边框内距的
        // input/select，会齐刷刷报出 5 类假差异（四边 border-width 1px vs 0、
        // 四边 border-color、border-radius 8px vs 0、background 白 vs transparent、
        // 左右 padding 12px vs 0），且每类都跨 6~8 个单元复现 —— 看起来极像
        // 「系统性真差异」，实则是选错层。本批首轮实跑就是这样被带偏的。
        // 原型侧同理要往里走一层：.search 只是个裸 div 壳，
        // 边框/内距/圆角/白底全在里面的 <input class="input"> 上。
        // 两侧都对到「真正画出那个框的元素」，才是同一层的比较。
        搜索框: { proto: `${cfg.protoToolbar} .search input.input`, app: `${S}.list-toolbar .lt-search .el-input__wrapper` },
        查询按钮: { proto: `${cfg.protoToolbar} button.plain`, app: `${S}.list-toolbar .el-button:not(.el-button--primary)` },
        表格外框: { proto: '.table-wrap', app: `${S}.table-wrap` },
        表格: { proto: cfg.protoTable, app: `${S}.el-table__inner-wrapper` },
        // 行一级选择器 → 触发 collect.js 的 tr/td/.cell 三层双采（坑 2）
        表头行: { proto: `${cfg.protoTable} thead tr`, app: `${S}.el-table__header-wrapper thead tr` },
        表格首行: { proto: `${cfg.protoTable} tbody tr`, app: `${S}.el-table__body-wrapper tbody tr` },
      }
      // 分页区：原型分两代类名（新代 .fm5-pager / 老代 .pager），
      // 且【用户技能审核页原型根本没有分页】—— protoPager 传 null 就整块不采，
      // 不硬凑选择器（README：原型没实现的如实记「原型缺失」）。
      if (cfg.protoPager) {
        containers.分页区 = { proto: cfg.protoPager, app: `${S}.list-pager` }
        containers.分页信息 = { proto: `${cfg.protoPager} span`, app: `${S}.list-pager .list-pager-info` }
        containers.分页当前页按钮 = { proto: `${cfg.protoPager} .page-btn.active`, app: `${S}.list-pager .page-btn.active` }
      }
      // 筛选下拉：原型老代包了一层 .select-wrap，新代是裸 select.select；
      // 现状侧同样对到 __wrapper 内层（理由见上面「搜索框」那段注释）
      if (cfg.protoFilter !== false) {
        containers.筛选下拉 = {
          proto: `${cfg.protoToolbar} select.select`,
          app: `${S}.list-toolbar .lt-filter .el-select__wrapper`
        }
      }
      if (cfg.hasCreate) {
        containers.新建按钮 = {
          proto: `${cfg.protoToolbar} button.primary`,
          app: `${S}.list-toolbar .lt-create`
        }
      }
      if (cfg.protoTag) {
        containers.状态标签 = { proto: cfg.protoTag, app: cfg.appTag || `${S}.el-table__body-wrapper .status-tag` }
      }
      return {
        key: cfg.key,
        name: cfg.name,
        // 【root 两侧必须取同一层，否则整张表的 x 会整体偏移】
        // 本批首轮把现状 root 写成 .list-page，结果每个容器的 x 都恒差 34px ——
        // 那不是真差异，是「原型 root=.page 带 34px 内距、现状 root=.list-page
        // 在这层内距【里面】」造成的坐标系错位。
        // 实测两侧的 .page 完全同层同尺寸（1396px 宽、内距均 26/34/48/34），
        // 现状只是在 .page 里多包了一层 .list-page（自身内距全 0）。
        // → 两侧 root 一律取 .page。
        proto: { steps: cfg.protoSteps, root: '.page' },
        app: { url: cfg.appUrl, steps: cfg.appSteps || appList(), root: '.page' },
        containers: { ...containers, ...(cfg.extraContainers || {}) }
      }
    }

    /**
     * 「抽屉屏」的容器映射（原型 #drawer 壳 ↔ 现状共享 DrawerEditor）。
     * 【T2 豁免的验证点就在「抽屉正文」这一行】：
     * 上一轮 T2 报 0 命中并被标「⚠️ 可能已失效/多余」，但那轮 6 个单元一个抽屉都没跑，
     * 0 命中什么也证明不了（README「豁免自证」的第二种情况：该扩配置而非该删豁免）。
     */
    const drawerContainers = {
      抽屉体: { proto: 'section.drawer', app: '.de-drawer' },
      抽屉头: { proto: '.drawer-head', app: '.el-drawer__header' },
      抽屉标题: { proto: '.drawer-head h2', app: '.de-head-title' },
      抽屉正文: { proto: '.drawer-body', app: '.el-drawer__body' },
      首张分区卡: { proto: '.section-card', app: '.section-card' },
      分区标题: { proto: '.section-title', app: '.section-title' }
    }

    return [
      // ────────────────────────────────────────────────────────────
      // ⑲ 岗位 · 列表页（注意：不是详情页，详情在第一批 ①~⑥）
      // 原型表格是 table.table.position-table（老代骨架）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'positionsList',
        name: '岗位 · 列表页',
        protoSteps: protoModule('positions'),
        appUrl: '/admin/positions',
        protoToolbar: '.module-toolbar',
        protoTable: 'table.position-table',
        protoPager: '.fm5-pager',
        // 岗位行内状态标签实测是 .status-neutral.status-live（与专家同代）
        protoTag: 'tbody .position-name-line .status-neutral',
        appTag: '.el-table__body-wrapper .pos-name-line .status-tag',
        hasCreate: true,
        extraContainers: {
          // 岗位名首格：两侧都是「图标 + 名称 + 状态」的复合排版，容易各内缩一次
          岗位名主区: { proto: 'tbody .position-primary', app: '.el-table__body-wrapper .pos-primary' },
          // 分页在现状侧被 .pos-foot 又包了一层（其余七页没有），单独采出来
          分页外框: { proto: '.fm5-pager', app: '.pos-foot' }
        }
      }),

      // ────────────────────────────────────────────────────────────
      // ⑳ 岗位管理 · 用户岗位管理页签
      // 【坑 1 变体 A】现状侧正文在 .pm-pane-assignments（不是 el-tab-pane，
      // 实测 el-tab-pane 共 2 个、可见 0 个），所有选择器加该前缀。
      // 原型侧同样有页签（.pm-tabs），默认停在 assignments，无需点击。
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'posAssignments',
        name: '岗位管理 · 用户岗位管理页签',
        protoSteps: [
          ...protoModule('position-assignments'),
          { waitFor: '.pm-tabs .pm-tab.active' },
          { waitTimeout: 250 }
        ],
        appUrl: '/admin/position-assignments',
        appSteps: appList([{ waitFor: '.pm-pane-assignments .el-table' }]),
        appScope: '.pm-pane-assignments',
        protoToolbar: '.fm5-toolbar',
        protoTable: 'table.fm5-table',
        protoPager: '.fm5-pager',
        protoTag: 'tbody .fm5-tag',
        extraContainers: {
          页签栏: { proto: '.pm-tabs', app: '.pm-tabs .el-tabs__header' },
          当前页签: { proto: '.pm-tabs .pm-tab.active', app: '.pm-tabs .el-tabs__item.is-active' },
          页签计数徽标: { proto: '.pm-tabs .pm-count', app: '.pm-tabs .pm-count' }
        }
      }),

      // ㉑ 岗位管理 · 修改绑定弹窗（现状有、原型无实现）
      // 【原型缺失】[data-five-action="pa-edit"] 点击后 DOM 无任何变化，
      // 故不加该单元（硬凑选择器只会产出「容器未命中」噪声）。见上文 (4)。

      // ────────────────────────────────────────────────────────────
      // ㉒ 我的申请 · 列表页（新代 fm5- 骨架）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'myApplications',
        name: '我的申请 · 列表页',
        protoSteps: protoModule('my-applications'),
        appUrl: '/admin/my-applications',
        protoToolbar: '.fm5-toolbar',
        protoTable: 'table.my-app-table',
        protoPager: '.fm5-pager',
        protoTag: 'tbody .fm5-tag',
        extraContainers: {
          // 首格是「名称 + 描述」两行排版，两侧都容易差一档行距
          申请对象名: { proto: 'tbody .fm5-name', app: '.el-table__body-wrapper .ma-name' },
          申请对象描述: { proto: 'tbody .fm5-desc', app: '.el-table__body-wrapper .ma-desc' }
        }
      }),

      // ㉓ 我的申请 · 查看抽屉（T2 验证点）
      {
        key: 'myApplicationsDrawer',
        name: '我的申请 · 查看抽屉',
        proto: {
          steps: [
            ...protoModule('my-applications'),
            { click: '[data-five-action="myapp-view"]' },
            { waitFor: '#drawer .drawer-body' },
            { waitTimeout: 400 }
          ],
          // 原型这个抽屉直接挂在 body 上、没有可见遮罩层，root 取抽屉本身
          root: '#drawer'
        },
        app: {
          url: '/admin/my-applications',
          steps: [
            ...appList(),
            { click: '.ma-ops .el-button' },
            { waitFor: '.de-drawer .el-drawer__body' },
            { waitTimeout: 500 }
          ],
          // 【root 两侧必须取同一层】原型 root 取 #drawer 本人（抽屉自身 x=820），
          // 现状若取 .el-overlay（整屏遮罩，x=0），抽屉在它里面 x 就是 820 ——
          // 于是每个容器的 x 会恒差 820px，整张表都是假差异。本批首轮实测踩到。
          // → 现状 root 同样取抽屉本人 .de-drawer（实测两侧 rect 都是 x=820 width=780）。
          root: '.de-drawer'
        },
        containers: drawerContainers
      },

      // ────────────────────────────────────────────────────────────
      // ㉔ 审核中心 · 列表页（新代 fm5- 骨架）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'reviewCenter',
        name: '审核中心 · 列表页',
        protoSteps: protoModule('review-center'),
        appUrl: '/admin/review',
        protoToolbar: '.fm5-toolbar',
        protoTable: 'table.fm5-table',
        protoPager: '.fm5-pager',
        protoTag: 'tbody .fm5-tag',
        extraContainers: {
          审核对象名: { proto: 'tbody .fm5-name', app: '.el-table__body-wrapper .rev-name' },
          审核对象描述: { proto: 'tbody .fm5-desc', app: '.el-table__body-wrapper .rev-desc' }
        }
      }),

      // ㉕ 审核中心 · 查看抽屉（T2 验证点）
      {
        key: 'reviewCenterDrawer',
        name: '审核中心 · 查看抽屉',
        proto: {
          steps: [
            ...protoModule('review-center'),
            { click: '[data-five-action="review-view"]' },
            { waitFor: '#drawer .drawer-body' },
            { waitTimeout: 400 }
          ],
          root: '#drawer'
        },
        app: {
          url: '/admin/review',
          steps: [
            ...appList(),
            { click: '.rev-ops .el-button' },
            { waitFor: '.de-drawer .el-drawer__body' },
            { waitTimeout: 500 }
          ],
          // 【root 两侧必须取同一层】原型 root 取 #drawer 本人（抽屉自身 x=820），
          // 现状若取 .el-overlay（整屏遮罩，x=0），抽屉在它里面 x 就是 820 ——
          // 于是每个容器的 x 会恒差 820px，整张表都是假差异。本批首轮实测踩到。
          // → 现状 root 同样取抽屉本人 .de-drawer（实测两侧 rect 都是 x=820 width=780）。
          root: '.de-drawer'
        },
        containers: drawerContainers
      },

      // ────────────────────────────────────────────────────────────
      // ㉖ 用户技能审核 · 列表页（老代 module- 骨架）
      // 主操作按钮是「风险设置」而不是「新建」，但同样命中 .primary / .lt-create
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'userSkillReviews',
        name: '用户技能审核 · 列表页',
        protoSteps: protoModule('skillAudit'),
        appUrl: '/admin/user-skill-reviews',
        protoToolbar: '.module-toolbar',
        protoTable: 'table.audit-table',
        // 【原型缺失】用户技能审核页原型【根本没有分页区】（.pager/.fm5-pager 均 0 命中），
        // 现状是有的（.list-pager）。传 null 让分页三项整块不采，不硬凑选择器。
        protoPager: null,
        // 老代标签：审核状态 .tag.yellow、审核尺度 .tag.blue
        protoTag: 'tbody span.tag',
        appTag: '.el-table__body-wrapper .usa-tag',
        hasCreate: true,
        extraContainers: {
          技能名: { proto: 'tbody .cell-title', app: '.el-table__body-wrapper .usr-name' },
          技能描述: { proto: 'tbody .skill-description', app: '.el-table__body-wrapper .usr-desc' }
        }
      }),

      // ㉗ 用户技能审核 · 风险设置抽屉（T2 验证点）
      {
        key: 'userSkillReviewsDrawer',
        name: '用户技能审核 · 风险设置抽屉',
        proto: {
          steps: [
            ...protoModule('skillAudit'),
            { click: '[data-action="skill-audit-risk-settings"]' },
            { waitFor: '#drawer .drawer-body' },
            { waitTimeout: 400 }
          ],
          root: '#drawer'
        },
        app: {
          url: '/admin/user-skill-reviews',
          steps: [
            ...appList(),
            { click: '.list-toolbar .usr-risk-btn' },
            { waitFor: '.de-drawer .el-drawer__body' },
            { waitTimeout: 500 }
          ],
          // 【root 两侧必须取同一层】原型 root 取 #drawer 本人（抽屉自身 x=820），
          // 现状若取 .el-overlay（整屏遮罩，x=0），抽屉在它里面 x 就是 820 ——
          // 于是每个容器的 x 会恒差 820px，整张表都是假差异。本批首轮实测踩到。
          // → 现状 root 同样取抽屉本人 .de-drawer（实测两侧 rect 都是 x=820 width=780）。
          root: '.de-drawer'
        },
        containers: {
          ...drawerContainers,
          // 【原型这个抽屉的分区标题不是 .section-title】：实测是行内样式写死的
          // <h4 style="font-size:14px;font-weight:500;margin:0 0 12px">，
          // 与其余抽屉的 .section-title 不同源（原型多层覆写的老代遗留，坑 3）。
          // 照最终生效态写 h4，不套通用类名。
          分区标题: { proto: '.section-card > h4', app: '.section-title' }
        }
      },

      // ────────────────────────────────────────────────────────────
      // ㉘ 字段字典 · 卡片组页
      // 【两侧都没有工具栏/表格/分页】，不能套 listUnit（见上文 (3)）。
      // 原型 section.fm5-field-group ↔ 现状 .aps-group。
      // ────────────────────────────────────────────────────────────
      {
        key: 'fieldDictionary',
        name: '字段字典 · 卡片组页',
        proto: {
          steps: [
            ...protoModule('field-dictionary'),
            { waitFor: '.fm5-field-group' },
            { waitTimeout: 250 }
          ],
          root: '.page'
        },
        app: {
          url: '/admin/field-management',
          steps: appList([{ waitFor: '.conn-list .aps-group' }]),
          // 两侧 root 同取 .page（理由同 listUnit 里那段：root 错层会让 x 整体偏移）
          root: '.page'
        },
        containers: {
          页面根: { proto: '.page', app: '.page' },
          内容层: { proto: '.page', app: '.list-page' },
          页头: { proto: '.page-head', app: '.page-header' },
          页头标题: { proto: '.page-head h1', app: '.page-header-title' },
          页头副文案: { proto: '.page-head p', app: '.page-header-sub' },
          // 【原型这里没有卡片组的外层容器】：.fm5-field-group 直接是 .page 的子 section，
          // 现状则多包了一层 .conn-list。为了不硬凑，原型侧就填 .page 本身，
          // 差异表里读出来的就是「现状多这一层带了多少留白」。
          组列表容器: { proto: '.page', app: '.conn-list' },
          首个分组: { proto: '.fm5-field-group', app: '.aps-group' },
          分组头: { proto: '.fm5-field-group-head', app: '.aps-group-head' },
          分组体: { proto: '.fm5-field-group > div:last-child', app: '.aps-group-body' },
          折叠按钮: { proto: '.fm5-field-collapse', app: '.aps-group-head button' },
          首张字段卡: { proto: '.fm5-field-card', app: '.aps-group-body > div' },
          编辑链接: { proto: '.fm5-field-card button.link', app: '.aps-group-body .el-button' }
        }
      },

      // ㉙ 字段字典 · 编辑（现状有、原型无实现）
      // 【原型缺失】[data-five-action="field-edit"] 点击后 DOM 无变化，不加单元。见 (4)。

      // ────────────────────────────────────────────────────────────
      // ㉚ 用户 · 列表页（老代 module- 骨架）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'usersList',
        name: '用户 · 列表页',
        protoSteps: protoModule('users'),
        appUrl: '/admin/users',
        protoToolbar: '.module-toolbar',
        protoTable: 'table.module-table',
        // 【原型这页用老代 .pager，不是 .fm5-pager】实测：
        // <div class="pager"> 且【计数文字在按钮后面】（新代是文字在前）。
        protoPager: '.pager',
        // 用户页有两类标签：角色 .tag.gray（在 .role-tags 里）与状态 .status-switch。
        // 状态标签取「状态」列那个，角色标签另开一行采。
        protoTag: 'tbody .status-switch',
        appTag: '.el-table__body-wrapper .users-status',
        hasCreate: true,
        extraContainers: {
          角色标签容器: { proto: 'tbody .role-tags', app: '.el-table__body-wrapper .users-role-tags' },
          角色标签: { proto: 'tbody .role-tags .tag', app: '.el-table__body-wrapper .users-role-tags .status-tag' },
          // 注意：原型这里是 <td class="user-name">（行元素，会触发 collect.js 的
          // tr/td 双采、行名带 [tr]/[td] 后缀），现状是 td 里的 <span class="users-name">
          // （普通元素，不双采）。两侧行名对不上 → 报告里三条齐刷刷「未命中」。
          // 【这不是差异，是选择器层级没对齐】：原型的 td 对应现状的 td，
          // 而 .users-name 是它里面的文字节点。→ 现状侧改采同层的 td。
          用户名格: { proto: 'tbody td.user-name', app: '.el-table__body-wrapper tbody td:first-child' }
        }
      }),

      // ㉛ 用户 · 新建弹窗
      // 【与抽屉不同】原型是弹窗 .modal-mask.open > section.modal.wide，
      // 现状是 el-dialog。所以 T2（抽屉 body padding）在本单元【不该命中】——
      // 这正好是 T2 判定范围的反向验证（match() 只认选择器含 drawer 的）。
      {
        key: 'usersDialog',
        name: '用户 · 新建弹窗',
        proto: {
          steps: [
            ...protoModule('users'),
            { click: '[data-action="user-new"]' },
            { waitFor: '.modal-mask.open section.modal' },
            { waitTimeout: 400 }
          ],
          // 【root 两侧取弹窗本人，不取遮罩】原型遮罩 .modal-mask 是整屏 1600 宽、
          // 现状的 .el-overlay 实测 width=0（EP 用 transform 定位，遮罩自身不占尺寸，
          // 会被 collect.js 的 pickVisible 判为不可见 → 直接「根容器未命中」跑挂）。
          // 实测两侧的弹窗本体都是 x=540 width=520，同层可比。
          root: 'section.modal'
        },
        app: {
          url: '/admin/users',
          steps: [
            ...appList(),
            { click: '.list-toolbar .lt-create' },
            { waitFor: '.el-dialog .el-dialog__body' },
            { waitTimeout: 500 }
          ],
          root: '.el-dialog'
        },
        containers: {
          弹窗体: { proto: 'section.modal', app: '.el-dialog' },
          弹窗头: { proto: 'section.modal > h3', app: '.el-dialog__header' },
          弹窗正文: { proto: '.modal-content', app: '.el-dialog__body' },
          首个表单项: { proto: '.dialog-grid .field', app: '.el-form-item' },
          表单项标签: { proto: '.dialog-grid .field .label', app: '.el-form-item__label' },
          文本输入框: { proto: '.dialog-grid .field input.input', app: '.el-form-item .el-input__wrapper' },
          勾选卡列表: { proto: '.check-list', app: '.check-list' },
          首张勾选卡: { proto: '.check-card', app: '.check-card' }
        }
      },

      // ────────────────────────────────────────────────────────────
      // ㉜ 角色与权限 · 列表页（老代 module- 骨架，工具栏无筛选下拉）
      // ────────────────────────────────────────────────────────────
      listUnit({
        key: 'rolesList',
        name: '角色与权限 · 列表页',
        protoSteps: protoModule('roles'),
        appUrl: '/admin/roles',
        protoToolbar: '.module-toolbar',
        protoTable: 'table.role-table',
        protoPager: '.fm5-pager',
        protoFilter: false,   // 该页工具栏只有搜索 + 查询 + 新建，没有筛选下拉
        protoTag: null,       // 角色表没有状态标签列
        hasCreate: true,
        extraContainers: {
          角色名格: { proto: 'tbody td:first-child strong', app: '.el-table__body-wrapper .rl-name' },
          权限清单: { proto: 'tbody .role-perms', app: '.el-table__body-wrapper .rl-perms' },
          权限行: { proto: 'tbody .role-perm-line', app: '.el-table__body-wrapper .rl-perm-line' }
        }
      }),

      // ㉝ 角色与权限 · 新建抽屉（T2 验证点）
      {
        key: 'rolesDrawer',
        name: '角色与权限 · 新建抽屉',
        proto: {
          steps: [
            ...protoModule('roles'),
            { click: '[data-action="role-new"]' },
            { waitFor: '#drawer .drawer-body' },
            { waitTimeout: 400 }
          ],
          root: '#drawer'
        },
        app: {
          url: '/admin/roles',
          steps: [
            ...appList(),
            { click: '.list-toolbar .lt-create' },
            { waitFor: '.de-drawer .el-drawer__body' },
            { waitTimeout: 500 }
          ],
          // 【root 两侧必须取同一层】原型 root 取 #drawer 本人（抽屉自身 x=820），
          // 现状若取 .el-overlay（整屏遮罩，x=0），抽屉在它里面 x 就是 820 ——
          // 于是每个容器的 x 会恒差 820px，整张表都是假差异。本批首轮实测踩到。
          // → 现状 root 同样取抽屉本人 .de-drawer（实测两侧 rect 都是 x=820 width=780）。
          root: '.de-drawer'
        },
        containers: {
          ...drawerContainers,
          角色名输入: { proto: '.role-editor-name input.input', app: '.re-name-item .el-input__wrapper' },
          权限树: { proto: '.permission-tree', app: '.re-perm-area' },
          首个权限域: { proto: '.perm-scope', app: '.re-scope' },
          权限域头: { proto: '.perm-scope-head', app: '.re-scope-head' }
        }
      }
    ]
  })()
]

export default units
