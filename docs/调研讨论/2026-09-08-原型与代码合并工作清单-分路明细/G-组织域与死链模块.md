# 合并差距分析 · G 路：06 组织（用户 / 角色与权限）+ 原型死链占位模块 + 代码独有模块清单

基准：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（4561 行，多层 patch，以最终覆写生效态为准）；代码 `frontend/src/`。只读比对，未改任何文件。

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
|---|---|---|---|
| 用户 · 列表页（工具栏/表格/分页/空态） | `renderUsers` L238（唯一定义，无后层覆写）；分发 `render` 链末端仍落到 L239 基础 render 的 `state.module==='users'` 分支（L317 → L1568 → L1824 → L2127 → L4525 逐层透传）；`userActions` L237；查询按钮 L720；菜单关闭 L268–269 | `views/admin/AdminUsers.vue` | 局部差异 |
| 用户 · 新建/编辑 | `openUserDialog` L250（**居中模态窗** `.modal.wide` 520px，非整页、非抽屉）；`saveUserDialog` L251；modal 壳覆写 L266（最终 `modalConfirm.onclick` 为 L670） | `components/admin/UserEditor.vue`（el-dialog 480px） | 局部差异 |
| 用户 · 设置角色 | `openRoleDialog` L252（`.modal.wide` 520px + check-card） | `components/admin/UserRoleDialog.vue`（el-dialog 440px + 纵向 el-checkbox） | 局部差异 |
| 用户 · 重置密码 / 删除确认 | L261 `user-reset` / `user-delete`（`modal(...,true)` 走 L266 html 版；440px 普通 modal） | `AdminUsers.vue` L138–159 / L117–136（ElMessageBox） | 一致（按钮样式档一处差异，见 #7） |
| 角色 · 列表页 | `renderRoles` L315（唯一定义）；`render` 覆写 L317 接管 `roles` 分支；`roleScopeLines` L314；分页 `pageSlice/pagerHtml` L1548–1549（`window.*` 导出 L1551，L315 引用）；事件 L331 | `views/admin/AdminRoles.vue` | 局部差异 |
| 角色 · 新建/编辑抽屉 | `openRoleEditor` L324（右侧抽屉，最终宽度 L42 `.drawer{width:min(780px,88vw);background:#f5f7f6}`）；`syncRolePermissions` L325；`saveRole` L326；事件 L333–334；capture 拦截 L1419（名称 >64 阻断）；`applyPrdFieldRules` L1415（role 名称 maxlength=64） | `components/admin/RoleEditor.vue` + `DrawerEditor.vue`（720px） | 局部差异 |
| 角色 · 删除确认 / 绑定用户拦截 | L331 `role-delete`（userCount>0 → `modal('无法删除角色',…,'知道了')`；否则 `modal('删除角色',…,'删除')`） | `AdminRoles.vue` L125–157 | 一致 |
| 驾驶舱 / 实例与会话 / 运行规格 / 配额与限流（导航项） | 无 render；nav 按钮无 `data-module`（L128、L131），点击落 L253 兜底 `toastMsg('该模块不在本次原型范围内')` | 路由 `cockpit`/`instances`/`quota-throttle` → `AdminComingSoonPlaceholder.vue`；`runtime-specs` → `AdminRuntimeSpecs.vue` | 原型无定义（代码超集，见第四节） |

## 二、差距清单

### 用户 · 列表页（`renderUsers` L238 vs `AdminUsers.vue`）

#### 1. 用户列表 · 工具栏缺【查询】按钮
- 原型：L238 `.module-toolbar` = 搜索框(300px) → 「全部用户分类」下拉 → 「全部状态」下拉 → `<button class="plain" data-action="user-query">查询</button>` → spacer → `＋ 新建用户`（primary）。查询按钮行为 L720：`state.userPage=1; render()`。同时输入框 300ms 防抖自动刷新（L258）、下拉 change 即刷新（L260）——即"自动刷新 + 查询按钮"并存。
- 代码：`AdminUsers.vue` L180–218 只有搜索(280px)+两个下拉+右侧新建，无【查询】按钮；防抖/下拉即刷新已实现（L76–82、L194/L208）。
- 要做：在状态下拉后加一个 plain 「查询」按钮，点击调 `reload`（=`list.search`，回第 1 页）。
- 量级：小
- 与 md 的关系：**md 无定义**（prd-用户.md §一.1 只列搜索/角色筛选/状态筛选/新建入口，未提查询按钮；角色页 md §一.1 有查询按钮）。

