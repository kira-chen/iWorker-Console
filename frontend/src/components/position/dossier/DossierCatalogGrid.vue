<script setup>
/**
 * 工作档案 ·「编目信息」行内可编辑网格（2026-09-09 原型复刻批次 4A，明细 #8）。
 *
 * 布局照原型 `cardRows` L2298 + L4010 删「必填」列后的网格：
 *   字段名 | 字段类型 | 字段用途 | 唯一 ID | 说明 | ×    +「＋ 新增条目」，头部 N / 8。
 * 字段定义与校验按 md §4.2.2：
 *   - 字段类型下拉「日期 / 长文本 / 短文本 / 整数 / 小数 / 是否」——md 未列「标签（枚举）」，故本网格只放 md 的 6 项；
 *     已落库的 ENUM 行仍原样保留可读（不会被下拉吞掉）。
 *   - 唯一 ID 为单选语义：勾选新的一条自动取消原有勾选；md 明确「不联动改变必填属性」，故不再联动 required。
 *   - 至多 8 条（MAX_SLOTS）。
 * 行结构沿用 utils/dataTableTypes 的字段行（label / fieldType / slotRole / isPrimary / fieldDesc …）。
 */
import { computed } from 'vue'
import { DATA_FIELD_TYPES, SLOT_ROLES, MAX_SLOTS, fieldTypeLabel } from '@/utils/dataTableTypes'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  rowErrors: { type: Object, default: () => ({}) },
  globalError: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:rows', 'limit'])

/* md §4.2.2 字段类型六项（顺序照 md）；ENUM 不在 md 内，不作为可选项。 */
const MD_TYPE_ORDER = ['DATE', 'LONGTEXT', 'TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN']
const typeOptions = computed(() => MD_TYPE_ORDER.map((v) => DATA_FIELD_TYPES.find((t) => t.value === v)).filter(Boolean))
const roleOptions = SLOT_ROLES

const full = computed(() => props.rows.length >= MAX_SLOTS)

function errOf(idx, key) {
  return props.rowErrors?.[idx]?.[key] || ''
}
function rowErrText(idx) {
  const e = props.rowErrors?.[idx]
  if (!e) return ''
  return Object.values(e).filter(Boolean).join(' · ')
}
function update(next) {
  emit('update:rows', next)
}
function addRow() {
  if (props.readonly) return
  if (full.value) {
    emit('limit')
    return
  }
  update([
    ...props.rows,
    { fieldCode: '', label: '', fieldType: 'TEXT', required: false, defaultValue: null, options: [], fieldDesc: '', slotRole: '', isPrimary: false, isSystem: false }
  ])
}
function removeRow(idx) {
  if (props.readonly) return
  const next = props.rows.slice()
  next.splice(idx, 1)
  update(next)
}
function patch(idx, key, value) {
  update(props.rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
}
/* 唯一 ID：单选语义（md §4.2.2「至多勾选 1 条，勾选新的一条时自动取消原有勾选」）。
   md 同时写明「该标记仅用于向用户端传值，不联动改变该字段的必填属性」→ 不动 required。 */
function toggleUnique(idx) {
  if (props.readonly) return
  const on = !props.rows[idx]?.isPrimary
  update(props.rows.map((r, i) => ({ ...r, isPrimary: on && i === idx })))
}
/* 类型不在 md 六项内（历史 ENUM 行）时，下拉里临时补一项，避免显示为空。 */
function optionsFor(row) {
  const list = typeOptions.value
  if (row?.fieldType && !list.some((t) => t.value === row.fieldType)) {
    return [...list, { value: row.fieldType, label: fieldTypeLabel(row.fieldType) }]
  }
  return list
}
</script>

<template>
  <div class="dcg" :class="{ 'dcg-error': !!globalError }">
    <div class="dcg-head dcg-grid">
      <span>字段名</span>
      <span>字段类型</span>
      <span>字段用途</span>
      <span>唯一 ID</span>
      <span>说明</span>
      <span></span>
    </div>

    <template v-for="(row, idx) in rows" :key="idx">
      <div class="dcg-row dcg-grid">
        <el-input
          :model-value="row.label"
          maxlength="64"
          placeholder="如 分析周期"
          :disabled="readonly"
          :class="{ 'is-err': errOf(idx, 'label') }"
          @update:model-value="patch(idx, 'label', $event)"
        />
        <el-select
          :model-value="row.fieldType"
          :disabled="readonly"
          :class="{ 'is-err': errOf(idx, 'fieldType') }"
          @update:model-value="patch(idx, 'fieldType', $event)"
        >
          <el-option v-for="t in optionsFor(row)" :key="t.value" :value="t.value" :label="t.label" />
        </el-select>
        <el-select
          :model-value="row.slotRole || ''"
          :disabled="readonly"
          :class="{ 'is-err': errOf(idx, 'slotRole') }"
          @update:model-value="patch(idx, 'slotRole', $event)"
        >
          <el-option v-for="r in roleOptions" :key="r.value || 'plain'" :value="r.value" :label="r.label" />
        </el-select>
        <button
          type="button"
          class="dcg-unique"
          :class="row.isPrimary ? 'yes' : 'no'"
          :disabled="readonly"
          title="唯一 ID"
          @click="toggleUnique(idx)"
        >
          {{ row.isPrimary ? '✓' : '✕' }}
        </button>
        <el-input
          :model-value="row.fieldDesc"
          maxlength="200"
          placeholder="填写字段业务释义"
          :disabled="readonly"
          @update:model-value="patch(idx, 'fieldDesc', $event)"
        />
        <button v-if="!readonly" type="button" class="dcg-del" title="删除" @click="removeRow(idx)">×</button>
        <span v-else></span>
      </div>
      <div v-if="rowErrText(idx)" class="dcg-row-err">{{ rowErrText(idx) }}</div>
    </template>

    <button v-if="!readonly" type="button" class="dcg-add" @click="addRow">＋ 新增条目</button>
    <p v-if="globalError" class="dcg-err-text">{{ globalError }}</p>
  </div>
</template>

<style scoped>
/* 网格列宽照原型 L3989（删「必填」后）：1.2fr .8fr .8fr 52px 1.5fr 28px */
.dcg-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 0.8fr 52px 1.5fr 28px;
  gap: var(--space-2);
  align-items: center;
}
.dcg-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.dcg-row {
  margin-top: var(--space-2);
}
.dcg-row-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.dcg-unique {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-xs, 4px);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold, 700);
  cursor: pointer;
  user-select: none;
}
.dcg-unique.yes {
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.dcg-unique.no {
  color: var(--c-text-muted);
  background: var(--bg-sunken);
}
.dcg-unique:disabled {
  cursor: not-allowed;
}
.dcg-del {
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-lg, 16px);
  line-height: 1;
  cursor: pointer;
  padding: 4px;
}
.dcg-del:hover {
  color: var(--c-danger);
}
.dcg-add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.dcg-err-text {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
@media (max-width: 960px) {
  .dcg-grid {
    grid-template-columns: 1fr;
  }
  .dcg-head {
    display: none;
  }
}
</style>
