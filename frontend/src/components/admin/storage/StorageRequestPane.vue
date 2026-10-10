<script setup>
/**
 * 存储空间 · 扩容申请页签（PRD 04运行/存储空间 §四）。
 *
 * 默认只看「待处理」，按提交时间先到先处理。待处理申请可【同意】（填新总量，须大于当前总量）或【拒绝】（原因必填 ≤ 500 字）；
 * 已处理的只读【查看】。申请不进审核中心，由运行侧管理员在这里直接处理。
 * 弹窗打开期间若申请已被别处处理（例如另一位管理员先处理了），提交时提示「该申请已被处理」并刷新，不覆盖。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAdminList } from '@/composables/useAdminList'
import { listExpansionRequests, getExpansionRequest, approveExpansionRequest, rejectExpansionRequest } from '@/api/storageSpace'
import { REQUEST_STATE, REJECT_REASON_MAX as REJECT_MAX, quotaInputError, fmtGb } from '@/utils/storageSpace'


const props = defineProps({
  /** 从容量分配页「待处理」跳转过来时带入的员工用户名，作为初始搜索词（页签 v-if 懒挂载，每次进入都是新挂载，只需在初始化时读一次） */
  focusKeyword: { type: String, default: '' }
})
const emit = defineEmits(['changed'])

// sortOrder：「处理时间」列头箭头，默认倒序（↓），只影响已处理的申请；待处理永远排在前面、先到先处理
const query = reactive({ keyword: props.focusKeyword, status: 'PENDING', sortOrder: 'descending' })
const list = useAdminList(listExpansionRequests, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const reload = list.search
const hasFilter = computed(() => !!(query.keyword.trim() || query.status !== 'PENDING'))
const emptyText = computed(() => (hasFilter.value ? '没有符合条件的申请' : '暂无扩容申请'))

let keywordTimer = null
watch(() => query.keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(reload, 300)
})
onBeforeUnmount(() => keywordTimer && clearTimeout(keywordTimer))
onMounted(list.reload)

function toggleSort() {
  query.sortOrder = query.sortOrder === 'descending' ? 'ascending' : 'descending'
  reload()
}
const sortArrow = computed(() => (query.sortOrder === 'descending' ? '↓' : '↑'))

function clearFilters() {
  query.keyword = ''
  query.status = 'PENDING'
  reload()
}

function done() {
  list.reload()
  emit('changed')
}

/* ---------- 同意 ---------- */
const approve = reactive({ visible: false, request: null, current: null, value: 0, error: '', submitting: false })

async function openApprove(row) {
  approve.error = ''
  try {
    const detail = await getExpansionRequest(row.id)
    approve.request = detail
    approve.current = detail.current
    // 默认预填「当前总量 + 5」，管理员按需改（PRD 四·3）
    approve.value = detail.current.totalGb + 5
    approve.visible = true
  } catch (e) {
    ElMessage.error(e?.message || '加载申请失败，请稍后重试')
  }
}

async function submitApprove() {
  const v = approve.value
  // 输入框不做取整（不设 precision），小数原样保留，由 quotaInputError 提示，而不是悄悄改成整数
  approve.error = quotaInputError(v)
  if (approve.error) return
  if (v <= approve.current.totalGb) { approve.error = `新总量须大于当前总量 ${approve.current.totalGb} GB`; return }
  approve.submitting = true
  try {
    await approveExpansionRequest(approve.request.id, v)
    ElMessage.success(`已同意 ${approve.request.name} 的扩容申请，容量调整为 ${v} GB`)
    approve.visible = false
    done()
  } catch (e) {
    handleConflict(e, approve, (msg) => { approve.error = msg })
  } finally {
    approve.submitting = false
  }
}

/* ---------- 拒绝 ---------- */
const reject = reactive({ visible: false, request: null, reason: '', error: '', submitting: false })

function openReject(row) {
  reject.request = row
  reject.reason = ''
  reject.error = ''
  reject.visible = true
}

