<script setup>
/**
 * UsageFeedbackPanel —— 驾驶舱「使用情况」页签的用户端点踩统计区块（PRD 第六、八、九节）：
 * 点踩总数 / 点踩率趋势两格统计 + 点踩明细弹窗 + 对话明细弹窗。
 *
 * 2026-11-02：原驾驶舱「用户端点踩统计」整块迁入本组件。
 * 2026-11-10：保留原来的两格点踩统计，不展示点赞（维持 2026-09-17 裁决）；点赞数只参与点踩率计算。
 * 两格数字随页签筛选条取数，趋势按「较上一周期」比较（原概览版是写死的「本月 vs 上月」）。
 * 点踩明细弹窗里的 52 条样例记录是静态样例，不随页签筛选条变化（PRD 第八节），数据在 api/dislikeSampleMock.js。
 * 产品优化需求-202611 修改点 20：对话明细里被点踩的回复下方展示它生成的文件，可预览、下载；点踩明细表格加「生成文件」列。
 *
 * @prop {{likes:number,dislikes:number,rate:number|null,prevRate:number|null}} feedback 当前筛选范围的反馈汇总
 * @prop {number} range 页签顶部的时间范围（7 / 30 / 90），点踩明细弹窗的时间范围下拉打开时跟随它
 */
import { ref, computed } from 'vue'
import { ElMessage, ElImageViewer } from 'element-plus'
import { listDislikeSamples, getDislikeConversation } from '@/api/usage'
import { fmtCount, fmtPct } from '@/utils/usageFormat'

const props = defineProps({
  feedback: { type: Object, required: true },
  range: { type: Number, default: 30 }
})

// 点踩率趋势：当前点踩率 − 上一周期点踩率（百分点）；任一侧没有反馈数据则不可比
const trend = computed(() => {
  const { rate, prevRate } = props.feedback
  if (rate == null || prevRate == null) return null
  return Math.round((rate - prevRate) * 10) / 10
})

/* ---------- 点踩明细 / 对话明细（原型 openDlModal / openConvModal 复刻） ---------- */
// 样例记录：52 条抽样明细，数据在 api/dislikeSampleMock.js（经 api/usage.js 取）。
// 点踩数据按用户维度采集，不区分云端 / 客户端本地；每条记录只含被点踩的单轮（用户提问 + 被点踩回复），
// 被点踩回复里生成的文件随这一轮留存，可预览、下载（产品优化需求-202611 修改点 20）
const allDlRecords = ref([])
const dlLoading = ref(false)

const dlVisible = ref(false)
// 原型口径：时间范围仅展示，不参与实际过滤。
// 真实系统：点踩明细全量留存，管理端只查询近 90 天（下拉最大 90 天）；样例记录均在 90 天内，故无需过滤
const dlFilterDate = ref('30')
const dlPage = ref(1)
const DL_PAGE_SIZE = 10

const dlTotalPages = computed(() => Math.max(1, Math.ceil(allDlRecords.value.length / DL_PAGE_SIZE)))
const dlPageClamped = computed(() => Math.min(dlPage.value, dlTotalPages.value))
const dlSlice = computed(() => {
  const p = dlPageClamped.value
  return allDlRecords.value.slice((p - 1) * DL_PAGE_SIZE, p * DL_PAGE_SIZE)
})

async function openDislikeModal() {
  dlPage.value = 1
  dlFilterDate.value = String(props.range) // 弹窗时间范围跟随页签顶部的时间范围（PRD 第八节第 1 条）
  dlVisible.value = true
  if (allDlRecords.value.length) return // 样例集不随筛选变化，取过一次即可
  dlLoading.value = true
  try {
    allDlRecords.value = (await listDislikeSamples()).list
  } catch (e) {
    ElMessage.error(e?.message || '点踩明细加载失败，请稍后重试')
  } finally {
    dlLoading.value = false
  }
}
function exportDlCsv() {
  ElMessage({ message: '已生成点踩明细 CSV，正在下载…', plain: true })
}

const cvVisible = ref(false)
const cvRecord = ref(null)
const cvTurns = ref([])
const cvLoading = ref(false)

// 点踩明细表格【查看】：关掉点踩明细弹窗、打开对话明细弹窗（原型两个弹窗互斥，非叠加）
async function openConvModal(rec) {
  dlVisible.value = false
  cvRecord.value = rec
  cvTurns.value = []
  cvVisible.value = true
  cvLoading.value = true
  try {
    cvTurns.value = (await getDislikeConversation(rec.id)).turns
  } catch (e) {
    ElMessage.error(e?.message || '对话明细加载失败，请稍后重试')
  } finally {
    cvLoading.value = false
  }
}
// 对话明细关闭（【关闭】/ 右上角 × / Esc / 点遮罩）：回到点踩明细弹窗；不走 openDislikeModal，故保留原页码（2026-10-14 负责人裁决）
function backToDislikeModal() {
  dlVisible.value = true
}

