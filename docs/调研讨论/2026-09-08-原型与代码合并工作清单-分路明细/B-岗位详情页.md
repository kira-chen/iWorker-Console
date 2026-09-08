# 合并差距分析 B：岗位详情页整页

基准原型：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（下文行号均指该文件）
基准 md：`docs/prd/PRD-20260907/02岗位/岗位/prd.岗位.md` §三（下文「md §x」）
代码：`frontend/src/views/admin/PositionDetailTabs.vue`（下文 PDT）、`frontend/src/components/position/**`、`frontend/src/utils/positionModel.js`

## 0. 原型最终生效态判定（先说结论，后面全部据此比对）

原型岗位详情是 14 层 patch 叠加，实际生效链如下（已逐层核对，**两层是死代码**）：

| 层（script id / 行） | 状态 | 说明 |
|---|---|---|
| L1843 `position-detail-prototype-module` | 生效（非人格页签的壳 + 底层 pane） | IIFE 内 `renderPositionDetail`/`renderPosPane`/`currentPos` 均为**局部**函数，只经 `window.positionDetailProto2` 暴露 `render/currentPos/intakeDemo/markDirty`（L1879） |
| L2023 `position-detail-dialogs-prototype` | 生效但大部分入口不可达 | `openPublish`(L2039)/`openSkillPicker`(L2032)/`openDossierCreate`… 依赖 `data-pd-action`/`data-pd-popup`，最终页面里这些按钮已被后层替换，只剩 `remove-intake` 删除确认(L2043)仍可达 |
| L2087 `position-persona-20260902-module` | **半死**：L2093 `personaPane=` 全局赋值成功；L2094 `var oldRenderDetail=renderPositionDetail` 抛 ReferenceError，其后所有事件绑定未注册 | 人格页 DOM 结构由它定义，行为由 L2119 层接管 |
| L2109 `position-required-publish-20260902-module` | **死**：首行 `renderPositionDetail` 未定义即中断 | — |
| L2119 `position-final-render-fix-20260902` | **生效（人格页签 + 页头 + 发布检查 + 采集抽屉的最终版）** | `render` 覆写(L2127)：`tab==='persona'` 走 `persona()`(L2126)，其余页签回落 L1843 `renderPositionDetail`；`validate()` L2129；`openPub()` L2132；采集抽屉 `openIntake` L2143（document 捕获拦截，早于 L2281 的 `openIntakeWithOptions`，所以 L2337 版本不生效） |
| L2281 `position-workprofile-v3-module` | 生效（工作档案页 MutationObserver 整体替换 `.pd2-content`，L2312） | `pane()` L2302；L2327 包一层 `window.personaPane` 删除「岗位认领说明」卡 |
| L2346 `task-pane-redesign-module` | **死**：L2455 `var oldRenderPosPane=renderPosPane` 抛错，`tasksPane`(L2397) 与全部任务交互未注册 | 任务页最终形态不是这层 |
| L2670 `frontend-target-sync-script` | 生效 | `syncPosition`(L2680)：agents 页签替换为 `agentTable()`(L2678)；tasks 页签替换为**静态** `taskPane()`(L2679)；Agent 编辑/技能引用弹窗(L2686–2692) 后被 L4007 替换 |
| L2706 `workprofile-basic-info-alignment-script` | 生效 | `alignWorkProfile` L2708：档案头改「基本信息」卡 + 头部 取消/保存 |
| L2792 `workprofile-rule-strategy-refinement-script` | 生效 | 编目信息/档案详情标题回写 + 归纳方式富下拉 `enhanceStrategies` L2815 |
| L2930 `agent-task-feedback-refinement-script` | 生效 | Agent 表包卡(L2933)；任务列表操作精简(L2950)；周期分段按钮+执行星期(L2966)；工具搜索(L2995)；技能添加(L3011)；底部只留保存(L3037) |
| L3373 `task-calendar-preview-editor-refinement-script` | 生效 | 起止日期浮层日历 `renderTaskCalendar` L3388（document 捕获，覆盖 L3077 `renderCalendar`）；详细说明工具栏 `toolbarHtml` L3453、`enhanceEditor` L3456；预览时间格式化 L3435 |
| L3586 `followup-skill-kb-auth-refinement-script` | 生效 | `placeSkillAdd` L3591：「+ 添加技能」移到卡底 |
| L4007 `position-detail-browser-comments-script` | 生效 | `removeUnwantedControls` L4010：工作档案删「必填」列；知识页删「新建知识库」「编辑」；Agent 行删「＋技能」。Agent 抽屉 `openAgentDrawer` L4043（含引用技能勾选） |
| L4225 `position-claim-copy-restored-module` | 生效 | `cardHtml` L4232：「领用页文案」卡插在示例问题之前 |
| L4309 `position-icon-business-systems-module` | 生效 | 人格页首插「岗位图标」卡(L4328)；`syncTab` L4351 **无条件**追加第 7 页签「业务系统」；`paneHtml` L4345；`openPicker` L4361 |
| L4383 `unified-ai-live-generation-module` | 生效 | 示例问题/SOP 的「AI 生成」按钮：描述为空禁用 + title、生成中态、420ms 回填 |

人格页最终分区顺序（`persona()` → `window.personaPane` 四层包裹后）：**岗位图标 → 岗位描述 → 领用页文案 → 示例问题 → 岗位 SOP → 岗位人格**。

