<script setup>
/**
 * 检索测试弹窗（md §三.7 / 交互原型 openSearch）：对已发布知识库做检索验证，不修改、不发布知识库。
 *
 * 【字段】检索问题（默认示例值）/ Top K（5 默认·3·10·20）/ 数据源范围（默认全部已启用，停用的不可选）。
 * 【结果】总数 + 耗时 + 各数据源召回统计；结果卡片=排名 / 相关度 / 数据源类型 / 来源名称 /
 *   页码定位 / 命中内容（长内容默认收起可展开）；单个数据源失败展示该来源错误、不影响其余结果。
 * 【空态】未测试时「输入问题后点击"开始测试"」；无可用数据源时提示先配置并启用数据源。
 */
import { ref, reactive, computed, watch } from 'vue'
import { searchKnowledgeBase } from '@/api/knowledgeBase'
import { SOURCE_TYPES, SOURCE_LABELS } from '@/utils/knowledgeBaseMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  kb: { type: Object, default: null }
})
const emit = defineEmits(['update:visible'])

/** 检索问题默认示例值（md §三.7，逐字） */
const DEFAULT_QUERY = '公司的标准解决方案包括哪些内容？'
/** Top K 选项：5（默认）、3、10、20（md §三.7 顺序） */
const TOPK_OPTIONS = [5, 3, 10, 20]
/** 长内容默认收起阈值 */
const CLAMP_LEN = 120

const query = ref(DEFAULT_QUERY)
const topK = ref(5)
const sourceId = ref('') // ''=全部已启用数据源
const searching = ref(false)
const result = reactive({ items: [], errors: [], elapsedMs: 0, done: false })
const expanded = ref({})

const enabledSources = computed(() => (props.kb?.sources || []).filter((s) => s.status !== 'DISABLED'))
const disabledSources = computed(() => (props.kb?.sources || []).filter((s) => s.status === 'DISABLED'))
const sourceOptions = computed(() =>
  SOURCE_TYPES.flatMap((t) => enabledSources.value.filter((s) => s.sourceType === t).map((s) => ({ value: s.id, label: `${SOURCE_LABELS[t]} · ${s.name || ''}`, disabled: false })))
)
/** 已停用数据源列出但不可选（md §三.7） */
const disabledOptions = computed(() =>
  disabledSources.value.map((s) => ({ value: s.id, label: `${SOURCE_LABELS[s.sourceType]} · ${s.name || ''}（已停用）`, disabled: true }))
)
/** 各数据源召回统计（按类型汇总） */
const stats = computed(() => {
  const by = {}
  for (const it of result.items) by[it.sourceType] = (by[it.sourceType] || 0) + 1
  return SOURCE_TYPES.filter((t) => by[t]).map((t) => `${SOURCE_LABELS[t]} ${by[t]} 条`).join(' · ')
})

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    query.value = DEFAULT_QUERY
    topK.value = 5
    sourceId.value = ''
    result.items = []
    result.errors = []
    result.elapsedMs = 0
    result.done = false
    expanded.value = {}
  }
)

async function runTest() {
  const q = query.value.trim()
  if (!q || !props.kb?.id || searching.value) return
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
function isLong(it) {
  return (it.content || '').length > CLAMP_LEN
}
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    width="720px"
    :close-on-click-modal="false"
    class="kb-search-dialog"
    @update:model-value="close"
  >
    <!-- 标题「检索测试」，旁以标签展示当前知识库名称（md §三.7） -->
    <template #header>
      <div class="ks-head">
        <span class="ks-title">检索测试</span>
        <el-tag size="small" type="info" effect="plain">{{ kb?.name || '' }}</el-tag>
      </div>
    </template>

    <div class="ks-body">
      <div v-if="!enabledSources.length" class="ks-empty">该知识库没有可用数据源，请先配置并启用数据源</div>

      <template v-else>
        <div class="ks-form">
          <div class="ks-field ks-field--full">
            <label class="ks-label">检索问题</label>
            <el-input v-model="query" clearable placeholder="输入要测试的检索问题" @keyup.enter="runTest" />
          </div>
          <div class="ks-field">
            <label class="ks-label">Top K</label>
            <el-select v-model="topK">
              <el-option v-for="n in TOPK_OPTIONS" :key="n" :label="String(n)" :value="n" />
            </el-select>
          </div>
          <div class="ks-field">
            <label class="ks-label">数据源范围</label>
            <el-select v-model="sourceId">
              <el-option label="全部已启用数据源" value="" />
              <el-option v-for="o in sourceOptions" :key="o.value" :label="o.label" :value="o.value" />
              <el-option v-for="o in disabledOptions" :key="o.value" :label="o.label" :value="o.value" disabled />
            </el-select>
          </div>
        </div>

        <el-skeleton v-if="searching" :rows="5" animated />

        <template v-else-if="result.done">
          <div class="ks-meta">
            <span>召回 {{ result.items.length }} 条 · 耗时 {{ result.elapsedMs }} ms<template v-if="stats"> · {{ stats }}</template></span>
            <hr />
          </div>
          <div v-if="!result.items.length && !result.errors.length" class="ks-empty">没有检索到相关内容，试试换个问法</div>
          <div class="ks-list">
            <article v-for="it in result.items" :key="it.rank" class="ks-card">
              <div class="ks-card-head">
                <span class="ks-rank">#{{ it.rank }}</span>
                <span class="ks-score">{{ Number(it.score).toFixed(2) }}</span>
                <el-tag size="small" type="info" effect="plain">{{ SOURCE_LABELS[it.sourceType] || it.sourceType }}</el-tag>
                <span class="ks-source">{{ sourceLine(it) }}</span>
              </div>
              <p class="ks-content" :class="{ clamp: isLong(it) && !expanded[it.rank] }">{{ it.content }}</p>
              <button v-if="isLong(it)" type="button" class="ks-toggle" @click="expanded[it.rank] = !expanded[it.rank]">
                {{ expanded[it.rank] ? '收起' : '展开查看' }}
              </button>
            </article>
            <!-- 某一数据源失败：展示该来源错误，仍展示其他数据源的正常结果（md §三.7） -->
            <div v-for="(e, i) in result.errors" :key="'e' + i" class="ks-card err">
              <div class="ks-card-head">
                <span class="ks-rank">{{ SOURCE_LABELS[e.sourceType] || '错误' }}</span>
                <span>{{ e.message }}<template v-if="result.items.length"> · 不影响其它数据源结果</template></span>
              </div>
            </div>
          </div>
        </template>

        <!-- 未测试空状态（md §三.7，逐字） -->
        <div v-else class="ks-empty">输入问题后点击“开始测试”</div>
      </template>
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
      <el-button v-if="enabledSources.length" type="primary" :loading="searching" :disabled="!query.trim()" @click="runTest">开始测试</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ks-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ks-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ks-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.ks-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.ks-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 160px;
}
.ks-field--full {
  flex-basis: 100%;
}
.ks-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
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
  max-height: 420px;
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
}
.ks-content.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ks-toggle {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
</style>
