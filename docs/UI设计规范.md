# iWorker 管理后台 · UI 设计规范

> 基于现有页面提炼，单一真相来源：`frontend/src/assets/tokens.css`、`theme.css`、`admin-shell.css`。  
> 新增页面**只引用这些变量和组件**，不硬编码色值，不自创样式类。

---

## 一、基础样式

### 1.1 品牌色（Emerald 绿）

| 变量 | 浅色 | 暗色 | 用途 |
|------|------|------|------|
| `--c-accent` | `#059669` | `#10b981` | 主按钮、链接、选中态、hover 高亮 |
| `--c-accent-hover` | `#047857` | `#34d399` | 按钮 hover / active |
| `--c-accent-soft` | `rgba(16,185,129,0.14)` | `rgba(16,185,129,0.2)` | 聚焦外发光 box-shadow |
| `--c-accent-fill` | `#ecfdf5` | `#123a2c` | 标签底色、分页当前页底（不透明） |

### 1.2 文字层级

| 变量 | 浅色 | 暗色 | 用途 |
|------|------|------|------|
| `--c-text-strong` | `#37352f` | `#ffffff` | 标题、主要强调文字 |
| `--c-text` | `#37352f` | `#e9e9e7` | 正文基准色 |
| `--c-text-muted` | `#787774` | `#9b9a97` | 次级说明、副标题、表头字色 |
| `--c-text-faint` | `#9b9a97` | `#6f6f6c` | 占位符、空值、禁用态文字 |
| `--c-text-on-accent` | `#ffffff` | `#0f172a` | 强调色底上的文字 |

### 1.3 背景层级

| 变量 | 浅色 | 暗色 | 用途 |
|------|------|------|------|
| `--bg-app` | `#ffffff` | `#191919` | 页面底色 |
| `--bg-sunken` | `#f7f7f5` | `#202020` | 凹陷区（侧栏、代码块底） |
| `--bg-surface` | `#ffffff` | `#1f1f1f` | 卡片 / 表格白卡 / 内容表面 |
| `--bg-elevated` | `#ffffff` | `#2a2a2a` | 浮层 / 菜单 / 弹窗 |
| `--bg-hover` | `rgba(55,53,47,0.06)` | `rgba(255,255,255,0.055)` | 悬停浅灰块（Notion 标志） |
| `--bg-selected` | `rgba(16,185,129,0.1)` | `rgba(16,185,129,0.22)` | 选中态（品牌绿淡底） |

### 1.4 管理后台专用背景

| 变量 | 浅色值 | 用途 |
|------|--------|------|
| `--bg-admin-main` | `#f6f8f7` | 后台主区灰绿底 |
| `--bg-admin-drawer` | `#f5f7f6` | 抽屉正文区底 |
| `--bg-admin-card-head` | `#f8faf9` | 抽屉分区卡头灰条 |
| `--bg-admin-table-head` | `#f2f5f3` | 表头底色 |
| `--bg-admin-row-hover` | `#f7faf8` | 表格行 hover 底色 |

### 1.5 边框

| 变量 | 浅色 | 暗色 | 用途 |
|------|------|------|------|
| `--border-base` | `rgba(55,53,47,0.1)` | `rgba(255,255,255,0.09)` | 默认细边框（卡片、输入框） |
| `--border-soft` | `rgba(55,53,47,0.06)` | `rgba(255,255,255,0.055)` | 极淡分隔线（表格行分隔） |
| `--border-strong` | `rgba(55,53,47,0.16)` | `rgba(255,255,255,0.16)` | hover 后加深边框 |
| `--border-admin-card` | `#dde4e0` | 同 `--border-base` | 抽屉分区卡描边 |
| `--border-admin-table` | `#e1e6e3` | 同 `--border-base` | 表格白卡描边 |

### 1.6 语义色

| 变量 | 浅色 | 暗色 | 用途 |
|------|------|------|------|
| `--c-success` | `#047857` | `#34d399` | 成功、通过、启用 |
| `--c-warning` | `#cb912f` | `#e0b250` | 警告、待处理 |
| `--c-danger` | `#e03e3e` | `#f06b6b` | 危险、错误、删除 |
| `--c-purple` | `#6940a5` | `#a78bda` | 岗位类型、Windows 标签 |
| `--c-success-soft` | `rgba(16,185,129,0.12)` | `rgba(16,185,129,0.16)` | 成功标签底色 |
| `--c-warning-soft` | `rgba(203,145,47,0.14)` | `rgba(224,178,80,0.16)` | 警告标签底色 |
| `--c-danger-soft` | `rgba(224,62,62,0.1)` | `rgba(240,107,107,0.16)` | 危险标签底色 |
| `--c-purple-soft` | `rgba(105,64,165,0.12)` | `rgba(167,139,218,0.18)` | 紫色标签底色 |

