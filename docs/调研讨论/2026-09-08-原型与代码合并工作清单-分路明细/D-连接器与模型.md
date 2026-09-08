# 原型 → 代码合并差距分析 · D 路：连接器（MCP / API / 业务系统）与模型

- 原型：`docs/prd/PRD-20260907/数字员工管理端交互原型.html`（4561 行，下文「L」均指该文件行号）
- 代码：`frontend/src/views/admin/AdminConnector.vue`、`AdminMcp.vue`、`AdminApis.vue`、`AdminBizSystems.vue`、`AdminModels.vue`；`frontend/src/components/admin/DrawerEditor.vue`、`McpEditor.vue`、`ApiEditor.vue`、`BizSystemEditor.vue`、`ProviderSystemEditor.vue`、`ModelConfigEditDialog.vue`、`ParamRowsEditor.vue`、`SchemaFieldEditor.vue`；`frontend/src/components/position/IconPickerPopover.vue`；mock `frontend/src/api/mcpConnectorMock.js`、`apiConnectorMock.js`、`bizSystemMock.js`、`adminModelMock.js`
- 只比布局与交互；字段/文案级差异已在《PRD与原型一致性审查结果-20260907.md》登记（下文引用 Q 编号），本文不重复。

## 原型覆写层判定（先说清楚哪一层生效）

| 区域 | 底层定义 | 后续覆写 / 注入（按加载顺序） | 最终生效 |
|---|---|---|---|
| 连接器壳 | HTML `#moduleTabs` L137（`.tab`×3：MCP / API / 业务系统）；`render()` L239 按 `state.module!=='mcp'` 加 `module-hidden`；tab 点击 L187 | `renderMcp` 被 L755 包一层，按 `state.tab` 分发到 `originalRenderMcp` / `renderApis` / `renderBiz` | L137 + L239 + L755 |
| MCP 列表 | `renderMcp` L171、`actionButtons` L170、`health` L169、行点击 L189、`mcp-query` L720 | 无再覆写（L755 只做分发） | L171 |
| MCP 抽屉 | `openDrawer` L174、`connFields` L180、`envRowsHtml` L178、`authFields` L175、`toolHtml` L173、`validateMcpEditor` L196、保存 L197、导入/测试/拉取 L194 | ① L1072 追加「示例问题」section（`data-field="exampleQuestions"`）；② L1137-1148 MutationObserver 把 `.connector-example-section` 移入首张 `.section-card`（基本信息）作 `.connector-basic-subsection`；③ L1331 `decorateEditor` 把 `.icon-row` 内按钮改成【从图标库选择】+ 新增【上传图标】；④ L1415 `applyPrdFieldRules`；⑤ L1419 capture 阶段保存校验；⑥ L2206 `code-alignment-override`：时间行移顶、元信息 4 项、command 改下拉、工具标题显示名、**L2239 查 `[data-connector-field]` 对 MCP 段无效**；⑦ L3837 `authFields` Bearer 前缀框 | L174 + ①②③⑥⑦ |
| API 列表 | `renderApis` L752 | **L772-783 整体重写**（列改为 API/请求方式/性质/引用情况/最近更新时间↕/验证/操作，去分页）；L865 加列表图标；`apiActions` L751、`apiHealth` L750、`apiReferenceCell` L771；点击 L766、L795-803；服务提供系统弹窗 `openProviderDialog` L756 + L1419 校验 | L772 + L865 |
| API 抽屉 | `renderApiEditor` L757 | L785（删状态 radio、时间行三项）→ L844（追加示例问题）→ L879（名称后注入图标）→ L904（`injectApiSchemas` + `normalizeRefs`）→ **L2159 `code-alignment-override`**（删顶部提示、时间行移顶、删 API id、删健康检查路径、URL 改半栏、加 Bearer radio、**删图标 L2181、删示例问题 L2182**、引用副注改文案、调 `applyApiAuthMaster`）→ L3656-3681 `rebuildAuthMaster` 生成独立「鉴权配置」卡并删除原鉴权卡 → L3926-3950 `buildApiSchemaCards` 替换 `injectApiSchemas`（L3951），请求参数/响应字段各一张卡 → L3852-3867、L3952-3974 固定卡片顺序：请求配置 → 鉴权配置 → 请求参数 → 响应字段 | L757 + L785 + L2159 + L3656 + L3926 + L3952 |
| 业务系统列表 | `renderBiz` L754 | **L813-818 整体重写**（5 列：业务系统/登录地址/引用情况/最近更新时间↕/操作，去分页）；L867 加列表图标；`bizActions` L807-812；点击 L766、L830-838 | L813 + L867 |
| 业务系统抽屉 | `renderBizEditor` L760、`openBizEditor` L761、`saveBiz` L762、业务页事件 L767 | L820（删状态 radio、时间行三项）→ L846（追加示例问题）→ L881（名称后注入图标）→ L905（`normalizeRefs`）→ L1148 移示例问题入基本信息卡 → L1419 保存校验（含「至少 1 个业务页」）。无 `code-alignment-override` | L760 + L820 + L846 + L881 + L1148 |
| 模型列表 | `renderModels` L213、`modelActions` L212、`verifyHtml` L211、点击 L260、`pagerHtml` L1549（`window.pagerHtml` L1551） | L1345 `decorateList` 把 `.model-logo` 替换为图标（若有） | L213 |
| 模型抽屉 | `openModelDrawer` L245、`modelAuthHtml` L244、`validateModel` L246、`doModelTest` L247、`saveModel` L249、事件 L262-265 | L1319-1330 `addMissingIconField`（模型名称后注入「图标*」字段）；L1415 默认图标 `▦`；L1419 保存校验 toast | L245 + L1319 |
| 抽屉/表格壳 CSS | `.drawer` L14 → L42（`width:min(780px,88vw)`，`background:#f5f7f6`）；`.section-card` L16 → L47；`.reference-section` L16/L69；`.page-time` L16/L70；`.model-drawer .drawer` L110（820px）；`.table-wrap` L37（白卡圆角描边）；`.page` L23（`max-width:1480px;margin:0 auto`）；`.readonly .editable` L14 | — | 各最后一条 |

