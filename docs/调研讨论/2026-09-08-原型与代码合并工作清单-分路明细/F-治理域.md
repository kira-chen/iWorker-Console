# 合并差距分析 · F 路 · 05 治理域（我的申请 / 审核中心 / 访问审计 / 用户反馈 / 字段字典 / 用户技能审核）

> 基准：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（最终覆写生效态）↔ `frontend/src/views/admin/*`、`components/admin/*`、`api/*Mock.js`。只比布局与交互；字段/文案级差异不重复（见《PRD与原型一致性审查结果-20260907.md》Q256–Q301、Q399–Q437）。原型行号均为该 html 文件行号，代码行号为当前工作区。

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
| --- | --- | --- | --- |
| 我的申请 · 列表 | `renderMyApplications` L1562（core 层唯一定义；筛选 change 与行为在 `my-applications-behavior` L1773–1783） | `views/admin/MyApplications.vue` | 一致（分页/按钮档微差） |
| 我的申请 · 详情（抽屉 / 技能整页）+ 撤回 / 重新提交 | `goBusiness` L1770（列表【查看】【重新提交】均走此，`openDetail` L1757 已无调用方）、`withdraw` L1771、`submitAudit` L1772、底栏 `myAppViewFooterHtml`/`myAppEditFooterHtml` L1753–1756 | `MyApplications.vue` + `components/admin/GovObjectDetail.vue` + `views/admin/AdminSkillEditPage.vue:907–1035`（?myApp 借用态）+ `utils/govDialogs.js` | 局部差异（POSITION 抽屉为占位；抽屉宽度；MODEL 吸底条宽） |
| 审核中心 · 列表 | `renderReviews` L1565（core 唯一定义） | `views/admin/UnifiedReview.vue` | 一致 |
| 审核中心 · 查看详情（抽屉 / 技能整页）+ 通过 / 驳回弹窗 | `review-native-detail-fix` 层：`openNative` L1722（capture 拦截 `review-view` L1734，core 的 `openReviewDetail` L1611 与 fm5 抽屉 L1518 被覆盖成死代码）、`approve` L1731、`reject` L1732、`footerHtml` L1719、`setSkillFooter` L1721（`.review-native-bar` L1708） | `UnifiedReview.vue` + `GovObjectDetail.vue` + `ReviewRejectDialog.vue` + `AdminSkillEditPage.vue:907–1035`（?govReview） | 局部差异（同上抽屉问题） |
| 访问审计 | `renderAuditMultiDevice` L1814（`P.renderAudit=` L1822 + `render` 覆写 L1824；core 的两处 `renderAudit` L1565/L1566 均被覆盖） | `views/admin/AdminLoginLogs.vue` | 一致（搜索生效方式微差） |
| 用户反馈 · 列表 | `renderFeedback` L1566（同作用域后声明覆盖 L1565 版；差别仅多 `createdAt` 排序） | `views/admin/AdminFeedback.vue` | 一致 |
| 用户反馈 · 详情弹窗 / 附图弹窗 | `feedback-detail` L1671、`feedback-image` L1672（`P.openDialog` L1553 通用弹窗） | `AdminFeedback.vue:258–296` | 局部差异（附图形态） |
| 字段字典 · 分组列表 | `renderFields` L1566 末段、`field-collapse` L1673 | `views/admin/FieldManagement.vue` | 一致 |
| 字段字典 · 编辑选项弹窗 | `openFieldEditor` L1630、`renderFieldOptions` L1626、删除 L1637–1640 | `FieldManagement.vue:225–255` | 局部差异（行样式/添加按钮样式档/删除确认形态） |
| 用户技能审核 · 列表 | `renderUserSkillAudit` L4477（`render` 覆写 L4525、导航劫持 L4526–4527、监听 L4528–4540） | `views/admin/UserSkillReviews.vue` | 结构不同（旧形态） |
| 用户技能审核 · 查看技能 | `openAuditViewer` L4502（基座 `.drawer` 780px L42；底栏 L4510–4512） | `views/admin/ReviewSkillDetailPage.vue`（新标签整页） | 结构不同（形态待第 7 项①裁决） |
| 用户技能审核 · 通过 / 驳回弹窗 | L4538/L4544（基座 `modal()` L186）、`rejectWithReason` L4514 | `UserSkillReviews.vue:178–204`（单一「技能审核」弹窗） | 结构不同 |
| 用户技能审核 · 风险设置抽屉 | `openRiskSettingsDrawer` L4495、`renderRiskDrawerBody` L4487、底栏动作 L4546–4548、Tab/单选 L4550–4559 | （无） | 代码缺失 |
| 治理页共用 · 动态分页 | `dynPageSize`/`pageSlice`/`pagerHtml` L1546–1551（`floor((innerHeight−330)/62)`，5–30） | `composables/useAdminList.js:47–48`（固定 20）、`components/admin/ListPagination.vue:27`（单页不显示） | 结构不同（共用） |