### 1.7 阴影

| 变量 | 浅色 | 用途 |
|------|------|------|
| `--shadow-sm` | `0 1px 2px rgba(15,15,15,0.05)` | 卡片默认阴影 |
| `--shadow-md` | `0 4px 12px rgba(15,15,15,0.1)` | 下拉菜单、浮层 |
| `--shadow-lg` | `0 8px 28px rgba(15,15,15,0.14)` | 弹窗、抽屉 |
| `--shadow-admin-card` | `0 1px 3px rgba(34,55,46,0.045)` | 抽屉分区卡 |

---

## 二、字体

### 2.1 字体栈

```
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
             'Hiragino Sans GB', 'Microsoft YaHei', Helvetica, Arial, sans-serif

--font-mono: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, monospace
```

### 2.2 字号

| 变量 | 值 | 用途 |
|------|-----|------|
| `--fs-xs` | `12px` | 辅助文字、标签字号、分页器 |
| `--fs-sm` | `13px` | 次级文字、表格行内容、表头 |
| `--fs-base` | `14px` | 正文基准字号 |
| `--fs-md` | `15px` | 抽屉副标题、段落标题（员工端） |
| `--fs-lg` | `18px` | 页面标题（员工端） |
| `--fs-xl` | `22px` | 页面标题（员工端 PageHeader） |
| `25px` | — | 管理后台页面标题（`body.admin-scope`） |
| `19px` | — | 抽屉标题（DrawerEditor 头部） |
| `17px` | — | 弹窗标题（admin-dialog / admin-confirm） |

### 2.3 字重

| 变量 | 值 | 用途 |
|------|-----|------|
| `--fw-regular` | `400` | 正文 |
| `--fw-medium` | `500` | 次级强调（按钮、标签、次要标题） |
| `--fw-semibold` | `600` | 一级标题、卡片主名 |
| `--fw-bold` | `700` | 极少用 |
| `650` | — | 管理后台页面标题、抽屉标题、分区卡头（原型实测值，无 CSS 变量） |

### 2.4 行高

| 变量 | 值 | 用途 |
|------|-----|------|
| `--lh-tight` | `1.3` | 标题 |
| `--lh-base` | `1.6` | 正文、说明文字 |

---

## 三、间距

基准单位 **4px**，所有间距均为 4 的倍数。

| 变量 | 值 | 常用场景 |
|------|-----|----------|
| `--space-1` | `4px` | 图标与文字间距、紧凑内边距 |
| `--space-2` | `8px` | 行内元素间距、小控件 padding |
| `--space-3` | `12px` | 工具栏控件间距、行内 gap |
| `--space-4` | `16px` | 卡片内边距、表单字段间距 |
| `--space-5` | `20px` | 页面段落间距（列表页 flex gap） |
| `--space-6` | `24px` | 大块内容间距 |
| `--space-8` | `32px` | 页面顶部留白 |

---

## 四、圆角

| 变量 | 值 | 用途 |
|------|-----|------|
| `--radius-xs` | `3px` | 极小标签 |
| `--radius-sm` | `4px` | 分页按钮、小标签 |
| `--radius-md` | `6px` | 输入框、普通按钮（EP 基础值） |
| `--radius-lg` | `8px` | 卡片、下拉浮层 |
| `--radius-xl` | `12px` | 弹窗（Dialog） |
| `10px` | — | 抽屉分区卡、表格白卡、admin-dialog（原型精确值） |
| `--radius-pill` | `999px` | 胶囊标签（状态徽标） |

---

## 五、动效

| 变量 | 值 | 用途 |
|------|-----|------|
| `--ease-out` | `cubic-bezier(0.22,1,0.36,1)` | 绝大多数过渡（元素弹出感） |
| `--ease-in-out` | `cubic-bezier(0.4,0,0.2,1)` | 偶发双向动作 |
| `--dur-fast` | `0.12s` | hover 底色、边框变色 |
| `--dur-base` | `0.2s` | 输入框聚焦、按钮状态 |
| `--dur-slow` | `0.32s` | 上浮淡入（.rise-in 入场动效） |

