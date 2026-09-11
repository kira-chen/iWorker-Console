<script setup>
/**
 * 用户技能审核（05 治理；2026-09-08 PRD-20260908 对齐整页重做，md prd.用户技能审核.md + 原型 user-skill-audit 层 L4413–4560）。
 *
 * - 页面说明取 md L8；工具栏：搜索（技能名称 / 描述 / 提交人模糊，Enter 或【查询】触发）+ 审核尺度 + 审核状态
 *   （下拉变更即刷新）+【查询】+ 右端 primary【风险设置】；
 * - 七列：技能名称 / 描述（省略 + 悬停）/ 提交人 / 提交时间（列头切换正倒序，默认倒序 ↑↓）/ 审核状态 / 审核尺度 / 操作；
 *   操作【查看技能】，待审核加【通过】【驳回】（驳回 danger-link）；空态「没有符合条件的审核记录」；
 * - 查看技能 → 右侧抽屉 UserSkillAuditDrawer（原整页 ReviewSkillDetailPage 退役：路由 /:id/view 改为深链
 *   重定向到本页 ?view=id 打开抽屉）；通过 → confirmDialog「通过审核」；驳回 → UserSkillRejectDialog；
 * - 【风险设置】→ RiskSettingsDrawer；
 * - 分页走全站统一 useAdminList（每页条数按窗口高度动态）；审核状态词全站「待审核」（负责人裁决）。
 * 数据默认走 mock（api/skillReviewMock.js），见 api/skillReview.js 头注释。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import UserSkillAuditTag from '@/components/admin/UserSkillAuditTag.vue'
import UserSkillAuditDrawer from '@/components/admin/UserSkillAuditDrawer.vue'
import UserSkillRejectDialog from '@/components/admin/UserSkillRejectDialog.vue'
import RiskSettingsDrawer from '@/components/admin/RiskSettingsDrawer.vue'
import { useUserStore } from '@/stores/user'
import { fmtTime } from '@/utils/docMeta'
import { COL, opsWidth } from '@/utils/tableLayout'

/**
 * 列宽（2026-09-08 按原型 L4485 colgroup 比例调：技能名称 160 / 描述 220 / 提交人 90 / 提交时间 145 /
 * 审核状态 90 / 审核尺度 80 / 操作 = 剩余）。全站 COL.STATUS=84 扣除单元格 32px 内边距后只剩 52px，
 * 装不下「待审核」三字圆角标签（52px 内容 + 2px 边框）会出现省略号，故状态 / 尺度两列单独给 110；
 * 描述列最小宽按原型收至 200（COL.DESC_MIN=240 偏宽）；操作列不再 fixed=right（原型操作列吃剩余宽、
 * 不贴右缘），用 min-width 让其与描述列一起分摊剩余空间，1600 宽下无省略、无横向滚动。
 */
const USR_COL = { DESC_MIN: 200, STATUS: 110, SCALE: 110, OPS_MIN: opsWidth(4) }
import { AUDIT_STATUS, AUDIT_SCALES } from '@/utils/userSkillAuditMeta'
import { confirmDialog } from '@/composables/useConfirm'
import { useAdminList } from '@/composables/useAdminList'
import { listReviewApplications, approveReviewApplication, rejectReviewApplication } from '@/api/skillReview'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 筛选 + 排序（提交时间，默认 desc；md §4.1 列头点击切换）
const query = reactive({ keyword: '', scale: '', status: '', sort: 'desc' })
const statusOptions = AUDIT_STATUS
const scaleOptions = AUDIT_SCALES

// 取数编排统一走 useAdminList：四态 / 动态分页 / 空筛选项过滤 / 防空页回退 / 竞态防护由其承担
const list = useAdminList(listReviewApplications, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

function toggleSort() {
  query.sort = query.sort === 'asc' ? 'desc' : 'asc'
  reload()
}
const sortIcon = computed(() => (query.sort === 'asc' ? '↑' : '↓'))

/* ---------------- 查看技能抽屉 ---------------- */
const detailVisible = ref(false)
const detailId = ref(null)

function openDetail(row) {
  detailId.value = row.id
  detailVisible.value = true
}

/* ---------------- 审核动作（列表行与抽屉底部共用） ---------------- */
const busyRowId = ref(null)
const busyAction = ref('') // 'approve' | 'reject' | ''
const reviewerName = computed(() => userStore.userInfo?.name || '管理员')

async function approve(row) {
  if (!row || busyRowId.value) return
  const ok = await confirmDialog(
    `确认通过「${row.skillName}」的审核申请，通过后提交人将可立即使用此技能。`,
    '通过审核',
    { confirmText: '确认通过' }
  )
  if (!ok) return
  busyRowId.value = row.id
  busyAction.value = 'approve'
  try {
    await approveReviewApplication(row.id, { reviewer: reviewerName.value })
    ElMessage.success('审核已通过')
    detailVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请重试')
  } finally {
    busyRowId.value = null
    busyAction.value = ''
  }
}

const rejectVisible = ref(false)
const rejectTarget = ref(null)
const rejecting = ref(false)

function openReject(row) {
  if (!row || busyRowId.value) return
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
    await rejectReviewApplication(row.id, { reviewer: reviewerName.value, reason })
    ElMessage.success('审核已驳回')
    rejectVisible.value = false
    detailVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请重试')
  } finally {
    rejecting.value = false
    busyRowId.value = null
    busyAction.value = ''
  }
}