---

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
|---|---|---|---|
| 页头（返回/名称/状态/版本/未保存/保存/发布） | `persona()` L2126（人格页）/ `renderPositionDetail` L1872（其余页签，同构） | PDT L768–796 | 一致（尺寸微差） |
| 页签条 | `tabs` L2122 六项 + `syncTab` L4351 注入「业务系统」 | PDT L810、L814–1206 el-tabs | 一致（代码另有 3 个扩展页签，见三） |
| 人格页 · 岗位图标卡 | L4328 `position-icon-section` | PDT L817–836 + `IconPickerPopover.vue` | 局部差异（预览块带 popover 三入口，原型是纯预览块） |
| 人格页 · 岗位描述 / 示例问题 / SOP 卡 | `personaPane` L2093 + AI 层 L4398/L4406 | PDT L839–857、L880–948 | 一致 |
| 人格页 · 领用页文案卡 | `cardHtml` L4232 | PDT L860–877 + `ClaimNotesEditor.vue` L81–115 | 一致（标题文案差异属 02-审查职责） |
| 人格页 · 岗位人格编辑器 | `personaPane` L2093 末段（自研工具栏 + contenteditable） | PDT L951–967 `SkillMilkdownEditor` | 局部差异（Q29 挂起项） |
| 采集字段页 · 表格 | `intakePane` L1854 | PDT L972–1006 | 局部差异（缺卡片壳） |
| 采集字段页 · 抽屉 | `openIntake` L2143（`renderIntakeOptions` L2142） | PDT L1011–1046 | 一致 |
| 采集字段页 · 删除确认 | `confirmBox` L2040（经 L2043 `remove-intake`） | PDT L258–265 | 一致 |
| 工作档案页 | `pane()` L2302 + `alignWorkProfile` L2708 + `enhanceStrategies` L2815 + L4010 删必填列 | `PositionDataTableStage.vue` L527–722 + `dossier/DossierRuleListEditor.vue` | **结构不同** |
| 知识页 | `knowledgePane` L1871 + L4010 删新建/编辑按钮 | PDT L1067–1116 | 局部差异 |
| Agent 与技能页 · 表格 | `agentTable` L2678 + `enhanceAgent` L2933 包卡 + L4010 删「＋技能」 | PDT L1119–1163 | 局部差异 |
| Agent 与技能页 · Agent 抽屉 | `openAgentDrawer` L4043（680px，含引用技能勾选） | PDT L1166–1180（480px，仅名称/描述）+ `SkillPickerDialog.vue` | 局部差异 |
| Agent 与技能页 · 删除 Agent / 移除技能确认 | `confirmDeleteAgent` L2690 / `confirmRemoveSkill` L2691 | PDT L401–417、L644–665 | 一致 |
| Agent 与技能页 · 技能「编辑」跳转 | `editAgentSkill` L2692 + 返回拦截 L2148 | PDT L421–424（新标签） | 局部差异（交互流） |
| 自动化任务页 · 主从骨架 | `taskPane` L2679 + `enhanceTaskList` L2950 | `PositionSampleTaskStage.vue` L358–489、CSS L543–640 | 局部差异 |
| 自动化任务页 · 基本信息卡 | `taskPane` L2679 + L3049（删头部删除钮） | `SampleTaskEditor.vue` L470–513 | 一致 |
| 自动化任务页 · 调度计划卡 | `enhanceSchedule` L2966 + `renderTaskCalendar` L3388 + `normalizePreview` L3435 | `components/task/SchedulePicker.vue` L130–268 | 局部差异 |
| 自动化任务页 · 详细说明卡 | `enhanceEditor` L3456 / `toolbarHtml` L3453 | `SampleTaskEditor.vue` L532–546 + `components/admin/MarkdownEditor.vue` | 局部差异 |
| 自动化任务页 · 引用工具卡 | `taskPane` L2679 + `enhanceTools` L2995 | `SampleTaskEditor.vue` L549–562 + `components/admin/ToolPicker.vue` L66+ | 结构不同 |
| 自动化任务页 · 引用平台技能卡 | `enhanceSkills` L3011 + `placeSkillAdd` L3591 | `SampleTaskEditor.vue` L565–639 | 局部差异 |
| 自动化任务页 · 底部操作 | `enhanceTaskFooter` L3037 | `SampleTaskEditor.vue` L643–647 | 一致 |
| 业务系统页 | `paneHtml` L4345 / `openPicker` L4361 | `PositionBizSystemsPane.vue` L130–209 | 局部差异 |
| 发布前检查弹窗 | `openPub` L2132（前置门 `validate` L2129） | PDT L695–719 + `PublishCheckDialog.vue` L45–119 | 局部差异 |
| 只读态 | 各 pane 的 `ro` 分支；页头隐藏保存/发布（L2126） | PDT L160、各页签 `isReadonly` | 一致（代码为超集，原型多处未做只读） |

---

## 二、差距清单

### 页头 / 页签条

#### 1. 页头·尺寸与名称框微调
- 原型：`.pd2-topbar` 高 64px、`padding:0 24px`，名称框 `.pd2-name` 透明边框、hover/focus 才显边框，`min-width:180px;max-width:330px`，18px 加粗（L1840 样式）；`.pd2-tabs` 高 54px 白底、页签 14px、激活绿色下划线 2px。
- 代码：`.topbar` 56px（PDT L1287–1298），`.tb-name-input` 固定 240px（L1325）；el-tabs 默认头部（L1479–1482）。
- 要做：topbar 高度 64、名称框 min/max 宽与字号对齐、el-tabs 头部高度 54 + 白底 + 左右 28px 内边距。
- 量级：小
- 与 md 的关系：md §1.2 无尺寸定义 → md 无定义

### 人格页签

#### 2. 人格·岗位图标预览块形态
- 原型：`position-icon-control`（L4328）= 42px 静态预览块 `.position-icon-preview` + 两个 plain 按钮「从图标库选择」「上传图标」；预览块本身不可点。
- 代码：预览块是 `IconPickerPopover` 头像（PDT L825–831），点击弹 popover，内含 图标库/上传/AI 生成 三个入口（`IconPickerPopover.vue` L227–253），并叠「换图标」角标。
- 要做：人格页图标卡里把预览块改为纯展示（关闭 popover trigger / 隐藏角标），入口只留旁边两个按钮；popover 形态保留给其它调用点。
- 量级：小
- 与 md 的关系：md §2.2 只定义「从图标库选择」与上传 → 一致（AI 生成入口为代码超集）