> 无障碍：`prefers-reduced-motion` 时所有动效降至 0.001ms。

---

## 六、层级（z-index）

| 变量 | 值 | 用途 |
|------|-----|------|
| `--z-base` | `1` | 普通堆叠 |
| `--z-sticky` | `100` | 吸顶元素（表头、侧栏） |
| `--z-overlay` | `1000` | 下拉浮层、tooltip |
| `--z-modal` | `2000` | 弹窗、抽屉 |

---

## 七、页面布局

### 7.1 整体框架

```
AdminLayout.vue
├── AdminRail（导航侧栏，宽度由 AdminRail 自定义）
└── .main（flex:1，overflow:auto，背景 --bg-admin-main）
    └── .page（max-width:1480px，min-width:1120px，margin:0 auto，padding:26px 34px 48px）
        └── <router-view>（各列表/详情页）
```

### 7.2 列表页骨架

每个列表页根容器用 `.list-page`，内部结构固定：

```
.list-page（display:flex，flex-direction:column，gap:20px）
├── <PageHeader>        页头（标题 25px/650 + 副标题 15px）
├── <ListToolbar>       工具栏（搜索 + 筛选 + 查询 / 右侧新建按钮）
├── .table-wrap         表格白卡（border:1px solid --border-admin-table，border-radius:10px）
│   ├── <el-table>      表格（表头 48px，行高 60px，cell padding:0 16px）
│   └── <ListPagination> 分页器
└── （编辑抽屉 / 弹窗 teleport）
```

**段间距**：页头与工具栏之间额外 `margin-bottom: 8px`（PageHeader 自带 20px + 8px = 28px 总间距），其余段间距统一 20px。

### 7.3 工具栏规范

使用 `<ListToolbar>` 组件，无需手写 HTML 结构：

| 位置 | 控件 | CSS 类 | 尺寸 |
|------|------|--------|------|
| 左 · 第一位 | 搜索框（带 Search 前缀图标） | `.lt-search` | `300px`（admin-scope 覆盖） |
| 左 · 其后 | 筛选下拉（clearable） | `.lt-filter` | `150px` |
| 左 · 末尾 | 【查询】按钮（可选） | — | default 38px |
| 右 | 主操作「＋ 新建 XX」 | `.lt-create` | min-width `132px` |

```vue
<ListToolbar>
  <el-input v-model="query.keyword" placeholder="搜索名称" clearable class="lt-search">
    <template #prefix><el-icon><Search /></el-icon></template>
  </el-input>
  <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload" />
  <el-button @click="reload">查询</el-button>
  <template #right>
    <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建 XX</el-button>
  </template>
</ListToolbar>
```

### 7.4 抽屉编辑器骨架

使用 `<DrawerEditor>` 组件：

```
DrawerEditor（宽 780px 默认，模型 820px）
├── 头部（高 66px，padding:0 28px，白底 + 下分隔线）
│   └── 标题 19px/650（查看/编辑/新建 + entity）
├── 正文（padding:22px 28px 34px，灰底 --bg-admin-drawer）
│   └── 各 .section-card 分区卡（白底 + 圆角 10px + 灰头条）
└── 底部（高 66px，padding:0 28px，白底 + 上分隔线）
    └── 【取消】plain + 【保存/新建】primary，右对齐，gap:10px
```

**分区卡结构**：

```html
<section class="section-card">
  <!-- 卡头：灰底条，高 52px，负 margin 贴边，底分隔线 -->
  <h3 class="section-title">分区标题</h3>
  <!-- 或带右侧操作 -->
  <div class="section-head">
    <h3 class="section-title">分区标题</h3>
    <el-button size="small">操作</el-button>
  </div>
  <!-- 卡体内容 -->
</section>
```

---

## 八、通用组件

### 8.1 PageHeader

```vue
<PageHeader title="页面标题" subtitle="一句话说明" />
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `title` | String（必填） | 页面名称 |
| `subtitle` | String | 副标题（弱色 15px，`--c-text-muted`） |
| `emoji` | String | 标题前图标（连接器页用） |
| `#badge` | slot | 标题后徽标（红点、计数） |
| `#scope` | slot | 标题行右侧作用域选择器（180px 固定宽） |
| `#actions` | slot | 右侧操作区 |

**样式**：管理后台下标题自动升至 25px/650（由 `body.admin-scope` 全局覆盖）。

### 8.2 ListStates

包裹 `<el-table>`，统一处理四态（加载中 / 失败 / 空态 / 有数据）：

