<script setup>
/**
 * 审核中心（2026-09-01 PRD 对齐改造：对齐 PRD-20260828 + 交互原型 v2 renderReviews）。
 *
 * 新口径（取代 V39 S4 四态审核台旧口径）：
 * - 列表只展示待审核（PENDING_REVIEW），四态历史 / 状态列 / 状态筛选 / 发布目标 / 来源列删除；
 * - 七列：名称(名称+描述) / 业务类型 / 申请类型 / 申请版本 / 提交人 / 提交时间(排序，默认 desc) / 操作；
 * - 筛选：keyword（域 name/description/submitterName）+ 业务类型七项 + 申请类型 + 「查询」按钮；
 * - 操作列顺序【查看】【驳回】【通过】（驳回 danger-link）；
 * - 详情复用业务原生只读视图（GovObjectDetail 分发；SKILL 跳技能整页只读 + 吸底操作栏；
 *   原 ReviewDetailDrawer 已废弃删除），底部统一 关闭|驳回|通过；
 * - 通过/驳回弹窗文案逐字对齐原型（utils/govDialogs + ReviewRejectDialog）。
 * 数据默认走 mock（api/reviewsMock.js，种子=原型 8 条），见 api/reviews.js 头注释。
 */
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import GovObjectDetail from '@/components/admin/GovObjectDetail.vue'
import ReviewRejectDialog from '@/components/admin/ReviewRejectDialog.vue'
import { fmtTime } from '@/utils/docMeta'
import {
  REVIEW_BIZ_TYPE_OPTIONS,
  REQUEST_ACTION_OPTIONS,
  reviewBizTypeLabel,
  reviewBizTypeTagType,
  requestActionLabel,
  requestActionTagType
} from '@/utils/reviewMeta'
import { confirmApproveReview } from '@/utils/govDialogs'
import { listReviews, approveReview, rejectReview } from '@/api/reviews'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

const router = useRouter()

// 排序：仅提交时间列，默认 desc（原型 time-sort 补丁口径）
const query = reactive({ keyword: '', type: '', requestAction: '', sortDir: 'desc' })

/* ---------------- 行内/详情动作忙态 ---------------- */
const busyRowId = ref(null)
const busyAction = ref(null) // 'approve' | 'reject'

/* ---------------- 详情（业务原生只读视图） ---------------- */
const detailVisible = ref(false)
const detailRow = ref(null)
const detailKind = ref('')
// 详情吸底操作栏：关闭 | 驳回 | 通过（列表只出待审核，无非待审核态分支）
const DETAIL_BUTTONS = [
  { key: 'close', label: '关闭' },
  { key: 'reject', label: '驳回', type: 'danger' },
  { key: 'approve', label: '通过', type: 'primary' }
]

/* ---------------- 驳回弹窗 ---------------- */
const rejectVisible = ref(false)
const rejectTarget = ref(null)
const rejecting = ref(false)

// 取数编排统一走 useAdminList：四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护由其承担
const list = useAdminList(listReviews, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

onMounted(fetchList)

let kwTimer = null
watch(
  () => query.keyword,
  () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
})

// 提交时间列排序（sortable="custom" → mock/后端侧排序）
function onSortChange({ prop, order }) {
  if (prop !== 'submittedAt') return
  query.sortDir = order === 'ascending' ? 'asc' : 'desc'
  reload()
}

// 业务类型归一化：TOOL 按 subType 拆 MCP/API，其余直透
function kindOf(row) {
  if (row.type === 'TOOL') return row.subType === 'MCP' ? 'MCP' : 'API'
  return row.type
}

function openDetail(row) {
  const kind = kindOf(row)
  if (kind === 'SKILL') {
    // 技能 → 整页只读（复用平台技能只读路由）+ 吸底操作栏（AdminSkillEditPage 按 query 渲染）
    router.push({
      name: 'SysConfigSkillView',
      params: { id: String(row.refId) },
      query: { govReview: String(row.id) }
    })
    return
  }
  detailRow.value = row
  detailKind.value = kind
  detailVisible.value = true
}

function onDetailAction(key) {
  const row = detailRow.value
  if (!row) return
  if (key === 'close') {
    detailVisible.value = false
  } else if (key === 'reject') {
    openReject(row)
  } else if (key === 'approve') {
    approve(row)
  }
}

