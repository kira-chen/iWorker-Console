<script setup>
/**
 * 工作档案 · 档案详情「归纳方式」富下拉（2026-09-09 原型复刻批次 4A）。
 *
 * 照原型 L2815 `enhanceStrategies` 的 `.wp3-rich-select`：触发器一行显示「标题 + 灰色说明」，
 * 展开后四个选项各带说明（取最新 / 累积成列表 / 摘要最近 N 条 / 保留冲突并列，md §4.2.3 四选一）。
 * 选项值仍走 utils/dossierConfig 的 REDUCE_STRATEGIES（LATEST / LIST / SUMMARY / CONFLICTS），
 * 原型里的中文 value（按指标归纳 / 合并相似结论 …）是其展示层写法，不搬。
 */
import { computed } from 'vue'
import { REDUCE_STRATEGIES } from '@/utils/dossierConfig'

const props = defineProps({
  modelValue: { type: String, default: 'LATEST' },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const current = computed(() => REDUCE_STRATEGIES.find((s) => s.value === props.modelValue) || REDUCE_STRATEGIES[0])
</script>

<template>
  <el-select
    class="ds-rich"
    :class="{ 'is-err': invalid }"
    :model-value="modelValue"
    :disabled="disabled"
    popper-class="ds-rich-popper"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #label>
      <span class="ds-rich-trigger">
        <strong>{{ current.label }}</strong>
        <span>{{ current.hint }}</span>
      </span>
    </template>
    <el-option v-for="s in REDUCE_STRATEGIES" :key="s.value" :value="s.value" :label="s.label">
      <span class="ds-rich-option">
        <strong>{{ s.label }}</strong>
        <span>{{ s.hint }}</span>
      </span>
    </el-option>
  </el-select>
</template>

<style scoped>
.ds-rich {
  width: 100%;
  min-width: 0;
}
.ds-rich-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.ds-rich-trigger strong {
  flex: 0 0 auto;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.ds-rich-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.is-err :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
</style>

<style>
/* 下拉浮层在 body 上，不能用 scoped：照原型 .wp3-rich-option 的「标题左 / 说明右」两栏 */
.ds-rich-popper .el-select-dropdown__item {
  height: auto;
  padding: var(--space-2) var(--space-3);
  line-height: 1.5;
}
.ds-rich-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
}
.ds-rich-option strong {
  flex: 0 0 auto;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.ds-rich-option > span {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  text-align: right;
}
</style>
