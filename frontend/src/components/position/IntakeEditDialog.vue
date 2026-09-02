<script setup>
/**
 * 采集编辑弹窗（设计 §4.1 / §4.2）—— 替代原身份卡「采集」折叠块。
 *
 * 内嵌现有 IntakeFieldEditor（迁移自身份卡）。数据流：弹窗内编辑 → patch('intakeSchema') →
 * emit('update:basic')（v-model:basic 不变）；保存沿用父级 debounce 自动保存。
 *
 * el-dialog :close-on-click-modal="false"（防误点遮罩丢编辑态）。
 */
import { computed } from 'vue'
import IntakeFieldEditor from './IntakeFieldEditor.vue'
import { LIMITS } from '@/utils/positionModel'

const props = defineProps({
  visible: { type: Boolean, default: false },
  basic: { type: Object, required: true },
  hasClaims: { type: Boolean, default: false },
  intakeErrors: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:visible', 'update:basic'])

const intakeRows = computed({
  get: () => props.basic.intakeSchema || [],
  set: (v) => emit('update:basic', { ...props.basic, intakeSchema: v })
})
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑采集信息"
    width="720px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="ie-body">
      <div class="sub-label">
        基本采集信息（领用时必填字段 · ≤{{ LIMITS.INTAKE_MAX }} 字段）
        <span class="hint">英文 key 自动生成并折叠</span>
      </div>
      <IntakeFieldEditor v-model:rows="intakeRows" :has-claims="hasClaims" :row-errors="intakeErrors" />
    </div>

    <template #footer>
      <el-button type="primary" @click="emit('update:visible', false)">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ie-body {
  max-height: 64vh;
  overflow: auto;
}
.sub-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin: 0 0 8px;
}
.sub-label .hint {
  margin-left: auto;
  color: var(--c-text-faint);
}
</style>
