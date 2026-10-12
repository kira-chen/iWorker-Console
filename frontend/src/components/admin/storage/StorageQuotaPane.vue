<script setup>
/**
 * 存储空间 · 容量分配页签（PRD 04运行/存储空间 §三）。
 *
 * 默认容量条 + 员工用量列表（搜索 / 状态 / 待处理申请筛选）+ 单个调整 / 批量调整 / 恢复默认。
 * 用量是员工端最近一次统计的快照，这里只读展示；管理端能改的只有容量。
 * 有待处理扩容申请的员工，操作列显示「待处理」（点击跳到扩容申请页签处理），不显示「调整容量」，勾选框也置灰——
 * 这类员工的容量只能经申请的同意 / 拒绝改变；批量设置因此只会作用于没有待处理申请的员工。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAdminList } from '@/composables/useAdminList'
import {
  listStorageMembers,
  getStorageOverview,
  adjustStorageQuota,
  batchAdjustStorageQuota
} from '@/api/storageSpace'
import { STORAGE_STATE, QUOTA_MIN_GB, DEFAULT_QUOTA_GB, quotaInputError, fmtGb } from '@/utils/storageSpace'

const props = defineProps({
  /** 访问审计「查看」跳转带入的员工用户名，作为初始搜索词 */
  initialKeyword: { type: String, default: '' }
})
const emit = defineEmits(['open-request', 'changed'])