#### 2. 用户列表 · 分页条常显 + 每页条数随视口
- 原型：L238 有数据时**无条件**输出 `<div class="pager">‹ 1 2 › 共 N 条</div>`（哪怕只 1 页）；每页 `USER_PS=dynPageSize()`（L146：`floor((innerHeight-330)/62)`，夹在 5–30，900 高≈9 条）；pager 右对齐（L13 `.pager{justify-content:flex-end}`），页码按钮 28px 方块。
- 代码：`ListPagination.vue` L28 `visible = total > pageSize`（单页不渲染）；`AdminUsers.vue` L39 固定 `pageSize:10`。
- 要做：（a）用户页分页条改为有数据即显示（含「共 N 条」）；（b）若要严格照原型，把每页条数改为按视口高度动态计算（可在 `useAdminList` 传入函数或页面自算后传 `pageSize`）。(b) 属于共享组件/组合式函数改动，需与其他列表页统一决定。
- 量级：小（(a) 单页；(b) 若全站统一则中）
- 与 md 的关系：md 无定义（prd-用户.md §二.3 只说支持上下页/页码/总数，未定每页条数与单页是否显示）。

#### 3. 用户列表 · 空态形态
- 原型：L238 无数据仅输出 `<div class="empty">没有符合条件的用户</div>`（L13 `.empty{height:340px;display:grid;place-items:center}` 纯文字、无插图），且只有这一种空态。
- 代码：`AdminUsers.vue` L221–227 走 `ListStates` → `el-empty`（96px 插图 + 文案「还没有用户 · 点「新建用户」创建第一个」），无结果与无数据同文案。
- 要做：若照原型，空态改为纯文字 340px 居中区块（共享 `ListStates` 加"无插图"形态或本页覆盖）；文案取舍交裁决。
- 量级：小
- 与 md 的关系：**与 md 冲突**（prd-用户.md §一.3 / §二.4 明确写「还没有用户 · 点「新建用户」创建第一个」且不区分两种空态；原型是「没有符合条件的用户」）。形态（插图 vs 纯文字）md 无定义。

#### 4. 用户列表 · 表格单元格形态（状态点 / 角色灰标签 / 用户名加粗 / 排序头）
- 原型：L238 colgroup 140/120/220/230/90/165/210；用户名 `td.user-name`（L340 加粗 600）；角色为 `.tag.gray`（L13 灰底灰字）；状态为 `.status-switch`（L110：前置 7px 圆点，启用绿 / 停用灰 + 文字，**不是**标签）；排序头是文字按钮「最近登录时间 ↓/↑」（`.sort` L13 无边框）。
- 代码：`AdminUsers.vue` L234–265：用户名普通字重；角色 `StatusTag type="accent"`（蓝）；状态 `StatusTag success/info`（标签）；排序用 el-table `sortable="custom"` 三角形图标。
- 要做：用户名加粗；角色标签改灰色中性档；状态改「圆点 + 文字」；排序头可保留 el-table 机制（交互等价：点击切换、回第 1 页——注意代码 `onSortChange` L168–172 调 `fetchList`=reload **不回第 1 页**，原型 L261 `user-sort` 置 `userPage=1`，需改为 `reload()`=search）。
- 量级：小
- 与 md 的关系：md 无定义（prd-用户.md §二.1 只说"每个角色分别展示为标签"、状态显示文字；未定颜色/形态）。

### 用户 · 新建/编辑窗（`openUserDialog` L250 vs `UserEditor.vue`）

