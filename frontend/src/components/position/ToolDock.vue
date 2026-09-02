<script setup>
/**
 * 工具坞（交互规格打磨 §3）—— 由「按需浮层」改造为「内嵌右抽屉」常驻第三栏。
 *
 * 单一职责：四类工具 Tab（MCP/API/数据表/业务系统）+ 搜索 + 中文健康态 + 写类⚠ ，
 * 点「+ 插入」→ emit('insert', code)，由父级在 skill.md 光标处插入工具引用
 *（布局调整 2026-07-08 #6：取消拖拽插入，仅保留插入按钮）。
 * 布局（同批 #5）：「选择工具」picker 在上，「本技能已引用」在下。
 *
 * 形态：内嵌进 SkillFocusEditor 第三栏（无 teleport / 无 fixed / 无遮罩 / 无 shadow）。
 * - 展开态 320px：标题 + 收起「«」 + 搜索 + Tab + 列表（沿用现状交互）；
 * - 收起态 44px 细条：仅一个展开 toggle「»🧰」，不渲染列表（省性能）；
 * - 折叠态由父级用 v-model:collapsed 控制并持久化到 localStorage。
 *
 * 数据源（按 skillSource 分流）：
 *  - FDE 技能（默认 'fde'）：GET /api/fde/skills/tool-picker?type=&keyword=&positionId=（四类 tab，数据表传 positionId 防越权）。
 *  - 平台技能（'platform'）：GET /api/fde/platform-skills/tool-picker?type=&keyword=（SYS_CONFIG 门，只 MCP/API，不接 positionId）。
 * 健康态优雅降级：工具无 displayStatus 时统一展示「未检测」占位，不报错。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ArrowLeftBold, ArrowRightBold, Grid } from '@element-plus/icons-vue'
import { listToolPicker } from '@/api/position'
import { platformSkillApi, systemSkillApi } from '@/api/platformSkill'
import { listDataTables, getDataTable } from '@/api/dataTable'
import { healthLabel, healthClass } from '@/utils/positionModel'
import { fieldTypeLabel } from '@/utils/dataTableTypes'
import { TERMS } from '@/utils/skillTerms'
import ReferencedToolsPanel from '@/components/position/ReferencedToolsPanel.vue'

const props = defineProps({
  // 折叠态（true=收起细条 44px / false=展开 320px）。由父级持久化。
  collapsed: { type: Boolean, default: false },
  positionId: { type: [Number, String], default: null },
  // 数据源（V34 切片2 修补）：'fde'（默认，FDE 技能编辑器，四 tab + 走 /fde/skills/tool-picker FDE 门）
  // / 'platform'（平台技能编辑器，只 MCP/API 两 tab + 走 /fde/platform-skills/tool-picker SYS_CONFIG 门，不接 positionId）。
  skillSource: { type: String, default: 'fde' },
  // §12.7：父级合并好的「已引用工具」视图（mergeReferencedView 结果），顶部分区渲染；
  // 定位/移除由本组件 emit 上抛、父级执行（本组件不持有 Milkdown/skillMd/localInsertNames）。
  referencedView: { type: Array, default: () => [] },
  // 只读态（平台技能 Tab 只读详情）：仅保留「本技能已引用」只读分区，整块「选择工具」picker
  //（搜索/Tab/工具卡/插入/拖拽——皆为写入口）v-if 不渲染；ReferencedToolsPanel 也置只读（去移除 X）。
  readonly: { type: Boolean, default: false },
  /**
   * 2026-09-01 PRD 对齐（技能编辑器语境专用，props 驱动、不改岗位工作台现状）：
   * 页签收敛覆写——传入类型码数组（如 ['MCP','API','BIZ_SYSTEM']）即按此渲染页签，
   * 不传（null）保持既有按 skillSource 推导的页签集（岗位工作台四页签 / 平台族两页签）。
   */
  tabs: { type: Array, default: null },
  /**
   * 空态「去连接器接入」链接开关（技能编辑器语境传 true）：
   * 无工具空态改「该类暂无工具，去连接器接入」，链接跳连接器页；默认 false 保持旧文案。
   */
  connectorEmptyLink: { type: Boolean, default: false }
})
const emit = defineEmits(['update:collapsed', 'insert', 'locate', 'remove-ref'])