## 二、差距清单

### 治理域共用

#### G-1. 治理列表·分页由固定 20 条改为按页面高度动态分页
- 原型：`dynPageSize` L1546 `floor((innerHeight−330)/62)`，下限 5 上限 30；`pageSlice` L1548 按此切页；`pagerHtml` L1549 **始终渲染**分页条：左「共 N 条 · 每页 M 条」+ ‹ 1 2 … ›，右对齐（`.fm5-pager` L1512）；`goPage` L1550 翻页即 `render()`。我的申请 / 审核中心 / 访问审计 / 用户反馈 四页共用（L1562/L1565/L1820/L1566）；用户技能审核原型无分页但负责人第 7 项④已裁决取 md 动态分页。
- 代码：`useAdminList.js:47` `pageSize` 默认 20 固定；`ListPagination.vue:27` `total > pageSize` 才显示；四页均传 `:page-size="pageSize"`（`MyApplications.vue:307–312`、`UnifiedReview.vue:267–272`、`AdminLoginLogs.vue:122–127`、`AdminFeedback.vue:248–254`）。
- 要做：`useAdminList` 增加 `pageSize: 'auto'`（或 `dynamicPageSize` 选项）按 `window.innerHeight` 计算 + `resize` 监听重算并回第 1 页；四个治理 mock 已支持 `size` 参数无需改；`ListPagination` 加「共 N 条 · 每页 M 条」前缀并决定是否单页也显示（原型显示、md 未定义——建议照原型）。用户技能审核页接入同一能力（见 U-2）。
- 量级：中
- 与 md 的关系：一致（我的申请 §三 / 审核中心 §三 / 访问审计 §三 / 用户反馈 §三 / 用户技能审核 §四 均写「根据页面高度动态分页」）

#### G-2. 治理详情抽屉·宽度 720px → 780px（模型 820px）
- 原型：基座 `.drawer{width:min(780px,88vw)}` L42（最终生效）；模型 `.model-drawer .drawer{width:min(820px,90vw)}` L110。审核中心 / 我的申请查看专家、岗位、MCP、API、业务系统、模型均走这些抽屉（`openNative` L1723–1728、`goBusiness` L1770）。
- 代码：`DrawerEditor.vue:55` `size` 默认 `'720px'`；`ExpertEditor.vue:463`、`McpEditor.vue:602`、`ApiEditor.vue:398`、`BizSystemEditor.vue:410`、`ModelConfigEditDialog.vue:349` 均未传 `size`；`GovObjectDetail.vue:21–23` 头注释已登记此差异待拍板；吸底条宽度 `GovObjectDetail.vue:85–90` 按 720 计算。
- 要做：`DrawerEditor` 默认 size 改 780（或各编辑器显式传 780 / 模型 820），`GovObjectDetail.barWidth` 随之改；此项与连接器 / 专家 / 模型路共享同一组件，须与那几路统一改一次。
- 量级：小
- 与 md 的关系：一致（审核中心 md §4.1「专家/岗位/MCP/API/业务系统 780px、模型 820px」）

#### G-3. 治理详情·MODEL 吸底操作栏宽度错为通栏
- 原型：模型查看抽屉 `openModelDrawer('view')` L245 → 抽屉底栏被 `setDrawerFooter` L1720 / `setMyAppDrawerFooter` L1755 替换，按钮只在抽屉宽度内。
- 代码：`GovObjectDetail.vue:85–90` `barWidth` 对 `MODEL` 返回 `'100%'`（注释称「MODEL 为居中弹窗」，已过期——`ModelConfigEditDialog.vue:3` 自 2026-08-20 起已是 `DrawerEditor` 抽屉）。结果：审核中心 / 我的申请查看模型时，吸底条横跨整个视口覆盖在遮罩上。
- 要做：`barWidth` MODEL 分支改为抽屉宽（现 720 → 随 G-2 改 820）。
- 量级：小
- 与 md 的关系：md 无定义（属代码缺陷）