#### 3. 人格·「AI 生成」按钮档位
- 原型：`<button class="plain pnew-ai">`（L2093）常规尺寸 plain 按钮，位于卡片头右侧。
- 代码：`el-button size="small" plain`（PDT L885–896、L922–933）。
- 要做：去掉 `size="small"`，与页内其它 plain 按钮同档。
- 量级：小
- 与 md 的关系：md §2.3 「plain 样式」→ 一致

#### 4. 人格·岗位人格编辑器形态（Q29 挂起项，需负责人裁决）
- 原型：自研 `.pnew-toolbar`（撤销/重做 | 段落 select | B / I / • 列表 / 1. 列表 / 表格）+ `.pnew-editor` contenteditable，min-height 190（L2093 末段；样式 L2085）；只读态显示 `readonly-value` 预格式文本。
- 代码：`SkillMilkdownEditor` 320px（PDT L957–965）。
- 要做：若拍板「照原型」→ 新建 `PersonaRichEditor.vue`（工具栏 + contenteditable，execCommand），替换该卡片内容；若拍板「站内范式」→ 不动。
- 量级：中（照原型）/ 0（保留）
- 与 md 的关系：md §2.6 写「富文本编辑器（contenteditable）」+ 工具栏项 → **与 md 一致、与代码冲突**；已记 Q29

### 采集字段页签

#### 5. 采集字段·缺卡片壳
- 原型：整页一个 `.pd2-section` 白卡（L1854）：卡头 `.pd2-list-head`（`strong 采集字段` + `small 员工领用时填写，最多 10 个` + spacer + primary「＋ 新增字段」），卡体直接放 `.pd2-table`（无内边距，表头 `#fafbfa` 底）。
- 代码：`.pd-list-head` 裸标题行 + 裸 `el-table`（PDT L974–1005），无白卡/描边/圆角，按钮 `size="small"`。
- 要做：用人格页已有的 `.pd-card / .pd-card-head` 壳包住标题行 + 表格（表格贴卡体边缘），按钮去 small。
- 量级：小
- 与 md 的关系：md §3.1 无卡片定义 → md 无定义

（采集抽屉、删除确认与原型一致，不列。注：原型抽屉「必填」是 checkbox「设为必填字段」L2143，md §3.2 写「开关」，代码用 `el-switch` 跟 md；属 md↔原型差异，02-审查职责。）

### 工作档案页签（结构不同，最大差距块）

#### 6. 工作档案·整体骨架：左侧档案列表 + 右侧三卡
- 原型：`pane()` L2302 → `.wp3-grid{grid-template-columns:200px 1fr;gap:18px}`（L2245）。左栏 `.wp3-side`：每档案一张 `.wp3-profile-card`（名称 + 「N 个字段」，选中 `.on` 绿边绿底），底部虚线「＋ 新增」`.wp3-add-tab`；只读隐藏「＋ 新增」。右栏 `main` 纵排三张 `.wp3-sec`（白卡、头 `.wp3-head` 50px 灰底、体 `.wp3-body` 18px）。
- 代码：`PositionDataTableStage.vue` L530–560 顶部一行横向 `.wd-card` 芯片 + 右侧 取消/保存/＋新建 按钮；下方 `.pd-sec` 策略段 + `.wd-two` 双栏（L608–658）。
- 要做：改为左 200px 竖列档案卡 + 右侧纵排三卡；「＋ 新增」移到左栏底部虚线按钮；只读隐藏。
- 量级：中
- 与 md 的关系：md §4.1 写「档案列表：档案名称、说明、状态、操作」（表格口径）→ **与 md 冲突（md §4.1 写的是表格列表，原型是左栏卡片列表）**

#### 7. 工作档案·「基本信息」卡（档案名称/说明就地编辑 + 抽取策略 + 头部取消/保存）
- 原型：`alignWorkProfile` L2708 把第一卡改为：头 `strong 基本信息` + spacer + `.wp3-head-actions`（plain「取消」+ primary「保存」）；体：`.wp3-basic-fields` 两列（档案名称 input / 档案说明 input，只读为 `readonly-value`），下接 border-top 的 `.wp3-policy` 三列：抽取方式（只读值「指定触发」+ checkbox「自动抽取」）/ 置信度阈值 select / 用户确认 select（L2302）。
- 代码：`.pd-sec` 头显示档案名 + 描述 + 「档案信息」link（L578–584）打开弹窗改名；策略三列为 el-form（L586–605），抽取方式是 select；取消/保存在页顶（L554–557）。
- 要做：卡头改「基本信息」+ 右侧 取消/保存；名称/说明改卡内两列就地输入；抽取方式改「指定触发」只读值 + 自动抽取勾选；保存 toast「配置已保存到页面草稿」。
- 量级：中
- 与 md 的关系：md §4.3 未定义策略区 → md 无定义

#### 8. 工作档案·「编目信息」卡改为行内可编辑网格
- 原型：`.wp3-sec` 头 `strong 编目信息` + `span N / 8`；体：`.wp3-grid-head.wp3-card-grid`（字段名 / 字段类型 / 字段用途 / 唯一 ID / 说明 / 空）+ 每行 `.wp3-grid-row`（input / select 类型 / select 用途 / `.wp3-unique-icon` ✓✕ 点击置唯一 / input 说明 / × 删除）+ 底部「＋ 新增条目」（`cardRows` L2298）；L4010 删掉「必填」列后网格 `1.2fr .8fr .8fr 52px 1.5fr 28px`（L3989）。满 8 条 toast「最多 8 个卡位」。
- 代码：只读 `el-table`（字段名/字段类型/字段用途/唯一 ID，L619–630）+ 「编辑」primary 打开 960px 弹窗 `DataTableFieldEditor`（L701–709）。
- 要做：删弹窗入口，卡体改行内网格编辑（含唯一 ID 图标切换、删除、＋ 新增条目、N/8 计数）；`DataTableFieldEditor` 可退役或改为行内组件。
- 量级：大（与 #9 同批，共享网格样式）
- 与 md 的关系：md §4.3 写「编目字段（字段名、类型、展示用途、唯一 ID、必填、说明），支持添加/删除，最多 8 个」→ **与 md 冲突（md 保留「必填」列；原型 L4010 已删）**

