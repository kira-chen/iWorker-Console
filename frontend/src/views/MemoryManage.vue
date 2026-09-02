<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  useMemoryStore,
  sourceTypeLabel,
  CODE_VERSION_CONFLICT
} from '@/stores/memory'
import { ApiError } from '@/api/request'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const store = useMemoryStore()

/* ---------------- 顶部筛选 ---------------- */
const kw = ref('')
const mt = ref('') // '' = 全部

// 关键词搜索：回车即搜 + 输入防抖
let kwTimer = null
function onKeywordInput() {
  if (kwTimer) clearTimeout(kwTimer)
  kwTimer = setTimeout(() => {
    store.setFilters({ keyword: kw.value.trim() })
  }, 400)
}
function onSearch() {
  if (kwTimer) clearTimeout(kwTimer)
  store.setFilters({ keyword: kw.value.trim() })
}
function onTypeChange() {
  store.setFilters({ memoryType: mt.value })
}

/* ---------------- 行展示辅助 ---------------- */
// 标题优先，空则用内容预览
function rowTitle(row) {
  return (row.title && row.title.trim()) || row.contentPreview || '（无标题）'
}
function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ---------------- 查看详情 ---------------- */
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const viewingId = ref(null)

async function openDetail(row) {
  viewingId.value = row.id
  detailVisible.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await store.fetchDetail(row.id)
  } catch (e) {
    detailVisible.value = false
    ElMessage.error(e instanceof ApiError ? e.message : '加载详情失败，请稍后重试')
  } finally {
    detailLoading.value = false
    viewingId.value = null
  }
}

/* ---------------- 编辑 ---------------- */
const editVisible = ref(false)
const editLoading = ref(false) // 拉取待编辑详情中
const saving = ref(false)
const editingRowId = ref(null)
const tagInput = ref('')
const form = reactive({
  id: null,
  content: '',
  title: '',
  memoryType: '',
  tags: [],
  version: null
})

const contentValid = computed(() => form.content.trim().length > 0)

async function openEdit(row) {
  editingRowId.value = row.id
  editVisible.value = true
  editLoading.value = true
  resetForm()
  try {
    const d = await store.fetchDetail(row.id)
    fillForm(d)
  } catch (e) {
    editVisible.value = false
    ElMessage.error(e instanceof ApiError ? e.message : '加载详情失败，请稍后重试')
  } finally {
    editLoading.value = false
    editingRowId.value = null
  }
}

function resetForm() {
  form.id = null
  form.content = ''
  form.title = ''
  form.memoryType = ''
  form.tags = []
  form.version = null
  tagInput.value = ''
}

function fillForm(d) {
  if (!d) return
  form.id = d.id
  form.content = d.content || ''
  form.title = d.title || ''
  form.memoryType = d.memoryType || ''
  form.tags = Array.isArray(d.tags) ? [...d.tags] : []
  form.version = d.version
}

function addTag() {
  const v = tagInput.value.trim()
  if (v && !form.tags.includes(v)) form.tags.push(v)
  tagInput.value = ''
}
function removeTag(t) {
  form.tags = form.tags.filter((x) => x !== t)
}

async function submitEdit() {
  if (!contentValid.value) {
    ElMessage.warning('请填写记忆内容')
    return
  }
  saving.value = true
  try {
    await store.updateMemory(form.id, {
      content: form.content.trim(),
      title: form.title.trim(),
      tags: form.tags,
      memoryType: form.memoryType,
      version: form.version
    })
    ElMessage.success('已保存')
    editVisible.value = false
  } catch (e) {
    // 乐观锁版本冲突：友好提示并重拉详情回填最新版本，供用户重试
    if (e instanceof ApiError && e.code === CODE_VERSION_CONFLICT) {
      ElMessage.warning('记忆已变更，请刷新后重试')
      try {
        const fresh = await store.fetchDetail(form.id)
        fillForm(fresh)
      } catch (_) {
        editVisible.value = false
      }
      // 冲突后同步刷新列表，保证列表与最新一致
      store.loadList()
    } else {
      ElMessage.error(e instanceof ApiError ? e.message : '保存失败，请稍后重试')
    }
  } finally {
    saving.value = false
  }
}

/* ---------------- 删除 ---------------- */
const deletingId = ref(null)