#### G-4. 治理详情·POSITION 查看抽屉为占位，未复用岗位只读视图
- 原型：`openNative` L1724 / `goBusiness` L1770 调 `window.positionReviewProto.openPositionEditor('edit',pos,true)` L1202–1210：`readonly` 岗位抽屉——标题「查看岗位」，两张 `section-card`：基本信息（岗位名称 / 岗位描述 `readonly-value`）、岗位技能（`.position-view-skills` 灰 tag 列表，空则「暂无关联技能」）+ `.page-time` 行（当前状态 / 最新版本 / 最近更新时间）；底栏替换为 关闭|驳回|通过（审核中心）或按状态按钮（我的申请）。
- 代码：`GovObjectDetail.vue:126–153` `kind==='POSITION'` 走自持 `el-drawer` 780px，仅名称 / 描述 / 提交人 / 提交时间 + 提示文「岗位详情抽屉待岗位模块拍板后接入完整配置视图。」（占位）；`reviewsMock.js:55` 注明「POSITION refId 不消费」。岗位模块代码只有整页 `PositionDetailTabs.vue`（`router/index.js:333`），没有只读岗位抽屉组件。
- 要做：新建岗位只读抽屉（或在 `GovObjectDetail` 内按原型 L1207 结构落地：基本信息 + 岗位技能 tag + 时间行），`reviewsMock`/`myApplicationsMock` 给 POSITION 行补 `refId` 指向岗位 mock 实体，去掉占位提示。注意原型侧不一致（见四-3）：岗位模块自身已改整页 6 页签，而治理详情仍复用旧两段式抽屉——建议先按 md「岗位 780px 右侧抽屉」落地旧结构，内容待岗位路定稿。
- 量级：中
- 与 md 的关系：一致（审核中心 md §四 / 我的申请 md §四「岗位：打开右侧只读详情抽屉」）；抽屉**内容**与岗位 md 新结构（6 页签）冲突——需负责人定治理侧抽屉展示哪些区块

#### G-5. 治理列表·排序列头形态（文字箭头 vs el-table 排序图标）
- 原型：`<button class="sort">申请时间 ↓</button>` 文字箭头（我的申请 L1562 `↕/↓/↑`；审核中心 L1565、用户反馈 L1566、访问审计 L1820 `↓/↑`；用户技能审核 L4485 `<span>` 点击切换）。
- 代码：四页均 `el-table-column sortable="custom"`（EP 上下三角）：`MyApplications.vue:255`、`UnifiedReview.vue:235`、`AdminLoginLogs.vue:98/103`、`AdminFeedback.vue:215`。
- 要做：若要视觉照原型，用列头插槽渲染「标题 + ↓/↑」文字按钮并自管排序态；否则维持 EP 图标。已在 Q269 / Q277 / Q289 / Q295 登记为箭头文案差异，此处只补「形态」层面，待负责人一并定。
- 量级：小
- 与 md 的关系：md 各表写「箭头为"↓ / ↑"」——按字面与原型一致，代码为 EP 图标属偏离

### 我的申请

#### M-1. 列表操作列【撤回】按钮样式档
- 原型：L1562 `<button class="link" data-five-action="myapp-withdraw">撤回</button>`——普通 link（与【查看】【重新提交】同档），非 danger；仅详情底栏「撤回申请」为 `plain danger`（L1753）。
- 代码：`MyApplications.vue:281–291` 列表【撤回】为 `link type="danger"`。
- 要做：列表【撤回】改 `type="primary"` link；详情底栏保持 danger plain。
- 量级：小
- 与 md 的关系：md 无定义

#### M-2. 详情【前往修改】切换编辑态的方式
- 原型：`goBusiness(current,true)` L1770 先 `closeDrawerNative()` 关闭只读抽屉再以编辑态重开（专家 `openExpertEditor('edit')`、MCP `openDrawer('edit')`、API/业务系统 `readonly=false` 重开、模型 `openModelDrawer('edit')`），底栏换为 关闭|提交审核（L1754）。
- 代码：`MyApplications.vue:144–145` 仅把 `detailMode` 置 `'edit'`，靠 `GovObjectDetail :readonly` 反应式切换（`GovObjectDetail.vue:98–130`）；各编辑器是否在打开状态下响应 `readonly` 变化未验证（`ExpertEditor`/`McpEditor` 等按 `visible` 变 true 时加载）。
- 要做：`onDetailAction('modify')` 改为先关（`detailVisible=false`）→ `nextTick` 后以 `edit` 重开，保证编辑器按编辑态初始化；SKILL 路径 `AdminSkillEditPage.vue:998–1004` 已用 `router.replace` 切编辑路由，无需动。
- 量级：小
- 与 md 的关系：一致（md §4.3「【前往修改】打开对应业务模块编辑页面或编辑抽屉」）

### 审核中心

#### R-1. 抽屉遮罩点击关闭
- 原型：`review-native-detail-fix` L1737 capture 监听：点遮罩或 `[data-action="close"]` → `returnToReview()`（关抽屉回列表）。我的申请同 L1758/L1770 `expertMaskHandler`。
- 代码：`DrawerEditor.vue:81` `:close-on-click-modal="false"`，所有治理详情抽屉点遮罩不关。
- 要做：`DrawerEditor` 暴露 `closeOnClickModal` 入参，`GovObjectDetail` 只读态传 true（编辑态保持 false 防丢草稿）。
- 量级：小
- 与 md 的关系：md 无定义