#### 9. 工作档案·「档案详情」卡改为行内网格 + 归纳方式富下拉
- 原型：头 `strong 档案详情` + `span N / 8`；网格头（规则名 / 规则描述 / 归纳方式），行 = input / input / `.wp3-rule-strategy`（`enhanceStrategies` L2815 把 select 换成 `.wp3-rich-select`：触发器显示「标题 + 灰色说明」，下拉四项 取最新/累积成列表/摘要最近 N 条/保留冲突并列，各带说明）/ ×；底部「＋ 新增条目」（`ruleRows` L2301）；网格列 `minmax(120px,1.1fr) minmax(180px,1.6fr) minmax(260px,2.3fr) 28px`（L2774）。
- 代码：只读 `el-table`（规则名/规则描述/归纳方式，L646–654）+ 960px 弹窗 `DossierRuleListEditor`（L712–720）。
- 要做：同 #8 改行内网格；归纳方式用 el-select 自定义 option 模板（标题 + 说明）近似富下拉。
- 量级：中（网格样式复用 #8）
- 与 md 的关系：md §4.3 「详情字段、内容要求、归纳方式」→ 一致（列名文案差异归 02-审查）

#### 10. 工作档案·新建档案弹窗按钮与后续动作
- 原型：`openInfo` L2297：480px 对话框「新建工作档案」（档案名称* / 说明），底部 取消 / **确定**；确定后直接在左栏新增并选中，toast「配置已保存到页面草稿」。
- 代码：`el-dialog` 480「新建工作档案」底部 取消 / **下一步**（L662–675），进入右侧新建态后再点「创建档案」。
- 要做：按原型改为「确定」即建档并选中（去掉二段式新建态）。
- 量级：小
- 与 md 的关系：**与 md 冲突（md §4.2 写「【取消】【下一步】」且提示"工作档案已创建，请继续配置编目信息和档案详情"，原型最终版是「确定」）**——需裁决

### 知识页签

#### 11. 知识·卡片壳 + 筛选工具栏
- 原型：`knowledgePane` L1871：一个 `.pd2-section` 卡：卡头 `pdHead('知识库','该岗位可见范围内的知识库')`；卡内 `.pd2-kb-toolbar`（搜索框 220px「搜索知识库名称」+ 状态 select 130px「全部状态/未发布/审核中/已发布」+ plain「查询」，点查询才过滤）；下接 `.table.kb2-table` 六列（知识库名称 230 / 知识库描述 200 / 数据源 160 / 文档数量 80 / 状态 100 / 操作 170）；空态 `.empty` 200px「暂无该岗位可见的知识库」。只读时搜索/下拉/查询禁用。
- 代码：裸 `.pd-list-head` + `el-table`（知识库名称/类型/数据源/状态/操作，PDT L1069–1114），无搜索与状态筛选。
- 要做：包卡；加工具栏（关键词 + 状态 + 查询按钮，查询触发过滤）；列改为 名称/描述/数据源/文档数量/状态/操作；空态文案位置照卡内。
- 量级：中
- 与 md 的关系：md §5.1 列「知识库名称、类型、数据源、状态、操作」，无筛选 → **与 md 冲突（列集合不同：md 有「类型」列无「描述/文档数量」；md 无筛选工具栏）**

#### 12. 知识·操作列与入口按钮（原型最终无「新建」「编辑」）
- 原型：L4010 `removeUnwantedControls` 删除 `[data-pd-action="new-pos-kb"]` 与 `edit-pos-kb` → 最终卡头**无「＋ 新建知识库」**，行内仅「查看」「检索测试」（所有状态都显示）。「查看」→ 跳知识库模块并打开查看抽屉（L1877）；「检索测试」→ `kbProto.openSearch` **就地**弹检索测试对话框，不离开岗位页。
- 代码：卡头有「＋ 新建知识库」（L1071），行内 查看 / 编辑 / 检索测试（仅已发布），三者均 `router.push` 跳知识库模块（`gotoKbModule` L603–613）。
- 要做：是否删「新建/编辑」待裁决（见与 md 关系）；「检索测试」改为就地弹出知识库模块的检索测试组件（复用，不跳转）；「查看」保持跳转 + 返回。
- 量级：中（检索测试就地弹窗需抽出知识库模块的检索组件，属共享组件）
- 与 md 的关系：**与 md 冲突（md §5.2 写「点击【＋ 新建知识库】打开知识库编辑抽屉」，§5.3 写行内「查看/编辑/检索测试」；原型 L4010 明确删掉新建与编辑）**——需裁决，建议按 md（L4010 是浏览器评论层的临时删除）

### Agent 与技能页签

#### 13. Agent·表格包卡（绿条卡头）
- 原型：`enhanceAgent` L2933 把 `.sync-agent-head` 改为 `.pd2-task-section-head.sync-agent-card-head`（左侧 3px 绿条、灰底、`strong Agent 与技能` + 灰色副标 + 右侧 primary「＋ 新 Agent」），表格放进 `.sync-agent-card-body`，整体 `.sync-agent-card` 白卡（样式 L2874–2880）。表格 `.sync-table` 列：AGENT / 技能 | 职责描述 / 分类 | 工具(120 居中) | 操作(170)；Agent 行 `.sync-agent-row` 灰底加粗、「◆ 名称」，技能行 `.sync-agent-skill` 缩进「· 名称」。
- 代码：裸 `.pd-list-head` + `el-table`（PDT L1121–1162），列与行样式已对齐。
- 要做：包卡 + 卡头样式（绿条）；按钮去 small。
- 量级：小
- 与 md 的关系：md §6.1 写「泳道形式 + 拖拽排序」→ **与 md 冲突（md 是泳道，原型最终是表格；代码已按表格）**——02-审查已有条目，此处按原型

