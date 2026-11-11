<script setup>
/**
 * CockpitUsageTab —— 驾驶舱「使用情况」页签（PRD prd.驾驶舱.md 第五～九节，仅 ADMIN 可见）。
 *
 * 自上而下：筛选条 → 四张使用概览卡 → 趋势图 → 用户端点踩统计 → 使用明细（用户 / 岗位 / 模型 / 能力）。
 * 筛选条（时间范围 / 终端 / 岗位）变化即整体重取数，所有区块共用同一份汇总，数字互相对得上。
 *
 * @prop {number} refreshToken 驾驶舱【刷新】每点一次 +1，本页签据此重新取数
 * @prop {boolean} refreshing 驾驶舱刷新中（约 650ms），期间区块呈骨架屏
 */
import { computed, onMounted, ref, watch } from 'vue'
import { getUsageSummary } from '@/api/usage'
import { fmtChange, fmtCount, fmtTokens } from '@/utils/usageFormat'
import UsageTrendChart from './UsageTrendChart.vue'
import UsageFeedbackPanel from './UsageFeedbackPanel.vue'
import UsageDetailTables from './UsageDetailTables.vue'

const props = defineProps({
  refreshToken: { type: Number, default: 0 },
  refreshing: { type: Boolean, default: false }
})

const RANGE_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' }
]
// el-select 把空串当作「没选」，会显示成占位符而不是「全部…」，所以「全部」用哨兵值，取数时再换回空串
const ALL = 'ALL'
const TERMINALS = [
  { value: ALL, label: '全部终端' },
  { value: 'WINDOWS', label: 'Windows' },
  { value: 'MAC', label: 'Mac' }
]

const range = ref(30)
const terminal = ref(ALL)
const position = ref(ALL)