// V89：'system'（系统默认技能）与 'platform' 同为平台族（只 MCP/API 两 tab、SYS_CONFIG 门），
// tool-picker 按 skillSource 走对应通道前缀（/fde/platform-skills vs /fde/system-skills）。
const isPlatform = computed(() => props.skillSource === 'platform' || props.skillSource === 'system')

// 数据表按岗位隔离：无 positionId（技能未绑定岗位 / 整页编辑游离技能）时「数据表」tab 降级禁用，
// 仅 MCP/API/业务系统可引用（向后兼容：工作台传 positionId 时四 tab 照常可用）。
const tableDisabled = computed(() => props.positionId == null)

// 平台技能无岗位、运行时不可达数据表/业务系统 → 只留 MCP/API 两 tab；FDE 技能四 tab 不变。
// 组②：各 Tab 说人话提示（title 悬浮，面向不懂技术的配置者）。文案复用 utils/skillTerms（单一真相）。
// 2026-09-01：技能编辑器语境经 props.tabs 覆写为 MCP / API / 业务系统 三页签（岗位工作台不传，保持现状）。
const TAB_DEFS = {
  MCP: { type: 'MCP', label: 'MCP', tip: TERMS.mcp },
  API: { type: 'API', label: 'API', tip: TERMS.api },
  TABLE: { type: 'TABLE', label: '数据表', tip: TERMS.table },
  BIZ_SYSTEM: { type: 'BIZ_SYSTEM', label: '业务系统', tip: TERMS.bizSystem }
}
const TABS = computed(() => {
  if (Array.isArray(props.tabs) && props.tabs.length) {
    return props.tabs
      .filter((t) => TAB_DEFS[t])
      .map((t) => ({ ...TAB_DEFS[t], disabled: t === 'TABLE' ? tableDisabled.value : false }))
  }
  return isPlatform.value
    ? [TAB_DEFS.MCP, TAB_DEFS.API]
    : [
        TAB_DEFS.MCP,
        TAB_DEFS.API,
        { ...TAB_DEFS.TABLE, disabled: tableDisabled.value },
        TAB_DEFS.BIZ_SYSTEM
      ]
})

const activeTab = ref('MCP')
// 页签覆写变化时，若当前激活页签已不在集合内则回落到第一个（防止停留在不可见页签上）。
watch(TABS, (list) => {
  if (!list.some((t) => t.type === activeTab.value)) activeTab.value = list[0]?.type || 'MCP'
})

// 选 Tab：禁用项（无岗位的数据表）点击不切换。
function pickTab(t) {
  if (t.disabled) return
  activeTab.value = t.type
}
const keyword = ref('')
const loading = ref(false)
const tools = ref([])
const loadError = ref(false)

async function fetchTools() {
  // 只读态：picker 不渲染，不拉工具清单（无写入口可用）。
  if (props.readonly) {
    tools.value = []
    loadError.value = false
    loading.value = false
    return
  }
  // 数据表 tab 在无岗位时降级：不发查询，置空列表（模板呈现降级说明）。
  if (activeTab.value === 'TABLE' && tableDisabled.value) {
    tools.value = []
    loadError.value = false
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    // 四类 Tab（MCP/API/TABLE/BIZ_SYSTEM）统一走 tool-picker：
    // 后端 ToolPickerService 按 type 返回带正确 code 的工具项（业务系统为 biz__<code>），
    // 与 SkillToolRefSyncService 解析口径严格一致，保证选中插入后保存能进白名单。
    // （此前 BIZ_SYSTEM 特殊调 listBizSystems + bizSystemsToTools，因列表 VO 去 code 后产生 biz__undefined 回归，已归一。）
    const params = { type: activeTab.value }
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    // 数据表按岗位过滤（防越权引用）。平台技能无 TABLE tab，不会进此分支。
    if (activeTab.value === 'TABLE' && props.positionId != null) params.positionId = props.positionId
    // 数据源分流：平台技能走 SYS_CONFIG 门的平台 tool-picker（只 MCP/API，不接 positionId）；
    // FDE 技能走原 FDE 门 tool-picker（四类，TABLE 带 positionId）。
    const data = isPlatform.value
      ? await (props.skillSource === 'system' ? systemSkillApi : platformSkillApi).toolPicker({
          type: params.type,
          ...(params.keyword ? { keyword: params.keyword } : {})
        })
      : await listToolPicker(params)
    tools.value = Array.isArray(data) ? data : data?.items || []
  } catch (e) {
    loadError.value = true
    tools.value = []
  } finally {
    loading.value = false
  }
}

