<script setup>
/**
 * 知识库容器页 —— 对齐「连接器」范式（AdminConnector）：页内双 Tab。
 *
 * - 知识库管理（?tab=kb）：库列表 + 配置抽屉（引用数据源）+ 检索测试
 * - 数据源管理（?tab=source）：上传 / API / MCP 三类数据源的独立管理
 *
 * 顶部唯一 PageHeader；Tab 状态用 query 承载（刷新 / 分享可定位，默认 kb）；
 * 子页 keep-alive 缓存，切 Tab 不丢列表与筛选态。
 */
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import KnowledgeBaseList from '@/views/admin/KnowledgeBaseList.vue'
import KnowledgeSourceList from '@/views/admin/KnowledgeSourceList.vue'

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'kb', label: '知识库管理', comp: KnowledgeBaseList },
  { key: 'source', label: '数据源管理', comp: KnowledgeSourceList }
]
const TAB_KEYS = TABS.map((t) => t.key)

const activeTab = computed({
  get() {
    const t = route.query.tab
    return TAB_KEYS.includes(t) ? t : 'kb'
  },
  set(val) {
    if (val === route.query.tab) return
    router.replace({ query: { ...route.query, tab: val } })
  }
})

watch(
  () => route.query.tab,
  (t) => {
    if (!TAB_KEYS.includes(t)) {
      router.replace({ query: { ...route.query, tab: 'kb' } })
    }
  },
  { immediate: true }
)

const activeComp = computed(() => TABS.find((t) => t.key === activeTab.value)?.comp)
</script>

<template>
  <div class="kb-page">
    <PageHeader
      title="知识库"
      subtitle="集中管理企业、专家与岗位的知识来源：上传文档到平台内置 RAG 库，或接入第三方 RAG 的 API / MCP 检索"
    />

    <el-tabs v-model="activeTab" class="kb-tabs">
      <el-tab-pane v-for="t in TABS" :key="t.key" :label="t.label" :name="t.key" />
    </el-tabs>

    <div class="kb-body">
      <keep-alive>
        <component :is="activeComp" />
      </keep-alive>
    </div>
  </div>
</template>

<style scoped>
/* 同 AdminConnector：PageHeader → Tab 导航 → 子页 body */
.kb-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.kb-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.kb-body {
  min-height: 0;
}
</style>
