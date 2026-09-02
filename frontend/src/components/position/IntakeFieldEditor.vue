<script setup>
/**
 * 采集字段配置器（交互规格 §2.5）—— 6 类型动态行编辑，在 DataTableFieldEditor 范式上扩展。
 *
 * 单一职责：以字段行维护采集 schema，双向绑定 v-model:rows。
 * 行结构：{ key, label, type, required, options[], placeholder, defaultValue, desc }
 *
 * 关键交互：
 * - 6 类型（单/多行文本·单选·多选·数字·日期），类型驱动「选项/占位」列动态切换；
 * - 英文 key 由中文显示名自动生成（genKeyFromLabel）且默认折叠（show-key 切换展开后可手改）；
 * - 单/多选 → 选项编辑器（chip 增删，必填，空选项阻断）；
 * - ≤10 字段硬上限，达上限「+ 添加」禁用；
 * - 删除分级：未发布直删；已发布且有领用 → 轻确认（值将失效）。
 *
 * 字段级错误由父级 rowErrors 传入：{ [idx]: { label?, key?, options? } }
 */
import { computed, ref } from 'vue'
import { Delete, ArrowRight, Plus, Close } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { INTAKE_TYPES, isSelectType, genKeyFromLabel, LIMITS } from '@/utils/positionModel'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  // 已发布且有用户领用：删字段走轻确认（值将失效）
  hasClaims: { type: Boolean, default: false },
  rowErrors: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:rows'])

const showKey = ref(false)
const expanded = ref({})

const atLimit = computed(() => props.rows.length >= LIMITS.INTAKE_MAX)

function errOf(idx, key) {
  return props.rowErrors?.[idx]?.[key] || ''
}
function rowKey(row, idx) {
  return row.__uid || `row-${idx}`
}
function toggleExpand(idx) {
  expanded.value = { ...expanded.value, [idx]: !expanded.value[idx] }
}

function update(next) {
  emit('update:rows', next)
}
function addRow() {
  if (atLimit.value) return
  update([
    ...props.rows,
    {
      __uid: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      key: '',
      label: '',
      type: 'text',
      required: false,
      options: [],
      placeholder: '',
      defaultValue: null,
      desc: ''
    }
  ])
}
async function removeRow(idx) {
  // 删除分级（§2.5）：已发布且有领用 → 轻确认；否则直删
  if (props.hasClaims) {
    try {
      const f = props.rows[idx]
      await ElMessageBox.confirm(
        `已领用该岗位的用户，其「${f.label || '该字段'}」已填值将失效。确认删除？`,
        '删除采集字段',
        { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
      )
    } catch {
      return
    }
  }
  const next = props.rows.slice()
  next.splice(idx, 1)
  update(next)
}
function patch(idx, key, value) {
  const next = props.rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r))
  update(next)
}
// 改显示名：若 key 未被手改（自动模式），同步刷新自动 key 建议值
function patchLabel(idx, label) {
  const row = props.rows[idx]
  const autoPrev = genKeyFromLabel(row.label)
  const keyIsAuto = !row.key || row.key === autoPrev
  const next = props.rows.map((r, i) => {
    if (i !== idx) return r
    const patched = { ...r, label }
    if (keyIsAuto) patched.key = ''
    return patched
  })
  update(next)
}
// 切类型：清掉与新类型不相容的默认值/选项
function patchType(idx, type) {
  const next = props.rows.map((r, i) =>
    i === idx ? { ...r, type, defaultValue: null, options: isSelectType(type) ? r.options || [] : [] } : r
  )
  update(next)
}
function effectiveKey(row) {
  return (row.key || '').trim() || genKeyFromLabel(row.label)
}

/* 选项编辑器 */
function addOption(idx) {
  const row = props.rows[idx]
  patch(idx, 'options', [...(row.options || []), ''])
}
function patchOption(idx, oi, val) {
  const row = props.rows[idx]
  const opts = (row.options || []).map((o, i) => (i === oi ? val : o))
  patch(idx, 'options', opts)
}
function removeOption(idx, oi) {
  const row = props.rows[idx]
  patch(idx, 'options', (row.options || []).filter((_, i) => i !== oi))
}
</script>

