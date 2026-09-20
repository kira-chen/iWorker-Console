<script setup>
/**
 * 知识库管理子页（AdminKnowledgeBase 容器 ?tab=kb）。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§三 + 交互原型 renderKbList 最终覆写态对齐重排。
 *
 * 【筛选】关键词（名称模糊）/ 知识库类型（企业·专家·岗位全称）/ 状态（未发布·审核中·已发布）+ 查询。
 * 【列】知识库（名称+描述）/ 类型 / 数据源（上传 ×N / API ×N / MCP ×N）/ 文档数 / 可见范围 / 状态 / 操作。
 * 【操作矩阵】（md §三.2）：查看·编辑固定；审核中+撤回；未发布+发布·删除；已发布+停用·检索测试。
 *   发布 / 停用 / 撤回 / 删除均出确认弹窗，标题·正文·按钮·toast 逐字照 md（KB_ACTION_CONFIRMS）。
 *
 * 【跨模块入口】（md §三.8，岗位侧跳转由并行批次实现，本页只保证 query 生效）：
 *   ?tab=kb&positionId=xx[&positionName=xx]  → 列表筛选切「岗位知识库」，且新建时类型锁岗位、可见范围锁该岗位
 *   &action=create                            → 打开新建抽屉（配合 positionId 即岗位上下文新建）
 *   &kbId=xx&action=view|edit|search          → 打开对应的查看 / 编辑抽屉、检索测试弹窗
 *   action / kbId 消费一次后从地址栏清除（positionId 保留，承载上下文）。
 */