#### 5. 用户编辑窗 · 容器与网格布局
- 原型：**居中模态窗**（回答任务问句：不是整页、不是抽屉）。L110 `.modal.wide{width:min(520px,calc(100vw-32px));padding:0}`，标题栏 58px 带底边线，内容区 `padding:20px 22px;max-height:66vh;overflow:auto`，底部动作条带顶边线。内容为 `.dialog-grid` 两列网格（L110 `grid-template-columns:1fr 1fr;gap:17px 18px`）：新建态 用户名/显示名/邮箱/初始角色 全部 `.full` 跨两列；编辑态 用户名/显示名/邮箱 `.full`，**「状态」下拉与「最近登录时间」只读值并排各占一列**，最后一行 `.page-time`（L16/L70：顶边线、12px 灰字，横排「创建时间：… 最近更新时间：…」）。
- 代码：`UserEditor.vue` L124 `el-dialog width="480px"` 单列 `label-position="top"`；编辑态 L161–180：状态下拉 160px 独占一行，三条时间做纵向「标签 + 值」列表（L167–180 `.ue-meta`）。
- 要做：窗宽 520px；编辑态改两列网格：状态（左）+ 最近登录时间只读框（右，`.readonly-value` 灰底 38px），底部一行横排「创建时间 / 最近更新时间」带顶边线；标题/底栏加分隔线（可全局 el-dialog 样式）。
- 量级：小
- 与 md 的关系：md 无定义（prd-用户.md §三.4 只列字段，未定排布）。

#### 6. 用户新建 · 初始角色为卡片式复选（check-card）而非多选下拉
- 原型：L250 新建态 `<div class="check-list">`（L110 两列网格 gap 10px），每项 `.check-card`（边框 8px 圆角，checkbox + `<strong>角色名</strong><small>授予对应平台权限</small>`，选中态绿边+浅绿底 L110 `:has(input:checked)`）；未选校验 `.error-text`「请至少选择一个角色」内联显示（L251）；下方 `.hint`「初始密码为 wemate123…」。
- 代码：`UserEditor.vue` L139–153 `el-select multiple` 下拉；提示条 L154–156。
- 要做：新建态角色区改为两列 check-card 网格（可抽公共小组件，与 #8 设置角色窗共用），校验错误内联到区块下方。
- 量级：小
- 与 md 的关系：**与 md 冲突**（prd-用户.md §三.2「角色：必填，支持选择一个或多个角色，提示文字为『选择一个或多个角色』」——描述的是下拉占位文案；原型是卡片复选，无占位文案）。

#### 7. 用户新建 · 确认按钮文案档 / 删除确认按钮样式档
- 原型：L250 `modalConfirm.textContent=isNew?'新建':'保存'`；所有确认窗的确认键都是 `.primary`（绿），原型 modal 壳（L141、L266）**没有 danger 档**，删除用户 L261 的【删除】亦为绿色 primary。
- 代码：`UserEditor.vue` L186 两态都是「保存」；`AdminUsers.vue` L122 删除确认 `confirmButtonClass:'el-button--danger'`（红）。
- 要做：新建态按钮改「新建」。删除键颜色：原型是壳层能力缺失（全站无 danger modal），**建议不照搬**、保留 danger（md 明确要求危险样式），列入第四节。
- 量级：小
- 与 md 的关系：按钮文案 **与 md 冲突**（prd-用户.md §三.1「两种状态底部均展示【取消】和【保存】」）；删除键样式 md §二.2.6 要求危险样式、与代码一致、与原型不一致。

### 用户 · 设置角色窗（`openRoleDialog` L252 vs `UserRoleDialog.vue`）

#### 8. 设置角色窗 · 尺寸、说明段与卡片复选
- 原型：L252 `.modal.wide` 520px；首段 `<p>为 <strong>显示名</strong>（username）设置角色。保存后将全量替换当前角色。</p>`；角色为两列 `.check-list` check-card（同 #6）；未选时**内联** `.error-text`「请至少选择一个角色」并 `return false` 保持窗口开启。
- 代码：`UserRoleDialog.vue` L68 `width="440px"`；说明段 L69 无加粗/无 username；L70–80 纵向 `el-checkbox-group`；未选走 `ElMessage.warning` toast（L48–51）。
- 要做：窗宽 520px；角色区改两列 check-card（复用 #6 组件）；校验改内联错误提示。
- 量级：小
- 与 md 的关系：说明段文案 md §二.2.3 为「为「显示名」分配角色（全量替换当前角色）」（文案级，交审查稿）；复选形态 md 无定义；校验提示位置 md 只说"提示"，无定义。

