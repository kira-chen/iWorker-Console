# 合并差距分析 A：全局壳 + 岗位列表 + 岗位管理

基准：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（下称"原型"，行号均指该文件）最终覆写生效态；代码基线为 2026-09-08 工作区（含 09-04 / 09-06 / 09-07 三轮骨架对齐结果）。只比布局与交互，字段/文案级差异不重复审（除非文案位置属于结构）。

**原型覆写层结论（本范围）**
- 全局壳：DOM L124–142 固定；CSS 三层——基础 L9–16 → "Taste" 层 L18–71（`.page{max-width:1480px;margin:0 auto}` L22、`.main{background:#f6f8f7}` L21、`.table-wrap` 变白卡 L37、th 48px/td 60px L38–39、`.drawer` 780px L42）→ 模块层 L110（`.module-toolbar`、`.rail-collapsed`）→ **L651 侧栏最终覆写**（rail 204px / #292928 / 项 36px 14px / `.rail-toggle{display:none}`）。导航点击链：基础 L188（全部 toast）→ L253（`[data-module]` 切模块，其余 toast"该模块不在本次原型范围内"）→ L327 专家/角色 → L1234 岗位 render 覆写 → L1568 五治理模块 render 覆写 + L1578–1585 navMap（岗位管理等 6 项挂 data-module）→ L1943 知识库 → L4526 用户技能审核。最终仍 toast 的导航：驾驶舱、实例与会话、运行规格、配额与限流。
- 分页：`dynPageSize` 定义两处（L146 基础层、L1546 五模块层同式），`pageSlice/pagerHtml/goPage` L1548–1551 并挂 window L1552；岗位列表 L1199 与岗位管理 L1563–1564 均走这套。
- 岗位列表：`position-list-module-lock` L1172–1257 为最终层（`renderPositions` L1197、`positionActions` L1189、`openPositionEditor` L1202、版本侧栏 L1217–1233、点击分发 L1236–1248）；上面再叠两层 capture 拦截——L1876 把【查看】【编辑】改为进详情页（`enterPosition` L1873），L2322 把【＋ 新建岗位】改为居中弹窗 `npOpen` L2319。因此 **编辑抽屉 `openPositionEditor` 在岗位列表不可达**（仅审核中心 L1724 / 我的申请 L1759 仍调用其只读态）。
- 岗位管理：`five-admin-modules` 层 L1520–1570（`assignmentTabs` L1562、`renderPositionApplications` L1563、`renderAssignments` L1564、`renderCurrent` L1567、render 覆写 L1568）+ 行为层 L1578–1683（`openAssignment` L1602、`approvePositionApplication` L1607、`rejectPositionApplication` L1608、`rebindPositionApplication` L1609、input 防抖 L1643–1650、change L1651–1658、click 分发 L1659–1682）。无更后的覆写。

