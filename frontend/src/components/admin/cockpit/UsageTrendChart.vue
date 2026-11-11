<script setup>
/**
 * UsageTrendChart —— 驾驶舱「使用情况」趋势图（PRD 第五节第 3 条）。
 *
 * 按天一根柱：活跃用户 / 会话数为单色柱，Token 为输入（强调色）+ 输出（浅色）堆叠柱。
 * 不引图表库——柱高就是 CSS 百分比，示意用足够，研发接真实图表库时只需对照 points 的字段。
 *
 * @prop {Array<{date:string,activeUsers:number,sessions:number,inputTokens:number,outputTokens:number}>} points 按天
 * 指标切换在组件内部做（只换图，不重新取数）。
 */
import { computed, ref } from 'vue'
import { fmtCount, fmtTokens, niceMax } from '@/utils/usageFormat'

const props = defineProps({
  points: { type: Array, default: () => [] }
})

const METRICS = [
  { value: 'activeUsers', label: '活跃用户' },
  { value: 'sessions', label: '会话数' },
  { value: 'tokens', label: 'Token' }
]
const metric = ref('activeUsers')
const hover = ref(-1)

const valueOf = (p) => (metric.value === 'tokens' ? p.inputTokens + p.outputTokens : p[metric.value])
const fmtAxis = (v) => (metric.value === 'tokens' ? fmtTokens(v) : fmtCount(v))

const top = computed(() => niceMax(Math.max(0, ...props.points.map(valueOf))))
const isEmpty = computed(() => props.points.every((p) => valueOf(p) === 0))
const gridLabels = computed(() => [top.value, top.value / 2, 0].map(fmtAxis))

const bars = computed(() =>
  props.points.map((p) => {
    const total = valueOf(p)
    return {
      height: (total / top.value) * 100,
      // Token 堆叠：输入占柱高的比例
      inShare: metric.value === 'tokens' && total ? (p.inputTokens / total) * 100 : 100
    }
  })
)

// 横轴最多标 8 个日期
const tickStep = computed(() => Math.max(1, Math.ceil(props.points.length / 8)))

const readout = computed(() => {
  const p = props.points[hover.value]
  if (!p) return '悬停柱子查看当日数值'
  if (metric.value === 'tokens') {
    return `${p.date} · 输入 ${fmtTokens(p.inputTokens)} / 输出 ${fmtTokens(p.outputTokens)} / 合计 ${fmtTokens(p.inputTokens + p.outputTokens)}`
  }
  const unit = metric.value === 'activeUsers' ? '人' : '次'
  return `${p.date} · ${METRICS.find((m) => m.value === metric.value).label} ${fmtCount(valueOf(p))} ${unit}`
})
</script>

<template>
  <section class="dash-panel trend-panel" aria-label="使用趋势">
    <div class="dash-panel-head">
      <h2 class="dash-panel-title">使用趋势</h2>
      <span class="dash-panel-count">按天统计</span>
      <span class="spacer"></span>
      <el-radio-group v-model="metric" size="small" @change="hover = -1">
        <el-radio-button v-for="m in METRICS" :key="m.value" :value="m.value">{{ m.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="trend-body">
      <div class="trend-top">
        <span class="trend-readout" data-testid="trend-readout">{{ readout }}</span>
        <span v-if="metric === 'tokens'" class="trend-legend">
          <span><i class="in"></i>输入</span>
          <span><i class="out"></i>输出</span>
        </span>
      </div>

      <div v-if="isEmpty" class="trend-empty">暂无使用数据</div>
      <template v-else>
        <div class="trend-plot">
          <div class="trend-axis">
            <span v-for="(l, i) in gridLabels" :key="i">{{ l }}</span>
          </div>
          <div class="trend-bars" @mouseleave="hover = -1">
            <div
              v-for="(b, i) in bars"
              :key="points[i].date"
              class="trend-col"
              :class="{ hover: hover === i }"
              data-testid="trend-col"
              @mouseenter="hover = i"
            >
              <div class="trend-stack" :style="{ height: b.height + '%' }">
                <i v-if="metric === 'tokens'" class="seg out" :style="{ flex: 100 - b.inShare }"></i>
                <i class="seg in" :style="{ flex: b.inShare }"></i>
              </div>
            </div>
          </div>
        </div>
        <div class="trend-x">
          <span v-for="(p, i) in points" :key="p.date" class="trend-tick">
            <template v-if="i % tickStep === 0">{{ p.date }}</template>
          </span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.trend-panel { margin-top: 18px; }
.trend-body { padding: 12px 18px 16px; }
.trend-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  margin-bottom: 8px;
}
.trend-readout { color: #4a5650; font-size: 12px; font-variant-numeric: tabular-nums; }
.trend-legend { display: inline-flex; gap: 12px; color: #727d77; font-size: 12px; }
.trend-legend span { display: inline-flex; align-items: center; gap: 6px; }
.trend-legend i { width: 8px; height: 8px; border-radius: 2px; background: var(--c-accent); }
.trend-legend i.out { background: #b7d9cc; }
.trend-empty { height: 168px; display: flex; align-items: center; justify-content: center; color: #94a09a; font-size: 13px; }

.trend-plot { display: grid; grid-template-columns: 44px 1fr; gap: 8px; height: 168px; }
.trend-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  color: #8a948f;
  font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.trend-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  border-bottom: 1px solid var(--border-base);
  background:
    linear-gradient(var(--border-soft), var(--border-soft)) 0 0 / 100% 1px no-repeat,
    linear-gradient(var(--border-soft), var(--border-soft)) 0 50% / 100% 1px no-repeat;
}
.trend-col { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; }
.trend-stack { width: 100%; display: flex; flex-direction: column; border-radius: 2px 2px 0 0; overflow: hidden; }
.trend-col .seg { display: block; min-height: 0; background: var(--c-accent); opacity: 0.78; }
.trend-col .seg.out { background: #b7d9cc; opacity: 1; }
.trend-col.hover .seg { opacity: 1; }
.trend-col.hover .seg.out { background: #9ccbb9; }

.trend-x { display: flex; gap: 2px; margin: 6px 0 0 52px; }
.trend-tick { flex: 1; min-width: 0; height: 14px; position: relative; color: #8a948f; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.trend-tick > * , .trend-tick { white-space: nowrap; }
</style>
