<script setup>
/**
 * 岗位认领说明编辑器（2026-09-04 PRD-20260903 对齐，md 三.2.3）。
 *
 * 动态输入列表，一行一条说明（纯文本）：
 * - 列表态：序号圆形标记 + 文本，每条右侧【删除】（danger-link）；
 * - 空态：「还没有岗位认领说明，点击"新增"添加一条」；
 * - 【新增】（link 样式）：展开输入框（≤100 字）+【保存】【取消】；
 *   保存校验非空后入列，toast「岗位认领说明已保存」；
 * - 限制：最多 6 条（达上限隐藏【新增】），至少 1 条为发布必填项（发布门在页面层校验）。
 *
 * 数据流：v-model 纯字符串数组；只在「保存/删除」时 emit（父级手动保存范式）。
 * 注：与旧「领用页文案」编辑器（ClaimDescEditor，{emoji,content} 富文本）不同源，
 * 旧组件按 PRD-20260903 已从岗位详情页退役、文件保留备查。
 */
import { ref, computed, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { CLAIM_NOTE_MAX, CLAIM_NOTE_LEN } from '@/utils/positionModel'

const props = defineProps({
  // 纯文本认领说明数组
  modelValue: { type: Array, default: () => [] },
  // 只读态：隐藏新增 / 删除入口
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
function removeAt(idx) {
  const next = items.value.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="cn">
    <div class="cn-list">
      <div v-for="(text, idx) in items" :key="idx" class="cn-item">
        <span class="cn-index">{{ idx + 1 }}</span>
        <span class="cn-text">{{ text }}</span>
        <el-button v-if="!readonly" link type="danger" class="cn-del" @click="removeAt(idx)">删除</el-button>
      </div>
      <div v-if="!items.length && !editing" class="cn-empty">还没有岗位认领说明，点击"新增"添加一条</div>
    </div>

    <div v-if="editing" class="cn-form">
      <el-input
        ref="inputRef"
        v-model="draft"
        :maxlength="CLAIM_NOTE_LEN"
        show-word-limit
        placeholder="请输入一条岗位认领说明"
        :class="{ 'cn-invalid': draftInvalid }"
        @input="draftInvalid = false"
        @keyup.enter="saveAdd"
      />
      <el-button @click="cancelAdd">取消</el-button>
      <el-button type="primary" @click="saveAdd">保存</el-button>
    </div>
    <div v-else-if="!readonly" class="cn-foot">
      <el-button v-if="!atLimit" link type="primary" @click="startAdd">新增</el-button>
      <span class="cn-hint">最多 {{ CLAIM_NOTE_MAX }} 条，至少 1 条为发布必填项；每条最多 {{ CLAIM_NOTE_LEN }} 个字符</span>
    </div>
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
.cn-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 42px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-app);
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
  color: var(--c-text-base);
  line-height: 1.5;
  word-break: break-word;
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
.cn-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--c-accent-soft, var(--border-base));
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}
.cn-form .el-input {
  flex: 1;
}
:deep(.cn-invalid .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.cn-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.cn-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
