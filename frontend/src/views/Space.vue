<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSpaceStore, precheckFiles, MAX_BATCH } from '@/stores/space'
import { ApiError } from '@/api/request'
import {
  SOURCE_LABEL,
  STATUS_META,
  STATUS_OPTIONS,
  mimeIcon,
  fmtSize,
  fmtTime,
  friendlyError
} from '@/utils/docMeta'
import DocDetailDrawer from '@/components/DocDetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'

const store = useSpaceStore()

/* parseStatus → StatusTag type 映射（枚举见 utils/docMeta STATUS_META，全小写）：
 *   pending 等待处理 → info；parsing 处理中 → warning；
 *   parsed 可使用 → success；failed 处理失败 → danger。
 * 上传中合成行（_upload.status==='uploading'）单独走进度条不进此映射；
 * 上传失败合成行（_upload 且非 uploading）按 failed→danger 呈现「上传失败」。 */
const STATUS_TAG_TYPE = {
  pending: 'info',
  parsing: 'warning',
  parsed: 'success',
  failed: 'danger'
}
function statusTagType(row) {
  if (row._upload) return 'danger' // 上传失败合成行
  return STATUS_TAG_TYPE[row.parseStatus] || 'info'
}
function statusLabel(row) {
  if (row._upload) return '上传失败'
  return STATUS_META[row.parseStatus]?.label || row.parseStatus
}

/* ---------------- 顶部筛选 ---------------- */
const kw = ref('')
const st = ref('all')

function onSearch() {
  store.setFilters({ keyword: kw.value.trim(), status: st.value })
}
function onStatusChange() {
  store.setFilters({ status: st.value })
}

/* ---------------- 容量条 ---------------- */
const cap = computed(() => store.capacity)
const capPercent = computed(() => Math.min(100, Math.round(cap.value.percent || 0)))
const capLevel = computed(() => {
  const p = capPercent.value
  if (p >= 95) return 'danger'
  if (p >= 80) return 'warn'
  return 'ok'
})
const capColor = computed(() => {
  const lv = capLevel.value
  if (lv === 'danger') return 'var(--c-danger)'
  if (lv === 'warn') return 'var(--c-warning)'
  return 'var(--c-accent)'
})

/* ---------------- 上传 ---------------- */
const fileInput = ref(null)
const dragOver = ref(false)

function pickFiles() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = '' // 允许重复选同一文件
  handleFiles(files)
}

function onDrop(e) {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  handleFiles(files)
}

async function handleFiles(files) {
  if (!files.length) return
  // 约束一：单次最多选 MAX_BATCH 个（UI 批量约束，仅就本次选择计数）
  if (files.length > MAX_BATCH) {
    ElMessage.warning(`单次最多上传 ${MAX_BATCH} 个文件，本次超出的 ${files.length - MAX_BATCH} 个未加入`)
    files = files.slice(0, MAX_BATCH)
  }
  // 约束二：容量 / 单文件大小 / 格式白名单预校验（账户上限只看容量 2GB，最终以后端兜底为准）。
  const { accepted, rejected } = precheckFiles(files, cap.value.usedBytes)

  // 被拦截文件逐条提示（精确错误码文案）
  rejected.forEach((r) => {
    ElMessage.error(`${r.name}：${r.error}`)
  })

  if (!accepted.length) return
  await store.uploadFiles(accepted)
}

/* ---------------- 删除 ---------------- */
const deletingId = ref(null)

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      '删除后这份资料将不再被你的搭子引用，且不可恢复，确认删除？',
      '删除资料',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return // 取消
  }
  if (deletingId.value) return // 防重复提交
  deletingId.value = row.docId
  try {
    await store.removeDoc(row.docId)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败，请稍后重试')
  } finally {
    deletingId.value = null
  }
}

/* ---------------- 重新处理 ---------------- */
const retryingId = ref(null)

async function onRetry(row) {
  if (retryingId.value) return
  retryingId.value = row.docId
  try {
    await store.reparse(row.docId)
    ElMessage.success('正在重新处理这份文档…')
  } catch (e) {
    // 1107=处理中无法重新处理，就近提示
    ElMessage.error(e instanceof ApiError ? e.message : '重新处理失败，请稍后重试')
  } finally {
    retryingId.value = null
  }
}

/* ---------------- 详情抽屉 ---------------- */
const drawerVisible = ref(false)
const drawerDocId = ref(null)

function openDetail(row) {
  drawerDocId.value = row.docId
  drawerVisible.value = true
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  store.loadCapacity()
  store.loadList()
})
onBeforeUnmount(() => {
  store.dispose()
})
</script>

