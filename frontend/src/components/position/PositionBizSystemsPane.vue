<script setup>
/**
 * 岗位详情页「业务系统」页签（2026-09-04 PRD-20260903 对齐新增，md 三.8）。
 *
 * - 引用列表：仅展示状态为「已发布」的业务系统（与连接器 bizSystemMock 同源取行；
 *   未发布 / 已停用 / 已被删除的业务系统不出现在列表中）。
 * - 搜索：按系统名称关键词过滤（含描述，照原型 data-position-biz-search 口径）。
 * - 【添加业务系统】：Picker 弹窗，展示所有已发布且未被当前岗位引用的业务系统，
 *   支持按名称搜索，确认后把 ID 写入 businessSystemIds（emit 由父级 patch 到 store，随【保存】落 mock）。
 * - 移除引用：二次确认，仅解除引用不删业务系统本身。
 * - 点系统名称：跳转连接器 › 业务系统详情（AdminConnector?tab=bizsystem&view=<id>，列表页消费 view 打开查看抽屉）。
 * - 只读态：隐藏【添加业务系统】与移除操作。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { listBizSystems } from '@/api/admin'
import { iconIsUrl } from '@/utils/iconDisplay'

const props = defineProps({
  // 当前岗位引用的业务系统 id 列表（store.basic.businessSystemIds）
  businessSystemIds: { type: Array, default: () => [] },
  // 只读态：隐藏添加 / 移除入口
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:businessSystemIds'])

const router = useRouter()

const loading = ref(false)
const loadError = ref(false)
const allRows = ref([]) // 连接器全部业务系统行（含状态）

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const data = await listBizSystems()
    allRows.value = Array.isArray(data) ? data : data?.list || []
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const publishedRows = computed(() => allRows.value.filter((r) => r.status === 'PUBLISHED'))

// 引用列表 = businessSystemIds ∩ 已发布行（保持引用顺序）
const referencedRows = computed(() =>
  (props.businessSystemIds || [])
    .map((id) => publishedRows.value.find((r) => String(r.id) === String(id)))
    .filter(Boolean)
)

/* ---------- 搜索过滤（系统名称 / 描述关键词） ---------- */
const keyword = ref('')
const filteredRows = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return referencedRows.value
  return referencedRows.value.filter((r) =>
    `${r.name} ${r.description || ''}`.toLowerCase().includes(q)
  )
})

/* ---------- 添加业务系统 Picker ---------- */
const pickerOpen = ref(false)
const pickerKeyword = ref('')
const pickedIds = ref([])

const availableRows = computed(() =>
  publishedRows.value.filter((r) => !(props.businessSystemIds || []).some((id) => String(id) === String(r.id)))
)
const pickerRows = computed(() => {
  const q = pickerKeyword.value.trim().toLowerCase()
  if (!q) return availableRows.value
  return availableRows.value.filter((r) => `${r.name} ${r.description || ''}`.toLowerCase().includes(q))
})

function openPicker() {
  pickerKeyword.value = ''
  pickedIds.value = []
  pickerOpen.value = true
}
function togglePick(id) {
  const idx = pickedIds.value.indexOf(id)
  if (idx >= 0) pickedIds.value.splice(idx, 1)
  else pickedIds.value.push(id)
}
function confirmPick() {
  if (!pickedIds.value.length) {
    ElMessage.warning('请选择至少 1 个业务系统')
    return
  }
  const next = [...(props.businessSystemIds || [])]
  pickedIds.value.forEach((id) => {
    if (!next.some((x) => String(x) === String(id))) next.push(id)
  })
  emit('update:businessSystemIds', next)
  pickerOpen.value = false
  ElMessage.success('业务系统已引用')
}