async function onDelete(row) {
  try {
    await ElMessageBox.confirm('确认删除这条记忆？删除后不可恢复', '删除记忆', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch (e) {
    return // 取消
  }
  if (deletingId.value) return
  deletingId.value = row.id
  try {
    await store.removeMemory(row.id)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败，请稍后重试')
  } finally {
    deletingId.value = null
  }
}

/* ---------------- 返回设置 ---------------- */
function backToSettings() {
  router.push({ name: 'Settings' })
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  await store.loadTypes()
  // store 为应用级单例，每次进入重置筛选（page 复位 1 + 清空筛选），
  // 保证筛选条（本地 kw/mt 恒为空）与列表（全量）一致。
  // setFilters 内部已 loadList，进页只发一次列表请求，勿再额外调用。
  store.setFilters({ keyword: '', memoryType: '' })
})

onBeforeUnmount(() => {
  // 清理未触发的防抖定时器，避免离开页后多余一次 loadList
  if (kwTimer) clearTimeout(kwTimer)
})
</script>

<template>
  <div class="mem-page">
    <!-- 顶部标题 + 返回 -->
    <PageHeader title="个人记忆" subtitle="记住你的偏好与业务上下文">
      <template #actions>
        <el-button @click="backToSettings">
          <el-icon><Back /></el-icon>
          <span>返回设置</span>
        </el-button>
      </template>
    </PageHeader>

    <!-- 筛选条 -->
    <section class="topbar surface-panel">
      <el-select
        v-model="mt"
        class="type-sel"
        placeholder="全部类型"
        @change="onTypeChange"
      >
        <el-option label="全部类型" value="" />
        <el-option
          v-for="t in store.types"
          :key="t.code"
          :label="t.label"
          :value="t.code"
        />
      </el-select>

      <el-input
        v-model="kw"
        placeholder="搜索标题或内容"
        clearable
        class="search-box"
        @input="onKeywordInput"
        @keyup.enter="onSearch"
        @clear="onSearch"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </section>

    <!-- 列表 -->
    <section class="list-panel surface-panel">
      <div v-if="store.loading" class="list-state">
        <el-skeleton :rows="6" animated />
      </div>
      <div v-else-if="store.error" class="list-state center">
        <el-empty description="加载失败" :image-size="96">
          <el-button @click="store.loadList()">重试</el-button>
        </el-empty>
      </div>
      <div v-else-if="store.list.length === 0" class="list-state center empty-hero">
        <div class="empty-art">
          <el-icon><Files /></el-icon>
        </div>
        <div class="empty-tt">还没有记忆</div>
        <div class="empty-sub">
          当你和搭子交流时，它会在这里记住对你有用的信息
        </div>
      </div>

      <template v-else>
        <el-table :data="store.list" class="mem-table" row-key="id">
          <el-table-column label="类型" width="110">
            <template #default="{ row }">
              <StatusTag type="accent">{{ store.typeLabel(row.memoryType) }}</StatusTag>
            </template>
          </el-table-column>

          <el-table-column label="内容" min-width="280">
            <template #default="{ row }">
              <el-tooltip :content="rowTitle(row)" placement="top" :show-after="500">
                <span class="cell-title">{{ rowTitle(row) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>

          <el-table-column label="来源" width="110">
            <template #default="{ row }">
              <span class="src-pill">{{ sourceTypeLabel(row.sourceType) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="更新时间" width="160">
            <template #default="{ row }">
              <span class="mono dim">{{ fmtTime(row.updatedAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :loading="viewingId === row.id"
                @click="openDetail(row)"
              >
                <el-icon><View /></el-icon> 查看
              </el-button>
              <el-button
                link
                :loading="editingRowId === row.id"
                @click="openEdit(row)"
              >
                <el-icon><Edit /></el-icon> 编辑
              </el-button>
              <el-button
                link
                type="danger"
                :loading="deletingId === row.id"
                @click="onDelete(row)"
              >
                <el-icon><Delete /></el-icon> 删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="store.total > store.size" class="list-pager">
          <el-pagination
            layout="prev, pager, next, total"
            :total="store.total"
            :page-size="store.size"
            :current-page="store.page"
            @current-change="store.setPage"
          />
        </div>
      </template>
    </section>

    <!-- 查看详情 -->
    <el-dialog v-model="detailVisible" title="记忆详情" width="600px" class="mem-dialog">
      <div v-if="detailLoading" class="dlg-loading">
        <el-skeleton :rows="5" animated />
      </div>
      <div v-else-if="detail" class="detail-body">
        <div class="detail-meta">
          <span class="meta-chip">
            <span class="meta-k">类型</span>
            <StatusTag type="accent">{{ store.typeLabel(detail.memoryType) }}</StatusTag>
          </span>
          <span class="meta-chip">
            <span class="meta-k">来源</span>
            <span class="meta-v">{{ sourceTypeLabel(detail.sourceType) }}</span>
          </span>
          <span v-if="detail.confidence != null" class="meta-chip">
            <span class="meta-k">置信度</span>
            <span class="meta-v">{{ detail.confidence }}</span>
          </span>
        </div>

        <div v-if="detail.title" class="detail-title">{{ detail.title }}</div>
        <div class="detail-content">{{ detail.content }}</div>

        <div v-if="detail.tags && detail.tags.length" class="detail-tags">
          <el-tag
            v-for="t in detail.tags"
            :key="t"
            size="small"
            type="info"
            effect="plain"
            disable-transitions
          >{{ t }}</el-tag>
        </div>

        <div class="detail-times">
          <span v-if="detail.eventTime">事件时间：{{ fmtTime(detail.eventTime) }}</span>
          <span v-if="detail.dueTime">截止时间：{{ fmtTime(detail.dueTime) }}</span>
          <span>创建：{{ fmtTime(detail.createdAt) }}</span>
          <span>更新：{{ fmtTime(detail.updatedAt) }}</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog
      v-model="editVisible"
      title="编辑记忆"
      width="600px"
      class="mem-dialog"
      :close-on-click-modal="false"
    >
      <div v-if="editLoading" class="dlg-loading">
        <el-skeleton :rows="5" animated />
      </div>
      <el-form v-else label-position="top" class="edit-form">
        <el-form-item label="内容" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            maxlength="2000"
            show-word-limit
            placeholder="这条记忆的完整内容"
          />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="120" placeholder="可选，便于快速识别" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.memoryType" class="full" placeholder="选择类型">
            <el-option
              v-for="t in store.types"
              :key="t.code"
              :label="t.label"
              :value="t.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <div class="tag-edit">
            <el-tag
              v-for="t in form.tags"
              :key="t"
              closable
              size="small"
              disable-transitions
              @close="removeTag(t)"
            >{{ t }}</el-tag>
            <el-input
              v-model="tagInput"
              class="tag-input"
              size="small"
              placeholder="输入后回车添加"
              @keyup.enter="addTag"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="editLoading || !contentValid"
          @click="submitEdit"
        >保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mem-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: calc(100vh - 40px);
}
.surface-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

/* 筛选条 */
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  flex-wrap: wrap;
}
.type-sel {
  width: 160px;
}
.search-box {
  width: 240px;
}

/* 列表 */
.list-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.list-state {
  padding: var(--space-6) var(--space-5);
}
.list-state.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.empty-hero {
  gap: var(--space-3);
  text-align: center;
}
.empty-art {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-xl);
  font-size: 34px;
  color: var(--c-text-faint);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
}
.empty-tt {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.empty-sub {
  max-width: 420px;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}

.mem-table {
  flex: 1;
  background: transparent;
}
.cell-title {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-strong);
  vertical-align: bottom;
}
.src-pill {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  padding: 2px 10px;
  border-radius: var(--radius-pill);
}
.mono {
  font-family: var(--font-mono);
}
.dim {
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.list-pager {
  padding: var(--space-3);
  border-top: 1px solid var(--border-soft);
  display: flex;
  justify-content: center;
}

/* 弹窗 */
.dlg-loading {
  padding: var(--space-2) 0;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.meta-k {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.meta-v {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.detail-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.detail-content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: var(--lh-base);
  color: var(--c-text);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  max-height: 320px;
  overflow-y: auto;
}
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.detail-times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 编辑表单 */
.edit-form .full {
  width: 100%;
}
.tag-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.tag-input {
  width: 140px;
}
</style>