### 用户 · 更多菜单 / 重置密码（核对结论：一致，不列差距）

- 【更多】菜单：原型 L237 自绘 `.more-menu`（144px、右对齐、重置密码 / 分隔线 / 红色「删除用户」），L268–269 点外部或 Esc 关闭，翻页关闭（L261）。代码 `el-dropdown`（L272–295，`divided` + `.users-more-del` 红）——行为等价，形态由 Element 承担，视为一致。
- 重置密码：原型 L261 普通 440px modal + `.password-copy` 灰底行「默认密码：wemate123」（绿色加粗 code）；代码 L142–149 VNode 两行 + `.users-reset-pwd` 灰底行。一致（差异仅 ElMessageBox 多一个 warning 图标）。

### 角色 · 列表页（`renderRoles` L315 vs `AdminRoles.vue`）

#### 9. 角色列表 · 分页条（原型有，代码/md 无）
- 原型：L315 `list=pageSlice(list,'roles')` + `pagerHtml('roles',totalRoles)`（L1549）：有数据即输出 `.fm5-pager`「共 N 条 · 每页 M 条 ‹ 1 ›」（右对齐，L1512），每页 `dynPageSize()`。
- 代码：`AdminRoles.vue` L33–36 `paged:false`，无分页条、不显示总数。
- 要做：若照原型，加 ListPagination（常显）+ 本地分页；**但 md 明确写不分页**——需裁决。
- 量级：小
- 与 md 的关系：**与 md 冲突**（prd.角色.md §一.1「页面不提供状态筛选、分页和页面切换操作」、§二.2「不分页，也不展示数据总数和页码切换」）。

#### 10. 角色列表 · 列宽/对齐微差
- 原型：L315 colgroup 185 / 110 / auto / 165 / 135；「用户数量」左对齐；角色名 `<strong>`；操作列 编辑（link）+ 删除（danger-link，title「删除前需二次确认」）。
- 代码：`AdminRoles.vue` L198–248：名称 min 180 / 用户数量 100 **居中** / 页面权限 min 360 / 时间 152 / 操作 `opsWidth(2)` fixed right；其余一致。
- 要做：用户数量列改左对齐（去 `align="center"`）；列宽可维持 COL 常量。
- 量级：小
- 与 md 的关系：md 无定义。

### 角色 · 编辑抽屉（`openRoleEditor` L324 vs `RoleEditor.vue`）

#### 11. 角色抽屉 · 分区卡片（section-card）结构
- 原型：L324 抽屉体为两张 `section.section-card`（L47–49：白卡、10px 圆角、卡头 52px 灰底 `#f8faf9` 带底线、标题 15px/650）：①「角色信息」卡内放角色名称字段（`.role-editor-name`，含 `.error-text` + `.hint`）；②「页面权限」卡，卡头带 `.section-sub`「勾中哪些页面…」，卡内 `.permission-tree` → `.error-text`「请至少开通 1 个页面」→ `.permission-summary`；卡外（编辑态）`.danger-hint`。抽屉体底色 `#f5f7f6`（L42），卡片白色浮于其上；抽屉宽 `min(780px,88vw)`。
- 代码：`RoleEditor.vue` L165–226 是裸 `el-form`：两个 `el-form-item`（label「角色名称」/「页面权限 + sub」），无卡片分区、无卡头；`DrawerEditor.vue` L55 默认 720px、体底色跟 el-drawer 默认白。
- 要做：把两块包进 section-card（卡头「角色信息」「页面权限」），角色名称的 label 移入卡内表单；抽屉宽 780px 与灰底属共享 `DrawerEditor` 改动（与其他抽屉页串行）。
- 量级：小（本页）；抽屉壳改动为共享项
- 与 md 的关系：md 无定义（prd.角色.md §三 只写字段与校验，未提分区卡片）。