<template>
  <div
    class="space-page page-shell"
    :class="{ 'is-drag': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <!-- 拖拽遮罩（覆盖内容区） -->
    <div v-show="dragOver" class="drag-overlay">
      <div class="drag-inner">
        <el-icon class="drag-ic"><UploadFilled /></el-icon>
        <div class="drag-tip">松开即上传</div>
        <div class="drag-sub">支持 PDF / Word / txt / Markdown，单文件 ≤ 50MB</div>
      </div>
    </div>

    <!-- 页面标题 + 岗位化副标题 -->
    <PageHeader title="个人空间" subtitle="你的私有资料库与产物沉淀" />

    <!-- 顶部操作条 -->
    <header class="topbar surface-panel">
      <div class="topbar-left">
        <el-button type="primary" @click="pickFiles">
          <el-icon><UploadFilled /></el-icon>
          <span>上传文档</span>
        </el-button>
        <span class="upload-hint">点击选择，或把文件拖到页面任意处</span>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.md,.markdown"
          class="hidden-input"
          @change="onFileChange"
        />
      </div>

      <div class="topbar-right">
        <!-- 容量条 -->
        <el-tooltip
          :content="`已用 ${fmtSize(cap.usedBytes)}，共 ${fmtSize(cap.totalBytes)}`"
          placement="bottom"
        >
          <div class="cap" :class="`cap-${capLevel}`">
            <div class="cap-text">
              <span class="cap-used mono">{{ fmtSize(cap.usedBytes) }}</span>
              <span class="cap-sep">/</span>
              <span class="cap-total mono">{{ fmtSize(cap.totalBytes) }}</span>
            </div>
            <div class="cap-bar">
              <div
                class="cap-fill"
                :style="{ width: capPercent + '%', background: capColor }"
              ></div>
            </div>
            <span class="cap-pct mono" :style="{ color: capColor }">{{ capPercent }}%</span>
          </div>
        </el-tooltip>

        <el-input
          v-model="kw"
          placeholder="搜索文件名"
          clearable
          class="search-box"
          @keyup.enter="onSearch"
          @clear="onSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>

        <el-select
          v-model="st"
          class="status-sel"
          @change="onStatusChange"
        >
          <el-option
            v-for="o in STATUS_OPTIONS"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
      </div>
    </header>

    <!-- 文档列表（上传中/上传失败任务以合成行内联置顶，进度/状态随流水线推进） -->
    <section class="list-panel surface-panel">
      <div v-if="store.listLoading" class="list-state">
        <el-skeleton :rows="6" animated />
      </div>
      <div v-else-if="store.listError" class="list-state center">
        <el-empty description="加载失败" :image-size="96">
          <el-button @click="store.loadList()">重试</el-button>
        </el-empty>
      </div>
      <div v-else-if="store.displayRows.length === 0" class="list-state center empty-hero">
        <div class="empty-art">
          <el-icon><DocumentAdd /></el-icon>
        </div>
        <div class="empty-tt">这里还空着</div>
        <div class="empty-sub">
          上传你的专属资料，你的搭子就能用上它来帮你办事
        </div>
        <el-button type="primary" class="empty-upload" @click="pickFiles">
          <el-icon><UploadFilled /></el-icon>
          <span>上传第一份文档</span>
        </el-button>
        <div class="empty-formats">支持 PDF / Word / txt / Markdown，单文件 ≤ 50MB</div>
      </div>

      <template v-else>
        <ul class="doc-list">
          <li
            v-for="row in store.displayRows"
            :key="row.docId"
            class="np-row np-row--hover doc-card"
            :class="{ 'is-failed': row.parseStatus === 'failed' }"
          >
            <!-- 类型图标 -->
            <span class="name-ic" :class="`mt-${mimeIcon(row.mimeType).cls}`">
              <el-icon><component :is="mimeIcon(row.mimeType).icon" /></el-icon>
            </span>

            <div class="doc-main">
              <!-- 上排：文件名 + 状态 / 上传进度 + 行尾 hover 操作 -->
              <div class="doc-top">
                <el-tooltip :content="row.name" placement="top" :show-after="400">
                  <span class="name-txt">{{ row.name }}</span>
                </el-tooltip>

                <!-- 上传中合成行：内联进度条 + 百分比 -->
                <div v-if="row._upload && row._upload.status === 'uploading'" class="up-prog">
                  <el-progress
                    :percentage="row._upload.percent"
                    :stroke-width="6"
                    :show-text="false"
                    class="up-prog-bar"
                  />
                  <span class="up-prog-pct mono">{{ row._upload.percent }}%</span>
                </div>
                <!-- 文档/上传失败统一走状态胶囊（失败态 tooltip 展示失败原因） -->
                <el-tooltip
                  v-else
                  :disabled="row.parseStatus !== 'failed'"
                  :content="friendlyError(row.errorReason)"
                  placement="top"
                >
                  <span class="doc-status">
                    <StatusTag :type="statusTagType(row)">{{ statusLabel(row) }}</StatusTag>
                  </span>
                </el-tooltip>

                <!-- 行尾操作（hover 露出；走共享 .np-row-actions 范式） -->
                <div class="np-row-actions doc-ops" @click.stop>
                  <!-- 上传中合成行：取消上传 -->
                  <template v-if="row._upload && row._upload.status === 'uploading'">
                    <el-button link @click="store.cancelTask(row._upload.id)">
                      取消
                    </el-button>
                  </template>
                  <!-- 上传失败合成行：重试上传 + 移除条目 -->
                  <template v-else-if="row._upload">
                    <el-button link type="primary" @click="store.retryTask(row._upload.id)">
                      <el-icon><RefreshRight /></el-icon> 重试
                    </el-button>
                    <el-button link @click="store.dismissTask(row._upload.id)">
                      移除
                    </el-button>
                  </template>
                  <!-- 已落库文档：详情 / 重新处理 / 删除 -->
                  <template v-else>
                    <el-button link type="primary" @click="openDetail(row)">
                      <el-icon><View /></el-icon> 详情
                    </el-button>
                    <el-button
                      v-if="row.parseStatus === 'failed'"
                      link
                      :loading="retryingId === row.docId"
                      @click="onRetry(row)"
                    >
                      <el-icon><RefreshRight /></el-icon> 重新处理
                    </el-button>
                    <el-button
                      link
                      type="danger"
                      class="op-del"
                      :loading="deletingId === row.docId"
                      @click="onDelete(row)"
                    >
                      <el-icon><Delete /></el-icon> 删除
                    </el-button>
                  </template>
                </div>
              </div>

              <!-- 下排：大小 · 来源 · 上传时间（次级灰字） -->
              <div class="doc-meta">
                <span class="meta-item mono">{{ fmtSize(row.size) }}</span>
                <span class="meta-dot">·</span>
                <span class="meta-item">{{ SOURCE_LABEL[row.source] || row.source }}</span>
                <span class="meta-dot">·</span>
                <span class="meta-item mono">{{ fmtTime(row.createdAt) }}</span>
              </div>
            </div>
          </li>
        </ul>

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

    <DocDetailDrawer v-model="drawerVisible" :doc-id="drawerDocId" />
  </div>
