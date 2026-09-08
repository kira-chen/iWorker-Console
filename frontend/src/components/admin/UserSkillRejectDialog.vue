<script setup>
/**
 * 用户技能审核 · 驳回弹窗（2026-09-08 PRD-20260908 对齐，md §6.2 / 原型 rejectWithReason L4514–4523）。
 *
 * 标题「驳回审核」/ 说明文「请填写驳回原因，驳回后提交人将收到通知并需修改后重新提交。」/
 * 驳回原因必填 ≤500 字（计数）、占位「请输入驳回原因（必填）」；为空时阻止提交：输入框标红 + 聚焦 +
 * toast「请填写驳回原因」；确认键「确认驳回」。
 * 与审核中心 ReviewRejectDialog 形态不同（那边有 label、占位与空值提示为内联文案），故本模块独立一份。
 * 确认经 confirm 事件上抛，请求成败由调用方处理（成功后调用方自行关闭）。
 */
import { ref, watch, computed, nextTick } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 提交中：确认按钮转圈防重复提交。 */
  submitting: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const reason = ref('')
const invalid = ref(false)
const inputRef = ref(null)

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      reason.value = ''
      invalid.value = false
      // 原型 L4522：打开即聚焦输入框
      nextTick(() => inputRef.value?.focus?.())
    }
  }
)

function onConfirm() {
  const trimmed = reason.value.trim()
  if (!trimmed) {
    invalid.value = true
    inputRef.value?.focus?.()
    ElMessage.warning('请填写驳回原因')
    return
  }
  invalid.value = false
  emit('confirm', trimmed)
}
</script>

<template>
  <el-dialog v-model="visible" title="驳回审核" width="440px" append-to-body :close-on-click-modal="false">
    <p class="usrd-hint">请填写驳回原因，驳回后提交人将收到通知并需修改后重新提交。</p>
    <el-input
      ref="inputRef"
      v-model="reason"
      type="textarea"
      :rows="4"
      maxlength="500"
      show-word-limit
      placeholder="请输入驳回原因（必填）"
      :class="{ 'is-invalid': invalid }"
      @input="invalid = false"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">确认驳回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.usrd-hint {
  margin: 0 0 12px;
  font-size: var(--fs-base);
  line-height: 1.6;
  color: var(--c-text-muted);
}
/* 空值标红（原型 L4518：inp.style.borderColor = var(--danger)） */
.is-invalid :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
</style>