#### 14. Agent·新建/编辑走同一 680px 抽屉（含「引用技能」勾选区），Agent 行去「＋技能」
- 原型：`openAgentDrawer` L4043：共享右抽屉 `.position-agent-drawer` 680px；体 = `section-card 基本信息`（Agent 名称* maxlength 60 / 职责描述* maxlength 300 + hint「职责描述用于判断任务应该交给哪个 Agent」）+ `section-card 引用技能`（头「引用技能 / 直接在当前编辑页勾选，可引用已发布技能」+ 搜索框 + `.position-agent-skill-row` checkbox 列表：name + 描述，70px 行高）；脚 取消 / 新建|保存。「＋ 新 Agent」与行内「编辑」都开它；保存后 toast「Agent 已新建 / Agent 已更新」。L4010 删掉 Agent 行的「＋技能」按钮，故技能引用**只在抽屉里勾选**。
- 代码：「＋ 新增 Agent」直接创建「新 Agent」无弹窗（`addAgent` PDT L381–392）；「编辑」开 480px 抽屉仅名称/描述（L1166–1180）；技能引用靠 Agent 行「＋技能」→ `SkillPickerDialog`（560px 对话框，逐条「引用」按钮，L1242–1246）。
- 要做：新建改为开抽屉；抽屉加宽 680 并增加「引用技能」勾选区（已发布技能 + 搜索，勾选即为该 Agent 的技能集合，保存时 diff 出 assign/detach）；删 Agent 行「＋技能」；`SkillPickerDialog` 退役或保留备用。
- 量级：中
- 与 md 的关系：**与 md 冲突（md §6.2 抽屉字段只有名称/描述、名称 40 字/描述 500 字；md §6.4 写「点击【＋ 技能】打开技能选择弹窗」；原型 L4010 已删该按钮并把引用并入抽屉）**——需裁决

#### 15. Agent·技能「编辑」改为同页跳转 + 返回回到本页签
- 原型：`editAgentSkill` L2692：记 `positionDetailBeforeModule/Id/Tab` 后 `state.module='skills'` 同页进技能编辑器；技能编辑器「← 返回」被 L2148 拦截，恢复到岗位详情 Agent 页签。
- 代码：`openSkillFullPage` PDT L421–424 `window.open(...,'_blank')` 新标签。
- 要做：改 `router.push({name:'AdminSkillEdit', query:{fromPosition: id, fromTab:'agents'}})`，技能编辑页返回按钮消费 query 回到 `PositionWorkbench` 并激活 agents 页签（需 AdminSkillEdit 配合，共享）。
- 量级：中
- 与 md 的关系：md §6.4 / §11 「进入技能详情页编辑，编辑完成后可【← 返回】回到岗位详情页」→ 一致

### 自动化任务页签

#### 16. 任务·主从容器：240px 白底左栏 + 灰底右栏，去卡片外壳
- 原型：`.pd2-task-layout{grid-template-columns:240px 1fr;height:calc(100dvh - 64px - 54px);background:#f5f7f6}`；左 `.pd2-task-list` 白底右描边、`.pd2-list-head` 隐藏（L2668）；右 `.pd2-task-detail` 滚动、内容 `.pd2-task-detail-inner{max-width:860px;margin:0 auto}`（样式 L2344）。
- 代码：`.st-editor` 带描边/圆角/阴影/zoomIn 动画的浮层卡（`PositionSampleTaskStage.vue` L543–556），`.st-body` 300px + 1fr（L633–637）。
- 要做：embedded 模式去外壳描边/阴影/动画，左栏 240px，右栏内容限宽 860 居中。
- 量级：小
- 与 md 的关系：md §7.2 「主从布局」→ 一致

#### 17. 任务·列表项操作精简为「删除」（在名称行右侧）
- 原型：`enhanceTaskList` L2950：删掉「编辑」，把「删除」danger-link 挪进 `.pd2-task-name` 右侧（`margin-left:auto`，L2882）；副行「每周 09:00 · 2 个工具」；拖拽手柄 hover 显示；底部虚线「＋ 新增样例任务」。
- 代码：`.st-ops` 含 停用/启用、编辑、[测试]、删除（`PositionSampleTaskStage.vue` L416–444）。
- 要做：列表项只留「删除」在名称行右侧；「编辑」= 点行本身；启停按钮去留见 md 关系。
- 量级：小
- 与 md 的关系：**与 md 冲突（md §7.2 写「支持启用 / 停用单个任务」，原型列表无启停）**——需裁决（建议保留启停为代码超集，但从列表项移到详情卡内）

#### 18. 任务·分区卡头样式（绿条 + 灰底）
- 原型：`.pd2-task-section-head`：46px、左 3px 绿条、`#f8faf9` 底、下描边（L2344）。
- 代码：`.te-card-title` 圆点 + 文本，卡有阴影 `box-shadow:var(--shadow-card)` 与 20px 内边距（`SampleTaskEditor.vue` L670–691）。
- 要做：卡头改为带底色的头条 + 绿条，卡体单独 18px 内边距；去阴影。
- 量级：小
- 与 md 的关系：md 无定义

#### 19. 任务·调度计划：周期分段按钮 / 执行星期 / 起止日期日历浮层 / 预览框
- 原型：`enhanceSchedule` L2966：周期类型 `.pd2-task-segmented`（每天/每周/每月/仅一次，选中绿底）；执行星期 `.pd2-task-weekdays` 七个可切换按钮（仅每周显示，L3129）；定点时间行 = 序号圆 + `.pd2-task-time-input`（⏰ + time input）+ × + 「+添加时间」link + hint；起止日期两个 `.pd2-calendar-field` 只读文本框（左侧日历图标），点开 `task-date-calendar-layer` 固定定位日历（386px，头 « ‹ 年月 › »，`renderTaskCalendar` L3388）；预览 `.pd2-task-preview` 绿底框（✱ 「每周 09:00」+「接下来 3 次：」白底药丸 `2026-09-07 09:00`，L3435 已去 T/时区）。
- 代码：`SchedulePicker.vue`：`el-radio-button` 组 / `el-checkbox-button` 星期 / `el-time-picker` / `el-date-picker` 起止 / `.sp-preview`（MagicStick 图标 + 文本 + `<ul>` 列表，L254–266）；另有每月「执行日期」多选（L157–184）与仅一次 datetime（L187–197）。
- 要做：预览框改绿底 + 药丸；起止日期可保留 `el-date-picker`（等价交互，建议不自研日历，需负责人认可）或照 L3388 自研；分段/星期用现有 radio-button/checkbox-button 即可（视觉近似）。
- 量级：小（预览 + 样式）/ 中（若要求自研日历）
- 与 md 的关系：md §7.2 仅写「支持定时触发、事件触发等」→ md 无定义

