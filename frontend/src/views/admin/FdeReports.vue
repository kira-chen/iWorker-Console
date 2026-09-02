<script setup>
/**
 * FDE 工作台报表（设计 §6 / P2）。
 *
 * 调 GET /api/fde/reports/fde/overview（门：FDE/ADMIN），出真实 DB 统计：
 * - 指标卡：岗位（发布/草稿）、Agent、技能（发布/草稿）、数据表、领用总数。
 * - 图表：技能分类分布（环形饼，OPERATION/QUERY）+ 岗位领用 Top（横向柱）。
 *
 * 状态：loading（骨架）/ 错误（重试）/ 空态（无数据提示）。
 * 图表色一律走 EChart 的语义色 key（双主题跟随），不在本页硬编码色值。
 * 仅引设计令牌，双主题自适配。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import EChart from '@/components/common/EChart.vue'
import { getFdeOverview } from '@/api/report'
import { categoryLabel } from '@/utils/skillCategory'

const loading = ref(false)
const error = ref(false)
const data = ref(null)

const summary = computed(() => data.value?.summary || {})
const skillByCategory = computed(() => data.value?.distributions?.skillByCategory || [])
const positionClaimTop = computed(() => data.value?.distributions?.positionClaimTop || [])

// 指标卡：分组展示岗位/Agent/技能/数据表/领用关键数字
const metrics = computed(() => [
  { key: 'positionPublished', label: '已发布岗位', value: summary.value.positionPublished },
  { key: 'positionDraft', label: '草稿岗位', value: summary.value.positionDraft },
  { key: 'agentTotal', label: 'Agent 总数', value: summary.value.agentTotal },
  { key: 'skillPublished', label: '已发布技能', value: summary.value.skillPublished },
  { key: 'skillDraft', label: '草稿技能', value: summary.value.skillDraft },
  { key: 'dataTableTotal', label: '数据表总数', value: summary.value.dataTableTotal },
  { key: 'bindingTotal', label: '领用总数', value: summary.value.bindingTotal }
])

// 是否完全无数据（图表两组分布均空）→ 空态提示
const isEmpty = computed(
  () => !skillByCategory.value.length && !positionClaimTop.value.length
)

// 技能分类分布 → 环形饼；label 走前端口径（OPERATION→操作类 / QUERY→查询类）
const skillPieOption = (c) => ({
  tooltip: {
    trigger: 'item',
    backgroundColor: c['bg-surface'],
    borderColor: c['border-base'],
    textStyle: { color: c.text }
  },
  legend: { bottom: 0, textStyle: { color: c['text-muted'] } },
  series: [
    {
      type: 'pie',
      radius: ['45%', '70%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: c['bg-surface'], borderWidth: 2 },
      label: { color: c.text },
      data: skillByCategory.value.map((d, i) => ({
        name: categoryLabel(d.label) || d.label,
        value: d.value,
        itemStyle: { color: i === 0 ? c.accent : c.success }
      }))
    }
  ]
})

// 岗位领用 Top → 横向柱。category 轴首项在底、末项在顶，故按 value 升序排列使最大在上；
// 自排序不依赖后端一定降序，兜底保证“最大在上”。
const claimBarOption = (c) => {
  const items = positionClaimTop.value.slice().sort((a, b) => a.value - b.value)
  return {
    grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: c['bg-surface'],
      borderColor: c['border-base'],
      textStyle: { color: c.text }
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: c['text-muted'] },
      splitLine: { lineStyle: { color: c['border-base'] } }
    },
    yAxis: {
      type: 'category',
      data: items.map((d) => d.label),
      axisLabel: { color: c.text }
    },
    series: [
      {
        type: 'bar',
        data: items.map((d) => d.value),
        itemStyle: { color: c.accent, borderRadius: [0, 4, 4, 0] },
        barWidth: '55%'
      }
    ]
  }
}

async function load() {
  loading.value = true
  error.value = false
  try {
    data.value = await getFdeOverview()
  } catch (e) {
    error.value = true
    ElMessage.error('报表加载失败，请重试')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <PageHeader
      title="报表"
      subtitle="岗位 / Agent / 技能 / 数据表 / 领用的真实统计概览"
    />

    <!-- 错误态：加载失败 + 重试 -->
    <el-result
      v-if="error && !loading"
      icon="warning"
      title="报表加载失败"
      sub-title="请检查网络或权限后重试"
    >
      <template #extra>
        <el-button type="primary" @click="load">重试</el-button>
      </template>
    </el-result>

    <template v-else-if="!loading">
      <!-- 指标卡 -->
      <div class="rp-metrics">
        <div v-for="m in metrics" :key="m.key" class="np-card rp-metric">
          <div class="rp-metric-label">{{ m.label }}</div>
          <div class="rp-metric-value">{{ m.value ?? 0 }}</div>
        </div>
      </div>

      <!-- 空态：无任何分布数据 -->
      <el-empty
        v-if="isEmpty"
        description="暂无可视化数据，先在工作台创建岗位与技能"
        class="rp-empty"
      />

      <!-- 图表 -->
      <div v-else class="rp-charts">
        <div class="np-card rp-chart">
          <div class="rp-chart-title">技能分类分布</div>
          <EChart
            v-if="skillByCategory.length"
            :build-option="skillPieOption"
            :chart-data="skillByCategory"
            :color-keys="['accent', 'success', 'text', 'text-muted', 'bg-surface', 'border-base']"
          />
          <el-empty v-else description="暂无技能数据" :image-size="80" />
        </div>
        <div class="np-card rp-chart">
          <div class="rp-chart-title">岗位领用 Top</div>
          <EChart
            v-if="positionClaimTop.length"
            :build-option="claimBarOption"
            :chart-data="positionClaimTop"
            :color-keys="['accent', 'text', 'text-muted', 'border-base', 'bg-surface']"
          />
          <el-empty v-else description="暂无领用数据" :image-size="80" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.rp-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-4);
}
.rp-metric {
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rp-metric-label {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.rp-metric-value {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  line-height: 1.2;
}
.rp-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: var(--space-4);
}
.rp-chart {
  padding: var(--space-5);
}
.rp-chart-title {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-3);
}
.rp-empty {
  padding: var(--space-8) 0;
}
</style>
