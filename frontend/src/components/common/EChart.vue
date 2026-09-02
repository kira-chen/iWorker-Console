<script setup>
/**
 * EChart —— ECharts 通用封装（设计 §6.3）。
 *
 * 设计要点：
 * 1) 按需引入（echarts/core + 必要 chart/component），控打包体积，不引整包。
 * 2) 惰性渲染：仅在 onMounted（浏览器有 DOM）时 init；SSR/单测不触发真渲染。
 *    单测侧把 echarts.init stub 掉即可断言 option 组装，不在 jsdom 真画 canvas。
 * 3) 双主题：不收硬编码色值——调用方传 `buildOption(colors)`，组件运行时用
 *    getComputedStyle 解析 `colorKeys` 里声明的语义色 key（如 'success'）为
 *    `--c-success` 的真实色值，注入 buildOption；watch theme 变化时重解析 + setOption，
 *    暗色跟随。
 * 4) 容器 resize：ResizeObserver（无则降级 window resize）驱动 chart.resize()。
 *
 * 用法：
 *   <EChart
 *     :build-option="(c) => ({ series: [{ type:'pie', itemStyle:{ color: c.success } }] })"
 *     :color-keys="['success','danger','text-faint']"
 *   />
 *   buildOption 接收 colors 对象：{ success, danger, 'text-faint', ... }（key 即 colorKeys 去掉 --c- 前缀）。
 */
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DatasetComponent
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import { useThemeStore } from '@/stores/theme'

echarts.use([
  PieChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DatasetComponent,
  LabelLayout,
  CanvasRenderer
])

const props = defineProps({
  // 接 colors 返回完整 echarts option（不硬编码色值，色值由 colorKeys 运行时解析后注入）
  buildOption: { type: Function, required: true },
  // 需要的语义色 key 列表（去掉 --c- 前缀），如 ['success','danger','text-faint','accent','text-muted']
  colorKeys: { type: Array, default: () => [] },
  // 图表数据：传入后 deep watch，数据异步到达 / 后续更新均可靠触发重渲染（不依赖 v-if 时序）
  chartData: { type: null, default: null },
  // 容器高度
  height: { type: String, default: '280px' }
})

const elRef = ref(null)
const themeStore = useThemeStore()
let chart = null

// 运行时从 <html> 计算样式取语义色真实值：先试 --c-{key}，取空则回退 --{key}。
// tokens.css 中色令牌存在两类命名：语义色多为 --c-*（如 --c-success），
// 而表面/边框类为无前缀的 --bg-surface / --border-base。两类都要能解析到。
// 双主题切换后 CSS 变量值变化，重解析即可拿到新主题色（暗色跟随）。
function resolveColors() {
  const styles = getComputedStyle(document.documentElement)
  const colors = {}
  for (const key of props.colorKeys) {
    let v = styles.getPropertyValue(`--c-${key}`).trim()
    if (!v) v = styles.getPropertyValue(`--${key}`).trim()
    colors[key] = v
  }
  return colors
}

function renderOption() {
  if (!chart) return
  const option = props.buildOption(resolveColors())
  // notMerge:true —— 主题切换重算后整体替换，避免残留旧色板
  chart.setOption(option, true)
}

function init() {
  if (!elRef.value) return
  chart = echarts.init(elRef.value)
  renderOption()
}

// resize：优先 ResizeObserver（容器尺寸变化即 resize），降级 window resize
let ro = null
function onWinResize() {
  chart?.resize()
}
function setupResize() {
  if (typeof ResizeObserver !== 'undefined' && elRef.value) {
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(elRef.value)
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWinResize)
  }
}

onMounted(() => {
  init()
  setupResize()
})

onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  if (typeof window !== 'undefined') window.removeEventListener('resize', onWinResize)
  chart?.dispose()
  chart = null
})

// 主题切换：重解析语义色 + setOption（否则暗色配色不跟随，设计 §6.3）
watch(
  () => themeStore.theme,
  () => {
    // 等 <html> data-theme 切换后 CSS 变量已生效再重算
    nextTick(renderOption)
  }
)

// 数据变化时可靠重渲染：buildOption 引用变化，或 chartData（deep）变化均触发。
// 数据异步到达 / 后续更新都会重渲染，不依赖父组件 v-if 挂载时序。
watch(
  () => props.buildOption,
  () => renderOption()
)
watch(
  () => props.chartData,
  () => renderOption(),
  { deep: true }
)

// 暴露给父组件 / 测试：手动重渲染
defineExpose({ renderOption })
</script>

<template>
  <div ref="elRef" class="echart" :style="{ height }" />
</template>

<style scoped>
.echart {
  width: 100%;
}
</style>