#### 12. 角色抽屉 · 校验失败时的 toast
- 原型：L326 `saveRole` 名称或权限为空 → 对应区块加 `.invalid` 显示内联 error-text **并** `toastMsg('请先补齐必填项')`；L1419 capture 层名称 >64 字 → `block()`：阻断 + toast「角色名称最多 64 个字符」。
- 代码：`RoleEditor.vue` L120–128 仅内联提示，无 toast；名称 `maxlength="64"`（L167）已限制输入，>64 场景不会出现。
- 要做：校验失败追加一条 toast「请先补齐必填项」。
- 量级：小
- 与 md 的关系：md 无定义（§三.5 只说"提示…不执行保存"）。

### 角色 · 权限树 / 删除分流（核对结论：一致，不列差距）

- 权限树：原型 `.perm-scope` 卡（头 44px 灰底 + 范围复选 + 管理端计数 n/m；用户端 `user-scope-only` 体隐藏）、分组标题复选、页面三列网格（L275 `.perm-pages{repeat(3,…)}`、左缩进 24px）、分组间顶线、半选 indeterminate（L325）——`RoleEditor.vue` L177–224 逐项对应，一致。
- 删除分流：L331 有绑定 → 单按钮「知道了」提示窗；无绑定 → 二次确认「删除」→ toast「角色已删除」；`AdminRoles.vue` L125–157 一致。

## 三、代码超集（原型无对应，保留不动）

**06 组织内**
- 用户/角色列表的 loading 骨架、加载失败 + 重试态（`ListStates.vue`、`useAdminList.js`）——原型两页均无加载/失败态。
- 用户列表操作在途禁用（`delBusy`/`resetBusy`，`AdminUsers.vue` L282–289）。
- 角色搜索框 `clearable` 清空即恢复全部（`AdminRoles.vue` L48–51）；原型需再点查询。
- 角色抽屉「权限树加载失败 · 关闭重开重试」空态（`RoleEditor.vue` L215–219）。
- 角色编辑按需分别下发改名 / 改权限两条写请求（`RoleEditor.vue` L137–143）。
- mock 层：用户种子角色名映射到角色页 roleRows（`adminUserMock.js` 头注释）——原型两页角色名互不一致（`allRoles` L209 vs `roleRows` L304）。

**原型完全没有的模块**（按 `router/index.js` 核对；只列清单，不比对）

| 模块 | 路由 / 文件 | 一句话 |
|---|---|---|
| 登录页 | `/login` → `views/Login.vue`（守卫 L425–431 直接重定向到 `AdminPositions`，不可达） | demo 已取消登录，页面仅存档 |
| 首登引导 / 绑岗 / 改密 | `/onboarding`、`/bind-expert`、`/change-password` → `Onboarding.vue`、`BindPosition.vue`、`ChangePassword.vue` | 用户端登录后分流页，原型无用户端 |
| 用户端工作台 | `/chat`、`/tasks`（+`/tasks/new`、`/tasks/:id`、`/tasks/:id/edit`）、`/space`、`/other-experts`、`/settings`、`/memory`、`/my-experts/:positionId`（router L12–73，`FrontLayout.vue`；chat/tasks/space/memory 经 `runtimeView` 封存为 `FrontRuntimePlaceholder.vue`） | 员工端全套，原型只有管理端 |
| 业务系统凭证托管 | `components/biz/BizCredentialPanel.vue`、`BizCredentialHostDialog.vue`（嵌 `views/Settings.vue`） | 员工侧业务系统登录态托管面板 |
| 技能分类管理 | `views/admin/SkillCategories.vue`（**未挂路由**，死视图；分类已改走字段字典 `fieldDict`） | 旧 N3 分类页，可视为待清理 |
| 系统技能 | `/admin/system-skills` → redirect `AdminSkillsUnified?type=SYSTEM_DEFAULT`；`/admin/system-skills/:id/edit` → `AdminSkillEditPage.vue`（`skillChannel:'system'`） | 已并入统一技能页，仅剩重定向 + 编辑路由 |
| 两套报表 | `/admin/reports/fde` → `FdeReports.vue`；`/admin/reports/sysconfig` → `SysConfigReports.vue`；`/admin/reports` 重定向 | ECharts 统计页，菜单已隐藏（`AdminRail.vue` L40） |
| 旧路径重定向 | `/admin/market`、`/admin/skills`、`/admin/platform-skills`、`/admin/skill-reviews`、`/admin/mcp`、`/admin/apis`、`/admin/biz-systems`（router L119–178、L274–281） | 兼容书签 |
| 开发页 | `/dev/skill-editor` → `views/dev/DevSkillEditor.vue`；`/dev/react-sim` → `DevReActSimulated.vue`（仅 DEV 注册，router L398–411） | Playwright 隔离验证页 |

