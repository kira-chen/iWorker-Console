<script setup>
/**
 * 检索测试弹窗：在指定知识库内检索，回显切片结果，不落库。
 * 设计：docs/frontend/交互设计-知识库管理.md §4。任意状态的库都可测（对齐模型「任意状态可验证」）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { searchKnowledgeBase } from '@/api/knowledgeBase'
import { SOURCE_TYPES, SOURCE_LABELS } from '@/utils/knowledgeBaseMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  kb: { type: Object, default: null }
})
const emit = defineEmits(['update:visible'])

const query = ref('')
const topK = ref(5)
const sourceId = ref('')
const searching = ref(false)
const result = reactive({ items: [], errors: [], elapsedMs: 0, done: false })
const expanded = ref({})

// 数据源筛选按「份」：一库可挂多份数据源（每类 ≤5），选项 = 「类型 · 名称」
const enabledSources = computed(() => (props.kb?.sources || []).filter((s) => s.enabled))
const sourceOptions = computed(() =>
  SOURCE_TYPES.flatMap((t) => enabledSources.value.filter((s) => s.sourceType === t).map((s) => ({ value: s.id, label: `${SOURCE_LABELS[t]} · ${s.name || ''}` })))
)
const stats = computed(() => {
  const by = {}
  for (const it of result.items) by[it.sourceType] = (by[it.sourceType] || 0) + 1
  const parts = SOURCE_TYPES.filter((t) => by[t]).map((t) => `${SOURCE_LABELS[t]} ${by[t]}`)
  for (const e of result.errors) parts.push(`${SOURCE_LABELS[e.sourceType] || e.sourceType} 失败`)
  return parts.join(' · ')
})

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    query.value = ''
    topK.value = 5
    sourceId.value = ''
    result.items = []
    result.errors = []
    result.elapsedMs = 0
    result.done = false
    expanded.value = {}
  }
)

async function doSearch() {
  const q = query.value.trim()
  if (!q || !props.kb?.id) return
  searching.value = true
  result.done = false
  try {
    const r = await searchKnowledgeBase(props.kb.id, { query: q, topK: topK.value, sourceId: sourceId.value || undefined })
    result.items = r?.items || []
    result.errors = r?.errors || []
    result.elapsedMs = r?.elapsedMs || 0
  } catch (e) {
    result.items = []
    result.errors = [{ sourceType: '', message: e?.message || '检索失败' }]
  } finally {
    searching.value = false
    result.done = true
  }
}
function sourceLine(it) {
  const s = it.source || '未知来源'
  const line = it.page ? `${s} · 第 ${it.page} 页` : s
  return it.sourceName ? `${it.sourceName} / ${line}` : line
}
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`检索测试 · ${kb?.name || ''}`"
    width="720px"
    :close-on-click-modal="false"
    class="kb-search-dialog"
    @update:model-value="close"
  >
    <div class="ks-body">
      <div class="ks-query">
        <el-input v-model="query" placeholder="输入问题，如：售后质保期是多久？" clearable @keyup.enter="doSearch" />
        <el-select v-model="topK" class="ks-topk">
          <el-option v-for="n in [3, 5, 10, 20]" :key="n" :label="`Top-K ${n}`" :value="n" />
        </el-select>
        <el-select v-model="sourceId" class="ks-src" clearable placeholder="全部数据源">
          <el-option v-for="o in sourceOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" :loading="searching" :disabled="!query.trim()" @click="doSearch">检索</el-button>
      </div>

      <div v-if="!enabledSources.length" class="ks-empty">该知识库还没有启用任何数据源，先到「配置」里启用后再测</div>

      <el-skeleton v-else-if="searching" :rows="5" animated />

      <template v-else-if="result.done">
        <div class="ks-meta">
          <span>结果 {{ result.items.length }} 条 · 耗时 {{ result.elapsedMs }} ms<template v-if="stats"> · {{ stats }}</template></span>
          <hr />
        </div>
        <div v-if="!result.items.length && !result.errors.length" class="ks-empty">没有检索到相关切片，试试换个问法或降低阈值</div>
        <div class="ks-list">
          <div v-for="it in result.items" :key="it.rank" class="ks-card">
            <div class="ks-card-head">
              <span class="ks-rank">#{{ it.rank }}</span>
              <span class="ks-score">{{ Number(it.score).toFixed(2) }}</span>
              <el-tag size="small" type="info" effect="plain">{{ SOURCE_LABELS[it.sourceType] || it.sourceType }}</el-tag>
              <span class="ks-source">{{ sourceLine(it) }}</span>
            </div>
            <p class="ks-content" :class="{ clamp: !expanded[it.rank] }" @click="expanded[it.rank] = !expanded[it.rank]">{{ it.content }}</p>
          </div>
          <div v-for="(e, i) in result.errors" :key="'e' + i" class="ks-card err">
            <div class="ks-card-head">
              <span class="ks-rank">{{ SOURCE_LABELS[e.sourceType] || '错误' }}</span>
              <span>{{ e.message }}<template v-if="result.items.length"> · 不影响其它数据源结果</template></span>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="ks-empty">输入问题后回车或点「检索」，结果只在这里展示，不会落库</div>
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ks-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.ks-query {
  display: flex;
  gap: 10px;
}
.ks-query :deep(.el-input:first-child) {
  flex: 1;
}
.ks-topk {
  width: 120px;
  flex: none;
}
.ks-src {
  width: 180px;
  flex: none;
}
.ks-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ks-meta hr {
  flex: 1;
  border: 0;
  border-top: 1px solid var(--border-soft);
  margin: 0;
}
.ks-empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.ks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 460px;
  overflow: auto;
}
.ks-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ks-card.err {
  border-color: var(--c-danger-soft);
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.ks-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ks-rank {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ks-card.err .ks-rank {
  color: var(--c-danger);
}
.ks-score {
  font-family: var(--font-mono);
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}
.ks-source {
  color: var(--c-text);
}
.ks-content {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--c-text);
  cursor: pointer;
}
.ks-content.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