---

## 一、模块概览表

| 页面/区域 | 原型最终生效层（函数名 + 行号） | 代码文件 | 骨架一致度 |
|---|---|---|---|
| 连接器壳（页头 + 三页签） | `#moduleTabs` L137、`render` L239、`renderMcp` 分发 L755 | `views/admin/AdminConnector.vue`（el-tabs + `?tab=` query，keep-alive） | 一致（页签形态 el-tabs vs 原型 `.tab` 下划线，视觉同类） |
| MCP 列表 | `renderMcp` L171、`actionButtons` L170、`health` L169、行点击 L189、`mcp-query` L720 | `views/admin/AdminMcp.vue` | 局部差异（缺【查询】、引用弹窗、分页形态） |
| MCP 登记/编辑/查看抽屉 | `openDrawer` L174 + L1072 + L1148 + L1331 + L2206 + L3837；`connFields` L180；`envRowsHtml` L178；`toolHtml` L173 | `components/admin/McpEditor.vue` + `ParamRowsEditor.vue` + `IconPickerPopover.vue` | 局部差异（示例问题位置、Env 表形态、图标行、卡片化） |
| MCP 发布/撤回/停用/删除/引用 弹窗 | L189 `modal(...)` 五处 | `AdminMcp.vue` L303-388（ElMessageBox） | 一致 |
| API 列表（分组 + 表格） | `renderApis` L772-783 + L865；`apiActions` L751；`apiHealth` L750；点击 L766/L795 | `views/admin/AdminApis.vue` | 一致（仅验证列时间格式、引用弹窗标题微差） |
| 服务提供系统弹窗 | `openProviderDialog` L756 + L1419 校验 | `components/admin/ProviderSystemEditor.vue`（el-dialog 440px） | 一致 |
| API 新建/编辑/查看抽屉 | `renderApiEditor` L757 + L785 + L2159 + `rebuildAuthMaster` L3656 + `buildApiSchemaCards` L3926 + 排序 L3952 | `components/admin/ApiEditor.vue` + `ParamRowsEditor.vue` + `SchemaFieldEditor.vue` | 局部差异（基本信息构成、鉴权表空态/说明、嵌套字段结构） |
| API 发布/撤回/停用/删除 弹窗 | L766 四处 `modal` | `AdminApis.vue` L296-358 | 一致 |
| 业务系统列表 | `renderBiz` L813-818 + L867；`bizActions` L807 | `views/admin/AdminBizSystems.vue` | 一致 |
| 业务系统新建/编辑/查看抽屉 | `renderBizEditor` L760 + L820 + L846 + L881 + L905 + L1148；业务页事件 L767 | `components/admin/BizSystemEditor.vue` | 局部差异（示例问题位置、连接方式/登录地址同行） |
| 业务系统 发布/撤回/停用/删除/删业务页 弹窗 | L766 四处 + L767 `删除业务页` | `AdminBizSystems.vue` L152-214、`BizSystemEditor.vue` `confirmRemovePage` | 一致 |
| 模型列表 | `renderModels` L213、`modelActions` L212、`verifyHtml` L211、点击 L260、`pagerHtml` L1549 | `views/admin/AdminModels.vue` | 局部差异（分页器、名称格图标） |
| 模型接入/编辑/查看抽屉 | `openModelDrawer` L245 + L1319（图标）+ L1415/L1419 | `components/admin/ModelConfigEditDialog.vue` | 局部差异（图标字段缺、卡内验证按钮、两列栅格、鉴权控件） |
| 模型 发布/撤回/停用/设为默认/删除/类别变更/连接变更 弹窗 | L260 五处 + `saveModel` L249 两处 | `AdminModels.vue` L356-429、`ModelConfigEditDialog.vue` L232-270 | 一致 |
| 抽屉外壳（四个编辑器共用） | `.drawer` L42、`.section-card` L47、`.model-drawer` L110 | `components/admin/DrawerEditor.vue`（720px，正文无卡片） | 结构不同（灰底白卡 vs 白底平铺） |

---

## 二、差距清单

### 共享（连接器三编辑器 + 模型抽屉 + 列表共用）