（审核中心列表工具栏 / 七列 / 操作顺序 查看·驳回·通过 / 通过确认弹窗 `govDialogs.confirmApproveReview` / 驳回弹窗 `ReviewRejectDialog` / 技能整页吸底栏 `AdminSkillEditPage.vue:1208–1219` 均与原型 L1565 / L1719–1732 一致，无差距。）

### 访问审计

#### A-1. 搜索框输入即时过滤
- 原型：`five-admin-modules-behavior` L1647 `auditSearch` input 事件 220ms 防抖后 `P.renderAudit`（即 L1814 多终端版）；【查询】L1677 另回第 1 页。
- 代码：`AdminLoginLogs.vue:24–31`、`59–66` 仅回车 / 清空 / 【查询】触发，无 keyword watch（同域其他三页均有 300ms 防抖：`MyApplications.vue:66–73`、`UnifiedReview.vue:73–80`、`AdminFeedback.vue:53–60`）。
- 要做：补 `watch(query.keyword)` 300ms 防抖调 `list.search`（与同域统一）。
- 量级：小
- 与 md 的关系：md 无定义（md §二 只写查询按钮）

（其余：工具栏 搜索+在线状态+查询、六列、双列排序默认登录时间倒序、终端蓝标、在线绿/离线灰、登出空「—」——与 L1820 一致。）

### 用户反馈

#### F-1. 附图缩略与「查看附图」弹窗形态
- 原型：附图列 48px 方块按钮「▧ N」（L1566 `.fm5-thumb` L1512）；点击 → `P.openDialog` L1672：标题「查看附图」、宽 680px、正文 `.fm5-image-large`（360px 高预览区，标「反馈截图 N」）、底部仅【关闭】（`cancelText:'关闭'`）。
- 代码：`AdminFeedback.vue:230–241` 真实缩略图（48px img）；点击 `openViewer` L102–125 → `el-image-viewer` 全屏浮层 L290–296（无标题、无【关闭】按钮、多图切换）；失败另弹「查看附图」420px 提示框 L282–287。2026-09-01 疑点1 处置为「保留真实缩略图 + ElImageViewer，原型编号按钮为占位示意不照搬」。
- 要做：若按「布局交互完全以原型为准」：改成 680px `el-dialog` 标题「查看附图」+ 预览区（放真实大图）+ 序号标识 + 底部【关闭】；缩略保留真图或改编号按钮由负责人定。此条与 2026-09-01 既有裁决相抵，需重新确认。
- 量级：小
- 与 md 的关系：**与既有代码裁决冲突，与 md 一致**（md §五「打开"查看附图"弹窗…展示大图预览区域并标识附件序号；底部仅【关闭】」）

#### F-2. 反馈详情弹窗尺寸与明细行布局
- 原型：`P.openDialog` L1671 默认宽 `min(520px,94vw)`（L1553）；正文 `.fm5-detail-list`（L1512：每项 label 在上、值在下，纵向 16px 间距）+ `.fm5-content-full`（纯 pre-wrap 文本，无底色框）。
- 代码：`AdminFeedback.vue:258` `width="560px"`；明细为 `dt/dd` 左右两列 L260–273；内容块套 `--bg-sunken` 圆角框 + 50vh 滚动 L371–380。
- 要做：宽改 520；明细改 label 上/值下；内容块去底色框（或保留滚动限高但去底色）。
- 量级：小
- 与 md 的关系：md 无定义（字段集见 Q286）

### 字段字典

#### D-1. 编辑弹窗·选项行与「添加选项」样式档
- 原型：`renderFieldOptions` L1628：每行 `.fm5-option-row`（L1512：边框 + `#fafbfa` 底 + 7px 圆角 + `9px 11px` 内距，序号 / 34px 输入框 / `.icon-btn` ×）；列表 `max-height:310px` 滚动；「＋ 添加选项」为 **plain 描边按钮** `.fm5-option-add`，放在 `#fiveFieldOptions` 容器内末尾、上方 1px 分隔线 + 16px 间距；错误行 `.fm5-dialog-error` 在按钮下方。
- 代码：`FieldManagement.vue:233–249` 行无边框无底色（`.fm-opt-row` L342–347 仅 4px 上下内距）；添加按钮为 `link type="primary"` L247 且在列表容器外；错误行在按钮下方（同）。
- 要做：行加边框/底色/圆角；添加按钮改 `plain` 描边、上加分隔线并纳入列表容器；列表限高 310。
- 量级：小
- 与 md 的关系：md 无定义（Q260 已记按钮位置/前缀文案）

#### D-2. 删除选项确认形态
- 原型：L1640 `window.confirm('确认删除"X"？\n' + impact)` 原生确认（无标题、确定/取消）。
- 代码：`FieldManagement.vue:131–136` `ElMessageBox.confirm` 标题「删除选项」、warning 图标、按钮「删除」(danger)/「取消」。
- 要做：合并时不照搬原生 confirm；保留 `ElMessageBox`，按钮文案是否改「确定」待负责人定（Q256 已登记删除时机）。
- 量级：小
- 与 md 的关系：md §三「点击删除按钮仅从当前编辑草稿中移除」未提确认弹窗——原型多一步确认，属 md 无定义