/* ---------- 助手生成的文件：预览 / 下载（修改点 20） ---------- */
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}
const FILE_ICON = { image: '🖼', pdf: '📕', txt: '📄', docx: '📘', xlsx: '📗' }

// 图片：大图预览（Element Plus 图片查看器）；PDF / 文本：预览弹窗（demo 只放几行示意内容）
const imageViewerUrl = ref('')
const textPreview = ref(null)
function previewFile(f) {
  if (f.expired || !f.previewable) return
  if (f.kind === 'image') imageViewerUrl.value = f.url
  else textPreview.value = f
}
// 下载：demo 不生成真实文件，与「导出 CSV」同样只给提示
function downloadFile(f) {
  if (f.expired) return
  ElMessage({ message: `正在下载「${f.name}」…`, plain: true })
}
</script>

<template>
  <section class="dash-panel fb-panel" aria-label="用户端点踩统计">
    <div class="dash-panel-head">
      <h2 class="dash-panel-title">用户端点踩统计</h2>
      <span class="dash-panel-count">每轮对话均可反馈</span>
      <span class="spacer"></span>
      <button class="mini-btn" @click="openDislikeModal()">查看点踩明细</button>
    </div>

    <!-- 总览 2 格：点踩总数（含点踩率）+ 点踩率趋势 -->
    <div class="fb-overview-wrap">
      <div class="fb-overview">
        <div class="fb-stat dislike" data-testid="fb-dislikes">
          <div class="fb-stat-label">点踩总数</div>
          <div class="fb-stat-val">{{ fmtCount(feedback.dislikes) }}<small>次</small></div>
          <div class="fb-stat-sub">点踩率 <strong>{{ fmtPct(feedback.rate) }}</strong></div>
          <div class="like-bar-wrap">
            <div class="like-bar"><i :style="`width:${feedback.rate ?? 0}%`"></i></div>
            <span class="like-pct">{{ fmtPct(feedback.rate) }}</span>
          </div>
        </div>
        <div class="fb-stat" data-testid="fb-trend">
          <div class="fb-stat-label">点踩率趋势</div>
          <div v-if="trend == null" class="fb-stat-val trend none">—<small>较上一周期</small></div>
          <div v-else class="fb-stat-val trend" :class="{ up: trend > 0 }">
            <span v-if="trend === 0" class="trend-unit">持平</span>
            <template v-else>{{ (trend < 0 ? '↓ ' : '↑ ') + Math.abs(trend) }} <span class="trend-unit">个百分点</span></template><small>较上一周期</small>
          </div>
          <div class="fb-stat-sub">上一周期点踩率 <strong class="warn">{{ fmtPct(feedback.prevRate) }}</strong></div>
        </div>
      </div>
    </div>

    <!-- 点踩明细弹窗（原型 dlOverlay）：分页表格 + 导出 CSV 占位 -->
    <el-dialog v-model="dlVisible" class="admin-dialog" width="920px" :show-close="true">
      <template #header>
        <div class="dl-dialog-head">
          <span class="dl-dialog-title">点踩明细记录</span>
          <span class="dl-dialog-count">共 {{ allDlRecords.length }} 条</span>
        </div>
      </template>
      <div class="dl-filters">
        <span class="dl-filter-label">时间范围</span>
        <el-select v-model="dlFilterDate" style="width:120px">
          <el-option label="近 7 天" value="7" />
          <el-option label="近 30 天" value="30" />
          <el-option label="近 90 天" value="90" />
        </el-select>
        <span class="spacer"></span>
        <button class="mini-btn" @click="exportDlCsv">导出 CSV</button>
      </div>
      <table class="dash-table dl-table">
        <thead>
          <tr>
            <th style="width:148px">时间</th>
            <th style="width:110px">岗位</th>
            <th style="width:80px">用户</th>
            <th>对话内容摘要</th>
            <th style="width:76px;text-align:center">生成文件</th>
            <th style="width:68px;text-align:center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dlLoading"><td colspan="6" class="dl-empty">加载中…</td></tr>
          <tr v-for="r in dlSlice" :key="r.id">
            <td class="dash-num">{{ r.time }}</td>
            <td><span class="dash-name-main">{{ r.position }}</span></td>
            <td class="dl-user">{{ r.user }}</td>
            <td><span class="dl-snippet" :title="r.snippet">{{ r.snippet }}</span></td>
            <td class="dl-files" style="text-align:center">{{ r.fileCount ? r.fileCount + ' 个' : '—' }}</td>
            <td style="text-align:center"><button class="mini-btn" @click="openConvModal(r)">查看</button></td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <div class="dl-foot">
          <span>第 {{ dlPageClamped }} / {{ dlTotalPages }} 页，共 {{ allDlRecords.length }} 条</span>
          <span class="spacer"></span>
          <button class="mini-btn" :disabled="dlPageClamped <= 1" @click="dlPage = dlPageClamped - 1">上一页</button>
          <button class="mini-btn" :disabled="dlPageClamped >= dlTotalPages" @click="dlPage = dlPageClamped + 1">下一页</button>
        </div>
      </template>
    </el-dialog>

    <!-- 对话明细弹窗（原型 cvOverlay）：由点踩明细表格【查看】打开，展示被点踩的单轮对话 -->
    <el-dialog v-model="cvVisible" class="admin-dialog" width="640px" @closed="backToDislikeModal">
      <template #header>
        <div class="cv-dialog-head">
          <span class="cv-dialog-title">对话明细</span>
          <span class="cv-dialog-id">{{ cvRecord?.id }}</span>
        </div>
      </template>
      <div class="cv-meta">
        <span class="cv-meta-item">岗位 <b>{{ cvRecord?.position }}</b></span>
        <span class="cv-meta-item">用户 <b>{{ cvRecord?.user }}</b></span>
        <span class="cv-meta-item">点踩时间 <b>{{ cvRecord?.time }}</b></span>
      </div>
      <div class="cv-body">
        <div v-if="cvLoading" class="cv-loading">加载中…</div>
        <div
          v-for="(t, i) in cvTurns"
          :key="i"
          class="cv-msg"
          :class="[t.role, { disliked: t.disliked }]"
        >
          <div class="cv-who">{{ t.role === 'user' ? cvRecord?.user : cvRecord?.position }}</div>
          <div class="cv-bubble">{{ t.text }}</div>
          <!-- 被点踩回复里生成的文件（修改点 20）：图片显示缩略图；图片 / PDF / 文本可预览，其余只能下载；失效的置灰 -->
          <div v-if="t.files?.length" class="cv-files">
            <div
              v-for="f in t.files"
              :key="f.id"
              class="cv-file"
              :class="{ expired: f.expired }"
              data-testid="cv-file"
            >
              <img
                v-if="f.kind === 'image' && !f.expired"
                class="cv-file-thumb"
                :src="f.url"
                :alt="f.name"
                @click="previewFile(f)"
              />
              <span v-else class="cv-file-icon">{{ FILE_ICON[f.kind] || '📄' }}</span>
              <div class="cv-file-info">
                <div class="cv-file-name" :title="f.name">{{ f.name }}</div>
                <div class="cv-file-meta">
                  <template v-if="f.expired">文件已失效</template>
                  <template v-else>{{ f.kindLabel }} · {{ fmtSize(f.sizeBytes) }}</template>
                </div>
              </div>
              <div v-if="!f.expired" class="cv-file-ops">
                <button v-if="f.previewable" class="mini-btn" @click="previewFile(f)">预览</button>
                <button class="mini-btn" @click="downloadFile(f)">下载</button>
              </div>
            </div>
          </div>
          <div class="cv-ts-row">
            <span>{{ t.ts }}</span>
            <span v-if="t.disliked" class="cv-disliked-tag">点踩</span>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="mini-btn" @click="cvVisible = false">关闭</button>
      </template>
    </el-dialog>

    <!-- 文件预览（修改点 20）：图片走 Element Plus 图片查看器；PDF / 文本开预览弹窗（demo 只放几行示意内容） -->
    <ElImageViewer v-if="imageViewerUrl" :url-list="[imageViewerUrl]" teleported @close="imageViewerUrl = ''" />
    <el-dialog
      :model-value="!!textPreview"
      class="admin-dialog"
      width="560px"
      append-to-body
      :title="textPreview?.name"
      @update:model-value="(v) => { if (!v) textPreview = null }"
    >
      <div class="fp-body" data-testid="file-preview">
        <p v-for="(line, i) in textPreview?.previewText || []" :key="i" :class="{ 'fp-title': i === 0 }">{{ line }}</p>
      </div>
      <template #footer>
        <button class="mini-btn" @click="downloadFile(textPreview)">下载</button>
        <button class="mini-btn" @click="textPreview = null">关闭</button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
