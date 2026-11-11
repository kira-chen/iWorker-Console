<script setup>
/**
 * UsageFeedbackPanel —— 驾驶舱「使用情况」页签的用户端点踩统计区块（PRD 第六、八、九节）：
 * 点踩总数 / 点踩率趋势两格统计 + 点踩明细弹窗 + 对话明细弹窗。
 *
 * 2026-11-02：原驾驶舱「用户端点踩统计」整块迁入本组件。
 * 2026-11-10：保留原来的两格点踩统计，不展示点赞（维持 2026-09-17 裁决）；点赞数只参与点踩率计算。
 * 两格数字随页签筛选条取数，趋势按「较上一周期」比较（原概览版是写死的「本月 vs 上月」）。
 * 点踩明细弹窗里的 52 条样例记录是静态样例，不随页签筛选条变化（PRD 第八节）。
 *
 * @prop {{likes:number,dislikes:number,rate:number|null,prevRate:number|null}} feedback 当前筛选范围的反馈汇总
 * @prop {number} range 页签顶部的时间范围（7 / 30 / 90），点踩明细弹窗的时间范围下拉打开时跟随它
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
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
const DL_POS = ['销售顾问', '经营分析师', '项目经理助手', '产品经理助手', '公文写作', '生产计划员']
const DL_USERS = ['张**', '李**', '王**', '陈**', '刘**', '杨**', '赵**', '黄**']
const DL_SNIPPETS = [
  '请帮我分析这份销售数据并给出建议', '需要生成一份项目汇报周报模板', '帮我起草客户拜访前的确认邮件',
  '分析本季度产线排班优化方案', '帮我整理这份会议纪要并提炼要点', '生成合同摘要并标注主要风险条款',
  '我需要最新的产品报价单及折扣规则', '帮我分析竞品的市场定价策略', '请生成本月的经营分析报告摘要',
  '帮我优化这段公文的措辞和格式'
]
const DL_TIMES = [
  '2026-09-15 14:32', '2026-09-15 11:18', '2026-09-14 16:47', '2026-09-14 09:23', '2026-09-13 18:05',
  '2026-09-13 14:33', '2026-09-12 20:11', '2026-09-12 15:44', '2026-09-11 10:22', '2026-09-11 08:57',
  '2026-09-10 17:36', '2026-09-10 11:09', '2026-09-09 19:48', '2026-09-09 14:21', '2026-09-08 16:33',
  '2026-09-08 10:54', '2026-09-07 18:22', '2026-09-07 13:41', '2026-09-06 15:19', '2026-09-06 09:37',
  '2026-09-05 20:44', '2026-09-05 16:08', '2026-09-04 17:55', '2026-09-04 12:30', '2026-09-03 19:14',
  '2026-09-03 08:46', '2026-09-02 21:03', '2026-09-02 14:17', '2026-09-01 16:29', '2026-09-01 10:52',
  '2026-08-31 18:37', '2026-08-31 13:05', '2026-08-30 20:18', '2026-08-30 11:43', '2026-08-29 17:02',
  '2026-08-29 09:28', '2026-08-28 19:51', '2026-08-28 14:16', '2026-08-27 16:44', '2026-08-27 10:09',
  '2026-08-26 18:27', '2026-08-26 13:53', '2026-08-25 20:06', '2026-08-25 11:35', '2026-08-24 17:49',
  '2026-08-24 09:14', '2026-08-23 18:33', '2026-08-23 14:07', '2026-08-22 16:21', '2026-08-22 10:48',
  '2026-08-21 19:03', '2026-08-21 13:29'
]
// 样例记录（原型口径：52 条抽样明细，代表点踩总量的样例子集，非逐条落库）
// 点踩数据按用户维度采集，不区分云端 / 客户端本地；每条记录只含被点踩的单轮（用户提问 + 被点踩回复）
const allDlRecords = DL_TIMES.map((t, i) => ({
  id: 'D-' + (1031 - i),
  time: t,
  position: DL_POS[i % DL_POS.length],
  user: DL_USERS[i % DL_USERS.length],
  snippet: DL_SNIPPETS[i % DL_SNIPPETS.length]
}))

const dlVisible = ref(false)
// 原型口径：时间范围仅展示，不参与实际过滤。
// 真实系统：点踩明细全量留存，管理端只查询近 90 天（下拉最大 90 天）；样例记录均在 90 天内，故无需过滤
const dlFilterDate = ref('30')
const dlPage = ref(1)
const DL_PAGE_SIZE = 10

const dlTotalPages = computed(() => Math.max(1, Math.ceil(allDlRecords.length / DL_PAGE_SIZE)))
const dlPageClamped = computed(() => Math.min(dlPage.value, dlTotalPages.value))
const dlSlice = computed(() => {
  const p = dlPageClamped.value
  return allDlRecords.slice((p - 1) * DL_PAGE_SIZE, p * DL_PAGE_SIZE)
})

function openDislikeModal() {
  dlPage.value = 1
  dlFilterDate.value = String(props.range) // 弹窗时间范围跟随页签顶部的时间范围（PRD 第八节第 1 条）
  dlVisible.value = true
}
function exportDlCsv() {
  ElMessage({ message: '已生成点踩明细 CSV，正在下载…', plain: true })
}

const ASST_REPLIES = [
  '根据您的需求，我进行了初步分析，主要发现如下：① 核心指标同比有所变化，建议重点关注转化率和客单价；② 当前数据缺少部分维度，建议补充采集后再做深度分析。',
  '已为您生成所需模板，包含标准章节结构和填写说明。请注意第三部分的格式要求，并根据实际情况修改后使用。',
  '已起草完成，核心内容包含三个部分：背景说明、主要诉求和后续行动建议。建议在发送前确认联系人信息和时间节点是否准确。',
  '根据现有数据，优化方案涉及以下几点：① 调整班次结构，② 优化设备利用率，③ 引入弹性排班机制。预计可提升效率约 12%~18%，具体效果需结合实际验证。',
  '会议纪要已整理完毕，共提炼出 5 项核心决议和 3 项后续行动项，各项均已标注责任人和截止时间。如需调整格式，请告知。',
  '合同摘要已生成，共标注 4 处主要风险条款，建议重点关注第 7 条（违约责任）和第 12 条（知识产权归属）。',
  '已整理最新产品报价单及折扣规则，共包含 23 个 SKU。部分产品近期调价，已用标注提示，请注意核对。',
  '根据公开信息，竞品定价策略主要体现在差异化定价、动态调价机制和地区价格分层三个维度，具体数据如下……',
  '本月经营分析报告摘要已生成，核心数据涵盖营收、成本、利润率和客户留存四项指标，整体表现略低于预期，主要受季节性因素影响。',
  '公文已优化，主要调整了措辞正式度、段落逻辑衔接及格式问题。修改处已加括号注释，方便您对比审阅。'
]

function pad2(n) {
  return String(n).padStart(2, '0')
}
// 由点踩记录还原被点踩的单轮对话（用户提问 + 被点踩回复）；同一条记录每次打开内容恒定，靠 id 做种子
function buildConvTurns(rec) {
  const seed = parseInt(rec.id.replace('D-', ''), 10) || 0
  const date = rec.time.slice(0, 11)
  const hh = parseInt(rec.time.slice(11, 13), 10)
  const mm = parseInt(rec.time.slice(14, 16), 10)
  // 回复时间 = 提问时间 + 1 分钟
  let h = hh
  let m = mm + 1
  if (m >= 60) { m -= 60; h++ }
  const replyTs = date + pad2(Math.min(23, h)) + ':' + pad2(m)
  return [
    { role: 'user', ts: rec.time.slice(0, 16), text: rec.snippet },
    { role: 'asst', ts: replyTs, text: ASST_REPLIES[seed % ASST_REPLIES.length], disliked: true }
  ]
}

const cvVisible = ref(false)
const cvRecord = ref(null)
const cvTurns = ref([])

// 点踩明细表格【查看】：关掉点踩明细弹窗、打开对话明细弹窗（原型两个弹窗互斥，非叠加）
function openConvModal(rec) {
  dlVisible.value = false
  cvRecord.value = rec
  cvTurns.value = buildConvTurns(rec)
  cvVisible.value = true
}
// 对话明细关闭（【关闭】/ 右上角 × / Esc / 点遮罩）：回到点踩明细弹窗；不走 openDislikeModal，故保留原页码（2026-10-14 负责人裁决）
function backToDislikeModal() {
  dlVisible.value = true
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
            <th style="width:68px;text-align:center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in dlSlice" :key="r.id">
            <td class="dash-num">{{ r.time }}</td>
            <td><span class="dash-name-main">{{ r.position }}</span></td>
            <td class="dl-user">{{ r.user }}</td>
            <td><span class="dl-snippet" :title="r.snippet">{{ r.snippet }}</span></td>
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
        <div
          v-for="(t, i) in cvTurns"
          :key="i"
          class="cv-msg"
          :class="[t.role, { disliked: t.disliked }]"
        >
          <div class="cv-who">{{ t.role === 'user' ? cvRecord?.user : cvRecord?.position }}</div>
          <div class="cv-bubble">{{ t.text }}</div>
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