#### S1. 抽屉正文·分区卡片化（灰底 + 白卡）
- 原型：`.drawer{width:min(780px,88vw);background:#f5f7f6}` L42；每个分区是 `<section class="section section-card">`（白底、`border:1px solid #dde4e0`、圆角 10、`padding:0 20px 20px`、浅阴影）L47；标题 `h3.section-title` + `span.section-sub`；「被技能引用」用 `.reference-section`（非卡片，L69）；`.page-time` 弱色带上边线 L70。MCP L174、API L757、业务系统 L760、模型 L245 全部同构。
- 代码：`DrawerEditor.vue` L102-104 `.de-body` 纵向 flex + gap，无底色；各编辑器 section 只是标题块：`McpEditor.vue` L999-1006 `.md-sec-title`、`ApiEditor.vue` L676-681 `.ad-sec-title`、`BizSystemEditor.vue` `.ad-sec`、`ModelConfigEditDialog.vue` L634-650 `.mc-sec`。
- 要做：在 `DrawerEditor.vue` 给 `.el-drawer__body` 加灰底令牌、提供统一 `.de-card` 卡片类（或在四个编辑器的 `section` 上加同一类名），「被技能引用」保持非卡片、时间行按原型弱色行。四个编辑器改 class 即可，样式只写一次。
- 量级：中（共享组件，需先做，其余编辑器串行跟进）
- 与 md 的关系：一致（MCP md §三.1「MCP 编辑页…分区卡片」，Q145 已确认原型同构）

#### S2. 抽屉宽度
- 原型：连接器三抽屉 `min(780px,88vw)` L42；模型抽屉 `min(820px,90vw)` L110（`drawerMask.classList.add('model-drawer')` L245）。
- 代码：`DrawerEditor.vue` L55 `size` 默认 `'720px'`，四个编辑器均未传。
- 要做：默认改 780px；`ModelConfigEditDialog.vue` L349 传 `size="820px"`。
- 量级：小
- 与 md 的关系：md 无定义

#### S3. 图标行形态（预览 + 两个并排按钮）
- 原型：`.icon-row.compact-icon-row` = `span.icon-preview` + `button.plain`【从图标库选择】+ `button.plain`【上传图标】并排（MCP L174 原生；API/业务系统 L875；模型 L1328；统一由 L1331-1342 `decorateEditor` 改写按钮文案并补上传按钮）；点击分别打开 `#unifiedIconLibraryMask` 图标库遮罩 / 文件选择 → 裁剪遮罩 L1357-1377；只读态两按钮 `disabled` L1326/L1336。
- 代码：预览 + `IconPickerPopover`：trigger 是一个带「换图标」遮罩的头像块，点开 popover 里再选【从图标库选择 / 上传图标 / AI 生成】（`IconPickerPopover.vue` L227-253）；`McpEditor.vue` L672-686、`ApiEditor.vue` L427-441、`BizSystemEditor.vue` L441-455 三处同款；且抽屉自己已有 `md-icon-preview`，与 popover 头像块形成两个预览。
- 要做：连接器/模型抽屉里改为「预览 + 两个 plain 按钮」直调组件已暴露的图标库/上传链路（`IconPickerPopover.vue` L220-224 注释说明已为岗位详情暴露），popover 形态留给岗位场景；只读态按钮置灰。图标库弹窗 / 裁剪弹窗代码已具备，不用重做。
- 量级：小（若抽成 `IconField` 小组件供 4 处复用则中）
- 与 md 的关系：一致（各 md「图标配置统一规则」：点击【从图标库选择】/【上传图标】）；本项与 A/B 路（岗位/专家/技能）共享同一组件，须串行

#### S4. 列表表格白卡外框
- 原型：`.table-wrap{border:1px solid #e1e6e3;border-radius:10px;background:#fff;overflow:hidden}` L37，MCP/API 分组内/业务系统/模型表格均套此壳（L171、L781、L817、L213）。
- 代码：`assets/theme.css` L239-247 `.table-wrap` 仅 `width:100%` + 表头上缘细线；`AdminMcp.vue`/`AdminApis.vue`/`AdminBizSystems.vue` 未套 `.table-wrap`，`AdminModels.vue` L481 有套。
- 要做：属全站表格壳，建议由壳层组统一改 `theme.css`；本组只需保证四个列表都套 `.table-wrap`。
- 量级：小（全站一次）
- 与 md 的关系：md 无定义

#### S5.（仅记录，不计入本组）页面居中限宽
- 原型：`.page{max-width:1480px;margin:0 auto;padding:26px 34px 48px}` L23。代码：`layouts/AdminLayout.vue` L25-31 主区无限宽。属壳层组，见其报告。

### MCP 列表（`AdminMcp.vue`）

#### M1. 工具栏缺【查询】按钮
- 原型：搜索框 → 状态下拉 → `button.plain`【查询】(`data-action="mcp-query"`) → 右侧【＋ 新建 MCP】L171；点击处理 L720；搜索框同时保留 260ms 自动刷新 L188。
- 代码：`AdminMcp.vue` L394-406 `ListToolbar` 只有搜索 + 状态 + 新建，无【查询】；搜索 300ms 防抖 L220-226。
- 要做：加一个 `<el-button @click="reload">查询</el-button>`（与 API/业务系统/模型页同形）。
- 量级：小
- 与 md 的关系：md 无定义（MCP md §一.2 只写自动刷新；API/业务系统/模型 md 均有【查询】）