import { ref, watch, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import KnowledgeBaseEditor from '@/components/admin/KnowledgeBaseEditor.vue'
import KnowledgeSearchDialog from '@/components/admin/KnowledgeSearchDialog.vue'
import { iconIsUrl } from '@/utils/iconDisplay'
import {
  listKnowledgeBases,
  getKnowledgeBase,
  publishKnowledgeBase,
  delistKnowledgeBase,
  withdrawKnowledgeBase,
  deleteKnowledgeBase
} from '@/api/knowledgeBase'
import { useAdminList } from '@/composables/useAdminList'
import { COL, opsWidth } from '@/utils/tableLayout'
import {
  KB_TYPE_FILTER_OPTIONS,
  KB_TYPE_LABELS,
  STATUS_OPTIONS,
  KB_ACTION_CONFIRMS,
  stateMeta,
  isPending,
  isOffline,
  isOnline,
  scopeText,
  sourcesText,
  hasUploadSource
} from '@/utils/knowledgeBaseMeta'
import { parseKbQuery, KB_QUERY } from '@/utils/knowledgeDeepLink'

const route = useRoute()
const router = useRouter()

const keyword = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
/** 岗位上下文（md §三.8）：来自路由 query，锁定新建抽屉的类型与可见范围。 */
const positionCtx = ref(null)

const list = useAdminList(listKnowledgeBases, {
  params: () => ({ keyword: keyword.value.trim(), kbType: typeFilter.value, status: statusFilter.value })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty, reload, search } = list

const editorVisible = ref(false)
const editingId = ref(null)
const editorMode = ref('edit') // 'edit' | 'view'
const searchVisible = ref(false)
const searchTarget = ref(null)
/** 防重复提交（md §八.2）：行内动作在途时禁用该行按钮。 */
const rowBusy = ref('')

function openCreate() {
  editingId.value = null
  editorMode.value = 'edit'
  editorVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  editorMode.value = 'edit'
  editorVisible.value = true
}
function openView(row) {
  editingId.value = row.id
  editorMode.value = 'view'
  editorVisible.value = true
}
function openSearch(row) {
  searchTarget.value = row
  searchVisible.value = true
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString('en-US')
}

/* ---------- 行内操作（确认弹窗文案逐字照 md §三.4.3） ---------- */
async function confirmThen(key, fn, row) {
  const c = KB_ACTION_CONFIRMS[key]
  try {
    await ElMessageBox.confirm(c.content, c.title, {
      type: 'warning',
      confirmButtonText: c.confirmText,
      cancelButtonText: '取消'
    })
  } catch (e) {
    return
  }
  rowBusy.value = row.id
  try {
    await fn(row.id)
    ElMessage.success(c.toast)
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    rowBusy.value = ''
  }
}
const doPublish = (row) => confirmThen('publish', publishKnowledgeBase, row)
const doDelist = (row) => confirmThen('delist', delistKnowledgeBase, row)
const doWithdraw = (row) => confirmThen('withdraw', withdrawKnowledgeBase, row)
const doDelete = (row) => confirmThen('remove', deleteKnowledgeBase, row)

/* ---------- 跨模块 query 消费（md §三.8） ---------- */
let queryConsumed = false
async function consumeRouteQuery() {
  // 键名单一来源 utils/knowledgeDeepLink（发送端 PositionDetailTabs / ExpertEditor 同源；2026-09-08 C-H2 修对齐）
  const { action, kbId, positionId, positionName } = parseKbQuery(route.query)
  if (positionId) {
    positionCtx.value = { id: positionId, name: positionName }
    // 从岗位详情跳入：列表筛选自动切为岗位类型（md §三.8 注）
    typeFilter.value = 'POSITION'
  }
  if (queryConsumed) return
  queryConsumed = true
  if (!action) return
  if (action === 'create') {
    openCreate()
  } else if (kbId && (action === 'view' || action === 'edit')) {
    editingId.value = kbId
    editorMode.value = action
    editorVisible.value = true
  } else if (kbId && action === 'search') {
    try {
      searchTarget.value = await getKnowledgeBase(kbId)
      searchVisible.value = true
    } catch (e) {
      ElMessage.error(e?.message || '知识库不存在')
    }
  }
  // action / kbId 一次性消费后清掉，避免刷新重复触发（tab / positionId 保留）
  const { [KB_QUERY.ACTION]: _a, [KB_QUERY.KB_ID]: _k, ...rest } = route.query
  router.replace({ query: rest })
}

/* ---------- 查询条件与分页位置的刷新保持（md §二.2） ----------
 * 落在 URL query 上（本页本就用 query 传 tab/positionId，同一机制不另造存储）：
 * 刷新即从 query 还原，改筛选/翻页时回写。positionId 带来的类型锁定优先级更高，
 * 故 restore 放在 consumeRouteQuery 之后执行，不覆盖它设的 typeFilter。 */
const STATE_KEYS = { KW: 'kw', TYPE: 'kbType', STATUS: 'st', PAGE: 'p' }
// 入口键：访问审计【查看】等跨模块跳转统一带 query.keyword（其余列表页同款）。本页自己的状态键是 kw，
// 故 keyword 只在首次还原时作 kw 的后备；回写时清掉，避免地址栏同时挂着 kw 与 keyword。
const ENTRY_KW_KEY = 'keyword'
function restoreListState() {
  // 部分单测不挂路由，取不到 route 时静默跳过状态保持
  const q = route?.query
  if (!q) return
  const kwIn = q[STATE_KEYS.KW] || q[ENTRY_KW_KEY]
  if (kwIn) keyword.value = String(kwIn)
  // 类型：positionId 场景已锁 POSITION，不再被 query 覆盖
  if (q[STATE_KEYS.TYPE] && !positionCtx.value) typeFilter.value = String(q[STATE_KEYS.TYPE])
  if (q[STATE_KEYS.STATUS]) statusFilter.value = String(q[STATE_KEYS.STATUS])
  const p = Number(q[STATE_KEYS.PAGE])
  if (Number.isFinite(p) && p > 0) page.value = p
}
function syncListState() {
  if (!route?.query || !router) return
  const next = { ...route.query }
  // 顺手清掉另一子页（数据源）的状态键：两个子页共用同一条 URL，切页签时对方的键会留在地址栏，
  // 分享出去看着像是本页带了筛选。功能上互不影响（各自只读自己的键），纯粹是不留垃圾。
  for (const k of ['srcKw', 'srcType', 'srcSt', 'srcP']) delete next[k]
  delete next[ENTRY_KW_KEY]
  const put = (k, v) => {
    if (v === '' || v == null) delete next[k]
    else next[k] = String(v)
  }
  put(STATE_KEYS.KW, keyword.value.trim())
  put(STATE_KEYS.TYPE, typeFilter.value)
  put(STATE_KEYS.STATUS, statusFilter.value)
  put(STATE_KEYS.PAGE, page.value > 1 ? page.value : '')
  router.replace({ query: next })
}
watch([keyword, typeFilter, statusFilter, page], syncListState)

onMounted(() => {
  consumeRouteQuery()
  restoreListState()
  reload()
})
// 数据源子页里改了名称 / 启停会影响本页展示，切回时刷新
onActivated(reload)
</script>

<template>
  <div class="list-page">
    <ListToolbar>
      <el-input
        v-model="keyword"
        placeholder="搜索知识库名称"
        clearable
        class="lt-search"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <!-- md §三.1 筛选项首项为显式「全部」：空值即不筛选，与点 × 清除等价，但下拉里看得见 -->
      <el-select v-model="typeFilter" placeholder="全部类型" clearable class="lt-filter" @change="search">
        <el-option label="全部类型" value="" />
        <el-option v-for="o in KB_TYPE_FILTER_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部状态" clearable class="lt-filter" @change="search">
        <el-option label="全部状态" value="" />
        <el-option v-for="o in STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="search">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建知识库
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="keyword || typeFilter || statusFilter ? '暂无符合条件的知识库' : '还没有知识库 · 点「新建知识库」创建第一个'"
        @retry="reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column label="知识库" :min-width="COL.NAME_MIN">
            <template #default="{ row }">
              <!-- 图标 + 名称行（名称点击进入编辑或查看，md §三.2）：审核中锁定 → 查看，其余 → 编辑 -->
              <div class="kb-name-cell">
                <span class="kb-cell-icon" :class="{ 'is-empty': !row.icon }">
                  <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="kb-cell-icon-img" />
                  <span v-else-if="row.icon">{{ row.icon }}</span>
                </span>
                <div class="kb-cell-text">
                  <span class="kb-name kb-link" @click="isPending(row) ? openView(row) : openEdit(row)">{{ row.name }}</span>
                  <div v-if="row.description" class="kb-desc">{{ row.description }}</div>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="类型" :width="COL.TAG" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <el-tag size="small" type="info" effect="plain">{{ KB_TYPE_LABELS[row.kbType] || row.kbType }}</el-tag>
            </template>
          </el-table-column>

          <!-- 数据源：按已启用类型汇总「上传 ×N / API ×N / MCP ×N」；无引用显示 —（md §三.2） -->
          <el-table-column label="数据源" :width="160">
            <template #default="{ row }">
              <span v-if="sourcesText(row)">{{ sourcesText(row) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 文档数：仅引用上传数据源时展示；其余 —（md §三.2） -->
          <el-table-column label="文档数" :width="COL.COUNT" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <span v-if="hasUploadSource(row)" class="kb-num">{{ fmtCount(row.docCount) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <el-table-column label="可见范围" :min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ scopeText(row) }}</template>
          </el-table-column>

          <el-table-column label="状态" :width="COL.STATUS" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
            </template>
          </el-table-column>

          <!-- 操作矩阵（md §三.2）：查看·编辑固定；审核中+撤回；未发布+发布·删除；已发布+停用·检索测试 -->
          <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" size="small" :disabled="rowBusy === row.id" @click="openView(row)">查看</el-button>
                <el-button link type="primary" size="small" :disabled="rowBusy === row.id" @click="openEdit(row)">编辑</el-button>
                <template v-if="isPending(row)">
                  <el-button link type="warning" size="small" :disabled="rowBusy === row.id" @click="doWithdraw(row)">撤回</el-button>
                </template>
                <template v-else-if="isOffline(row)">
                  <el-button link type="primary" size="small" :disabled="rowBusy === row.id" @click="doPublish(row)">发布</el-button>
                  <el-button link type="danger" size="small" :disabled="rowBusy === row.id" @click="doDelete(row)">删除</el-button>
                </template>
                <template v-else-if="isOnline(row)">
                  <el-button link type="warning" size="small" :disabled="rowBusy === row.id" @click="doDelist(row)">停用</el-button>
                  <el-button link type="primary" size="small" :disabled="rowBusy === row.id" @click="openSearch(row)">检索测试</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination :total="total" v-model:page="page" v-model:page-size="pageSize" @change="reload" />

    <KnowledgeBaseEditor
      v-model:visible="editorVisible"
      :kb-id="editingId"
      :mode="editorMode"
      :position-lock="positionCtx"
      @saved="reload"
      @changed="reload"
    />
    <KnowledgeSearchDialog v-model:visible="searchVisible" :kb="searchTarget" />
  </div>
</template>

<style scoped>
.kb-name-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
/* 图标块照 BizSystems/MCP/API 统一口径：26px、圆角 5、浅灰底 */
.kb-cell-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: var(--c-bg-hover, #f5f5f5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  overflow: hidden;
  margin-top: 1px;
}
.kb-cell-icon.is-empty {
  background: transparent;
}
.kb-cell-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.kb-cell-text {
  min-width: 0;
}
.kb-name {
  color: var(--c-text-strong);
}
.kb-link {
  cursor: pointer;
}
.kb-link:hover {
  color: var(--c-accent);
}
.kb-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.kb-num {
  font-variant-numeric: tabular-nums;
}
</style>
