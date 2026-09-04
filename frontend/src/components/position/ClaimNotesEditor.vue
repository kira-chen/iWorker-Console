<script setup>
/**
 * 岗位认领说明编辑器（2026-09-04 PRD-20260903 对齐，md 三.2.3；
 * 2026-09-04 返工：排版结构照交互原型「领用页文案」卡最终覆写态，区块标题维持 Q7 现名）。
 *
 * 动态列表，一行一条说明（纯文本，≤6 条 × 100 字）：
 * - 编辑态：每条 = 序号圆点 + 行内无边框输入框（就地改，实时回吐）+ 右侧【删除】；
 * - 只读态：序号圆点 + 文本，无操作入口；
 * - 空态：「还没有岗位认领说明，点击"新增一条"添加」；
 * - 新增：入口按钮在宿主卡片头（照原型「＋ 新增一条」在卡头右侧），经 defineExpose 的
 *   startAdd 触发；展开草稿行（输入框 +【保存】【取消】），非空校验后入列并 toast；
 * - 底部 hint「每条最多 100 个字符」照原型置于卡片体底部（本组件内）。
 *
 * 数据流：v-model 纯字符串数组；新增/删除时整组回吐，行内改动实时回吐（父级手动保存范式，
 * 脏检查由页面级快照承担）。暴露 editing / atLimit 供宿主控制卡头按钮显隐。
 */
import { ref, computed, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { CLAIM_NOTE_MAX, CLAIM_NOTE_LEN } from '@/utils/positionModel'

const props = defineProps({
  // 纯文本认领说明数组
  modelValue: { type: Array, default: () => [] },
  // 只读态：行内输入变文本，隐藏新增 / 删除入口
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const items = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.map(String) : []))
const atLimit = computed(() => items.value.length >= CLAIM_NOTE_MAX)

const editing = ref(false)
const draft = ref('')
const draftInvalid = ref(false)
const inputRef = ref(null)

function startAdd() {
  if (props.readonly || atLimit.value) return
  editing.value = true
  draft.value = ''
  draftInvalid.value = false
  nextTick(() => inputRef.value?.focus?.())
}
function cancelAdd() {
  editing.value = false
  draft.value = ''
  draftInvalid.value = false
}
function saveAdd() {
  const v = String(draft.value || '').trim()
  if (!v) {
    draftInvalid.value = true
    ElMessage.warning('请输入岗位认领说明')
    return
  }
  if (atLimit.value) {
    ElMessage.warning(`岗位认领说明最多 ${CLAIM_NOTE_MAX} 条`)
    return
  }
  emit('update:modelValue', [...items.value, v])
  editing.value = false
  draft.value = ''
  ElMessage.success('岗位认领说明已保存')
}
// 行内就地编辑：实时回吐该条新值（保存仍由页面顶部【保存】统一提交）
function onItemInput(idx, val) {
  const next = items.value.slice()
  next[idx] = val
  emit('update:modelValue', next)
}
function removeAt(idx) {
  const next = items.value.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
}

// 宿主（岗位详情「岗位认领说明」卡）用：卡片头「＋ 新增一条」直调 + 按钮显隐
defineExpose({ startAdd, editing, atLimit })
</script>

<template>
  <div class="cn">
    <div class="cn-list">
      <div v-for="(text, idx) in items" :key="idx" class="cn-item">
        <span class="cn-index">{{ idx + 1 }}</span>
        <span v-if="readonly" class="cn-text">{{ text }}</span>
        <template v-else>
          <el-input
            class="cn-inline"
            :model-value="text"
            :maxlength="CLAIM_NOTE_LEN"
            :aria-label="`岗位认领说明 ${idx + 1}`"
            @update:model-value="onItemInput(idx, $event)"
          />
          <el-button link type="danger" class="cn-del" @click="removeAt(idx)">删除</el-button>
        </template>
      </div>
      <div v-if="!items.length && !editing" class="cn-empty">还没有岗位认领说明，点击"新增一条"添加</div>
      <div v-if="editing && !readonly" class="cn-form">
        <el-input
          ref="inputRef"
          v-model="draft"
          :maxlength="CLAIM_NOTE_LEN"
          placeholder="请输入一条岗位认领说明"
          :class="{ 'cn-invalid': draftInvalid }"
          @input="draftInvalid = false"
          @keyup.enter="saveAdd"
        />
        <el-button @click="cancelAdd">取消</el-button>
        <el-button type="primary" @click="saveAdd">保存</el-button>
      </div>
    </div>
    <div class="cn-hint">每条最多 {{ CLAIM_NOTE_LEN }} 个字符</div>
  </div>
</template>

<style scoped>
.cn {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cn-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* 行卡（照原型 pnew-claim-item / pclaim-restored）：白底描边圆角，聚焦时整行亮绿描边 */
.cn-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.cn-item:focus-within {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.cn-index {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.cn-text {
  flex: 1;
  min-width: 0;
  color: var(--c-text);
  line-height: 1.5;
  word-break: break-word;
}
/* 行内输入框照原型 pclaim-inline-input：无边框透明底，边框语义由整行承担 */
.cn-inline {
  flex: 1;
  min-width: 0;
}
.cn-inline :deep(.el-input__wrapper) {
  box-shadow: none;
  background: transparent;
  padding-left: var(--space-1);
}
.cn-inline :deep(.el-input__wrapper:hover),
.cn-inline :deep(.el-input__wrapper.is-focus) {
  box-shadow: none;
  background: transparent;
}
.cn-del {
  flex: none;
}
.cn-empty {
  padding: var(--space-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--c-text-faint);
  text-align: center;
  font-size: var(--fs-sm);
}
/* 新增草稿行（照原型 pnew-claim-form：淡绿描边 + 极浅绿底） */
.cn-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--c-accent-soft, var(--border-base));
  border-radius: var(--radius-md);
  background: var(--c-accent-fill, var(--bg-sunken));
}
.cn-form .el-input {
  flex: 1;
}
:deep(.cn-invalid .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
/* 底部 hint 照原型置于卡片体末（宿主卡片体 gap 提供与列表的间距） */
.cn-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
