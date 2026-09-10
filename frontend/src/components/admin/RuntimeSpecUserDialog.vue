<script setup>
/**
 * 运行规格个人例外配置弹窗（UI 原型）。岗位批量关系在规格编辑抽屉维护；此处只处理个人覆盖与申请。
 * 复用 03能力/02岗位的标准弹窗、搜索、表格和状态标签范式；审批仅展示触发结果，
 * 真正的通过/驳回仍由 05治理承接。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import {
  listRuntimeSpecUsers,
  assignRuntimeSpecUsers,
  unassignRuntimeSpecUser
} from '@/api/runtimeSpec'

const props = defineProps({
  visible: { type: Boolean, default: false },
  spec: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const activeTab = ref('assigned')
const keyword = ref('')
const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)
const users = ref([])
const selected = ref([])

function toggleSelected(username, checked) {
  if (checked) selected.value = [...new Set([...selected.value, username])]
  else selected.value = selected.value.filter((value) => value !== username)
}

const assignedUsers = computed(() => users.value.filter((u) => u.isCurrent))
const candidateUsers = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return users.value.filter((u) => {
    if (u.isCurrent) return false
    if (!kw) return true
    return [u.username, u.displayName, u.currentSpecName]
      .some((v) => String(v || '').toLowerCase().includes(kw))
  })
})

function approvalText(value) {
  if (value === 'PENDING') return '待审批'
  if (value === 'APPROVED') return '已审批'
  return '已生效'
}

function sourceText(row) {
  if (row.isPending) return '个人申请'
  if (row.source === 'USER') return '个人配置'
  if (row.source === 'POSITION') return `岗位继承${row.positionName ? ` · ${row.positionName}` : ''}`
  return '平台默认'
}

function approvalType(value) {
  if (value === 'PENDING') return 'warning'
  if (value === 'APPROVED') return 'success'
  return 'accent'
}

async function load() {
  if (!props.spec?.id) return
  loading.value = true
  loadError.value = false
  try {
    const data = await listRuntimeSpecUsers(props.spec.id)
    users.value = data?.list || []
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    activeTab.value = 'assigned'
    keyword.value = ''
    selected.value = []
    load()
  }
)

async function saveAssignments() {
  if (!selected.value.length || !props.spec?.id) return
  saving.value = true
  try {
    const result = await assignRuntimeSpecUsers(props.spec.id, selected.value)
    ElMessage.success(`已为 ${result.count} 个用户配置规格，立即生效`)
    selected.value = []
    await load()
    activeTab.value = 'assigned'
    emit('saved')
  } catch (e) {
    ElMessage.error(e?.message || '配置失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

async function removeUser(row) {
  try {
    await ElMessageBox.confirm(
      row.approval === 'PENDING'
        ? `撤回 ${row.displayName} 使用「${props.spec?.name}」的待审批申请？`
        : `解除 ${row.displayName} 的个人配置？解除后将自动回退到岗位规格或平台默认规格。`,
      row.approval === 'PENDING' ? '撤回规格申请' : '解除规格配置',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await unassignRuntimeSpecUser(props.spec.id, row.username)
    ElMessage.success(row.approval === 'PENDING' ? '申请已撤回' : '规格配置已解除')
    await load()
    emit('saved')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请稍后重试')
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`配置范围 · ${spec?.name || ''}`"
    width="760px"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="rsu-summary">
      <div>
        <span class="rsu-summary-label">个人例外目标</span>
        <strong>{{ spec?.name }}</strong>
        <StatusTag type="accent">管理员直接配置</StatusTag>
        <StatusTag :type="spec?.allowUserApply ? 'warning' : 'info'">{{ spec?.allowUserApply ? '开放用户申请' : '关闭用户申请' }}</StatusTag>
      </div>
      <p>{{ spec?.boundaryDesc }}</p>
    </div>

    <el-alert
      title="管理员在此配置后立即生效，不需要用户确认；用户自行申请规格时仍统一进入「05 治理」审批。"
      type="info"
      :closable="false"
      show-icon
      class="rsu-alert"
    />

    <el-tabs v-model="activeTab" class="rsu-tabs">
      <el-tab-pane :label="`生效用户与待审 ${assignedUsers.length}`" name="assigned">
        <div v-if="loading" class="rsu-state"><el-skeleton :rows="5" animated /></div>
        <el-empty v-else-if="loadError" description="用户关系加载失败">
          <el-button type="primary" @click="load">重试</el-button>
        </el-empty>
        <el-empty v-else-if="!assignedUsers.length" description="暂无用户生效或申请此规格" />
        <el-table v-else :data="assignedUsers" max-height="360">
          <el-table-column label="用户" min-width="190">
            <template #default="{ row }">
              <div class="rsu-user-name">{{ row.displayName }}</div>
              <div class="rsu-user-account">{{ row.username }}</div>
            </template>
          </el-table-column>
          <el-table-column label="用户状态" width="100">
            <template #default="{ row }">
              <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="规格来源" min-width="150">
            <template #default="{ row }">{{ sourceText(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <StatusTag :type="approvalType(row.approval)">{{ row.isPending ? approvalText(row.approval) : '已生效' }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button v-if="row.isPending || row.source === 'USER'" link type="danger" @click="removeUser(row)">
                {{ row.approval === 'PENDING' ? '撤回' : '解除' }}
              </el-button>
              <span v-else class="rsu-empty">按{{ row.source === 'POSITION' ? '岗位' : '默认' }}生效</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="添加个人例外" name="available">
        <el-input
          v-model="keyword"
          placeholder="搜索用户名、显示名、岗位或当前规格"
          clearable
          class="rsu-search"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-table :data="candidateUsers" max-height="320" class="rsu-table">
          <el-table-column width="48" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="selected.includes(row.username)"
                :disabled="row.status !== 'active'"
                :aria-label="`选择 ${row.displayName}`"
                @change="toggleSelected(row.username, $event)"
              />
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="180">
            <template #default="{ row }">
              <div class="rsu-user-name">{{ row.displayName }}</div>
              <div class="rsu-user-account">{{ row.username }}</div>
            </template>
          </el-table-column>
          <el-table-column label="当前生效规格" min-width="140">
            <template #default="{ row }">
              <span v-if="row.currentSpecName">{{ row.currentSpecName }}</span>
              <span v-else class="rsu-empty">未配置</span>
            </template>
          </el-table-column>
          <el-table-column label="当前来源" min-width="140">
            <template #default="{ row }">{{ sourceText(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </StatusTag>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!candidateUsers.length" class="rsu-no-result">没有符合条件的可选用户</div>
        <div class="rsu-selection">已选择 {{ selected.length }} 个用户</div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="dialogVisible = false">关闭</el-button>
      <el-button
        v-if="activeTab === 'available'"
        type="primary"
        :loading="saving"
        :disabled="!selected.length"
        @click="saveAssignments"
      >
        确认配置
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rsu-summary {
  padding: var(--space-3) var(--space-4);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.rsu-summary > div {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.rsu-summary-label {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rsu-summary strong {
  color: var(--c-text-strong);
}
.rsu-summary p {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.rsu-alert,
.rsu-tabs {
  margin-top: var(--space-4);
}
.rsu-search {
  width: 320px;
  margin-bottom: var(--space-3);
}
.rsu-table {
  width: 100%;
}
.rsu-user-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.rsu-user-account,
.rsu-empty,
.rsu-selection,
.rsu-no-result {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rsu-selection {
  margin-top: var(--space-3);
  text-align: right;
}
.rsu-no-result {
  padding: var(--space-5);
  text-align: center;
}
.rsu-state {
  padding: var(--space-3);
}
</style>