## 四、原型侧缺陷（合并时不应照搬）

1. **四个死链导航项**：驾驶舱（L128）、实例与会话 / 运行规格 / 配额与限流（L131）在原型里没有 `data-module`，也没有任何后层为其绑定模块（后层只补了：L327 专家/角色、L1574 navMap 治理六项+岗位管理、L1943 知识库、L4526 用户技能审核）。最终生效行为 = L253 `document.querySelectorAll('.nav-item:not([data-module])').forEach(n=>n.onclick=()=>toastMsg('该模块不在本次原型范围内'))`：点击只弹 1.8 秒 toast（L185），不高亮、不切页。（L187 另有一条「该模块不在本次 MCP 原型范围内」，属 MCP 层旧兜底，已被 L253 覆盖。）
   - 合并处理：**不搬 toast**。代码侧保留现状——`cockpit`/`instances`/`quota-throttle` 走 `AdminComingSoonPlaceholder.vue`（真实路由 + 高亮 + 「「X」功能开发中，敬请期待」空态），`runtime-specs` 走已实现的 `AdminRuntimeSpecs.vue`（基准是负责人截图，原型与 md 均无内容，`04运行/运行规格/` 仅 `.gitkeep`）。驾驶舱 / 实例与会话 / 配额与限流 已在 `docs/04-原型退役补定义需求/补定义需求清单-20260907.md` 第 1–3 项待浦月补定义；**运行规格未在清单内**——它有代码无 md，建议追加一项「把 AdminRuntimeSpecs 现状反写成 md」（同清单第 4 项的做法），否则原型退役后该页无文字基准。
2. **modal 壳无 danger 档**：原型确认窗按钮恒为 `.primary` 绿色（L141/L266），删除用户、删除角色的【删除】都是绿的。md 两处均要求危险样式，代码已是 danger。合并时**按 md**，不照搬原型。
3. **L327 死代码**：`roleNav` 按 `.nav-label==='角色'` 查找，但导航文案是「角色与权限」（L133），永远找不到；角色导航实际靠 HTML 自带 `data-module="roles"` + L253 通用绑定生效。无需处理。
4. **原型两页角色名不一致**：用户页 `allRoles`（L209：平台管理员/配置管理员/审核员/FDE 工程师/普通用户）与角色页 `roleRows`（L304–310：系统管理员/系统配置员/FDE 工程师/普通用户/审计观察员）对不上，用户筛选下拉与设置角色窗出现的角色在角色页不存在。代码 mock 已以 roleRows 为准做映射，**不搬**。
5. **用户页「全部用户分类」下拉**（L238）实为角色筛选（`state.userRole`），标签用词与内容不符；md 写「全部角色」。文案级，交审查稿，代码按 md。
6. 原型用户/角色两页**无加载态、无失败态**，属于原型静态数据的天然缺失，代码超集保留。

## 五、量级汇总