async function approve(row) {
  if (!(await confirmApproveReview(row))) return
  busyRowId.value = row.id
  busyAction.value = 'approve'
  try {
    await approveReview(row)
    ElMessage.success(row.requestAction === 'DELIST' ? '已通过停用申请' : '已通过审核')
    detailVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '审核失败')
  } finally {
    busyRowId.value = null
    busyAction.value = null
  }
}

function openReject(row) {
  rejectTarget.value = row
  rejectVisible.value = true
}

async function submitReject(reason) {
  const row = rejectTarget.value
  if (!row) return
  rejecting.value = true
  busyRowId.value = row.id
  busyAction.value = 'reject'
  try {
    await rejectReview(row, reason)
    ElMessage.success('已驳回审核')
    rejectVisible.value = false
    detailVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '驳回失败')
  } finally {
    rejecting.value = false
    busyRowId.value = null
    busyAction.value = null
  }
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="审核中心" subtitle="审核系统配置员提交的连接器、技能、模型、岗位与专家发布、停用申请" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索名称 / 用户名"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.type" placeholder="全部业务类型" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in REVIEW_BIZ_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="query.requestAction" placeholder="全部申请类型" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in REQUEST_ACTION_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="暂无审核数据"
        @retry="fetchList"
      >
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          :default-sort="{ prop: 'submittedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <el-table-column label="名称" :min-width="COL.NAME_MIN">
            <template #default="{ row }">
              <span class="rev-name">{{ row.name }}</span>
              <div v-if="row.description" class="rev-desc" :title="row.description">{{ row.description }}</div>
            </template>
          </el-table-column>
          <el-table-column label="业务类型" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="reviewBizTypeTagType(row.type)">{{ reviewBizTypeLabel(row) }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="申请类型" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="requestActionTagType(row.requestAction)">
                {{ requestActionLabel(row.requestAction) }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="申请版本" :width="COL.TAG">
            <template #default="{ row }">{{ row.version || '—' }}</template>
          </el-table-column>
          <el-table-column label="提交人" :width="COL.USER">
            <template #default="{ row }">
              <span class="rev-submitter">{{ row.submitterName || '未知' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" prop="submittedAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">{{ row.submittedAt ? fmtTime(row.submittedAt) : '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
            <template #default="{ row }">
              <div class="rev-ops">
                <el-button link type="primary" class="rev-op" @click="openDetail(row)">查看</el-button>
                <el-button
                  link
                  type="danger"
                  class="rev-op"
                  :loading="busyRowId === row.id && busyAction === 'reject'"
                  :disabled="busyRowId === row.id"
                  @click="openReject(row)"
                >
                  驳回
                </el-button>
                <el-button
                  link
                  type="primary"
                  class="rev-op"
                  :loading="busyRowId === row.id && busyAction === 'approve'"
                  :disabled="busyRowId === row.id"
                  @click="approve(row)"
                >
                  通过
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <ListPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="total"
          @change="fetchList"
        />
      </ListStates>
    </div>

    <!-- 业务原生只读详情（SKILL 走整页路由，不进此组件） -->
    <GovObjectDetail
      v-model:visible="detailVisible"
      :kind="detailKind"
      :ref-id="detailRow?.refId"
      :item="detailRow"
      :buttons="DETAIL_BUTTONS"
      :busy-key="busyAction || ''"
      @action="onDetailAction"
    />

    <!-- 驳回弹窗（原型文案逐字） -->
    <ReviewRejectDialog v-model="rejectVisible" :submitting="rejecting" @confirm="submitReject" />
  </div>
</template>

<style scoped>
.rev-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.rev-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rev-submitter {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
/* ===== 操作列：不换行 + 统一间距（与模型页同口径） ===== */
/* nowrap 是关键：loading 态会给按钮插入转圈图标、撑宽内容，直接平铺 el-button
   会在超出列宽时换行——表现为点「通过」后操作区「闪一下并换行」。 */
.rev-ops {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--space-3);
}
.rev-ops :deep(.el-button + .el-button),
.rev-ops :deep(.el-button) {
  margin: 0;
}
.rev-op {
  font-size: var(--fs-sm);
  white-space: nowrap;
  /* 固定高度：loading 图标出现/消失时不带动行高跳动 */
  height: 22px;
  padding: 0;
}
/* 同行其它按钮在动作进行中置灰（防重复提交），但不保留主色以免看着仍可点 */
.rev-ops :deep(.el-button.is-link.is-disabled) {
  color: var(--c-text-faint);
}
</style>