<template>
  <div class="ife">
    <div class="ife-head" :class="{ 'show-key': showKey }">
      <span>显示名 *</span>
      <span v-if="showKey" class="key-col">字段 key</span>
      <span>类型 *</span>
      <span class="c-center">必填</span>
      <span>选项 / 占位</span>
      <span></span>
    </div>

    <template v-for="(row, idx) in rows" :key="rowKey(row, idx)">
      <div class="ife-row" :class="{ 'show-key': showKey }">
        <!-- 显示名 -->
        <div class="cell">
          <el-input
            :model-value="row.label"
            placeholder="如 负责区域"
            size="small"
            :class="{ 'is-err': errOf(idx, 'label') }"
            @update:model-value="patchLabel(idx, $event)"
          />
          <div v-if="errOf(idx, 'label')" class="cell-err">{{ errOf(idx, 'label') }}</div>
        </div>

        <!-- 字段 key（折叠默认隐藏） -->
        <div v-if="showKey" class="cell key-col">
          <el-input
            :model-value="row.key"
            :placeholder="genKeyFromLabel(row.label) || 'auto'"
            size="small"
            class="key-input"
            :class="{ 'is-err': errOf(idx, 'key') }"
            @update:model-value="patch(idx, 'key', $event)"
          />
          <div v-if="errOf(idx, 'key')" class="cell-err">{{ errOf(idx, 'key') }}</div>
        </div>

        <!-- 类型 -->
        <div class="cell">
          <el-select
            :model-value="row.type"
            size="small"
            @update:model-value="patchType(idx, $event)"
          >
            <el-option v-for="t in INTAKE_TYPES" :key="t.value" :value="t.value" :label="t.label" />
          </el-select>
        </div>

        <!-- 必填 -->
        <div class="cell c-center">
          <el-switch :model-value="row.required" size="small" @update:model-value="patch(idx, 'required', $event)" />
        </div>

        <!-- 选项 / 占位（类型驱动） -->
        <div class="cell">
          <template v-if="isSelectType(row.type)">
            <div class="opt-editor" :class="{ 'is-err': errOf(idx, 'options') }">
              <span v-for="(opt, oi) in row.options" :key="oi" class="opt-chip">
                <input
                  class="opt-input"
                  :value="opt"
                  placeholder="选项"
                  @input="patchOption(idx, oi, $event.target.value)"
                />
                <el-icon class="opt-x" @click="removeOption(idx, oi)"><Close /></el-icon>
              </span>
              <span class="opt-add" @click="addOption(idx)"><el-icon><Plus /></el-icon>选项</span>
            </div>
            <div v-if="errOf(idx, 'options')" class="cell-err">{{ errOf(idx, 'options') }}</div>
          </template>
          <el-input
            v-else
            :model-value="row.placeholder"
            placeholder="占位提示（可选）"
            size="small"
            @update:model-value="patch(idx, 'placeholder', $event)"
          />
        </div>

        <!-- 操作 -->
        <div class="cell c-center op-cell">
          <el-button link @click="toggleExpand(idx)">
            <el-icon class="more-arrow" :class="{ 'is-open': expanded[idx] }"><ArrowRight /></el-icon>
          </el-button>
          <el-button link type="danger" @click="removeRow(idx)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 更多设置：默认值 / 字段说明 -->
      <div v-if="expanded[idx]" class="ife-more">
        <div class="more-item">
          <label>默认值</label>
          <el-select
            v-if="isSelectType(row.type)"
            :model-value="row.defaultValue"
            placeholder="不设默认值"
            clearable
            size="small"
            class="more-ctrl"
            @update:model-value="patch(idx, 'defaultValue', $event ?? null)"
          >
            <el-option v-for="(opt, oi) in row.options" :key="oi" :label="opt" :value="opt" />
          </el-select>
          <el-input-number
            v-else-if="row.type === 'number'"
            :model-value="row.defaultValue == null || row.defaultValue === '' ? undefined : Number(row.defaultValue)"
            controls-position="right"
            size="small"
            class="more-ctrl"
            @update:model-value="patch(idx, 'defaultValue', $event == null ? null : String($event))"
          />
          <el-date-picker
            v-else-if="row.type === 'date'"
            :model-value="row.defaultValue || ''"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="可选"
            size="small"
            class="more-ctrl"
            @update:model-value="patch(idx, 'defaultValue', $event || null)"
          />
          <el-input
            v-else
            :model-value="row.defaultValue || ''"
            placeholder="可选"
            size="small"
            class="more-ctrl"
            @update:model-value="patch(idx, 'defaultValue', $event || null)"
          />
        </div>
        <div class="more-item">
          <label>字段说明</label>
          <el-input
            :model-value="row.desc"
            placeholder="如：用于线索分配（影响 AI 理解）"
            size="small"
            class="more-ctrl"
            @update:model-value="patch(idx, 'desc', $event)"
          />
        </div>
        <div v-if="showKey" class="more-keyhint">
          当前字段 key：<code>{{ effectiveKey(row) }}</code>
        </div>
      </div>
    </template>

    <div class="ife-foot">
      <el-button link type="primary" :disabled="atLimit" @click="addRow">
        <el-icon><Plus /></el-icon> 添加采集字段
      </el-button>
      <span v-if="atLimit" class="ife-hint warn">最多 {{ LIMITS.INTAKE_MAX }} 个采集字段</span>
      <span class="ife-keytoggle" @click="showKey = !showKey">
        ⚙ {{ showKey ? '隐藏' : '显示' }}英文 key
      </span>
    </div>
  </div>