#### 20. 任务·详细说明编辑器形态
- 原型：`enhanceEditor` L3456：卡头「详细说明 *」；体 = 引导文案 `.pd2-task-editor-guide` + `.pd2-task-editor-toolbar`（B I S | H ❞ ☷ 1. | <> ▣ ↗ ▦ | ↶ ↷，`toolbarHtml` L3453）+ `.pd2-task-editor` contenteditable（min-height 120）+ 脚只留「字数: N」计数（L3480–3486）。
- 代码：`.te-card-hint` + `MarkdownEditor`（md-editor-v3，320px，L539–545）。
- 要做：与 #4 同一裁决：照原型则复用 #4 的 `PersonaRichEditor` 并在脚部加字数；保留 Milkdown/md-editor 则只加字数计数。
- 量级：小（复用 #4）/ 中（独立做）
- 与 md 的关系：md 无定义

#### 21. 任务·引用工具卡：平铺行 + 搜索框 + 「+ 添加工具」
- 原型：`taskPane` L2679 + `enhanceTools` L2995：卡体 = 搜索框 `data-static-tool-search`「搜索工具名称 / 类型」（输入即过滤）+ `.pd2-task-tool-row` 平铺行（`strong 名称` + `small 类型` + 右侧 tag「已验证」）+ 底部虚线「+ 添加工具」。
- 代码：`ToolPicker`（`components/admin/ToolPicker.vue` L116–…）：「已选 N 个工具」摘要 + `el-collapse` 按来源分组 + checkbox 勾选。
- 要做：卡体改为「已引用工具平铺行 + 搜索」，「+ 添加工具」打开一个选择弹窗（原型此按钮无实现，弹窗内容可复用 ToolPicker）。
- 量级：中
- 与 md 的关系：md §7.2 「执行动作：选择要执行的 Agent 或技能」→ **与 md 冲突（md 无「引用工具」卡，原型有）**——02-审查职责，此处按原型

#### 22. 任务·引用平台技能卡：已选 chips + 搜索 + 卡底「+ 添加技能」
- 原型：`enhanceSkills` L3011 + `placeSkillAdd` L3591：hint 段 + `.pd2-task-added-skills` chips（名称 + ×）+ 搜索框「搜索平台技能名 / 描述」+ 卡底满宽虚线「+ 添加技能」（原型实现是把输入框文字直接变 chip，L3156–3170）。
- 代码：chips + 搜索 + 候选列表 checkbox 行（`SampleTaskEditor.vue` L574–637），无「+ 添加技能」按钮。
- 要做：候选列表改为点「+ 添加技能」后再展开/弹出（默认收起），其余保留。
- 量级：小
- 与 md 的关系：md 无定义

### 业务系统页签

#### 23. 业务系统·卡片壳 + 工具栏（新增按钮在工具栏右侧）
- 原型：`paneHtml` L4345：`.pd2-section` 卡：卡头 `strong 业务系统` + `span 该岗位已引用的业务系统`；卡内 `.position-biz-toolbar`（72px：搜索框 320px「搜索业务系统名称或描述」+ spacer + primary「＋ 新业务系统」）；下接表格；空态 `.position-biz-empty` 48px 内边距文案。
- 代码：裸 `.pd-list-head`（标题 + 副标 + 右侧 small primary「添加业务系统」）+ 单独搜索行 + `el-table`（`PositionBizSystemsPane.vue` L132–179）。
- 要做：包卡；按钮从标题行移到搜索工具栏右侧、去 small。
- 量级：小
- 与 md 的关系：md §8.2 「【＋ 新业务系统】」→ 一致

#### 24. 业务系统·表格列与行操作：登录地址/业务页/更新时间 + 仅「查看」
- 原型：列 业务系统（32px 图标 + 名称 + 描述两行）/ 登录地址（ellipsis）/ 业务页（数量）/ 最近更新时间 / 操作「查看」（`rowHtml` L4342）；**无「移除」**。「查看」→ `connectorReviewProto.openBizEditor('edit',item,true)` **就地**打开只读业务系统抽屉，不离开岗位页。
- 代码：列 系统名称 / 系统描述 / 状态 / 操作「移除」（L154–178）；名称点击 `router.push` 跳连接器页（`gotoDetail` L125–127）。
- 要做：列改为原型四列 + 操作「查看」；删「移除」；「查看」就地打开连接器的业务系统只读抽屉（共享组件抽出）。
- 量级：中（就地抽屉属共享组件）
- 与 md 的关系：md §8.1 列「业务系统、登录地址、业务页、最近更新时间、操作」、§8.2 「行内仅【查看】，不支持移除」→ 一致（代码与 md、原型都冲突）

#### 25. 业务系统·页签显隐
- 原型：`syncTab` L4351 **无条件**追加「业务系统」页签。
- 代码：固定第 7 页签（PDT L1198）→ 与原型一致。
- 要做：无。
- 量级：0
- 与 md 的关系：**与 md 冲突（md §1.3 写「当岗位存在已发布业务系统引用时自动追加…无引用时不展示」）**——02-审查职责，此处记录以免被误改

### 发布前检查

#### 26. 发布·前置门缺失项集合
- 原型：`validate()` L2129 只检 岗位名称 / 岗位描述 / 3 条示例问题 / 岗位 SOP，缺失 toast「请先填写：…」并聚焦滚动到第一个 `.pnew-invalid`。
- 代码：`openPublish` PDT L702–715 另加 岗位图标、岗位认领说明 两项。
- 要做：去掉图标、认领说明两项；缺失字段加红框并滚动定位（现仅示例问题有红框 `eqShowErrors`）。
- 量级：小
- 与 md 的关系：md §9.1 四项 → 一致（代码多阻断）

