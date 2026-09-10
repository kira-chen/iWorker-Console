<script setup>
/**
 * 岗位管理页（原「岗位分配」，2026-09-04 按 PRD-20260903 升级为双页签）。
 *
 * 侧边栏入口名「岗位管理」（2026-09-07 PRD-20260904 对齐：0903"入口不变"口径被新版反转，AdminRail 已随动改名）；
 * 页内标题「岗位管理」，双页签 = 用户岗位管理 / 岗位申请审批（带待审核数量徽标，0 不展示）
 * （2026-09-08 PRD-20260908 对齐：页签「用户岗位分配」→「用户岗位管理」，md §二 / 原型 assignmentTabs）。
 * 切换页签保留各自筛选与分页（两套 useAdminList 实例 + v-show 保 DOM/状态）；默认进「用户岗位管理」。
 *
 * 用户岗位管理页签：以用户为核心，表格列 = 用户名 / 显示名 / 状态 / 绑定岗位 / 操作，
 * 修改绑定弹窗（UserPositionEditDialog）保存即时生效。
 * 查询区（md §3.1，2026-09-08 对齐）：搜索输入停顿 220ms 后自动刷新、状态切换即刷新——两者**不重置分页**
 * （useAdminList.reload 保留页码，越界钳到末页）；仅【查询】按钮回第 1 页。
 * 绑定岗位下拉 = 已发布及审核中岗位（md §五：审核中指已发布岗位在审新版 / 停用审核，底层 status=published
 * 不看 pendingAction；未发布且首发审核中的不进下拉）。
 * 审批页签（PRD-20260903 §四新增；2026-09-09 PRD 复核·G2 / A8 按 md §4.1-§4.3.4 重做）：
 * **展示全部四态**申请（待审核 / 已通过 / 已驳回 / 已重新绑定），处理后仍留在列表；
 * 排序 = 待审核组恒置顶，组内按提交时间由近到远，点列头只反转组内顺序；
 * 查询区新增「审核状态筛选」（默认全部状态，切换回第 1 页）；
 * 列 = 用户名 / 显示名 / 状态 / 现有绑定岗位 / 申请岗位 / 提交时间 / 审核结果 / 处理时间 / 处理人 / 操作
 * （后三列为本轮新增）；
 * 「已驳回」在审核结果标签上悬停展示驳回原因；操作按钮仅待审核行展示
 * （【通过】确认弹窗 → 现有绑定接口 /【驳回】原因必填弹窗 /【重新绑定】复用修改绑定弹窗，
 * 完成后回分配页签清筛选置顶高亮该用户）。
 *
 * 骨架沿用列表页规范（2026-08-22 统一）：取数编排 useAdminList、失败/空态 ListStates、
 * 分页 ListPagination；数据走 positionAssignmentMock / positionApplicationsMock（api 层分流）。
 */
import { h, ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/composables/useConfirm'
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
const activeTab = ref('assignments') // 默认进「用户岗位管理」（md §二）
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

// 可绑定岗位选项（供修改绑定弹窗的岗位下拉复用；md §五：已发布及审核中岗位）
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

// 【查询】按钮（原型 pa-query）：清除置顶聚焦，回第 1 页重查
function reload() {
  focusUserId.value = null
  return list.search()
}
// 搜索停顿 / 状态切换的自动刷新（md §3.1「不重置分页，保留当前页码」）：清除置顶聚焦，按当前页码重取
function refreshKeepPage() {
  focusUserId.value = null
  return list.reload()
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
    // 取已发布及审核中岗位（可绑定目标）：mock 的 status=published 筛选按展示态会把「已发布且在审」归到 reviewing
    // 而排除，故拉全量后按底层 status === 'published' 过滤（原型 L1599 同口径：不看 pendingAction）；
    // 未发布且首发审核中（status=draft + pendingAction）不进下拉。size 放大一次拉全，避免分页缺项。
    const data = await listPositions({ size: 200 })
    positionOptions.value = (data?.list || [])
      .filter((p) => p.status === 'published')
      .map((p) => ({ positionId: p.positionId, name: p.name }))
  } catch (e) {
    /* 岗位选项读失败：编辑下拉降级为空，不阻断列表 */
  }
}

// 关键词实时搜索：输入停顿 220ms（原型 L1645）后自动刷新且不重置分页；程序化清空（重新绑定回跳）不触发
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
    kwTimer = setTimeout(refreshKeepPage, 220)
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

