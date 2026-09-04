<script setup>
/**
 * 岗位管理页（原「岗位分配」，2026-09-04 按 PRD-20260903 升级为双页签）。
 *
 * 侧边栏入口名保持「岗位分配」（新 md §一明确入口不变，AdminRail 不改文案）；
 * 页内标题「岗位管理」，双页签 = 用户岗位分配 / 岗位申请审批（带待审核数量徽标，0 不展示）。
 * 切换页签保留各自筛选与分页（两套 useAdminList 实例 + v-show 保 DOM/状态）；默认进分配页签。
 *
 * 分配页签：以用户为核心，表格列 = 用户名 / 显示名 / 状态 / 绑定岗位 / 操作，
 * 修改绑定弹窗（UserPositionEditDialog）保存即时生效。
 * 审批页签（PRD-20260903 §四新增）：仅展示待审核申请、提交时间可排序（默认新→旧），
 * 操作 =【通过】（确认弹窗 → 现有绑定接口）/【驳回】（原因必填弹窗）/【重新绑定】
 * （复用修改绑定弹窗，完成后回分配页签清筛选置顶高亮该用户）。
 *
 * 骨架沿用列表页规范（2026-08-22 统一）：取数编排 useAdminList、失败/空态 ListStates、
 * 分页 ListPagination；数据走 positionAssignmentMock / positionApplicationsMock（api 层分流）。
 */
