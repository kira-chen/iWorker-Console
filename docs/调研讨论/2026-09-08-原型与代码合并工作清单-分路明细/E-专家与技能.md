# 合并差距分析 E：专家 + 技能（原型 `数字员工管理端交互原型.html` → `frontend/`）

> 只读比对，基准 = 原型最终覆写生效态。行号均指 `docs/prd/PRD-20260907/数字员工管理端交互原型.html`（下称"原型"）；代码行号指 `frontend/src/...`。
> 总体结论：**专家、技能两模块在 0901/0904 两轮对齐后，代码骨架已与原型高度一致（多数区域"一致/局部差异"），本轮没有"代码缺失"级别的页面；剩余差距集中在专家编辑抽屉的分区/字段排版、图标入口形态、知识库卡跳转、少量尺寸与交互细节。**

---

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
| --- | --- | --- | --- |
| 技能 · 列表页（工具栏 + 表格 + 分页） | `renderSkills` 链：L1472（publish-readiness 包装，清 importResult）→ L1285（列表图标注入）→ L925（导入提示，已失效见四）→ **L662（formal-unified-skill-rules，真正出 DOM）**；`skillActions` L1459 → **L622**（fixed-primary-actions-lock）；引用弹窗 L725；时间排序 L649 | `views/admin/AdminSkillsUnified.vue` | 一致（仅排序生效范围、首列宽等局部差异） |
| 技能 · 新建弹窗（zip 导入 / 手动） | **`openSkillCreate` L1408**、`renderSkillPackages` L1407、`saveSkillCreate` L1476 → L1410；zip change/drop L1411–L1412；`skill-new` 清残留 L1419 | `components/skill/SkillCreateDialog.vue` | 一致（局部：弹窗宽 520→480、上传区在未选类型时禁用） |
| 技能 · 整页编辑器（顶行 / 信息区 / 三栏） | `renderSkillEditor` 链：L1474 → L1294（图标行注入 L1286）→ L715（底部时间条）→ **L217（基础骨架 DOM）**；容器类切换 `render` L239（`.skill-edit-page`/`.skill-edit-mode`）；CSS L110/L114；交互处理 L255–L259；发布置灰 L1460–L1470；AI 生成 L4383–L4411 | `views/admin/AdminSkillEditPage.vue` + `components/position/SkillFocusEditor.vue`（+ `SkillFileTree.vue` / `ToolDock.vue` / `SkillMilkdownEditor.vue`） | 一致（局部：栏宽、顶行高、只读态默认安装、提交发布后去向） |
| 技能 · 版本管理侧栏（含审核中态） | 侧栏 DOM L442–L448；逻辑 IIFE L450–L617（`renderVersionManager` L506、`publishHtml` L498、`historyHtml` L489、`submitVersion` L527、`withdrawVersion` L541、`toggleHistory` L552）；入口拦截 L565–L581（capture） | `components/admin/VersionDrawer.vue` + `VersionHistoryList.vue`（适配器在 AdminSkillsUnified.vue L368 / AdminSkillEditPage.vue L192） | 一致 |
| 技能 · 停用/删除/撤回确认 | L259（`skill-stop` / `skill-delete` 引用拦截 + 确认；`skill-withdraw` 直接执行无确认） | AdminSkillsUnified.vue L225–L305 | 一致（撤回多一层确认，见四·原型缺陷） |
| 专家 · 列表页 | **`renderExperts` L1061**（expert-category lock）；`expertActions` **L986**；`expertView` L311；头像底色 `paintExpertList` L3789 + MutationObserver L3807；列表点击分发 L331 / L1046（capture，发布/版本管理）/ L379（查看） | `views/admin/AdminExperts.vue` | 一致 |
| 专家 · 新建/编辑抽屉 | `openExpertEditor` 链：**L4198（final-layout：字段最终顺序 + 示例问题标题加 \*）** → L4168（知识库卡 `addKnowledgeSection` L4154）→ L3799（背景色 `addBackgroundField` L3780）→ L1398（默认头像 ☆）→ L1111（polish：示例问题并入基本信息卡为子分区，`expert-editor-drawer` 样式 L1079–L1107）→ L1063（分类字段 + 示例问题区）→ L709（时间条）→ **L690（富文本职责描述 + 内嵌技能勾选，真正出 DOM）**；图标行改造 `decorateEditor` L1331（统一图标库/上传）；字段规则 `applyPrdFieldRules` L1415；保存拦截 L1419 | `components/admin/ExpertEditor.vue`（容器 `components/admin/DrawerEditor.vue`，图标 `components/position/IconPickerPopover.vue`） | 局部差异（分区卡片化、字段两列栅格、图标双按钮、知识库卡跳转） |
| 专家 · 查看抽屉 | 全局链 `openExpertViewer` L1400 → L1113 → L1067（追加分类 + 专家帮你做）→ L711（时间条）→ L691；**但列表【查看】实际命中 L379–L384 闭包内的旧版 `openExpertViewer` L368**（见四） | ExpertEditor.vue readonly 分支 L482–L539 | 一致（以 md + 全局链为准；原型实际生效的是旧版，属原型缺陷） |
| 专家 · 版本管理侧栏 | 侧栏 DOM L1011–L1016；逻辑 IIFE L1018–L1051（`renderManager` L1039、`openManager` L1040、`submitVersion` L1043、`withdrawVersion` L1044、`toggleHistory` L1045）；入口 L1046（capture）；`openExpertVersion` L994 | `components/admin/VersionDrawer.vue`（适配器 AdminExperts.vue L149） | 一致 |
| 专家 · 发布/停用/删除/撤回确认 | L331（停用/删除 modal）；L994（撤回 modal）；抽屉底部【发布】L334 | AdminExperts.vue L186–L277；ExpertEditor.vue L401 | 一致 |