```vue
<ListStates :loading="loading" :error="loadError" :empty="isEmpty"
            empty-text="还没有X · 点「新建X」创建第一个" @retry="fetchList">
  <el-table :data="rows">...</el-table>
  <ListPagination ... />
</ListStates>
```

空态形态：`340px` 高居中纯文字，`--c-text-muted` 主文案 + `--c-text-faint` 12px 副文案。

### 8.3 ListPagination

```vue
<ListPagination v-model:page="page" :page-size="pageSize" :total="total" @change="fetchList" />
```

形态：右对齐一行 `共 N 条 · 每页 X 条  ‹ 1 2 3 ›`，`total=0` 时不渲染。

页码按钮：28px × 28px，圆角 4px，当前页 `--c-accent-fill` 底 + `--c-accent` 字 + 600 字重。

### 8.4 表格列宽（`utils/tableLayout.js`）

| 常量 | 值 | 用途 |
|------|-----|------|
| `COL.STATUS` | `84px` | 状态徽标列 |
| `COL.TIME` | `152px` | 时间戳列（`最近更新时间` / `提交时间`） |
| `COL.USER` | `132px` | 用户名 / 提交人 |
| `COL.COUNT` | `80px` | 数字列（居中，`cell-num` 类） |
| `COL.TAG` | `104px` | 单标签列 |
| `COL.NAME_MIN` | `180px` | 名称主列 min-width |
| `COL.DESC_MIN` | `240px` | 描述列 min-width（配 `show-overflow-tooltip`） |
| `opsWidth(n)` | 见下 | 操作列，按同屏最多按钮数取档 |

操作列分挡：

| 最多按钮数 | 列宽 |
|-----------|------|
| 2 | `124px` |
| 3 | `176px` |
| 4 | `228px` |
| 5 | `280px` |

```js
import { COL, opsWidth } from '@/utils/tableLayout'
// 模板中：:width="COL.TIME"   :min-width="COL.NAME_MIN"   :width="opsWidth(2)"
```

### 8.5 时间列排序按钮

所有列表页时间列头统一用自定义按钮，不用 Element Plus 原生 sortable：

```vue
<el-table-column :width="COL.TIME">
  <template #header>
    <button type="button" class="time-sort" @click="toggleSort">
      最近更新时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
    </button>
  </template>
  <template #default="{ row }">
    <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
    <span v-else class="cell-na">—</span>
  </template>
</el-table-column>
```

```js
const sortArrow = computed(() => query.sort === 'desc' ? '↓' : '↑')
function toggleSort() {
  query.sort = query.sort === 'desc' ? 'asc' : 'desc'
  list.search()
}
```

CSS（页面 scoped）：

```css
.time-sort {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 0; border: none; background: none;
  color: var(--c-text-base); font-size: var(--fs-sm);
  font-weight: var(--fw-medium); cursor: pointer; transition: color 0.2s;
}
.time-sort:hover { color: var(--c-accent); }
.time-sort-arrow {
  font-size: 12px; color: var(--c-text-base); font-weight: var(--fw-medium);
}
```

> **箭头颜色必须为 `--c-text-base`（黑色），不得用 `--c-accent`（绿色）。**

### 8.6 表格操作区（`.tbl-ops`）

全局类，不在页面重复定义：

```html
<div class="tbl-ops">
  <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
  <span class="tbl-ops-sep" aria-hidden="true"></span>
  <el-button link type="danger" @click="remove(row)">删除</el-button>
</div>
```

- 按钮高度固定 `22px`，字号 `13px`，无 padding
- `.tbl-ops-sep`：1px × 12px 分隔线，`--border-strong` 色
- 禁用态颜色降至 `--c-text-faint`

### 8.7 空值占位

全局类 `.cell-na`（`--c-text-faint`），统一用 `—` 字符：

```html
<span v-if="row.field">{{ row.field }}</span>
<span v-else class="cell-na">—</span>
```

### 8.8 状态/分类标签

胶囊形：`height:22px`，`padding:0 8px`，`border-radius:11px`，`font-size:12px`。

**内置色档（`UserSkillAuditTag` / 各页 scoped 标签）：**