#### 27. 发布·检查弹窗内容与阻断语义
- 原型：`openPub` L2132：`proto2-dialog`（默认 680px）；清单四项固定：岗位名称与描述 ✓ / 示例问题 ✓ / 岗位 SOP ✓ / Agent 与技能 !「存在未验证能力时不阻断发布」；无提示行；表单 版本号*（默认 v013，hint「格式示例：v001」，正则 `^v(?:00[1-9]|0[1-9]\d|[1-9]\d{2})$`）+ 升级说明* textarea；脚 返回修改 / 发布；发布 → `pendingAction='publish'`、toast「已提交发布审核」。**Agent/采集字段均不阻断**。
- 代码：`PublishCheckDialog.vue` 460px；清单由 `computePublishCheck`（positionModel.js L497–560）生成：岗位名称 / 「至少 1 个 Agent 且每个含 ≥1 技能」硬阻断 / 「采集字段定义完整」硬阻断 / 3 条示例问题 / 异常工具 warning；有硬阻断时「发布」禁用（L28、L40–42）；版本号校验 `VERSION_LABEL_RE=/^v\d+\.\d+\.\d+$/`（positionModel.js L221）。
- 要做：清单改为原型四项（Agent 与技能降为 warning，不再要求 ≥1 Agent）；弹窗宽 680；版本号规则改 v001–v999（默认值取下一个 vNNN）。
- 量级：中
- 与 md 的关系：**与 md 冲突（三处）**：md §9.2 清单是「岗位名称 / 示例问题 / 采集字段 / Agent 与技能」+ 提示文案（对应被覆盖的 L2039 旧版）；md §3.4 「发布前必须至少 1 个采集字段」但原型不阻断；md §1.2 版本号示例「v2.1.0」与 §9.2 正则 v001–v999 自相矛盾——需裁决

### 只读态

#### 28. 只读态·无差距（代码为超集）
- 原型：页头隐藏保存/发布（L2126）；人格/采集禁用 + 「只读」；知识筛选禁用；业务系统隐藏新增。工作档案网格行、Agent 表操作、任务页在只读下**未做处理**（见四）。
- 代码：PDT L160 `isReadonly` 覆盖全部页签（工作档案/任务用 `pd-ro-freeze` L1619 冻结）。
- 要做：合并 #6–#9、#14、#16–#22 时保留代码的只读覆盖，不照搬原型缺口。
- 量级：0

---

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件 |
|---|---|
| 扩展页签「运行」「效果测试」「版本」（含版本历史对话框） | PDT L1210–1235、`PositionVersionHistoryDialog.vue`、`components/test/EffectTestStage.vue` |
| 页头 `ThemeToggle` | PDT L789 |
| 离开路由时的未保存确认（原型仅非人格页签有 `window.confirm`，人格页直接离开） | PDT L621–639 |
| 人格·图标 popover 内「AI 生成」入口、裁剪弹窗 | `IconPickerPopover.vue` L244–249、L278–300 |
| 工作档案·「档案信息」弹窗（状态启停 / 系统标识 / 删除此档案） | `PositionDataTableStage.vue` L678–698（原型最终无删除档案入口，L2023 的 `openDossierInfo` 不可达） |
| 工作档案·未落库时空态引导 | `PositionDataTableStage.vue` L563–567 |
| 自动化任务·启用/停用、「缺指令」旗标、拖拽排序落库、测试试跑抽屉 | `PositionSampleTaskStage.vue` L385–445、L492–537 |
| 自动化任务·每月执行日期 / 仅一次日期时间选择 | `SchedulePicker.vue` L157–197 |
| 发布后告警汇总弹窗 | PDT L732–743 |
| 保存时采集字段整体校验（`validateIntakeRows`） | PDT L336–341 |
| Agent 与技能·「工具」列显示读/写计数 | PDT L448–457 |
| 首屏骨架屏 / 错误态重试 / 窗口回焦 refetch | PDT L91–155、L801–808 |

---

## 四、原型侧缺陷（合并时不应照搬）

| 位置 | 问题 | 处理 |
|---|---|---|
| L2087、L2109、L2346 三层 | 引用未定义的局部函数抛错，整层事件失效（见 §0） | 不搬；行为以 L2119 / L2670 静态版为准 |
| L2126 `persona()` 「← 返回」 | 人格页签返回不走 `leavePosition` 的未保存确认，与其它页签不一致 | 不搬，保留代码统一确认 |
| L2678 `agentTable()` | 不接收 `ro`，只读/审核中仍显示 编辑/删除/移除 与「＋ 新 Agent」 | 不搬，保留代码只读 |
| L2298/L2301 `cardRows/ruleRows` | 只读态网格行 input/select 未 disabled | 不搬 |
| L2679 `taskPane()` | 静态 HTML：切换任务无响应、「＋ 新增样例任务」「+ 添加工具」无处理器、删除只是 `item.remove()` 不落数据、周期切换不重算预览、保存只 toast | 骨架照搬，交互按 md §7 + 代码现有 mock 链路 |
| L3156–3170 `data-static-skill-add` | 「+ 添加技能」把输入框文字直接变 chip，没有候选选择 | 不搬，保留代码候选列表，只调整按钮位置（#22） |
| L4010 `removeUnwantedControls` 删知识页「新建/编辑」 | 与 md §5.2/§5.3 冲突，属浏览器评论层临时删除 | 待补定义（#12） |
| L4010 删「必填」列 | 与 md §4.3 冲突 | 待补定义（#8） |
| L2137 采集抽屉「必填」用 checkbox | md §3.2 写开关 | 按 md，保留 `el-switch` |
| L4351 `syncTab` 无条件注入业务系统页签 | 与 md §1.3 条件显示冲突 | 待补定义（#25） |
| L2132 `openPub` 清单固定 ✓ | 四项状态是写死的，不随实际数据变化（Agent 行永远 !） | 骨架照搬，状态由 `computePublishCheck` 真算 |
| L1871 `knowledgePane` 「查看」 | 跳知识库模块后 `positionDetailId=null`，「← 返回」回到的是知识库列表而非岗位页（md §5.3 写可返回岗位页） | 按 md，跳转携带来源并返回岗位页（代码已带 `fromPositionId`） |
| L2302 `pane()` 抽取方式 | 「指定触发」写死为只读值，无可选项 | 骨架照搬（只读值 + 自动抽取勾选），选项集合待补定义 |