</template>

<style scoped>
/* 宽度/居中/内边距统一由 .page-shell 提供（960px） */
.space-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: calc(100vh - 40px);
  position: relative;
}
.surface-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

/* 拖拽热区高亮 */
.space-page.is-drag::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed var(--c-accent);
  border-radius: var(--radius-lg);
  pointer-events: none;
  z-index: var(--z-sticky);
}
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mask);
  border-radius: var(--radius-lg);
  pointer-events: none;
}
.drag-inner {
  text-align: center;
}
.drag-ic {
  font-size: 64px;
  color: var(--c-accent);
}
.drag-tip {
  margin-top: var(--space-3);
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.drag-sub {
  margin-top: 6px;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

/* 顶部操作条 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5); /* 校准为 space-5，与卡片统一 */
  flex-wrap: wrap;
}
.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.upload-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.hidden-input {
  display: none;
}

/* 容量条 */
.cap {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.cap-text {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
.cap-used {
  color: var(--c-text-strong);
}
.cap-sep {
  margin: 0 3px;
}
.cap-bar {
  width: 120px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  overflow: hidden;
}
.cap-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--dur-slow) var(--ease-out), background var(--dur-base);
}
.cap-pct {
  font-size: var(--fs-xs);
  width: 38px;
  text-align: right;
  font-weight: var(--fw-semibold);
}
.search-box {
  width: 200px;
}
.status-sel {
  width: 130px;
}

/* 上传中合成行：内联进度条 + 百分比（行卡内固定宽，不抢文件名空间） */
.up-prog {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  width: 140px;
}
.up-prog-bar {
  flex: 1;
  min-width: 0;
}
.up-prog-pct {
  flex-shrink: 0;
  width: 38px;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  font-weight: var(--fw-semibold);
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
/* 空态：克制的 Notion 图标块，弱底淡边框 */
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
.empty-formats {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
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
.empty-upload {
  margin-top: var(--space-2);
}

/* 文件行卡列表（手写卡片，复用 .np-row / .np-row--hover 范式，与 Tasks 一致观感） */
.doc-list {
  list-style: none;
  margin: 0;
  padding: var(--space-5); /* 卡内 padding 统一 space-5 */
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow-y: auto;
}
.doc-card {
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5); /* 行卡内 padding 与三页统一 */
}
/* 失败行整卡红色淡底突出（替代旧 el-table 整行红底） */
.doc-card.is-failed {
  background: var(--c-danger-soft);
  border-color: var(--c-danger);
}
.doc-card.is-failed:hover {
  background: var(--c-danger-soft);
}

.name-ic {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 16px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  margin-top: 2px;
}
.name-ic.mt-pdf {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.name-ic.mt-word {
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.name-ic.mt-text {
  color: var(--c-success);
  background: var(--c-success-soft);
}

.doc-main {
  flex: 1;
  min-width: 0;
}
.doc-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.name-txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.doc-status {
  flex-shrink: 0;
  display: inline-flex;
}
.doc-ops {
  flex-shrink: 0;
}

.doc-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.meta-dot {
  color: var(--c-text-faint);
}
.mono {
  font-family: var(--font-mono);
}

.op-del:hover {
  color: var(--c-danger);
}
.list-pager {
  padding: var(--space-3);
  border-top: 1px solid var(--border-soft);
  display: flex;
  justify-content: center;
}
</style>