---

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
| --- | --- | --- | --- |
| 侧边栏（品牌/分组/导航项/底部用户） | DOM L126–135；CSS L10 → L110 → **L651**；点击链 L253 / L1578 / L1943 / L4526 | `frontend/src/components/admin/AdminRail.vue` | 局部差异（分组/顺序/名称一致；尺寸档、当前项高亮形态、底部用户区不同） |
| 主内容容器 + 页头 | DOM L137；CSS L11 + L21–24（`.main` 底色、`.page` 限宽居中、h1 25px） | `frontend/src/layouts/AdminLayout.vue`、`frontend/src/components/PageHeader.vue` | 局部差异（无限宽居中、底色纯白、标题字号档） |
| moduleTabs 二级页签条 | DOM L137 `#moduleTabs`；除 mcp 外全部 `module-hidden`（L239、L1234、L1568） | 连接器页自带 tabs（不在本范围） | 一致（壳层无通用二级页签，符合） |
| 通用组件：工具栏 / 表格 / tag / 分页 / 抽屉 / 弹窗 / toast / 确认框 | `.module-toolbar` L110、`.table-wrap` L37–40、`.tag` L13、`pagerHtml` L1549、`.drawer` L42–48、`.modal` L15、`toastMsg` L185、`modal()` L186 | `assets/list-page.css`、`assets/theme.css`、`ListToolbar.vue`、`ListPagination.vue`、`ListStates.vue`、`DrawerEditor.vue`、EP `ElMessage/ElMessageBox` | 局部差异（形态同类；密度档、表格白卡、分页器构成与动态条数不同） |
| 岗位列表页 | `renderPositions` L1197–1201、`positionActions` L1189–1196、点击分发 L1236–1248、capture L1876 / L2322 | `frontend/src/views/admin/AdminPositions.vue` | 一致（列/工具栏/操作/流向均对齐；差分页与新建弹窗） |
| 新建岗位弹窗 | `npOpen` L2319、`npCreate` L2321、capture L2322；CSS `.proto2-dialog` L1840、`.pd2-popup-form` L2048 | `AdminPositions.vue` L612–664 | 局部差异（字段构成 3 vs 2、必填与上限、按钮文案） |
| 岗位编辑抽屉（查看/编辑/新建） | `openPositionEditor` L1202–1210、`savePosition` L1211–1216、drawerFoot L1251 | 无（代码 09-01 起走整页工作台） | 代码缺失——但**原型层不可达**（被 L1876/L2322 拦截），不算差距，见四 |
| 版本管理侧栏 | `renderPositionManager` L1225、`positionPublishHtml` L1224、`positionHistoryHtml` L1223、`submitPositionVersion` L1228、`withdrawPositionVersion` L1229、`togglePositionHistory` L1230、mask 分发 L1252–1254；CSS L397–440 | `frontend/src/components/admin/VersionDrawer.vue`、`VersionHistoryList.vue`、`DrawerEditor.vue` | 一致（两区结构、脚部、置灰规则均对齐；差提交后是否关侧栏、说明区排版） |
| 停用/删除/撤回确认弹窗 | `modal()` L186 + 分发 L1244–1247；DOM L141 | `AdminPositions.vue` L306–407（ElMessageBox） | 一致（结构同；删除多领用护栏=md 超集） |
| 岗位管理·页签条 | `assignmentTabs` L1562；CSS `.pm-tabs/.pm-count` L1515 | `AdminPositionAssignments.vue` L247–254 | 一致（差徽标配色） |
| 岗位管理·用户岗位管理页签 | `renderAssignments` L1564、input L1645、change L1652、click L1664/L1675 | `AdminPositionAssignments.vue` L257–331 | 局部差异（搜索/筛选是否重置页码、分页条构成） |
| 岗位管理·岗位申请审批页签 | `renderPositionApplications` L1563、click L1663/L1665–1667 | `AdminPositionAssignments.vue` L334–409 | 一致（原型表头 HTML 残缺，见四） |
| 修改绑定弹窗 | `openAssignment` L1602–1605、`availablePositions` L1596–1601 | `frontend/src/components/admin/UserPositionEditDialog.vue` | 局部差异（少"绑定岗位"字段标签；下拉来源口径） |
| 通过 / 驳回 / 重新绑定弹窗 | L1607 / L1608 / L1609；`openDialog` L1553；DOM L1517；CSS `.fm5-dialog` L1512 | `AdminPositionAssignments.vue` L145–232、`ReviewRejectDialog.vue` | 一致 |

---

## 二、差距清单

### A. 全局壳

#### A1. 侧边栏·尺寸档与当前项高亮形态
- 原型：L651 最终层——`.rail{width:204px;background:#292928}`、`.brand{height:54px}`（🐝 emoji + "iWorker · 管理端"）、`.nav-title{font-size:12px;font-weight:600;color:#777775;padding:3px 13px 5px}`、`.nav-item{height:36px;padding:0 13px;border-radius:8px;font-size:14px}`、`.nav-item.active{background:#5d5d5b;font-weight:600}` + `:before` 白色竖条 `top:5px;bottom:5px;width:3px`（贯穿整项）、`.nav-ic{width:18px;font-size:16px}`；分组间 `border-bottom:1px solid #41413f`（L10 `.nav-group`）。
- 代码：`AdminRail.vue` L275 `width:clamp(150px,12vw,180px)`、L259 底色 `#2b2a28`、品牌行 L287–298（logo 图 24px + 14px 文字，行高 30px）、分组标题 L389–403 `10px` + `opacity:.5`、导航项 L424 `padding:5px 12px`（约 26px 高）+ L458 label `12px`、当前项 L434–449 `rgba(255,255,255,.2)` 底 + 18px 短竖条。
- 要做：侧栏宽改 204px 固定；品牌行 54px；分组标题 12px/600；导航项 36px 高、14px 字、圆角 8px、hover `#393938`；当前项底 `#5d5d5b` + 竖条贯穿（top/bottom 5px）；分组间分隔线保留。图标继续用 EP 图标集（原型 unicode 字形只是占位，不搬）。
- 量级：小
- 与 md 的关系：md 无定义

#### A2. 侧边栏·底部用户区
- 原型：L135 `.rail-foot`（L651 `height:64px;border-top:#41413f`）= 圆头像"配" + "配置管理员"，静态无菜单。
- 代码：`AdminRail.vue` L220–248 头像+名称整行可点，向上弹 el-dropdown（用户名 / 外观切换 / 修改密码 / 退出登录）。
- 要做：仅把高度对到 64px、分隔线色对齐；下拉菜单**保留**（代码超集，原型无退出登录入口，demo 必需）。
- 量级：小
- 与 md 的关系：md 无定义