---

## 二、差距清单（逐条，按页面分组）

### A. 技能 · 列表页（AdminSkillsUnified.vue）

#### A1. 技能列表 · 「最近更新时间」排序只作用于当前页
- 原型：L649 `skill-time-sort` 切换 `state.skillSort` 后 `render()`，L664 先对**全量**列表排序再 `pageSlice`；列头是 `<button class="sort">最近更新时间 ↓/↑</button>`。
- 代码：`AdminSkillsUnified.vue` L639 `sortable`（非 custom）→ el-table 只对当前页数据客户端排序；`useAdminList` 参数里也没有 sort 字段（L57–L67）。
- 要做：改 `sortable="custom"` + `@sort-change` 写入 `query.sort` 交给 `listUnifiedSkills`（mock 侧按 updatedAt 排）——与 `AdminExperts.vue` L73 的做法对齐。
- 量级：小
- 与 md 的关系：一致（md §二.2 "默认按最近更新时间由近到远排列，点击列头切换升降序"）

#### A2. 技能列表 · 首列宽与图标尺寸
- 原型：L1275 首列 `col` 宽被改为 290px；名称前图标 `.expert-avatar.skill-list-icon`（26px 方块，L1281）。
- 代码：`AdminSkillsUnified.vue` L583 `min-width=230`，`.sk-icon` 24px（L765–L776）。
- 要做：首列 min-width 290、图标 26px（与专家列表 `.ex-avatar` 同尺寸）。
- 量级：小
- 与 md 的关系：md 无定义

#### A3. 技能列表 · 「引用状态」筛选项
- 原型：最终层 L666 工具栏只有 搜索 / 技能类型 / 技能分类 / 状态 / 查询 / 新建（早期层 L216/L344 的 `skillReferenced` 已被覆盖）。
- 代码：`AdminSkillsUnified.vue` L544–L559 多一个「引用状态」下拉（非岗位私有时禁用 + tooltip）。
- 要做：属代码超集（?referenced 深链用），布局上多占一格；若要与原型逐格一致可改为仅 `type===POSITION` 时渲染（v-if）而非禁用。
- 量级：小
- 与 md 的关系：md 无定义（md §一 只列四个筛选）

### B. 技能 · 新建弹窗（SkillCreateDialog.vue）

#### B1. 新建弹窗 · 尺寸与上传区
- 原型：`.modal.wide` 宽 `min(520px, 100vw-32px)`（L110）；`.zip-drop-proto` 最小高 148px（L111）；选中包后 `.zip-drop-proto.has-files` 变绿边浅绿底（L1389）。
- 代码：`el-dialog width="480px"`（L232）；拖拽区 `min-height:140px`（L411）；无 has-files 态。
- 要做：宽 520、拖拽区 148、有包时给拖拽区 accent 边/底。
- 量级：小
- 与 md 的关系：md 无定义

#### B2. 新建弹窗 · 未选类型时的可操作性
- 原型：L1408 类型未选也可先上传 zip / 填名；点【导入技能包】/【创建】时 L1410 校验失败 → 红字 `.skill-create-error.show`（按钮不禁用）。
- 代码：`SkillCreateDialog.vue` L258 `:disabled="zipImporting || typeMissing"` 上传区禁用；L350/L359 确认按钮 `:disabled="typeMissing"`。
- 要做：去掉 typeMissing 对上传区与确认按钮的禁用，改为点击时校验并显示红字（红字文案已一致）。
- 量级：小
- 与 md 的关系：**与 md 冲突（md §三.2 写"未选择类型、分类或未填写创建内容时不可提交"）**——md 倾向禁用、原型倾向点击拦截；需拍板。

