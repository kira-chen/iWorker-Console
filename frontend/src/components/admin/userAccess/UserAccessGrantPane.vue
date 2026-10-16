<script setup>
/**
 * 用户访问权限 · 授权名单页签（PRD 06组织/用户访问权限 §三）。
 *
 * 一位员工一行，本机、云端两个运行环境的授权状态在行内各一列（员工端两个环境各开各的，所以各授权各的）。
 * 【设置授权】弹窗里勾选授权给本机、云端或两者，取消勾选已授权的环境就是收回；批量授权同样勾选环境。
 * 「完全访问」是撤掉每步确认的高风险能力：收回要二次确认，已开启的完全访问会立即关闭。
 * 某环境有待处理申请的，该环境的勾选框置灰（只能经【处理申请】的通过 / 驳回改变）；工具栏「待处理申请」按钮（含数量徽标）
 * 点击后只看有待处理申请的员工，再次点击还原全部（同岗位管理的「待分配申请」），行上【处理申请】弹窗里通过 / 驳回，不占单独页签；
 * 已有授权的员工行另有【查看】跳操作记录页签。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import UserAccessScope from '@/components/admin/userAccess/UserAccessScope.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAdminList } from '@/composables/useAdminList'
import UserAccessHandleDialog from '@/components/admin/userAccess/UserAccessHandleDialog.vue'
import { listAccessMembers, updateAccess, batchGrantAccess, getUserAccessOverview } from '@/api/userAccess'
import { ACCESS_STATE, GRANT_SOURCE, ENV_LABEL, OPERATION_ENV } from '@/utils/userAccess'
import { COL, COL_NOWRAP, NA, opsWidth } from '@/utils/tableLayout'

const props = defineProps({
  /** 访问审计「查看」跳转带入的员工用户名，作为初始搜索词 */
  initialKeyword: { type: String, default: '' },
  /** 驾驶舱待办【去处理】带 ?pending=1 进页：进页即只看有待处理申请的员工 */
  initialPending: { type: Boolean, default: false }
})
const emit = defineEmits(['open-operation', 'changed'])

const ENVS = Object.keys(ENV_LABEL) // ['LOCAL', 'CLOUD']

