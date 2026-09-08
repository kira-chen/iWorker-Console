# 原型 html → 前端代码合并差距分析 · C 路：知识库模块全套

> 基准：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（行号均指该文件）最终覆写生效态；代码 `frontend/src/**`。只比布局与交互，字段/文案级差异不重复（已在《PRD与原型一致性审查结果-20260907.md》）。
> 原型分层结论（先定生效层）：知识库主体在 `knowledge-proto2` 脚本块 L1890–L2019；后置补丁三层——①确认弹窗/标题合并层 L2049–2060（`kb2ConfirmMask` + `decorate()` MutationObserver）；②`knowledge-source-api-auth-refinement-script` L3220–3300（`removeKnowledgeStopButtons` L3226 删抽屉「提交停用」、`enhanceSourceStatus` L3247 给数据源工具栏注入状态筛选、`enhanceApiAuth` 只作用于连接器 API 编辑器 `state.editor.kind==='api'`，**与知识库无关**）；③专家侧 `expert-knowledge-card-module` L4133–4178。`sourceFields` 覆写链：L1937 基定义 → L1987（MCP 改走 `kmcpMarkup` L1978）→ L2018（API 注入递归示例组）= **最终态**；`openSourceEditor/Viewer` 最终态 = L1988/L1989（只设 MCP 上下文后回调 L1939/L1938 基定义）。L3610 `jumpToKnowledge` 与 L1948 `openKbEditorForPosition` 在最终态均为**死代码**（见四）。

---

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
|---|---|---|---|
| 知识库页容器（标题/副标题 + 双页签） | `renderKnowledge` L1899（`.kb2-tabs` 下划线页签，CSS L1840）；页面壳 `.page{max-width:1480px;margin:0 auto}` L23 | `views/admin/AdminKnowledgeBase.vue`:53-66；`layouts/AdminLayout.vue`:24-30 | 一致（页签形态）/ 局部差异（页面壳无限宽居中，属全站共享壳） |
| 知识库列表：工具栏 | `renderKbList` L1900（`.kb2-toolbar` 300px 搜索 + 2 个 150px select + 查询 plain + spacer + primary 新建；L2022 覆写 nowrap） | `views/admin/KnowledgeBaseList.vue`:167-190（`ListToolbar` + `assets/list-page.css` 280/150） | 一致 |
| 知识库列表：表格 + 行操作 + pager | `renderKbList` L1900（7 列 colgroup 230/110/160/80/140/100/280；`kbActions` L1900 状态矩阵；`.pager` 恒显「共 N 条」） | `KnowledgeBaseList.vue`:192-265 | 局部差异（pager 显示规则、名称可点） |
| 知识库列表：行内确认弹窗 | L1945 `confirmBox`（L2051 自建 `proto2-dialog pd2-confirm-dialog`，删除时 `primary.is-danger` 红按钮）；**列表删除 `delete-kb-list` 无确认直接删** | `KnowledgeBaseList.vue`:97-122（`ElMessageBox.confirm type=warning`） | 局部差异（确认按钮样式档） |
| 知识库抽屉（新建/编辑） | `openKbEditor` L1936 + `sourceMultiSelect` L1917 + `drawerShell` L1914（720px）+ L3226 删「提交停用」 | `components/admin/KnowledgeBaseEditor.vue`:364-473 + `DrawerEditor.vue` | 局部差异（分区卡片头、2 列网格、类型控件、底部按钮档） |
| 知识库抽屉（查看） | `openKbViewer` L1936（同表单全 disabled）+ L3226 | 同上 `mode='view'` | 局部差异（同上 + 未发布查看态按钮与 md 冲突） |
| 数据源列表：工具栏 | `renderSourceList` L1905 + `enhanceSourceStatus` L3247 注入 `#source2Status` | `views/admin/KnowledgeSourceList.vue`:104-128 | 一致 |
| 数据源列表：表格 + 行操作 | `renderSourceList` L1905-1910（6 列 240/100/210/100/260/220；`.kb2-delete-guard` 悬浮 tip L3812-3816） | `KnowledgeSourceList.vue`:138-196 | 一致（tip 文案按 md，Q 已记） |
| 数据源抽屉：公共区 | `openSourceEditor` L1939 / `openSourceViewer` L1938（`proto2-ref-group` 90px 左标签；类型 radio；`pd2-mini-note` 灰底说明块；标题「新建/配置/查看数据源」无状态 tag） | `components/admin/KnowledgeSourceEditor.vue`:523-566 | 局部差异 |
| 数据源抽屉：上传类 | `sourceFields('上传')` L1937（section「内置 RAG 配置」卡片头；检索策略 2 列网格 + 阈值提示框） | `KnowledgeSourceEditor.vue`:569-611 | 一致（仅卡片头样式） |
| 数据源抽屉：API 类 | `sourceFields('API')` L1937 + L2018 递归示例注入 + L2009-2016 递归子字段（`api-src-req-grid` 160px/1fr；`api-param-*` 6 列网格；`api-resp-*` 4 列；「＋ 添加参数/字段」为 note 行右侧 plain 按钮） | `KnowledgeSourceEditor.vue`:614-690；`SourceMappingEditor.vue`；`SourceMapParamRows.vue` | 局部差异 |
| 数据源抽屉：MCP 类 | `kmcpMarkup` L1978-1985（section「MCP 检索」→ 卡「连接与鉴权」→ 卡「检索工具」下拉多选 + 「拉取工具」→ note；**L1985 弯引号 class 使 section 壳与写回失效**） | `KnowledgeSourceEditor.vue`:693-819 | 局部差异（工具选择控件；映射卡待裁决） |
| 数据源抽屉：测试连接 | L1939 尾部 `#sourceDynamicFields` 之后裸 `plain` 按钮 + `.hint`；L1946 `test-source` 交互（测试中→重新测试、hint 变绿） | `KnowledgeSourceEditor.vue`:822-828 | 局部差异 |
| 文档管理抽屉 | `openDocs` L1940（`.kb2-doc-upload` 虚线框居中上传区；5 列表；失败原因挂在状态格下）+ L2058 标题合并 + L2056 删除确认 | `components/admin/KnowledgeSourceDocsDrawer.vue`:124-179 | 局部差异 |
| 检索测试弹窗 | `openSearch` L1941（`proto2-dialog` 680px；2 列表单；`kb2-search-stats` 灰底三段统计条；`kb2-result` 卡）+ L1946 `run-search` + L2058 标题合并 | `components/admin/KnowledgeSearchDialog.vue`:97-176 | 局部差异 |
| 专家抽屉「知识库」卡 | L4150 `addKnowledgeSection`（技能区后；搜索框带 ⌕；5 列表；默认 2 行 + 展开更多）；L4166-4174 查看=收抽屉跳知识库开查看抽屉、检索测试=**原地**开弹窗 | `components/admin/ExpertEditor.vue`:264-267, 738-780 | 局部差异（检索测试跳转方式、深链参数名） |
| 跨模块深链（岗位/专家 → 知识库） | L1877 `view-pos-kb/edit-pos-kb`（切模块后直接调 `openKbViewer/openKbEditor`）、L4171 | `KnowledgeBaseList.vue`:126-155 消费 `action/kbId/positionId`；`PositionDetailTabs.vue`:603-613 与 `ExpertEditor.vue`:266 发送 `kbAction/fromPositionId` | **代码缺失**（参数名不对齐，深链不生效） |