#### B3. 新建弹窗 · 技能包行布局
- 原型：L1407 `.skill-package-row` 两列栅格 `minmax(0,1fr) 190px`，行内只有 包名 + 分类下拉（无删除 ×、无状态字）；L1389 行样式 padding 12/14、圆角 8、底 #fafbfa。
- 代码：`.zip-item-main` flex：包名 + 分类下拉（132px）+ 状态字 + ✕ 删除（L274–L296）。
- 要做：分类下拉加宽到 190px；✕ 删除/状态字为代码超集（保留不动，md 未禁止）。
- 量级：小
- 与 md 的关系：md 无定义

### C. 技能 · 整页编辑器（AdminSkillEditPage.vue / SkillFocusEditor.vue）

#### C1. 编辑器 · 三栏栏宽与顶行高度
- 原型：L114 `.skill-editor-stage{grid-template-columns:282px minmax(500px,1fr) 384px}`，收起工具栏 `282px … 44px`；顶行 `.skill-editor-top` 高 60px（L114；L340 又设 64px）；顶行内 select 32px、主按钮 32px；≤1100px 降为 `230/430/320`。
- 代码：`SkillFocusEditor.vue` L1696 `240px minmax(0,1fr) var(--dock-w)`，`--dock-w:320px`（L1247）；顶行 `min-height:48px`（L1282）；按钮高 26px（`.topline-savecfg`/`.topline-verpub`）。
- 要做：树栏 240→282、工具栏 320→384、顶行 48→60/64、顶行按钮 26→32；响应式断点数值同步。
- 量级：小
- 与 md 的关系：md 无定义

#### C2. 编辑器 · 只读态顶行「默认安装」
- 原型：L233 只读时 `技能分类` select `disabled` 仍显示，`默认安装` checkbox `disabled` 仍显示（PLATFORM）。
- 代码：`showDefaultInstall` 要求 `!ro`（L297）→ 只读态不渲染；分类 select 只读禁用仍显示（L323）。
- 要做：**建议不改**——md §三.3 明确"只读态…不展示技能分类修改、默认安装"，代码更贴近 md；记录为 md↔原型差异待裁决。
- 量级：小
- 与 md 的关系：**与 md 冲突（md §三.3 写只读态不展示默认安装/技能分类修改；原型展示为禁用）**

#### C3. 编辑器 · 提交发布后的去向
- 原型：L537–L538 版本侧栏 `submitVersion` 成功后 `state.skillEditing=null; render()` → **离开编辑器回到列表**。
- 代码：`AdminSkillEditPage.vue` L235 `onVersionDone` 重拉详情，**留在编辑页**并进入锁定态（`ed-lock-notice`）。
- 要做：**建议不改**——md §四.1 写"列表状态变为审核中，编辑页锁定"，md §三.1 写"审核锁定状态：存在审核中操作时页面只读，顶部提示'技能审核中，已锁定不可修改'"，代码贴 md。记录差异。
- 量级：小
- 与 md 的关系：**与 md 冲突（md 要求编辑页锁定并提示；原型直接回列表，且原型编辑器没有锁定提示条）**

#### C4. 编辑器 · 信息区标签列宽与描述框高度
- 原型：L114 `.skill-info-row{grid-template-columns:76px 1fr}`，描述框 `.skill-desc-input{height:86px}`（3 行 + 右下计数）、示例问题框 38px。
- 代码：`.ib-l{width:64px}`（L1630）、描述 `rows=3` el-textarea、示例问题 el-input 32px。
- 要做：标签列 64→76、示例问题输入高 38。
- 量级：小
- 与 md 的关系：md 无定义

#### C5. 编辑器 · 图标行按钮形态（与 E2 同源）
- 原型：L1290 图标行 = 预览方块 + `[选择图标]`，随后被 L1331 `decorateEditor` 改写为 `[从图标库选择][上传图标]` 两个 plain 按钮并排（`.compact-icon-row`）。
- 代码：`SkillFocusEditor.vue` L914–L928 = 预览方块 + `IconPickerPopover`（头像触发 popover，popover 内再列「从图标库选择 / 上传图标 / AI 生成」）。
- 要做：在图标行直接渲染两枚显式 plain 按钮，调用 `IconPickerPopover` 已 `defineExpose` 的 `openLibrary` / `triggerUpload`（L223），与岗位详情卡的做法一致；只读态两按钮禁用。
- 量级：小（专家/技能各改一处，可共用一个小包装组件）
- 与 md 的关系：一致（md §三.4 图标统一规则：点击【从图标库选择】/【上传图标】）