---

## 五、量级汇总

- 小：#1 #2 #3 #5 #10 #13 #16 #17 #18 #19(预览) #22 #23 #26 → 13 条
- 中：#4(视裁决) #6 #7 #9 #11 #12 #14 #15 #20(独立做时) #21 #24 #27 → 12 条
- 大：#8 → 1 条
- 合计粗估：小 13×0.3 ≈ 4 人天；中 12×1 ≈ 12 人天；大 1×2.5 ≈ 2.5 人天；**约 18–19 人天**（若 #4/#20 拍板保留 Milkdown/md-editor，减约 2 人天；若 #19 拍板自研日历，加约 1 人天）。

**必须串行 / 共享组件**：
1. `.pd-card` 卡片壳统一（#5 #11 #13 #23 都用它）→ 先做壳，再各页签套用。
2. 行内可编辑网格样式（#8 → #9）：#8 先落，#9 复用。
3. `PersonaRichEditor`（#4 → #20）：同一裁决、同一组件。
4. 就地抽屉/弹窗复用（#12 知识库检索测试、#24 业务系统只读抽屉、#15 技能编辑页返回）：需连接器 / 知识库 / 技能三个模块先把对应组件抽成可独立挂载的组件，属跨路共享，须与 A/C 路协调后再做。
5. Agent 抽屉（#14）与 `SkillPickerDialog` 退役：先定裁决再动，避免与 md §6.4 反复。

---

## 六、覆盖说明

**原型侧已核对**：L1843 底层（`pdHead/personaPane/intakePane/profilePane/agentsPane/tasksPane/versionPane/knowledgePane/renderPositionDetail/enterPosition/leavePosition`）、L2023 弹窗层全部函数及捕获处理器、L2087/L2109（判定死代码）、L2119 全层（`persona/validate/openPub/openIntake/renderIntakeOptions` 及 L2148 技能返回拦截）、L2281 全层（`pane/renderPane/openInfo/cardRows/ruleRows`、新建岗位弹窗 `npOpen/npCreate`、`openIntakeWithOptions`）、L2346（判定死代码）、L2670（`agentTable/taskPane/syncPosition/openAgentEditor/openSkillPicker/confirmDeleteAgent/confirmRemoveSkill/editAgentSkill`）、L2706 `alignWorkProfile`、L2792 `enhanceStrategies`、L2930（`enhanceAgent/enhanceTaskList/enhanceSchedule/enhanceTools/enhanceSkills/enhanceTaskFooter/renderCalendar/openCalendar` 及静态交互处理器）、L3373（`renderTaskCalendar/openTaskCalendar/normalizePreview/toolbarHtml/enhanceEditor/runEditorCommand`）、L3586 `placeSkillAdd/jumpToKnowledge`、L4007（`removeUnwantedControls/openAgentDrawer/skillRowsHtml/saveAgentDrawer`）、L4225 `cardHtml`、L4309（`personaPane` 包裹、`paneHtml/syncTab/openPicker/pickerListHtml/rowHtml`）、L4383（`configFor/syncButton`）；样式块 L1840、L2048、L2085、L2245–2280、L2344、L2668、L2699–2703、L2774–2790、L3336–3369、L3989–4005、L4220–4223、L4288–4308、L4380。

**代码侧已核对**：`views/admin/PositionDetailTabs.vue` 全文；`components/position/` 下 `PositionDataTableStage.vue`(模板+样式)、`PositionSampleTaskStage.vue`(模板+容器样式)、`SampleTaskEditor.vue`(模板+卡样式)、`PositionBizSystemsPane.vue`、`PublishCheckDialog.vue`、`ClaimNotesEditor.vue`、`IconPickerPopover.vue`(模板)、`SkillPickerDialog.vue`；`components/task/SchedulePicker.vue`(模板)、`components/admin/ToolPicker.vue`(模板)、`components/admin/MarkdownEditor.vue`(模板)；`utils/positionModel.js`（`computePublishCheck/validateVersionLabel/VERSION_LABEL_RE`）；`api/positionMock.js`（`publishPosition` 置 `pendingAction`）；`assets/position-detail.css`（`.pd-list-head/.pd-sec/.pd-table/.pd-empty`）。

**未覆盖**：
- 岗位列表页与「新建岗位」弹窗（L2319 `npOpen`）、版本管理侧栏 → A 路范围。
- 图标库统一弹窗（L1310 `unified-icon-picker-behavior`）与 `IconPickerPopover` 图标库弹窗内部形态 → 共享组件，未逐项比对。
- 知识库检索测试弹窗、连接器业务系统只读抽屉、技能编辑页本体 → 分属 C/其它路，此处只比对岗位页内的入口与跳转形态。
- `SkillFocusEditor.vue / SkillFileTree.vue / SkillMilkdown*.vue / ToolDock.vue / AgentLane.vue / SkillCard.vue / ClaimDescEditor.vue / RecommendedQuestionsEditor.vue / PersonaEditDialog.vue / IntakeEditDialog.vue / IntakeFieldEditor.vue / CodeTextEditor.vue / ReferencedToolsPanel.vue / SaveStatusIndicator.vue / TermHelp.vue / PositionIdentityCard.vue / PositionPublishVersionDialog.vue`：岗位详情页当前模板未引用（退役/备查文件），未比对。
- `PositionDataTableStage.vue` 脚本区（L1–526）与 `DataTableFieldEditor.vue`：只核对了模板形态，字段级校验逻辑未审。
- 未启动 dev server，未做截图比对；本文全部基于 DOM/CSS 静态阅读。