#### D-3. 编辑弹窗遮罩点击关闭
- 原型：`P.dialogMask` L1585 点遮罩 → `closeDialog`（放弃草稿）。
- 代码：`FieldManagement.vue:229` `:close-on-click-modal="false"`。
- 要做：去掉该属性（md §三「点击【取消】或关闭弹窗，放弃本次未保存修改」）。
- 量级：小
- 与 md 的关系：一致

### 用户技能审核（阶段一/二已判定整页重做；此处只列布局/交互层，字段级见 Q399–Q433）

#### U-1. 列表工具栏结构
- 原型：L4485 `.module-toolbar`：搜索框（占位「搜索技能名称 / 描述 / 提交人」）→ `select-wrap` 全部审核尺度 → `select-wrap` 全部审核状态 → `plain`【查询】→ `toolbar-spacer` → 右端 `primary`【风险设置】。搜索仅在 Enter（L4529）或【查询】（L4534）时生效；下拉 change 立即刷新（L4530）。
- 代码：`UserSkillReviews.vue:103–116` `ListToolbar`：搜索（占位「搜索 技能名称 / 提交用户」）→ 全部状态 → 全部用途（无尺度）；无【查询】；无右侧 `#right` 插槽按钮；搜索 300ms 防抖即时生效 L47–51。
- 要做：筛选改为 尺度 + 状态；加【查询】；`#right` 放 primary【风险设置】；搜索改为 Enter/【查询】生效（或与同域统一保留防抖——md §三 写「搜索框按 Enter 同样触发查询」）。
- 量级：小
- 与 md 的关系：一致（md §三）

#### U-2. 列表表格列与操作列
- 原型：L4485 表 `.audit-table` 七列 colgroup 160/220/90/145/90/80/auto：技能名称 / 描述（`title` 悬停全文）/ 提交人 / 提交时间（列头文字点击切排序，默认 desc）/ 审核状态（黄/绿/红 tag）/ 审核尺度（绿/蓝/红 tag）/ 操作；操作 L4482：`link`【查看技能】+ 待审时 `link`【通过】`danger-link`【驳回】；空态「没有符合条件的审核记录」；无分页（→ 取 md 动态分页，见 G-1）。
- 代码：`UserSkillReviews.vue:126–166`：技能名称 / 技能描述 / 技能用途 / 审核结果 / 提交用户（含 tooltip 用户 ID）/ 提交时间（不可排序）/ 操作【查看】【审核】；分页固定 20。
- 要做：列集合与顺序照原型（去用途、加尺度、时间可排序默认 desc）；操作拆为 查看技能 / 通过 / 驳回 三按钮（样式档 link / link / danger-link）；接入 G-1 动态分页；空态文案取 md（无定义时取原型，Q419）。
- 量级：中
- 与 md 的关系：一致（md §4.1；状态词按负责人第 7 项②全站「待审核」）

#### U-3. 通过确认弹窗 + 驳回弹窗（两弹窗替代单一「技能审核」弹窗）
- 原型：通过 L4538/L4544 基座 `modal()` L186（440px）：标题「通过审核」、正文「确认通过「X」的审核申请？通过后提交人将可立即使用此技能。」、确认键「确认通过」→ toast「审核已通过」；驳回 `rejectWithReason` L4514–4523：`modal` 标题「驳回审核」，正文替换为说明段 + 84px 高 textarea（占位「请输入驳回原因（必填）」，无 label），确认「确认驳回」，空值 → 输入框红边 + 聚焦 + toast「请填写驳回原因」，弹窗不关；成功 toast「审核已驳回」。列表行与抽屉底栏共用同两弹窗（抽屉侧成功后 `closeDrawer()` L4544–4545）。
- 代码：`UserSkillReviews.vue:178–204`、`ReviewSkillDetailPage.vue:168–192` 单一「技能审核」弹窗：结果单选 通过/不通过 + 审核意见 textarea（2000 字）+「提交审核」。
- 要做：通过 → `ElMessageBox.confirm`（可仿 `govDialogs.confirmApproveReview` 新增 `confirmApproveUserSkill`）；驳回 → 复用 `ReviewRejectDialog`（已有必填校验 + 500 上限 + 聚焦），空值提示形态取 md「弹出"请填写驳回原因"提示」（toast）还是组件现有内联报错需定；删旧弹窗。
- 量级：小
- 与 md 的关系：一致（md §6.1 / §6.2）；驳回空值提示 md 写「弹出提示」=原型 toast，`ReviewRejectDialog` 现为内联文案——二选一