#### C6. 编辑器 · 左侧导航轨宽度（共享，非本模块专属）
- 原型：L114 `.app.skill-edit-mode .rail{display:block}` 保留 204px 完整侧栏（L651）。
- 代码：`AdminSkillEditPage.vue` 用 `AdminRail`（`clamp(150px,12vw,180px)`）。
- 要做：属全局侧栏尺寸问题，交侧栏/布局路；本模块不动。
- 量级：—（归口布局路）
- 与 md 的关系：一致（md §三.1 "保留左侧导航栏"）

### D. 技能 · 版本管理侧栏（VersionDrawer.vue）

#### D1. 版本侧栏 · 无差距
- 原型 L442–L511 结构：头（标题 + 状态标签 + ×）/ 对象名 / 发布新版本（gate 提示、更新类型三按钮、版本号、升级说明 + 红字 + 计数）/ 版本历史（行：版本号 + 已启用/已禁用 + 禁用/启用按钮；元信息 大小/发布人/发布于/禁用于；升级说明）/ 底部 提交发布 vX + 关闭；审核中态 L500 只留「撤回提交」。
- 代码：`VersionDrawer.vue` L326–L434 逐块对应；`exclusiveActive`、`guardLastActive` 已实现。
- 差异仅在 撤回确认文案（原型 L542 `window.confirm` "撤回本次提交后将回到修改前状态。确认撤回？"；代码 `withdrawText` 分场景两句）——文案级，不计。

### E. 专家 · 新建/编辑抽屉（ExpertEditor.vue）

#### E1. 专家抽屉 · 分区卡片化 + 「专家帮你做」并入基本信息卡
- 原型：L690 每个分区是 `<section class="section section-card">`（L16/L47：白底、1px 边、圆角 10、padding 0 20px 20px、阴影），抽屉底色 `#f5f7f6`（L42 `.drawer`）；L1111 `expert-editor-polish-lock` 把「专家帮你做」区从独立卡**移进「基本信息」卡内**作 `.expert-basic-subsection`（L1102：上边框 + margin-top 26 + padding-top 24）；L1082 卡标题 17px/700；抽屉 foot 76px（L1104）。最终顺序：基本信息卡［表单栅格 + 专家帮你做子分区］→ 市场技能引用卡 → 知识库卡 → 时间条。
- 代码：`ExpertEditor.vue` L557–L785 四个 `.ee-sec` 平铺（无卡片边框/底色；`DrawerEditor` `.de-body` 仅 gap），「专家帮你做」是独立第二段（L653）。
- 要做：① `.ee-sec` 改卡片视觉（白底/边/圆角/内边距，抽屉体给浅灰底）；② 「专家帮你做」移入基本信息卡内作子分区（上边框分隔，标题保留 `*` + 副标题 + 右侧【AI 生成】）；③ 段标题字号提到 17px。注意 `DrawerEditor` 为多模块共用，卡片化应做成局部 class（不改 DrawerEditor 默认样式），或由"抽屉容器"路统一拍板。
- 量级：中
- 与 md 的关系：md 无定义（md §三.2/§三.3 把"基本信息"与"专家帮你做"列为两节，但未规定卡片归属）

#### E2. 专家抽屉 · 基本信息两列栅格 + 图标行双按钮
- 原型：L690 `.form-grid`（L16：`repeat(2,minmax(0,1fr))`，gap 18）；label 在输入框上方（L14 `.label{display:block;margin-bottom:7px}`）。最终字段顺序（L4191）：`专家名 | 分类`（各占半列）→ `图标 | 背景色`（各半列；图标行 = 36px 预览 + [从图标库选择][上传图标]，L1331；背景色 = 7 个 30px 色块 + hint，L3786）→ `简介`（full，textarea）→ `职责描述`（full，`.expert-role-field` 左标签 92px + 富文本编辑器：工具栏 52px + 文本域 min-height 230 + 右下角 "N / 2000"，L675）。
- 代码：`ExpertEditor.vue` L560 `el-form label-width="88px" label-position="left"` 单列纵排；图标 = `IconPickerPopover` 头像触发式（L585）；职责描述 = `SkillMilkdownEditor` height 320 + 计数（L635–L644）。
- 要做：① 基本信息改两列栅格、label 置顶（专家名/分类、图标/背景色两两同行，简介/职责描述通栏）；② 图标行改显式双按钮（同 C5）；③ 职责描述编辑器高度 320→约 282（52+230）并保留右下计数。
- 量级：中
- 与 md 的关系：一致（md §三.2 字段与顺序一致；md 未规定栅格）