import { h, ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import UserPositionEditDialog from '@/components/admin/UserPositionEditDialog.vue'
import ReviewRejectDialog from '@/components/admin/ReviewRejectDialog.vue'
import {
  listPositionAssignments,
  listPositionApplications,
  countPendingApplications,
  approvePositionApplication,
  rejectPositionApplication,
  markApplicationRebound
} from '@/api/positionAssignment'
import { listPositions } from '@/api/position'
import '@/assets/connector.css'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

/* ---------- 页签（原型 assignmentTabs：pm-tabs + pm-count 徽标） ---------- */
const activeTab = ref('assignments') // 默认进「用户岗位分配」（md §二）
const pendingCount = ref(0)

async function refreshPendingCount() {
  try {
    const data = await countPendingApplications()
    pendingCount.value = Number(data?.count) || 0
  } catch (e) {
    /* 徽标计数读失败：保持旧值，不阻断页面 */
  }
}

/* ---------- 分配页签（既有功能原样） ---------- */
const query = reactive({ keyword: '', status: '' })

// 已发布岗位选项（供修改绑定弹窗的岗位下拉复用；md §五：仅已发布岗位可绑定）
const positionOptions = ref([])

const editVisible = ref(false)
const editingRow = ref(null)
// 非 null = 本次修改绑定来自审批页签【重新绑定】（保存后要标记申请 REBOUND 并回跳）
const editingApplication = ref(null)

// 「重新绑定」回跳置顶高亮的目标用户（原型 paFocusUserId）：随查询参数下发给 mock 置顶，
// 行高亮由 row-class-name 出；用户下一次主动查询/翻页/换筛选时清除。
const focusUserId = ref(null)

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）：
// 四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护均由其承担，本页只描述「取什么」。
const list = useAdminList(listPositionAssignments, {
  params: () => ({ ...query, ...(focusUserId.value != null ? { focusUserId: focusUserId.value } : {}) })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload

// 用户主动查询（【查询】按钮 / 状态筛选）：清除置顶聚焦，回第 1 页重查
function reload() {
  focusUserId.value = null
  return list.search()
}

// 翻页：清除置顶聚焦（一次性态，避免置顶排序影响后续翻页行序）后按所点页码取数
function onPageChange() {
  focusUserId.value = null
  return fetchList()
}

function assignmentRowClass({ row }) {
  return focusUserId.value != null && String(row.userId) === String(focusUserId.value) ? 'pa-row-focus' : ''
}

async function loadPositions() {
  try {
    // 只取已发布岗位（可绑定目标）；size 放大一次拉全，避免分页缺项。
    const data = await listPositions({ status: 'published', size: 200 })
    positionOptions.value = (data?.list || []).map((p) => ({ positionId: p.positionId, name: p.name }))
  } catch (e) {
    /* 岗位选项读失败：编辑下拉降级为空，不阻断列表 */
  }
}

// 关键词实时搜索：300ms 防抖 → reload；程序化清空（重新绑定回跳）不触发聚焦清除
let kwTimer = null
let skipKwWatch = false
watch(
  () => query.keyword,
  () => {
    if (skipKwWatch) {
      skipKwWatch = false
      return
    }
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
})

function openEdit(row) {
  editingApplication.value = null
  editingRow.value = { ...row }
  editVisible.value = true
}

/* ---------- 审批页签（PRD-20260903 §四，原型 renderPositionApplications） ---------- */
// 仅展示待审核；默认按提交时间由近到远，点列头切换升降序（md §4.1）
const appSortDir = ref('desc')
const appList = useAdminList(listPositionApplications, { params: () => ({ sortDir: appSortDir.value }) })

function onAppSortChange({ order }) {
  appSortDir.value = order === 'ascending' ? 'asc' : 'desc'
  appList.search()
}

/** 审批动作后的联动刷新：申请列表 + 徽标计数；binding=true 时分配列表也变了一并刷 */
function refreshAfterAction(binding = false) {
  appList.reload()
  refreshPendingCount()
  if (binding) fetchList()
}

// 【通过】：确认弹窗（文案照 md §4.3.1 逐字）→ 现有岗位绑定接口 → 申请置 APPROVED 离开列表
async function onApprove(row) {
  try {
    await ElMessageBox.confirm(
      h('div', null, [
        h('p', { class: 'pa-approve-text' }, ['确认通过 ', h('b', null, row.displayName || row.username), ' 的岗位申请？']),
        h('p', { class: 'pa-approve-hint' }, `确认后将使用现有岗位绑定接口，把该用户设置为「${row.requestedPositionName || ''}」。`)
      ]),
      '确认通过岗位申请',
      { confirmButtonText: '确认通过' }
    )
  } catch {
    return // 取消 / 关闭 / 遮罩：放弃本次操作
  }
  try {
    await approvePositionApplication(row.id)
    ElMessage.success('岗位申请已通过，绑定已更新')
    refreshAfterAction(true)
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请重试')
    refreshAfterAction()
  }
}

// 【驳回】：原因必填弹窗（ReviewRejectDialog 复用，标题按 md §4.3.2）；不改变现有绑定
const rejectVisible = ref(false)
const rejectSubmitting = ref(false)
const rejectingRow = ref(null)

function onReject(row) {
  rejectingRow.value = row
  rejectVisible.value = true
}
async function onRejectConfirm(reason) {
  if (!rejectingRow.value) return
  rejectSubmitting.value = true
  try {
    await rejectPositionApplication(rejectingRow.value.id, reason)
    ElMessage.success('岗位申请已驳回')
    rejectVisible.value = false
    refreshAfterAction()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请重试')
  } finally {
    rejectSubmitting.value = false
  }
}

// 【重新绑定】：复用修改绑定弹窗（可选任意已发布岗位，不限于申请岗位，md §4.3.3）
function onRebind(row) {
  editingApplication.value = row
  editingRow.value = {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    positionId: row.currentPositionId,
    positionName: row.currentPositionName
  }
  editVisible.value = true
}

// 弹窗取消/关闭：申请保持「待审核」不变（md §4.3.3），仅还原上下文
watch(editVisible, (v) => {
  if (!v) editingApplication.value = null
})

// 修改绑定保存成功（弹窗内已 toast「岗位绑定已更新」）
async function onSaved() {
  const app = editingApplication.value
  editingApplication.value = null
  if (!app) {
    fetchList()
    return
  }
  // 重新绑定完成（md §4.3.3）：申请标记「已重新绑定」→ 自动切回分配页签 →
  // 清空搜索和状态筛选 → 该用户置顶高亮聚焦
  try {
    await markApplicationRebound(app.id)
  } catch (e) {
    ElMessage.error(e?.message || '申请状态更新失败，请刷新重试')
  }
  activeTab.value = 'assignments'
  if (query.keyword) skipKwWatch = true
  query.keyword = ''
  query.status = ''
  focusUserId.value = app.userId
  list.search()
  refreshAfterAction()
}

onMounted(() => {
  fetchList()
  loadPositions()
  appList.reload()
  refreshPendingCount()
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="岗位管理" subtitle="管理用户岗位绑定，支持直接分配与处理用户岗位申请。" />

    <!-- 双页签（原型 assignmentTabs）：切换保留各页签筛选与分页（v-show 保状态） -->
    <el-tabs v-model="activeTab" class="pm-tabs">
      <el-tab-pane name="assignments" label="用户岗位分配" />
      <el-tab-pane name="applications">
        <template #label>
          岗位申请审批<span v-if="pendingCount" class="pm-count">{{ pendingCount }}</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- ============ 页签一：用户岗位分配 ============ -->
    <div v-show="activeTab === 'assignments'" class="pm-pane-assignments">
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
          @change="reload"
        >
          <el-option label="启用" value="active" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <!-- 【查询】按钮（原型 pa-query）：点击回第 1 页重查 -->
        <el-button @click="reload">查询</el-button>
      </ListToolbar>

      <div v-loading="loading" class="table-wrap">
        <ListStates
          :loading="loading"
          :error="loadError"
          :empty="isEmpty"
          empty-text="没有匹配的用户"
          @retry="fetchList"
        >
          <el-table :data="rows" class="pa-table" :row-class-name="assignmentRowClass">
            <!-- 用户名：本页主键信息，加粗强调（原型 fm5-name） -->
            <el-table-column label="用户名" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="pa-username">{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="displayName" label="显示名" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.displayName || '—' }}</template>
            </el-table-column>
            <el-table-column label="状态" :width="COL.STATUS">
              <template #default="{ row }">
                <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                  {{ row.status === 'active' ? '启用' : '停用' }}
                </StatusTag>
              </template>
            </el-table-column>
            <el-table-column label="绑定岗位" min-width="180">
              <template #default="{ row }">
                <span v-if="row.positionName">{{ row.positionName }}</span>
                <span v-else class="pa-unbound">未绑定</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEdit(row)">修改绑定</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页底部信息（原型 fm5-pager「共 N 条 · 每页 X 条」）：固定每页条数，单页时也显示总条数 -->
          <div v-if="total" class="pa-foot">
            <span class="pa-foot-info">共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
            <ListPagination
              v-model:page="page"
              :page-size="pageSize"
              :total="total"
              @change="onPageChange"
            />
          </div>
        </ListStates>
      </div>
    </div>

    <!-- ============ 页签二：岗位申请审批（PRD-20260903 §四） ============ -->
    <div v-show="activeTab === 'applications'" class="pm-pane-applications">
      <div v-loading="appList.loading.value" class="table-wrap">
        <ListStates
          :loading="appList.loading.value"
          :error="appList.loadError.value"
          :empty="appList.isEmpty.value"
          empty-text="暂无待审核的岗位申请"
          empty-sub-text="新的用户岗位申请会显示在这里"
          @retry="appList.reload"
        >
          <el-table
            :data="appList.rows.value"
            class="pa-table"
            :default-sort="{ prop: 'submittedAt', order: appSortDir === 'desc' ? 'descending' : 'ascending' }"
            @sort-change="onAppSortChange"
          >
            <el-table-column label="用户名" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="pa-username">{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column label="显示名" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ row.displayName || '—' }}</template>
            </el-table-column>
            <!-- 状态：取该用户在分配列表中的启用/停用状态（md §4.2） -->
            <el-table-column label="状态" :width="COL.STATUS">
              <template #default="{ row }">
                <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                  {{ row.status === 'active' ? '启用' : '停用' }}
                </StatusTag>
              </template>
            </el-table-column>
            <el-table-column label="现有绑定岗位" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.currentPositionName">{{ row.currentPositionName }}</span>
                <span v-else class="pa-unbound">未绑定</span>
              </template>
            </el-table-column>
            <!-- 申请岗位：强调字重（md §4.2） -->
            <el-table-column label="申请岗位" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="pa-username">{{ row.requestedPositionName || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column
              label="提交时间"
              prop="submittedAt"
              sortable="custom"
              :width="COL.TIME"
            >
              <template #default="{ row }">
                <span class="pa-time">{{ row.submittedAt }}</span>
              </template>
            </el-table-column>
            <!-- 操作：通过=链接 / 驳回=危险链接 / 重新绑定=链接（md §4.2） -->
            <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="onApprove(row)">通过</el-button>
                <el-button link type="danger" @click="onReject(row)">驳回</el-button>
                <el-button link type="primary" @click="onRebind(row)">重新绑定</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="appList.total.value" class="pa-foot">
            <span class="pa-foot-info">共 {{ appList.total.value }} 条 · 每页 {{ appList.pageSize.value }} 条</span>
            <ListPagination
              v-model:page="appList.page.value"
              :page-size="appList.pageSize.value"
              :total="appList.total.value"
              @change="appList.reload"
            />
          </div>
        </ListStates>
      </div>
    </div>

    <!-- 修改绑定弹窗：分配页签与审批页签【重新绑定】共用（md §4.3.3 与 §3.3 一致）；
         重新绑定场景 force-save：不改选项直接【保存】也视为处理完成 -->
    <UserPositionEditDialog
      v-model:visible="editVisible"
      :row="editingRow"
      :position-options="positionOptions"
      :force-save="!!editingApplication"
      @saved="onSaved"
    />

    <!-- 驳回弹窗（标准件 ReviewRejectDialog，标题按 md §4.3.2） -->
    <ReviewRejectDialog
      v-model="rejectVisible"
      title="驳回岗位申请"
      :submitting="rejectSubmitting"
      @confirm="onRejectConfirm"
    />
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
.pa-time {
  color: var(--c-text-muted);
}
/* 页签徽标（原型 pm-count）：待审核数量，0 时模板不渲染 */
.pm-count {
  display: inline-block;
  margin-left: 6px;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  font-size: var(--fs-xs);
  line-height: 18px;
  text-align: center;
}
.pm-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
/* 「重新绑定」回跳置顶高亮（原型 paFocusUserId 行） */
.pa-table :deep(.pa-row-focus) td {
  background: var(--c-accent-fill);
}
/* 分页底部：左信息 + 右分页条（单页时 ListPagination 不渲染，仅剩总条数信息） */
.pa-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.pa-foot-info {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
