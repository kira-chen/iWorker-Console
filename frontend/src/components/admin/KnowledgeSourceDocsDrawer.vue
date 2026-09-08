<script setup>
/**
 * 上传类数据源的文档管理抽屉（md §五.3，2026-09-04 PRD-20260903 对齐）。
 *
 * 只管文档清单：多选上传 + 列表（文件名 / 大小 / 切片数 / 解析状态 / 失败原因 / 操作）+ 删除（二次确认，
 * 删除文件、切片和索引内容）；存在解析中任务时每 3 秒自动刷新，全部结束后停止轮询；
 * 顶部汇总文档总数与解析成功数（判断是否满足发布条件）。格式 / 大小不符合的文件在上传前拦截并说明支持范围。
 * 库维度配置（文档类型 / 预处理 / 向量模型 / 检索方式）在「编辑」抽屉（KnowledgeSourceEditor）里改。
 *
 * 【2026-09-09 原型复刻批次 3B · F1/F2/F3】静态形态照原型 openDocs：
 *   F1 上传区改虚线框居中（.kb2-doc-upload：按钮在上、说明在下），表格 margin-top 18；
 *   F2 表格收敛为 5 列（文件名 / 大小 / 切片 / 解析状态 / 操作），失败原因移入状态格第二行
 *      （.kb2-doc-fail-reason 红字 12px + title 悬浮全文）；
 *   F3 标题「文档管理 · 名称」与顶部汇总（md §五.3 定义、原型无）已一致，未改。
 * 上传说明文案随文档类型动态（代码超集，保留）。
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
    // 删除文档前二次确认；确认后删除文件、切片和索引内容（md §五.3；文案照交互原型）
    await ElMessageBox.confirm(`删除文档「${d.fileName}」及其全部切片？`, '删除文档', { type: 'warning', confirmButtonText: '删除' })
  } catch (e) {
    return
  }
  try {
    await deleteKnowledgeDoc(props.source.id, d.id)
    ElMessage.success('文档已删除')
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
      <!-- 顶部汇总文档总数和解析成功数，便于判断是否满足发布条件（md §五.3） -->
      <span class="kdoc-count">共 {{ docs.length }} 篇 · 解析成功 {{ parsedCount }} 篇</span>
    </template>

    <div class="kdoc-body">
      <!-- 上传区照原型 .kb2-doc-upload：虚线框内居中「按钮在上、说明在下」 -->
      <div class="kdoc-upload">
        <el-upload :show-file-list="false" :before-upload="beforeUpload" :http-request="doUpload" :accept="acceptExt.join(',')" multiple>
          <el-button type="primary" :loading="uploading">＋ 选择文件上传</el-button>
        </el-upload>
        <div class="kdoc-hint">
          「{{ DOC_KIND_LABELS[docKind] }}」类型 · 支持 {{ acceptExt.join('、').replaceAll('.', '').toUpperCase() }}，单文件最大 {{ MAX_DOC_MB }}MB；可一次选择多个文件
        </div>
      </div>

      <!-- 5 列（文件名 / 大小 / 切片 / 解析状态 / 操作）；失败原因作为状态格内第二行（原型 .kb2-doc-fail-reason，md §五.3 未定位置） -->
      <el-table v-if="docs.length" :data="docs" size="small" class="kdoc-table">
        <el-table-column label="文件名" prop="fileName" min-width="170" show-overflow-tooltip />
        <el-table-column label="大小" width="90">
          <template #default="{ row }"><span class="kdoc-num">{{ fmtSize(row.size) }}</span></template>
        </el-table-column>
        <el-table-column label="切片" width="76" align="center">
          <template #default="{ row }">
            <span v-if="row.parseStatus === 'PARSED'" class="kdoc-num">{{ row.chunkCount }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>
        <el-table-column label="解析状态" min-width="160">
          <template #default="{ row }">
            <span class="kdoc-status">
              <span class="kdoc-dot" :class="DOC_PARSE_META[row.parseStatus]?.type || 'info'" />
              {{ DOC_PARSE_META[row.parseStatus]?.label || row.parseStatus }}
            </span>
            <span
              v-if="row.parseStatus === 'FAILED' && row.errorReason"
              class="kdoc-fail-reason"
              :title="row.errorReason"
            >{{ row.errorReason }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="64" align="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeDoc(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="kdoc-empty">还没有文档 · 点「＋ 选择文件上传」添加第一篇</div>
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
}
/* 上传区（原型 .kb2-doc-upload{padding:18px;border:1px dashed;border-radius:8px;text-align:center}） */
.kdoc-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px;
  border: 1px dashed var(--border-base);
  border-radius: 8px;
  background: var(--bg-sunken);
  text-align: center;
}
.kdoc-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-muted);
}
/* 表格与上传区间距照原型 style="margin-top:18px" */
.kdoc-table {
  width: 100%;
  margin-top: 18px;
}
.kdoc-empty {
  margin-top: 18px;
}
/* 解析状态格：状态行 + 失败原因第二行（原型 .kb2-doc-status / .kb2-doc-fail-reason） */
.kdoc-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.kdoc-fail-reason {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--c-danger);
  cursor: help;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kdoc-num {
  font-variant-numeric: tabular-nums;
}
/* 状态圆点（原型 .kb2-doc-status:before{width:7px;height:7px}），间距由 .kdoc-status 的 gap 给 */
.kdoc-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
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
.kdoc-empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
</style>