/* ---------- 审批页签（md §四；2026-09-09 PRD 复核·G2 / A8 全量展示改造） ---------- */
// 展示全部四态；默认按提交时间由近到远，点列头切换升降序（分组「待审核置顶」由 mock 保持不变，
// 仅组内顺序反转，见 positionApplicationsMock.listPositionApplications）。
const appSortDir = ref('desc')

// 排序方向箭头
const appSortArrow = computed(() => appSortDir.value === 'desc' ? '↓' : '↑')

// 切换排序
function toggleAppSort() {
  appSortDir.value = appSortDir.value === 'desc' ? 'asc' : 'desc'
  appList.search()
}

// 审核状态筛选（md §4.1）：'' = 全部状态；切换后回第 1 页
const appQuery = reactive({ reviewStatus: '' })
const appList = useAdminList(listPositionApplications, {
  params: () => ({ sortDir: appSortDir.value, reviewStatus: appQuery.reviewStatus })
})

// 审核结果标签四色（md §4.2）：待审核黄 / 已通过绿 / 已驳回红 / 已重新绑定蓝
const REVIEW_STATUS_OPTIONS = [
  { value: 'PENDING', label: '待审核' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'REBOUND', label: '已重新绑定' }
]
const REVIEW_STATUS_META = {
  PENDING: { label: '待审核', type: 'warning' },
  APPROVED: { label: '已通过', type: 'success' },
  REJECTED: { label: '已驳回', type: 'danger' },
  REBOUND: { label: '已重新绑定', type: 'accent' } // accent = 全站蓝档（StatusTag 无 primary）
}
function reviewStatusMeta(v) {
  return REVIEW_STATUS_META[v] || { label: '—', type: 'info' }
}
// 已处理记录不提供二次操作入口（md §4.3.4）
function isPendingApp(row) {
  return row.reviewStatus === 'PENDING'
}

/** 审批动作后的联动刷新：申请列表 + 徽标计数；binding=true 时分配列表也变了一并刷 */
function refreshAfterAction(binding = false) {
  appList.reload()
  refreshPendingCount()
  if (binding) fetchList()
}