#### A3. 主内容区·限宽居中与底色
- 原型：L11 `.page{min-width:1120px;padding:26px 34px 48px}` + L22 `.page{max-width:1480px;margin:0 auto}`；L20–21 `body{background:#f4f6f5}` `.main{background:#f6f8f7}`（浅灰绿底），表格/抽屉卡片为白色浮在灰底上。
- 代码：`AdminLayout.vue` L25–31 `.main{padding:var(--space-6)}`（24px 四边），无 max-width / margin auto / min-width；底色 `--bg-app` = `#ffffff`（`tokens.css` L84）。
- 要做：`AdminLayout.vue` 主区内加一层 `.page` 容器：`max-width:1480px;min-width:1120px;margin:0 auto;padding:26px 34px 48px`；后台主区底色改为独立令牌（如 `--bg-admin-main`，浅色 `#f6f8f7`、暗色沿用 `--bg-app`），不要直接改 `--bg-app`（员工端共用）。**共享壳层改动，须先做**（所有列表页视觉随之变化）。
- 量级：小
- 与 md 的关系：md 无定义

#### A4. 页头·标题字号档与页头→内容间距
- 原型：L11 + L23–24 `h1{font-size:25px;font-weight:650;letter-spacing:-.02em}`、`p{margin:5px 0 0;font-size:15px;color:#68736d}`；页签条隐藏时 `#view{margin-top:28px}`（L110 `.page-head+.module-hidden+#view`）。
- 代码：`PageHeader.vue` L36–49 渲染 `h2`（`--fs-xl`=22px、600）+ 副标题 13px；`list-page.css` L22–33 页头→工具栏 gap 20px。
- 要做：PageHeader 标题档提到 25px/650、副标题 15px；`.list-page` gap 或页头 margin 调到 28px。全站共享。
- 量级：小
- 与 md 的关系：md 无定义

#### A5. 通用控件密度档（工具栏高度、输入/按钮高度、表格行高、表头样式）
- 原型：L110 `.module-toolbar{min-height:76px;padding:17px 0;gap:12px}`（岗位管理用 `.fm5-toolbar{min-height:76px;gap:14px}` L1512）、搜索框 300px（岗位）/260px（岗位管理，L1512）带 `⌕` 前缀；L27–33 `.input,.select{height:38px}` `.primary,.plain{height:38px}`；L38–39 `th{height:48px;background:#f2f5f3;font-size:13px}` `td{height:60px}`（岗位管理 `.fm5-table td{height:62px}` L1512）；L1740 `.table th,.table td{padding:0 16px}` `.table .ops{gap:10px}`。
- 代码：`list-page.css` L58–63 搜索 280px / 筛选 150px；EP 默认控件 32px；`theme.css` L185–190 表格仅改色不改行高（EP 默认约 48px 行）。
- 要做：`theme.css` 后台表格加 `--el-table-header-text-color` 13px、th 48px、td 60px（`.el-table .cell` 行高/padding 8px 16px）；后台内 el-input / el-select / el-button 默认尺寸提到 38px（可用 `--el-component-size` 或全局 `size="large"` 在 AdminLayout 通过 el-config-provider 注入，避免逐页改）；`.lt-search` 300px。全站共享。
- 量级：中（涉及全部列表页视觉回归截图）
- 与 md 的关系：md 无定义

#### A6. 表格外壳·白卡形态
- 原型：L37 `.table-wrap{border:1px solid #e1e6e3;border-radius:10px;background:#fff;overflow:hidden}`，表格整体是圆角白卡；L39 行 hover `#f7faf8`。
- 代码：`theme.css` L239–247 `.table-wrap` 仅 `border-top:1px solid var(--border-soft)`（2026-08-20 刻意去卡片）。
- 要做：`.table-wrap` 改回白卡（边框 `--border-base`、圆角 `--radius-lg`=8→10px、底 `--bg-surface`、`overflow:hidden`），配合 A3 灰底才成立。全站共享，与 A3 同批做。
- 量级：小
- 与 md 的关系：md 无定义

#### A7. 分页器·构成与动态条数
- 原型：`dynPageSize` L1546 = `min(30, max(5, floor((innerHeight-330)/62)))`；`pagerHtml` L1549 = 右对齐一行 `共 N 条 · 每页 X 条` + `‹` + 页码按钮组 + `›`（`.page-btn` 28px 圆角 4，当前页绿底 L13），**单页时也渲染**（`共 4 条 · 每页 10 条 ‹ 1 ›`）；翻页 `goPage` L1551 整页重渲染；窗口尺寸变化不重算（只在 render 时读高度）。
- 代码：`ListPagination.vue` L27 `total > pageSize` 才渲染；L40 layout `prev, pager, next, total`（总数在**右末**，且无"每页 X 条"）；`useAdminList.js` L56 固定 `pageSize` 20（岗位页覆盖 12，`AdminPositions.vue` L62）。岗位管理页自拼 `pa-foot-info`（L320–328、L398–406）"共 N 条 · 每页 X 条"放在**左侧**，分页条在右。
- 要做：①`ListPagination` 固化为一行右对齐：`共 N 条 · 每页 X 条` 在前、`‹ 页码 ›` 在后，单页也显示；②新增 `useDynPageSize()` composable（同式计算，mounted 时读一次；可选 resize 防抖重算）供 `useAdminList` 的 `pageSize` 初值使用；③岗位管理页删掉自拼的 `pa-foot-info`（L320–328、L398–406、CSS L466–477）改用统一组件。**共享组件，串行**；是否全站开启动态条数由负责人拍板（09-01 W-1 记录"全站待拍板"，0907 岗位管理 md 已明确"动态计算每页条数"）。
- 量级：中
- 与 md 的关系：岗位管理 md §3.2.1 / §4.1 "根据页面可用高度动态计算每页条数，底部展示总条数、每页条数和分页器"——一致；**岗位 md §二.1 写的是"页面不分页，一次展示全部"，与原型 L1199 `pageSlice(list,'positions')` 冲突**。