- 小 12 条（#1–#12），中 0，大 0。合计粗估 **2–3 人天**（含截图比对回归）。
- 必须串行 / 共享组件：
  - #2(b) 每页条数按视口动态 → 改 `useAdminList` / `ListPagination`，影响全部列表页，需与其他路统一拍板后一次改；#2(a) 常显分页条同样是 `ListPagination` 全站行为。
  - #3 纯文字空态 → `ListStates` 共享。
  - #6 与 #8 共用一个 check-card 角色选择小组件，先做组件再接两处。
  - #11 抽屉宽 780px + 灰底 → `DrawerEditor` 共享壳，与专家/连接器/模型等抽屉路串行。
  - #5/#7 若做 el-dialog 标题/底栏分隔线，属全局样式，与其他弹窗路串行。
- #9（角色分页）与 #3/#6/#7 文案项存在 md↔原型冲突，改前需负责人裁决。

## 六、覆盖说明

**原型侧核对**：导航 DOM L125–137；壳层 L140–142（drawer/modal/toast）；`dynPageSize` L146/L1546；`toastMsg` L185、`modal` L186→L266 覆写、`modalConfirm.onclick` L198→L266→L670 三层；用户数据 L209；`userActions` L237；`renderUsers` L238；`render` 基础 L239 及覆写链 L316–317、L1232、L1568、L1823–1824、L1875、L1942、L2111–2127、L4524–4525（确认 users/roles 分支均透传到底层）；`openUserDialog` L250、`saveUserDialog` L251、`openRoleDialog` L252、导航绑定 L253、输入/变更/点击事件 L258–L261、菜单关闭 L268–269；角色 CSS L275、L340；`permissionGroups`/`roleRows` L293–310；`roleScopeLines` L314、`renderRoles` L315、导航补绑 L327、事件 L328–334、`openRoleEditor` L324、`syncRolePermissions` L325、`saveRole` L326、预览参数 L337/L345；查询按钮 L720、删除 title 装饰 L721–722；`clearExpertFullMode` L1396–1403（确认 `expert-full-editor-mask` 只作用于专家抽屉，不影响角色抽屉宽度）；`setRequired`/`applyPrdFieldRules` L1414–1416、capture 拦截 L1418–1419；分页助手 L1547–1551；治理导航 navMap L1571–1584；知识库导航 L1943；用户技能审核导航 L4526；CSS 规则（`.modal.wide`/`.dialog-grid`/`.check-list`/`.check-card`/`.more-menu`/`.status-switch`/`.role-tags`/`.module-toolbar`/`.pager`/`.fm5-pager`/`.empty`/`.drawer`/`.section-card`/`.perm-*`/`.page-time`/`.readonly-value`/`.password-copy`）分布于 L11–17、L22–23、L37–53、L70–77、L110–111、L275、L340、L1512、L1740。MutationObserver 21 处已扫，与本路相关的仅 L722（删除按钮 title）、L1416（角色名 maxlength）。

**代码侧核对**：`views/admin/AdminUsers.vue`、`components/admin/UserEditor.vue`、`UserRoleDialog.vue`、`views/admin/AdminRoles.vue`、`components/admin/RoleEditor.vue`、`DrawerEditor.vue`、`ListToolbar.vue`、`ListPagination.vue`、`ListStates.vue`、`composables/useAdminList.js`、`api/adminUserMock.js`、`assets/list-page.css`、`layouts/AdminLayout.vue`、`components/admin/AdminRail.vue`、`views/admin/AdminComingSoonPlaceholder.vue`、`AdminRuntimeSpecs.vue`、`router/index.js`；md：`06组织/用户/prd-用户.md`、`06组织/角色/prd.角色.md`、`04运行/*`（仅 .gitkeep）、`docs/04-原型退役补定义需求/补定义需求清单-20260907.md`。

**未覆盖**：页面外壳（`.page` 限宽 1480px/居中、`.main` 底色、侧栏折叠）与 el-dialog / el-drawer 全局皮肤——属全站共享壳层，本路只在涉及处点到（#5、#11），不单独立项；`AdminRuntimeSpecs.vue` 与 `RuntimeSpecEditor.vue` 因原型无对应未做逐项比对；用户端各页未比对（原型无）。