#### M2. 引用情况点击弹窗
- 原型：有引用时渲染 `button.ref`「N 个技能引用」（`title` 悬停列技能名）L171；点击 `refs` → `modal('被技能引用', refs.join('、'), '关闭')` L189。
- 代码：`AdminMcp.vue` L458-465 仅 `el-tooltip` 悬停，不可点击；API/业务系统页已有同款弹窗（`AdminApis.vue` L632-642、`AdminBizSystems.vue` L376+）。
- 要做：改成 link 按钮 + 复用引用清单 el-dialog（标题「被技能引用」、按钮【关闭】），悬停 title 保留。
- 量级：小
- 与 md 的关系：**与 md 冲突（MCP md §二.1 L47 写的是「鼠标悬停可查看引用该 MCP 的技能名称」，未写点击弹窗；原型两者兼有）**——Q157 已记，按原型做不违反 md（悬停仍在）

#### M3. 分页器形态与每页条数
- 原型：`dynPageSize()`（按视口高度 5~30 条，L146）；仅 `pages>1` 时渲染自绘 `.pager`（‹ 页码 › + 「共 N 条」）L171。
- 代码：`AdminMcp.vue` L201 `pageSize: 10`；`ListPagination.vue` L36-42 `prev, pager, next, total`，仅 total>pageSize 时显示。
- 要做：不动（代码 = md）。仅记录。
- 量级：—
- 与 md 的关系：**与 md 冲突（MCP md §5 L166「每页固定展示 10 条」，原型动态条数）**——Q151 已记，保留代码口径

### MCP 抽屉（`McpEditor.vue`）

#### M4. 示例问题应位于「基本信息」卡片内（作卡内子分区）
- 原型：L1072 先把 `<section class="section section-card connector-example-section" data-field="exampleQuestions">` 追加到抽屉末尾；随后 L1137-1147 `placeConnectorExamplesInBasicInfo`（MutationObserver L1148）把它移进首张 `.section-card`（基本信息）末尾，去掉 `section-card` 类改 `.connector-basic-subsection`：上边线分隔 `margin-top:26px;padding-top:24px;border-top:1px solid` L1126，标题 17px/700 L1127，输入高 46px L1132，行 `30px minmax(0,1fr)` 序号 + 输入 L1130。**L2239 用 `[data-connector-field="exampleQuestions"]` 查找，与 MCP 段的 `data-field` 不匹配，该段在最终态仍存在**。标题右侧【AI 生成】`button.plain.ai-generate-btn`（常规字重 L1383）。
- 代码：`McpEditor.vue` L965-994 独立 `section.md-sec` 放在抽屉最末（被技能引用之后）。
- 要做：把示例问题块移入基本信息 section 末尾，加 border-top 子分区样式；AI 按钮位置不变。
- 量级：小
- 与 md 的关系：md 无定义位置（MCP md §三.3 L241 只定义必填 3 条）。**注意**：审查结果 Q127 记「最终覆写层 L2245 删除 → MCP 编辑器最终无示例问题」，与本次选择器核对结论相反（L2239 选择器只命中 API 的 `data-connector-field` 段），建议复核 Q127；合并按「保留」处理与 md 一致

#### M5. stdio Env 表形态
- 原型：`connFields` L180：`.mcp-env-title` 一行 = 左「Env」label + hint、右【＋ 添加变量】link；`.mcp-env-head` 表头「变量名 / 描述（客户端可见）/ 填写方式 / 平台值」；每行 `.mcp-env-card` 卡片（描边 + 浅底 L120，5 列栅格 `minmax(120px,1fr) minmax(170px,1.35fr) 112px minmax(135px,1fr) 42px`）；「客户端填写」是带文字的 checkbox `label.mcp-env-client`；无行时显示「暂无环境变量」`.mcp-env-empty` L178；删除为文字 `danger-link`。
- 代码：`ParamRowsEditor.vue` L68-113：表头「名称 / 描述（客户端可见）/ 客户端填写 / 平台值」，添加按钮在底部 L108-113，无空态，行无卡片描边，checkbox 无文字。
- 要做：`ParamRowsEditor` 加 `emptyText` 与 `addPosition:'header'` 两个可选 prop（MCP 传 `keyHeader="变量名"`、空态「暂无环境变量」、添加按钮走标题行）；行卡片描边样式可加 `card` 变体。API 鉴权表复用同组件时用默认值。
- 量级：小
- 与 md 的关系：**与 md 冲突（MCP md §四.2 L277「Environment：选填，多行输入，每行填写一个名称和值」，原型/代码均是表格）**——Q137 已记；表格形态是 09-01 拍板结果，按原型细节对齐即可

#### M6. 测试连接结果回显形态
- 原型：`.result` 单行提示框（成功绿 / 失败红），文案「握手成功 · 协议 2025-03-26 · Server 1.4.2 · 延迟 86 ms」L194；位于 `.conn-actions` 下、超时时间上。
- 代码：`McpEditor.vue` L837-862 `el-alert`（标题「握手成功」+ 三个 kv）。位置一致。
- 要做：可保留 el-alert；若要逐像素，改单行文本。
- 量级：小（可不做）
- 与 md 的关系：一致（MCP md §五 定义正文文案，Q134/Q135 已记文案差异）

### API 列表（`AdminApis.vue`）

#### A1. 验证列时间格式
- 原型：`apiHealth` L750 `<small>` 显示 `updated.slice(5,16)`（MM-DD HH:mm）。
- 代码：`AdminApis.vue` L521-523 `fmtRelative(row.lastCheckedAt)`（「27 天前」）；MCP 页 L495-497 与模型页 L582-584 已用短格式 `MM-DD HH:mm`。
- 要做：改成与 MCP 页同款 `fmtShortTime`。
- 量级：小
- 与 md 的关系：md 无定义格式（原型此处取的是「更新时间」而非验证时间，见 四.7，不照搬取值）