// 首次取回前用全零占位渲染，配合骨架屏，避免区块忽有忽无
const EMPTY = {
  range: 30,
  claimedUsers: 0,
  positionOptions: [],
  kpis: {
    activeUsers: { value: 0, change: null, rate: 0 },
    sessions: { value: 0, change: null, perUser: 0 },
    tokens: { total: 0, input: 0, output: 0, change: null },
    failRate: { value: 0, change: null, failed: 0, calls: 0 }
  },
  trend: [],
  feedback: { likes: 0, dislikes: 0, rate: null, prevRate: null },
  users: [],
  positions: [],
  models: [],
  abilities: []
}
const data = ref(null)
const loading = ref(true)
const error = ref(false)
const positionOptions = ref([])
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  error.value = false
  try {
    const res = await getUsageSummary({
      range: range.value,
      terminal: terminal.value === ALL ? '' : terminal.value,
      position: position.value === ALL ? '' : position.value
    })
    if (my !== seq) return // 筛选连改时只认最后一次请求
    data.value = res
    positionOptions.value = res.positionOptions
  } catch {
    if (my !== seq) return
    error.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(load)
watch([range, terminal, position], load)
watch(() => props.refreshToken, load)

const view = computed(() => data.value || EMPTY)
const busy = computed(() => loading.value || props.refreshing)

// 概览卡：good 表示「下降是好事」，只有失败率用；其余用量类指标升降不分好坏，中性灰
const cards = computed(() => {
  const k = view.value.kpis
  return [
    {
      key: 'active', label: '活跃用户', value: fmtCount(k.activeUsers.value), unit: '人',
      sub: `活跃率 ${k.activeUsers.rate}%`, change: k.activeUsers.change, changeText: fmtChange(k.activeUsers.change)
    },
    {
      key: 'sessions', label: '会话数', value: fmtCount(k.sessions.value), unit: '次',
      sub: `人均 ${k.sessions.perUser} 次`, change: k.sessions.change, changeText: fmtChange(k.sessions.change)
    },
    {
      key: 'tokens', label: 'Token 消耗', value: fmtTokens(k.tokens.total), unit: '',
      sub: `输入 ${fmtTokens(k.tokens.input)} / 输出 ${fmtTokens(k.tokens.output)}`, change: k.tokens.change, changeText: fmtChange(k.tokens.change)
    },
    {
      key: 'fail', label: '模型调用失败率', value: `${k.failRate.value}%`, unit: '',
      sub: `失败 ${fmtCount(k.failRate.failed)} 次 / 共 ${fmtCount(k.failRate.calls)} 次调用`,
      change: k.failRate.change, changeText: fmtChange(k.failRate.change, ' 个百分点'), good: 'down'
    }
  ]
})
const changeClass = (c) => {
  if (c.good !== 'down' || !c.change) return ''
  return c.change < 0 ? 'is-good' : 'is-bad'
}

const helpOpen = ref(false)
const HELP = [
  '活跃用户：时间范围内至少产生 1 次对话的用户，不是登录；已领用岗位但时间范围内没有对话的用户计为"沉默用户"。',
  '会话数：用户端发起的对话会话数。',
  'Token：以模型返回的用量为准，输入与输出分开累计，失败的调用不计。',
  '模型调用：每次向模型发起的请求，一轮对话里工具循环可能产生多次调用；失败率 ＝ 失败调用 ÷ 全部调用。',
  '较上一周期：与紧邻的前一个等长周期相比；上述口径为产品侧假设，最终以研发数据方案为准。'
]
</script>

<template>
  <div class="usage-tab" :class="{ 'is-busy': busy }">
    <!-- 筛选条：对本页签全部区块生效，改动即重新取数 -->
    <div class="usage-filters">
      <el-select v-model="range" class="uf-select" aria-label="时间范围">
        <el-option v-for="o in RANGE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="terminal" class="uf-select" aria-label="终端">
        <el-option v-for="o in TERMINALS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="position" class="uf-select uf-wide" aria-label="岗位">
        <el-option label="全部岗位" :value="ALL" />
        <el-option v-for="p in positionOptions" :key="p" :label="p" :value="p" />
      </el-select>
      <span class="uf-note">统计截止昨日；点踩明细弹窗里的样例记录不随筛选变化</span>
    </div>

    <div v-if="error" class="usage-error">
      加载失败
      <el-button link type="primary" @click="load">重试</el-button>
    </div>

    <template v-else>
      <!-- 四张使用概览卡（仅展示，不可点击） -->
      <div class="kpi-grid">
        <div v-for="c in cards" :key="c.key" class="kpi-card" :data-kpi="c.key">
          <div class="kpi-label">{{ c.label }}</div>
          <div class="kpi-value">{{ c.value }}<small v-if="c.unit">{{ c.unit }}</small></div>
          <div class="kpi-sub">{{ c.sub }}</div>
          <div class="kpi-change" :class="changeClass(c)">{{ c.changeText }}<span> 较上一周期</span></div>
        </div>
      </div>
      <div class="help-entry">
        <el-button link type="primary" @click="helpOpen = !helpOpen">统计口径</el-button>
      </div>
      <div v-if="helpOpen" class="help-body">
        <p v-for="(t, i) in HELP" :key="i">{{ t }}</p>
      </div>

      <UsageTrendChart :points="view.trend" />
      <UsageFeedbackPanel :feedback="view.feedback" :range="range" />
      <UsageDetailTables :data="view" />
    </template>
  </div>
</template>

<style scoped>
.usage-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.uf-select { width: 130px; }
.uf-wide { width: 160px; }
.uf-note { margin-left: 4px; color: #94a09a; font-size: 12px; }

.usage-error { margin-top: 18px; padding: 28px 18px; text-align: center; color: #68736d; font-size: 13px; border: 1px dashed var(--border-base); border-radius: 8px; background: #fff; }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.kpi-card {
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--border-base);
  border-top: 3px solid var(--c-accent);
  border-radius: 6px;
}
.kpi-card[data-kpi='fail'] { border-top-color: var(--c-warning, #e6921e); }
.kpi-label { color: #68736d; font-size: 12px; margin-bottom: 5px; }
.kpi-value {
  font: 700 28px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #26312b;
  letter-spacing: -0.03em;
}
.kpi-value small { margin-left: 3px; color: #7a8580; font: 500 13px system-ui, sans-serif; letter-spacing: 0; }
.kpi-sub { margin-top: 4px; color: #76817b; font-size: 12px; }
.kpi-change { margin-top: 8px; color: #7f8984; font-size: 12px; font-variant-numeric: tabular-nums; }
.kpi-change span { color: #a0aaa5; }
.kpi-change.is-good { color: #197b59; }
.kpi-change.is-bad { color: var(--c-danger); }

.help-entry { margin-top: 4px; }
.help-body {
  margin-top: 4px;
  padding: 10px 14px;
  background: #f7f9f8;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: #5b6760;
  font-size: 12px;
  line-height: 1.7;
}
.help-body p { margin: 0; }

/* 取数中 / 驾驶舱刷新中：区块呈骨架屏，不可交互 */
.is-busy { pointer-events: none; }
.is-busy .kpi-card,
.is-busy :deep(.fb-stat),
.is-busy :deep(.trend-body),
.is-busy :deep(.dash-table tbody tr) {
  color: transparent !important;
  background: linear-gradient(90deg, #f0f3f1 25%, #f7f9f8 50%, #f0f3f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1s linear infinite;
}
.is-busy .kpi-card *,
.is-busy :deep(.fb-stat *),
.is-busy :deep(.dash-table tbody tr *) { color: transparent !important; }

@media (max-width: 1100px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