#### U-4. 查看技能·形态（右侧抽屉 vs 新标签整页）——待负责人第 7 项①裁决
- 原型：`openAuditViewer` L4502–4513：基座右侧抽屉（780px L42）标题「查看技能」；正文三张 `section-card`：基本信息 `form-grid` 两列（技能名称 / 提交人 / 提交时间 / 审核状态 tag / 审核尺度 tag / 技能描述 full）→ SKILL.MD 灰底等宽 pre 块 → 检测明细（标题旁 `section-sub`「共 4 项」，4 张 `.audit-risk-card`：序号圆标 + 名称 + 等级 tag 右对齐 / 位置行 / 代码 blockquote / 依据段，按等级换底色 L4426–4440）；底栏 L4510–4511：【关闭】+ 待审时【通过】(plain)【驳回】(primary 红底) ——注意顺序为 通过→驳回，与审核中心 驳回→通过 相反。留在列表页，关闭即回列表。
- 代码：`UserSkillReviews.vue:63–66` `window.open` 新标签 → `ReviewSkillDetailPage.vue` 整页复用 `SkillFocusEditor`（`review-mode` 右栏检测手风琴 + 顶栏【审核】）；无抽屉。
- 要做：(a) 若裁决「抽屉」：新建 `UserSkillAuditDrawer.vue`（`el-drawer` 780px，三段卡片 + 吸底 关闭/通过/驳回），列表页内打开，`ReviewSkillDetailPage.vue` 与路由 `router/index.js:368` 退役；(b) 若裁决「整页」：保留整页但内容按 md §五 补齐三段并把顶栏【审核】换为底部 关闭/通过/驳回，且请浦月改 md §五。两种都要 mock 补 `location/code/scale/status` 字段（`skillReviewMock.js:48–92`）。
- 量级：中（抽屉）/ 中（整页补齐）
- 与 md 的关系：md §五「打开右侧详情抽屉」= 原型；代码整页与之冲突（已在第 7 项①挂起）

#### U-5. 风险设置抽屉（代码缺失）
- 原型：`openRiskSettingsDrawer` L4495–4501：基座右侧抽屉标题「风险设置」；`renderRiskDrawerBody` L4487–4494 正文两张 `section-card`：①「当前审查尺度」h4 + 单选行 通用/严格/宽松（`change` 即改 `state.skillAuditCurrentScale` L4557，即时生效）；②说明段「维护三套审核尺度模板…」+ `.risk-settings-tabs` 三 Tab（宽松/通用/严格，默认「通用」，下划线激活样式 L4446–4448）+ 当前尺度说明段 + 表格（colgroup 130/auto/220：检测项 / 说明 / 触发审核的最低风险等级，第三列为纵向单选组，选项集合按检测项不同 L4464）；底栏 L4493：【恢复默认】(plain, 左) + spacer + 【取消】(plain) + 【保存设置】(primary)。动作 L4546–4548：保存 → toast「「尺度」审核尺度设置已保存」并关抽屉；恢复默认 → 重置当前 Tab 并重绘 + toast「已恢复默认设置」；取消 → 直接关（**不回滚**已改单选，Q404）。
- 代码：全站无「风险设置」/「尺度」概念（grep 零命中）；`api/skillReview.js:42–66` 仅有风险类型/等级 CRUD 接口壳。
- 要做：新建 `RiskSettingsDrawer.vue`（`el-drawer` 780px，`el-radio-group` + `el-tabs`/自绘 Tab + `el-table` 内嵌纵向 `el-radio-group`，底栏三按钮）；mock 新增 `riskConfig`（三套默认值表 + 当前尺度，`attachPersist` 持久化 + version）；【取消】是否回滚按 md §7「不保存，关闭抽屉」实现回滚（原型不回滚属缺陷）；列表【风险设置】按钮接入（U-1）。
- 量级：中
- 与 md 的关系：一致（md §七）；【取消】语义 md「不保存」vs 原型「已改即生效」——按 md