// 展开时拉当前 Tab（收起态不拉，省性能）；切 Tab / 改搜索词时重拉。
watch(
  () => props.collapsed,
  (c) => {
    if (!c) fetchTools()
  },
  { immediate: true }
)
watch(activeTab, () => {
  if (!props.collapsed) fetchTools()
})
// 切岗位时作废表 id 缓存（避免跨岗位 code→id 串扰）。
watch(
  () => props.positionId,
  () => {
    tableIdCache = null
    tableIdCacheKey = null
  }
)

let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (!props.collapsed) fetchTools()
  }, 250)
}
// H7：卸载清理搜索 debounce 定时器，防切技能/离开页时回调打到已销毁组件态。
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
})

function collapse() {
  emit('update:collapsed', true)
}
function expand() {
  emit('update:collapsed', false)
}
function insert(tool) {
  // 同时回传业务名，供编辑器 chip 即时显示「🔧 业务名」（无需等回显）
  emit('insert', tool.code, tool.bizName || tool.name || '')
}

// 数据表 Tab：picker 已按「整表一项」返回（code=table__<tableCode>，业务名=表名），无需再聚合。
// 表结构弹层需要 tableCode，从表级 code 剥前缀还原。
function tableGroupOf(tool) {
  return {
    tableCode: String(tool?.code || '').slice('table__'.length),
    tableName: tool?.bizName || tool?.name || tool?.code || '',
    description: tool?.description || ''
  }
}

/* ============================================================
 * 「查看表结构」弹层（需求 #1）
 *  - tableCode → 表 id 映射：进数据表 Tab 或点击时按需拉一次 listDataTables 并缓存（code→id）；
 *  - 点击某表「表结构」→ 定位 id → getDataTable 拉字段 → el-dialog 展示字段表；
 *  - positionId 为空时数据表 Tab 本就禁用，不会走到此处。
 * ============================================================ */
const structOpen = ref(false)
const structLoading = ref(false)
const structTable = ref(null) // { tableName, tableCode, description, fields:[...] }

// code→id 映射缓存（同一 positionId 内复用，避免每次点击重复拉表清单）。
let tableIdCache = null // Map<tableCode, id> | null（未拉取）
let tableIdCacheKey = null // 缓存所属 positionId（切岗位失效）

async function ensureTableIdMap() {
  const pid = props.positionId
  if (pid == null) return null
  if (tableIdCache && tableIdCacheKey === pid) return tableIdCache
  const data = await listDataTables(pid)
  const list = data?.list || (Array.isArray(data) ? data : [])
  const map = new Map()
  for (const t of list) {
    if (t?.tableCode != null && t?.id != null) map.set(String(t.tableCode), t.id)
  }
  tableIdCache = map
  tableIdCacheKey = pid
  return map
}

async function viewTableStructure(group) {
  if (props.positionId == null || !group?.tableCode) return
  structOpen.value = true
  structLoading.value = true
  structTable.value = {
    tableName: group.tableName || group.tableCode,
    tableCode: group.tableCode,
    description: group.description || '',
    fields: []
  }
  try {
    const map = await ensureTableIdMap()
    const tableId = map?.get(String(group.tableCode))
    if (tableId == null) {
      // 清单里找不到该表 id（理论上不应发生）：保留标题，字段空态兜底。
      structLoading.value = false
      return
    }
    const detail = await getDataTable(props.positionId, tableId)
    // 仅展示业务字段，过滤掉系统字段（如 uid）。
    const fields = (detail?.fields || []).filter((f) => !f?.isSystem)
    structTable.value = {
      tableName: detail?.label || group.tableName || group.tableCode,
      tableCode: detail?.tableCode || group.tableCode,
      description: detail?.description || group.description || '',
      fields
    }
  } catch (e) {
    // 读接口失败由全局拦截器弹 toast；此处关闭弹层避免停留在空 loading。
    structOpen.value = false
  } finally {
    structLoading.value = false
  }
}

function fieldTypeText(t) {
  return fieldTypeLabel(t)
}
</script>