#### E3. 专家抽屉 · 市场技能引用卡片列表形态
- 原型：L1096 `.expert-skill-list` 两列栅格 gap 12，卡 `.skill-check` min-height 84、padding `16px 15px 14px 44px`、checkbox 绝对定位左上（L1099）、选中态左侧 4px 绿条 + 绿底（L1100–L1101）、hover 上浮；搜索框 42px 高与「已选择 X 个 · 共 Y 个市场技能」同行（L1093–L1095）；默认只显示 2 张 + 居中【展开更多（N）】（L686–L688，`.expert-skill-more` 34px plain）。
- 代码：`ExpertEditor.vue` L703–L732 `.ee-sk-grid` 两列（L1018）、`.ee-skill-check` padding 12；【展开更多】是 `el-button link`（L729）。
- 要做：卡内边距/最小高/选中态左绿条按原型；【展开更多】改 plain 按钮居中（34px）。
- 量级：小
- 与 md 的关系：一致（md §三.4）

#### E4. 专家抽屉 · 知识库卡「查看 / 检索测试」交互流
- 原型：L4174 `view` → 收抽屉、切知识库模块、`render()` 后**直接 `openKbViewer(kb)`**（落到知识库查看态）；L4175 `test` → **不收抽屉**，就地 `openSearch(kb)` 弹检索测试（叠在专家抽屉之上）。
- 代码：`ExpertEditor.vue` L264–L267 两个动作都 `close()` 后 `router.push` 带 `kbId/kbAction` 查询串；注释 L260–L263 说明知识库页目前只消费 `?tab`，深链未接。
- 要做：① `test`：不关抽屉，直接在专家抽屉上层打开 `KnowledgeSearchDialog`（`components/admin/KnowledgeSearchDialog.vue` 已有）；② `view`：跳转后由知识库页按 `kbId` 直开查看态——依赖知识库路接住 `kbId/kbAction`（串行）。
- 量级：中（含知识库页配合）
- 与 md 的关系：md 无定义（md 专家章节未提知识库卡；原型 L4133 新增）

#### E5. 专家抽屉 · 知识库卡表格样式与「展开更多」
- 原型：L4113–L4130 `.expert-kb-table` 12px 字、表头 36px 灰底、行 padding 11/10、名称下副标题 small 省略；搜索框带 ⌕ 前缀图标（L4116）；默认 2 行、【展开更多（N）】plain 居中 min-width 112（L4127）；空态「未找到匹配的知识库」。
- 代码：`ExpertEditor.vue` L738–L780 同结构（表头/列/空态/展开更多 plain small）。
- 要做：核对字号/行高/搜索框前缀图标（细节），基本一致。
- 量级：小
- 与 md 的关系：md 无定义

#### E6. 专家抽屉 · 尺寸与遮罩点击反馈
- 原型：`.drawer` 宽 `min(780px,88vw)`（L42）；L198 点击遮罩不关闭但 toast「请使用右上角关闭或底部按钮退出，避免误操作丢失内容」；抽屉标题仅文字（无状态标签）。
- 代码：`DrawerEditor` 默认 720px（L55），`close-on-click-modal=false` 无 toast；标题旁多一枚状态 `StatusTag`（ExpertEditor L477，超集）。
- 要做：`ExpertEditor` 传 `size="780px"`；遮罩点击 toast 属 DrawerEditor 共用行为（归口抽屉容器路，此处仅记录）。
- 量级：小
- 与 md 的关系：一致（md §三.1 "点击抽屉外区域不关闭抽屉"；toast 为原型附加）

#### E7. 专家抽屉 · 示例问题【AI 生成】位置
- 原型：L1063 区标题右侧一枚【AI 生成】（`.ai-generate-btn`，常规字重 L1383），一次填满 3 行（L4402）。
- 代码：`ExpertEditor.vue` L654–L668 同为区级一枚，走 `useAiLiveGenerate`。
- 要做：无（代码 = 原型）。仅记录 md 冲突。
- 量级：—
- 与 md 的关系：**与 md 冲突（md §三.3 写"每条输入行旁展示【AI 生成】按钮"，原型/代码为区级一枚）**

### F. 专家 · 查看抽屉（ExpertEditor.vue readonly 分支）

#### F1. 查看抽屉 · 无实质差距（按全局链 + md）
- 原型全局链 L691+L1067+L711：基本信息卡（专家名 / 状态 / 简介 full / 职责描述 full / 分类〔追加在末尾〕）→ 专家帮你做卡（"1. …" 行）→ 市场技能引用卡（"N 个技能"，`.expert-view-skill` 名称+描述块）→ 时间条（创建/最近更新/最近发布/最新版本）；底部仅【关闭】。
- 代码：L482–L539 同结构（分类放第三格更合理）；卡片化问题同 E1。
- 要做：随 E1 卡片化一并处理；分类字段位置保持代码现状。
- 量级：小（并入 E1）
- 与 md 的关系：一致（md §三.1 查看态"全部只读，底部仅【关闭】"）