const query = reactive({ keyword: props.initialKeyword, state: '', env: '', hasPendingRequest: props.initialPending })
// 处理申请后置顶高亮的员工（一次性：下次主动查询 / 翻页 / 改筛选时清除，同岗位管理）
const focusUserId = ref(null)
const list = useAdminList(listAccessMembers, {
  params: () => ({ ...query, ...(focusUserId.value != null ? { focusUserId: focusUserId.value } : {}) })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
// 【查询】/ 筛选变化：清置顶、回第 1 页重查
function reload() {
  focusUserId.value = null
  return list.search()
}
const rowClass = ({ row }) => (focusUserId.value != null && row.userId === focusUserId.value ? 'ua-row-focus' : '')
function onPageChange() {
  focusUserId.value = null
  return list.reload()
}
const hasFilter = computed(() => !!(query.keyword.trim() || query.state || query.env || query.hasPendingRequest))
const emptyText = computed(() => (query.hasPendingRequest ? '暂无待处理的权限申请' : hasFilter.value ? '没有符合条件的员工' : '还没有可授权的员工'))

// 工具栏「待处理申请」徽标：全部待处理申请数（0 不展示）
const pendingCount = ref(0)
async function refreshPending() {
  try {
    pendingCount.value = (await getUserAccessOverview()).pendingCount
  } catch {
    // 徽标读失败不影响页面使用
  }
}
function togglePendingFilter() {
  query.hasPendingRequest = !query.hasPendingRequest
  reload()
}

let keywordTimer = null
let skipKeywordWatch = false
watch(() => query.keyword, () => {
  if (skipKeywordWatch) { skipKeywordWatch = false; return }
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(reload, 300)
})
onBeforeUnmount(() => keywordTimer && clearTimeout(keywordTimer))
onMounted(() => {
  list.reload()
  refreshPending()
})

function clearFilters() {
  query.keyword = ''
  query.state = ''
  query.env = ''
  query.hasPendingRequest = false
  reload()
}

function refreshAll() {
  list.reload()
  refreshPending()
  emit('changed')
}

/* ---------- 处理申请 ---------- */
const handling = reactive({ visible: false, member: null })
function openHandle(row) {
  handling.member = row
  handling.visible = true
}

// 通过 / 驳回后：清掉筛选（该员工可能已不在「待处理申请」里），把这位员工置顶高亮，管理员一眼看到处理后的状态（同岗位管理分配后的做法）
function onHandled(userId) {
  if (query.keyword) skipKeywordWatch = true
  query.keyword = ''
  query.state = ''
  query.env = ''
  query.hasPendingRequest = false
  focusUserId.value = userId ?? null
  page.value = 1
  list.search()
  refreshPending()
  emit('changed')
}

/* ---------- 行内判断 ---------- */
const anyEnv = (row, state) => ENVS.some((env) => row.envs[env].state === state)
// 有待处理申请不是授权状态，只是未授权环境上的标记（同岗位管理「未绑定」旁的「待分配」）
const isPending = (row, env) => !!row.envs[env].pendingRequestId
const anyPending = (row) => ENVS.some((env) => isPending(row, env))
const grantedTip = (cell) => `${GRANT_SOURCE[cell.source]} · ${cell.grantedAt} · ${cell.grantedBy}`

/** 「有待处理申请」是并发冲突（弹窗打开后员工才提交了申请）：提示并刷新，行上随即出现【处理申请】。 */
function showError(e, fallback) {
  ElMessage[e?.code === 40900 ? 'warning' : 'error'](e?.message || fallback)
  if (e?.code === 40900) refreshAll()
}

/* ---------- 批量选择 ---------- */
const tableRef = ref(null)
const selected = ref([])
const onSelectionChange = (val) => { selected.value = val }
// 两个环境都已授权或有待处理申请的员工没有可授权的，勾选框置灰
const canSelect = (row) => ENVS.some((env) => row.envs[env].state === 'NONE' && !isPending(row, env))

/* ---------- 设置授权（单个员工） ---------- */
const setting = reactive({ visible: false, target: null, form: { LOCAL: false, CLOUD: false }, submitting: false })

function openSetting(row) {
  setting.target = row
  setting.form = Object.fromEntries(ENVS.map((env) => [env, row.envs[env].state === 'GRANTED']))
  setting.visible = true
}

/** 与打开时相比：新勾选的 = 授权，取消勾选的 = 收回 */
const changes = computed(() => {
  const t = setting.target
  if (!t) return { grant: [], revoke: [] }
  return {
    grant: ENVS.filter((env) => setting.form[env] && t.envs[env].state === 'NONE'),
    revoke: ENVS.filter((env) => !setting.form[env] && t.envs[env].state === 'GRANTED')
  }
})
const hasChange = computed(() => changes.value.grant.length + changes.value.revoke.length > 0)
const names = (envs) => envs.map((env) => ENV_LABEL[env]).join('、')

async function submitSetting() {
  const { grant, revoke } = changes.value
  const t = setting.target
  if (revoke.length) {
    try {
      await ElMessageBox.confirm(
        `确认收回 ${t.name} 在${names(revoke)}的完全访问权限？${t.name} 在${names(revoke)}已开启的完全访问会立即关闭，之后需重新申请或由管理员重新授权`,
        '确认收回',
        { type: 'warning', confirmButtonText: '收回', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  setting.submitting = true
  try {
    await updateAccess(t.userId, { grant, revoke })
    const parts = []
    if (grant.length) parts.push(`已授权在${names(grant)}使用完全访问`)
    if (revoke.length) parts.push(`已收回${names(revoke)}的完全访问权限`)
    ElMessage.success(`${t.name}：${parts.join('，')}`)
    setting.visible = false
    refreshAll()
  } catch (e) {
    setting.visible = false
    showError(e, '保存失败，请稍后重试')
  } finally {
    setting.submitting = false
  }
}

/* ---------- 批量授权 ---------- */
const batch = reactive({ visible: false, envs: [...ENVS], submitting: false })

function openBatch() {
  if (!selected.value.length) {
    ElMessage.warning('请先勾选要批量授权的员工')
    return
  }
  batch.envs = [...ENVS]
  batch.visible = true
}

async function submitBatch() {
  if (!batch.envs.length) return
  batch.submitting = true
  try {
    const res = await batchGrantAccess(selected.value.map((r) => r.userId), batch.envs)
    ElMessage.success(`已完成 ${res.count} 项完全访问授权`)
    // 已授权、有待处理申请的（员工 × 环境）被跳过，提示一句，不要让管理员以为全授权了
    if (res.skipped > 0) ElMessage.warning(`另有 ${res.skipped} 项因已授权或有待处理申请已跳过`)
    batch.visible = false
    tableRef.value?.clearSelection()
    refreshAll()
  } catch (e) {
    batch.visible = false
    showError(e, '批量授权失败，请稍后重试')
  } finally {
    batch.submitting = false
  }
}
</script>

<template>
  <div class="ua-pane">
    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索用户名或显示名" clearable class="lt-search" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.env" placeholder="全部运行环境" clearable class="lt-filter" @change="reload">
        <el-option v-for="(meta, key) in OPERATION_ENV" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <el-select v-model="query.state" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="(meta, key) in ACCESS_STATE" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <!-- 待处理申请筛选：切换只看有待处理申请的员工，含数量徽标（0 不展示），样式同岗位管理的「待分配申请」 -->
      <el-button :class="['lt-pending-btn', { 'is-active': query.hasPendingRequest }]" @click="togglePendingFilter">
        待处理申请<span v-if="pendingCount" class="ua-count">{{ pendingCount }}</span>
      </el-button>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button :class="['lt-batch-btn', { 'is-active': selected.length }]" @click="openBatch">
          批量授权<span v-if="selected.length" class="ua-count">{{ selected.length }}</span>
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates :loading="loading" :error="loadError" :error-message="list.loadErrorMessage" :empty="isEmpty" :empty-text="emptyText" @retry="list.reload">
        <el-table ref="tableRef" v-loading="loading" :data="rows" row-key="userId" :row-class-name="rowClass" @selection-change="onSelectionChange">
          <el-table-column type="selection" width="44" :selectable="canSelect" />
          <!-- 列宽、不换行、空值占位照全站列表规范（utils/tableLayout）；用户名加粗 + 显示名分列，同用户页 -->
          <el-table-column label="用户名" min-width="140" show-overflow-tooltip>
            <template #default="{ row }"><span class="ua-name">{{ row.username }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="显示名" min-width="110" show-overflow-tooltip />
          <el-table-column label="岗位" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.position || NA }}</template>
          </el-table-column>
          <!-- 两个运行环境各一列：已授权的悬停看来源 / 时间 / 授权人 -->
          <el-table-column v-for="env in ENVS" :key="env" :label="`${ENV_LABEL[env]}授权`" :width="COL.STATUS + 90" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <el-tooltip v-if="row.envs[env].state === 'GRANTED'" :content="grantedTip(row.envs[env])" placement="top">
                <span><StatusTag :type="ACCESS_STATE.GRANTED.tag">{{ ACCESS_STATE.GRANTED.label }}</StatusTag></span>
              </el-tooltip>
              <StatusTag v-else :type="ACCESS_STATE[row.envs[env].state].tag">{{ ACCESS_STATE[row.envs[env].state].label }}</StatusTag>
              <!-- 有待处理申请：未授权旁的橙色标记，不是授权状态（同岗位管理「未绑定」旁的「待分配」） -->
              <StatusTag v-if="isPending(row, env)" type="warning" class="ua-pending-tag">待处理</StatusTag>
            </template>
          </el-table-column>
          <!-- 操作：设置授权（勾选本机 / 云端）；任一环境有待处理申请 → 处理申请（弹窗通过 / 驳回）；有授权 → 查看（跳操作记录页签）。tbl-ops 带全站蓝 / 橙链接色 -->
          <el-table-column label="操作" :width="opsWidth(3) + 20" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" @click="openSetting(row)">设置授权</el-button>
                <el-button v-if="anyPending(row)" link type="warning" @click="openHandle(row)">处理申请</el-button>
                <el-button v-if="anyEnv(row, 'GRANTED')" link type="primary" @click="emit('open-operation', row)">查看</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
      <div v-if="isEmpty && hasFilter && !loading && !loadError" class="ua-empty-actions">
        <el-button @click="clearFilters">清空筛选</el-button>
      </div>
    </div>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="onPageChange" />

    <UserAccessHandleDialog v-model:visible="handling.visible" :member="handling.member" @changed="onHandled" />

    <!-- 设置授权：勾选授权给本机、云端或两者；取消勾选已授权的环境即收回 -->
    <el-dialog v-model="setting.visible" title="设置完全访问授权" width="500px" append-to-body>
      <template v-if="setting.target">
        <div class="ua-dlg-info">
          <b>{{ setting.target.name }}</b>（{{ setting.target.username }}）<template v-if="setting.target.position">· {{ setting.target.position }}</template>
        </div>
        <div class="ua-dlg-hint">授权后员工可在员工端对应的运行方式下自行开启完全访问，数字员工将不再逐步征求其确认。本机、云端各授权各的。</div>
        <UserAccessScope compact class="ua-dlg-scope" />
        <div v-for="env in ENVS" :key="env" class="ua-env-row">
          <el-checkbox v-model="setting.form[env]" :disabled="isPending(setting.target, env)">{{ ENV_LABEL[env] }}</el-checkbox>
          <StatusTag :type="ACCESS_STATE[setting.target.envs[env].state].tag">{{ ACCESS_STATE[setting.target.envs[env].state].label }}</StatusTag>
          <span v-if="isPending(setting.target, env)" class="ua-muted">有待处理的申请，请先在【处理申请】里通过或驳回</span>
          <span v-else-if="setting.target.envs[env].state === 'GRANTED' && !setting.form[env]" class="ua-danger">取消勾选将收回，已开启的完全访问会立即关闭</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="setting.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!hasChange" :loading="setting.submitting" @click="submitSetting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量授权：为所选员工授权所选的运行环境，已授权、有待处理申请的自动跳过 -->
    <el-dialog v-model="batch.visible" title="批量授权" width="460px" append-to-body>
      <div class="ua-dlg-info">将为所选 <b>{{ selected.length }}</b> 名员工授权完全访问，请选择运行环境：</div>
      <el-checkbox-group v-model="batch.envs">
        <el-checkbox v-for="env in ENVS" :key="env" :value="env">{{ ENV_LABEL[env] }}</el-checkbox>
      </el-checkbox-group>
      <UserAccessScope compact class="ua-dlg-scope" />
      <div class="ua-dlg-hint">已授权或有待处理申请的环境会自动跳过。授权后员工可在员工端对应的运行方式下自行开启，数字员工将不再逐步征求其确认。</div>
      <template #footer>
        <el-button @click="batch.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!batch.envs.length" :loading="batch.submitting" @click="submitBatch">授权</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ua-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
/* 用户名加粗（同用户页 .users-name） */
.ua-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
/* 待处理申请筛选 / 批量授权按钮激活态与数量徽标：同岗位管理 */
.lt-batch-btn {
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.lt-batch-btn.is-active {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.lt-pending-btn {
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.lt-pending-btn.is-active {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.ua-count {
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
/* 处理申请后置顶高亮行（同岗位管理 .pa-row-focus） */
.ua-pane :deep(.ua-row-focus) td {
  background: var(--c-accent-fill);
}
.ua-pending-tag {
  margin-left: 6px;
}
.ua-muted {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ua-danger {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.ua-empty-actions {
  display: flex;
  justify-content: center;
  padding: 0 var(--space-4) var(--space-5);
  margin-top: calc(-1 * var(--space-6));
}
.ua-dlg-info {
  margin-bottom: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-base);
}
.ua-dlg-hint {
  margin: var(--space-3) 0;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
}
.ua-dlg-scope {
  margin-bottom: var(--space-3);
}
.ua-env-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 36px;
}
.ua-env-row .el-checkbox {
  width: 72px;
}
</style>
