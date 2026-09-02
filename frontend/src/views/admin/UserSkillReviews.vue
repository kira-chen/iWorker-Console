<script setup>
/**
 * 用户技能审核（V94，系统配置模块，SYS_CONFIG/ADMIN）。原「用户上传待确认」更名 + 审核制升级。
 *
 * 客户端用户经 POST /api/market/skill-reviews 提交技能审核（自用 SELF_USE / 平台共享 PLATFORM_SHARE），
 * admin 在本页审核（通过/不通过 + 审核意见）。平台共享通过后技能进入「平台技能」列表走既有发布流程。
 *
 * - 读：GET /api/fde/user-skill-reviews（分页 + status/purpose/keyword 可选）。
 * - 查看：跳既有整页技能查看器（SysConfigSkillView，只读 + 审核态嵌入安全检测结果）。
 * - 审核：POST /api/fde/user-skill-reviews/{id}/review（弹窗填结果 + 意见）。
 */
import { ref, reactive, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { fmtTime } from '@/utils/docMeta'
import { listReviewApplications, reviewApplication } from '@/api/skillReview'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'

const router = useRouter()


const query = reactive({ keyword: '', status: '', purpose: '' })

// 审核弹窗态
const reviewVisible = ref(false)
const reviewing = ref(false)
const reviewTarget = ref(null)
const reviewForm = reactive({ approved: true, comment: '' })

const PURPOSE_LABEL = { SELF_USE: '用户自用', PLATFORM_SHARE: '平台共享' }
const STATUS_LABEL = { PENDING: '审核中', APPROVED: '已通过', REJECTED: '已拒绝' }
function statusTagType(s) {
  return s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'danger' : 'warning'
}
function purposeTagType(p) {
  return p === 'PLATFORM_SHARE' ? 'accent' : 'info'
}

let searchTimer = null
watch(() => query.keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(reload, 300)
})

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）：
// 四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护均由其承担，本页只描述「取什么」。
const list = useAdminList(listReviewApplications, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload

const reload = list.search


// 查看技能内容：跳既有整页技能查看器（审核只读态 + 安全检测结果嵌入），新标签打开。
function openDetail(row) {
  const href = router.resolve({ name: 'SysConfigReviewSkillView', params: { id: row.id } }).href
  window.open(href, '_blank')
}

function openReview(row) {
  reviewTarget.value = row
  reviewForm.approved = true
  reviewForm.comment = ''
  reviewVisible.value = true
}

async function submitReview() {
  if (!reviewTarget.value) return
  reviewing.value = true
  try {
    await reviewApplication(reviewTarget.value.id, {
      approved: reviewForm.approved,
      comment: reviewForm.comment || undefined
    })
    ElMessage.success(reviewForm.approved ? '已通过审核' : '已拒绝')
    reviewVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '审核失败，请重试')
  } finally {
    reviewing.value = false
  }
}

onMounted(fetchList)
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="用户技能审核"
      subtitle="客户端用户提交的技能审核申请。平台共享技能审核通过后进入平台技能列表。"
    />

    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索 技能名称 / 提交用户" clearable class="lt-search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option label="审核中" value="PENDING" />
        <el-option label="已通过" value="APPROVED" />
        <el-option label="已拒绝" value="REJECTED" />
      </el-select>
      <el-select v-model="query.purpose" placeholder="全部用途" clearable class="lt-filter" @change="reload">
        <el-option label="用户自用" value="SELF_USE" />
        <el-option label="平台共享" value="PLATFORM_SHARE" />
      </el-select>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
       
        @retry="fetchList"
      >
        <el-table v-loading="loading" :data="rows" empty-text="暂无技能审核申请" row-key="id">
          <el-table-column prop="skillName" label="技能名称" :min-width="COL.NAME_MIN" />
          <el-table-column label="技能描述" :min-width="COL.DESC_MIN">
            <template #default="{ row }">
              <span v-if="row.skillDescription">{{ row.skillDescription }}</span>
              <span v-else class="usr-na">—</span>
            </template>
          </el-table-column>
          <el-table-column label="技能用途" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="purposeTagType(row.purpose)">{{ PURPOSE_LABEL[row.purpose] || row.purpose }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="审核结果" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="statusTagType(row.reviewStatus)">{{ STATUS_LABEL[row.reviewStatus] || row.reviewStatus }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="提交用户" :width="COL.USER">
            <template #default="{ row }">
              <el-tooltip v-if="row.applicantUserId" :content="`用户 ID：${row.applicantUserId}`" placement="top">
                <span>{{ row.applicantName || row.applicantUserId }}</span>
              </el-tooltip>
              <span v-else class="usr-na">未知</span>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" :width="COL.TIME">
            <template #default="{ row }">{{ row.createdAt ? fmtTime(row.createdAt) : '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">查看</el-button>
              <el-button
                v-if="row.reviewStatus === 'PENDING'"
                link
                type="primary"
                @click="openReview(row)"
              >审核</el-button>
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

    <!-- 审核弹窗（与详情页审核复用同一提交逻辑） -->
    <el-dialog v-model="reviewVisible" title="技能审核" width="440px" :close-on-click-modal="false">
      <p class="usr-review-hint">
        请根据技能内容与客户端上报的风险项给出审核结论。通过后「平台共享」技能将进入平台技能列表。
      </p>
      <el-form label-position="top">
        <el-form-item label="审核结果" required>
          <el-radio-group v-model="reviewForm.approved">
            <el-radio :value="true">通过</el-radio>
            <el-radio :value="false">不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input
            v-model="reviewForm.comment"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
            placeholder="填写审核意见（拒绝时建议说明原因，客户端可回查看到）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewing" @click="submitReview">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.usr-na {
  color: var(--el-text-color-placeholder);
}
.usr-review-hint {
  font-size: 13px;
  color: var(--c-text-muted);
  margin: 0 0 16px;
  line-height: 1.6;
}
</style>