#### U-6. 页面说明与导航接线
- 原型：L4525 `render` 覆写：标题「用户技能审核」、副标题「审核用户上传的自定义技能，处理高风险检测记录，并设置风险尺度。」；导航 L4526–4527 按文本劫持。
- 代码：`UserSkillReviews.vue:98–101` 副标题「客户端用户提交的技能审核申请。平台共享技能审核通过后进入平台技能列表。」；`AdminRail.vue:111` 路由已正确。
- 要做：副标题改 md 文案（负责人第 7 项③已裁决取 md）。
- 量级：小
- 与 md 的关系：按 md（原型副标题与 md 不同，Q399 已按 md 销项）

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件 |
| --- | --- |
| 治理列表统一四态（loading 骨架 / 加载失败 + 重试 / 空态 / 竞态防护 / 防空页回退） | `composables/useAdminList.js`、`components/admin/ListStates.vue`（原型只有空态 `.empty`） |
| 行内动作忙态：通过/驳回/撤回按钮 loading + 同行置灰防重复提交 | `UnifiedReview.vue:242–261`、`MyApplications.vue:281–301`、`GovObjectDetail.vue:161–170` |
| 我的申请 OTHER 类型 toast「该申请对象暂无可跳转的业务页面」（原型 L1770 末尾兜底，代码逐字保留） | `MyApplications.vue:117–121` |
| 治理行 `refId` 接线到各业务 mock 真实实体（专家 203 / 模型 md_104 / 技能 sk_302,sk_309 / 连接器）+ localStorage 持久化 | `api/reviewsMock.js:52–67`、`api/myApplicationsMock.js` |
| 用户反馈真实缩略图（blob objectURL、6 路并发、revoke 管理）+ 多图查看器 + 失败提示弹窗 | `AdminFeedback.vue:68–128、282–296`（形态是否保留见 F-1） |
| 访问审计 / 用户反馈 关键词域说明与 `fmtTime` 统一时间格式 | `AdminLoginLogs.vue`、`AdminFeedback.vue:217` |
| 字段字典 保存失败弹窗内联展示原因（md §五 有、原型无） | `FieldManagement.vue:161–162` |
| 字段字典 编辑器行输入 `@input` 清错、`saving` loading | `FieldManagement.vue:236–253` |
| 用户技能审核 整页 `SkillFocusEditor` 只读 + 文件树浏览（`source='review'`） | `ReviewSkillDetailPage.vue`、`components/position/SkillFocusEditor.vue`（去留随 U-4 裁决） |
| 技能整页借用态「← 返回」回对应治理列表、离开前 flushAllDirty | `AdminSkillEditPage.vue:889–898、1037` |

## 四、原型侧缺陷（合并时不应照搬）

1. **审核中心基座抽屉与监听死代码**：core 的 `openReviewDetail` L1611–1617（fm5 520px 抽屉「审核详情」明细列表）与 `drawerMask` 监听 L1589–1595 被 `review-native-detail-fix` L1734 capture 拦截覆盖，永不执行；`my-applications-behavior` 的 `openDetail` L1757–1766 与 `closeDetail` L1767 同样无调用方（L1777 走 `goBusiness`）。→ 不搬；代码现走业务原生视图正确。
2. **访问审计三层 `renderAudit`**：L1565（含「全部用户」下拉）与 L1566（含终端列）均被 L1814 覆盖；`state.auditUser` L1521 残留。→ 不搬「全部用户」筛选（md §二 亦无）。
3. **岗位治理详情复用旧抽屉**：`openNative`/`goBusiness` 调 `openPositionEditor` L1202（两段式旧抽屉），而岗位模块本体已改整页 6 页签（`position-detail-prototype-module` L1843 起，仅拦截列表点击）——治理侧看到的岗位形态与岗位模块不一致。→ 按 md「780px 抽屉」落地，抽屉内容待补定义（G-4）。
4. **`.fm5-drawer.my-app-drawer{width:min(620px,90vw)}`** L1740 无 DOM 使用（Q284）。→ 不搬。
5. **审核中心批准后 `reviewedAt` 写死 `'2026-08-28 14:30'`** L1620/L1623；我的申请 `now()` L1745 同样写死。→ 代码用真实时间。
6. **用户技能审核层**：`needsManualAudit` L4476 键名 `'高危险'` 等与 `normalizeRiskLevel` 输出 `'高风险'` 不匹配恒 false（Q413）；`levelClass` L4505 键名旧命名致卡片底色永不上色（Q412）；`SCALE_DESC` L4466「阻断/告警/放行」旧模型与默认值表矛盾（Q414）；`.tag.blue/.tag.yellow` 全局注入 L4416–4417；导航靠文本匹配劫持 L4526；风险设置【取消】不回滚 L4548（Q404）；无分页。→ 等级 class 映射按 md §2.2 重写；尺度说明文按 md §七；取消回滚；分页按 md 动态。
7. **用户反馈附图弹窗为占位预览区**（L1672「原型中展示附件预览区域」）。→ 弹窗骨架可搬，内容放真实大图（F-1）。
8. **字段字典删除用原生 `window.confirm`** L1640。→ 用 `ElMessageBox`（D-2）。
9. **审核中心排序不稳定 / `reviewTarget` 残留** L1521、L1655（Q268/Q272）。→ 不搬。

## 五、量级汇总

- 小：G-2、G-3、G-5、M-1、M-2、R-1、A-1、F-1、F-2、D-1、D-2、D-3、U-1、U-3、U-6 —— **15 条**，合计约 3.5 人天
- 中：G-1、G-4、U-2、U-4、U-5 —— **5 条**，合计约 6 人天
- 大：0 条
- **合计粗估 9–10 人天**（用户技能审核 U-1～U-6 约 4.5 人天，为本路主体；其余五页约 5 人天，其中 G-1/G-2 为共享层改动）

