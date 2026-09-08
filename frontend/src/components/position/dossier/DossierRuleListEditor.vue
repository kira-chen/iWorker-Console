<script setup>
/**
 * 工作档案 ·「档案详情」行内可编辑网格（2026-09-09 原型复刻批次 4A，明细 #9）。
 * 2026-09-07 之前是弹窗里的整表编辑器，本轮按原型 `ruleRows` L2301 改为卡内行内网格。
 *
 * 布局：规则名 | 规则描述 | 归纳方式（富下拉 DossierStrategySelect）| ×  +「＋ 新增条目」，头部 N / 8。
 * 字段与校验按 md §4.2.3：规则名自由输入、规则描述即提示词、归纳方式四选一、最多 8 条。
 * 行结构：{ key(规则名), desc(规则描述), strategy, params:{ n, staleAfterDays, normalize } }。
 * SUMMARY 的「最近 N 条」是代码超集（md 只写「摘要最近 N 条」不给 N 输入），保留在归纳方式下方一行。
 * 行级错误由父级 rowErrors 传入：{ [idx]: { key?, desc?, strategy?, n? } }
 */
import { computed } from 'vue'
import { MAX_RULES, SUMMARY_N_RANGE, emptyReduceRule } from '@/utils/dossierConfig'
import DossierStrategySelect from '@/components/position/dossier/DossierStrategySelect.vue'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  rowErrors: { type: Object, default: () => ({}) },
  globalError: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:rows', 'limit'])

const full = computed(() => props.rows.length >= MAX_RULES)

function errOf(idx, key) {
  return props.rowErrors?.[idx]?.[key] || ''
}
function rowErrText(idx) {
  const e = props.rowErrors?.[idx]
  if (!e) return ''
  return Object.values(e).filter(Boolean).join(' · ')
}
function update(next) {
  emit('update:rows', next)
}
function addRow() {
  if (props.readonly) return
  if (full.value) {
    emit('limit')
    return
  }
  update([...props.rows, emptyReduceRule()])
}
function removeRow(idx) {
  if (props.readonly) return
  const next = props.rows.slice()
  next.splice(idx, 1)
  update(next)
}
function patch(idx, key, value) {
  update(props.rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
}
function patchParam(idx, key, value) {
  const r = props.rows[idx]
  patch(idx, 'params', { ...(r.params || {}), [key]: value })
}
</script>

<template>
  <div class="drg" :class="{ 'drg-error': !!globalError }">
    <div class="drg-head drg-grid">
      <span>规则名</span>
      <span>规则描述</span>
      <span>归纳方式</span>
      <span></span>
    </div>

    <template v-for="(row, idx) in rows" :key="idx">
      <div class="drg-row drg-grid">
        <!-- 规则名：自由输入（2026-09-07 PRD-20260904 对齐 PT-C7；md §4.2.3 同口径） -->
        <el-input
          :model-value="row.key"
          placeholder="如 指标表现"
          :disabled="readonly"
          :class="{ 'is-err': errOf(idx, 'key') }"
          @update:model-value="patch(idx, 'key', $event)"
        />
        <el-input
          :model-value="row.desc"
          maxlength="200"
          placeholder="描述 AI 要提取什么内容"
          :disabled="readonly"
          :class="{ 'is-err': errOf(idx, 'desc') }"
          @update:model-value="patch(idx, 'desc', $event)"
        />
        <div class="drg-strategy">
          <DossierStrategySelect
            :model-value="row.strategy"
            :disabled="readonly"
            :invalid="!!errOf(idx, 'strategy')"
            @update:model-value="patch(idx, 'strategy', $event)"
          />
          <div v-if="row.strategy === 'SUMMARY'" class="drg-inline">
            最近
            <el-input-number
              :model-value="row.params?.n"
              :min="SUMMARY_N_RANGE.min"
              :max="SUMMARY_N_RANGE.max"
              step-strictly
              size="small"
              controls-position="right"
              :disabled="readonly"
              @update:model-value="patchParam(idx, 'n', $event)"
            />
            条
          </div>
        </div>
        <button v-if="!readonly" type="button" class="drg-del" title="删除" @click="removeRow(idx)">×</button>
        <span v-else></span>
      </div>
      <div v-if="rowErrText(idx)" class="drg-row-err">{{ rowErrText(idx) }}</div>
    </template>

    <button v-if="!readonly" type="button" class="drg-add" @click="addRow">＋ 新增条目</button>
    <p v-if="globalError" class="drg-err-text">{{ globalError }}</p>
  </div>
</template>

<style scoped>
/* 网格列宽照原型 L2774：minmax(120px,1.1fr) minmax(180px,1.6fr) minmax(260px,2.3fr) 28px */
.drg-grid {
  display: grid;
  grid-template-columns: minmax(120px, 1.1fr) minmax(180px, 1.6fr) minmax(260px, 2.3fr) 28px;
  gap: var(--space-2);
  align-items: center;
}
.drg-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.drg-row {
  margin-top: var(--space-2);
}
.drg-row-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.drg-strategy {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.drg-inline {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.drg-del {
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-lg, 16px);
  line-height: 1;
  cursor: pointer;
  padding: 4px;
}
.drg-del:hover {
  color: var(--c-danger);
}
.drg-add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.drg-err-text {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.is-err :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
@media (max-width: 960px) {
  .drg-grid {
    grid-template-columns: 1fr;
  }
  .drg-head {
    display: none;
  }
}
</style>