const query = reactive({ keyword: props.initialKeyword, state: '', pending: '' })
const list = useAdminList(listStorageMembers, {
  params: () => ({ ...query, pending: query.pending === 'pending' })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const reload = list.search
const hasFilter = computed(() => !!(query.keyword.trim() || query.state || query.pending))
const emptyText = computed(() => (hasFilter.value ? '没有符合条件的员工' : '还没有可分配容量的员工'))

let keywordTimer = null
watch(() => query.keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(reload, 300)
})
onBeforeUnmount(() => keywordTimer && clearTimeout(keywordTimer))

function clearFilters() {
  query.keyword = ''
  query.state = ''
  query.pending = ''
  reload()
}

/* ---------- 默认容量条 ---------- */
const overview = ref({ defaultQuotaGb: DEFAULT_QUOTA_GB, defaultMemberCount: 0, pendingCount: 0 })
async function loadOverview() {
  try {
    overview.value = await getStorageOverview()
  } catch {
    // 概览读失败不阻塞列表：默认容量条保留上一次的值
  }
}
function refreshAll() {
  list.reload()
  loadOverview()
  emit('changed')
}
onMounted(() => {
  list.reload()
  loadOverview()
})

/* ---------- 容量输入弹窗（单个 / 批量两处共用一套输入与校验） ---------- */
const dialog = reactive({ kind: '', visible: false, value: 5, error: '', submitting: false, target: null })
const dialogTitle = computed(() => ({
  single: '调整容量',
  batch: '批量设置容量'
}[dialog.kind] || ''))

function openDialog(kind, target = null) {
  dialog.kind = kind
  dialog.target = target
  dialog.error = ''
  dialog.value = kind === 'single' ? target.totalGb : overview.value.defaultQuotaGb
  dialog.visible = true
}

/** 新总量不超过已用的员工：提交前要二次确认「将进入已满状态」。 */
const overusedTargets = computed(() => {
  if (dialog.kind === 'single') return dialog.target?.usedGb != null && dialog.value <= dialog.target.usedGb ? [dialog.target] : []
  if (dialog.kind === 'batch') return selected.value.filter((r) => r.usedGb != null && dialog.value <= r.usedGb)
  return []
})
/** 调整容量 / 批量设置最小 1 GB，可任意调大调小，不受当前容量限制 */
const minGb = QUOTA_MIN_GB

// 输入框不做取整（不设 precision），小数原样保留，由 quotaInputError 提示，而不是悄悄改成整数
const validate = () => quotaInputError(dialog.value, minGb)

/** 调整后总量不高于已用 → 员工会立刻变成已满，提交前二次确认（调整容量、批量设置、恢复默认共用一句话）。 */
async function confirmFull(who) {
  try {
    await ElMessageBox.confirm(`调整后${who}总量不高于已用，将处于已满状态，任务会被拦截，是否继续？`, '确认调整', {
      type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消'
    })
    return true
  } catch {
    return false
  }
}

/** 「有待处理申请」是并发冲突（列表加载后才有人提交了申请）：关弹窗并刷新列表，行上就会变成【待处理】；其余错误就地展示。 */
function showSubmitError(e, fallback) {
  if (e?.code === 40900) {
    ElMessage.warning(e.message)
    dialog.visible = false
    refreshAll()
    return
  }
  dialog.error = e?.message || fallback
}

async function submitDialog() {
  dialog.error = validate()
  if (dialog.error) return
  if (overusedTargets.value.length) {
    // 批量设置一律写「其中 N 名员工」（哪怕只有 1 人）；单个调整才写员工姓名（md §三·4）
    const who = dialog.kind === 'batch'
      ? `其中 ${overusedTargets.value.length} 名员工的`
      : `${overusedTargets.value[0].name}的`
    if (!(await confirmFull(who))) return
  }
  dialog.submitting = true
  try {
    if (dialog.kind === 'single') {
      await adjustStorageQuota(dialog.target.userId, dialog.value)
      ElMessage.success(`已将 ${dialog.target.name} 的容量调整为 ${dialog.value} GB`)
    } else {
      const ids = selected.value.map((r) => r.userId)
      const res = await batchAdjustStorageQuota(ids, dialog.value)
      ElMessage.success(`已将 ${res.count} 名员工的容量设置为 ${dialog.value} GB`)
      // 列表加载后才有人提交了申请：这类员工被跳过，提示一句，不要让管理员以为全改了
      if (res.skipped > 0) ElMessage.warning(`另有 ${res.skipped} 名员工因有待处理的扩容申请已跳过，请到扩容申请页签处理`)
      tableRef.value?.clearSelection()
    }
    dialog.visible = false
    refreshAll()
  } catch (e) {
    showSubmitError(e, '保存失败，请稍后重试')
  } finally {
    dialog.submitting = false
  }
}

async function restoreDefault() {
  const t = dialog.target
  // 恢复后的默认容量不高于已用量（如 10 GB 的员工已用 7 GB，恢复成 5 GB）→ 先二次确认
  if (t.usedGb != null && overview.value.defaultQuotaGb <= t.usedGb && !(await confirmFull(`${t.name}的`))) return
  dialog.submitting = true
  try {
    await adjustStorageQuota(t.userId, null, { restoreDefault: true })
    ElMessage.success(`${t.name} 已恢复默认容量 ${overview.value.defaultQuotaGb} GB`)
    dialog.visible = false
    refreshAll()
  } catch (e) {
    showSubmitError(e, '操作失败，请稍后重试')
  } finally {
    dialog.submitting = false
  }
}

/* ---------- 批量选择 ---------- */
const tableRef = ref(null)
const selected = ref([])
const onSelectionChange = (val) => { selected.value = val }
// 有待处理申请的员工不可勾选（批量设置只作用于没有待处理申请的员工）
const canSelect = (row) => !row.pendingRequestId

/* ---------- 展示派生 ---------- */
const barStatus = (row) => (row.state === 'FULL' ? 'exception' : row.state === 'WARN' ? 'warning' : '')
const percent = (row) => (row.ratio == null ? 0 : Math.min(100, Math.round(row.ratio * 100)))
</script>

<template>
  <div class="sq-pane">
    <div class="sq-default">
      <span class="sq-default-label">默认容量：<b>{{ overview.defaultQuotaGb }} GB</b>，</span>
      <span class="sq-default-hint">未单独设置容量的员工按此值计算，当前 {{ overview.defaultMemberCount }} 人；单个员工的容量请在列表中调整</span>
    </div>

    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索用户名或显示名" clearable class="lt-search" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.state" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="(meta, key) in STORAGE_STATE" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <el-select v-model="query.pending" placeholder="全部申请" clearable class="lt-filter" @change="reload">
        <el-option label="有待处理申请" value="pending" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" :disabled="!selected.length" @click="openDialog('batch')">
          批量设置容量{{ selected.length ? `（${selected.length}）` : '' }}
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates :loading="loading" :error="loadError" :empty="isEmpty" :empty-text="emptyText" @retry="list.reload">
        <el-table ref="tableRef" v-loading="loading" :data="rows" row-key="userId" @selection-change="onSelectionChange">
          <el-table-column type="selection" width="44" :selectable="canSelect" />
          <el-table-column label="员工" min-width="150">
            <template #default="{ row }">
              <div class="sq-name">{{ row.name }}</div>
              <div class="sq-sub">{{ row.username }}</div>
            </template>
          </el-table-column>
          <el-table-column label="岗位" width="120">
            <template #default="{ row }">{{ row.position || '—' }}</template>
          </el-table-column>
          <el-table-column label="已用 / 总量" min-width="200">
            <template #default="{ row }">
              <div class="sq-usage">{{ fmtGb(row.usedGb) }} / {{ fmtGb(row.totalGb) }}</div>
              <el-progress v-if="row.usedGb != null" :percentage="percent(row)" :status="barStatus(row)" :show-text="false" :stroke-width="6" />
            </template>
          </el-table-column>
          <el-table-column label="最终产物" width="96">
            <template #default="{ row }">
              <span class="sq-muted" title="不可删除，只能靠扩容释放压力">{{ fmtGb(row.finalGb) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="缓存" width="100">
            <template #default="{ row }">
              <span class="sq-muted" title="可由员工自行清理">{{ fmtGb(row.cacheGb) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <StatusTag :type="STORAGE_STATE[row.state].tag">{{ STORAGE_STATE[row.state].label }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="容量来源" width="96">
            <template #default="{ row }">
              <span class="sq-muted">{{ row.quotaSource === 'PERSONAL' ? '个人设置' : '默认' }}</span>
            </template>
          </el-table-column>
          <!-- 操作：有待处理扩容申请 → 「待处理」，点击跳扩容申请页签处理；没有 → 「调整容量」。
               有待处理申请的员工容量只能经申请的同意 / 拒绝改变，所以这类行不出现「调整容量」 -->
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.pendingRequestId" link type="warning" @click="emit('open-request', row)">待处理</el-button>
              <el-button v-else link type="primary" @click="openDialog('single', row)">调整容量</el-button>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
      <div v-if="isEmpty && hasFilter && !loading && !loadError" class="sq-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="list.reload" />

    <el-dialog v-model="dialog.visible" :title="dialogTitle" width="460px" append-to-body>
      <div v-if="dialog.kind === 'single'" class="sq-dlg-info">
        <div><b>{{ dialog.target.name }}</b>（{{ dialog.target.username }}）</div>
        <div class="sq-sub">当前已用 {{ fmtGb(dialog.target.usedGb) }} / 总量 {{ fmtGb(dialog.target.totalGb) }}，
          容量来源：{{ dialog.target.quotaSource === 'PERSONAL' ? '个人设置' : '默认' }}</div>
      </div>
      <div v-else class="sq-dlg-info">
        将统一设置 <b>{{ selected.length }}</b> 名员工的容量
        <span v-if="overusedTargets.length" class="sq-danger">，其中 {{ overusedTargets.length }} 名的已用不低于新总量</span>
      </div>

      <div class="sq-field-label"><b class="sq-required">*</b> 新总量（GB）</div>
      <el-input-number v-model="dialog.value" :min="minGb" :step="1" class="sq-number" />
      <div class="sq-sub">正整数，不小于 {{ minGb }} GB</div>
      <div v-if="dialog.error" class="sq-error">{{ dialog.error }}</div>

      <template #footer>
        <el-button
          v-if="dialog.kind === 'single' && dialog.target.quotaSource === 'PERSONAL'"
          class="sq-restore"
          :disabled="dialog.submitting"
          @click="restoreDefault"
        >恢复默认</el-button>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.submitting" @click="submitDialog">确定</el-button>
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
.sq-default {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.sq-default-label {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.sq-default-hint {
  flex: 1;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
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
.sq-muted {
  color: var(--c-text-muted);
}
.sq-usage {
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--c-text-base);
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
.sq-error,
.sq-danger {
  color: var(--c-danger);
  font-size: var(--fs-xs);
}
.sq-error {
  margin-top: var(--space-2);
}
.sq-restore {
  float: left;
}
</style>
