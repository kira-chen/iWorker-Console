<script setup>
/**
 * 运行规格列表页（04运行 › 运行规格，2026-09-02 启动轮）。
 *
 * 基准 = 负责人提供的交互截图（04运行 无 prd md 与原型 render）；标准件拼装：
 * PageHeader + 说明条（D17 口径）+ ListToolbar（右侧新建）+ ListStates + el-table
 * + 底部汇总 + RuntimeSpecEditor 抽屉。岗位批量继承，个人配置覆盖，默认规格兜底。
 *
 * 2026-09-12 对齐 md 运行规格（审计 K30 ①②③）：
 *  ① §三.3.6 L222 默认规格【删除】置灰并提示「默认运行规格用于平台兜底，不能删除」（悬停 title）；
 *  ② §二.3 L110 无查询结果时保留查询条件并提供【清空筛选】；
 *  ③ §三.1 L123-126 列格式「2 核 / 4 Gi」「20 Gi」「10 分钟」「20 分钟」；最大存活 md 未给小时写法，按同款「24 小时」。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import RuntimeSpecEditor from '@/components/admin/RuntimeSpecEditor.vue'
import RuntimeSpecUserDialog from '@/components/admin/RuntimeSpecUserDialog.vue'
import { listRuntimeSpecs, deleteRuntimeSpec } from '@/api/runtimeSpec'
import { useAdminList } from '@/composables/useAdminList'
// 列宽单一真相源：时间列改用共享 COL.TIME（本页原为硬编码 132px，放不下完整时间戳）
import { COL } from '@/utils/tableLayout'
import '@/assets/connector.css'

const route = useRoute()
const query = reactive({ keyword: '', usage: '', sortOrder: 'descending' })
const list = useAdminList(listRuntimeSpecs, { pageSize: 10, params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

const hasFilter = computed(() => !!(query.keyword.trim() || query.usage))
const emptyText = computed(() => hasFilter.value
  ? '没有符合条件的运行规格'
  : '还没有运行规格 · 点「新建规格」创建第一个')

let keywordTimer = null
watch(() => query.keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(reload, 300)
})
onBeforeUnmount(() => {
  if (keywordTimer) clearTimeout(keywordTimer)
})

// 底部汇总（mock 出参 summary；读失败降级隐藏）
const summary = ref(null)
async function loadSummary() {
  try {
    const data = await listRuntimeSpecs()
    summary.value = data?.summary || null
  } catch (e) {
    summary.value = null
  }
}

function refresh() {
  fetchList()
  loadSummary()
}

function toggleSortOrder() {
  query.sortOrder = query.sortOrder === 'descending' ? 'ascending' : 'descending'
  reload()
}

const sortArrow = computed(() => query.sortOrder === 'descending' ? '↓' : '↑')

// 【清空筛选】（md §二.3 L110）：清空关键词与使用状态后按默认条件重查
function clearFilters() {
  query.keyword = ''
  query.usage = ''
  reload()
}

// 默认规格【删除】置灰的悬停提示（md §三.3.6 L222）
const DEFAULT_DELETE_TIP = '默认运行规格用于平台兜底，不能删除'

onMounted(() => {
  if (route.query.keyword) query.keyword = route.query.keyword
  refresh()
})

/* ---------- 抽屉（新建 / 编辑共用 RuntimeSpecEditor） ---------- */
const editorVisible = ref(false)
const editingId = ref(null)
const editorReadonly = ref(false)

function openCreate() {
  editingId.value = null
  editorReadonly.value = false
  editorVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  editorReadonly.value = false
  editorVisible.value = true
}
function openView(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorVisible.value = true
}

/* ---------- 配置范围（岗位在编辑抽屉维护；弹窗处理个人例外） ---------- */
const userDialogVisible = ref(false)
const assigningSpec = ref(null)
function openUsers(row) {
  assigningSpec.value = { ...row }
  userDialogVisible.value = true
}

/* ---------- 删除（护栏拦截 → 提示窗；可删 → 危险确认） ---------- */
const busyId = ref(null)

