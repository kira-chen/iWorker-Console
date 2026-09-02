<script setup>
/**
 * 上传类数据源的文档管理抽屉（2026-08-31 负责人定：与库维度配置拆开，列表入口层面分开）。
 *
 * 只管文档清单：列表（解析状态轮询）+ 上传 + 删除；库维度配置（文档类型 / 预处理 / Embedding / 检索策略）
 * 在「配置」抽屉（KnowledgeSourceEditor）里改。外壳用 DrawerEditor 只读态（底部仅「关闭」）。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { listKnowledgeDocs, uploadKnowledgeDoc, deleteKnowledgeDoc } from '@/api/knowledgeBase'
import { ACCEPT_BY_DOC_KIND, DOC_KIND_LABELS, MAX_DOC_MB, DOC_PARSE_META } from '@/utils/knowledgeBaseMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 目标数据源（上传类），取自列表行 VO：需要 id / name / config.docKind */
  source: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'changed'])

const loading = ref(false)
const loadError = ref('')
const docs = ref([])
const uploading = ref(false)
let pollTimer = null

const docKind = computed(() => props.source?.config?.docKind || 'DOC')
const acceptExt = computed(() => ACCEPT_BY_DOC_KIND[docKind.value] || ACCEPT_BY_DOC_KIND.DOC)
const parsedCount = computed(() => docs.value.filter((d) => d.parseStatus === 'PARSED').length)

async function load() {
  if (!props.source?.id) return
  loadError.value = ''
  loading.value = true
  try {
    docs.value = await listKnowledgeDocs(props.source.id)
    schedulePoll()
  } catch (e) {
    loadError.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}
async function refresh() {
  // 轮询用的静默刷新（不打骨架）
  docs.value = await listKnowledgeDocs(props.source.id).catch(() => docs.value)
  schedulePoll()
}
function schedulePoll() {
  stopPolling()
  if (docs.value.some((d) => ['PENDING', 'PARSING'].includes(d.parseStatus))) pollTimer = setTimeout(refresh, 3000)
}
function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}
onBeforeUnmount(stopPolling)
watch(
  () => props.visible,
  (v) => {
    if (!v) {
      stopPolling()
      return
    }
    docs.value = []
    load()
  }
)

function beforeUpload(file) {
  const ext = `.${(file.name.split('.').pop() || '').toLowerCase()}`
  if (!acceptExt.value.includes(ext)) {
    ElMessage.error(`不支持的格式：「${DOC_KIND_LABELS[docKind.value]}」类型仅接受 ${acceptExt.value.join(' / ')}`)
    return false
  }
  if (file.size > MAX_DOC_MB * 1024 * 1024) {
    ElMessage.error(`文件过大：单个不超过 ${MAX_DOC_MB} MB`)
    return false
  }
  return true
}
async function doUpload({ file }) {
  uploading.value = true
  try {
    await uploadKnowledgeDoc(props.source.id, file)
    ElMessage.success(`已上传「${file.name}」，正在解析`)
    await refresh()
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}
async function removeDoc(d) {
  try {
    await ElMessageBox.confirm(`删除文档「${d.fileName}」及其全部切片？`, '删除文档', { type: 'warning', confirmButtonText: '删除' })
  } catch (e) {
    return
  }
  try {
    await deleteKnowledgeDoc(props.source.id, d.id)
    ElMessage.success('已删除')
    await refresh()
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}
function fmtSize(n) {
  if (!n) return '—'
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    :title="`文档管理 · ${source?.name || ''}`"
    readonly
    :loading="loading"
    :error="loadError"
    @update:visible="close"
    @retry="load"
  >
    <template #title-extra>
      <span class="kdoc-count">{{ docs.length }} 篇 · 已解析 {{ parsedCount }}</span>
    </template>

    <div class="kdoc-body">
      <div class="kdoc-toolbar">
        <el-upload :show-file-list="false" :before-upload="beforeUpload" :http-request="doUpload" :accept="acceptExt.join(',')" multiple>
          <el-button type="primary" :loading="uploading">上传文档</el-button>
        </el-upload>
        <span class="kdoc-hint">
          「{{ DOC_KIND_LABELS[docKind] }}」类型 · 支持 {{ acceptExt.join(' / ') }}，单个 ≤ {{ MAX_DOC_MB }} MB；上传后自动解析并切片
        </span>
      </div>

      <el-table v-if="docs.length" :data="docs" size="small" class="kdoc-table">
        <el-table-column label="文件名" prop="fileName" min-width="180" show-overflow-tooltip />
        <el-table-column label="大小" width="90">
          <template #default="{ row }"><span class="kdoc-num">{{ fmtSize(row.size) }}</span></template>
        </el-table-column>
        <el-table-column label="切片" width="70" align="center">
          <template #default="{ row }">
            <span v-if="row.parseStatus === 'PARSED'" class="kdoc-num">{{ row.chunkCount }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>
        <el-table-column label="解析状态" min-width="150">
          <template #default="{ row }">
            <span class="kdoc-dot" :class="DOC_PARSE_META[row.parseStatus]?.type || 'info'" />
            {{ DOC_PARSE_META[row.parseStatus]?.label || row.parseStatus }}
            <span v-if="row.parseStatus === 'FAILED' && row.errorReason" class="kdoc-err">：{{ row.errorReason }}</span>
          </template>
        </el-table-column>
        <el-table-column width="64" align="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeDoc(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="kdoc-empty">还没有文档 · 点「上传文档」添加第一篇</div>
    </div>
  </DrawerEditor>
</template>

<style scoped>
.kdoc-count {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
}
.kdoc-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.kdoc-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.kdoc-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.kdoc-table {
  width: 100%;
}
.kdoc-num {
  font-variant-numeric: tabular-nums;
}
.kdoc-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--c-text-faint);
}
.kdoc-dot.success {
  background: var(--c-success);
}
.kdoc-dot.warning {
  background: var(--c-warning);
}
.kdoc-dot.danger {
  background: var(--c-danger);
}
.kdoc-err {
  color: var(--c-danger);
}
.kdoc-empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
</style>
