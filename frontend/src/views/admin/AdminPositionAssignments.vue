<script setup>
/**
 * 岗位管理页（2026-09-15 合并改版：原「用户岗位管理 / 岗位申请审批」双页签合并为单页面）。
 *
 * 新流程：用户端未绑定时可提交「申请岗位」请求（不指定具体岗位）；
 * 管理端在此页统一查看所有用户绑定情况，分配岗位或处理待分配申请。
 *
 * 有待分配申请的用户在「绑定岗位」列显示「待分配」橙色标签；
 * 工具栏「待分配申请」按钮（含数量徽标）点击后仅展示此类用户，再次点击还原全部。
 * 分配完成后若该用户有待分配申请，自动调 markApplicationAssigned 留痕，
 * 并回到全量列表将该用户置顶高亮。
 *
 * 查询区行为（沿用原 md §3.1 口径）：搜索停顿 220ms 自动刷新不重置分页；
 * 状态切换即刷新不重置分页；【查询】按钮回第 1 页。
 */
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import UserPositionEditDialog from '@/components/admin/UserPositionEditDialog.vue'

import {
  listPositionAssignments,
  countPendingApplications,
  markApplicationAssigned,
  setUserPosition
} from '@/api/positionAssignment'
import { listPositions } from '@/api/position'
import '@/assets/connector.css'
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

/* ---------- 待分配数量（工具栏筛选按钮徽标） ---------- */
const pendingCount = ref(0)

async function refreshPendingCount() {
  try {
    const data = await countPendingApplications()
    pendingCount.value = Number(data?.count) || 0
  } catch (e) {
    /* 保持旧值，不阻断页面 */
  }
}

/* ---------- 查询区 ---------- */
const query = reactive({ keyword: '', status: '', hasPendingRequest: false })

const positionOptions = ref([])
const editVisible = ref(false)
const editingRow = ref(null)

// 分配后置顶高亮的目标用户（一次性，下次主动查询/翻页时清除）
const focusUserId = ref(null)

const list = useAdminList(listPositionAssignments, {
  params: () => ({
    keyword: query.keyword,
    status: query.status,
    ...(query.hasPendingRequest ? { hasPendingRequest: true } : {}),
    ...(focusUserId.value != null ? { focusUserId: focusUserId.value } : {})
  })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list

// 【查询】按钮：清置顶、回第 1 页重查
function reload() {
  focusUserId.value = null
  return list.search()
}

// 搜索停顿 / 状态切换：保留页码，清置顶
function refreshKeepPage() {
  focusUserId.value = null
  return list.reload()
}

function onPageChange() {
  focusUserId.value = null
  return list.reload()
}

// 置顶高亮行样式
function rowClass({ row }) {
  return focusUserId.value != null && String(row.userId) === String(focusUserId.value) ? 'pa-row-focus' : ''
}

async function loadPositions() {
  try {
    const data = await listPositions({ size: 200 })
    positionOptions.value = (data?.list || [])
      .filter((p) => p.status === 'published')
      .map((p) => ({ positionId: p.positionId, name: p.name }))
  } catch (e) {
    /* 降级为空，弹窗下拉无选项 */
  }
}

// 关键词停顿 220ms 自动刷新；程序化清空不触发
let kwTimer = null
let skipKwWatch = false
watch(
  () => query.keyword,
  () => {
    if (skipKwWatch) { skipKwWatch = false; return }
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(refreshKeepPage, 220)
  }
)
onBeforeUnmount(() => { if (kwTimer) clearTimeout(kwTimer) })

function openEdit(row) {
  editingRow.value = { ...row }
  editVisible.value = true
}

// 切换「待分配申请」筛选
function togglePendingFilter() {
  query.hasPendingRequest = !query.hasPendingRequest
  refreshKeepPage()
}

async function onSaved() {
  const row = editingRow.value
  editingRow.value = null

  // 若该用户有待分配申请，自动标记为已分配
  if (row?.pendingRequestId) {
    try {
      await markApplicationAssigned(row.pendingRequestId)
    } catch (e) {
      ElMessage.error(e?.message || '申请状态更新失败，请刷新重试')
    }
    refreshPendingCount()
    // 清筛选、置顶高亮该用户
    if (query.keyword) skipKwWatch = true
    query.keyword = ''
    query.status = ''
    query.hasPendingRequest = false
    focusUserId.value = row.userId
    list.search()
  } else {
    list.reload()
  }
}

// ── 批量绑定 ─────────────────────────────────────────────────
const tableRef = ref(null)
const selectedRows = ref([])
const batchDialogVisible = ref(false)
const batchPositionId = ref('')
const batchBinding = ref(false)

function onSelectionChange(selection) {
  selectedRows.value = selection
}

function openBatchDialog() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要批量绑定的用户')
    return
  }
  batchPositionId.value = ''
  batchDialogVisible.value = true
}