<template>
  <!-- 收起态：44px 细条，仅展开 toggle -->
  <aside v-if="collapsed" class="dock dock-collapsed">
    <button
      type="button"
      class="dock-rail-toggle"
      title="展开工具引用抽屉"
      aria-label="展开工具引用抽屉"
      @click="expand"
    >
      <el-icon><ArrowLeftBold /></el-icon>
      <span class="dock-rail-text">工具</span>
    </button>
  </aside>

  <!-- 展开态：320px 内嵌抽屉 -->
  <aside v-else class="dock dock-expanded">
    <!-- 头部（布局调整 #4）：高度/字号与左侧文件树头部（.ft-head/.ft-head-title）保持一致，去副标题。 -->
    <div class="dock-head">
      <div class="dock-title">工具引用</div>
      <button
        type="button"
        class="dock-collapse"
        title="收起工具引用抽屉"
        aria-label="收起工具引用抽屉"
        @click="collapse"
      >
        <el-icon><ArrowRightBold /></el-icon>
      </button>
    </div>

    <div class="dock-inner">
      <!-- 布局调整 #5：「选择工具」picker 在上（提示语已移除）；只读态整块不渲染（皆为写入口）。 -->
      <template v-if="!readonly">
      <div class="dock-pick-title">选择工具</div>

      <input
        v-model="keyword"
        class="dock-search"
        placeholder="搜 code / 名称…"
        @input="onSearch"
      />

      <div class="dock-tabs">
        <span
          v-for="t in TABS"
          :key="t.type"
          class="dock-tab"
          :class="{ on: activeTab === t.type, disabled: t.disabled }"
          :title="t.disabled ? '该技能未绑定岗位，数据表按岗位隔离，暂不可引用' : t.tip"
          @click="pickTab(t)"
        >
          {{ t.label }}
        </span>
      </div>

      <div v-loading="loading" class="dock-list">
        <!-- 无岗位的数据表降级说明（数据表按岗位隔离，未绑定岗位时无法引用） -->
        <div v-if="activeTab === 'TABLE' && tableDisabled" class="dock-empty">
          该技能未绑定岗位 · 数据表按岗位隔离，暂不可引用<br />
          可在岗位白板里将技能归入某岗位后再引用数据表
        </div>
        <div v-else-if="loadError" class="dock-empty">
          工具清单加载失败 · <span class="dock-retry" @click="fetchTools">重试</span>
        </div>
        <!-- 2026-09-01：技能编辑器语境空态带「去连接器接入」可点击链接（原型 tool-empty）；
             岗位工作台语境保持旧文案不变 -->
        <div v-else-if="!loading && !tools.length && connectorEmptyLink" class="dock-empty">
          该类暂无工具，<router-link class="dock-empty-link" :to="{ name: 'AdminConnector' }">去连接器接入</router-link>
        </div>
        <div v-else-if="!loading && !tools.length" class="dock-empty">
          该类暂无工具 · 去工具管理接入
        </div>

        <!-- 数据表 Tab：整表引用，一张表一张卡，无任何「新增/查询/更新/删除」操作概念——
             插入只把表名放进正文（code=表级 table__<tableCode>），具体操作由 skill 正文定义、运行时按表派生。
             布局与其他工具卡一致（2026-07-08 反馈）：表名 + 表结构图标（紧贴表名，点击看字段），
             「＋ 插入」靠最右；不展示读写操作标识。 -->
        <template v-else-if="activeTab === 'TABLE'">
          <div
            v-for="tool in tools"
            :key="tool.code"
            class="dgroup"
            :title="tool.code"
          >
            <div class="dgroup-head">
              <span class="dgroup-name">{{ tool.bizName || tool.name || tool.code }}</span>
              <button
                type="button"
                class="dgroup-struct"
                title="查看表结构"
                aria-label="查看表结构"
                @click="viewTableStructure(tableGroupOf(tool))"
              >
                <el-icon><Grid /></el-icon>
              </button>
              <span class="dcard-sp"></span>
              <span class="dtool-insert" @click="insert(tool)">＋ 插入</span>
            </div>
            <div v-if="tool.description" class="dgroup-desc">{{ tool.description }}</div>
          </div>
        </template>

        <!-- 其余 Tab（MCP/API/业务系统）：平铺工具卡。压缩卡高（2026-07-08 反馈）：
             健康标识紧贴工具名，「插入」按钮靠最右同排，描述在下，去掉独立底部操作行。 -->
        <div
          v-for="tool in tools"
          v-else
          :key="tool.code"
          class="dtool"
          :title="tool.code"
        >
          <div class="dtool-top">
            <span class="dtool-name">{{ tool.bizName || tool.name || tool.code }}</span>
            <span class="health" :class="`h-${healthClass(tool.displayStatus || tool.checkStatus)}`">
              <span class="d"></span>{{ healthLabel(tool.displayStatus || tool.checkStatus) }}
            </span>
            <!-- 写类标识收成图标（压缩行宽给工具名让位），悬浮出全文 -->
            <span v-if="tool.requiresConfirmation" class="wflag" title="写类工具，执行前需确认">⚠</span>
            <span class="dcard-sp"></span>
            <span class="dtool-insert" @click="insert(tool)">＋ 插入</span>
          </div>
          <div v-if="tool.description" class="dtool-desc">{{ tool.description }}</div>
        </div>
      </div>
      <div class="dock-sep"></div>
      </template>

      <!-- 布局调整 #5：「本技能已引用」分区在下（提示语已移除）。定位/移除 emit 上抛，
           父级操作 Milkdown/skillMd；只读态去移除 X -->
      <ReferencedToolsPanel
        class="dock-ref"
        :referenced-view="referencedView"
        :readonly="readonly"
        @locate="(r) => emit('locate', r)"
        @remove-ref="(r) => emit('remove-ref', r)"
      />
    </div>
  </aside>

  <!-- 查看表结构弹层（需求 #1）：字段名 / 编码 / 类型 / 必填 / 描述 -->
  <el-dialog
    v-model="structOpen"
    :title="structTable ? `表结构 · ${structTable.tableName}` : '表结构'"
    width="min(640px, 92vw)"
    append-to-body
    class="struct-dialog"
  >
    <div v-if="structTable" class="struct-head">
      <span class="struct-code">{{ structTable.tableCode }}</span>
      <span v-if="structTable.description" class="struct-desc">{{ structTable.description }}</span>
    </div>
    <div v-loading="structLoading" class="struct-body">
      <el-table
        v-if="structTable && structTable.fields.length"
        :data="structTable.fields"
        size="small"
        border
        max-height="420"
      >
        <el-table-column prop="label" label="字段名" min-width="120" show-overflow-tooltip />
        <el-table-column prop="fieldCode" label="字段编码" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="struct-fcode">{{ row.fieldCode }}</code>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="92">
          <template #default="{ row }">{{ fieldTypeText(row.fieldType) }}</template>
        </el-table-column>
        <el-table-column label="必填" width="62" align="center">
          <template #default="{ row }">
            <span :class="row.required ? 'struct-req' : 'struct-opt'">{{ row.required ? '是' : '否' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="fieldDesc" label="描述" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.fieldDesc">{{ row.fieldDesc }}</span>
            <span v-else class="struct-empty-cell">—</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else-if="!structLoading" class="struct-empty">该表暂无业务字段</div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* 内嵌抽屉（无 fixed / 无 teleport / 无 shadow）：高度铺满第三栏，宽度由父级 grid 列控制 */
.dock {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-soft);
  overflow: hidden;
}

/* 收起态细条 */
.dock-collapsed {
  align-items: center;
  padding-top: var(--space-3);
}
.dock-rail-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 32px;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.dock-rail-toggle:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.dock-rail-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.dock-rail-text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  font-size: var(--fs-xs);
}