---

## 二、差距清单（逐条，按页面分组）

### A. 页面容器 / 页签

#### A1. 知识库页 · 页面壳限宽居中
- 原型：`.page{max-width:1480px;margin:0 auto;min-width:1120px;padding:26px 34px 48px}`（L11/L23），内容区居中限宽。
- 代码：`layouts/AdminLayout.vue`:24-30 `.main{flex:1;padding:var(--space-6)}` 无 max-width，内容随窗口铺满。
- 要做：在 AdminLayout `.main` 或统一页容器加 `max-width:1480px;margin:0 auto`（全站共享，须与其它路一起定）。
- 量级：小
- 与 md 的关系：md 无定义

#### A2. 知识库页 · 页签形态
- 原型：`.kb2-tabs` 自绘下划线页签（高 58、gap 34、字号 15、active 绿色 2px 底线，L1840），下方直接接工具栏。
- 代码：`AdminKnowledgeBase.vue`:58-60 `el-tabs`（Element 默认下划线页签）。形态同类，仅令牌差异。
- 要做：无需改结构；如追求像素一致可给 `.kb-tabs` 调 `--el-tabs-header-height`/字号，随 A1 顺手做。
- 量级：小
- 与 md 的关系：一致（md §二.2）

### B. 知识库列表

#### B1. 知识库列表 · 分页条/计数恒显
- 原型：`renderKbList` L1900 表格下永远输出 `<div class="pager"><span>共 N 条</span></div>`（无翻页控件）。
- 代码：`KnowledgeBaseList.vue`:265 `ListPagination` 在 `total <= pageSize` 时整条不渲染（`ListPagination.vue`:26），种子数据下用户看不到总数。
- 要做：`ListPagination` 增加 `always-total` 类入参或知识库两个子页在表格下补「共 N 条」文案（共享组件改动影响全站，建议只在本模块补一行）。
- 量级：小
- 与 md 的关系：md 无定义（md §三.2 只说"列表支持分页"）

#### B2. 知识库列表 · 筛选生效时机
- 原型：L1944 `change` 只写 state，L1945 `query-kb` 点击才 `renderKbList()`——下拉改动不即时生效。
- 代码：`KnowledgeBaseList.vue`:178-183 两个 `el-select @change="search"` 即时查询，`查询` 按钮成为冗余。
- 要做：去掉 `@change="search"`（仅保留回车/查询按钮触发），或保留为代码超集——建议按 md「点击【查询】执行筛选」收敛。
- 量级：小
- 与 md 的关系：一致（md §三.1 点击【查询】执行筛选）

#### B3. 知识库列表 · 行内删除确认按钮样式档
- 原型：L2051 `confirmBox` 自建弹窗，确认文本为「删除」时按钮加 `primary is-danger`（红底，L2048），其余为绿 primary；无警告图标。
- 代码：`KnowledgeBaseList.vue`:100-104 `ElMessageBox.confirm(..., {type:'warning'})` 带黄色警告图标、确认按钮一律绿 primary。数据源删除 `KnowledgeSourceList.vue`:77-81、文档删除 `KnowledgeSourceDocsDrawer.vue`:100 同。
- 要做：四处删除类确认统一传 `confirmButtonClass: 'el-button--danger'`，并去掉 `type:'warning'` 图标（或保留图标作为代码取舍）。
- 量级：小
- 与 md 的关系：md 无定义（md §三.4.3 只定标题/正文/按钮文本）

#### B4. 知识库列表 · 名称列可点击
- 原型：L1900 `.kb2-name` 仅为 span，无点击行为。
- 代码：`KnowledgeBaseList.vue`:204 名称点击 → 审核中开查看、否则开编辑。
- 要做：不动（md §三.2「点击进入编辑或查看」，md 有定义）。
- 量级：—
- 与 md 的关系：一致（md 定义、原型未实现）

### C. 知识库抽屉（新建 / 编辑 / 查看）

#### C1. 知识库抽屉 · 分区卡片壳
- 原型：`openKbEditor` L1936 两个 `<section class="proto2-form-sec">`：细边框圆角卡（`border:1px solid #dfe5e1;border-radius:9px`），第一段带灰底标题条 `.proto2-form-title`（高 48、`background:#f7f9f8`、底边线）「基本信息」，正文 `.proto2-form-body{padding:18px}`；第二段**无标题条**，正文直接放 `sourceMultiSelect`，其内部 `.kb-ds-header`「数据源 + hint」作区块头（L1917）。
- 代码：`KnowledgeBaseEditor.vue`:383-438 两个 `.kb-sec` 纯文字标题（`.kb-sec-title` 14px 加粗，无边框、无灰底条，:485-490），段间 `margin-top: space-5`。
- 要做：`.kb-sec` 改为卡片壳（边框 + 圆角 + 内边距 18），「基本信息」加灰底标题条；第二段保持无标题条、用现有 `.kb-sec-title`「数据源 + 副注」作内部区块头。建议抽成共享 `FormSection` 或全局类，数据源抽屉（D 组）复用。
- 量级：小
- 与 md 的关系：md 无定义

#### C2. 知识库抽屉 · 基本信息 2 列网格 + 顶置标签
- 原型：L1936 `.proto2-form-grid{grid-template-columns:1fr 1fr;gap:17px 20px}`：第 1 行 [知识库名称 | 类型]，第 2 行 [可见范围 | （空）]，第 3 行 描述 `.full` 跨两列；标签 `.proto2-label` 在控件**上方**、必填星号前置；hint `.proto2-help` 在控件**下方**（类型：「创建后不可更改」；可见范围：按类型三选一文案）。
- 代码：`KnowledgeBaseEditor.vue`:381 `el-form label-width="112px" label-position="right"`，4 个字段单列纵排、标签左置右对齐；类型 hint 放在 radio **右侧同行**（:392 `.kb-hint` nowrap），可见范围 hint 在下方（:400）。
- 要做：`label-position="top"` + 用 `el-row/el-col :span=12` 或 CSS grid 两列排布（名称|类型、可见范围|空、描述跨列）；类型 hint 改为下方块级（复用 `.kb-hint--block`）。
- 量级：小
- 与 md 的关系：md 无定义

