<script setup>
/**
 * 领用页文案多条编辑器（设计 §3 / §4.3 + 反馈 2）。
 *
 * 交互（反馈 2）：
 * - 列表态：展示已有文案条（emoji + 富文本预览），每条有「编辑」「删除」；底部「+ 新增一条」。
 * - 编辑态：点新增/编辑 → 展开单条编辑表单（emoji 选择 + 富文本）；点「保存」才入列（emit），「取消」放弃。
 *   ——去掉「边打边回吐」，只在单条「保存」时 emit（父级 debounce 自动保存仍照常触发一次）。
 * - 加粗/斜/下划线：不常驻工具条；在富文本里**选中文本后**才浮现小工具条（B/I/U），点击对选区生效；无选区不显示。
 *
 * 富文本口径沿用：粘贴强制纯文本 / 中文 IME 防护 / sanitizeInline 净化 / contenteditable 初始化灌一次（单向）。
 * 零依赖（contenteditable + execCommand）；双主题语义令牌不写死色值。
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { sanitizeInline, plainText } from '@/utils/richText'
import { CLAIM_ITEM_MAX, CLAIM_ITEM_TEXT_SOFT } from '@/utils/positionModel'

const props = defineProps({
  // [{ emoji, content }]
  modelValue: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue'])

const DEFAULT_EMOJI = '📌'
const COMMON_EMOJIS = [
  '🚀', '📌', '✨', '📊', '📈', '✅', '⚡', '🎯', '💡', '🔧',
  '📝', '📋', '🗂️', '🔍', '⏱️', '💬', '📅', '🤝', '🛡️', '🧩',
  '💼', '📦', '🔔', '⭐', '🏷️', '🧾', '📂', '🧠', '🤖', '🌟'
]

// 已提交列表（只读派生：始终来自父级 modelValue，恒为数组）。
const items = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))
const atLimit = computed(() => items.value.length >= CLAIM_ITEM_MAX)

/* ---------- grapheme 校验（单 emoji） ---------- */
const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null
function isSingleGrapheme(str) {
  const s = String(str || '')
  if (!s) return false
  return (segmenter ? [...segmenter.segment(s)].length : [...s].length) === 1
}

/* ============================================================
 * 单条编辑态（-1=未编辑；number=编辑某条；'new'=新增）
 * ============================================================ */
const editingIndex = ref(-1)
const draftEmoji = ref(DEFAULT_EMOJI)
const draftContent = ref('') // 净化后 HTML（提交时用）
const editorRef = ref(null)

const isEditing = computed(() => editingIndex.value !== -1)

function startNew() {
  if (atLimit.value || isEditing.value) return
  editingIndex.value = 'new'
  draftEmoji.value = DEFAULT_EMOJI
  draftContent.value = ''
  nextTick(initEditor)
}
function startEdit(idx) {
  if (isEditing.value) return
  editingIndex.value = idx
  draftEmoji.value = items.value[idx]?.emoji || DEFAULT_EMOJI
  draftContent.value = sanitizeInline(items.value[idx]?.content || '')
  nextTick(initEditor)
}
function cancelEdit() {
  editingIndex.value = -1
  hideToolbar()
}
// 「保存」才入列：净化 + 判空校验，提交后整列回吐父级（单次 emit）。
function saveEdit() {
  const clean = sanitizeInline(draftContent.value)
  if (plainText(clean) === '') return // 空内容不入列（按钮已 disabled，双保险）
  const item = { emoji: draftEmoji.value || DEFAULT_EMOJI, content: clean }
  const next = items.value.slice()
  if (editingIndex.value === 'new') next.push(item)
  else next[editingIndex.value] = item
  emit('update:modelValue', next)
  editingIndex.value = -1
  hideToolbar()
}
function removeItem(idx) {
  const next = items.value.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
  if (editingIndex.value === idx) cancelEdit()
}

const draftEmpty = computed(() => plainText(draftContent.value) === '')
const draftTextLen = computed(() => plainText(draftContent.value).length)
const draftOverSoft = computed(() => draftTextLen.value > CLAIM_ITEM_TEXT_SOFT)

/* ---------- contenteditable 初始化（灌一次，单向；之后只读 DOM 不回灌防光标跳首） ---------- */
function initEditor() {
  const el = editorRef.value
  if (el) {
    el.innerHTML = draftContent.value
    el.focus()
  }
}
let composing = false
// 取 DOM → 净化 → 写 draftContent（仅本地 draft，不 emit）。
function syncDraft() {
  if (composing) return
  const el = editorRef.value
  if (el) draftContent.value = sanitizeInline(el.innerHTML)
}
function onInput() {
  syncDraft()
}
function onBlur() {
  composing = false
  syncDraft()
}
function onCompositionStart() {
  composing = true
}
function onCompositionEnd() {
  composing = false
  syncDraft()
}
// 粘贴强制纯文本。
function onPaste(e) {
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
  syncDraft()
}

