<script setup>
/**
 * 连接器容器页 —— 把外部工具/数据源类页面（MCP / API / 业务系统）收口为页内 Tab。
 *
 * 注：数据表已从连接器迁出，改在岗位白板内「数据底座」入口弹窗就地管理
 * （components/position/PositionDataTableStage.vue，三栏聚焦弹窗）——数据表强绑定岗位，配置入口随岗位走更顺。
 *
 * - 顶部唯一一个 PageHeader「连接器」标题（各子页各自的页头标题已收口移除，
 *   仅保留各自的操作区/红点，渲染在各子页顶部工具行）。
 * - Tab 状态用 query 参数承载（?tab=mcp|api|bizsystem），刷新/分享可定位，默认 mcp。
 * - 各子页组件按 keep-alive 缓存，切 Tab 不丢列表与筛选态。
 */
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AdminMcp from '@/views/admin/AdminMcp.vue'
import AdminApis from '@/views/admin/AdminApis.vue'
import AdminBizSystems from '@/views/admin/AdminBizSystems.vue'

const route = useRoute()
const router = useRouter()

// Tab 元数据：key 与 query.tab 一一对应；component 为对应子页。
const TABS = [
  { key: 'mcp', label: 'MCP', comp: AdminMcp },
  { key: 'api', label: 'API', comp: AdminApis },
  { key: 'bizsystem', label: '业务系统', comp: AdminBizSystems }
]
const TAB_KEYS = TABS.map((t) => t.key)

// 当前激活 tab：取 query.tab，非法值回落 mcp。
const activeTab = computed({
  get() {
    const t = route.query.tab
    return TAB_KEYS.includes(t) ? t : 'mcp'
  },
  set(val) {
    if (val === route.query.tab) return
    // 保留其余 query（如数据表的 positionId），仅替换 tab；不入历史栈避免点 Tab 堆栈膨胀。
    router.replace({ query: { ...route.query, tab: val } })
  }
})

// 进入时若 query.tab 缺失/非法，补全为默认值（保证深链与刷新一致）。
watch(
  () => route.query.tab,
  (t) => {
    if (!TAB_KEYS.includes(t)) {
      router.replace({ query: { ...route.query, tab: 'mcp' } })
    }
  },
  { immediate: true }
)

const activeComp = computed(() => TABS.find((t) => t.key === activeTab.value)?.comp)
</script>

<template>
  <div class="connector-page">
    <PageHeader
      title="连接器"
      subtitle="为平台配置可用的连接器，同时服务于个人用户和 FDE 工程师"
    />

    <el-tabs v-model="activeTab" class="connector-tabs">
      <el-tab-pane
        v-for="t in TABS"
        :key="t.key"
        :label="t.label"
        :name="t.key"
      />
    </el-tabs>

    <!-- keep-alive：切 Tab 缓存各子页，保留各自列表/筛选/作用域态 -->
    <div class="connector-body">
      <keep-alive>
        <component :is="activeComp" />
      </keep-alive>
    </div>
  </div>
</template>

<style scoped>
/* 与岗位/技能 .page 同款布局节奏：纵向 flex + 段间 space-5；
 * 结构为 PageHeader → Tab 导航 → 子页 body，仅比岗位/技能多出一行 Tab。 */
.connector-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
/* Tab 自身下边线作为与内容的分隔；不再用负 margin hack 修正间距。 */
.connector-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.connector-body {
  min-height: 0;
}
</style>