async function submitReject() {
  const text = reject.reason.trim()
  if (!text) { reject.error = '请输入拒绝原因'; return }
  if (text.length > REJECT_MAX) { reject.error = `拒绝原因最多 ${REJECT_MAX} 字`; return }
  reject.submitting = true
  try {
    await rejectExpansionRequest(reject.request.id, text)
    ElMessage.success(`已拒绝 ${reject.request.name} 的扩容申请`)
    reject.visible = false
    done()
  } catch (e) {
    handleConflict(e, reject, (msg) => { reject.error = msg })
  } finally {
    reject.submitting = false
  }
}

/** 「已被处理」「申请不存在」（如申请人账号被删）都是并发冲突：关弹窗、刷新列表；其余错误就地展示在弹窗里。 */
function handleConflict(e, dlg, showInline) {
  if (e?.code === 40900 || e?.code === 40400) {
    ElMessage.warning(e.message)
    dlg.visible = false
    done()
    return
  }
  showInline(e?.message || '提交失败，请稍后重试')
}

/* ---------- 查看（已处理） ---------- */
const view = reactive({ visible: false, request: null })
function openView(row) {
  view.request = row
  view.visible = true
}
</script>

<template>
  <div class="sq-pane">
    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索申请人用户名或显示名" clearable class="lt-search" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.status" placeholder="全部状态" class="lt-filter" @change="reload">
        <el-option label="全部状态" value="" />
        <el-option v-for="(meta, key) in REQUEST_STATE" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates :loading="loading" :error="loadError" :empty="isEmpty" :empty-text="emptyText" @retry="list.reload">
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column label="申请人" min-width="90">
            <template #default="{ row }">
              <div class="sq-name">{{ row.name }}</div>
              <div class="sq-sub">{{ row.username }}</div>
            </template>
          </el-table-column>
          <el-table-column label="岗位" width="92">
            <template #default="{ row }">{{ row.position || '—' }}</template>
          </el-table-column>
          <el-table-column label="当前用量" width="172" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">已用 {{ fmtGb(row.current.usedGb) }} / 总量 {{ fmtGb(row.current.totalGb) }}</template>
          </el-table-column>
          <el-table-column label="事实标签" min-width="120">
            <template #default="{ row }">
              <div class="sq-tags">
                <StatusTag v-if="row.cacheCleared" type="info">缓存已清理</StatusTag>
                <StatusTag v-if="row.skippedAutomations" type="warning">{{ row.skippedAutomations }} 个自动化待执行</StatusTag>
                <span v-if="!row.cacheCleared && !row.skippedAutomations" class="sq-muted">—</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="申请说明" min-width="120">
            <template #default="{ row }"><div class="sq-ellipsis" :title="row.reason">{{ row.reason }}</div></template>
          </el-table-column>
          <el-table-column label="状态" width="84">
            <template #default="{ row }">
              <StatusTag :type="REQUEST_STATE[row.status].tag">{{ REQUEST_STATE[row.status].label }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="处理结果" min-width="96">
            <template #default="{ row }">
              <span v-if="row.status === 'APPROVED'">新总量 {{ fmtGb(row.newTotalGb) }}</span>
              <div v-else-if="row.status === 'REJECTED'" class="sq-ellipsis" :title="row.rejectReason">{{ row.rejectReason }}</div>
              <span v-else class="sq-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="处理人" width="92">
            <template #default="{ row }"><span :class="{ 'sq-muted': !row.handler }">{{ row.handler || '—' }}</span></template>
          </el-table-column>
          <!-- 处理时间：排序按钮样式对齐专家页「最近更新时间」，默认降序 -->
          <el-table-column width="150" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #header>
              <button type="button" class="time-sort" @click="toggleSort">
                处理时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }"><span class="sq-muted">{{ row.handledAt || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="116" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'PENDING'">
                <el-button link type="primary" @click="openApprove(row)">同意</el-button>
                <el-button link type="danger" @click="openReject(row)">拒绝</el-button>
              </template>
              <el-button v-else link type="primary" @click="openView(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
      <div v-if="isEmpty && hasFilter && !loading && !loadError" class="sq-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="list.reload" />

    <!-- 同意：只展示员工当前用量（员工可能在申请后自行清出空间，以最新统计为准） -->
    <el-dialog v-model="approve.visible" title="同意扩容" width="500px" append-to-body>
      <template v-if="approve.request">
        <div class="sq-dlg-info">
          <div><b>{{ approve.request.name }}</b>（{{ approve.request.username }}）<template v-if="approve.request.position">· {{ approve.request.position }}</template></div>
          <div class="sq-sub">当前：已用 {{ fmtGb(approve.current.usedGb) }} / 总量 {{ fmtGb(approve.current.totalGb) }}</div>
        </div>
        <div class="sq-quote">{{ approve.request.reason }}</div>
        <div class="sq-field-label"><b class="sq-required">*</b> 新总量（GB）</div>
        <el-input-number v-model="approve.value" :min="QUOTA_MIN_GB" :step="1" class="sq-number" />
        <div class="sq-sub">正整数，不小于 {{ QUOTA_MIN_GB }} GB，须大于当前总量 {{ fmtGb(approve.current.totalGb) }}</div>
        <div v-if="approve.error" class="sq-error">{{ approve.error }}</div>
      </template>
      <template #footer>
        <el-button @click="approve.visible = false">取消</el-button>
        <el-button type="primary" :loading="approve.submitting" @click="submitApprove">确认同意</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reject.visible" title="拒绝扩容" width="500px" append-to-body>
      <template v-if="reject.request">
        <div class="sq-dlg-info"><b>{{ reject.request.name }}</b>（{{ reject.request.username }}）</div>
        <div class="sq-quote">{{ reject.request.reason }}</div>
        <div class="sq-field-label"><b class="sq-required">*</b> 拒绝原因</div>
        <el-input
          v-model="reject.reason"
          type="textarea"
          :rows="4"
          :maxlength="REJECT_MAX"
          show-word-limit
          placeholder="请输入拒绝原因，将展示给申请人"
        />
        <div v-if="reject.error" class="sq-error">{{ reject.error }}</div>
      </template>
      <template #footer>
        <el-button @click="reject.visible = false">取消</el-button>
        <el-button type="danger" :loading="reject.submitting" @click="submitReject">确认拒绝</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="view.visible" title="扩容申请" width="500px" append-to-body>
      <template v-if="view.request">
        <div class="sq-dlg-info">
          <div><b>{{ view.request.name }}</b>（{{ view.request.username }}）<template v-if="view.request.position">· {{ view.request.position }}</template></div>
          <div class="sq-sub">提交于 {{ view.request.submittedAt }}；当前已用 {{ fmtGb(view.request.current.usedGb) }} / 总量 {{ fmtGb(view.request.current.totalGb) }}</div>
        </div>
        <div class="sq-quote">{{ view.request.reason }}</div>
        <div class="sq-dlg-info">
          <StatusTag :type="REQUEST_STATE[view.request.status].tag">{{ REQUEST_STATE[view.request.status].label }}</StatusTag>
          <span v-if="view.request.status === 'APPROVED'">　新总量 {{ fmtGb(view.request.newTotalGb) }}</span>
          <div v-if="view.request.status === 'REJECTED'" class="sq-sub">拒绝原因：{{ view.request.rejectReason }}</div>
          <div class="sq-sub">{{ view.request.handler }} 于 {{ view.request.handledAt }} 处理</div>
        </div>
      </template>
      <template #footer>
        <el-button type="primary" @click="view.visible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sq-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.sq-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.sq-sub {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 时间列排序按钮样式（对齐专家页「最近更新时间」） */
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
.sq-muted {
  color: var(--c-text-muted);
}
.sq-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.sq-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sq-empty-actions {
  display: flex;
  justify-content: center;
  padding: 0 var(--space-4) var(--space-5);
  margin-top: calc(-1 * var(--space-6));
}
.sq-dlg-info {
  margin-bottom: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-base);
}
.sq-quote {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border-left: 3px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.sq-field-label {
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.sq-required {
  color: var(--c-danger);
}
.sq-number {
  width: 160px;
  margin-bottom: var(--space-1);
}
.sq-error {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