#### C3. 知识库抽屉 · 类型控件形态
- 原型：L1936 类型为 `<select class="select" id="kbEditType">`（下拉，编辑态 disabled）；可见范围也是 select（L1917 `kbScopeOptions`），企业类型时 disabled 且唯一选项「全员可见」。
- 代码：`KnowledgeBaseEditor.vue`:389-391 类型为 `el-radio-group`；可见范围企业类型时为 `el-input disabled model-value="全员"`（:396）。
- 要做：类型改 `el-select`（三选一，编辑态 disabled）；企业类型可见范围改 disabled `el-select` 单选项「全员」（保持与其它两类同控件）。
- 量级：小
- 与 md 的关系：md 无定义（md §三.3.1 只定枚举与锁定规则）

#### C4. 知识库抽屉 · 数据源引用行的标签宽与计数行
- 原型：L1917 `.kb-ds-row`：左标签 44px（「上传/API/MCP」右对齐）+ 自绘 chip 多选框（`.kb-ds-field` 点击展开 checkbox 菜单，chip 带 ×）+ 下方 `.kb-ds-count`「**N / 5**　类型说明」；section 头 `.kb-ds-header` = 加粗「数据源」+ 12px hint 同行 baseline。
- 代码：`KnowledgeBaseEditor.vue`:415-437 `el-form-item label=上传/API/MCP`（label 112px）+ `el-select multiple`（chip 形态等价）+ `.kb-ref-foot`「N / 5 · 说明」（:431-434）；另有 `.kb-ref-warn` 风险提示行（md §三.3.2，原型无）。
- 要做：该段 form-item 的 label-width 收窄到 ~44-60px（局部 `label-width` 覆盖）；计数 `N / 5` 加粗（原型 `<strong>`）。控件用 `el-select multiple` 即可，不必自绘下拉。
- 量级：小
- 与 md 的关系：一致

#### C5. 知识库抽屉 · 底部按钮样式档与排布
- 原型：L1936 foot：未发布编辑 = 左 `danger-link`「删除」（文字链，无边框）+ spacer + `plain`「取消」+ `primary`「保存」+ `primary`「提交发布」；审核中 = spacer + `plain`「关闭」+ `plain`「撤回」；已发布（L3226 删停用后）= spacer + 取消 + 保存。查看态：spacer + `plain`「关闭」+（审核中 `plain`「撤回」）。
- 代码：`KnowledgeBaseEditor.vue`:442-471：删除 = `type="danger" plain`（描边按钮，:460）；撤回 = `type="warning" plain`（:448/:456）；提交发布 = `type="success"`（:466，非 primary）；已发布编辑/查看态仍出「提交停用」（:450/:469，`warning plain`）。
- 要做：①删除改 `link type="danger"`；②撤回改默认 plain（无色描边）；③提交发布改 `type="primary"`；④删两处「提交停用」+ `doDelist`（改动记录第三节已列，md §三.4.1/4.2 已同步删）。
- 量级：小
- 与 md 的关系：①②③ md 无定义；④ 一致（md §三.4.1/4.2）

#### C6. 知识库抽屉 · 查看态「未发布」底部按钮
- 原型：`openKbViewer` L1936 foot 仅按「审核中→撤回」「已发布→提交停用（已被 L3226 移除）」追加，**未发布查看态只有「关闭」**。
- 代码：`KnowledgeBaseEditor.vue`:449 未发布查看态出「关闭 + 提交发布」。
- 要做：暂不动，交裁决。
- 量级：小
- 与 md 的关系：**与 md 冲突（md §三.4.2 写的是「未发布：关闭、提交发布」，原型无提交发布）**——须记入待裁决

#### C7. 知识库抽屉 · 撤回后是否关抽屉
- 原型：L1946 `withdraw-kb` 确认后 `kw.status='未发布'; closeMask(); toastMsg('已撤回'); renderKbList()`——抽屉关闭回列表。
- 代码：`KnowledgeBaseEditor.vue`:331-343 `doWithdraw` 成功后 `hydrate()` 留在抽屉（表单解锁转编辑态），不 `close()`。
- 要做：`doWithdraw` 成功后 `close()`（与 publish/delete/delist 一致）。
- 量级：小
- 与 md 的关系：md 无定义（md §三.4.3 只说"恢复提交前状态和可编辑能力"，两种都能解释）

#### C8. 知识库抽屉 · 标题右侧状态标签
- 原型：`drawerShell('编辑知识库', kTag(r.status))` L1936：h2 后紧跟 `.tag`（新建时无）。
- 代码：`KnowledgeBaseEditor.vue`:377-379 `#title-extra StatusTag`。一致。
- 要做：无。
- 量级：—
- 与 md 的关系：一致

### D. 数据源抽屉（公共区 / 上传 / API / MCP / 测试连接）

#### D1. 数据源抽屉 · 公共区骨架（标题、状态 tag、说明块）
- 原型：L1939 `drawerShell(isNew?'新建数据源':'配置数据源','',…)` / L1938「查看数据源」——**标题后无状态 tag**；正文 `proto2-form-sec` 卡「基本信息」（灰底标题条），行式 `.proto2-ref-group{grid-template-columns:90px 1fr}`：类型 radio + help「创建后不可更改」下方；名称；状态 radio + help「停用后引用它的知识库检索时跳过」下方；末尾 `.pd2-mini-note` **灰底圆角说明块**（按类型三句）。
- 代码：`KnowledgeSourceEditor.vue`:536-540 标题后出 `StatusTag`（原型无）；:545-566 `.ksrc-sec` 纯文字标题；类型/状态 hint 在控件右侧同行（:551/:561 `.ksrc-hint`）；类型说明为空标签 form-item 内的 12px 灰字（:563-565），非灰底块。
- 要做：①去掉 `#title-extra` 状态标签（或保留作代码超集——建议按原型去掉，启停状态已在正文 radio 体现）；②卡片壳同 C1；③hint 改控件下方块级；④类型说明改灰底圆角 note（复用 `.ksrc-note`）；⑤标题「编辑数据源」→「配置数据源」属文案，随 DrawerEditor `title` 入参一并处理。
- 量级：小
- 与 md 的关系：md 无定义（md §四.3 仅字段规则）