#### A8. 确认弹窗（modal）·形态
- 原型：L141 DOM + L15 CSS：居中 `min(440px)` 白卡、圆角 8、`h3` 标题 + `p` 正文（无图标）+ 右对齐 `取消`(plain) / 确认(primary 绿，**不按危险/警告变色**)；`modal()` L186 单一入口，停用有领用时也用同壳（`'知道了'` 为确认键 + 仍带取消键 L1245）。
- 代码：`ElMessageBox.confirm(type:'warning')` 带警告图标，删除/停用确认键分别 `el-button--danger` / `el-button--warning`（`AdminPositions.vue` L350、L392）；领用护栏用 `ElMessageBox.alert` 单键（L338–342、L381–385）。
- 要做：去掉 `type:'warning'` 图标、确认键统一 primary（或做一个 `useConfirm` 包装固定 440px 宽 + 无图标）。危险/警告配色是代码约定，建议保留但需负责人认可（原型全绿）。
- 量级：小
- 与 md 的关系：md 无定义

#### A9. 抽屉外壳·宽度与底色
- 原型：L42–48 `.drawer{width:min(780px,88vw);background:#f5f7f6}`、头 66px 毛玻璃白、body `padding:22px 28px 34px` 内为 `.section-card` 白卡（L49–51）、脚 66px；版本侧栏另一套 `.skill-version-drawer{width:min(720px,82vw)}` 白底（L399）。
- 代码：`DrawerEditor.vue` L47 默认 `size:'720px'`，`theme.css` L338–344 白底、头部下分隔线。
- 要做：DrawerEditor 默认 780px、body 底 `#f5f7f6`（灰底+白卡由各编辑器 section-card 承担，属其他路范围）；VersionDrawer 保持 720 白底（与原型版本侧栏一致，不动）。
- 量级：小
- 与 md 的关系：md 无定义

#### A10. 空态形态
- 原型：L13 `.empty{height:340px;display:grid;place-items:center;color:#999}` 纯文字居中，无插图；岗位管理审批页签 `.empty strong + span`（L1515）双行。
- 代码：`ListStates.vue` L40–47 `el-empty :image-size="96"` 带插图。
- 要做：ListStates 空态改为纯文字 340px 居中（主文案 + 可选副文案），或 `image-size` 设 0 并去 EP 默认图。全站共享。
- 量级：小
- 与 md 的关系：md 无定义

#### A11. 导航项"规划中"占位页
- 原型：驾驶舱 / 实例与会话 / 运行规格 / 配额与限流 无 data-module，点击仅 toast"该模块不在本次原型范围内"（L253），当前项不切换。
- 代码：`router/index.js` L236–272 四项各挂 `AdminComingSoonPlaceholder.vue`（运行规格已是真页 `AdminRuntimeSpecs.vue`）并高亮。
- 要做：不搬（原型是占位 toast）；保留占位页。
- 量级：无
- 与 md 的关系：md 无定义（04 运行 md 本版再次缺失，见 01-改动记录）

### B. 岗位列表页

#### B1. 岗位列表·分页方式
- 原型：L1199 `pageSlice(list,'positions')` + L1200 `pagerHtml('positions',totalPos)`，动态条数（A7）。
- 代码：`AdminPositions.vue` L61–64 固定 `pageSize: 12`；L591–598 单页不显分页条。
- 要做：接 A7 的 `useDynPageSize`；去掉 12 的页面级覆盖。
- 量级：小（依赖 A7）
- 与 md 的关系：**与 md 冲突（岗位 md §二.1 写的是"页面不分页，一次展示当前查询条件下的全部岗位"）**；原型 = 动态分页；代码 = 固定 12。三方三口径，须拍板。