**必须串行（共享组件）**：
1. **G-1 动态分页**（`useAdminList` + `ListPagination`）先做，四页 + 用户技能审核 U-2 再接入；该 composable 被全站 16 个列表页共用，改动须回归其他路。
2. **G-2 抽屉宽 780/820**（`DrawerEditor` 默认 size）与连接器 / 专家 / 模型路共享，须一次改定后 G-3 `barWidth` 随动。
3. **G-4 岗位只读抽屉**依赖岗位路对「治理侧岗位抽屉展示内容」的裁决。
4. **U-4 查看技能形态**依赖负责人第 7 项①裁决，U-2/U-3 可先做（列表与弹窗不依赖形态），U-5 独立。
5. F-1 需先撤销/确认 2026-09-01「保留 ElImageViewer」裁决再动。

## 六、覆盖说明

**原型侧核对的层与函数**：`five-admin-modules-style` L1511–1513（fm5 全部样式）；`five-admin-modules-core` L1519–1570（cfg / state / 种子 / `dynPageSize`·`pageSlice`·`pagerHtml`·`goPage` / `openDialog`·`closeDrawer5` / `renderMyApplications` L1562 / `renderReviews` L1565 / `renderAudit`×2 / `renderFeedback`×2 / `renderFields` L1566 / `renderCurrent`·`render` 覆写 L1567–1568）；`five-admin-modules-behavior` L1571–1685（navMap L1574、`openReviewDetail`·`approveReview`·`rejectReview` L1611–1624、`renderFieldOptions`·`openFieldEditor`·删除 L1626–1641、input/change/click 监听 L1643–1683）；`review-native-detail-style`/`-fix` L1707–1738（`openNative`·`approve`·`reject`·`footerHtml`·`setSkillFooter`·capture 监听）；`my-applications-style`/`-behavior` L1739–1786（`goBusiness`·`withdraw`·`submitAudit`·底栏·监听）；`time-sort-multidevice-audit-*` L1788–1838（`renderAuditMultiDevice`·`P.renderAudit=`·`render` 覆写）；`user-skill-audit-style`/`-module` L4413–4560（`renderUserSkillAudit`·`renderRiskDrawerBody`·`openRiskSettingsDrawer`·`openAuditViewer`·`rejectWithReason`·`render` 覆写·导航劫持·四组监听）；被治理详情调用的业务抽屉入口：`openPositionEditor` L1202–1210、`openExpertViewer` 最终覆写 L1400、`openDrawer` L174、`openModelDrawer` L245、`openApiEditor` L758、`openBizEditor` L761；基座样式 `.drawer` L14/L17/L42/L77/L110/L1385、`.module-toolbar` L110/L340、`.table*`·`.empty`·`.page-btn`·`.ops` L13、`modal()` L186、`toastMsg` L185、`closeDrawer` L184。确认 L2682 `frontend-target-sync-script` 引用 `fiveProto` 仅为岗位 Agent 弹窗复用 `openDialog`，与治理页无关。

**代码侧核对的文件**：`views/admin/MyApplications.vue`、`UnifiedReview.vue`、`ReviewSkillDetailPage.vue`、`AdminLoginLogs.vue`、`AdminFeedback.vue`、`FieldManagement.vue`、`UserSkillReviews.vue`、`AdminSkillEditPage.vue:880–1035、1205–1225、1298–1310`；`components/admin/GovObjectDetail.vue`、`ListToolbar.vue`、`ListStates.vue`、`ListPagination.vue`、`ReviewRejectDialog.vue`、`DrawerEditor.vue:40–100`、`ModelConfigEditDialog.vue:1–30、349–355`、`AdminRail.vue:106–114`；`composables/useAdminList.js`；`utils/govDialogs.js`；`api/reviewsMock.js`、`myApplicationsMock.js`、`loginLogMock.js`、`feedbackMock.js`、`fieldDictMock.js`、`skillReviewMock.js`、`skillReview.js`；`router/index.js:103–230、352–368`；`assets/list-page.css`、`main.css:108–134`、`connector.css:93–107`。

**未覆盖**：各业务编辑器（ExpertEditor / McpEditor / ApiEditor / BizSystemEditor / ModelConfigEditDialog）只读态**内部**布局是否与原型对应抽屉一致——属专家 / 连接器 / 模型路；岗位模块整页与治理侧岗位抽屉的内容取舍——属岗位路；`SkillFocusEditor` 内部结构——属技能路；未运行 dev server 做截图比对（契约禁止），所有尺寸结论来自 CSS 静态阅读；`__tests__` 随动范围未逐一列出。
