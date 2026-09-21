<script setup>
/**
 * 驾驶舱（01 总览）—— 全局概览：资产发布率、岗位领用、待办、点踩反馈统计。
 * 数据静态 mock，对应原型 renderDashboard 内容（2026-09-17 负责人裁决：删去本月成本卡，
 * 点赞/点踩统计模块收窄为「点踩统计 + 点踩上下文明细」，不再展示点赞相关数据）。
 * 唯一例外是「用户端当前下发版本」面板：取自版本管理（api/version 的 getVersionOverview，与版本管理页
 * 概览条同一数据源），版本管理里发布 / 停用经审核通过后，这里随之变化。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getVersionOverview } from '@/api/version'
import { fmtTime } from '@/utils/docMeta'
import { TERMINAL_OPTIONS } from '@/utils/versionMeta'
import '@/assets/admin-dialog.css'

const router = useRouter()

const refreshTime = ref('09:30')
const refreshing = ref(false)

// 5 张指标卡
// pct：圆环弧长（取整，供 conic-gradient 用）；pctText：环内文字（精确到小数点后一位，与原型
// renderDashboard 逐值一致——弧长可以四舍五入，但文字要精确，两者原型里本就不是同一个数）。
const metrics = [
  { label: '已发布岗位数量', tag: '已发布', value: 14, unit: '个', sub: '全部岗位 18 个', pct: 78, pctText: '78%', type: '' },
  { label: '领用岗位员工数量', tag: '覆盖率', value: 241, unit: '人', sub: '启用员工 268 人', pct: 90, pctText: '89.9%', type: '' },
  { label: '已发布技能数量', tag: '已发布', value: 68, unit: '个', sub: '全部技能 82 个', pct: 83, pctText: '82.9%', type: '' },
  { label: '已发布专家数量', tag: '已发布', value: 18, unit: '个', sub: '全部专家 22 个', pct: 82, pctText: '81.8%', type: '' },
  { label: '知识资产', tag: '资产构成', type: 'dual', knowledge: 12, source: 19, sub: '点击查看知识资产明细' },
]

// 待处理指标（右上角独立 danger 卡）
const pendingMetric = {
  label: '待处理', tag: '需处理', value: 16, unit: '项',
  breakdown: [
    { label: '待审核', value: 11 },
    { label: '高风险', value: 2 },
    { label: '连接失败', value: 3 },
  ]
}

// 异常与待办：行动按钮真实跳转对应模块页面（原型是 toast 占位，这里改为路由跳转）
const alerts = [
  { count: 11, level: 'medium', label: '待审核', text: '审核中心有 11 条申请待审核', meta: '发布审核 7 / 版本发布 3 / 停用审核 1', source: '审核中心', action: '去审核', to: 'UnifiedReview' },
  { count: 3,  level: 'high',   label: '连接失败', text: '连接器有 3 个连接失败',        meta: 'MCP 2 / API 1',                    source: '连接器',   action: '去处理', to: 'AdminConnector' },
  { count: 2,  level: 'high',   label: '高风险',   text: '用户上传技能有 2 个高风险',    meta: '等待人工审核',                      source: '用户技能审核', action: '去审核', to: 'SysConfigUserSkillReviews' },
]
const alertTotal = alerts.reduce((s, x) => s + x.count, 0)

// 各模块发布状态
const assets = [
  { name: '岗位',   published: 14, review: 2, draft: 2 },
  { name: '专家',   published: 18, review: 1, draft: 3 },
  { name: '技能',   published: 68, review: 5, draft: 9 },
  { name: 'MCP',    published:  9, review: 1, draft: 2 },
  { name: 'API',    published: 11, review: 2, draft: 4 },
  { name: '业务系统', published: 7, review: 0, draft: 2 },
  { name: '模型',   published:  6, review: 1, draft: 1 },
  { name: '知识库', published: 12, review: 2, draft: 5 },
]

function assetPcts(item) {
  const total = item.published + item.review + item.draft
  const p = (item.published / total * 100).toFixed(1)
  const r = (item.review / total * 100).toFixed(1)
  const d = (100 - parseFloat(p) - parseFloat(r)).toFixed(1)
  return { p, r, d, total }
}

// 岗位领用 Top 5：只展示已发布状态的岗位（2026-09-17 裁决），故 status 拆成独立字段供筛选
const posTop = [
  { rank: '01', top: true, name: '销售顾问',    version: 'v2.3.0', status: '已发布', users: 48, skills: 9, agents: 3 },
  { rank: '02', top: true, name: '经营分析师',  version: 'v1.6.0', status: '已发布', users: 39, skills: 7, agents: 4 },
  { rank: '03', top: true, name: '项目经理助手', version: 'v1.4.0', status: '已发布', users: 34, skills: 6, agents: 2 },
  { rank: '04', top: false, name: '产品经理助手', version: 'v2.1.0', status: '已发布', users: 27, skills: 8, agents: 3 },
  { rank: '05', top: false, name: '公文写作',    version: 'v1.2.0', status: '已发布', users: 21, skills: 4, agents: 1 },
]
const publishedPosTop = computed(() => posTop.filter((p) => p.status === '已发布'))
const maxUsers = 48

// 用户端当前下发版本：各终端「下发中版本」（含停用审核期间仍在下发的）+ 更新说明，只读展示。
// verOverview 为 null = 尚未取回（骨架屏）；{ WINDOWS: 版本行|null, MAC: 版本行|null }，null 表示该终端暂无下发版本。
const verOverview = ref(null)
const verError = ref(false)
const verLoading = computed(() => refreshing.value || !verOverview.value)
const verCards = computed(() =>
  TERMINAL_OPTIONS.map((t) => ({ ...t, row: verOverview.value?.[t.value] ?? null }))
)

async function loadVerOverview() {
  verError.value = false
  try {
    verOverview.value = await getVersionOverview()
  } catch {
    verError.value = true
  }
}
onMounted(loadVerOverview)

// 点踩统计（2026-09-17 裁决：模块收窄为点踩，不再展示点赞数据；按岗位分布及其筛选项一并删去）
const fbTotal = { dislikes: 1031, dislikeRate: 12.2, trend: -3.1 }

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
// 样例记录（原型口径：52 条抽样明细，代表统计卡片里的 1,031 次点踩总量，非逐条落库）
const allDlRecords = DL_TIMES.map((t, i) => ({
  id: 'D-' + (1031 - i),
  time: t,
  position: DL_POS[i % DL_POS.length],
  user: DL_USERS[i % DL_USERS.length],
  snippet: DL_SNIPPETS[i % DL_SNIPPETS.length]
}))

const dlVisible = ref(false)
const dlFilterDate = ref('30') // 原型口径：时间范围仅展示，不参与实际过滤
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
  dlVisible.value = true
}
function exportDlCsv() {
  ElMessage({ message: '已生成点踩明细 CSV，正在下载…', plain: true })
}

const PRIOR_Q = ['你好，请帮我了解一下相关背景信息', '能先给我一些基本情况的介绍吗', '这方面有哪些关键注意事项']
function priorAFor(position) {
  return [
    `您好！我是${position}，很高兴为您服务。以下是相关背景信息的简要说明，供您参考……`,
    '当然，关于这方面有以下几个核心要点值得了解，我来逐一说明……',
    '好的，以下是我整理的关键注意事项，请您参阅……'
  ]
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
// 由点踩记录反推一段前情对话（原型 buildConvTurns：同一条记录每次打开生成内容恒定，靠 id 做种子）
function buildConvTurns(rec) {
  const seed = parseInt(rec.id.replace('D-', ''), 10) || 0
  const date = rec.time.slice(0, 11)
  const hh = parseInt(rec.time.slice(11, 13), 10)
  const mm = parseInt(rec.time.slice(14, 16), 10)
  function mkts(dh, dm) {
    let h = hh + dh
    let m = mm + dm
    while (m < 0) { m += 60; h-- }
    while (m >= 60) { m -= 60; h++ }
    return date + pad2(Math.max(0, Math.min(23, h))) + ':' + pad2(m)
  }
  const priorA = priorAFor(rec.position)
  return [
    { role: 'user', ts: mkts(0, -8), text: PRIOR_Q[seed % PRIOR_Q.length] },
    { role: 'asst', ts: mkts(0, -6), text: priorA[seed % priorA.length] },
    { role: 'user', ts: mkts(0, -4), text: PRIOR_Q[(seed + 1) % PRIOR_Q.length] },
    { role: 'asst', ts: mkts(0, -2), text: priorA[(seed + 1) % priorA.length] },
    { role: 'user', ts: rec.time.slice(0, 16), text: rec.snippet },
    { role: 'asst', ts: mkts(0, 1), text: ASST_REPLIES[seed % ASST_REPLIES.length], disliked: true }
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

function doRefresh() {
  refreshing.value = true
  loadVerOverview()
  setTimeout(() => {
    refreshing.value = false
    const now = new Date()
    refreshTime.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    ElMessage({ message: '驾驶舱数据已刷新', type: 'success', plain: true })
  }, 650)
}

function tip(text) {
  ElMessage({ message: `正式系统中将进入「${text}」`, plain: true })
}

// 异常与待办卡片的行动按钮：真实跳转对应模块页面处理（2026-09-17 裁决：由 toast 占位改为路由跳转）
function openAlertAction(item) {
  router.push({ name: item.to })
}
</script>

<template>
  <div class="cockpit" :class="{ loading: refreshing }">
    <PageHeader title="驾驶舱" subtitle="查看数字员工资产、岗位领用、任务运行和治理待办。">
      <template #actions>
        <span class="ref-time">更新于 {{ refreshTime }}</span>
        <el-button @click="doRefresh">刷新</el-button>
      </template>
    </PageHeader>

    <!-- 指标卡区 -->
    <section class="metrics" aria-label="核心指标">
      <!-- 普通 4 张（带圆环） -->
      <button
        v-for="m in metrics.slice(0, 4)"
        :key="m.label"
        class="metric"
        @click="tip(m.label)"
      >
        <span class="metric-head">
          <span class="metric-label">{{ m.label }}</span>
          <span class="metric-tag">{{ m.tag }}</span>
        </span>
        <span class="metric-main">
          <span class="metric-value">{{ m.value }}<small>{{ m.unit }}</small></span>
          <span class="dash-ring" :style="`--pct:${m.pct}`"><b>{{ m.pctText }}</b></span>
        </span>
        <span class="metric-sub">{{ m.sub }}</span>
      </button>

      <!-- 知识资产（wide，本月成本卡删去后占其余 2 列） -->
      <button class="metric wide" @click="tip('知识库')">
        <span class="metric-head">
          <span class="metric-label">知识资产</span>
          <span class="metric-tag">资产构成</span>
        </span>
        <span class="metric-main">
          <span class="dual-stat">
            <span><b>{{ metrics[4].knowledge }}</b>知识库</span>
            <span><b>{{ metrics[4].source }}</b>数据源</span>
          </span>
        </span>
        <span class="metric-sub">{{ metrics[4].sub }}</span>
      </button>

      <!-- 待处理（danger，wide，本月成本卡删去后占其余 2 列） -->
      <button class="metric danger wide" @click="tip('待处理事项')">
        <span class="metric-head">
          <span class="metric-label">{{ pendingMetric.label }}</span>
          <span class="metric-tag">{{ pendingMetric.tag }}</span>
        </span>
        <span class="metric-main">
          <span class="metric-value">{{ pendingMetric.value }}<small>{{ pendingMetric.unit }}</small></span>
        </span>
        <span class="pending-breakdown">
          <span v-for="b in pendingMetric.breakdown" :key="b.label">
            <b>{{ b.value }}</b>{{ b.label }}
          </span>
        </span>
      </button>
    </section>

    <!-- 异常与待办 -->
    <section class="dash-panel">
      <div class="dash-panel-head">
        <h2 class="dash-panel-title">异常与待办</h2>
        <span class="dash-panel-count">共 {{ alertTotal }} 项</span>
      </div>
      <div class="dash-alert-list">
        <div class="dash-todo-grid">
          <div
            v-for="item in alerts"
            :key="item.source"
            class="dash-todo-card"
            :class="item.level"
          >
            <div class="dash-todo-top">
              <span class="dash-todo-source">{{ item.source }}</span>
              <span class="dash-severity" :class="item.level">
                <span class="dash-severity-dot"></span>{{ item.label }}
              </span>
            </div>
            <div class="dash-todo-number">{{ item.count }}<small>项</small></div>
            <div class="dash-todo-meta">{{ item.meta }}</div>
            <div class="dash-todo-actions">
              <button class="mini-btn" @click="openAlertAction(item)">{{ item.action }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 两栏：发布状态 + Top5 -->
    <div class="dash-grid-two">
      <!-- 各模块发布状态 -->
      <section class="dash-panel" style="margin-top:0">
        <div class="dash-panel-head">
          <h2 class="dash-panel-title">各模块发布状态</h2>
        </div>
        <div class="dash-asset-body">
          <div class="dash-asset-legend">
            <span class="dash-legend"><i class="pub"></i>已发布</span>
            <span class="dash-legend"><i class="rev"></i>审核中</span>
            <span class="dash-legend"><i class="dft"></i>未发布</span>
          </div>
          <div v-for="item in assets" :key="item.name" class="dash-asset-row">
            <span class="dash-asset-name">{{ item.name }}</span>
            <span class="dash-asset-total">{{ assetPcts(item).total }}</span>
            <span class="dash-stack">
              <span class="pub" :style="`width:${assetPcts(item).p}%`"></span>
              <span class="rev" :style="`width:${assetPcts(item).r}%`"></span>
              <span class="dft" :style="`width:${assetPcts(item).d}%`"></span>
            </span>
            <span class="dash-asset-detail"><b>{{ item.published }}</b> / {{ item.review }} / {{ item.draft }}</span>
          </div>
        </div>
      </section>

      <!-- 岗位领用 Top 5 -->
      <section class="dash-panel" style="margin-top:0">
        <div class="dash-panel-head">
          <h2 class="dash-panel-title">岗位领用 Top 5</h2>
        </div>
        <table class="dash-table">
          <thead>
            <tr>
              <th style="width:34%">岗位</th>
              <th style="width:32%">领用人数</th>
              <th class="dash-num">技能数</th>
              <th class="dash-num">Agent 数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pos in publishedPosTop" :key="pos.rank">
              <td>
                <span class="dash-rank-name">
                  <span class="dash-rank-no" :class="{ top: pos.top }">{{ pos.rank }}</span>
                  <span>
                    <span class="dash-name-main">{{ pos.name }}</span>
                    <span class="dash-name-sub">{{ pos.version }} / {{ pos.status }}</span>
                  </span>
                </span>
              </td>
              <td>
                <span class="dash-bar-value">
                  <span class="dash-bar-track"><i :style="`width:${(pos.users / maxUsers * 100).toFixed(1)}%`"></i></span>
                  <span class="dash-bar-number">{{ pos.users }}</span>
                </span>
              </td>
              <td class="dash-num">{{ pos.skills }}</td>
              <td class="dash-num">{{ pos.agents }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 用户端当前下发版本：Windows / Mac 各一张只读卡片，版本号 + 发布时间 + 更新说明（数据同版本管理概览条） -->
    <section class="dash-panel" aria-label="用户端当前下发版本">
      <div class="dash-panel-head">
        <h2 class="dash-panel-title">用户端当前下发版本</h2>
        <span class="dash-panel-count">用户端检测更新时将提示升级到该版本</span>
      </div>
      <div v-if="verError" class="ver-error">
        加载失败
        <el-button link type="primary" @click="loadVerOverview">重试</el-button>
      </div>
      <div v-else class="ver-grid">
        <div v-for="c in verCards" :key="c.value" class="ver-card" :data-terminal="c.value">
          <StatusTag type="accent">{{ c.label }}</StatusTag>
          <div v-if="verLoading" class="ver-skeleton"></div>
          <template v-else-if="c.row">
            <div class="ver-line">
              <span class="ver-version">{{ c.row.version }}</span>
              <span class="ver-time">发布于 {{ fmtTime(c.row.publishedAt) }}</span>
            </div>
            <div class="ver-notes-label">更新说明</div>
            <div class="ver-notes">{{ c.row.releaseNotes }}</div>
          </template>
          <div v-else class="ver-empty">暂无下发版本</div>
        </div>
      </div>
    </section>

    <!-- 点踩统计（2026-09-17 裁决：精简为点踩统计 + 点踩上下文明细两件事，不再展示点赞数据） -->
    <section class="dash-panel fb-panel">
      <div class="dash-panel-head">
        <h2 class="dash-panel-title">用户端点踩统计</h2>
        <span class="dash-panel-count">每轮对话均可反馈</span>
        <span class="spacer"></span>
        <button class="mini-btn" @click="openDislikeModal()">查看点踩明细</button>
        <button class="mini-btn" @click="tip('反馈报表')">导出报表</button>
      </div>

      <!-- 总览 2 格：点踩总量 + 趋势 -->
      <div class="fb-overview-wrap">
        <div class="fb-overview">
          <div class="fb-stat dislike">
            <div class="fb-stat-label">点踩总数</div>
            <div class="fb-stat-val">{{ fbTotal.dislikes.toLocaleString() }}<small>次</small></div>
            <div class="fb-stat-sub">点踩率 <strong>{{ fbTotal.dislikeRate }}%</strong></div>
            <div class="like-bar-wrap">
              <div class="like-bar"><i :style="`width:${fbTotal.dislikeRate}%`"></i></div>
              <span class="like-pct" style="color:var(--c-danger)">{{ fbTotal.dislikeRate }}%</span>
            </div>
          </div>
          <div class="fb-stat">
            <div class="fb-stat-label">本月点踩趋势</div>
            <div class="fb-stat-val trend">↓ {{ Math.abs(fbTotal.trend) }}%<small>较上月</small></div>
            <div class="fb-stat-sub">上月点踩率 <strong class="warn">15.3%</strong>，持续改善</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 点踩明细弹窗（原型 dlOverlay）：分页表格 + 导出 CSV 占位（2026-09-17 裁决：岗位筛选随「按岗位分布」一并删去） -->
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

    <!-- 对话明细弹窗（原型 cvOverlay）：由点踩明细表格【查看】打开，展示点踩前后几轮对话 -->
    <el-dialog v-model="cvVisible" class="admin-dialog" width="640px">
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
  </div>
</template>

<style scoped>
/* ---- 顶部工具行 ---- */
.ref-time {
  font-size: 13px;
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 6px;
}