### G. 专家 · 列表页（AdminExperts.vue）

#### G1. 专家列表 · 无实质差距
- 原型 L1061：工具栏 搜索(300px)/专家分类/状态/查询/新建；列 专家名(头像+名+状态标签) | 专家描述 | 分类 | 技能数 | 最新版本 | 最近更新时间(排序) | 操作；头像按 `backgroundColor` 着底色（L3794）；`expertActions` L986。
- 代码：`AdminExperts.vue` L287–L418 逐项对应，`sortable="custom"` 全量排序。
- 差异：代码专家名可点击进编辑（L339 `<a class="ex-name">`），原型为纯文本——代码超集，见三。

---

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件 | 说明 |
| --- | --- | --- |
| 技能列表「引用状态」筛选 + `?referenced=` 深链 | `views/admin/AdminSkillsUnified.vue` L54–L92, L544–L559 | 原型最终层无此筛选（A3 只建议改渲染条件） |
| 技能列表「🧪 测试」/ 编辑器「🧪 试跑此技能」（feature flag 关闭） | `AdminSkillsUnified.vue` L307–L347, L659–L666；`SkillFocusEditor.vue` L873–L886 | 入口隐藏，保留链路 |
| 技能编辑器 SKILL.md frontmatter「基本信息（名称、描述等）」折叠区 | `SkillFocusEditor.vue` L1072–L1106 | 原型正文区只有工具栏 + textarea |
| 技能编辑器 Milkdown 所见即所得 + 代码/YAML/JSON 编辑器 + 二进制下载态 | `SkillMilkdownEditor.vue` / `CodeTextEditor.vue`；`SkillFocusEditor.vue` L1109–L1148 | 原型为 textarea（L233）；md §三.6 的工具栏能力代码已覆盖 |
| 文件树 ••• 菜单（新建/重命名/删除/下载）、≤1100px 文件抽屉 | `SkillFileTree.vue`；`SkillFocusEditor.vue` L1212–L1240 | 原型 ••• 无处理器（L233 仅展示） |
| 技能编辑器「审核中锁定」提示条 | `SkillFocusEditor.vue` L985–L992 | md §三.1 要求，原型无（见四·6） |
| 技能编辑器被治理页借用（审核中心 / 我的申请 吸底操作栏） | `AdminSkillEditPage.vue` L61–L72, L1207–L1219 | 原型 L1710–L1786 亦有同构借用，属治理路范围 |
| 新建弹窗 zip 行 ✕ 删除、逐包导入状态与失败行内红字、部分失败保留 | `SkillCreateDialog.vue` L134–L197, L287–L297 | 原型只列包名 + 分类 |
| 技能撤回前二次确认 | `AdminSkillsUnified.vue` L285–L305 | 原型 L259 直接执行；md §二.3.4 要求确认 → 保留 |
| 专家列表专家名可点击进编辑 | `AdminExperts.vue` L339 | 原型纯文本 |
| 专家抽屉标题旁状态标签、审核锁定 el-alert | `ExpertEditor.vue` L477, L544–L551 | 原型标题无标签；审核中原型列表已禁编辑 |
| 图标 popover 内「AI 生成」入口 | `IconPickerPopover.vue` L243–L249 | 原型仅图标库/上传两入口 |
| `views/admin/SkillCategories.vue`（技能展示分类管理页） | 未挂路由（`router/index.js` 无引用） | 原型无对应；分类改为 fieldDict 固定 8 类后已成死文件，本轮不动（可另议清理） |
| 用户技能审核借用 SkillFocusEditor（`reviewMode` 右栏安全检测手风琴） | `views/admin/ReviewSkillDetailPage.vue`；`SkillFocusEditor.vue` L1153–L1189 | 原型 L4452 用户技能审核是独立抽屉（不共享编辑器），属治理路范围 |

**SkillFocusEditor 复用说明**：岗位私有 / 市场技能 / 通用技能三类走 `AdminSkillEditPage.vue`（`meta.skillSource`/`skillChannel` 切数据源，同一 DOM），本文差距 C1–C5 对三类同时生效；岗位工作台（`PositionDetailTabs.vue`）与用户技能审核（`ReviewSkillDetailPage.vue`）共享同一组件但不传 `adminContext`/传 `reviewMode`，改样式时需保证这两条路径不回归（C1 栏宽改动会同时影响岗位工作台，需与岗位路知会）。

---

## 四、原型侧缺陷（合并时不应照搬）