#### D2. 数据源抽屉 · 上传类分区
- 原型：L1937 `sourceFields('上传')`：卡「内置 RAG 配置」，4 个 `.proto2-ref-group`（文档类型 radio + help；文本预处理 = `.pd2-mini-note` + `.proto2-pre-list` 复选项各带 12px 灰注；Embedding 模型 select 全宽 + help；检索策略 = `.proto2-form-grid` 2 列 [select | Top-K 内联] + `.proto2-client-threshold` 绿底提示框）。
- 代码：`KnowledgeSourceEditor.vue`:569-611 同序 5 个 form-item；预处理提示为纯灰字（:580，原型灰底块）；Embedding select 半宽 + 右侧 hint（:591-594，原型全宽 + 下方 help）；阈值提示 `.ksrc-note` ✓。
- 要做：预处理首行改 `.ksrc-note` 灰底块；Embedding select 全宽、hint 下置。其余不动。
- 量级：小
- 与 md 的关系：一致

#### D3. 数据源抽屉 · API 类「请求配置」网格
- 原型：L1937 `.api-src-req-grid{grid-template-columns:160px minmax(0,1fr)}`：[请求方式 160px | 检索地址 `.api-src-full` 跨列（第 2 行）] → 超时时间（第 3 行左格）+ help 下方；标签顶置、星号前置；section 卡「请求配置」灰底标题条。
- 代码：`KnowledgeSourceEditor.vue`:615-631 左标签单列：请求方法半宽 select、请求地址全宽、超时 `el-input-number` + 右侧 hint（:626-629）。
- 要做：改为顶置标签 + 网格（请求方式 160px / 地址整行 / 超时 + 下方 help），卡片壳同 C1。
- 量级：小
- 与 md 的关系：md 无定义

#### D4. 数据源抽屉 · API 类「鉴权配置」区
- 原型：L1937 section 卡「鉴权配置」：`.connector-radio-row` 三选一（**默认选中 API KEY**）；API KEY = `.api-secret-grid` 2 列 [参数名 | 参数位置] + [参数值（密钥）跨列 + help「已配置的密钥以星号展示，留空表示保留」]——**单参数**；Bearer = 全宽 `.kmcp-token-row`（左灰底 `Authorization: Bearer` 前缀 + 密码框）。
- 代码：`KnowledgeSourceEditor.vue`:632-676：radio 默认 NONE（md §六.1 默认无鉴权）；API KEY 用 `ParamRowsEditor` 多行表（参数名/描述/客户端填写/位置/参数值/删）——md §六.1.1 多参数表；Bearer 用 `el-input` prepend「Authorization: Bearer」✓（:663-673）。
- 要做：多参数表按 md 保留，不照搬原型单参数网格（Q57 已记）；默认值按 md 无鉴权（Q56 已记）。仅补卡片壳 + 副注「凭证会静态附加到每次请求」已在 :635 ✓。
- 量级：小（仅壳）
- 与 md 的关系：**与 md 冲突（md §六.1.1 多参数表 vs 原型单参数网格；md §六.1 默认无鉴权 vs 原型默认 API KEY）**——已是 Q56/Q57 底账，按 md 执行

#### D5. 数据源抽屉 · API 类「请求参数映射」卡：表头列宽与「添加参数」位置
- 原型：L1937 `.kmcp-card`（白底细边框卡 + 标题「请求参数映射」+ 副注「下游 API 入参 ← 客户端字段映射」）；`.api-param-head/.api-param-row{grid-template-columns:110px 72px 64px 1fr 1fr 36px}` 表头灰底圆角（`background:#f5f7f6`）、行底细分隔线；固定行 query/top_k 的类型为纯文字、必填 checkbox `disabled` 带 title、默认值列「—」；行尾删除为 `.icon-btn` **×**；卡底 `.kmcp-note` 为 flex space-between：左说明文 + **右侧 `plain`「＋ 添加参数」**（L1937 尾部）。
- 代码：`SourceMapParamRows.vue`:117-123 列 `1.1fr 0.9fr auto 1.2fr 1fr auto`（无灰底表头、无行分隔线）；删除为 `link danger`「删除」文字（:87）；「＋ 添加参数」为**行区左下的 link**（:101-105）；说明文在卡底单独一行（`SourceMappingEditor.vue`:50-52）。
- 要做：①表头加灰底圆角条、行加底分隔线；②列宽改定宽（110/72/64/1fr/1fr/36）；③删除改 × icon 按钮；④「＋ 添加参数」移到 note 行右侧、改 `plain` 描边按钮（顶层）；⑤note 文案随原型 L1937 更新（改动记录第四节已列）。
- 量级：小
- 与 md 的关系：md 无定义（布局）；文案与 md §六.2 一致

#### D6. 数据源抽屉 · API 类「请求参数映射」递归子字段区形态
- 原型：L2009-2019 最终态：子字段区 `.api-subparam-section`（`margin-left:18px; border-left:3px solid #b8d9cb; background:#f5f9f7`，嵌套层逐级变浅 L2019）；层头 `.api-subparam-depth-label`「第 N 级子字段 <span>object / array 可继续嵌套</span>」；子表头 4 列 `.api-subparam-head{grid:1fr 100px 1fr 36px}`（子字段名/类型/默认值/删）；每层底部 `plain` 小号「＋ 添加下一级子字段」（12px, margin 6px 0 2px）；展开中的 object/array select 加绿色描边 `.api-subparam-type[aria-expanded="true"]`；子行前 7px 连接线 `:before`；新建/编辑/查看 API 源默认注入 `filters(object)→rules(array)→field/value` + `enabled(boolean)` 示例组（L2016/L2018）。
- 代码：`SourceMapParamRows.vue`:90-99 `.smp-sub` 缩进 18 + 左 3px 线 + 浅底（:150-156）✓；但子层仍复用 6 列表头（名/类型/必填/客户端字段/默认值/删，:48-55）、无层级标签行、无「第 N 级」提示、按钮文案「＋ 添加子字段」link（:103）、无展开态强调色与连接线、无默认示例组（`knowledgeBaseMeta.js:128-133 mkRequestMapRows` 仅 query/topK）。
- 要做：（与改动记录第四节「需补 5 点」同）子层收敛 4 列；加 `depth-label` 行；按钮改「＋ 添加下一级子字段」plain 小号；展开态 select 强调色 + 子行连接线 + 逐级背景；新建默认示例组（含 `enabled` 与否待确认 4）；注入时机按 md「新建时」（Q 已记原型无条件注入）。
- 量级：中
- 与 md 的关系：一致（md §六.2 七条）

