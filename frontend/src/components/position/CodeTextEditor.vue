<script setup>
/**
 * 纯文本 / 代码文件编辑器（技能包改造 §4.1/§4.5，切片3）。
 *
 * 职责：.json / .txt / yaml(frontmatter) 文件的等宽 textarea 编辑器（零新依赖，不引 CodeMirror/Monaco）。
 * - v-model 双向绑定文本内容；
 * - .json（fileType='json'）失焦 JSON.parse 软提示（F5a）：底部红字软提示，不阻断保存/切文件；
 * - yaml（fileType='yaml'，仅 frontmatter 折叠区使用）本组件内不校验——折叠区已有实时红条
 *   （SkillFocusEditor 的 analyzeFrontmatter 链路），此处再失焦报一遍会同屏重复；
 * - .txt 纯文本无校验。
 *
 * 主题：仅用站点 Notion 语义令牌，由 <html data-theme> 级联自动切浅/暗。
 * 校验态通过 contentError 回吐父级（emit 'json-error'，沿用既有事件名），供目录树节点叠加红色 △ 警示。
 */
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // 文件类型：'json' → JSON 校验；'yaml'（frontmatter）/'txt'/其它 → 无校验（见头注）。
  fileType: { type: String, default: 'txt' },
  placeholder: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'json-error'])

const isJson = computed(() => String(props.fileType || '').toLowerCase() === 'json')
const validatable = computed(() => isJson.value)

// 失焦校验结果（红字软提示文案）；空串=无错。
const jsonError = ref('')

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

// 失焦：按类型校验（不阻断）。空内容视为合法（允许编辑中途空文件）。
function onBlur() {
  if (isJson.value) validateJson(props.modelValue)
}

function validateJson(content) {
  const text = String(content ?? '')
  if (!text.trim()) {
    setError('')
    return
  }
  try {
    JSON.parse(text)
    setError('')
  } catch (e) {
    setError(`JSON 语法错误：${e?.message || '解析失败'}`)
  }
}

function setError(msg) {
  jsonError.value = msg
  emit('json-error', msg)
}

// 切文件 / 切类型时（modelValue 外部整体替换）：无校验类型清掉上一文件残留的红字。
watch(
  () => [props.fileType, props.modelValue],
  () => {
    if (!validatable.value && jsonError.value) setError('')
  }
)

/* 组③：跨文件查找命中跳转——精确滚动并选中第 lineNo 行（1-based）。 */
const areaRef = ref(null)
function scrollToLine(lineNo) {
  const ta = areaRef.value
  if (!ta || !lineNo || lineNo < 1) return
  const text = String(props.modelValue ?? '')
  const lines = text.split('\n')
  if (lineNo > lines.length) return
  // 行起止字符偏移。
  let start = 0
  for (let i = 0; i < lineNo - 1; i++) start += lines[i].length + 1
  const end = start + (lines[lineNo - 1]?.length ?? 0)
  ta.focus()
  try {
    ta.setSelectionRange(start, end)
  } catch {
    /* 某些环境 setSelectionRange 不可用：忽略，仅滚动 */
  }
  // 估算滚动位置：行高 × (行号-1)，居中显示。
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22
  ta.scrollTop = Math.max(0, (lineNo - 1) * lineHeight - ta.clientHeight / 2)
}

defineExpose({ validateJson, scrollToLine })
</script>

<template>
  <div class="code-editor" :class="{ 'has-error': validatable && jsonError }">
    <textarea
      ref="areaRef"
      class="code-area"
      :class="{ mono: true }"
      :value="modelValue"
      :placeholder="placeholder"
      :readonly="readonly"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      @input="onInput"
      @blur="onBlur"
    ></textarea>
    <!-- F5a：.json 语法错红字软提示（不阻断保存/切文件；frontmatter 校验由折叠区红条负责） -->
    <div v-if="validatable && jsonError" class="json-soft-error" role="status">
      <span class="je-icon">⚠</span><span class="je-text">{{ jsonError }}</span>
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.code-area {
  flex: 1;
  min-height: 0;
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-text);
  /* 2026-08-18：边距统一收窄——左右 space-5 → space-3（对齐 Milkdown 正文区），上下 space-4 → space-2（基本信息区 5 行高度=120px 依赖上下 16px，改此值须同步 .ed-fm-editor 高度） */
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: 1.6;
  tab-size: 2;
  caret-color: var(--c-accent);
}
.code-area::placeholder {
  color: var(--c-text-faint);
}
.code-area:focus {
  outline: none;
}
/* F5a 软提示条：底部红字，不弹窗、不字段红框 */
.json-soft-error {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: var(--space-2) var(--space-4);
  background: var(--c-danger-soft);
  color: var(--c-danger);
  font-size: var(--fs-xs);
  line-height: 1.5;
  border-top: 1px solid var(--border-soft);
}
.je-icon {
  flex-shrink: 0;
}
.je-text {
  word-break: break-word;
}
</style>
