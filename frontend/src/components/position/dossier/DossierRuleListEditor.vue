<script setup>
/**
 * 工作档案 · 业务规则（归纳规则）整表行编辑器——与 DataTableFieldEditor 同一范式，在弹窗里编辑完整列表。
 *
 * 行结构：{ key(规则名), desc(规则描述), strategy(归纳方式), params:{ n, staleAfterDays, normalize } }
 * 列：规则名 | 规则描述 | 归纳方式（SUMMARY 时行内带「最近 N 条」）| 删除。上限 MAX_RULES。
 * 行级错误由父级 rowErrors 传入：{ [idx]: { key?, desc?, strategy?, n? } }
 */
import { computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import { REDUCE_STRATEGIES, MAX_RULES, SUMMARY_N_RANGE, emptyReduceRule } from '@/utils/dossierConfig'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  keySuggestions: { type: Array, default: () => [] },
  rowErrors: { type: Object, default: () => ({}) },
  globalError: { type: String, default: '' }
})
const emit = defineEmits(['update:rows'])

const full = computed(() => props.rows.length >= MAX_RULES)

function errOf(idx, key) {
  return props.rowErrors?.[idx]?.[key] || ''
}
function update(next) {
  emit('update:rows', next)
}
function addRow() {
  if (full.value) return
  update([...props.rows, emptyReduceRule()])
}
function removeRow(idx) {
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
  <div class="dfe" :class="{ 'dfe-error': !!globalError }">
    <div class="dfe-guide">
      业务规则告诉 AI「同一个信息多次出现时怎么合并」：预算新旧值并列保留、决策人越记越多、客户态度只看最新……
      没配规则的信息一律「取最新」，只给需要特殊处理的配即可，最多 {{ MAX_RULES }} 条。
    </div>
    <div class="dfe-head">
      <span>规则名</span>
      <span>规则描述</span>
      <span>归纳方式</span>
      <span></span>
    </div>

    <div v-for="(row, idx) in rows" :key="idx" class="dfe-row">
      <div>
        <el-select
          :model-value="row.key"
          filterable
          allow-create
          default-first-option
          placeholder="如 预算 / 决策人"
          :class="{ 'is-err': errOf(idx, 'key') }"
          @update:model-value="patch(idx, 'key', $event)"
        >
          <el-option v-for="k in keySuggestions" :key="k" :value="k" :label="k" />
        </el-select>
        <div v-if="errOf(idx, 'key')" class="cell-err">{{ errOf(idx, 'key') }}</div>
      </div>
      <div>
        <el-input
          :model-value="row.desc"
          maxlength="200"
          placeholder="这条规则管什么信息、为什么这样合并（可选）"
          :class="{ 'is-err': errOf(idx, 'desc') }"
          @update:model-value="patch(idx, 'desc', $event)"
        />
        <div v-if="errOf(idx, 'desc')" class="cell-err">{{ errOf(idx, 'desc') }}</div>
      </div>
      <div class="dfe-strategy">
        <el-select :model-value="row.strategy" :class="{ 'is-err': errOf(idx, 'strategy') }" @update:model-value="patch(idx, 'strategy', $event)">
          <el-option v-for="s in REDUCE_STRATEGIES" :key="s.value" :value="s.value" :label="s.label">
            <span class="opt-label">{{ s.label }}</span>
            <span class="opt-hint">{{ s.hint }}</span>
          </el-option>
        </el-select>
        <div v-if="row.strategy === 'SUMMARY'" class="dfe-inline">
          最近
          <el-input-number
            :model-value="row.params?.n"
            :min="SUMMARY_N_RANGE.min"
            :max="SUMMARY_N_RANGE.max"
            step-strictly
            size="small"
            controls-position="right"
            @update:model-value="patchParam(idx, 'n', $event)"
          />
          条
        </div>
        <div v-if="errOf(idx, 'n')" class="cell-err">{{ errOf(idx, 'n') }}</div>
      </div>
      <el-button link type="danger" @click="removeRow(idx)"><el-icon><Delete /></el-icon></el-button>
    </div>

    <div class="dfe-foot">
      <el-button link type="primary" :disabled="full" @click="addRow">+ 添加规则</el-button>
      <span class="dfe-hint">{{ rows.length }} / {{ MAX_RULES }}<template v-if="full"> · 已到上限</template></span>
    </div>
    <div v-if="globalError" class="dfe-err-text">{{ globalError }}</div>
  </div>
</template>

<style scoped>
/* 与 DataTableFieldEditor 同一套行编辑器样式（令牌一致，仅列数不同） */
.dfe {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--bg-sunken);
}
.dfe-error {
  border-color: var(--c-danger);
}
.dfe-guide {
  margin-bottom: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-tight, 1.4);
}
.dfe-head,
.dfe-row {
  display: grid;
  grid-template-columns: 1.4fr 2fr 1.6fr 36px;
  gap: var(--space-2);
  align-items: start;
}
.dfe-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
  padding: 0 2px;
}
.dfe-row {
  margin-bottom: var(--space-3);
}
.dfe-strategy {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.dfe-inline {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.opt-label {
  margin-right: var(--space-2);
}
.opt-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cell-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: var(--lh-tight, 1.3);
}
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.dfe-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.dfe-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.dfe-err-text {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