/* ---- 指标卡区 ---- */
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  background: var(--border-base);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  margin-bottom: 0;
}
.metric {
  position: relative;
  min-height: 154px;
  padding: 17px 18px 15px;
  border: 0;
  background: #fff;
  text-align: left;
  transition: background 0.15s ease;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.metric.wide {
  grid-column: span 2;
}
.metric:hover {
  background: #fbfdfc;
}
.metric::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  background: var(--c-accent);
}
.metric.danger::before {
  background: var(--c-danger);
}
.metric.danger .metric-tag {
  border-color: #f0c7c4;
  background: var(--c-danger-soft, #fdebea);
  color: var(--c-danger);
}
.metric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.metric-label {
  color: #59655f;
  font-size: 13px;
  font-weight: 600;
}
.metric-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  border: 1px solid #d6e2db;
  background: #f0f5f2;
  color: #5a6a63;
  white-space: nowrap;
}
.metric-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 9px;
  flex: 1;
}
.metric-value {
  color: #17211c;
  font: 700 30px/1.1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -0.04em;
  white-space: nowrap;
}
.metric-value small {
  margin-left: 3px;
  color: #617069;
  font: 500 13px system-ui, sans-serif;
  letter-spacing: 0;
}
.metric-sub {
  margin-top: 9px;
  color: #66736c;
  font-size: 12px;
  line-height: 1.5;
}