#### B2. 新建岗位·弹窗形态与字段构成
- 原型：L2322 capture 拦截【＋ 新建岗位】→ `npOpen` L2319：`.proto2-dialog` 居中 `min(520px)`（L1840：头 60px 标题 + `×`，body `padding:20px 22px`，脚 62px），表单 `.pd2-popup-form`（L2048 单列 grid）= **岗位名称\***（input maxlength 64）+ **岗位描述\***（textarea rows 4 maxlength 2000）；脚 `取消` + `创建岗位`(primary)。校验 L2321：名称空→红框+toast"请填写岗位名称"，描述空→红框+toast"请填写岗位描述"；成功→列表头插入、关窗、**直接进详情页人格页签**（`state.positionDetailId=id`）+ toast"岗位已创建，请完善岗位配置"；Esc 关窗 L2325，点遮罩关窗 L2323。
- 代码：`AdminPositions.vue` L612–664 `el-dialog width 460`，`:close-on-click-modal=false`（点遮罩不关）；字段 = 岗位名称（必填 64）+ **岗位定位**（textarea 2 行 100 字，原型无）+ 岗位描述（**可选**，500 字）；脚 `取消` + `创建并配置`；成功 → `router.push PositionWorkbench`（L168）。
- 要做：弹窗宽 520；去掉"岗位定位"字段（或按 md 决定去留——md §三.1.1 只说"填写基本信息"）；岗位描述改必填、上限 2000；按钮文案"创建岗位"；允许点遮罩关闭。校验方式（内联红框 vs toast）保留代码内联。
- 量级：小
- 与 md 的关系：**与 md 冲突（岗位 md §一.1 / §三.1.1 写的是"从页面右侧打开新建岗位抽屉"，原型是居中弹窗）**；字段级冲突（定位字段、描述上限）交 02-审查底账。

#### B3. 列表【发布】·点击流向
- 原型：L1243 `position-publish`：`skillIds.length===0` → toast"至少关联 1 个岗位私有技能才能发布"并停止；否则 **直接 `openPositionManager(r)`** 打开版本管理侧栏（无中间确认窗）。
- 代码：`AdminPositions.vue` L247–254 `onPublish` 同流向（warning toast → 版本侧栏）。
- 要做：无需改（已对齐原型）。
- 量级：无
- 与 md 的关系：**与 md 冲突（岗位 md §二.3.3 写的是"点击后打开发布前检查弹窗…任一未完成时自动定位到人格页签并展示具体缺失项"）**——原型无发布前检查弹窗，代码 = 原型。留待拍板。

#### B4. 版本管理侧栏·提交后是否关闭
- 原型：`submitPositionVersion` L1228：提交成功 → `closePositionManager()` 关侧栏 → 若编辑抽屉开着一并关 → 重渲染列表 → toast"已提交发布 vX.Y.Z，进入审核"。
- 代码：`VersionDrawer.vue` L137–159 `submitPublish` 成功后仅 `emit('done')`，侧栏**留在原地**并切到"审核中 + 撤回提交"态（`AdminPositions.vue` L368–373 回写行）。
- 要做：岗位 adapter 增加 `closeOnSubmit: true`（VersionDrawer 在 done 后 `visible=false`），技能/专家默认行为不变。
- 量级：小
- 与 md 的关系：md 无定义

#### B5. 版本管理侧栏·发布表单排版细节
- 原型：`positionPublishHtml` L1224：更新类型为 `.version-bump-group` 分段按钮（L416–418，34px、相邻无缝、选中绿软底）；`.version-notes` 为 **左标签 64px + 右控件** 的 grid（L421），控件下方一行左"错误提示 / 右 `N / 2000` 计数"（`.version-notes-meta`）；审核中态 `.version-review` 橙边浅黄框（L428）+ 内置 plain 按钮"撤回提交"；撤回用 `window.confirm` L1229。
- 代码：`VersionDrawer.vue` L359–363 `el-radio-group` + `el-radio-button`（形态相近，可保留）；L372–386 升级说明标签在上、`show-word-limit` 计数在 textarea 内右下、错误另起一行；审核中态 L389–394 无框、按钮 `type=warning plain` 右对齐；撤回走 ElMessageBox。
- 要做：升级说明改左右 grid（标签 64px）、计数移到控件外与错误同一行；审核中提示加浅黄边框卡；撤回按钮改 plain 默认色（原型 `.plain`）。
- 量级：小
- 与 md 的关系：md 无定义（md §二.3.7 只定义版本号规则）

#### B6. 列表行·名称格图标尺寸
- 原型：L1200 `.expert-avatar`（L275：32px、圆角 8、底 `#eef5f1`、字号 18）+ `.position-name-text`（600）+ 状态 pill。
- 代码：`AdminPositions.vue` L698–711 `.pos-icon` 22px 圆形。
- 要做：图标框改 32px 圆角 8（与专家列表同款）。
- 量级：小
- 与 md 的关系：md 无定义

#### B7. 列表·列宽策略与操作列固定
- 原型：L1200 `<colgroup>` 固定列宽 250/300/70/80/80/100/165/300 + `.position-table{min-width:1345px}` L1156，`table-layout:fixed`，表格在白卡内横向滚动；操作列不固定。
- 代码：`AdminPositions.vue` L462–521 `COL.NAME_MIN/DESC_MIN/COUNT/TIME` + `opsWidth(OPS_MAX)`，操作列 `fixed="right"`。
- 要做：不搬固定 colgroup（代码列宽单一真相源更稳）；`fixed="right"` 保留（代码超集）。仅把操作列宽对到能容 4 键（原型 300px 含"测试"以外 4 键）。
- 量级：无 / 小
- 与 md 的关系：md 无定义