/* ---------- 移除引用（确认后仅解除引用） ---------- */
async function removeRef(row) {
  try {
    await ElMessageBox.confirm(
      `移除后本岗位不再引用「${row.name}」，业务系统本身不会被删除。确认移除？`,
      '移除业务系统引用',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  emit(
    'update:businessSystemIds',
    (props.businessSystemIds || []).filter((id) => String(id) !== String(row.id))
  )
  ElMessage.success('已移除引用')
}

/* ---------- 查看详情：跳连接器 › 业务系统（query.view 由列表页消费打开查看抽屉） ---------- */
function gotoDetail(row) {
  router.push({ name: 'AdminConnector', query: { tab: 'bizsystem', view: row.id } })
}
</script>

<template>
  <div class="pbs">
    <div class="pd-list-head">
      <div class="pd-list-title">业务系统<span class="pd-list-sub">该岗位引用的已发布业务系统 · 未发布或已停用的不展示</span></div>
      <el-button v-if="!readonly" type="primary" size="small" @click="openPicker">添加业务系统</el-button>
    </div>

    <div class="pbs-toolbar">
      <el-input v-model="keyword" placeholder="搜索业务系统名称" clearable class="pbs-search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <div v-if="loadError" class="pd-empty">
      业务系统加载失败
      <el-button link type="primary" @click="load">重试</el-button>
    </div>
    <el-table
      v-else
      v-loading="loading"
      :data="filteredRows"
      class="pd-table"
      :empty-text="referencedRows.length ? '没有匹配的业务系统' : '尚未引用业务系统，点击「添加业务系统」添加已发布业务系统'"
    >
      <el-table-column label="系统名称" min-width="220">
        <template #default="{ row }">
          <span class="pbs-primary">
            <span class="pbs-icon">
              <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="pbs-icon-img" />
              <span v-else>{{ row.icon || '♟' }}</span>
            </span>
            <el-button link type="primary" class="pbs-name" @click="gotoDetail(row)">{{ row.name }}</el-button>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="系统描述" min-width="280" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.description">{{ row.description }}</span>
          <span v-else class="pd-faint">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default><el-tag size="small" type="success" effect="plain">已发布</el-tag></template>
      </el-table-column>
      <el-table-column v-if="!readonly" label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="removeRef(row)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加业务系统 Picker：已发布且未被当前岗位引用 -->
    <el-dialog v-model="pickerOpen" title="添加业务系统" width="620px" append-to-body>
      <p class="pbs-picker-hint">仅展示连接器中已发布、且当前岗位尚未引用的业务系统。</p>
      <el-input v-model="pickerKeyword" placeholder="搜索业务系统名称或描述" clearable class="pbs-picker-search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <div class="pbs-picker-list">
        <label
          v-for="row in pickerRows"
          :key="row.id"
          class="pbs-picker-item"
          :class="{ picked: pickedIds.includes(row.id) }"
        >
          <input type="checkbox" :checked="pickedIds.includes(row.id)" @change="togglePick(row.id)" />
          <span class="pbs-picker-main">
            <strong>{{ row.name }}</strong>
            <small>{{ row.description || '暂无描述' }}</small>
          </span>
          <el-tag size="small" type="success" effect="plain">已发布</el-tag>
        </label>
        <div v-if="!pickerRows.length" class="pd-empty">没有可引用的已发布业务系统</div>
      </div>
      <template #footer>
        <el-button @click="pickerOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!availableRows.length" @click="confirmPick">确认引用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pbs {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pbs-toolbar {
  display: flex;
  align-items: center;
}
.pbs-search {
  width: 280px;
}
.pbs-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.pbs-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  font-size: 15px;
  line-height: 1;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  overflow: hidden;
}
.pbs-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pbs-name {
  font-weight: var(--fw-medium);
}
.pbs-picker-hint {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.pbs-picker-search {
  margin-bottom: var(--space-3);
}
.pbs-picker-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 46vh;
  overflow-y: auto;
}
.pbs-picker-item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  cursor: pointer;
}
.pbs-picker-item.picked {
  border-color: var(--c-accent);
  background: var(--c-accent-soft, var(--bg-sunken));
}
.pbs-picker-item input {
  accent-color: var(--c-accent);
}
.pbs-picker-main strong {
  display: block;
  color: var(--c-text-strong);
}
.pbs-picker-main small {
  display: block;
  margin-top: 2px;
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