#### A2. 引用清单弹窗标题
- 原型：`modal('被技能引用', refs.join('、'), '关闭')` L801，`.modal` 宽 440 L15。
- 代码：`AdminApis.vue` L632 标题 `「${apiName}」的技能引用`，正文 tag 列表，按钮【关闭】；业务系统页 L376 已用「被技能引用」。
- 要做：标题统一「被技能引用」。
- 量级：小
- 与 md 的关系：md 无定义（API md §二.1 L35 只写「弹出引用清单弹窗」）

### API 抽屉（`ApiEditor.vue`）

#### A3. 基本信息卡构成与栅格
- 原型（最终态）：`form-grid` 两列：名称 ｜ 所属服务提供系统（L757 前两个 `.field`）→ API 描述通栏 → 「这个操作会改动数据吗？」单格 + hint。状态 radio 行被 L788-790 删除；API id 行被 L2169 删除；图标字段被 L2181 删除；示例问题段被 L2182 删除。
- 代码：`ApiEditor.vue` L422-499：名称 ｜ 图标 → 所属系统独占一行 → 描述 → 状态（启用/停用 radio）｜ 操作性质。
- 要做：① 删「状态」启用/停用 radio（`form.enabled`，L478-483，md 与原型均无此项）；② 所属服务提供系统与名称同行、图标另起或与描述前一行（若图标保留）；③ 图标与示例问题两项原型删了但 md 要求，**不动，待 Q101/Q102 裁决**。
- 量级：小
- 与 md 的关系：状态 radio——一致（md §三.2 无此项）；图标/示例问题——**与 md 冲突（API md §三.2 L106「图标：必填」、L118「示例问题…位于基本信息卡片内」，原型最终态两者皆无）**；API id——**与 md 冲突（md L119「API ID：编辑和查看态只读展示」，原型 L2169 删除，代码亦未展示）**，Q113 已记

#### A4. 鉴权配置卡内细节
- 原型：`authMasterContent` L3645-3655：「鉴权类型」小 label + 三 radio（不鉴权 / API KEY / Bearer Token）L3647；API KEY → 「鉴权参数」小标题 + `.api-auth-grid` 六列（`1.05fr 1.7fr 82px 112px 1.35fr 48px` L3578：参数名 / 描述（客户端可见）/ 客户端填写 / 位置 / 参数值 / 删除）；无行时「暂无鉴权参数」；底部【＋ 添加参数】+ **常显**说明「客户端填写参数由客户端收集，平台不存值」L3649；参数值为 `type="password"`（客户端填写时改 text 并禁用）L3642；位置四选 Query/Body/Header/Path L3878；删除为文字按钮、不二次确认 L3717-3722。Bearer → label「Token」+ hint + 前缀框「Authorization: Bearer」+ 密码框，placeholder「粘贴Bearer Token（不含Bearer前缀）」L3652/L3892。
- 代码：`ApiEditor.vue` L523-586 + `ParamRowsEditor.vue`：结构与列序一致；差异——① 说明只在勾选客户端填写后显示（`ParamRowsEditor.vue` L110）；② 无「暂无鉴权参数」空态（选 API KEY 时预置一行 L157，不会出现空态）；③ 参数值明文输入（L92-97）；④ Bearer placeholder「请输入 Token」L573。
- 要做：①说明改常显；②预置一行可保留（代码更友好，原型空态不必搬）；③参数值改 `type="password"`（已配置留空语义不变）；④placeholder 对齐。
- 量级：小
- 与 md 的关系：一致（API md §三.3；Q107/Q108 为字段级已记）

#### A5. 请求参数 / 响应字段·嵌套子字段的结构
- 原型：`schemaBlock` L901：一张卡一份扁平列表，子字段作为**同列表中的缩进行**渲染（`depth-1/2/3` 左缩进 24/48/72px + 左侧连接线 L1699-1700），对象/数组行的操作区多出【＋子字段】link L899；每层行都有完整列（请求：参数名/描述/类型/请求方法/必填/默认值；响应：参数名/描述/变量类型）；表头只一份；删除用 `window.confirm('确认删除该字段？')` L906；底部【＋ 添加字段】+ 提示「类型选「对象」或「数组」可展开配子字段…」。
- 代码：`SchemaFieldEditor.vue` L141-230：子字段是独立缩进块，带标题「X 的子字段」+ 长提示 L205-213，块内递归一个完整编辑器（自己的空态 + 「+ 添加子字段」脚 L222-230），父行没有【＋子字段】按钮；请求方法仅顶层显示；删除 `el-popconfirm`。
- 要做：把递归块改为「同表扁平缩进行」：父行操作区加【＋子字段】（仅对象/数组），子行直接跟在父行后并按 depth 缩进（可保留连接线），去掉子块标题/长提示/子块脚；请求方法列各层保留；删除仍用 popconfirm（原型 `window.confirm` 不搬）。
- 量级：中（组件重构 + 递归改扁平，含知识库 `SourceMapParamRows` 是否同步需另议）
- 与 md 的关系：一致（API md §三.5 L159「类型选择对象或数组时展示【＋子字段】」、L163 删除前二次确认）

