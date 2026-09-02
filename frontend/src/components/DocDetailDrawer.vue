<script setup>
import { ref, watch, computed, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { getDocDetail, listChunks } from '@/api/space'
import {
  fmtSize,
  fmtTime,
  SOURCE_LABEL,
  STATUS_META,
  mimeIcon,
  friendlyType,
  friendlyError
} from '@/utils/docMeta'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  docId: { type: [Number, null], default: null }
})
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const tab = ref('meta')

/* ---------------- 元信息 ---------------- */
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref(false)

async function loadDetail() {
  if (props.docId == null) return
  detailLoading.value = true
  detailError.value = false
  try {
    detail.value = await getDocDetail(props.docId)
  } catch (e) {
    detailError.value = true
  } finally {
    detailLoading.value = false
  }
}

/* ---------------- 内容片段（分页/懒加载） ---------------- */
const chunks = ref([])
const chunkTotal = ref(0)
const chunkPage = ref(1)
const chunkSize = 30
const chunksLoading = ref(false)
const chunksError = ref(false)
const noMore = computed(() => chunks.value.length >= chunkTotal.value)

// 在途内容片段请求的取消器：抽屉关闭/切换文档时中断，避免乱序结果与无谓流量
let chunkAborter = null
function abortChunks() {
  if (chunkAborter) {
    chunkAborter.abort()
    chunkAborter = null
  }
}

async function loadChunks(reset = false) {
  if (props.docId == null) return
  if (reset) {
    abortChunks() // 切换文档/重新打开：中断上一文档的在途内容片段请求
    chunks.value = []
    chunkTotal.value = 0
    chunkPage.value = 1
  }
  const aborter = new AbortController()
  chunkAborter = aborter
  chunksLoading.value = true
  chunksError.value = false
  try {
    const data = await listChunks(
      props.docId,
      { page: chunkPage.value, size: chunkSize },
      aborter.signal
    )
    chunks.value.push(...(data?.list || []))
    chunkTotal.value = data?.total || 0
  } catch (e) {
    if (axios.isCancel(e)) return // 主动取消：静默忽略，不置错误态
    chunksError.value = true
  } finally {
    // 仅当结束的是当前在途请求时复位 loading，避免被已取消的旧请求误置
    if (chunkAborter === aborter) {
      chunksLoading.value = false
      chunkAborter = null
    }
  }
}

function loadMore() {
  if (noMore.value || chunksLoading.value) return
  chunkPage.value += 1
  loadChunks()
}

/* 触底自动加载：哨兵进入视口即拉下一页，手动「加载更多」作为兜底 */
const sentinel = ref(null)
let io = null
function setupObserver() {
  teardownObserver()
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) loadMore()
    },
    { threshold: 0.1 }
  )
  io.observe(sentinel.value)
}
function teardownObserver() {
  if (io) {
    io.disconnect()
    io = null
  }
}
// 首次进入「内容片段」Tab 时挂载观察者
watch(tab, (t) => {
  if (t === 'chunks') nextTick(setupObserver)
  else teardownObserver()
})

// 文档是否在处理中（内容片段 Tab 显示「正在处理」提示）
const isParsing = computed(
  () => detail.value && ['pending', 'parsing'].includes(detail.value.parseStatus)
)