/* ---------------- 风险设置 ---------------- */
const riskVisible = ref(false)

onMounted(() => {
  fetchList()
  // 深链：/admin/user-skill-reviews?view=<id>（原整页路由 /:id/view 重定向至此）→ 直接打开抽屉
  const viewId = route.query?.view
  if (viewId) {
    openDetail({ id: String(viewId) })
    router.replace({ query: { ...route.query, view: undefined } })
  }
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="用户技能审核" subtitle="审核用户上传的自定义技能，处理高风险检测记录，并设置风险尺度。" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索技能名称 / 描述 / 提交人"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.scale" placeholder="全部审核尺度" clearable class="lt-filter" @change="reload">
        <el-option v-for="s in scaleOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部审核状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button class="usr-query" @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create usr-risk-btn" @click="riskVisible = true">风险设置</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="没有符合条件的审核记录"
        @retry="fetchList"
      >
        <el-table v-loading="loading" :data="rows" row-key="id" class="usr-table">
          <el-table-column label="技能名称" :min-width="COL.NAME_MIN">
            <template #default="{ row }">
              <span class="usr-name">{{ row.skillName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="描述" prop="description" :min-width="USR_COL.DESC_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="usr-desc">{{ row.description || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="提交人" :width="COL.USER">
            <template #default="{ row }">
              <span class="usr-submitter">{{ row.submitter || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #header>
              <span class="usr-sort-head" role="button" tabindex="0" @click="toggleSort" @keyup.enter="toggleSort">
                提交时间 <span class="usr-sort-icon">{{ sortIcon }}</span>
              </span>
            </template>
            <template #default="{ row }">
              <span class="usr-time">{{ row.submittedAt ? fmtTime(row.submittedAt) : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="审核状态" :width="USR_COL.STATUS" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <UserSkillAuditTag kind="status" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="审核尺度" :width="USR_COL.SCALE">
            <template #default="{ row }">
              <UserSkillAuditTag kind="scale" :value="row.scale" />
            </template>
          </el-table-column>
          <el-table-column label="操作" :min-width="USR_COL.OPS_MIN">
            <template #default="{ row }">
              <div class="usr-ops">
                <el-button link type="primary" class="usr-op" @click="openDetail(row)">查看技能</el-button>
                <template v-if="row.status === 'PENDING'">
                  <el-button
                    link
                    type="primary"
                    class="usr-op"
                    :loading="busyRowId === row.id && busyAction === 'approve'"
                    :disabled="busyRowId === row.id"
                    @click="approve(row)"
                  >通过</el-button>
                  <el-button
                    link
                    type="danger"
                    class="usr-op"
                    :loading="busyRowId === row.id && busyAction === 'reject'"
                    :disabled="busyRowId === row.id"
                    @click="openReject(row)"
                  >驳回</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="fetchList" />

    <!-- 查看技能抽屉（审核动作回到本页统一处理） -->
    <UserSkillAuditDrawer
      v-model:visible="detailVisible"
      :review-id="detailId"
      :busy-key="busyAction"
      @approve="approve"
      @reject="openReject"
    />

    <!-- 驳回弹窗（列表行与抽屉底部共用） -->
    <UserSkillRejectDialog v-model="rejectVisible" :submitting="rejecting" @confirm="submitReject" />

    <!-- 风险设置抽屉 -->
    <RiskSettingsDrawer v-model:visible="riskVisible" />
  </div>
</template>

<style scoped>
.usr-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.usr-desc {
  color: var(--c-text-muted);
}
.usr-submitter,
.usr-time {
  font-size: 13px;
  color: var(--c-text-muted);
}
.usr-sort-head {
  cursor: pointer;
  user-select: none;
}
.usr-sort-icon {
  margin-left: 2px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}
.usr-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.usr-ops :deep(.el-button.is-link.is-disabled) {
  opacity: 0.55;
}
</style>
