<script setup>
/**
 * 系统配置报表（设计 §6 / P2）。
 *
 * 调 GET /api/fde/reports/sysconfig/overview（门：SYS_CONFIG/ADMIN），出真实 DB 统计：
 * - 指标卡：连接器（MCP/API/业务系统）、工具市场总数 + 待审核、收藏总数。
 * - 图表：检活健康分布（环形饼，三态 HEALTHY/UNHEALTHY/UNKNOWN）+ 工具市场各状态（柱）
 *   + 热门收藏工具 Top（横向柱）。
 *
 * 检活三态语义色固定映射（设计 §6.3）：HEALTHY→--c-success、UNKNOWN→--c-text-faint、
 * UNHEALTHY→--c-danger；不在本页硬编码色值，统一走 EChart 语义色 key（双主题跟随）。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import EChart from '@/components/common/EChart.vue'
import { getSysConfigOverview } from '@/api/report'

const loading = ref(false)
const error = ref(false)
const data = ref(null)

const summary = computed(() => data.value?.summary || {})
const healthDistribution = computed(() => data.value?.distributions?.healthDistribution || [])
const marketByStatus = computed(() => data.value?.distributions?.marketByStatus || [])
const favoriteTop = computed(() => data.value?.distributions?.favoriteTop || [])

const metrics = computed(() => [
  { key: 'mcpTotal', label: 'MCP 连接器', value: summary.value.mcpTotal },
  { key: 'apiTotal', label: 'API 连接器', value: summary.value.apiTotal },
  { key: 'bizSystemTotal', label: '业务系统', value: summary.value.bizSystemTotal },
  { key: 'marketTotal', label: '发布工具总数', value: summary.value.marketTotal },
  { key: 'marketPendingReview', label: '待审核', value: summary.value.marketPendingReview },
  { key: 'favoriteTotal', label: '收藏总数', value: summary.value.favoriteTotal }
])

const isEmpty = computed(
  () =>
    !healthDistribution.value.length &&
    !marketByStatus.value.length &&
    !favoriteTop.value.length
)

// 检活三态：固定语义色映射（设计 §6.3）+ 中文标签
const HEALTH_LABEL = { HEALTHY: '健康', UNHEALTHY: '异常', UNKNOWN: '未知' }
function healthColor(label, c) {
  if (label === 'HEALTHY') return c.success
  if (label === 'UNHEALTHY') return c.danger
  return c['text-faint'] // UNKNOWN
}

const healthPieOption = (c) => ({
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
      data: healthDistribution.value.map((d) => ({
        name: HEALTH_LABEL[d.label] || d.label,
        value: d.value,
        itemStyle: { color: healthColor(d.label, c) }
      }))
    }
  ]
})

// 工具市场各状态：竖向柱（四态）
const MARKET_LABEL = {
  PENDING_REVIEW: '待审核',
  PUBLISHED: '已上架',
  REJECTED: '已驳回',
  DELISTED: '已下架'
}
const marketBarOption = (c) => ({
  grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    backgroundColor: c['bg-surface'],
    borderColor: c['border-base'],
    textStyle: { color: c.text }
  },
  xAxis: {
    type: 'category',
    data: marketByStatus.value.map((d) => MARKET_LABEL[d.label] || d.label),
    axisLabel: { color: c['text-muted'] }
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: c['text-muted'] },
    splitLine: { lineStyle: { color: c['border-base'] } }
  },
  series: [
    {
      type: 'bar',
      data: marketByStatus.value.map((d) => d.value),
      itemStyle: { color: c.accent, borderRadius: [4, 4, 0, 0] },
      barWidth: '45%'
    }
  ]
})

// 热门收藏工具 Top：横向柱。category 轴首项在底、末项在顶，按 value 升序使最大在上；
// 自排序不依赖后端一定降序。
const favoriteBarOption = (c) => {
  const items = favoriteTop.value.slice().sort((a, b) => a.value - b.value)
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
        itemStyle: { color: c.success, borderRadius: [0, 4, 4, 0] },
        barWidth: '55%'
      }
    ]
  }
}

async function load() {
  loading.value = true
  error.value = false
  try {
    data.value = await getSysConfigOverview()
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
      title="配置报表"
      subtitle="连接器 / 发布审核 / 检活健康 / 收藏的真实统计概览"
    />

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
      <div class="rp-metrics">
        <div v-for="m in metrics" :key="m.key" class="np-card rp-metric">
          <div class="rp-metric-label">{{ m.label }}</div>
          <div class="rp-metric-value">{{ m.value ?? 0 }}</div>
        </div>
      </div>

      <el-empty
        v-if="isEmpty"
        description="暂无可视化数据，先在系统配置中接入连接器与工具"
        class="rp-empty"
      />

      <div v-else class="rp-charts">
        <div class="np-card rp-chart">
          <div class="rp-chart-title">检活健康分布</div>
          <EChart
            v-if="healthDistribution.length"
            :build-option="healthPieOption"
            :chart-data="healthDistribution"
            :color-keys="[
              'success',
              'danger',
              'text-faint',
              'text',
              'text-muted',
              'bg-surface',
              'border-base'
            ]"
          />
          <el-empty v-else description="暂无检活数据" :image-size="80" />
        </div>
        <div class="np-card rp-chart">
          <div class="rp-chart-title">发布状态分布</div>
          <EChart
            v-if="marketByStatus.length"
            :build-option="marketBarOption"
            :chart-data="marketByStatus"
            :color-keys="['accent', 'text', 'text-muted', 'border-base', 'bg-surface']"
          />
          <el-empty v-else description="暂无发布数据" :image-size="80" />
        </div>
        <div class="np-card rp-chart">
          <div class="rp-chart-title">热门收藏工具 Top</div>
          <EChart
            v-if="favoriteTop.length"
            :build-option="favoriteBarOption"
            :chart-data="favoriteTop"
            :color-keys="['success', 'text', 'text-muted', 'border-base', 'bg-surface']"
          />
          <el-empty v-else description="暂无收藏数据" :image-size="80" />
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