// 【通过】：确认弹窗（文案照 md §4.3.1 逐字）→ 现有岗位绑定接口 → 申请置 APPROVED 离开列表
async function onApprove(row) {
  // 统一 440px 无图标确认框（2026-09-08 原型复刻批次 1 · A8）
  const ok = await confirmDialog(
    h('div', null, [
      h('p', { class: 'pa-approve-text' }, ['确认通过 ', h('b', null, row.displayName || row.username), ' 的岗位申请？']),
      h('p', { class: 'pa-approve-hint' }, `确认后将使用现有岗位绑定接口，把该用户设置为「${row.requestedPositionName || ''}」。`)
    ]),
    '确认通过岗位申请',
    { confirmText: '确认通过' }
  )
  if (!ok) return // 取消 / 关闭 / 遮罩：放弃本次操作
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

// 【重新绑定】：复用修改绑定弹窗（可选已发布及审核中岗位，不限于申请岗位，md §4.3.3）
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

    <!-- 双页签（原型 assignmentTabs：pm-tabs 下划线式 + pm-count 橙软底徽标）：切换保留各页签筛选与分页（v-show 保状态） -->
    <el-tabs v-model="activeTab" class="pm-tabs">
      <el-tab-pane name="assignments" label="用户岗位管理" />
      <el-tab-pane name="applications">
        <template #label>
          岗位申请审批<span v-if="pendingCount" class="pm-count">{{ pendingCount }}</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- ============ 页签一：用户岗位管理 ============ -->
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
        <!-- 状态切换即刷新、不重置分页（md §3.1） -->
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

          <!-- 统一分页条（原型 fm5-pager「共 N 条 · 每页 X 条 ‹ 页码 ›」恒显；2026-09-08 原型复刻批次 1 · C2：
               本页自拼的 pa-foot-info 已删，总条数 / 每页条数由 ListPagination 统一给） -->
          <ListPagination
            v-model:page="page"
            :page-size="pageSize"
            :total="total"
            @change="onPageChange"
          />
        </ListStates>
      </div>
    </div>

    <!-- ============ 页签二：岗位申请审批（PRD-20260903 §四） ============ -->
    <div v-show="activeTab === 'applications'" class="pm-pane-applications">
      <!-- 审核状态筛选（md §4.1）：默认全部状态，切换后自动刷新并回第 1 页 -->
      <ListToolbar>
        <el-select
          v-model="appQuery.reviewStatus"
          placeholder="全部状态"
          clearable
          class="lt-filter"
          @change="appList.search"
        >
          <el-option
            v-for="opt in REVIEW_STATUS_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </ListToolbar>

      <div v-loading="appList.loading.value" class="table-wrap">
        <!-- 空态双分支（md §4.1 / §六）：无任何申请 vs 筛选无结果 -->
        <ListStates
          :loading="appList.loading.value"
          :error="appList.loadError.value"
          :empty="appList.isEmpty.value"
          :empty-text="appQuery.reviewStatus ? '没有匹配的岗位申请' : '暂无岗位申请'"
          :empty-sub-text="appQuery.reviewStatus ? '' : '新的用户岗位申请会显示在这里'"
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
            <el-table-column :width="COL.TIME">
              <template #header>
                <button type="button" class="time-sort" @click="toggleAppSort">
                  提交时间 <span class="time-sort-arrow">{{ appSortArrow }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span class="pa-time">{{ row.submittedAt }}</span>
              </template>
            </el-table-column>
            <!-- 审核结果四色标签（md §4.2）；「已驳回」在标签上悬停展示完整驳回原因（md §4.3.4） -->
            <el-table-column label="审核结果" :width="120">
              <template #default="{ row }">
                <el-tooltip
                  v-if="row.reviewStatus === 'REJECTED' && row.rejectReason"
                  :content="row.rejectReason"
                  placement="top"
                >
                  <span>
                    <StatusTag :type="reviewStatusMeta(row.reviewStatus).type">
                      {{ reviewStatusMeta(row.reviewStatus).label }}
                    </StatusTag>
                  </span>
                </el-tooltip>
                <StatusTag v-else :type="reviewStatusMeta(row.reviewStatus).type">
                  {{ reviewStatusMeta(row.reviewStatus).label }}
                </StatusTag>
              </template>
            </el-table-column>
            <!-- 处理时间 / 处理人：待审核记录显示「—」（md §4.2） -->
            <el-table-column label="处理时间" :width="COL.TIME">
              <template #default="{ row }">
                <span class="pa-time">{{ row.processedAt || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="处理人" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ row.processedBy || '—' }}</template>
            </el-table-column>
            <!-- 操作：仅待审核行给三按钮（通过=链接 / 驳回=危险链接 / 重新绑定=链接）；
                 已处理记录不展示操作按钮（md §4.2 / §4.3.4 不可二次处理） -->
            <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
              <template #default="{ row }">
                <template v-if="isPendingApp(row)">
                  <el-button link type="primary" @click="onApprove(row)">通过</el-button>
                  <el-button link type="danger" @click="onReject(row)">驳回</el-button>
                  <el-button link type="primary" @click="onRebind(row)">重新绑定</el-button>
                </template>
                <span v-else class="pa-unbound">—</span>
              </template>
            </el-table-column>
          </el-table>

          <ListPagination
            v-model:page="appList.page.value"
            :page-size="appList.pageSize.value"
            :total="appList.total.value"
            @change="appList.reload"
          />
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
/* 页签徽标（原型 .pm-count L1512：橙软底 #fff1de / 字色 #a85f06，19px 圆角胶囊；0 时模板不渲染） */
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
/* 页签条形态照原型 .pm-tabs / .pm-tab：底线分隔、项间距 28、高 52、14px 半粗、激活绿色 2px 下划线 */
.pm-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.pm-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background-color: var(--border-base);
}
.pm-tabs :deep(.el-tabs__item) {
  display: inline-flex;
  align-items: center;
  height: 52px;
  padding: 0 2px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
}
.pm-tabs :deep(.el-tabs__item + .el-tabs__item) {
  margin-left: 28px;
}
.pm-tabs :deep(.el-tabs__item:hover) {
  color: var(--c-text-strong);
}
.pm-tabs :deep(.el-tabs__item.is-active) {
  color: var(--c-accent);
}
.pm-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  border-radius: 2px 2px 0 0;
  background-color: var(--c-accent);
}
/* 「重新绑定」回跳置顶高亮（原型 paFocusUserId 行） */
.pa-table :deep(.pa-row-focus) td {
  background: var(--c-accent-fill);
}

/* 时间列排序按钮样式（对齐审核中心 UnifiedReview.vue） */
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
</style>