async function remove(row) {
  if (busyId.value != null) return
  let block = ''
  if (row.isDefault) block = `${DEFAULT_DELETE_TIP}。`
  else if (row.positionCount > 0) block = `该规格已配置给 ${row.positionCount} 个岗位（${row.positionNames.join('、')}），请先解除岗位配置。`
  else if (row.directUsers.length > 0) block = `该规格存在 ${row.directUsers.length} 个个人配置或待审批申请，请先处理后再删除。`
  if (block) {
    ElMessageBox.alert(
      block,
      '无法删除规格',
      { confirmButtonText: '知道了', type: 'warning' }
    ).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除后规格「${row.name}」将不可再配置给岗位或用户，已运行实例不受影响。确认删除？`,
      '删除规格',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await deleteRuntimeSpec(row.id)
    ElMessage.success('规格已删除')
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败，请稍后重试')
  } finally {
    busyId.value = null
  }
}

/* ---------- 展示派生 ---------- */
// 在用用户悬停名单（含审批态后缀）
function usedTip(row) {
  if (!row.usedCount) return ''
  return row.effectiveUsers
    .map((u) => `${u.name}（${u.source === 'USER' ? '个人配置' : u.source === 'POSITION' ? `岗位 · ${u.positionName}` : '平台默认'}）`)
    .join('、')
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="运行规格" subtitle="定义标准运行环境，通过岗位批量配置，并支持个人按需申请" />

    <!-- 说明条（D17 口径）：能力边界说明是 FDE 唯一可见内容；短期版本按用户分配 Pod -->
    <div class="rs-note">
      生效优先级为<b>个人配置 ＞ 岗位规格 ＞ 平台默认</b>。无岗位或岗位未配置专属规格的用户自动使用默认规格；所有个人申请统一由「05 治理」审批。
    </div>

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索规格名称或能力边界说明"
        clearable
        class="lt-search"
        @keyup.enter="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="query.usage"
        placeholder="全部使用状态"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option label="正在使用" value="used" />
        <el-option label="暂无用户使用" value="unused" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建规格</el-button>
      </template>
    </ListToolbar>

    <div class="rs-card">
      <div class="rs-card-title">运行规格模板</div>
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="emptyText"
        @retry="refresh"
      >
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
        >
          <!-- 规格：名称 + 第二行能力边界说明（截图两行式主列） -->
          <el-table-column label="规格" min-width="210">
            <template #default="{ row }">
              <div class="rs-name">{{ row.name }} <StatusTag v-if="row.isDefault" type="accent">默认</StatusTag></div>
              <div class="rs-desc" :title="row.boundaryDesc">{{ row.boundaryDesc }}</div>
            </template>
          </el-table-column>
          <!-- 列格式照 md §三.1 L123-127（2026-09-12 审计 K30③）：「2 核 / 4 Gi」「20 Gi」「10 分钟」「20 分钟」「不限 / 24 小时」 -->
          <el-table-column label="CPU / 内存" width="112" header-class-name="rs-nowrap-header">
            <template #default="{ row }">
              <span class="rs-muted rs-nowrap">{{ row.cpu }} 核 / {{ row.memoryGi }} Gi</span>
            </template>
          </el-table-column>
          <el-table-column label="临时存储" width="92" header-class-name="rs-nowrap-header">
            <template #default="{ row }"><span class="rs-muted rs-nowrap">{{ row.diskGi }} Gi</span></template>
          </el-table-column>
          <el-table-column label="就绪超时" width="92" header-class-name="rs-nowrap-header">
            <template #default="{ row }"><span class="rs-muted rs-nowrap">{{ row.readinessTimeoutMin }} 分钟</span></template>
          </el-table-column>
          <el-table-column label="空闲回收" width="92" header-class-name="rs-nowrap-header">
            <template #default="{ row }"><span class="rs-muted rs-nowrap">{{ row.idleRecycleMin }} 分钟</span></template>
          </el-table-column>
          <el-table-column label="最大存活" width="100" align="center" header-class-name="rs-nowrap-header">
            <template #default="{ row }"><span class="rs-nowrap">{{ row.maxLifetimeHours === 0 ? '不限' : `${row.maxLifetimeHours} 小时` }}</span></template>
          </el-table-column>
          <el-table-column label="适用岗位" width="108">
            <template #default="{ row }">
              <StatusTag v-if="row.isDefault" type="accent">默认</StatusTag>
              <span v-else-if="row.positionCount" class="rs-muted" :title="row.positionNames.join('、')">{{ row.positionNames.join('、') }}</span>
              <span v-else class="rs-faint">未指定</span>
            </template>
          </el-table-column>
          <el-table-column label="用户申请" width="108">
            <template #default="{ row }">
              <StatusTag :type="row.allowUserApply ? 'warning' : 'info'">
                {{ row.allowUserApply ? '开放申请' : '关闭申请' }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="生效用户" width="106">
            <template #default="{ row }">
              <span class="rs-used-cell" :title="usedTip(row)">
                <span>{{ row.usedCount }}</span>
              </span>
            </template>
          </el-table-column>
          <!-- 2026-09-11 补 col-nowrap + 宽度 132→COL.TIME(168)：本列用自定义表头（无 label）、
               宽度也是页内硬编码，09-11 那轮按 COL.* 常量扫「定类型字段」时整列漏掉，
               导致时间值在 132px 里折成「2026-08-30 / 14:12」两行——时间断行即读不出分钟。 -->
          <el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #header>
              <button type="button" class="time-sort" @click="toggleSortOrder">
                最近更新时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }"><span class="rs-muted">{{ row.updatedAt }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="224" fixed="right" header-class-name="rs-nowrap-header">
            <template #default="{ row }">
              <div class="rs-actions">
                <el-button link type="primary" @click="openView(row)">查看</el-button>
                <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button link type="primary" @click="openUsers(row)">配置范围</el-button>
                <!-- 默认规格：置灰 + 悬停提示（md §三.3.6 L222，K30①）；禁用钮不收鼠标事件，title 挂在外层 span -->
                <span class="rs-del-wrap" :title="row.isDefault ? DEFAULT_DELETE_TIP : undefined">
                  <el-button link type="danger" :disabled="row.isDefault" :loading="busyId === row.id" @click="remove(row)">删除</el-button>
                </span>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <!-- 底部：汇总行单独一行 + 标准分页（2026-09-11 拆开）。
             原为「汇总 + 弹簧 + 分页」同一行 flex，会把分页条挤到右半边（实测左边界 1010px，
             其余页 239px），与全站「左总数 / 中页码 / 右工具」三段式不一致——
             即负责人报的「各列表页翻页区位置不统一」。汇总信息本身保留，仅换行摆放。 -->
        <div v-if="summary" class="rs-foot">
          <span class="rs-foot-sum">
            {{ summary.specCount }} 个规格 · {{ summary.positionCount }} 个岗位已配置 · {{ summary.userCount }} 个用户有生效规格
          </span>
        </div>
      </ListStates>
      <!-- 无查询结果：保留查询条件并提供【清空筛选】（md §二.3 L110，K30②）；ListStates 空态无动作插槽，故紧随其后 -->
      <div v-if="isEmpty && hasFilter && !loading && !loadError" class="rs-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>
    <!-- 分页条置于卡片之外（2026-09-11 全站统一，见 ListPagination 注释） -->
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="fetchList" />

    <RuntimeSpecEditor
      v-model:visible="editorVisible"
      :spec-id="editingId"
      :readonly="editorReadonly"
      @saved="refresh"
    />
    <RuntimeSpecUserDialog
      v-model:visible="userDialogVisible"
      :spec="assigningSpec"
      @saved="refresh"
    />
  </div>
</template>

<style scoped>
/* 说明条：信息级提示（承接截图顶部 note 形态，用站内令牌） */
.rs-note {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--c-success);
  border-radius: var(--radius-sm);
}
.rs-note b {
  color: var(--c-text-strong);
}
.rs-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  overflow: hidden;
}
.rs-card-title {
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  border-bottom: 1px solid var(--border-soft);
}
.rs-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.rs-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-muted {
  color: var(--c-text-muted);
}
.rs-faint { color: var(--c-text-faint); }
.rs-used-cell {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.time-sort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--c-text-base);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: color 0.2s;
}
.time-sort:hover {
  color: var(--c-accent);
}
.time-sort-arrow {
  font-size: 12px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}
.rs-actions {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
}
/* 删除钮外层（承载默认规格的 title 提示）：与相邻 link 按钮同样左距，视觉与其余三钮一致 */
.rs-del-wrap {
  display: inline-flex;
  margin-left: 12px;
}
.rs-del-wrap .el-button {
  margin-left: 0;
}
.rs-nowrap {
  white-space: nowrap;
}
/* 无查询结果下的【清空筛选】：空态块下方居中（md §二.3 L110） */
.rs-empty-actions {
  display: flex;
  justify-content: center;
  padding: 0 var(--space-4) var(--space-5);
  margin-top: calc(-1 * var(--space-6));
}
:deep(.rs-nowrap-header .cell) {
  white-space: nowrap;
  word-break: keep-all;
}
/* 汇总行（2026-09-11 起不再与分页条同行，见模板注释） */
.rs-foot {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-soft);
}
.rs-foot-sum {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rs-foot-sp {
  flex: 1;
}
</style>