/* ============================================================
 * 选中浮现的 B/I/U 工具条（反馈 2）：选中富文本才显示，点击对选区生效。
 * ============================================================ */
const toolbar = ref({ show: false, top: 0, left: 0 })
const active = ref({ bold: false, italic: false, underline: false })

function inEditor(node) {
  const el = editorRef.value
  return el && node && el.contains(node.nodeType === 3 ? node.parentNode : node)
}
// 选区变化后判断：编辑器内有非空选区 → 在选区上方浮现工具条。
function updateToolbar() {
  const el = editorRef.value
  if (!el) return hideToolbar()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideToolbar()
  if (!inEditor(sel.anchorNode) || !inEditor(sel.focusNode)) return hideToolbar()
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect.width && !rect.height) return hideToolbar()
  const host = el.getBoundingClientRect()
  // 相对富文本容器定位（容器 position:relative）。
  const TOOLBAR_W = 96 // B/I/U 三按钮 + 间距 + padding 估宽（用于右边界 clamp）
  // 默认浮在选区上方；若上方越界（top<0，如选区在第一行）→ 翻转到选区下方，避免被裁/移动端遮文字。
  let top = rect.top - host.top - 36
  if (top < 0) top = rect.bottom - host.top + 6
  // 左：防左溢 + 右边界 clamp（不超容器宽 - 工具条宽）。
  const maxLeft = Math.max(0, host.width - TOOLBAR_W)
  const left = Math.min(maxLeft, Math.max(0, rect.left - host.left))
  toolbar.value = { show: true, top, left }
  refreshActive()
}
function hideToolbar() {
  toolbar.value = { ...toolbar.value, show: false }
}
function refreshActive() {
  active.value = {
    bold: safeState('bold'),
    italic: safeState('italic'),
    underline: safeState('underline')
  }
}
function safeState(cmd) {
  try {
    return document.queryCommandState(cmd)
  } catch {
    return false
  }
}
function exec(cmd, e) {
  e.preventDefault() // 防按钮抢焦点丢选区
  document.execCommand(cmd, false, null)
  syncDraft()
  refreshActive()
  nextTick(updateToolbar)
}

// 文档级 selectionchange 监听（覆盖鼠标/键盘选择）；编辑态才处理，挂载注册、卸载移除。
function onSelectionChange() {
  if (isEditing.value) updateToolbar()
}
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

/* ---------- emoji 选择器 ---------- */
const emojiPopShow = ref(false)
const emojiManual = ref('')
const manualInvalid = computed(() => {
  const v = emojiManual.value.trim()
  return !!v && !isSingleGrapheme(v)
})
function pickEmoji(emo) {
  draftEmoji.value = emo
  emojiPopShow.value = false
}
function applyManualEmoji() {
  const v = emojiManual.value.trim()
  if (!v || !isSingleGrapheme(v)) return
  draftEmoji.value = v
  emojiManual.value = ''
  emojiPopShow.value = false
}

/* ---------- 列表项预览（净化后 v-html，纵深防御） ---------- */
function previewHtml(content) {
  return sanitizeInline(content || '')
}
</script>

