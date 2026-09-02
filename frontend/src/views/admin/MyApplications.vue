<script setup>
/**
 * 我的申请（2026-09-01 PRD 对齐新增模块：对齐交互原型 v2 renderMyApplications）。
 *
 * 查看和跟踪自己从各业务模块提交的审核申请：
 * - 七列：申请对象(名称+描述) / 业务类型 / 申请类型 / 申请版本 / 申请时间(排序，默认 desc)
 *   / 审核结果(已驳回且有原因时悬停气泡展示原因) / 操作；
 * - 筛选：keyword（域 objectName/description）+ 业务类型 + 申请类型 + 审核结果 + 「查询」按钮；
 * - 操作列：固定【查看】；PENDING 加【撤回】；REJECTED/WITHDRAWN 加【重新提交】
 *   （2026-09-01 疑点1 处置：列表【重新提交】=打开编辑态（底部 关闭|提交审核），
 *    详情底部【重新提交】=直接提交）；
 * - 详情复用业务原生视图（GovObjectDetail 分发；SKILL 跳技能整页 + 吸底操作栏；
 *   OTHER 类型 toast「该申请对象暂无可跳转的业务页面」——疑点2 处置）；
 *   详情底部按状态：PENDING=关闭|撤回申请；APPROVED=仅关闭；REJECTED/WITHDRAWN=
 *   关闭|前往修改|重新提交；编辑态=关闭|提交审核。
 * 数据默认走 mock（api/myApplicationsMock.js，种子=原型 10 条），见 api/myApplications.js。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import GovObjectDetail from '@/components/admin/GovObjectDetail.vue'
import { fmtTime } from '@/utils/docMeta'
import {
  MYAPP_BIZ_TYPE_OPTIONS,
  REQUEST_ACTION_OPTIONS,
  MYAPP_RESULT_OPTIONS,
  myAppBizTypeLabel,
  myAppBizTypeTagType,
  requestActionLabel,
  requestActionTagType,
  myAppResultMeta
} from '@/utils/reviewMeta'
import { confirmWithdrawMyApp, alertResubmitSuccess } from '@/utils/govDialogs'
import {
  listMyApplications,
  withdrawMyApplication,
  resubmitMyApplication
} from '@/api/myApplications'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

const router = useRouter()

// 排序：仅申请时间列，默认 desc（原型口径）
const query = reactive({
  keyword: '',
  businessType: '',
  applicationType: '',
  result: '',
  sortDir: 'desc'
})

const list = useAdminList(listMyApplications, { params: () => ({ ...query }) })
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

function onSortChange({ prop, order }) {
  if (prop !== 'submittedAt') return
  query.sortDir = order === 'ascending' ? 'asc' : 'desc'
  reload()
}

/* ---------------- 详情（业务原生视图，view/edit 双态） ---------------- */
const detailVisible = ref(false)
const detailRow = ref(null)
const detailKind = ref('')
const detailMode = ref('view') // 'view' | 'edit'
const busyKey = ref('') // 'withdraw' | 'resubmit' | 'submit'

// 详情吸底操作栏：编辑态=关闭|提交审核；查看态按审核结果出按钮
const detailButtons = computed(() => {
  const row = detailRow.value
  if (!row) return []
  if (detailMode.value === 'edit') {
    return [
      { key: 'close', label: '关闭' },
      { key: 'submit', label: '提交审核', type: 'primary' }
    ]
  }
  const buttons = [{ key: 'close', label: '关闭' }]
  if (row.result === 'PENDING') buttons.push({ key: 'withdraw', label: '撤回申请', type: 'danger' })
  if (row.result === 'REJECTED' || row.result === 'WITHDRAWN') {
    buttons.push({ key: 'modify', label: '前往修改' })
    buttons.push({ key: 'resubmit', label: '重新提交', type: 'primary' })
  }
  return buttons
})

/**
 * 打开业务原生视图（原型 goBusiness 口径）。
 * @param {Object} row 申请行
 * @param {boolean} edit true=编辑态（列表【重新提交】/详情【前往修改】），false=只读查看
 */
function openDetail(row, edit = false) {
  const t = row.businessType
  if (t === 'OTHER') {
    // 疑点2 处置：OTHER 类型无业务页可跳（原型 toast 文案逐字）
    ElMessage.info('该申请对象暂无可跳转的业务页面')
    return
  }
  if (t === 'SKILL') {
    // 技能 → 整页（复用平台技能路由）+ 吸底操作栏（AdminSkillEditPage 按 query 渲染）
    router.push({
      name: edit ? 'SysConfigSkillEdit' : 'SysConfigSkillView',
      params: { id: String(row.refId) },
      query: { myApp: String(row.id) }
    })
    return
  }
  detailRow.value = row
  detailKind.value = t // EXPERT / POSITION / MCP / API / BIZ_SYSTEM / MODEL 直透
  detailMode.value = edit ? 'edit' : 'view'
  detailVisible.value = true
}