#### D7. 数据源抽屉 · API 类「响应字段映射」卡
- 原型：L1937 `.kmcp-card` + `.api-resp-head/.api-resp-row{grid:1fr 1fr 110px 36px}` 灰底表头；三条预设行的**参数名为可编辑 input、且均带 × 删除**；卡底 note 行右侧 `plain`「＋ 添加字段」。
- 代码：`SourceMappingEditor.vue`:57-84：预设行参数名为 `<code>` 固定、无删除（md §六.3 预设不可删）；表头无灰底（:113-124）；「＋ 添加字段」为 note 行右侧 **link**（:81）✓ 位置一致，样式档为 link 非 plain。
- 要做：表头灰底 + 行分隔线 + 定宽列；按钮改 `plain`；预设行按 md 保持不可删/名称固定（不照搬原型）。
- 量级：小
- 与 md 的关系：预设行可删 = **与 md 冲突（md §六.3 预设字段不可删除）**，按 md；其余 md 无定义

#### D8. 数据源抽屉 · MCP 类「MCP 检索」外壳与传输方式控件
- 原型：`kmcpMarkup` L1985 返回 `<section class=”proto2-form-sec kmcp-root”><div class=”proto2-form-title”>MCP 检索</div><div class=”proto2-form-body”>…`（弯引号 → 实际渲染**无卡片壳、无标题条样式**，`.kmcp-root .proto2-form-body{display:grid;gap:14px}` L2006 也失效）；内部卡「连接与鉴权」副注「复用连接器 MCP 的连接配置」（Q373 残留）；传输方式为 **`select`**（L1981 `kmcpOptions(['streamable-http','stdio'])`）；Endpoint 全宽；鉴权方式 `select`；Bearer = `.kmcp-token-row` 前缀行；API Key = 2 列 [Header 名称 | API Key]；stdio = Command select 全宽、args textarea 全宽、Env 区（`.kmcp-inline-title` 标题右侧 link「＋ 添加变量」+ 5 列 `1fr 1.3fr 110px 1fr 46px` 表）；超时 `.kmcp-grid` 单独一格 + help。
- 代码：`KnowledgeSourceEditor.vue`:694-788：外层 `.ksrc-sec` 文字标题「MCP 检索」+ `.ksrc-card` 卡 ✓；传输方式为 **radio**（:702-704）；鉴权 `el-select` 半宽 ✓；API Key 两字段各半宽纵排（:729-752，原型同行 2 列）；stdio Env 用 `ParamRowsEditor`（列结构与原型 5 列同构）+ 上方 `.ksrc-sub` 小标题（:764-767，原型标题行右侧放「＋ 添加变量」，代码由 ParamRowsEditor 底部出）。
- 要做：①传输方式改 `el-select`；②Header 名 / 访问凭证同行 2 列；③「＋ 添加变量」上移到 Env 小标题右侧（ParamRowsEditor 若不支持，可留作样式档差异）；④外壳按 C1 卡片化（原型意图，弯引号缺陷不照搬——改动记录第六节）。
- 量级：小
- 与 md 的关系：md 无定义（md §七.2 只定字段）

#### D9. 数据源抽屉 · MCP 类「检索工具」控件形态与「拉取工具」
- 原型：L1984 `.kmcp-tool-select{grid:1fr auto}`：左侧自绘**下拉框**（摘要「N 个工具已选」+ ▾，点击展开 checkbox 列表 `.kmcp-tool-list` max-height 200 滚动，L2002 `toggle-tools`）；右侧 `plain`「拉取工具」（点击 → 「拉取中…」→ 0.5s 后 toast「已拉取 3 个工具」，L2002 `fetch-tools`）；下方 help「3 个可用工具 · 最近已同步」。
- 代码：`KnowledgeSourceEditor.vue`:791-804：`el-checkbox-group` **平铺复选框**；无「拉取工具」按钮，工具清单由「测试连接」成功返回（:327-331）；未测试前显示 note「请先完成连接测试以获取工具列表」。
- 要做：①控件改为下拉多选（`el-select multiple collapse-tags` 或自绘摘要 + 展开列表）；②是否加「拉取工具」按钮：原型有、md §七.3 说「直接填写时需先完成连接测试以获取工具列表」——建议保留代码口径（测试连接取清单），不加拉取按钮，记差异；③help 行「N 个可用工具 · 最近已同步」补齐。
- 量级：小
- 与 md 的关系：①③ md 无定义（md §七.3 只说"多选复选框形式"——平铺复选框反而更贴 md 字面，下拉化需拍板）；② **与 md 冲突（md §七.3 测试连接取清单 vs 原型独立「拉取工具」）**

#### D10. 数据源抽屉 · MCP 类映射两卡
- 原型：`kmcpMarkup` L1985 最终态**不再拼接**请求/响应映射卡（0904 有、0907 删）；note 改「保存前可使用下方"测试连接"验证连接与工具调用」。
- 代码：`KnowledgeSourceEditor.vue`:806-817 仍渲染 `<SourceMappingEditor protocol="MCP">` 两卡 + note「…及字段映射」。
- 要做：与改动记录第五节一致，待负责人裁决（待确认 3）；不在此重复论证。
- 量级：小（回退）
- 与 md 的关系：一致（0907 md §七 已删两节）

#### D11. 数据源抽屉 · 「测试连接」位置与交互
- 原型：L1939 `#sourceDynamicFields` 之后、抽屉正文**最底部裸放** `plain`「测试连接」+ 同行 `.hint`「修改连接配置后需要重新测试」（不在任何卡内）；L1946 点击 → 按钮 disabled 文案「测试中」→ 700ms 后恢复、文案变「**重新测试**」，hint 变「连接正常 · 168 ms」绿色 + toast「连接测试成功」；上传类隐藏（L1947）。
- 代码：`KnowledgeSourceEditor.vue`:822-828：独立 `.ksrc-sec` 内 `el-button size="small"` + 结果行 `● 连接正常 · … ms · 相对时间`；按钮文案恒「测试连接」，loading 态由 `:loading` 承担；失败态红字（md §八.1 三态）。
- 要做：①按钮改常规尺寸（去 `size="small"`）；②成功后按钮文案改「重新测试」；③保留代码的失败态与相对时间（md 超集）。
- 量级：小
- 与 md 的关系：一致（md §四.3「修改连接配置后需要重新测试」提示；按钮文案 md 无定义）

### E. 数据源列表

#### E1. 数据源列表 · 删除置灰提示形态
- 原型：L1905-1908 `.kb2-delete-guard` 包裹 disabled `danger-link`，hover/focus 时 CSS `:after` 显示深底 tip「目前被 N 个知识库引用，暂不可删除」（L3812-3816），可键盘 focus（tabindex=0）。
- 代码：`KnowledgeSourceList.vue`:182-192 `el-tooltip` 包 disabled `link danger`，文案 md「正被知识库引用，请先解除引用」。形态等价。
- 要做：无（文案取 md，Q 已记）。
- 量级：—
- 与 md 的关系：一致

