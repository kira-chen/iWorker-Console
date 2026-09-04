<script setup>
/**
 * 审核中心 · 驳回弹窗（2026-09-01 PRD 对齐改造，对齐交互原型 v2 rejectReview 弹窗）。
 *
 * 标题默认「驳回审核」（可经 title 覆盖，2026-09-04 岗位申请审批复用为「驳回岗位申请」）/
 * 确认按钮「确认驳回」；必填「驳回原因」textarea（maxlength 500，
 * placeholder「请输入明确的驳回原因」），空值就地提示「请输入驳回原因」、聚焦输入框、不关弹窗
 * （聚焦为 2026-09-04 按 PRD-20260903 §4.3.2 补齐，各处驳回弹窗同享）。
 * 审核中心列表页与技能整页只读（吸底操作栏）共用；确认经 confirm 事件上抛，
 * 请求成败由调用方处理（成功后调用方自行关闭）。
 */
import { ref, watch, computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 提交中：确认按钮转圈防重复提交。 */
  submitting: { type: Boolean, default: false },
  /** 弹窗标题（默认审核中心口径；岗位申请审批传「驳回岗位申请」）。 */
  title: { type: String, default: '驳回审核' }
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const reason = ref('')
const error = ref('')
const inputRef = ref(null)

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      reason.value = ''
      error.value = ''
    }
  }
)

function onConfirm() {
  const trimmed = reason.value.trim()
  if (!trimmed) {
    error.value = '请输入驳回原因'
    // 空值报错并聚焦输入框（PRD-20260903 §4.3.2），弹窗保持打开
    inputRef.value?.focus?.()
    return
  }
  error.value = ''
  emit('confirm', trimmed)
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="480px" append-to-body>
    <div class="rrd-label"><b class="rrd-required">*</b> 驳回原因</div>
    <el-input
      ref="inputRef"
      v-model="reason"
      type="textarea"
      :rows="4"
      maxlength="500"
      placeholder="请输入明确的驳回原因"
      @input="error = ''"
    />
    <div v-if="error" class="rrd-error">{{ error }}</div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">确认驳回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rrd-label {
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.rrd-required {
  color: var(--c-danger);
  margin-right: 2px;
}
.rrd-error {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