#### A6. 抽屉顶部提示行
- 原型：L2163 删除 `.connector-editor-note`。代码：已删（`ApiEditor.vue` 注释 L6「原顶部提示行删除」）。
- 要做：不动；仅记录。
- 与 md 的关系：**与 md 冲突（API md §三.1 L100 要求顶部提示「1 个 API 对应 1 个可被技能引用的工具，发布前必须通过连通性验证。」）**——Q114 已记

### 业务系统抽屉（`BizSystemEditor.vue`）

#### B1. 示例问题应位于「基本信息」卡片内
- 原型：L846 追加 `connectorQuestionsSection`（副注「必填，固定 3 条，用于帮助用户理解如何使用该连接器」+ 【AI 生成】）；L1148 移入基本信息卡末尾作 `.connector-basic-subsection`（样式同 M4）。
- 代码：`BizSystemEditor.vue` L570-601 独立 section，位于「业务页」之后。
- 要做：同 M4，移入基本信息 section 末尾加分隔线。
- 量级：小
- 与 md 的关系：一致（业务系统 md §三.2 L98「位于基本信息卡片内」）

#### B2. 基本信息栅格：连接方式 ｜ 登录地址 同行
- 原型：L760 `form-grid` 两列：系统名称 ｜ 图标（L881 注入）→ 系统描述通栏 → 连接方式（`select disabled`「登录态托管」）｜ 登录地址。
- 代码：`BizSystemEditor.vue` L468-474 连接方式（只读文本）与登录地址各独占一行；L476-483 另有「自动化操作配置」占位（代码超集）。
- 要做：连接方式与登录地址放进 `.ad-row2`；只读文本 vs 禁用下拉可不改。
- 量级：小
- 与 md 的关系：一致（md §三.2 L96 只读「登录态托管」）

#### B3. 业务页展开按钮带折叠箭头
- 原型：`button.link.biz-page-toggle` = `span.caret ▶`（展开时旋转）+ 「展开业务页（N）」L760；展开体 `.biz-page-body.open`。
- 代码：`BizSystemEditor.vue` L494-496 仅文字切换，无 caret。
- 要做：加 caret 图标（与 MCP 工具清单 `md-caret` 同款 L889）。
- 量级：小
- 与 md 的关系：一致（md §三.3 L105）

### 模型列表（`AdminModels.vue`）

#### D1. 分页器
- 原型：`renderModels` L213 末尾恒渲染 `pagerHtml('models', total)` L1549：`.fm5-pager`「共 N 条 · 每页 X 条」+ ‹ 页码 ›，每页数 `dynPageSize()`。
- 代码：`AdminModels.vue` L195-203 `paged:false`，不分页。
- 要做：不动（代码 = md）。仅记录待裁。
- 量级：—
- 与 md 的关系：**与 md 冲突（模型 md §一 L39「页面不分页，一次展示…全部模型」，原型有分页器）**——Q252 已记

#### D2. 名称格显示模型图标（有则替换厂商首字）
- 原型：`renderModels` L213 渲染 `span.model-logo` 厂商首字；L1344-1355 `decorateList` 若 `item.icon/iconImage` 存在则把 `.model-logo` 内容替换为图标（emoji 或 `<img>`）。
- 代码：`AdminModels.vue` L502 只显示 `providerLogo(row)` 首字；行数据无 icon 字段（`adminModelMock.js` 需补）。
- 要做：随 D3 一并：行有 icon 则显示图标，否则回落首字。
- 量级：小（依赖 D3）
- 与 md 的关系：一致（模型 md §三 L247 图标必填 + 统一规则「保存后用于列表…展示」）

### 模型抽屉（`ModelConfigEditDialog.vue`）

#### D3. 基本信息缺「图标」字段
- 原型：L1319-1330 `addMissingIconField`：在 `[data-form="modelName"]` 所在 `.field` 之后插入 `.field`「图标*」= `icon-preview` + 【从图标库选择】+【上传图标】（只读态禁用）；L1415 默认 `▦`；L1419 保存时兜底 `d.icon||'▦'`。
- 代码：`ModelConfigEditDialog.vue` L404-410 模型名称后直接是模型类别，无图标字段；mock `adminModelMock.js` 无 icon 字段。
- 要做：基本信息网格在「模型名称」后加图标字段（复用 S3 的图标行）；mock 行加 `icon` 并持久化；列表 D2 消费。
- 量级：中（表单 + mock + 列表三处；图标行组件依赖 S3）
- 与 md 的关系：一致（模型 md §三.2 L247「图标：必填」）；09-01 拍板 MQ3「不加图标字段用厂商首字」已被 0907 md/原型推翻，需负责人确认

#### D4. 「连接与鉴权」卡内的验证按钮与结果回显
- 原型：L245 卡末 `.conn-actions` = `button.plain`【⌁ 验证连通性】（只读 disabled）+ hint（「最近验证通过：时间」/「最近验证失败：时间」/「尚未验证」）+ `#modelTestResult` 结果框；新建/编辑/查看三态都有；footer【重新验证】也只是触发同一按钮 L265。
- 代码：卡内无按钮；仅 footer 编辑态【重新验证】L622 + 抽屉底部 `el-alert` L589-613 显示进度/结果。
- 要做：不动（代码 = md）；若负责人按原型，则在卡末加按钮 + hint，结果框移到卡内。
- 量级：小（若做）
- 与 md 的关系：**与 md 冲突（模型 md §5.2 L302「【重新验证】仅在编辑状态展示；接入和查看状态不展示」，原型卡内按钮三态均有）**

