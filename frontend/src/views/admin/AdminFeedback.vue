<script setup>
/**
 * V80 用户反馈页（系统管理员 ADMIN 专属；2026-09-01 PRD 对齐改造：对齐交互原型 v2 renderFeedback）。
 *
 * 只读列表（分页）：用户名 / 终端(Mac 蓝·Windows 紫) / 反馈时间(排序，默认 desc) /
 * 反馈内容(截断 + 点击看全文) / 附图。工具栏 搜索用户名/反馈内容 + 全部终端 + 「查询」按钮。
 * 详情弹窗（F-2，原型 feedback-detail L1671 + P.openDialog L1553）：520px；明细项 label 在上 / 值在下
 * （用户 / 反馈时间 / 终端）+ 完整内容 pre-wrap 纯文本（无底色框）+ 底部仅【关闭】。
 *
 * 附图形态（2026-09-08 原型复刻批次 2B · F-1，负责人 09-08 复刻口径覆盖 09-01「保留 ElImageViewer」裁决）：
 * - 附图列照原型 L1566 / md §三：48px 方块编号按钮「▧ N」（不再预拉缩略图）；
 * - 点击 → 「查看附图」弹窗（原型 feedback-image L1672 / md §五）：680px、360px 大图预览区（放真实原图，
 *   原型占位文案不搬）+ 附件序号「反馈截图 N」+ 底部仅【关闭】；原图加载失败在弹窗预览区内展示失败提示
 *   （md §七）；ElImageViewer 全屏浮层退役。
 * 2026-09-08 批次 2B（G-5）：反馈时间列头改原型文字箭头「反馈时间 ↓/↑」（列头插槽自管排序态）。
 * 数据默认走 mock（api/feedbackMock.js，种子=原型 4 条，附图为内置 SVG 占位图 blob），
 * 见 api/feedback.js 头注释；真实后端链路（鉴权 fetch 取 blob）保留同形。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
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

let revokable = []   // 本页已创建的原图 objectURL，换页/卸载统一 revoke

// 「查看附图」弹窗状态：seq = 附件序号（1 起）；url = 原图 objectURL；error = 加载失败（弹窗内提示）
const viewer = reactive({ visible: false, seq: 0, url: '', loading: false, error: false })
const originalCache = new Map()   // `${feedbackId}:${seq}` -> objectURL（本页内复用，随 revoke 一并清）

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

// 反馈时间列头（原型 L1566 `<button class="sort">反馈时间 ↓</button>`）：点击切正倒序并回第 1 页（feedback-sort）
function toggleSort() {
  query.sortDir = query.sortDir === 'desc' ? 'asc' : 'desc'
  reload()
}
const sortArrow = computed(() => (query.sortDir === 'asc' ? '↑' : '↓'))

// 行数据变化（首载/翻页/筛选/排序）后释放上一页的原图 objectURL
watch(rows, () => {
  releaseObjectUrls()
})

// 点编号按钮「▧ N」→ 打开「查看附图」弹窗 → 拉该张原图放进预览区；失败在预览区内提示（md §七）。
async function openViewer(row, img) {
  viewer.seq = img.seq
  viewer.url = ''
  viewer.error = false
  viewer.visible = true
  const key = `${row.id}:${img.seq}`
  const cached = originalCache.get(key)
  if (cached) {
    viewer.url = cached
    return
  }
  viewer.loading = true
  try {
    const blob = await fetchFeedbackImageBlob(img.url)
    const url = URL.createObjectURL(blob)
    revokable.push(url)
    originalCache.set(key, url)
    // 弹窗仍开着且仍是这张时才落地（快速切换时防串图）
    if (viewer.visible && viewer.seq === img.seq) viewer.url = url
  } catch (e) {
    if (viewer.visible && viewer.seq === img.seq) viewer.error = true
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
  // 评审修复（A4）：先关附图弹窗再吊销——翻页/筛选时若弹窗仍开着，其正展示的 objectURL 被 revoke 会裂图。
  viewer.visible = false
  viewer.url = ''
  for (const url of revokable) URL.revokeObjectURL(url)
  revokable = []
  originalCache.clear()
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
        <el-table :data="rows" class="fb-table">
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
          <el-table-column :width="COL.TIME">
            <!-- 原型 L1566：列头为文字按钮「反馈时间 ↓ / ↑」，点击切换正倒序 -->
            <template #header>
              <button type="button" class="fb-sort" :title="sortArrow === '↓' ? '倒序' : '正序'" @click="toggleSort">
                反馈时间 <span class="fb-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
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
              <!-- 原型 L1566 .fm5-thumb / md §三：48px 方块编号按钮「▧ N」，无附件「—」 -->
              <div v-if="row.images && row.images.length" class="fb-thumbs">
                <button
                  v-for="img in row.images"
                  :key="img.seq"
                  type="button"
                  class="fb-thumb"
                  :title="`查看第 ${img.seq} 张`"
                  @click="openViewer(row, img)"
                >
                  ▧ {{ img.seq }}
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

    <!-- 全文弹窗（原型 feedback-detail L1671：520px；明细项 label 上 / 值下 + 完整内容纯文本 + 底部【关闭】） -->
    <el-dialog v-model="detailVisible" title="反馈详情" width="520px" class="fb-detail-dialog">
      <template v-if="detailRow">
        <dl class="fb-detail-list">
          <div class="fb-detail-item">
            <dt>用户</dt>
            <dd>{{ detailRow.username || '—' }}</dd>
          </div>
          <div class="fb-detail-item">
            <dt>反馈时间</dt>
            <dd>{{ detailRow.createdAt ? fmtTime(detailRow.createdAt) : '—' }}</dd>
          </div>
          <div class="fb-detail-item">
            <dt>终端</dt>
            <dd>{{ terminalLabel(detailRow.terminal) }}</dd>
          </div>
        </dl>
        <div class="fb-content-full">{{ detailRow.content || '—' }}</div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 查看附图弹窗（原型 feedback-image L1672 / md §五：680px、大图预览区 + 附件序号、底部仅【关闭】；
         预览区放真实原图；加载失败在预览区内提示（md §七）） -->
    <el-dialog v-model="viewer.visible" title="查看附图" width="680px" class="fb-image-dialog" @closed="viewer.url = ''">
      <div v-loading="viewer.loading" class="fb-image-large">
        <img v-if="viewer.url" :src="viewer.url" :alt="`反馈截图 ${viewer.seq}`" class="fb-image-large-img" />
        <div v-else-if="viewer.error" class="fb-image-state">
          <div class="fb-image-seq">反馈截图 {{ viewer.seq }}</div>
          <p class="fb-viewer-error">附图加载失败，请稍后重试。</p>
        </div>
        <div v-else class="fb-image-state">
          <div class="fb-image-seq">反馈截图 {{ viewer.seq }}</div>
        </div>
      </div>
      <div class="fb-image-caption">附件 {{ viewer.seq }}</div>
      <template #footer>
        <el-button @click="closeViewer">关闭</el-button>
      </template>
    </el-dialog>
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
/* 排序列头文字按钮（原型 .sort{border:0;background:transparent;padding:0;color:inherit}） */
.fb-sort {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.fb-sort-arrow {
  margin-left: 2px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}
/* 附图编号按钮（原型 .fm5-thumbs{gap:7px} .fm5-thumb{48px 方块、1px 描边、圆角 6、灰底、12px；hover 绿边绿字}） */
.fb-thumbs {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.fb-thumb {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.fb-thumb:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}
/* 明细项（原型 .fm5-detail-list{gap:16px} .fm5-detail-item label{display:block;margin-bottom:4px;12px 弱色}：
   label 在上、值在下。原型 DOM 用 span 未命中 label 选择器致渲染成同行——属原型缺陷，按 CSS 意图落地） */
.fb-detail-list {
  margin: 0 0 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.fb-detail-item dt {
  display: block;
  margin-bottom: 4px;
  color: var(--c-text-muted);
  font-size: 12px;
}
.fb-detail-item dd {
  margin: 0;
  color: var(--c-text);
  line-height: 1.65;
  word-break: break-word;
}
/* 完整内容（原型 .fm5-content-full：pre-wrap 纯文本，无底色框）；限高滚动为代码超集保留 */
.fb-content-full {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.65;
  color: var(--c-text);
  max-height: 50vh;
  overflow-y: auto;
}
/* 大图预览区（原型 .fm5-image-large：360px 高、1px 描边、圆角 8、浅绿渐变底、居中） */
.fb-image-large {
  height: 360px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-base);
  border-radius: 8px;
  background: linear-gradient(145deg, #eef4f1, #dce8e2);
  color: #617169;
  overflow: hidden;
}
:root[data-theme='dark'] .fb-image-large {
  background: var(--bg-sunken);
  color: var(--c-text-muted);
}
.fb-image-large-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
.fb-image-state {
  text-align: center;
}
.fb-image-seq {
  font-size: 22px;
}
.fb-image-caption {
  margin-top: 10px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  text-align: center;
}
.fb-viewer-error {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
</style>