watch(
  () => [props.modelValue, props.docId],
  ([open]) => {
    if (open && props.docId != null) {
      tab.value = 'meta'
      detail.value = null
      loadDetail()
      loadChunks(true)
    } else {
      // 抽屉关闭：中断在途内容片段请求
      abortChunks()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  abortChunks()
  teardownObserver()
})
</script>

<template>
  <el-drawer
    v-model="visible"
    title="文档详情"
    direction="rtl"
    size="480px"
    class="doc-drawer"
  >
    <div v-if="detailLoading" class="dd-state">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="detailError" class="dd-state center">
      <el-empty description="详情加载失败" :image-size="80">
        <el-button type="primary" @click="loadDetail">重试</el-button>
      </el-empty>
    </div>

    <template v-else-if="detail">
      <!-- 头部：文件名 + 状态 -->
      <div class="dd-head">
        <div class="dd-icon" :class="`mt-${mimeIcon(detail.mimeType).cls}`">
          <el-icon><component :is="mimeIcon(detail.mimeType).icon" /></el-icon>
        </div>
        <div class="dd-title">
          <div class="dd-name" :title="detail.name">{{ detail.name }}</div>
          <el-tag
            size="small"
            :type="STATUS_META[detail.parseStatus]?.tag"
            effect="light"
            round
          >
            {{ STATUS_META[detail.parseStatus]?.label }}
          </el-tag>
        </div>
      </div>

      <el-tabs v-model="tab" class="dd-tabs">
        <!-- 元信息 -->
        <el-tab-pane label="元信息" name="meta">
          <ul class="meta-list">
            <li><span class="mk">类型</span><span class="mv">{{ friendlyType(detail.mimeType, detail.name) }}</span></li>
            <li><span class="mk">大小</span><span class="mv">{{ fmtSize(detail.size) }}</span></li>
            <li>
              <span class="mk">来源</span><span class="mv">{{ SOURCE_LABEL[detail.source] || detail.source }}</span>
            </li>
            <li>
              <span class="mk">内容片段数</span>
              <span class="mv mono">{{ detail.chunkCount ?? 0 }}</span>
            </li>
            <li><span class="mk">上传时间</span><span class="mv mono">{{ fmtTime(detail.createdAt) }}</span></li>
            <li v-if="detail.parsedAt">
              <span class="mk">处理完成</span><span class="mv mono">{{ fmtTime(detail.parsedAt) }}</span>
            </li>
            <li v-if="detail.errorReason" class="meta-err">
              <span class="mk">失败原因</span><span class="mv">{{ friendlyError(detail.errorReason) }}</span>
            </li>
          </ul>

          <!-- 下载原文件：P2 预留置灰 -->
          <div class="dd-actions">
            <el-tooltip
              content="下载原文件功能即将上线，敬请期待"
              placement="top"
              effect="dark"
            >
              <span class="dl-wrap">
                <el-button disabled plain class="dl-btn">
                  <el-icon><Download /></el-icon>
                  <span>下载原文件</span>
                  <span class="dl-soon">即将上线</span>
                </el-button>
              </span>
            </el-tooltip>
          </div>
        </el-tab-pane>

        <!-- 内容片段 -->
        <el-tab-pane :label="`内容片段 (${chunkTotal})`" name="chunks">
          <div v-if="isParsing" class="chunk-parsing">
            <el-icon class="spin"><Loading /></el-icon>
            <span>正在处理这份文档，完成后会自动显示内容片段…</span>
          </div>

          <template v-else>
            <div v-if="chunksError && chunks.length === 0" class="dd-state center">
              <el-empty description="内容片段加载失败" :image-size="70">
                <el-button type="primary" @click="loadChunks(true)">重试</el-button>
              </el-empty>
            </div>
            <!-- 首屏加载骨架 -->
            <div v-else-if="chunksLoading && chunks.length === 0" class="chunk-skeleton">
              <div v-for="n in 4" :key="n" class="chunk-sk-item">
                <el-skeleton :rows="2" animated />
              </div>
            </div>
            <div
              v-else-if="!chunksLoading && chunks.length === 0"
              class="dd-state center"
            >
              <el-empty description="暂无内容片段" :image-size="70" />
            </div>

            <ul v-else class="chunk-list">
              <li v-for="c in chunks" :key="c.chunkIndex" class="chunk-item">
                <div class="chunk-head">
                  <span class="chunk-idx mono">#{{ c.chunkIndex }}</span>
                  <span v-if="c.metadata?.title" class="chunk-tt">{{ c.metadata.title }}</span>
                  <span v-if="c.metadata?.page != null" class="chunk-pg mono">
                    P{{ c.metadata.page }}
                  </span>
                </div>
                <div class="chunk-body">{{ c.content }}</div>
              </li>
            </ul>

            <!-- 触底哨兵 + 加载/到底反馈 -->
            <div v-if="chunks.length" class="chunk-more">
              <div ref="sentinel" class="chunk-sentinel"></div>
              <span v-if="chunksLoading" class="chunk-loading">
                <el-icon class="spin"><Loading /></el-icon> 加载中…
              </span>
              <el-button
                v-else-if="!noMore"
                link
                type="primary"
                @click="loadMore"
              >
                加载更多
              </el-button>
              <span v-else class="chunk-end">已显示全部 {{ chunkTotal }} 段内容</span>
            </div>
          </template>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>

<style scoped>
.dd-state {
  padding: var(--space-5);
}
.dd-state.center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
}

.dd-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: var(--space-2);
}
.dd-icon {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 22px;
  color: var(--c-text-on-accent);
  background: var(--c-accent);
}
.dd-icon.mt-pdf {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.dd-icon.mt-word {
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.dd-icon.mt-text {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.dd-title {
  min-width: 0;
  flex: 1;
}
.dd-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dd-tabs {
  margin-top: var(--space-2);
}

/* 元信息列表 */
.meta-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.meta-list li {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px dashed var(--border-soft);
  font-size: var(--fs-sm);
}
.mk {
  width: 76px;
  flex-shrink: 0;
  color: var(--c-text-muted);
}
.mv {
  color: var(--c-text-strong);
  word-break: break-all;
}
.mv.mono {
  font-family: var(--font-mono);
}
.meta-err .mv {
  color: var(--c-danger);
}
.dd-actions {
  margin-top: var(--space-5);
}
.dl-wrap {
  display: inline-block;
}

/* 内容片段 */
.chunk-parsing {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--space-6) var(--space-2);
  color: var(--c-accent);
  font-size: var(--fs-sm);
}
.spin {
  animation: rotate 1s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
.chunk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.chunk-item {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  padding: var(--space-3) var(--space-4);
  transition: border-color var(--dur-base), background-color var(--dur-base);
}
.chunk-item:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.chunk-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 6px;
}
.chunk-idx {
  color: var(--c-accent);
  font-size: var(--fs-xs);
  background: var(--c-accent-soft);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.chunk-tt {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chunk-pg {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.chunk-body {
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--c-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.chunk-more {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--space-4) 0 var(--space-2);
}
.chunk-sentinel {
  position: absolute;
  bottom: 40px;
  left: 0;
  right: 0;
  height: 1px;
  pointer-events: none;
}
.chunk-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.chunk-end {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.chunk-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.chunk-sk-item {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  padding: var(--space-3) var(--space-4);
}
.dl-btn :deep(.dl-soon),
.dl-soon {
  margin-left: 8px;
  padding: 1px 7px;
  font-size: var(--fs-xs);
  border-radius: var(--radius-pill);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
</style>