#### D5. 连接与鉴权区两列栅格
- 原型：L245 `form-grid`（两列 L16）：Base URL 通栏 → 鉴权方式（半栏 `select`）→ `#modelAuthFields.field.full` 内再套 `form-grid`：API Key 通栏 / App ID·API Key·App Secret 三格两列排。
- 代码：`ModelConfigEditDialog.vue` L480-546 全部单列纵排；鉴权方式为 radio L491-494。
- 要做：连接与鉴权区套 `.mc-grid` 两列（Base URL 跨两列），AppID 三元组两列排；鉴权方式控件可保留 radio。
- 量级：小
- 与 md 的关系：md 无定义（§4 L264 只定义两种选项）

#### D6. 保存校验反馈方式
- 原型：`validateModel` L246 给 `.field.invalid` 标红 + toast「请先修正标红项」；L1419 capture 层再对超长项 toast（截图「模型-新建校验提示」）。
- 代码：`formRef.validate()` L232-233 行内错误文案，无 toast。
- 要做：可加一条 `ElMessage.warning('请先修正标红项')`（MCP/API/业务系统编辑器已有同款：`McpEditor.vue` L576、`ApiEditor.vue` L367、`BizSystemEditor.vue` L381）。
- 量级：小
- 与 md 的关系：一致（md §6 L326「在对应位置说明原因」，toast 为原型附加）

---

## 三、代码超集（原型无对应，保留不动）

| 页面/功能 | 文件:行 |
|---|---|
| 连接器页签状态写入 `?tab=` query、keep-alive 缓存子页 | `AdminConnector.vue` L32-53、L76-78 |
| MCP 列表：审核态聚合、行内 loading、删最后一条自动回退页 | `AdminMcp.vue` L176-196、L285-296、L379-381 |
| MCP 抽屉：导入 JSON 的告警/错误提示（原型只有成功/失败 toast）、鉴权掩码提示「当前：***」、stdio Env 行级 `configured/valueMasked`、超时 `el-input-number` | `McpEditor.vue` L198-229、L794-798、`ParamRowsEditor.vue` L57-62 |
| API 列表：零分组前置禁建 + 引导空态、加载失败重试 | `AdminApis.vue` L134-135、L193-197、L388-400 |
| API 抽屉：鉴权行级软提示（QUERY 泄漏/BODY×GET）、密钥「已配置留空保留」语义、切鉴权类型「保存后将清除已配置的密钥」提示、所属系统为空兜底提示 | `ApiEditor.vue` L174+、L533、L459-462 |
| 业务系统抽屉：「自动化操作配置」占位、「业务系统专属技能」区（新建/编辑/删除 + 取名弹窗）、深链 `?view=<id>` 只读打开 | `BizSystemEditor.vue` L476-483、L605-654、L685+；`AdminBizSystems.vue` L100-109 |
| 模型：行内 40s 验证阶段推断 + AbortController、请求层失败文案区分 409/超时、字段问号说明 `FieldHelpLabel`、能力标签组件 | `AdminModels.vue` L262-330、`ModelConfigEditDialog.vue` `FieldHelpLabel` 各处、`ModelCapabilityTags.vue` |
| 未被任何视图引用的旧发布抽屉（死代码，原型亦无） | `components/admin/ConnectorPublishDrawer.vue`（仅测试与注释引用） |

---

## 四、原型侧缺陷（合并时不应照搬）

1. **API 保存永远被拦截**：L2182 删掉示例问题段后，L1419 capture 层 `action==='api-save'` 仍取 `values('[data-connector-example]')` 要求 3 条，恒得 `[]` → toast「请填写 3 条不超过 60 个字符的示例问题」。原型 API 抽屉实际不可保存。处理：不搬；示例问题按 md 保留（待 Q102 裁决）。
2. **API 图标被最终层删除**（L2181）而 md §三.2 必填：不搬删除动作，待 Q101 裁决。
3. **审查 Q127 结论需复核**：L2239 用 `[data-connector-field="exampleQuestions"]`，MCP 段（L1072）是 `data-field`，未被删除；MCP 最终态有示例问题且已移入基本信息卡。合并按「保留 + 移入基本信息卡」。
4. MCP 描述计数 hint「N / 1000」（L174）与 `maxlength="2000"` 不符：按 md 2000，不搬 1000。
5. API 顶部提示行（L2163）、健康检查路径（L2170）、API ID 行（L2169）被最终层删除，md 三处均有定义：待 Q114/Q112/Q113 裁决，本轮不改代码。
6. 业务系统保存要求「至少配置 1 个业务页」（L1419 `biz-save` 分支）与卡片副注「可选」/md §三.3「可选项」矛盾：不搬。
7. API 列表验证列时间取 `r.updated`（L750）而非验证时间：只搬格式（A1），取值用 `lastCheckedAt`。
8. 模型列表恒显示分页器（L213/L1549）与 md「不分页」矛盾：不搬（D1）。
9. 模型「连接与鉴权」卡内【验证连通性】三态可见（L245）与 md §5.2 矛盾：不搬（D4）。
10. 请求参数/鉴权参数删除用 `window.confirm`（L906）/ 直接删（L3720）：不搬，统一 popconfirm（md §三.5 要求二次确认）。
11. 鉴权参数首行「描述」种子值「选填：这个参数是做什么的」（L3633）是把占位写进了值：不搬，作 placeholder。
12. MCP 列表每页条数随视口变化（L146）与 md 固定 10 条矛盾：不搬（M3）。
13. 左侧其余导航 toast「该模块不在本次原型范围内」（L187/L253）为原型占位，与本组无关。