#### E2. 数据源列表 · 状态筛选与 pager
- 原型：L3247 `enhanceSourceStatus` 在类型 select 后插入 `#source2Status`（DOM 过滤、pager 同步「共 N 条」）。
- 代码：`KnowledgeSourceList.vue`:118-121 状态 select 位置一致；pager 同 B1 问题。
- 要做：随 B1。
- 量级：—（并入 B1）
- 与 md 的关系：一致（md §四.1）

### F. 文档管理抽屉

#### F1. 文档管理抽屉 · 上传区形态
- 原型：`openDocs` L1940 `.kb2-doc-upload{padding:18px;border:1px dashed #cfd9d4;border-radius:8px;background:#fafcfb;text-align:center}`：虚线框内**居中** `primary`「＋ 选择文件上传」+ 下方 help「支持 PDF、DOCX、DOC、MD、TXT、HTML，单文件最大 50MB」；表格 `margin-top:18px`。
- 代码：`KnowledgeSourceDocsDrawer.vue`:139-146 `.kdoc-toolbar` **左对齐一行**：按钮 + 右侧 hint（无虚线框）。
- 要做：上传区改虚线框居中布局（按钮上、说明下）；hint 文案随文档类型动态（代码超集，保留）。
- 量级：小
- 与 md 的关系：md 无定义

#### F2. 文档管理抽屉 · 表格列与失败原因位置
- 原型：L1940 5 列「文件名/大小/切片/解析状态/操作」，解析失败时**失败原因作为状态格内第二行** `.kb2-doc-fail-reason`（红字 12px，title 悬浮全文）；状态带圆点 `.kb2-doc-status:before`。
- 代码：`KnowledgeSourceDocsDrawer.vue`:148-176 6 列，失败原因独立列（:165-170）；圆点 ✓（:161）。
- 要做：可选——失败原因并入状态格下行以贴原型；md §五.3 列表明「失败原因」为独立展示项，两种均合规。建议不动。
- 量级：小
- 与 md 的关系：一致（md §五.3 列出失败原因，未定位置）

#### F3. 文档管理抽屉 · 标题与顶部汇总
- 原型：L2058 `decorate()` 把标题 tag 合并为「文档管理 · 名称」，无汇总计数。
- 代码：:126 标题 `文档管理 · ${name}` ✓；:135 `#title-extra` 补「共 N 篇 · 解析成功 N 篇」（md §五.3 要求）。
- 要做：无。
- 量级：—
- 与 md 的关系：一致（汇总为 md 定义、原型无）

### G. 检索测试弹窗

#### G1. 检索测试弹窗 · 尺寸与标题
- 原型：`openSearch` L1941 `.proto2-dialog{width:min(680px,calc(100vw - 36px));max-height:82vh}` 居中；头部 h3 经 L2058 合并为「检索测试 · 名称」+ ×；底部右对齐 `plain`「关闭」+ `primary`「开始测试」。
- 代码：`KnowledgeSearchDialog.vue`:97-103 `el-dialog width="720px"`；:105-110 标题「检索测试」+ `el-tag` 名称（改动记录第三节已列改单文本）；footer ✓。
- 要做：宽度改 680px；标题合并（第三节）。
- 量级：小
- 与 md 的关系：一致（md §三.7 标题「检索测试 · [知识库名]」）

#### G2. 检索测试弹窗 · 表单网格
- 原型：L1941 `.proto2-form-grid` 2 列：检索问题 `.full` 整行；第 2 行 [Top K | 数据源范围]；标签顶置 `.proto2-label`。
- 代码：:116-135 flex-wrap：`.ks-field--full` 整行 + 两个 `flex:1` 字段；标签顶置 ✓。形态等价。
- 要做：无。
- 量级：—
- 与 md 的关系：一致

#### G3. 检索测试弹窗 · 结果统计条
- 原型：L1946 `run-search` 输出 `.kb2-search-stats{display:flex;gap:18px;padding:11px 13px;margin:14px 0;border-radius:7px;background:#f3f7f5}` **灰底圆角条**，三段独立 span：「召回 3 条」「耗时 286 ms」「上传 2 条 · API 1 条」。
- 代码：:140-143 `.ks-meta` 单行灰字「召回 N 条 · 耗时 N ms · 统计」+ 右侧 `<hr>` 延伸线（:214-226）。
- 要做：改为灰底圆角条、三段 span 分隔（gap 18），去 hr。
- 量级：小
- 与 md 的关系：一致（md §三.7 展示总数、耗时、各数据源召回统计）

#### G4. 检索测试弹窗 · 结果卡片头
- 原型：`.kb2-result` 卡（边框 `#dfe5e1`、圆角 8、padding 13 14）；`.kb2-result-head` = `<strong>#1 产品与解决方案手册</strong>`（**排名 + 文档标题加粗**）+ `.kb2-score` 绿色加粗 0.92 + `.kb2-result-source` 灰 12px「产品资料文档库 · 第 18 页」；正文 `<p>` 全文无折叠。
- 代码：:146-157 head = `#1` 等宽加粗 + score 等宽强调色 + `el-tag` 数据源类型 + `sourceLine`「数据源名 / 文档 · 第 N 页」；正文 3 行截断 + 「展开查看」（md §三.7 长内容默认收起）。
- 要做：head 第一段改为「#N + 来源文档名」加粗（`it.source`），来源行保留「数据源名 · 第 N 页」；类型 tag 保留（md 要求展示数据源类型）；折叠保留（md）。
- 量级：小
- 与 md 的关系：一致（md §三.7 排名/分数/类型/来源/页码/内容）

#### G5. 检索测试弹窗 · 加载态
- 原型：无加载态，点击即同步渲染结果。
- 代码：:137 `el-skeleton` 5 行。代码超集（关键交互需 loading，编码规范）。
- 要做：不动。
- 量级：—
- 与 md 的关系：md 无定义

### H. 专家侧知识库卡 / 跨模块深链

#### H1. 专家抽屉「知识库」卡 · 检索测试打开方式
- 原型：L4171-4173：`view` → `closeDrawer()` + 切知识库模块 + `openKbViewer(kb)`（跳转）；`test` → **`window.kbProto.openSearch(kb)` 原地弹窗，专家抽屉不关**。
- 代码：`ExpertEditor.vue`:264-267 `jumpKnowledge` 两个动作**都**关抽屉 + `router.push` 跳知识库页。
- 要做：`检索测试` 改为在专家抽屉内挂载 `KnowledgeSearchDialog`（`append-to-body`）原地打开；`查看` 维持跳转。
- 量级：小
- 与 md 的关系：md 无定义（专家 md 未定义该卡，知识库 md §三.8 只定义岗位入口）

