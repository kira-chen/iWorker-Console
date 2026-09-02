<script setup>
/**
 * V80 用户反馈页（系统管理员 ADMIN 专属；2026-09-01 PRD 对齐改造：对齐交互原型 v2 renderFeedback）。
 *
 * 只读列表（分页）：用户名 / 终端(Mac 蓝·Windows 紫) / 反馈时间(排序，默认 desc) /
 * 反馈内容(截断 + 点击看全文) / 附图。工具栏 搜索用户名/反馈内容 + 全部终端 + 「查询」按钮。
 * 详情弹窗：label/value 明细行（用户/反馈时间/终端）+ 完整内容块 + 底部【关闭】。
 *
 * 附图形态（2026-09-01 疑点1 处置）：保留真实图片缩略图 + ElImageViewer（原型「▧ N」编号
 * 按钮为占位示意不照搬）；附图加载失败时弹窗内展示加载失败提示。
 * 数据默认走 mock（api/feedbackMock.js，种子=原型 4 条，附图为内置 SVG 占位图 blob），
 * 见 api/feedback.js 头注释；真实后端链路（鉴权 fetch 取 blob）保留同形。
 */
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import { listFeedbacks, fetchFeedbackImageBlob } from '@/api/feedback'
import { fmtTime } from '@/utils/docMeta'
import '@/assets/connector.css'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

// 排序：仅反馈时间列，默认 createdAt desc（原型 time-sort 补丁口径）
const query = reactive({ terminal: '', keyword: '', sortDir: 'desc' })

// 缩略图 objectURL：key = `${feedbackId}:${seq}`，value = objectURL；失败置 '' 显占位。
const thumbUrls = reactive({})
let revokable = []   // 本页已创建的 objectURL（含大图），换页/卸载统一 revoke

// 大图查看器状态：urls 为当前反馈全部原图的 objectURL（按 seq 序）。
const viewer = reactive({ visible: false, urls: [], index: 0, loading: false })
const originalCache = new Map()   // feedbackId -> [objectURL]（本页内复用，随 revoke 一并清）
// 附图加载失败提示弹窗（改动清单 8：失败在弹窗内展示提示）
const viewerErrorVisible = ref(false)

// 全文弹窗
const detailRow = ref(null)
const detailVisible = ref(false)

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）：
// 四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护均由其承担，本页只描述「取什么」。
const list = useAdminList(listFeedbacks, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload

const reload = list.search

// 关键词 300ms 防抖（与审核中心同口径），另有「查询」按钮显式触发
let kwTimer = null
watch(
  () => query.keyword,
  () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)

function onSortChange({ prop, order }) {
  if (prop !== 'createdAt') return
  query.sortDir = order === 'ascending' ? 'asc' : 'desc'
  reload()
}

// 拉本页全部缩略图；单张失败只降级该占位，不阻断列表。
// 评审修复（E3）：并发收敛到 6 路——此前每图一个 fetch，一页 20 行×5 图 ≈100 请求突发打爆图片端点。
const THUMB_CONCURRENCY = 6
async function loadThumbs() {
  const tasks = []
  for (const row of rows.value) {
    for (const img of row.images || []) {
      tasks.push({ key: `${row.id}:${img.seq}`, url: img.thumb_url })
    }
  }
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++]
      try {
        const blob = await fetchFeedbackImageBlob(t.url)
        const url = URL.createObjectURL(blob)
        revokable.push(url)
        thumbUrls[t.key] = url
      } catch (e) {
        thumbUrls[t.key] = ''
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(THUMB_CONCURRENCY, tasks.length) }, worker))
}

// 行数据变化（首载/翻页/筛选/排序）后重拉缩略图
watch(rows, () => {
  releaseObjectUrls()
  loadThumbs()
})

// 点缩略图 → 拉该反馈全部原图 → ElImageViewer 看大图（支持多图切换）。
async function openViewer(row, index) {
  if (viewer.loading) return
  viewer.loading = true
  try {
    let urls = originalCache.get(row.id)
    if (!urls) {
      const blobs = await Promise.all((row.images || []).map((img) => fetchFeedbackImageBlob(img.url)))
      urls = blobs.map((b) => {
        const url = URL.createObjectURL(b)
        revokable.push(url)
        return url
      })
      originalCache.set(row.id, urls)
    }
    viewer.urls = urls
    viewer.index = index
    viewer.visible = true
  } catch (e) {
    // 原图加载失败：弹窗内展示加载失败提示（改动清单 8）
    viewerErrorVisible.value = true
  } finally {
    viewer.loading = false
  }
}
function closeViewer() {
  viewer.visible = false
}

function showDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

function terminalLabel(t) {
  if (t === 'MAC') return 'Mac'
  if (t === 'WINDOWS') return 'Windows'
  return t || '—'
}
// 终端标签色（原型：Mac 蓝 / Windows 紫；「蓝」按报告口径映射 accent）
function terminalTagType(t) {
  return t === 'MAC' ? 'accent' : 'purple'
}