1. **专家【查看】命中旧版 viewer（L368）**：L379–L384 的点击处理器写在 IIFE 内，引用的是同一闭包里的 `function openExpertViewer` L368（旧版：无分类、无「专家帮你做」、时间条只有 当前状态/最新版本/最近更新时间，技能取自已废弃的 `expertSkillCatalog` L279）。全局链 L691→L1067→L711→L1113→L1400 完全没被列表点击调用（仅 `?viewer=1` 预览参数 L391 会走旧版）。**处理：按 md §三.1 + 全局链（代码现状）**，不搬旧版。
2. **技能「刚刚导入」提示条已失效**：L925–L949 的 `.skill-import-flow-notice` / `.skill-import-badge` 依赖 `state.skillImportResult`，但最终层 L1472 在渲染前先置 null 并移除节点，L1410 设置的结果随即被清。实际只剩 toast「已导入 N 个技能包，请从列表点击"编辑"继续配置」。**处理：不搬提示条**（md §三.2 也写"仅一次性轻提示…不展示常驻提示条"，代码现状即是）。
3. **`expert-full-editor-mask` 全屏编辑模式为死代码**：L1384–L1390 CSS 与 L1396/L1400/L1402 的 `clearExpertFullMode` 只做移除，全文没有任何 `classList.add('expert-full-editor-mask')`。**处理：不搬**，专家编辑维持右侧抽屉（md §三.1 亦为抽屉）。
4. **技能列表【撤回】无二次确认**（L259 `skill-withdraw` 直接改状态 + toast「已撤回」）：md §二.3.4 明确"点击后弹出确认窗口"。**处理：按 md**，代码现有确认保留。
5. **引用清单弹窗有两个按钮**：L725 用通用 `modal(title, text, '关闭', fn)`，而 `modal` L266 固定渲染 取消 + 确认 → 出现「取消」「关闭」两枚。**处理：按 md §二.1（"点击弹出引用清单"）保留代码的单【关闭】。**
6. **技能编辑器无「审核中锁定」提示**：原型审核中行的【编辑】禁用（L625），编辑器本身没有锁定条；md §三.1 要求"审核锁定状态…顶部提示"。**处理：按 md（代码已有 `ed-lock-notice`）。**
7. **技能提交发布后原型直接回列表**（L537）：与 md §四.1 "编辑页锁定"冲突。**处理：按 md（代码现状留在编辑页锁定）。**
8. **基础层残留死动作**：L259 的 `skill-publish` / `skill-file-add` / `skill-tool-add` 在最终 DOM 里没有任何触发按钮（`renderSkillEditor` L233 不渲染它们）；L255 描述计数仍写 `/ 1000`（与 L233 的 `/ 2000` 不一致，且 L1415 已把 maxlength 设为 2000）。**处理：不搬，以 2000 为准。**
9. **示例问题 AI 生成落点**：md §三.3 "每条输入行旁"，原型 L1063 为区级一枚——md↔原型不一致，代码随原型；**待负责人裁决**（已应在《PRD与原型一致性审查结果-20260907》内，此处仅标注不改）。
10. **新建弹窗未选类型可提交**（原型点击时拦截，md 写"不可提交"）：B2 已标记，待裁决。
11. **原型分页 vs md "页面不分页"**（技能 md §二.1、专家 md §二.1 都写不分页；原型 L666/L1061 用 `pagerHtml` 分页）：代码与原型一致（有分页），不属本路差距；记入一致性审查。
12. `L621` 注释"用户模块保持原样"等与本模块无关；`window.confirm` 原生确认（L542、L557、L1044、L1045）为原型省事写法，代码用 ElMessageBox 即可，不搬。

---

## 五、量级汇总

| 量级 | 条目 | 小计 |
| --- | --- | --- |
| 小 | A1、A2、A3、B1、B2（待裁决）、B3、C1、C2（建议不改）、C3（建议不改）、C4、C5、E3、E5、E6、F1（并入 E1） | 15 条（其中 3 条建议不改/待裁决，实际动手约 12 条，≈2 人天） |
| 中 | E1（分区卡片化 + 子分区）、E2（两列栅格 + 图标双按钮 + 编辑器高度）、E4（知识库卡 查看/检索测试 交互流） | 3 条（≈2.5–3.5 人天） |
| 大 | 无 | 0 |

**合计粗估：4.5–5.5 人天**（专家抽屉约 3 人天，技能约 1.5–2 人天）。

