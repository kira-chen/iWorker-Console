<script setup>
/**
 * 检索测试弹窗（md §三.7 / 交互原型 openSearch）：对已发布知识库做检索验证，不修改、不发布知识库。
 *
 * 【字段】检索问题（默认示例值）/ Top K（5 默认·3·10·20）/ 数据源范围（默认全部已启用，停用的不可选）。
 * 【结果】总数 + 耗时 + 各数据源召回统计；结果卡片=排名 / 相关度 / 数据源类型 / 来源名称 /
 *   页码定位 / 命中内容（长内容默认收起可展开）；单个数据源失败展示该来源错误、不影响其余结果。
 * 【空态】未测试时「输入问题后点击"开始测试"」；无可用数据源时提示先配置并启用数据源。
 *
 * 【2026-09-09 原型复刻批次 3B · G1–G5】静态形态照原型 openSearch / run-search：
 *   G1 宽度 720 → 680（原型 .proto2-dialog{width:min(680px,calc(100vw - 36px))}）；标题「检索测试 · [知识库名]」已一致；
 *   G2 表单改 2 列网格（.proto2-form-grid：检索问题跨列，第 2 行 Top K | 数据源范围），标签顶置；
 *   G3 统计条改灰底圆角条 + 三段独立 span（.kb2-search-stats，gap 18），去掉延伸 hr；
 *   G4 卡头首段改「#N 来源文档名」加粗（原型 <strong>），分数绿色加粗，来源行只留「数据源名 · 第 N 页」；
 *      数据源类型 tag 与长内容折叠按 md §三.7 保留；
 *   G5 加载骨架为代码超集（编码规范「关键交互需 loading」），不动。
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
// Top K 选项按数值升序 3/5/10/20，默认 5（2026-09-09 负责人确认）。
// md §三.7 原写「5（默认）、3、10、20」——「5」列首是在标默认值而非排序，逐字照抄会让
// 下拉里「3」排在「5」后面，反直觉。md 已同步改写。
const TOPK_OPTIONS = [3, 5, 10, 20]
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
/**
 * 卡片头第二行来源（原型 .kb2-result-source「产品资料文档库 · 第 18 页」）：
 * 来源文档名已随排名进 <strong>，这里只留「数据源名 · 第 N 页」。
 */
function sourceLine(it) {
  const parts = []
  if (it.sourceName) parts.push(it.sourceName)
  if (it.page) parts.push(`第 ${it.page} 页`)
  return parts.join(' · ')
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
    width="680px"
    :close-on-click-modal="false"
    class="kb-search-dialog"
    @update:model-value="close"
  >
    <!-- 标题「检索测试 · [知识库名]」单文本（md §三.7，2026-09-08 PRD-20260908 对齐；原型 decorate() L2058 合并标题） -->
    <template #header>
      <div class="ks-head">
        <span class="ks-title">检索测试 · {{ kb?.name || '' }}</span>
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
          <!-- 统计条照原型 .kb2-search-stats：灰底圆角条、三段独立 span（gap 18） -->
          <div class="ks-stats">
            <span>召回 {{ result.items.length }} 条</span>
            <span>耗时 {{ result.elapsedMs }} ms</span>
            <span v-if="stats">{{ stats }}</span>
          </div>
          <div v-if="!result.items.length && !result.errors.length" class="ks-empty">没有检索到相关内容，试试换个问法</div>
          <div class="ks-list">
            <article v-for="it in result.items" :key="it.rank" class="ks-card">
              <!-- 卡片头照原型 .kb2-result-head：「#N 来源文档名」加粗 + 绿色加粗分数 + 灰 12px 来源行；
                   数据源类型 tag 按 md §三.7（展示数据源类型）保留 -->
              <div class="ks-card-head">
                <strong class="ks-rank">#{{ it.rank }} {{ it.source || '未知来源' }}</strong>
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
/* 表单网格照原型 .proto2-form-grid{grid-template-columns:1fr 1fr;gap:17px 20px}：检索问题 .full 跨列，
 * 第 2 行 [Top K | 数据源范围]；标签顶置（.proto2-label{margin-bottom:7px}） */
.ks-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 17px 20px;
}
.ks-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.ks-field--full {
  grid-column: 1 / -1;
}
@media (max-width: 1000px) {
  .ks-form {
    grid-template-columns: 1fr;
  }
  .ks-field--full {
    grid-column: auto;
  }
}
.ks-label {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
/* 结果统计条（原型 .kb2-search-stats{display:flex;gap:18px;padding:11px 13px;border-radius:7px;background:#f3f7f5}） */
.ks-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 11px 13px;
  border-radius: 7px;
  background: var(--bg-sunken);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
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
/* 结果卡（原型 .kb2-result{padding:13px 14px;border:1px solid #dfe5e1;border-radius:8px}） */
.ks-card {
  border: 1px solid var(--border-base);
  border-radius: 8px;
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ks-card.err {
  border-color: var(--c-danger-soft);
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
/* 卡头（原型 .kb2-result-head{display:flex;align-items:center;gap:9px;margin-bottom:8px}） */
.ks-card-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 「#N 来源文档名」加粗常规字号（原型 <strong>） */
.ks-rank {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ks-card.err .ks-rank {
  color: var(--c-danger);
}
/* 分数：绿色加粗（原型 .kb2-score{color:#078b61;font-weight:650}） */
.ks-score {
  font-weight: 650;
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}
/* 来源行：灰 12px（原型 .kb2-result-source{color:#7d8882;font-size:12px}） */
.ks-source {
  font-size: 12px;
  color: var(--c-text-muted);
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