function releaseObjectUrls() {
  // 评审修复（A4）：先关大图查看器再吊销——翻页/筛选时若查看器仍开着，其正展示的 objectURL 被 revoke 会裂图。
  viewer.visible = false
  viewer.urls = []
  for (const url of revokable) URL.revokeObjectURL(url)
  revokable = []
  originalCache.clear()
  for (const key of Object.keys(thumbUrls)) delete thumbUrls[key]
}

onMounted(fetchList)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
  releaseObjectUrls()
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="用户反馈" subtitle="查看客户端用户提交的意见反馈与截图附件" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 反馈内容"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="query.terminal"
        placeholder="全部终端"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option label="Mac" value="MAC" />
        <el-option label="Windows" value="WINDOWS" />
      </el-select>
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div v-loading="loading" class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="暂无用户反馈"
        @retry="fetchList"
      >
        <!-- 列序照原型：用户名 / 终端 / 反馈时间 / 反馈内容 / 附图 -->
        <el-table
          :data="rows"
          class="fb-table"
          :default-sort="{ prop: 'createdAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <el-table-column label="用户名" :width="COL.USER" show-overflow-tooltip>
            <template #default="{ row }">{{ row.username || '—' }}</template>
          </el-table-column>
          <el-table-column label="终端" :width="COL.TAG">
            <template #default="{ row }">
              <StatusTag :type="terminalTagType(row.terminal)">
                {{ terminalLabel(row.terminal) }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="反馈时间" prop="createdAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">
              <span class="fb-muted">{{ row.createdAt ? fmtTime(row.createdAt) : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="反馈内容" :min-width="COL.DESC_MIN">
            <template #default="{ row }">
              <div v-if="row.content" class="fb-content" title="点击查看全文" @click="showDetail(row)">
                {{ row.content }}
              </div>
              <span v-else class="fb-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="附图" min-width="300">
            <template #default="{ row }">
              <div v-if="row.images && row.images.length" class="fb-thumbs">
                <button
                  v-for="(img, i) in row.images"
                  :key="img.seq"
                  type="button"
                  class="fb-thumb"
                  :title="`查看第 ${img.seq} 张`"
                  @click="openViewer(row, i)"
                >
                  <img v-if="thumbUrls[`${row.id}:${img.seq}`]" :src="thumbUrls[`${row.id}:${img.seq}`]" alt="" />
                  <el-icon v-else class="fb-thumb-ph"><Picture /></el-icon>
                </button>
              </div>
              <span v-else class="fb-muted">—</span>
            </template>
          </el-table-column>
        </el-table>

        <ListPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="total"
          @change="fetchList"
        />
      </ListStates>
    </div>

    <!-- 全文弹窗（原型 feedback-detail：明细行 + 完整内容块 + 底部【关闭】） -->
    <el-dialog v-model="detailVisible" title="反馈详情" width="560px">
      <template v-if="detailRow">
        <dl class="fb-detail-list">
          <div class="fb-detail-line">
            <dt>用户</dt>
            <dd>{{ detailRow.username || '—' }}</dd>
          </div>
          <div class="fb-detail-line">
            <dt>反馈时间</dt>
            <dd>{{ detailRow.createdAt ? fmtTime(detailRow.createdAt) : '—' }}</dd>
          </div>
          <div class="fb-detail-line">
            <dt>终端</dt>
            <dd>{{ terminalLabel(detailRow.terminal) }}</dd>
          </div>
        </dl>
        <div class="fb-detail-content">{{ detailRow.content || '—' }}</div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 附图加载失败提示弹窗（改动清单 8） -->
    <el-dialog v-model="viewerErrorVisible" title="查看附图" width="420px">
      <div class="fb-viewer-error">附图加载失败，请稍后重试。</div>
      <template #footer>
        <el-button @click="viewerErrorVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 大图查看器（多图切换/缩放；teleported 全屏浮层） -->
    <el-image-viewer
      v-if="viewer.visible"
      :url-list="viewer.urls"
      :initial-index="viewer.index"
      teleported
      @close="closeViewer"
    />
  </div>
</template>

<style scoped>
.fb-table {
  width: 100%;
}
.fb-muted {
  color: var(--c-text-faint);
}
.fb-content {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  cursor: pointer;
  color: var(--c-text);
}
.fb-content:hover {
  color: var(--c-text-strong);
}
.fb-thumbs {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.fb-thumb {
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow: hidden;
  cursor: zoom-in;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.fb-thumb:hover {
  border-color: var(--border-strong);
}
.fb-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.fb-thumb-ph {
  color: var(--c-text-faint);
}
/* 明细行（原型 fm5-detail-list：label/value 两列） */
.fb-detail-list {
  margin: 0 0 var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.fb-detail-line {
  display: flex;
  gap: var(--space-3);
}
.fb-detail-line dt {
  flex-shrink: 0;
  width: 64px;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.fb-detail-line dd {
  margin: 0;
  color: var(--c-text);
  font-size: var(--fs-sm);
}
.fb-detail-content {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--c-text);
  max-height: 50vh;
  overflow-y: auto;
  padding: var(--space-3);
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
}
.fb-viewer-error {
  color: var(--c-text-muted);
  text-align: center;
  padding: var(--space-4) 0;
}
</style>