</template>

<style scoped>
.ife {
  font-size: var(--fs-sm);
}
.ife-head,
.ife-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 0.5fr 1.6fr 64px;
  gap: var(--space-2);
  align-items: start;
}
.ife-head.show-key,
.ife-row.show-key {
  grid-template-columns: 1.3fr 1fr 1fr 0.5fr 1.5fr 64px;
}
.ife-head {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: var(--space-2);
  align-items: center;
}
.ife-row {
  padding: var(--space-1) 0;
  align-items: center;
}
.cell {
  min-width: 0;
}
.c-center {
  display: flex;
  align-items: center;
  justify-content: center;
}
.op-cell {
  gap: 2px;
}
.key-input :deep(input) {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.more-arrow {
  transition: transform 0.15s ease;
}
.more-arrow.is-open {
  transform: rotate(90deg);
}
.opt-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 3px;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--border-base) inset;
  background: var(--bg-surface);
}
.opt-editor.is-err {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-active);
  border-radius: var(--radius-pill);
  padding: 0 4px 0 8px;
}
.opt-input {
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-text);
  font-size: var(--fs-xs);
  width: 52px;
}
.opt-x {
  cursor: pointer;
  color: var(--c-text-faint);
  font-size: 12px;
}
.opt-x:hover {
  color: var(--c-danger);
}
.opt-add {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--c-accent);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 2px 6px;
}
.opt-add:hover {
  text-decoration: underline;
}
.ife-more {
  margin: var(--space-1) 0 var(--space-3);
  padding: var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.more-item {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: var(--space-2);
  align-items: center;
}
.more-item label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.more-ctrl {
  width: 100%;
}
.more-keyhint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.more-keyhint code {
  font-family: var(--font-mono);
  color: var(--c-accent);
}
.cell-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: 1.3;
}
.is-err :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.ife-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.ife-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ife-hint.warn {
  color: var(--c-warning);
}
.ife-keytoggle {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  cursor: pointer;
}
.ife-keytoggle:hover {
  color: var(--c-accent);
}
</style>