#### H2. 跨模块深链 · 岗位/专家 → 知识库 query 参数名不对齐（深链不生效）
- 原型：L1877 `view-pos-kb/edit-pos-kb`：置 `state.module='knowledge'` + `render()` 后**直接调用** `openKbViewer/openKbEditor(jumpRow)` 打开抽屉；L4171 专家同款。
- 代码：消费端 `KnowledgeBaseList.vue`:126-155 读 `q.action` / `q.kbId` / `q.positionId` / `q.positionName`；发送端 `PositionDetailTabs.vue`:603-613 发 `kbAction` / `fromPositionId` / `fromPositionName`，`ExpertEditor.vue`:266 发 `kbAction`——**键名不一致**，跳转后只切到 tab，抽屉/弹窗不打开、岗位上下文也不生效。
- 要做：统一为一套键名（建议改发送端为 `action`/`positionId`/`positionName` 与消费端对齐，或消费端同时兼容两套）；补 `search` 深链已在消费端实现（:144-151）。
- 量级：小
- 与 md 的关系：一致（md §三.8 查看/编辑/检索测试三条跳转 + 筛选自动切换）——当前是代码缺陷

#### H3. 专家抽屉「知识库」卡 · 骨架
- 原型：L4150：`section.section-card.expert-knowledge-section` 插在技能区后；h3「知识库 + 副注」；`.expert-kb-search` 输入框左侧 ⌕ 图标（L4116-4118）；`.expert-kb-table-wrap` 圆角边框表 5 列（34%/22%/10%/12%/22%）12px 字号；空态「未找到匹配的知识库」；`.expert-kb-more` 居中 `plain` 按钮 min-width 112。
- 代码：`ExpertEditor.vue`:738-780 结构逐项对应（搜索框未带 ⌕ 前缀图标）。
- 要做：搜索框补 `#prefix Search` 图标；其余不动。
- 量级：小
- 与 md 的关系：md 无定义

---

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件:行 | 说明 |
|---|---|---|
| 知识库列表：名称可点进编辑/查看 | `KnowledgeBaseList.vue`:204 | md §三.2 定义 |
| 知识库列表：行内动作在途禁用（`rowBusy`）、加载/失败/重试三态 | `KnowledgeBaseList.vue`:71, 193-199 | md §八.2 |
| 知识库列表：Tab 状态走 `?tab=` + keep-alive 保留筛选 | `AdminKnowledgeBase.vue`:26-45, 63-65 | md §二.2 |
| 知识库抽屉：数据源引用风险提示行、发布完整校验 tooltip、已发布关键变更二次确认、保存失败不关抽屉 | `KnowledgeBaseEditor.vue`:126-141, 218-239, 264-275, 464-468 | md §三.3.2/§三.5/§三.6/§八.2（原型 Q 已记"原型无"） |
| 知识库抽屉：岗位上下文锁（`positionLock`） | `KnowledgeBaseEditor.vue`:105-110, 155-164 | md §三.8；原型 `openKbEditorForPosition` L1948 在最终态被 L4021 移除入口 |
| 数据源抽屉：加载骨架/失败重试、字段级标红 `fieldErrors`、敏感值掩码「留空保留」、验证状态三态与相对时间 | `KnowledgeSourceEditor.vue`:117-153, 344-352, 428-467, 674/727/750 | md §四.3/§八 |
| 数据源抽屉：API KEY 多参数表 / stdio 环境变量表（`ParamRowsEditor`） | `KnowledgeSourceEditor.vue`:646-659, 768-779 | md §六.1.1/§七.2.2 |
| 数据源抽屉：预处理项按文档类型动态显示、更换向量模型二次确认 | `KnowledgeSourceEditor.vue`:148, 475-489 | md §五.1 |
| 文档管理抽屉：多选上传、前置格式/大小拦截、3 秒轮询、顶部汇总、失败原因列 | `KnowledgeSourceDocsDrawer.vue`:51-58, 72-83, 135, 165-170 | md §五.2/§五.3 |
| 检索测试：可选具体数据源（停用不可选）、加载骨架、单源失败卡、长内容折叠、无可用数据源空态 | `KnowledgeSearchDialog.vue`:36-42, 113, 137, 153-164 | md §三.7 |
| 专家抽屉知识库卡：按专家可见范围过滤真实数据 | `ExpertEditor.vue`:224-239 | 原型用静态 `knowledgeCatalog` |

---

## 四、原型侧缺陷（合并时不应照搬）

| # | 位置 | 缺陷 | 合并处理 |
|---|---|---|---|
| P1 | L1985 `kmcpMarkup` 返回值 | 4 个 `class=”…”` 弯引号：`.kmcp-root` 壳与标题条样式失效，`input/change` 写回（L2000-2001 `closest('.kmcp-root')`）全部失效 → 切传输方式/鉴权不重渲、保存校验读默认 config | 不搬；按原型**意图**（卡片壳 + 可切换）实现，已记改动记录第六节 |
| P2 | L1945 `delete-kb-list` | 列表行内「删除」无确认直接 `splice` + toast | 不搬；按 md §三.4.3 出确认弹窗（代码已如此） |
| P3 | L2054 抽屉内删除确认文案 | 「删除知识库"X"？数据源本身不受影响。此操作不可恢复。」与 md §三.4.3「删除后配置无法恢复，确认删除？」不同；L1945 列表侧无确认 | 按 md（代码 `KB_ACTION_CONFIRMS.remove` 已按 md） |
| P4 | L1936 `openKbViewer` 未发布态 | 只有「关闭」，缺 md §三.4.2「提交发布」 | 待裁决（C6） |
| P5 | L1937 API 鉴权默认 `API_KEY checked`、单参数网格；响应映射预设行可删/可改名 | 与 md §六.1/§六.1.1/§六.3 冲突 | 按 md（Q56/Q57 底账） |
| P6 | L1946 `save-kb` 对已发布行直接覆盖 sourceIds/scope，不确认不改状态 | md §三.5 要求二次确认并回未发布 | 按 md（代码已实现；审查结果已记） |
| P7 | L1946 `save-source` 只写名称，API/MCP 表单值不落库；`run-search` 结果为写死 HTML | 占位实现 | 不搬；走 mock 层 |
| P8 | L1948 `openKbEditorForPosition`、L1877 `new-pos-kb/edit-pos-kb` | 最终层 L4021 移除了岗位知识页签的新建/编辑按钮 → 两函数为死代码；L3610 `jumpToKnowledge` 依赖 `[data-jump-kb]`，全文件无该元素渲染 → 死代码 | 不搬；岗位入口按 md §三.8 保留代码实现（岗位路负责页签本身） |
| P9 | L1984 「拉取工具」按钮恒定成功、`directMcpTools` 写死；L1981 副注「复用连接器 MCP 的连接配置」（引用模式已删的残留，Q373） | 占位 / 残留 | 不搬；工具清单按 md §七.3 由测试连接返回；副注按代码现文案 |
| P10 | L2018 `sourceFields` 对 API **无条件**注入示例组（编辑/查看态也注入且未 disabled） | md §六.2 限"新建时" | 按 md（审查结果已记） |
| P11 | L1962-1963/L1996-1997 `kmcpDefaultConfig` 仍初始化 requestMap/responseMap、写回分支残留 | 0907 删映射后的死数据 | 不搬（改动记录第五节已列） |
| P12 | L1905-1908 删除置灰 tip「目前被 N 个知识库引用，暂不可删除」 | 与 md §四.2「正被知识库引用，请先解除引用」不同 | 按 md（代码已按 md） |