#### B8. 停用护栏弹窗·按钮构成
- 原型：L1245 `modal('停用岗位','当前有 N 个用户领用…','知道了',fn)` → 壳固定含 `取消` + `知道了` 两键。
- 代码：`AdminPositions.vue` L338–342 `ElMessageBox.alert` 单键"知道了"。
- 要做：不搬（原型多出的"取消"是 modal 壳副作用，单键更合理）。
- 量级：无
- 与 md 的关系：md §二.3.5 只定义提示文案——一致

### C. 岗位管理页

#### C1. 用户岗位管理·搜索/筛选是否重置页码
- 原型：L1645 `paSearch` input → 220ms 防抖 `renderAssignments()`，**不改 `pageState.assignments`**（`pageSlice` L1548 仅在越界时回落到末页）；L1652 `paStatus` change → 同样不重置；L1675 `pa-query` 才 `pageState.assignments=1`。
- 代码：`AdminPositionAssignments.vue` L106–116 关键词 300ms 防抖 → `reload()`（L78–81 = `list.search()` **回第 1 页**）；L272 状态切换也 `reload` 回第 1 页；【查询】L278 同 `reload`。
- 要做：新增 `keepPage` 路径：关键词/状态变化调用 `list.reload()`（不重置页码，`useAdminList` 已有越界回退 L91–95），仅【查询】走 `list.search()`；防抖 220ms。
- 量级：小
- 与 md 的关系：一致（岗位管理 md §3.1 明确"不重置分页…查询按钮回到第 1 页"）

#### C2. 用户岗位管理·分页条构成
- 原型：L1564 末尾 `pagerHtml('assignments',n)` = 右对齐 `共 N 条 · 每页 X 条 ‹ 1 2 ›`，单页也显示。
- 代码：L320–328 `pa-foot` 左"共 N 条 · 每页 X 条" + 右 `ListPagination`（单页隐藏）；L466–477 自定样式。
- 要做：随 A7 收编到统一 `ListPagination`，删本页自拼。
- 量级：小（依赖 A7）
- 与 md 的关系：一致

#### C3. 页签条·徽标配色与页签文案
- 原型：L1515 `.pm-tabs`（下边线、gap 28、tab 52px、600 字重、active 绿字 + 2px 绿下划线）；`.pm-count` 橙软底 `#fff1de/#a85f06` 19px 圆角 10。页签文案"用户岗位管理"/"岗位申请审批"。
- 代码：L247–254 `el-tabs`（EP 下划线形态相近）；L446–457 `.pm-count` 绿底 `--c-accent` 白字；页签一文案"用户岗位分配"。
- 要做：徽标改橙软底（用 `--c-warning-soft`/warning 字色）；页签文案改"用户岗位管理"（0907 版 md/原型均已改，属文案但在页签结构内，一并做）。
- 量级：小
- 与 md 的关系：一致（md §二 表格"用户岗位管理"）

#### C4. 修改绑定弹窗·字段标签
- 原型：`openAssignment` L1604 body = `p.fm5-dialog-hint`（为 X 选择绑定岗位…）→ **`label.form-label` "绑定岗位"** → `select` 100% → `p.fm5-dialog-hint`（换绑提示，margin-top 14）；宽 440；脚 `取消` + `保存`。
- 代码：`UserPositionEditDialog.vue` L72–89 同序但**无"绑定岗位"标签**，宽 440。
- 要做：select 上方补 `label` "绑定岗位"。
- 量级：小
- 与 md 的关系：md §3.3 "绑定岗位为单选下拉框"——一致

#### C5. 修改绑定弹窗·下拉可选岗位口径
- 原型：`availablePositions` L1596–1601 意图 = 仅 `published` 岗位，但读取的 `window.positionRows` 从未赋值（岗位模块只挂 `window.positionReviewProto.positionRows` L1256）→ **永远走 fallback 静态 4 项**（经营分析师/客户运营专员/合同审阅专员/产品运营专员，与岗位列表名称不一致）。
- 代码：`AdminPositionAssignments.vue` L93–101 `listPositions({status:'published'})` 仅已发布。
- 要做：按 md 扩为"已发布 + 审核中"（mock 层 `status in ['published','reviewing']`）；不搬原型 fallback。
- 量级：小
- 与 md 的关系：**与 md 冲突（代码/原型意图 = 仅已发布；岗位管理 md §3.3 / §五 写的是"已发布及审核中的岗位"）**——md 为新口径，原型是死代码，建议按 md。

#### C6. 重新绑定回跳·置顶高亮
- 原型：`rebindPositionApplication` L1609 → 保存后 `paTab='assignments'`、`paFocusUserId`、清关键词/状态 → `renderAssignments` L1564 把该用户排到首位、`pageState.assignments=1`、随后清空 focus（一次性），**无行高亮**。
- 代码：L211–232 同流向；L89–91 + L462–464 额外给该行 `pa-row-focus` 底色高亮，直到下一次查询/翻页清除。
- 要做：不改（代码超集，高亮有助识别）。
- 量级：无
- 与 md 的关系：md §4.3.3 "置顶高亮聚焦"——代码更贴 md