/* ---- 反馈总览 ---- */
.fb-overview-wrap { padding: 16px 18px 18px; }
.fb-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg, 8px);
  background: var(--border-base);
  overflow: hidden;
}
.fb-stat {
  background: #fff;
  padding: 14px 16px;
}
.fb-stat-label { color: #68736d; font-size: 12px; margin-bottom: 5px; }
.fb-stat-val {
  font: 700 26px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #26312b;
  letter-spacing: -0.03em;
}
.fb-stat-val small { margin-left: 3px; color: #7a8580; font: 500 13px system-ui, sans-serif; letter-spacing: 0; }
.fb-stat.dislike .fb-stat-val { color: var(--c-danger); }
.fb-stat-val.trend { color: #197b59; font-size: 22px; }
.fb-stat-val.trend.up { color: var(--c-danger); }
.fb-stat-val.trend.none { color: #94a09a; }
/* 中文单位不走等宽字体（等宽字体没有中文字形，会回退成宋体） */
.trend-unit { font: 600 16px system-ui, sans-serif; letter-spacing: 0; }
.fb-stat-sub { margin-top: 5px; color: #76817b; font-size: 12px; }
.fb-stat-sub strong { color: var(--c-accent); font-weight: 650; }
.fb-stat-sub .warn { color: var(--c-warning, #e6921e); font-weight: 650; }
.like-bar-wrap { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.like-bar { flex: 1; height: 6px; border-radius: 3px; background: #edf1ef; overflow: hidden; }
.like-bar i { display: block; height: 100%; border-radius: inherit; background: var(--c-danger); }
.like-pct {
  min-width: 36px;
  color: var(--c-danger);
  font: 600 11px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: right;
}

/* ---- 点踩明细弹窗 ---- */
.dl-dialog-head { display: flex; align-items: baseline; gap: 10px; }
.dl-dialog-title { font-size: 17px; font-weight: var(--fw-semibold); color: var(--c-text-strong); }
.dl-dialog-count { color: var(--c-text-muted); font-size: 12px; }
.dl-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -4px 0 14px;
}
.dl-filter-label { color: #68736d; font-size: 12px; font-weight: 600; white-space: nowrap; }
.dl-table { border: 1px solid var(--border-soft); border-radius: 6px; overflow: hidden; }
.dl-user { color: #617069; font-size: 12px; }
.dl-snippet {
  display: block;
  overflow: hidden;
  color: #455049;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-foot { display: flex; align-items: center; gap: 8px; width: 100%; color: #7a8580; font-size: 12px; }

/* ---- 对话明细弹窗 ---- */
.cv-dialog-head { display: flex; align-items: baseline; gap: 10px; }
.cv-dialog-title { font-size: 17px; font-weight: var(--fw-semibold); color: var(--c-text-strong); }
.cv-dialog-id {
  color: #94a09a;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.cv-meta { display: flex; gap: 18px; margin-bottom: 14px; color: #68736d; font-size: 12px; }
.cv-meta-item b { color: #26312b; font-weight: 600; margin-left: 3px; }
.cv-body { display: flex; flex-direction: column; gap: 14px; max-height: 50vh; overflow: auto; }
.cv-msg { display: flex; flex-direction: column; gap: 3px; max-width: 88%; }
.cv-msg.user { align-self: flex-end; align-items: flex-end; }
.cv-msg.asst { align-self: flex-start; align-items: flex-start; }
.cv-who { font-size: 11px; font-weight: 600; color: #8d9590; }
.cv-bubble { padding: 10px 14px; line-height: 1.65; word-break: break-word; font-size: 14px; }
.cv-msg.user .cv-bubble { background: var(--c-accent); color: #fff; border-radius: 10px 10px 2px 10px; }
.cv-msg.asst .cv-bubble {
  background: #fff;
  border: 1px solid var(--border-base);
  color: #354039;
  border-radius: 10px 10px 10px 2px;
}
/* 助手生成的文件（修改点 20） */
.cv-files { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; width: 100%; }
.cv-file {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--border-base); border-radius: var(--radius-md); background: var(--bg-surface);
}
.cv-file.expired { opacity: 0.55; }
.cv-file-thumb { width: 64px; height: 40px; object-fit: cover; border-radius: 4px; cursor: zoom-in; border: 1px solid var(--border-base); }
.cv-file-icon { width: 32px; text-align: center; font-size: 22px; }
.cv-file-info { flex: 1; min-width: 0; }
.cv-file-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-file-meta { font-size: 12px; color: var(--c-text-muted); }
.cv-file-ops { display: flex; gap: 6px; flex-shrink: 0; }
.dl-table td.dash-num { white-space: nowrap; }
.cv-loading, .dl-empty { color: var(--c-text-muted); font-size: 13px; text-align: center; padding: 16px 0; }
.fp-body p { margin: 0 0 8px; line-height: 1.7; font-size: 14px; }
.fp-body .fp-title { font-weight: 600; font-size: 15px; }
.cv-msg.asst.disliked .cv-bubble { border-color: #f0c7c4; background: #fff8f7; }
.cv-ts-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: #94a09a;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.cv-disliked-tag {
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--c-danger-soft, #fdebea);
  border: 1px solid #f0c7c4;
  color: var(--c-danger);
  font-size: 11px;
  font-weight: 600;
}
</style>