---

## 五、量级汇总

- 小：S2、S4、M1、M2、M4、M5、M6、A1、A2、A3、A4、B1、B2、B3、D2、D5、D6 —— **17 条**（其中 M3、A6、D1、D4 为「代码 = md、仅记录待裁」不计工时）
- 中：S1、S3（若抽组件）、A5、D3 —— **4 条**
- 大：0 条
- 合计粗估：小 17 × ~0.2 天 ≈ 3.5 天；中 4 × ~1 天 ≈ 4 天；**约 7～8 人天**（不含待裁项）。
- 必须串行：
  1. **S1（DrawerEditor 卡片化）先做**，四个编辑器随后各自加 class（MCP/API/业务系统/模型可并行）。
  2. **S3（图标行组件）先做**，再做 M4/B1 所在的基本信息卡改排与 D3 模型图标；S3 与 A/B 路（岗位/专家/技能）共用 `IconPickerPopover`，需跨组约定。
  3. **M5（ParamRowsEditor 加 prop）**先于 MCP Env 与 API 鉴权表两处改动。
  4. **A5（SchemaFieldEditor 扁平化）**独立，但需确认知识库数据源的 `SourceMapParamRows` 是否同步。
  5. D3 → D2（列表图标依赖抽屉/mock 字段）。

---

## 六、覆盖说明

- 原型核对函数/覆写层：`renderMcp` L171 + 分发 L755；`actionButtons`/`health` L169-170；MCP 事件 L188-198、L720；`openDrawer` L174 及其覆写 L1072、L1137-1151、L1319-1379（统一图标）、L1415-1419（字段规则与 capture 校验）、L2205-2240、L3835-3844；`connFields`/`envRowsHtml`/`authFields`/`toolHtml` L173-183；`validateMcpEditor` L196、保存 L197；`renderApis` L752 → L772-783 → L865；`apiActions`/`apiHealth`/`apiReferenceCell` L750-771；`openProviderDialog` L756；`renderApiEditor` L757 → L785 → L844 → L879 → L904 → L2159-2202 → `enhanceApiAuth` L3285-3300（已被 L3656 层取代，确认 L3663-3668 删除逻辑与 `api-auth-master` 标题空文本规避）→ `rebuildAuthMaster` L3656-3681 + 事件 L3700-3740 → `arrangeApiCards` L3852-3893 → `buildApiSchemaCards`/`ensureApiCardsAndOrder` L3926-3985；schema 逻辑 L889-912；`renderBiz` L754 → L813-818 → L867；`bizActions` L807；`renderBizEditor` L760 → L820 → L846 → L881 → L905；业务页事件 L767；`saveBiz` L762/L849；连接器示例问题 L839-850；图标 L851-888；`renderModels` L213；`modelActions`/`verifyHtml` L211-212；模型事件 L255-266；`openModelDrawer` L245；`modelAuthHtml` L244；`validateModel`/`doModelTest`/`commitModel`/`saveModel` L246-249；分页 L146、L1545-1551；统一 AI 生成 L4383-4410；`syncDrawer` L2681；CSS 壳 L11-16、L23、L37、L42-47、L69-70、L110、L120、L1119-1133、L1382-1391、L1686-1705、L3185-3217、L3570-3585、L3822-3830、L3910-3913。
- 代码核对文件：`views/admin/AdminConnector.vue`、`AdminMcp.vue`、`AdminApis.vue`、`AdminBizSystems.vue`、`AdminModels.vue`（全文）；`components/admin/DrawerEditor.vue`、`McpEditor.vue`（L601-1060）、`ApiEditor.vue`（L1-60、L140-160、L397-700）、`BizSystemEditor.vue`（L1-50、L409-690）、`ProviderSystemEditor.vue`、`ModelConfigEditDialog.vue`（L1-50、L225-300、L343-660）、`ParamRowsEditor.vue`、`SchemaFieldEditor.vue`（L1-40、L129-240）、`ConnectorPublishDrawer.vue`（头注 + 引用检索）；`components/position/IconPickerPopover.vue`（L1-40、L220-256）；`layouts/AdminLayout.vue`；`assets/theme.css`（L239-247、L330-350）、`assets/list-page.css`；`router/index.js`（L90-110、L215-235、L270-290）；`utils/defValidate.js`（L78-86、L232-240）；md：`03能力/模型/prd-模型.md`、`连接器/API/prd-API.md`、`连接器/MCP/prd-连接器-MCP.md`、`连接器/业务系统/prd-业务系统.md`（布局相关段落）；`docs/02-PRD和原型一致性审查/PRD与原型一致性审查结果-20260907.md`（连接器/模型 Q 编号索引）。
- 未覆盖：四个 mock 文件只核对了存在与被引用关系，未逐字段核对（字段级归审查结果）；原型审核中心/我的申请对连接器与模型抽屉的复用（L1715-1790）属治理组；知识库数据源里的 MCP/API 配置（L1918-2020、L3185-3334 中知识库部分）属知识库组；`SourceMapParamRows.vue`/`SourceMappingEditor.vue` 未读；未运行 dev server，未做截图比对（合并实施后须按「对齐原型=还原页面骨架」约定截图核对）。