#### C7. 通过 / 驳回弹窗·尺寸
- 原型：`openDialog` L1553 默认 `.fm5-dialog{width:min(520px,94vw)}`（头 58px 标题 + ×，body 20px，脚 60px）；通过弹窗 L1607、驳回弹窗 L1608 均用默认 520。
- 代码：通过 = `ElMessageBox.confirm`（约 420px、带 × 无 warning 图标——L147–154 未传 type，正确）；驳回 = `ReviewRejectDialog` 480px。
- 要做：驳回弹窗宽 520；通过弹窗可保持 MessageBox（结构同：正文 + 灰提示 + 取消/确认通过）。
- 量级：小
- 与 md 的关系：md 无定义（仅定义文案与按钮）

#### C8. 申请审批·工具栏
- 原型：L1563 页签条下**直接是表格**，无搜索/筛选。
- 代码：L334–409 同，无工具栏。
- 要做：无。
- 量级：无
- 与 md 的关系：一致

---

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件 | 说明 |
| --- | --- | --- |
| 侧栏底部用户菜单（外观切换 / 修改密码 / 退出登录） | `components/admin/AdminRail.vue` L220–248 | 原型 L135 静态头像+名 |
| 侧栏按页面权限逐项显隐（`itemVisible`） | `AdminRail.vue` L144–155 | 原型全量常显 |
| 侧栏自滚动、图标集（EP icons） | `AdminRail.vue` L355–374 | 原型 unicode 字形占位 |
| 规划中占位页（驾驶舱 / 实例与会话 / 配额与限流） | `views/admin/AdminComingSoonPlaceholder.vue`、`router/index.js` L236–272 | 原型仅 toast |
| 运行规格真页 | `views/admin/AdminRuntimeSpecs.vue` | 原型 toast |
| 列表四态：loading 延迟遮罩、加载失败+重试 | `AdminPositions.vue` L71–78、`ListStates.vue` | 原型无加载/失败态 |
| 取数竞态防护 / 防空页回退 | `composables/useAdminList.js` L69–103 | 原型纯内存 |
| 岗位列表【测试】入口（flag 关闭） | `AdminPositions.vue` L535–537、L191–236 | 原型无 |
| 删除岗位领用护栏 | `AdminPositions.vue` L376–387 | 原型 L1247 无护栏（md §二.3.6 有）|
| 操作列 `fixed="right"` | `AdminPositions.vue` L521 | 原型无固定列 |
| 版本侧栏骨架屏 / 失败重试 / 按钮 loading | `VersionDrawer.vue` L188–212、`VersionHistoryList.vue` L60–70 | 原型同步渲染 |
| 重新绑定回跳行高亮 | `AdminPositionAssignments.vue` L89–91、L462–464 | 原型仅置顶 |
| 审批动作后徽标计数联动刷新 | `AdminPositionAssignments.vue` L138–142 | 原型重渲染顺带 |
| 修改绑定"未变化直接关窗不打扰" | `UserPositionEditDialog.vue` L49–53 | 原型总是保存 |
| 全局禁用弹窗 Esc（`disableDialogEsc`） | `main.js` L17、`utils/disableDialogEsc.js` | 原型 Esc 可关版本侧栏（L1255）与新建弹窗（L2325）——**代码约定与原型相反**，属 demo 既定决策，列此备查 |

---

## 四、原型侧缺陷（合并时不应照搬）

1. **岗位编辑/查看/新建抽屉是死层**：`openPositionEditor` L1202 与 drawerFoot 的【发布】按钮 L1251 在岗位列表已被 L1876（查看/编辑 → 详情页）与 L2322（新建 → 居中弹窗）capture 拦截，不可达；仅审核中心 L1724 / 我的申请 L1759 仍调用其只读态。处理：岗位列表不实现该抽屉；md §二.3.7 "编辑抽屉内【发布】"入口无原型对应 → 待补定义。
2. **岗位申请审批表头 HTML 残缺**：L1563 `<th><button class="sort" data-five-action="pa-application-sort">提交时间 </tr></thead>` —— 未闭合 `</button></th>`、**缺"操作"表头**、排序箭头缺失（虽然 L1663 的排序逻辑存在）。处理：按 md §4.2 补"操作"列头与排序箭头（代码已如此）。
3. **修改绑定弹窗岗位下拉读取不存在的 `window.positionRows`**（L1598），永远回落静态 4 项，且名称与岗位列表不一致。处理：按 md 口径走 mock（已发布 + 审核中），见 C5。
4. **驾驶舱 / 实例与会话 / 运行规格 / 配额与限流点击 toast"该模块不在本次原型范围内"**（L253）。处理：不搬，保留占位页/真页。
5. **`?module=positions` 直开时 `pageSlice` 未定义**：L1257 在 L1552 挂 window 之前执行 `render()` → 首帧 ReferenceError（正常从导航进入无此问题）。处理：无需处理，仅说明原型分页依赖加载顺序。
6. **停用护栏弹窗带多余"取消"键**（L1245 复用 `modal()` 壳）。处理：单键"知道了"（代码现状）。
7. **确认弹窗不区分危险/警告色**（`.modal` L15 确认键一律绿 primary）。处理：视为原型简化，代码 danger/warning 配色建议保留（A8 已标待认可）。
8. **岗位列表 `dynPageSize` 与岗位 md "不分页"矛盾**（原型 L1199 vs md §二.1）。处理：待拍板（A7/B1）。
9. **新建岗位为居中弹窗、md 为右侧抽屉**（L2319 vs md §一.1）。处理：待拍板（B2）。
10. **列表【发布】直开版本侧栏、md 为发布前检查弹窗**（L1243 vs md §二.3.3）。处理：待拍板（B3）。

