<script setup>
/**
 * 驾驶舱（01 总览）—— 全局概览：资产发布率、岗位领用、成本、待办、反馈统计。
 * 数据全部静态 mock，对应原型 renderDashboard 内容。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'

const refreshTime = ref('09:30')
const refreshing = ref(false)

// 6 张指标卡
const metrics = [
  { label: '已发布岗位数量', tag: '已发布', value: 14, unit: '个', sub: '全部岗位 18 个', pct: 78, type: '' },
  { label: '领用岗位员工数量', tag: '覆盖率', value: 241, unit: '人', sub: '启用员工 268 人', pct: 90, type: '' },
  { label: '已发布技能数量', tag: '已发布', value: 68, unit: '个', sub: '全部技能 82 个', pct: 83, type: '' },
  { label: '已发布专家数量', tag: '已发布', value: 18, unit: '个', sub: '全部专家 22 个', pct: 82, type: '' },
  { label: '知识资产', tag: '资产构成', type: 'dual', knowledge: 12, source: 19, sub: '点击查看知识资产明细' },
  { label: '本月成本', tag: '截至今日', type: 'cost', value: '¥18,420', sub: '需接入模型调用与计费数据',
    segments: [29.4, 22.7, 16.6, 12.2, 9.7, 9.4] },
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

// 异常与待办
const alerts = [
  { count: 11, level: 'medium', label: '待审核', text: '审核中心有 11 条申请待审核', meta: '发布审核 7 / 版本发布 3 / 停用审核 1', source: '审核中心', action: '去审核' },
  { count: 3,  level: 'high',   label: '连接失败', text: '连接器有 3 个连接失败',        meta: 'MCP 2 / API 1',                    source: '连接器',   action: '去处理' },
  { count: 2,  level: 'high',   label: '高风险',   text: '用户上传技能有 2 个高风险',    meta: '等待人工审核',                      source: '技能审核', action: '去审核' },
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

// 岗位领用 Top 5
const posTop = [
  { rank: '01', top: true, name: '销售顾问',    version: 'v2.3.0 / 已发布', users: 48, skills: 9, agents: 3 },
  { rank: '02', top: true, name: '经营分析师',  version: 'v1.6.0 / 已发布', users: 39, skills: 7, agents: 4 },
  { rank: '03', top: true, name: '项目经理助手', version: 'v1.4.0 / 已发布', users: 34, skills: 6, agents: 2 },
  { rank: '04', top: false, name: '产品经理助手', version: 'v2.1.0 / 已发布', users: 27, skills: 8, agents: 3 },
  { rank: '05', top: false, name: '公文写作',    version: 'v1.2.0 / 已发布', users: 21, skills: 4, agents: 1 },
]
const maxUsers = 48

// 点赞/点踩统计
const fbTotal = { sessions: 8420, likes: 7389, dislikes: 1031, likeRate: 87.8, dislikeRate: 12.2, trend: -3.1 }
const fbByPos = [
  { name: '销售顾问',    sessions: 2341, likes: 2098, dislikes: 243 },
  { name: '经营分析师',  sessions: 1876, likes: 1691, dislikes: 185 },
  { name: '项目经理助手', sessions: 1452, likes: 1283, dislikes: 169 },
  { name: '产品经理助手', sessions: 1201, likes: 1084, dislikes: 117 },
  { name: '公文写作',    sessions:  987, likes:  921, dislikes:  66 },
  { name: '生产计划员',  sessions:  563, likes:  312, dislikes: 251 },
]

function dislikeRate(p) { return (p.dislikes / p.sessions * 100).toFixed(1) }
function rateClass(p) {
  const r = parseFloat(dislikeRate(p))
  return r > 20 ? 'rate-bad' : r > 10 ? 'rate-med' : 'rate-ok'
}

function doRefresh() {
  refreshing.value = true
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
</script>

<template>
  <div class="cockpit" :class="{ loading: refreshing }">
    <PageHeader title="驾驶舱" subtitle="查看数字员工资产、岗位领用、任务运行、成本和治理待办。">
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
          <span class="status-tag">{{ m.tag }}</span>
        </span>
        <span class="metric-main">
          <span class="metric-value">{{ m.value }}<small>{{ m.unit }}</small></span>
          <span class="dash-ring" :style="`--pct:${m.pct}`"><b>{{ m.pct }}%</b></span>
        </span>
        <span class="metric-sub">{{ m.sub }}</span>
      </button>

      <!-- 知识资产 -->
      <button class="metric" @click="tip('知识库')">
        <span class="metric-head">
          <span class="metric-label">知识资产</span>
          <span class="status-tag">资产构成</span>
        </span>
        <span class="metric-main">
          <span class="dual-stat">
            <span><b>{{ metrics[4].knowledge }}</b>知识库</span>
            <span><b>{{ metrics[4].source }}</b>数据源</span>
          </span>
        </span>
        <span class="metric-sub">{{ metrics[4].sub }}</span>
      </button>

      <!-- 本月成本（wide） -->
      <button class="metric wide" @click="tip('成本明细')">
        <span class="metric-head">
          <span class="metric-label">本月成本</span>
          <span class="status-tag">截至今日</span>
        </span>
        <span class="metric-main">
          <span class="metric-value">{{ metrics[5].value }}</span>
          <span class="metric-chart">
            <span class="segment-bar">
              <i v-for="(w, i) in metrics[5].segments" :key="i" :style="`width:${w}%`"></i>
            </span>
            <span class="chart-note">
              <span>Top 5 岗位</span>
              <b>{{ metrics[5].segments.reduce((s, v) => s + v, 0).toFixed(1) }}%</b>
            </span>
          </span>
        </span>
        <span class="metric-sub">{{ metrics[5].sub }}</span>
      </button>

      <!-- 待处理（danger） -->
      <button class="metric danger" @click="tip('待处理事项')">
        <span class="metric-head">
          <span class="metric-label">{{ pendingMetric.label }}</span>
          <span class="status-tag">{{ pendingMetric.tag }}</span>
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
              <button class="mini-btn" @click="tip(item.text)">{{ item.action }}</button>
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
            <span><button class="mini-btn" @click="tip(item.name + '列表')">查看</button></span>
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
              <th style="width:32%">岗位</th>
              <th style="width:30%">领用人数</th>
              <th class="dash-num">技能数</th>
              <th class="dash-num">Agent 数</th>
              <th style="width:56px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pos in posTop" :key="pos.rank">
              <td>
                <span class="dash-rank-name">
                  <span class="dash-rank-no" :class="{ top: pos.top }">{{ pos.rank }}</span>
                  <span>
                    <span class="dash-name-main">{{ pos.name }}</span>
                    <span class="dash-name-sub">{{ pos.version }}</span>
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
              <td><button class="mini-btn" @click="tip(pos.name + '详情')">查看</button></td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 点赞/点踩统计 -->
    <section class="dash-panel fb-panel">
      <div class="dash-panel-head">
        <h2 class="dash-panel-title">用户端点赞 / 点踩统计</h2>
        <span class="dash-panel-count">每轮对话均可反馈</span>
        <span class="spacer"></span>
        <button class="mini-btn" @click="tip('点踩明细')">查看点踩明细</button>
        <button class="mini-btn" @click="tip('反馈报表')">导出报表</button>
      </div>

      <!-- 总览 4 格 -->
      <div class="fb-overview-wrap">
        <div class="fb-overview">
          <div class="fb-stat">
            <div class="fb-stat-label">累计对话轮次</div>
            <div class="fb-stat-val">{{ fbTotal.sessions.toLocaleString() }}<small>轮</small></div>
            <div class="fb-stat-sub">本月 <strong>1,247</strong> 轮</div>
          </div>
          <div class="fb-stat">
            <div class="fb-stat-label">点赞总数</div>
            <div class="fb-stat-val like">{{ fbTotal.likes.toLocaleString() }}<small>次</small></div>
            <div class="fb-stat-sub">点赞率 <strong>{{ fbTotal.likeRate }}%</strong></div>
            <div class="like-bar-wrap">
              <div class="like-bar"><i :style="`width:${fbTotal.likeRate}%`"></i></div>
              <span class="like-pct">{{ fbTotal.likeRate }}%</span>
            </div>
          </div>
          <div class="fb-stat dislike">
            <div class="fb-stat-label">点踩总数</div>
            <div class="fb-stat-val">{{ fbTotal.dislikes.toLocaleString() }}<small>次</small></div>
            <div class="fb-stat-sub">点踩率 <strong>{{ fbTotal.dislikeRate }}%</strong></div>
            <div class="like-bar-wrap">
              <div class="like-bar"><i class="bad" :style="`width:${fbTotal.dislikeRate}%`"></i></div>
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

      <!-- 按岗位分布 -->
      <div class="fb-by-pos">
        <div class="fb-by-pos-title">按岗位分布</div>
        <table class="dash-table">
          <thead>
            <tr>
              <th style="width:20%">岗位</th>
              <th class="dash-num">对话轮次</th>
              <th class="dash-num">点赞</th>
              <th class="dash-num">点踩</th>
              <th style="width:24%">点赞 / 点踩构成</th>
              <th class="dash-num">点踩率</th>
              <th class="dash-num">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in fbByPos" :key="p.name">
              <td><span class="dash-name-main">{{ p.name }}</span></td>
              <td class="dash-num">{{ p.sessions.toLocaleString() }}</td>
              <td class="dash-num like-num">{{ p.likes.toLocaleString() }}</td>
              <td class="dash-num dislike-num">{{ p.dislikes.toLocaleString() }}</td>
              <td>
                <div class="fb-seg-bar">
                  <div class="seg-like" :style="`width:${(p.likes/p.sessions*100).toFixed(1)}%`"></div>
                  <div class="seg-dislike" :style="`width:${(p.dislikes/p.sessions*100).toFixed(1)}%`"></div>
                </div>
              </td>
              <td class="dash-num" :class="rateClass(p)">{{ dislikeRate(p) }}%</td>
              <td class="dash-num"><button class="mini-btn" @click="tip(p.name + '点踩明细')">明细</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
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
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  background: var(--c-border);
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
.metric.danger .status-tag {
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
.status-tag {
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

/* 成本分段条 */
.metric-chart { flex: 1; min-width: 130px; }
.segment-bar {
  height: 10px;
  display: flex;
  overflow: hidden;
  border-radius: 3px;
  background: #edf1ef;
}
.segment-bar i { height: 100%; }
.segment-bar i:nth-child(1) { background: #078b61; }
.segment-bar i:nth-child(2) { background: #41a783; }
.segment-bar i:nth-child(3) { background: #79bda3; }
.segment-bar i:nth-child(4) { background: #a9d4c3; }
.segment-bar i:nth-child(5) { background: #d0e7de; }
.segment-bar i:nth-child(6) { background: #e2e7e4; }
.chart-note {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  color: #7a8580;
  font-size: 11px;
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
  border: 1px solid var(--c-border);
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
  border-bottom: 1px solid var(--c-border);
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
  border: 1px solid var(--c-border);
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
  grid-template-columns: 78px 40px minmax(100px, 1fr) 140px 56px;
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
  border-bottom: 1px solid var(--c-border-soft, #f0f1f3);
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

/* 点赞/点踩 */
.fb-panel { }
.fb-overview-wrap { padding: 16px 18px 0; }
.fb-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg, 8px);
  background: var(--c-border);
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
.fb-stat-val.like { color: #197b59; }
.fb-stat-val.trend { color: #197b59; font-size: 22px; }
.fb-stat-sub { margin-top: 5px; color: #76817b; font-size: 12px; }
.fb-stat-sub strong { color: var(--c-accent); font-weight: 650; }
.fb-stat-sub .warn { color: var(--c-warning, #e6921e); font-weight: 650; }
.like-bar-wrap { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.like-bar { flex: 1; height: 6px; border-radius: 3px; background: #edf1ef; overflow: hidden; }
.like-bar i { display: block; height: 100%; border-radius: inherit; background: var(--c-accent); }
.like-bar i.bad { background: var(--c-danger); }
.like-pct { font: 600 11px ui-monospace, SFMono-Regular, Consolas, monospace; color: #617069; min-width: 36px; text-align: right; }
.fb-by-pos { margin-top: 16px; }
.fb-by-pos-title {
  padding: 12px 18px 8px;
  color: #5a6660;
  font-size: 13px;
  font-weight: 600;
  border-top: 1px solid var(--c-border-soft, #f0f1f3);
}
.fb-seg-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #edf1ef;
  min-width: 80px;
}
.fb-seg-bar .seg-like { background: var(--c-accent); }
.fb-seg-bar .seg-dislike { background: var(--c-danger); }
.like-num { color: #197b59; font-weight: 600; }
.dislike-num { color: var(--c-danger); font-weight: 600; }
.rate-bad { color: var(--c-danger); font-weight: 650; }
.rate-med { color: var(--c-warning, #e6921e); font-weight: 650; }
.rate-ok { color: #197b59; font-weight: 650; }

/* mini-btn 复用原型样式 */
.mini-btn {
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--c-border);
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
@keyframes shimmer { to { background-position: -200% 0; } }

@media (max-width: 1260px) {
  .dash-grid-two { grid-template-columns: 1fr; }
  .dash-todo-grid { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .metric.wide { grid-column: span 2; }
  .fb-overview { grid-template-columns: repeat(2, 1fr); }
}
</style>