/* 圆环进度 */
.dash-ring {
  --pct: 0;
  position: relative;
  width: 50px;
  height: 50px;
  display: grid;
  flex: 0 0 50px;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(var(--c-accent) calc(var(--pct) * 1%), #e7ece9 0);
}
.dash-ring::after {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  background: #fff;
}
.dash-ring b {
  position: relative;
  z-index: 1;
  color: #4c5a53;
  font: 600 10px ui-monospace, SFMono-Regular, Consolas, monospace;
}

/* 双格知识资产 */
.dual-stat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
}
.dual-stat span {
  padding: 9px 10px;
  border-left: 3px solid var(--c-accent);
  background: #f5faf7;
  color: #6c7771;
  font-size: 11px;
}
.dual-stat b {
  display: block;
  margin-bottom: 2px;
  color: #213028;
  font: 700 22px ui-monospace, SFMono-Regular, Consolas, monospace;
}

/* 待处理分项 */
.pending-breakdown {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  color: #6a756f;
  font-size: 11px;
}
.pending-breakdown b {
  display: block;
  font: 700 16px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.pending-breakdown span:nth-child(1) b { color: var(--c-warning, #e6921e); }
.pending-breakdown span:nth-child(2) b,
.pending-breakdown span:nth-child(3) b { color: var(--c-danger); }

/* ---- 面板 ---- */
.dash-panel {
  margin-top: 18px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg, 8px);
  background: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
.dash-panel-head {
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-base);
  background: #fbfcfb;
}
.dash-panel-title {
  margin: 0;
  color: #26312b;
  font-size: 16px;
  font-weight: 650;
}
.dash-panel-count {
  color: #7f8984;
  font-size: 12px;
}
.spacer { flex: 1; }

/* 待办告警列表 */
.dash-alert-list {
  min-height: 170px;
  padding: 14px 16px;
}
.dash-todo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.dash-todo-card {
  min-height: 140px;
  padding: 15px 16px;
  border: 1px solid var(--border-base);
  border-left: 4px solid var(--c-warning, #e6921e);
  border-radius: 6px;
  background: #fff;
  transition: background 0.15s ease, transform 0.15s ease;
  display: flex;
  flex-direction: column;
}
.dash-todo-card.high { border-left-color: var(--c-danger); }
.dash-todo-card:hover { background: #fbfcfb; transform: translateY(-1px); }
.dash-todo-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dash-todo-source { color: #65716b; font-size: 12px; font-weight: 600; }
.dash-todo-number {
  margin-top: 11px;
  color: #26312b;
  font: 700 28px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.dash-todo-number small {
  margin-left: 4px;
  color: #77827c;
  font: 500 12px system-ui, sans-serif;
}
.dash-todo-meta { min-height: 35px; margin-top: 5px; color: #76817b; font-size: 12px; line-height: 1.5; flex: 1; }
.dash-todo-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.dash-severity {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 650;
}
.dash-severity-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-warning, #e6921e);
  display: inline-block;
}
.dash-severity.high { color: var(--c-danger); }
.dash-severity.high .dash-severity-dot { background: var(--c-danger); }
.dash-severity.medium { color: var(--c-warning, #e6921e); }

/* 两栏格 */
.dash-grid-two {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  gap: 18px;
  margin-top: 18px;
}

/* 资产发布状态 */
.dash-asset-body { padding: 14px 18px 18px; }
.dash-asset-legend {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 10px;
  color: #727d77;
  font-size: 12px;
}
.dash-legend { display: inline-flex; align-items: center; gap: 6px; }
.dash-legend i { width: 8px; height: 8px; border-radius: 2px; background: #c7cfcb; }
.dash-legend .pub { background: var(--c-accent); }
.dash-legend .rev { background: #df9a33; }
.dash-legend .dft { background: #c7cfcb; }
.dash-asset-row {
  display: grid;
  grid-template-columns: 78px 40px minmax(100px, 1fr) 140px;
  align-items: center;
  gap: 12px;
  min-height: 39px;
}
.dash-asset-name { font-weight: 600; color: #414a45; }
.dash-asset-total { color: #6f7a74; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
.dash-stack {
  height: 10px;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  background: #eef1ef;
}
.dash-stack span { height: 100%; }
.dash-stack .pub { background: var(--c-accent); }
.dash-stack .rev { background: #df9a33; }
.dash-stack .dft { background: #c7cfcb; }
.dash-asset-detail {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  color: #7a8580;
  font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: nowrap;
}
.dash-asset-detail b { color: #3e4a44; font-weight: 600; }

/* 表格 */
.dash-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.dash-table th {
  height: 42px;
  padding: 0 16px;
  background: #f4f6f5;
  color: #69746e;
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.dash-table td {
  height: 48px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: middle;
}
.dash-table tbody tr:last-child td { border-bottom: 0; }
.dash-table tbody tr:hover td { background: #fbfcfb; }
.dash-num {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.dash-name-main {
  display: block;
  overflow: hidden;
  color: #354039;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dash-name-sub {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: #87918c;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dash-rank-name { display: flex; align-items: center; gap: 9px; }
.dash-rank-no {
  width: 20px;
  color: #8a948f;
  font: 600 11px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.dash-rank-no.top { color: var(--c-accent); }
.dash-bar-value {
  display: grid;
  grid-template-columns: minmax(68px, 1fr) 42px;
  align-items: center;
  gap: 9px;
}
.dash-bar-track {
  height: 7px;
  overflow: hidden;
  border-radius: 3px;
  background: #e9eeeb;
}
.dash-bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--c-accent);
}
.dash-bar-number {
  font: 600 12px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: right;
}

/* 用户端当前下发版本 */
.ver-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px 16px;
}
.ver-card {
  min-height: 150px;
  padding: 15px 16px;
  border: 1px solid var(--border-base);
  border-left: 4px solid var(--c-accent);
  border-radius: 6px;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.ver-line { display: flex; align-items: baseline; gap: 10px; margin-top: 11px; }
.ver-version {
  color: #26312b;
  font: 700 24px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.ver-time { color: #7f8984; font-size: 12px; }
.ver-notes-label { margin-top: 10px; color: #68736d; font-size: 12px; font-weight: 600; }
.ver-notes {
  width: 100%;
  max-height: 132px;
  margin-top: 4px;
  overflow: auto;
  color: #455049;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-line; /* 更新说明保留换行 */
}
.ver-empty { margin-top: 11px; color: #94a09a; font-size: 13px; line-height: 32px; }
.ver-skeleton {
  width: 100%;
  height: 88px;
  margin-top: 11px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f0f3f1 25%, #f7f9f8 50%, #f0f3f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1s linear infinite;
}
.ver-error { padding: 14px 18px; color: #68736d; font-size: 13px; }

/* 点赞/点踩 */
.fb-panel { }
.fb-overview-wrap { padding: 16px 18px 0; }
.fb-overview {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
.fb-stat-val.trend { color: #197b59; font-size: 22px; }
.fb-stat-sub { margin-top: 5px; color: #76817b; font-size: 12px; }
.fb-stat-sub strong { color: var(--c-accent); font-weight: 650; }
.fb-stat-sub .warn { color: var(--c-warning, #e6921e); font-weight: 650; }
.like-bar-wrap { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.like-bar { flex: 1; height: 6px; border-radius: 3px; background: #edf1ef; overflow: hidden; }
.like-bar i { display: block; height: 100%; border-radius: inherit; background: var(--c-danger); }
.like-pct { font: 600 11px ui-monospace, SFMono-Regular, Consolas, monospace; color: #617069; min-width: 36px; text-align: right; }

/* mini-btn 复用原型样式 */
.mini-btn {
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border-base);
  border-radius: 5px;
  background: #fff;
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.mini-btn:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft, #eaf6f1);
}

/* shimmer loading */
.loading .metric-label,
.loading .metric-value,
.loading .metric-sub,
.loading .dash-alert-list,
.loading .dash-asset-row,
.loading .dash-table tbody tr {
  color: transparent !important;
  background: linear-gradient(90deg, #f0f3f1 25%, #f7f9f8 50%, #f0f3f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1s linear infinite;
}
.loading .metric::before,
.loading .dash-severity-dot { opacity: 0; }
/* 刷新期间整页不可交互（PRD §一.2 / §八）：骨架屏只处理视觉，点击仍会穿透触发 toast，
   pointer-events:none 挂在根节点，靴子一次性罩住全部卡片/按钮/弹窗触发点。 */
.cockpit.loading { pointer-events: none; }
@keyframes shimmer { to { background-position: -200% 0; } }

@media (max-width: 1260px) {
  .dash-grid-two { grid-template-columns: 1fr; }
  .dash-todo-grid { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .metric.wide { grid-column: span 2; }
  .ver-grid { grid-template-columns: 1fr; }
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
.mini-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.mini-btn:disabled:hover { color: var(--c-text); border-color: var(--border-base); background: #fff; }

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