**必须串行 / 需协同的点**：
- C5 与 E2② 共用"图标行显式双按钮"包装（基于 `IconPickerPopover` 的 `openLibrary/triggerUpload`），先做一次再分别接入专家/技能；连接器/模型/岗位若也要改，应由图标统一路先定包装组件。
- E1 卡片化涉及 `DrawerEditor` 共用容器（MCP/API/模型/用户/角色等抽屉都用），要么局部 class 只作用于专家抽屉，要么由抽屉容器路统一拍板后再做；E6 的遮罩 toast 同理。
- E4 的「查看」深链需知识库路在 `AdminKnowledgeBase` 接住 `kbId/kbAction`，专家侧只能先做「检索测试就地弹窗」。
- C1 栏宽改在 `SkillFocusEditor.vue`，会同时影响岗位工作台内嵌编辑器与用户技能审核详情页，改后需三处截图回归。
- C6 侧栏宽度归口布局路，本路不动。

---

## 六、覆盖说明

**原型侧核对的函数 / 覆写层**（均已读到最终生效态）：
- 基础脚本 L144–L272（`render` L239、`renderSkills` L216、`renderSkillEditor` L217、`openSkillCreate` L235、`saveSkillCreate` L236、`skillActions` L215、点击/输入/变更分发 L253–L259、`modal` L266）；专家基础 L277–L336（`expertView`/`expertActions`/`renderExperts`/`openExpertEditor`/`validateExpert`/`saveExpert`/`openExpertVersion`、分发 L331–L334）。
- 覆写层：L340–L346（统一工具栏样式 + `renderSkills` v2）、L364–L392（旧 viewer + 查看点击）、L394–L617（技能版本侧栏）、L620–L643（fixed-primary-actions）、L648–L673（formal-unified-skill-rules：最终 `renderSkills`/`openSkillCreate`/`saveSkillCreate` v3）、L677–L696（专家富文本 + 内嵌技能勾选：最终 `openExpertEditor`/`openExpertViewer` 基底）、L700–L717（时间条）、L718–L725（删除 title / 引用弹窗）、L920–L981（导入返回提示，已判失效）、L983–L1005（`expertActions`/`openExpertVersion` 最终版）、L1017–L1051（专家版本侧栏）、L1055–L1077（分类 + 示例问题）、L1079–L1117（专家抽屉 polish）、L1268–L1302（技能图标行）、L1310–L1380（统一图标库/上传裁剪）、L1382–L1420（v2-final：最终 `openSkillCreate`/`saveSkillCreate`/`renderSkillPackages`、字段规则、保存拦截）、L1428–L1509（发布就绪门，最终 `skillActions`/`renderSkills`/`renderSkillEditor`/`saveSkillCreate` 包装）、L1710–L1786（治理页借用技能编辑器，只确认返回拦截）、L1791–L1838（无关，确认不影响）、L3744–L3809（专家背景色）、L4113–L4178（专家知识库卡）、L4179–L4209（专家最终字段顺序 + 校验）、L4383–L4411（统一 AI 实况生成）、L4452–L4560（用户技能审核：确认与技能编辑器无共享，未展开比对）。
- CSS：L11–L17、L37–L52、L100–L114、L340、L394–L441、L644–L652、L674–L676、L697–L699、L1053、L1079–L1107、L1382–L1390、L3744–L3764、L4113–L4130。

**代码侧核对的文件**：`views/admin/AdminSkillsUnified.vue`、`views/admin/AdminSkillEditPage.vue`（脚本前 400 行 + 模板/样式全文）、`views/admin/AdminExperts.vue`、`views/admin/SkillCategories.vue`（头注释 + 路由引用）、`components/skill/SkillCreateDialog.vue`、`components/position/SkillFocusEditor.vue`（模板 + 关键样式/计算属性）、`components/position/SkillFileTree.vue`（过滤/搜索段）、`components/position/ToolDock.vue`（结构 grep）、`components/position/SkillMilkdownEditor.vue`（工具栏 grep）、`components/position/IconPickerPopover.vue`、`components/admin/ExpertEditor.vue`（全文）、`components/admin/DrawerEditor.vue`、`components/admin/VersionDrawer.vue`（模板）、`components/admin/AdminRail.vue`（宽度）、`router/index.js`（技能/专家路由段）、`docs/prd/PRD-20260907/03能力/技能/prd.技能.md`、`03能力/专家/prd.专家.md`。

**未覆盖**：`api/unifiedSkillMock.js` / `domainExpertMock.js` 的种子数据与状态机细节（契约限定只比布局与交互）；`VersionHistoryList.vue` 行内元信息字段是否逐项对齐（大小/发布人/发布于/禁用于/升级说明）未逐字核；岗位工作台内嵌 SkillFocusEditor 与用户技能审核详情页只确认共享关系，未比对其自身布局；共享容器（ListToolbar / ListPagination / PageHeader / AdminRail / DrawerEditor）的尺寸细节归口对应路。