| 语义 | 浅色底 | 浅色字 | 用途 |
|------|--------|--------|------|
| green（成功/通过） | `#e3f8ef` | `#079966` | 已通过、启用、宽松 |
| red（危险/驳回） | `#fdebea` | `#c9372c` | 已驳回、错误、停用 |
| yellow（警告/待审） | `#fef3c7` | `#92400e` | 待审核 |
| blue（中性/蓝） | `#e8f0fe` | `#1a56db` | 通用尺度 |
| grey（禁用/中性） | `--bg-hover` | `--c-text-muted` | 草稿、未发布 |

**走 tokens 的软色版（更推荐，双主题自动适配）：**

```css
background: var(--c-success-soft); color: var(--c-success);  /* 成功 */
background: var(--c-warning-soft); color: var(--c-warning);  /* 警告 */
background: var(--c-danger-soft);  color: var(--c-danger);   /* 危险 */
background: var(--c-purple-soft);  color: var(--c-purple);   /* 紫色类型 */
background: var(--c-accent-fill);  color: var(--c-accent);   /* 品牌绿 */
```

### 8.9 弹窗（Dialog）

使用 `class="admin-dialog"` + `width` 属性：

```vue
<el-dialog class="admin-dialog" :width="440" title="弹窗标题">
  <!-- body 最大高度 66vh，自动滚动 -->
  <template #footer>
    <el-button @click="close">取消</el-button>
    <el-button type="primary" @click="confirm">确认</el-button>
  </template>
</el-dialog>
```

尺寸：标题栏 `58px`，body `padding:20px 22px`，footer `padding:14px 22px`，圆角 `10px`。

### 8.10 确认弹窗

通过 `composables/useConfirm.js` 调用，自动挂 `customClass="admin-confirm"`：

```js
import { confirmDialog, alertDialog } from '@/composables/useConfirm'

// 二次确认（双按钮）
const ok = await confirmDialog('确认删除？', '删除角色', { confirmText: '删除', danger: true })

// 纯提示（单按钮「知道了」）
await alertDialog('角色仍绑定用户，请先改绑。', '无法删除角色', { confirmText: '知道了' })
```

弹窗规格：`440px` 宽，无图标，右对齐按钮，gap `9px`。

### 8.11 卡片工具类

| 类名 | 用途 |
|------|------|
| `.np-card` | 卡片基底（圆角 8 + 细边 + 白底） |
| `.np-card--hover` | 在 .np-card 上叠加，hover 抬升 + 浅底 |
| `.np-card--selected` | 选中态（品牌绿描边 + 绿淡底） |
| `.np-row` | 行卡（flex + 细边 + 圆角，用于行列表） |
| `.np-row--hover` | 行卡 hover 浅底 |
| `.np-row-actions` | 行尾操作区，默认隐藏，父级 hover 时淡入 |

```html
<div class="np-row np-row--hover">
  <!-- 行内容 -->
  <div class="np-row-actions">
    <button>编辑</button>
    <button>删除</button>
  </div>
</div>
```

---

## 九、控件尺寸（`body.admin-scope`）

后台所有页面自动受 `body.admin-scope` 控制，无需手动传 size：

| 控件 | 高度 |
|------|------|
| 输入框、下拉 | `38px` |
| 普通按钮 | `38px` |
| 主按钮 padding | `0 18px` |
| 表格表头行高 | `48px` |
| 表格数据行高 | `60px` |
| 表格 cell padding | `0 16px` |
| 表格内按钮 | `32px`（恢复 EP 默认） |

---

## 十、新增页面检查清单

新建一个列表页时，按此清单逐项确认：

- [ ] 根容器用 `.list-page`
- [ ] 页头用 `<PageHeader title="" subtitle="">`
- [ ] 工具栏用 `<ListToolbar>`，搜索框加 `.lt-search`，筛选框加 `.lt-filter`，新建按钮加 `.lt-create`
- [ ] 表格外层套 `.table-wrap`
- [ ] 用 `<ListStates>` 包裹 `<el-table>` 处理四态
- [ ] 列宽引用 `COL.*` 常量和 `opsWidth(n)`，不硬编码
- [ ] 时间列用自定义排序按钮（箭头颜色 `--c-text-base`，不用绿色）
- [ ] 操作区用 `.tbl-ops` + `.tbl-ops-sep`
- [ ] 空值用 `<span class="cell-na">—</span>`
- [ ] 分页用 `<ListPagination>`
- [ ] 编辑抽屉用 `<DrawerEditor>`，分区卡用 `.section-card`
- [ ] 确认弹窗用 `confirmDialog` / `alertDialog`，不用裸 `ElMessageBox`
- [ ] 所有颜色引用 token 变量，不硬编码 hex