/* 头部（#4）：与左侧文件树头部同规格（padding/字号对齐 .ft-head/.ft-head-title），副标题已移除 */
.dock-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.dock-title {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
}
.dock-collapse {
  margin-left: auto;
  cursor: pointer;
  color: var(--c-text-faint);
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  display: inline-flex;
}
.dock-collapse:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.dock-collapse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.dock-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-4) var(--space-4);
}
/* #5：已引用分区（底部）+ 与上方 picker 的分隔。
   固定高度（2026-07-08 反馈：较原 38% 上限加大且不随内容伸缩，picker 区域稳定），引用多时内滚。 */
.dock-ref {
  height: 46%;
  flex-shrink: 0;
  overflow: auto;
}
.dock-sep {
  height: 1px;
  background: var(--border-soft);
  margin: var(--space-3) 0;
  flex-shrink: 0;
}
.dock-pick-title {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
.dock-search {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--border-base) inset;
  border: none;
  outline: none;
  color: var(--c-text);
  font-size: var(--fs-sm);
  margin-bottom: var(--space-3);
}
.dock-search:focus {
  box-shadow: 0 0 0 1px var(--c-accent) inset, 0 0 0 3px var(--c-accent-soft);
}
.dock-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
}
.dock-tab {
  padding: 3px 11px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  color: var(--c-text-muted);
  cursor: pointer;
}
.dock-tab.on {
  background: var(--bg-selected);
  color: var(--c-accent);
  border-color: transparent;
  font-weight: var(--fw-medium);
}
/* 数据表 tab 在无岗位时降级禁用：灰显、不可点 */
.dock-tab.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dock-list {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 60px;
}
.dock-empty {
  text-align: center;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
  padding: var(--space-6) 0;
}
.dock-retry {
  color: var(--c-accent);
  cursor: pointer;
  text-decoration: underline;
}
/* 空态「去连接器接入」链接（技能编辑器语境，原型 .tool-empty-link） */
.dock-empty-link {
  color: var(--c-accent);
  text-decoration: none;
}
.dock-empty-link:hover {
  text-decoration: underline;
}
.dtool {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface);
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.dtool:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.dtool-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 压缩卡高：名称不再撑满整行（健康标识紧贴其后），超长省略；右侧弹性缝把「插入」推到最右 */
.dtool-name {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcard-sp {
  flex: 1;
}
.dtool-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-top: 2px;
}
.health {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  font-weight: var(--fw-medium);
  flex-shrink: 0;
}
.health .d {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.h-ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.h-ok .d {
  background: var(--c-success);
}
.h-bad {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.h-bad .d {
  background: var(--c-danger);
}
.h-unknown {
  background: var(--bg-active);
  color: var(--c-text-muted);
}
.h-unknown .d {
  background: var(--c-text-faint);
}
.h-off {
  background: transparent;
  color: var(--c-text-faint);
  border: 1px solid var(--border-base);
}
.h-off .d {
  background: var(--c-text-faint);
}
.wflag {
  font-size: 11px;
  color: var(--c-warning);
  background: var(--c-warning-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.dtool-insert {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
  font-weight: var(--fw-medium);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-accent-soft);
  background: var(--c-accent-soft);
}
.dtool-insert:hover {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}

/* ---------- 数据表 Tab 按表聚合：分组卡 + 平铺操作 pill ---------- */
.dgroup {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface);
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
/* 与 .dtool:hover 同口径的轻 hover 反馈，统一「卡可交互」暗示、缓解切 Tab 密度跳变 */
.dgroup:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.dgroup-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* 压缩卡高：表名不再撑满整行（写类标识紧贴其后），超长省略 */
.dgroup-name {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
}
/* 「查看表结构」纯图标按钮（紧贴表名，2026-07-08 反馈）：默认中性，hover 提色，不抢表名视觉 */
.dgroup-struct {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.dgroup-struct:hover {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}
.dgroup-struct:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
/* 表描述：表名下、操作 pill 上，口径同 MCP/API 卡的 .dtool-desc */
.dgroup-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-top: 4px;
  line-height: 1.5;
}
/* 整表引用：操作细分 pill（.dgroup-ops/.dop）与底部操作条（.dtool-foot）均已移除，
   「表结构/插入」并入 .dgroup-head 行内（.dcard-sp 推齐） */
</style>

<!-- 查看表结构弹层 teleport 到 body，scoped 够不到，用全局类（限定 .struct-dialog 作用域）写样式，
     全部走 Notion 语义令牌，双主题级联自动适配。 -->
<style>
.struct-dialog .struct-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--space-3);
}
.struct-dialog .struct-code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  padding: 1px 7px;
  border-radius: var(--radius-sm);
}
.struct-dialog .struct-desc {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.5;
}
.struct-dialog .struct-body {
  min-height: 80px;
}
.struct-dialog .struct-fcode {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.struct-dialog .struct-req {
  color: var(--c-warning);
  font-weight: var(--fw-medium);
}
.struct-dialog .struct-opt {
  color: var(--c-text-faint);
}
.struct-dialog .struct-empty-cell {
  color: var(--c-text-faint);
}
.struct-dialog .struct-empty {
  text-align: center;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
  padding: var(--space-6) 0;
}
</style>