<template>
  <div class="claim-editor">
    <!-- 列表态：空提示 -->
    <div v-if="!items.length && !isEditing" class="ce-empty">还没有领用页文案 · 点下方添加一条</div>

    <!-- 已提交文案条（正在编辑的那条隐藏，改由下方表单承载） -->
    <div
      v-for="(it, idx) in items"
      v-show="editingIndex !== idx"
      :key="idx"
      class="ce-item"
    >
      <span class="ce-item-emoji">{{ it.emoji || '📌' }}</span>
      <span class="ce-item-text" v-html="previewHtml(it.content)"></span>
      <span class="ce-item-acts">
        <button type="button" class="ce-act" :disabled="isEditing" @click="startEdit(idx)">编辑</button>
        <button type="button" class="ce-act danger" :disabled="isEditing" @click="removeItem(idx)">删除</button>
      </span>
    </div>

    <!-- 单条编辑表单（新增 或 编辑某条） -->
    <div v-if="isEditing" class="ce-form">
      <div class="ce-form-row">
        <!-- emoji 选择 -->
        <el-popover v-model:visible="emojiPopShow" :width="248" trigger="click" placement="bottom-start">
          <template #reference>
            <button type="button" class="ce-emoji" title="选择图标">{{ draftEmoji || '📌' }}</button>
          </template>
          <div class="ce-emoji-pop">
            <div class="ce-emoji-grid">
              <button
                v-for="emo in COMMON_EMOJIS"
                :key="emo"
                type="button"
                class="ce-emoji-cell"
                :class="{ on: emo === draftEmoji }"
                @click="pickEmoji(emo)"
              >{{ emo }}</button>
            </div>
            <div class="ce-emoji-manual">
              <el-input
                v-model="emojiManual"
                size="small"
                placeholder="或手填一个 emoji"
                maxlength="8"
                @keyup.enter="applyManualEmoji"
              />
              <el-button size="small" :disabled="manualInvalid" @click="applyManualEmoji">应用</el-button>
            </div>
            <div v-if="manualInvalid" class="ce-emoji-err">请输入单个 emoji</div>
          </div>
        </el-popover>

        <!-- 富文本（选中浮现 B/I/U 工具条） -->
        <div class="ce-rich">
          <div
            ref="editorRef"
            class="ce-content"
            contenteditable="true"
            spellcheck="false"
            data-ph="员工领用时看到的一句话介绍（选中文字可加粗/斜体/下划线）"
            @input="onInput"
            @blur="onBlur"
            @paste="onPaste"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
          ></div>
          <!-- 选中浮现工具条 -->
          <div
            v-show="toolbar.show"
            class="ce-floatbar"
            :style="{ top: toolbar.top + 'px', left: toolbar.left + 'px' }"
          >
            <button type="button" class="ce-fb" :class="{ on: active.bold }" title="加粗" @mousedown="exec('bold', $event)"><b>B</b></button>
            <button type="button" class="ce-fb" :class="{ on: active.italic }" title="斜体" @mousedown="exec('italic', $event)"><i>I</i></button>
            <button type="button" class="ce-fb" :class="{ on: active.underline }" title="下划线" @mousedown="exec('underline', $event)"><u>U</u></button>
          </div>
        </div>
      </div>

      <div class="ce-form-foot">
        <span class="ce-soft" :class="{ over: draftOverSoft }">{{ draftTextLen }} / {{ CLAIM_ITEM_TEXT_SOFT }}</span>
        <span class="ce-form-btns">
          <el-button size="small" @click="cancelEdit">取消</el-button>
          <el-button size="small" type="primary" :disabled="draftEmpty" @click="saveEdit">保存</el-button>
        </span>
      </div>
    </div>

    <!-- 新增入口（编辑态隐藏，避免并发多条编辑） -->
    <button
      v-if="!isEditing"
      type="button"
      class="ce-add"
      :class="{ disabled: atLimit }"
      :disabled="atLimit"
      @click="startNew"
    >
      <template v-if="atLimit">已达 {{ CLAIM_ITEM_MAX }} 条上限</template>
      <template v-else>＋ 新增一条</template>
    </button>
  </div>
</template>

<style scoped>
.claim-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ce-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding: var(--space-2) 0;
}
/* 列表项 */
.ce-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.ce-item-emoji {
  flex-shrink: 0;
  font-size: var(--fs-md);
  line-height: 1.6;
}
.ce-item-text {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 1.6;
  word-break: break-word;
}
.ce-item-acts {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.ce-act {
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.ce-act:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--c-text);
}
.ce-act.danger:hover:not(:disabled) {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.ce-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 单条编辑表单 */
.ce-form {
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ce-form-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.ce-emoji {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  font-size: 20px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--dur-fast), background var(--dur-fast);
}
.ce-emoji:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.ce-rich {
  flex: 1;
  min-width: 0;
  position: relative;
}
.ce-content {
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 1.6;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  outline: none;
  word-break: break-word;
}
.ce-content:focus {
  border-color: var(--c-accent);
  background: var(--bg-surface);
}
.ce-content:empty::before {
  content: attr(data-ph);
  color: var(--c-text-faint);
}
/* 选中浮现工具条：绝对定位在富文本容器内、选区上方 */
.ce-floatbar {
  position: absolute;
  z-index: 10;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}
.ce-fb {
  width: 26px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ce-fb:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.ce-fb.on {
  background: var(--bg-selected);
  border-color: var(--c-accent);
  color: var(--c-accent);
}
.ce-form-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.ce-soft {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ce-soft.over {
  color: var(--c-warning);
}
.ce-form-btns {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
}
/* 新增入口 */
.ce-add {
  align-self: flex-start;
  padding: 6px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
  transition: border-color var(--dur-fast), color var(--dur-fast), background var(--dur-fast);
}
.ce-add:hover:not(.disabled) {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.ce-add.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* emoji popover */
.ce-emoji-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ce-emoji-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}
.ce-emoji-cell {
  height: 32px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ce-emoji-cell:hover {
  background: var(--bg-hover);
}
.ce-emoji-cell.on {
  border-color: var(--c-accent);
  background: var(--bg-selected);
}
.ce-emoji-manual {
  display: flex;
  gap: var(--space-2);
}
.ce-emoji-err {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