function onDetailAction(key) {
  const row = detailRow.value
  if (!row) return
  if (key === 'close') {
    detailVisible.value = false
  } else if (key === 'withdraw') {
    withdraw(row)
  } else if (key === 'modify') {
    detailMode.value = 'edit'
  } else if (key === 'resubmit' || key === 'submit') {
    resubmit(row, key)
  }
}

/* ---------------- 撤回 / 重新提交 ---------------- */
const busyRowId = ref(null)

async function withdraw(row) {
  if (!(await confirmWithdrawMyApp(row.objectName))) return
  busyRowId.value = row.id
  busyKey.value = 'withdraw'
  try {
    await withdrawMyApplication(row.id)
    ElMessage.success('申请已撤回')
    detailVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busyRowId.value = null
    busyKey.value = ''
  }
}

// 重新提交/提交审核：result→PENDING、刷新申请时间、清空审核人/审核时间/驳回原因（mock 内落实），
// 成功弹「提交成功」对话框（原型 submitAudit 文案逐字）
async function resubmit(row, key = 'resubmit') {
  busyRowId.value = row.id
  busyKey.value = key
  try {
    await resubmitMyApplication(row.id)
    detailVisible.value = false
    fetchList()
    alertResubmitSuccess(row.objectName)
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    busyRowId.value = null
    busyKey.value = ''
  }
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="我的申请" subtitle="查看和跟踪自己从各业务模块提交的审核申请" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索申请对象名称 / 描述"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.businessType" placeholder="全部业务类型" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in MYAPP_BIZ_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="query.applicationType" placeholder="全部申请类型" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in REQUEST_ACTION_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="query.result" placeholder="全部审核结果" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in MYAPP_RESULT_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="暂无申请记录"
        @retry="fetchList"
      >
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          :default-sort="{ prop: 'submittedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <el-table-column label="申请对象" :min-width="COL.NAME_MIN">
            <template #default="{ row }">
              <span class="ma-name">{{ row.objectName }}</span>
              <div v-if="row.description" class="ma-desc" :title="row.description">{{ row.description }}</div>
            </template>
          </el-table-column>
          <el-table-column label="业务类型" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="myAppBizTypeTagType(row.businessType)">
                {{ myAppBizTypeLabel(row.businessType) }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="申请类型" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="requestActionTagType(row.applicationType)">
                {{ requestActionLabel(row.applicationType) }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="申请版本" :width="COL.TAG">
            <template #default="{ row }">{{ row.version || '—' }}</template>
          </el-table-column>
          <el-table-column label="申请时间" prop="submittedAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">{{ row.submittedAt ? fmtTime(row.submittedAt) : '—' }}</template>
          </el-table-column>
          <el-table-column label="审核结果" :width="COL.TAG">
            <template #default="{ row }">
              <!-- 已驳回且有原因：悬停气泡展示驳回原因 -->
              <el-tooltip
                v-if="row.result === 'REJECTED' && row.rejectReason"
                :content="row.rejectReason"
                placement="top"
              >
                <span>
                  <StatusTag :type="myAppResultMeta(row.result).type">
                    {{ myAppResultMeta(row.result).label }}
                  </StatusTag>
                </span>
              </el-tooltip>
              <StatusTag v-else :type="myAppResultMeta(row.result).type">
                {{ myAppResultMeta(row.result).label }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
            <template #default="{ row }">
              <div class="ma-ops">
                <el-button link type="primary" class="ma-op" @click="openDetail(row)">查看</el-button>
                <el-button
                  v-if="row.result === 'PENDING'"
                  link
                  type="danger"
                  class="ma-op"
                  :loading="busyRowId === row.id && busyKey === 'withdraw'"
                  :disabled="busyRowId === row.id"
                  @click="withdraw(row)"
                >
                  撤回
                </el-button>
                <el-button
                  v-if="row.result === 'REJECTED' || row.result === 'WITHDRAWN'"
                  link
                  type="primary"
                  class="ma-op"
                  :disabled="busyRowId === row.id"
                  @click="openDetail(row, true)"
                >
                  重新提交
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

    <!-- 业务原生详情（SKILL 走整页路由、OTHER 走 toast，均不进此组件） -->
    <GovObjectDetail
      v-model:visible="detailVisible"
      :kind="detailKind"
      :ref-id="detailRow?.refId"
      :item="detailRow"
      :readonly="detailMode !== 'edit'"
      :buttons="detailButtons"
      :busy-key="busyKey"
      @action="onDetailAction"
    />
  </div>
</template>

<style scoped>
.ma-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.ma-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 操作列：不换行 + 统一间距（与审核中心同口径） */
.ma-ops {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--space-3);
}
.ma-ops :deep(.el-button + .el-button),
.ma-ops :deep(.el-button) {
  margin: 0;
}
.ma-op {
  font-size: var(--fs-sm);
  white-space: nowrap;
  height: 22px;
  padding: 0;
}
.ma-ops :deep(.el-button.is-link.is-disabled) {
  color: var(--c-text-faint);
}
</style>