async function confirmBatchBind() {
  if (!batchPositionId.value) {
    ElMessage.warning('请选择要绑定的岗位')
    return
  }
  const pos = positionOptions.value.find(p => p.positionId === batchPositionId.value)
  const userList = selectedRows.value.map(r => r.username || r.displayName || r.userId).join('、')
  try {
    await ElMessageBox.confirm(
      `将 ${selectedRows.value.length} 名用户（${userList}）统一绑定至「${pos?.name || ''}」？`,
      '批量绑定确认',
      { type: 'warning', confirmButtonText: '确认绑定', cancelButtonText: '取消' }
    )
  } catch { return }

  batchBinding.value = true
  try {
    await Promise.all(
      selectedRows.value.map(async (row) => {
        await setUserPosition(row.userId, batchPositionId.value)
        // 与单个分配路径（onSaved）同口径：绑定成功后若该用户有待分配申请，标记为已分配，
        // 否则待分配标签不消、徽标不减（2026-09-23 待办 yuepu#9②）。单条申请状态更新失败
        // 不影响本用户的绑定结果（已经绑上了），仅提示，不让 Promise.all 整体判失败。
        if (row.pendingRequestId) {
          try {
            await markApplicationAssigned(row.pendingRequestId)
          } catch (e) {
            ElMessage.error(e?.message || `${row.username || row.displayName} 的申请状态更新失败，请刷新重试`)
          }
        }
      })
    )
    ElMessage.success(`已将 ${selectedRows.value.length} 名用户绑定至「${pos?.name || ''}」`)
    batchDialogVisible.value = false
    tableRef.value?.clearSelection?.()
    selectedRows.value = []
    refreshPendingCount()
    list.reload()
  } catch (e) {
    ElMessage.error(e?.message || '批量绑定失败，请重试')
  } finally {
    batchBinding.value = false
  }
}

onMounted(() => {
  list.reload()
  loadPositions()
  refreshPendingCount()
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="岗位管理" subtitle="管理用户岗位绑定，分配岗位或处理待分配申请。" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 显示名"
        clearable
        class="lt-search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="query.status"
        placeholder="全部状态"
        clearable
        class="lt-filter"
        @change="refreshKeepPage"
      >
        <el-option label="启用" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <!-- 待分配申请筛选：切换显示有待分配申请的用户，含数量徽标（0 不展示） -->
      <el-button
        :class="['lt-pending-btn', { 'is-active': query.hasPendingRequest }]"
        @click="togglePendingFilter"
      >
        待分配申请<span v-if="pendingCount" class="pm-count">{{ pendingCount }}</span>
      </el-button>
      <el-button @click="reload">查询</el-button>
      <div class="lt-spacer" />
      <el-button
        :class="['lt-batch-btn', { 'is-active': selectedRows.length }]"
        @click="openBatchDialog"
      >
        批量绑定<span v-if="selectedRows.length" class="pm-count">{{ selectedRows.length }}</span>
      </el-button>
    </ListToolbar>

    <div v-loading="loading" class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="query.hasPendingRequest ? '暂无待分配申请' : '没有匹配的用户'"
        @retry="list.reload"
      >
        <el-table ref="tableRef" :data="rows" class="pa-table" :row-class-name="rowClass" @selection-change="onSelectionChange">
          <el-table-column type="selection" width="50" />
          <el-table-column label="用户名" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="pa-username">{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column label="显示名" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.displayName || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" :width="COL.STATUS" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="绑定岗位" min-width="220">
            <template #default="{ row }">
              <span v-if="row.positionName">{{ row.positionName }}</span>
              <span v-else class="pa-unbound">未绑定</span>
              <!-- 有待分配申请的用户显示橙色「待分配」标签 -->
              <StatusTag v-if="row.hasPendingRequest" type="warning" class="pa-pending-tag">待分配</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(1)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">分配岗位</el-button>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      @change="onPageChange"
    />

    <UserPositionEditDialog
      v-model:visible="editVisible"
      :row="editingRow"
      :position-options="positionOptions"
      @saved="onSaved"
    />

    <!-- 批量绑定岗位弹窗 -->
    <el-dialog v-model="batchDialogVisible" title="批量绑定岗位" width="480px" :close-on-click-modal="false">
      <div class="batch-dialog-body">
        <p class="batch-tip">已选 <strong>{{ selectedRows.length }}</strong> 名用户，请选择要统一绑定的岗位：</p>
        <el-select
          v-model="batchPositionId"
          placeholder="请选择岗位"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="p in positionOptions"
            :key="p.positionId"
            :label="p.name"
            :value="p.positionId"
          />
        </el-select>
      </div>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchBinding" @click="confirmBatchBind">确认绑定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pa-table {
  width: 100%;
}
.pa-username {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pa-unbound {
  color: var(--c-text-faint);
}
/* 「待分配」标签与前方文字同行，左侧间距 6px */
.pa-pending-tag {
  margin-left: 6px;
}
/* 待分配申请筛选按钮激活态 */
.lt-pending-btn {
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.lt-pending-btn.is-active {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
/* 筛选按钮数量徽标（橙软底胶囊，与原页签徽标同款） */
.pm-count {
  display: inline-grid;
  place-items: center;
  margin-left: 7px;
  min-width: 19px;
  height: 19px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--c-warning-soft, #fff1de);
  color: var(--c-warning, #a85f06);
  font-size: 11px;
  line-height: 19px;
}
/* 分配后置顶高亮行 */
.pa-table :deep(.pa-row-focus) td {
  background: var(--c-accent-fill);
}
/* 工具栏弹性占位（把批量绑定推到右侧） */
.lt-spacer {
  flex: 1;
}
/* 批量绑定按钮 */
.lt-batch-btn {
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.lt-batch-btn.is-active {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
/* 批量绑定弹窗内容 */
.batch-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.batch-tip {
  margin: 0;
  color: var(--c-text-muted);
  font-size: 14px;
}
.batch-tip strong {
  color: var(--c-text-strong);
}
</style>