---

## 五、量级汇总

- **小**：A1、A2、B1、B2、B3、C1、C2、C3、C4、C5、C6（待裁决）、C7、D1、D2、D3、D4（仅壳）、D5、D7、D8、D9、D10（回退，待裁决）、D11、F1、F2（可不做）、G1、G3、G4、H1、H2、H3 —— 29 条
- **中**：D6（API 递归子字段区形态 + 默认示例组 + 校验补齐） —— 1 条
- **大**：0 条
- **合计粗估**：约 3.5–4.5 人天（小项多为样式档/排布，可批量；D6 约 1 天；H2 深链对齐含岗位/专家发送端联调约 0.5 天）。
- **必须串行 / 共享组件**：
  1. **抽屉分区卡片壳**（C1 → D1/D2/D3/D8 复用）：先定一个共享 `FormSection`（或全局类）再铺到两个抽屉，否则重复造壳。
  2. **`ListPagination` 恒显计数**（B1/E2）：共享组件改动影响全站列表，需与其它路对齐后再改；否则只在知识库两子页局部补。
  3. **确认弹窗删除态红按钮**（B3）：若走 `ElMessageBox` 全局默认，须与其它路统一；局部传 `confirmButtonClass` 可独立做。
  4. **页面壳限宽居中**（A1）：`AdminLayout.vue` 全站共享，须统一拍板。
  5. **深链键名**（H2）：涉及岗位路（`PositionDetailTabs.vue`）与专家路（`ExpertEditor.vue`）发送端，三方约定同一套 query 键后同时改。
  6. **D10 / C6 / D9②**：待负责人裁决后再动。
  7. D5/D6/D7 同在 `SourceMapParamRows.vue`/`SourceMappingEditor.vue`，建议一次改完（D10 若回退 MCP 映射，先回退再做 D5-D7 以免改两遍）。

---

## 六、覆盖说明

**原型侧核对**：CSS 基础层 L11-L25（`.page/.search/.table/.tag/.ops/.empty/.plain/.link` 等）、L727（`.connector-radio-row/.api-secret-grid`）、L1840（`kb2-*`、`proto2-*` 全套）、L2022（`.kb2-toolbar` 覆写）、L2048（`.primary.is-danger`）、L3812-3820（删除守卫 tip、表格对齐修补）、L4113-4132（专家卡样式）；脚本 L1890-1949（`renderKnowledge/renderKbList/renderSourceList/drawerShell/sourceMultiSelect/kbScopeOptions/openKbViewer/openKbEditor/sourceFields 基定义/apiSrc* 助手/openSourceViewer/openSourceEditor/openDocs/openSearch/render 覆写/nav/input·change·click 三个 view 监听/mask click·change 监听/updateKbSourceSelect/openKbEditorForPosition/window.kbProto`）、L1951-2006（MCP 层：`kmcpDefaultConfig/kmcpDirectConnection/kmcpMarkup/sourceFields·openSourceEditor·openSourceViewer 覆写/kmcpRender/kmcpSaveField/kmcp 事件/kmcpMissing/save-source capture/样式`）、L2009-2019（API 递归层最终 `sourceFields`）、L2049-2060（`kb2ConfirmMask/confirmBox/stop-kb·delete-kb 拦截/文档删除拦截/decorate/observer`）、L3220-3300（`removeKnowledgeStopButtons/applySourceStatusFilter/enhanceSourceStatus/enhanceApiAuth 归属判定/observer`）、L3610 `jumpToKnowledge` + L3703-3708 调用点、L4021 岗位知识页签按钮移除、L4133-4178 专家卡模块、L1877 岗位详情 `*-pos-kb` 分支。

**代码侧核对**：`views/admin/AdminKnowledgeBase.vue`、`KnowledgeBaseList.vue`、`KnowledgeSourceList.vue`；`components/admin/KnowledgeBaseEditor.vue`、`KnowledgeSourceEditor.vue`、`SourceMappingEditor.vue`、`SourceMapParamRows.vue`、`KnowledgeSearchDialog.vue`、`KnowledgeSourceDocsDrawer.vue`、`DrawerEditor.vue`、`ListToolbar.vue`、`ListPagination.vue`、`ListStates.vue`（头注）；`ExpertEditor.vue`:212-267, 734-780；`views/admin/PositionDetailTabs.vue`:598-613, 1066-1115（仅深链发送端）；`layouts/AdminLayout.vue`；`assets/list-page.css`、`assets/theme.css`（`.table-wrap`）、`utils/tableLayout.js`、`utils/knowledgeBaseMeta.js`（常量与确认文案）、`api/knowledgeBaseMock.js`:327-355（检索结果结构）、`components/PageHeader.vue`（样式）、`router/index.js`:245-247。

**未覆盖**：`ParamRowsEditor.vue` 内部列骨架未逐列比对（与原型 `.kmcp-env-*`/`api-auth-grid` 同构，属连接器路共享组件）；岗位详情「知识」页签自身布局（L4021 最终态、`PositionDetailTabs.vue`:1066-1115）归岗位路；`knowledgeBaseMock.js` 其余数据种子与持久化逻辑（不涉布局）；`__tests__/` 断言未逐条核对（改动后需同步的测试：`adminKnowledgeBase.test.js`、`knowledgeSourceList.test.js`、`sourceMappingEditor.test.js`、`expertEditor.test.js`、`positionDetailTabs.test.js`）。