---

## 五、量级汇总

- 小：A1、A2、A3、A4、A6、A8、A9、A10、B1、B2、B4、B5、B6、B7（小档部分）、C1、C2、C3、C4、C5、C7 —— **20 条**
- 中：A5、A7 —— **2 条**
- 大：0 条
- 无需改动（已对齐或保留）：A11、B3、B8、C6、C8

粗估合计 **≈ 6–7 人天**（小档按 0.25 天、中档按 1.5 天，另加全站列表页视觉回归截图 1 天）。

**必须串行（共享组件，先做再做页面）**：
1. A3（主区限宽/底色）→ A6（表格白卡）→ A5（控件密度）—— 三者共同决定"页面长什么样"，改完先截图对比再动页面。
2. A7（分页器构成 + `useDynPageSize`）→ B1、C2 —— 岗位/岗位管理只是接入。
3. A4（PageHeader 字号档）、A10（ListStates 空态）、A9（DrawerEditor 宽度）—— 独立但全站生效，建议与 1 同批回归。
4. 侧栏 A1/A2 独立，可并行。
5. 页面级 B2/B4/B5/B6、C1/C3/C4/C5/C7 在共享层完成后并行。

**待负责人拍板后才能定方向的**：B1（分页三口径）、B2（新建弹窗 vs 抽屉）、B3（发布前检查弹窗）、C5（下拉含审核中）、A7（全站动态条数）。

---

## 六、覆盖说明

**原型已核对**：
- 壳层：DOM L124–142；CSS L9–16、L18–71、L110、L275、L340（仅确认 `.uniform-skill-toolbar` 作用域不影响岗位）、L397–440、L651、L1155–1170、L1512、L1515、L1740、L1840（`.proto2-*`、`.pd2-popup-form` L2048）；JS L146、L184–188、L239、L242（rail-toggle）、L253、L327、L1568、L1578–1585、L1943、L4526。
- 岗位列表：L1172–1257 全段；L1849–1876（`posRows/currentPos/enterPosition/leavePosition`、capture 拦截）；L2317–2325（`npMask/npOpen/npCreate`）；L1724、L1759（外部对 `openPositionEditor` 的调用）。
- 岗位管理：L1520–1526、L1545–1553、L1562–1564、L1567–1569、L1578–1609、L1643–1683。
- 已确认无更后覆写：grep `renderPositions|positionActions|position-table|position-stop|position-delete|position-withdraw` 最后出现于 L1247；`renderAssignments|assignmentTabs|paTab` 最后出现于 L1675。

**代码已核对**：`layouts/AdminLayout.vue`、`components/admin/AdminRail.vue`、`components/PageHeader.vue`、`components/admin/ListToolbar.vue`、`ListPagination.vue`、`ListStates.vue`、`DrawerEditor.vue`、`VersionDrawer.vue`、`VersionHistoryList.vue`、`UserPositionEditDialog.vue`、`ReviewRejectDialog.vue`（L1–60）、`StatusTag.vue`（头部）、`composables/useAdminList.js`、`assets/list-page.css`、`assets/tokens.css`（令牌值）、`assets/theme.css`（L1–60、L183–260、L330–360）、`utils/tableLayout.js`（常量）、`views/admin/AdminPositions.vue`、`views/admin/AdminPositionAssignments.vue`、`views/admin/AdminComingSoonPlaceholder.vue`、`router/index.js`（L236–272、L317–336）、`api/positionMock.js`（分页 L274–291）、`api/positionAssignmentMock.js`（种子）。参考记录：`docs/PRD-review/2026-09-01.md` L429/L565（动态分页待拍板）、`2026-09-07.md` §改造轮、`2026-09-08.md`（0907 导入两阶段）。

**未覆盖**：岗位详情页整页（`PositionDetailTabs.vue` 及原型 L1840–1897、L2026–2470 各页签层）——仅核对了列表→详情的入口流向；连接器页自带的 moduleTabs 具体形态；`theme.css` 中 el-tabs / el-tag 的细粒度覆写；暗色主题下各令牌的对应值（原型无暗色）。
