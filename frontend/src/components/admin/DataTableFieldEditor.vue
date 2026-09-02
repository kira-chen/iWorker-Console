<script setup>
/**
 * 对象类型「结构化卡位」行编辑器（原数据表字段行编辑器；2026-08-27 按工作档案设计升级）。
 *
 * 单一职责：以卡位行维护一个对象类型的卡位集合，双向绑定 v-model:rows。
 * 行结构：{ id?, fieldCode, label, fieldType, required, defaultValue, options, fieldDesc, slotRole, isSystem }
 *
 * 行内列：卡位名(label) | 类型(fieldType) | 用途(slotRole) | 唯一 ID(isPrimary) | 必填 | 说明(fieldDesc) | 删除。
 * - 唯一 ID = 主键：整表至多一个（勾选一行自动取消其它行），勾上即强制必填；类型限短文本 / 整数（V109）；
 * - 类型 = ENUM 时，行下方展开「取值范围」标签输入（options）——标签卡位（如阶段标签）的取值集合；
 * - 用途标记按类型过滤可选项（关键日期只能标在日期上、统计数值只能标在数字上……）；
 * - 卡位上限 MAX_SLOTS：达到后「+ 添加卡位」置灰并提示「其余维度用提取项即可」；
 * - defaultValue / fieldCode 不在页面展示但保留在行模型中（原值原样回传，不清空）；
 * - uid 系统字段（isSystem=true）只读置顶、禁删禁改；
 * - mode=edit 时已落库行的 fieldType 控件置灰（后端也拒 FIELD_TYPE_IMMUTABLE）。
 *
 * 行级错误由父级 rowErrors 传入：{ [idx]: { fieldCode?, label?, fieldType?, options?, slotRole?, defaultValue? } }
 */
import { computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import { DATA_FIELD_TYPES, MAX_SLOTS, PRIMARY_TYPES, slotRolesForType } from '@/utils/dataTableTypes'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  // 'create' | 'edit'：edit 下「已落库」行的 fieldType 只读（新增行仍可改）
  mode: { type: String, default: 'create' },
  rowErrors: { type: Object, default: () => ({}) },
  globalError: { type: String, default: '' }
})
const emit = defineEmits(['update:rows'])

// 系统字段（uid）置顶展示；业务卡位在后。
const orderedRows = computed(() => {
  const sys = props.rows.filter((r) => r.isSystem)
  const biz = props.rows.filter((r) => !r.isSystem)
  return [...sys, ...biz]
})
const bizCount = computed(() => props.rows.filter((r) => !r.isSystem).length)
const slotsFull = computed(() => bizCount.value >= MAX_SLOTS)

function originIndex(row) {
  return props.rows.indexOf(row)
}
function rowKey(row) {
  return row.id != null ? `id-${row.id}` : `new-${originIndex(row)}`
}
function typeLocked(row) {
  return !!row.isSystem || (props.mode === 'edit' && row.id != null)
}
function errOf(idx, key) {
  return props.rowErrors?.[idx]?.[key] || ''
}
function rolesOf(row) {
  return slotRolesForType(row.fieldType)
}
function primaryAllowed(row) {
  return PRIMARY_TYPES.includes(row.fieldType)
}
// 唯一 ID 单选：勾选某行 → 其它行清掉；勾上强制必填
function setPrimary(row, on) {
  const idx = originIndex(row)
  if (idx < 0) return
  update(props.rows.map((r, i) => {
    if (i === idx) return { ...r, isPrimary: on, required: on ? true : r.required }
    return on && r.isPrimary ? { ...r, isPrimary: false } : r
  }))
}

function update(next) {
  emit('update:rows', next)
}
function addRow() {
  if (slotsFull.value) return
  update([
    ...props.rows,
    {
      fieldCode: '',
      label: '',
      fieldType: 'TEXT',
      required: false,
      defaultValue: null,
      options: [],
      fieldDesc: '',
      slotRole: '',
      isPrimary: false,
      isSystem: false
    }
  ])
}
function removeRow(row) {
  if (row.isSystem) return
  const idx = originIndex(row)
  if (idx < 0) return
  const next = props.rows.slice()
  next.splice(idx, 1)
  update(next)
}
function patch(row, key, value) {
  const idx = originIndex(row)
  if (idx < 0) return
  const next = props.rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r))
  update(next)
}
// 切类型：清掉不相容的默认值；用途若与新类型不相容则回「普通」；非 ENUM 清空取值范围
function patchType(row, type) {
  const idx = originIndex(row)
  if (idx < 0) return
  const roleOk = slotRolesForType(type).some((r) => r.value === (row.slotRole || ''))
  const next = props.rows.map((r, i) =>
    i === idx
      ? {
          ...r,
          fieldType: type,
          defaultValue: null,
          slotRole: roleOk ? r.slotRole : '',
          options: type === 'ENUM' ? r.options || [] : [],
          isPrimary: PRIMARY_TYPES.includes(type) ? r.isPrimary : false
        }
      : r
  )
  update(next)
}
</script>

<template>
  <div class="dfe" :class="{ 'dfe-error': !!globalError }">
    <div class="dfe-guide">
      结构化卡位只留系统要拿来算账的字段（对象名、负责人、关键日期、金额、标签……），最多 {{ MAX_SLOTS }} 个；
      其余维度不用预先定义，AI 抽到什么键名就记什么。「说明」直接影响 AI 抽取准确度，建议认真填。
    </div>
    <div class="dfe-head">
      <span class="col-name">卡位名称</span>
      <span class="col-type">类型</span>
      <span class="col-role">用途</span>
      <span class="col-pk">唯一 ID</span>
      <span class="col-req">必填</span>
      <span class="col-desc">说明</span>
      <span class="col-op"></span>
    </div>

    <template v-for="row in orderedRows" :key="rowKey(row)">
      <div class="dfe-row" :class="{ 'is-system': row.isSystem }">
        <template v-if="row.isSystem">
          <div class="col-name sys-name">
            数据归属人（系统自动）
            <el-tooltip content="系统用它区分每条数据属于谁，你不用管" placement="top">
              <span class="sys-q">?</span>
            </el-tooltip>
          </div>
          <div class="col-type sys-text">系统维护</div>
          <span class="col-role sys-dash">—</span>
          <span class="col-pk sys-dash">—</span>
          <span class="col-req sys-dash">—</span>
          <span class="col-desc sys-dash">—</span>
          <span class="col-op"></span>
        </template>

        <template v-else>
          <div class="col-name">
            <el-input
              :model-value="row.label"
              placeholder="如 客户名 / 负责人 / 预算金额"
              :class="{ 'is-err': errOf(originIndex(row), 'label') }"
              @update:model-value="patch(row, 'label', $event)"
            />
            <div v-if="errOf(originIndex(row), 'label')" class="cell-err">{{ errOf(originIndex(row), 'label') }}</div>
          </div>

          <div class="col-type">
            <el-select
              :model-value="row.fieldType"
              :disabled="typeLocked(row)"
              @update:model-value="patchType(row, $event)"
            >
              <el-option v-for="t in DATA_FIELD_TYPES" :key="t.value" :value="t.value" :label="t.label">
                <span class="opt-label">{{ t.label }}</span>
                <span class="opt-hint">{{ t.hint }}</span>
              </el-option>
            </el-select>
          </div>

          <div class="col-role">
            <el-select
              :model-value="row.slotRole || ''"
              :class="{ 'is-err': errOf(originIndex(row), 'slotRole') }"
              @update:model-value="patch(row, 'slotRole', $event)"
            >
              <el-option v-for="r in rolesOf(row)" :key="r.value" :value="r.value" :label="r.label">
                <span class="opt-label">{{ r.label }}</span>
                <span class="opt-hint">{{ r.hint }}</span>
              </el-option>
            </el-select>
            <div v-if="errOf(originIndex(row), 'slotRole')" class="cell-err">{{ errOf(originIndex(row), 'slotRole') }}</div>
          </div>

          <div class="col-pk">
            <el-tooltip :content="primaryAllowed(row) ? '相当于主键：同一份档案里只能有一个，勾上即必填' : '唯一 ID 只能是短文本或整数'" placement="top">
              <el-checkbox
                :model-value="!!row.isPrimary"
                :disabled="!primaryAllowed(row)"
                @update:model-value="setPrimary(row, $event)"
              />
            </el-tooltip>
            <div v-if="errOf(originIndex(row), 'isPrimary')" class="cell-err">{{ errOf(originIndex(row), 'isPrimary') }}</div>
          </div>

          <el-checkbox
            class="col-req"
            :model-value="row.required"
            :disabled="!!row.isPrimary"
            @update:model-value="patch(row, 'required', $event)"
          />

          <div class="col-desc">
            <el-input
              :model-value="row.fieldDesc"
              placeholder="这个卡位记录什么？写清楚 AI 抽取更准"
              @update:model-value="patch(row, 'fieldDesc', $event)"
            />
          </div>

          <el-button class="col-op" link type="danger" @click="removeRow(row)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </template>
      </div>

      <!-- ENUM：取值范围（标签输入） -->
      <div v-if="!row.isSystem && row.fieldType === 'ENUM'" class="dfe-sub">
        <span class="sub-label">取值范围</span>
        <el-select
          class="sub-tags"
          :model-value="row.options || []"
          multiple
          filterable
          allow-create
          default-first-option
          :reserve-keyword="false"
          placeholder="回车添加一个取值，如 需求 / 方案 / 商务（无顺序，只是标签）"
          :class="{ 'is-err': errOf(originIndex(row), 'options') }"
          @update:model-value="patch(row, 'options', $event)"
        >
          <el-option v-for="o in row.options || []" :key="o" :value="o" :label="o" />
        </el-select>
        <div v-if="errOf(originIndex(row), 'options')" class="cell-err">{{ errOf(originIndex(row), 'options') }}</div>
      </div>
    </template>

    <div class="dfe-foot">
      <el-button link type="primary" :disabled="slotsFull" @click="addRow">+ 添加卡位</el-button>
      <span class="dfe-hint">
        <template v-if="slotsFull">已到 {{ MAX_SLOTS }} 个上限 · 其余维度用提取项即可，无需预先定义</template>
        <template v-else>{{ bizCount }} / {{ MAX_SLOTS }} · 只需填「名称 + 类型」，英文编码由系统自动生成</template>
      </span>
    </div>
    <div v-if="globalError" class="dfe-err-text">{{ globalError }}</div>
  </div>
</template>

<style scoped>
.dfe {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--bg-sunken);
}
.dfe-error {
  border-color: var(--c-danger);
}
.dfe-guide {
  margin-bottom: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-tight, 1.4);
}
.dfe-head,
.dfe-row {
  display: grid;
  grid-template-columns: 2fr 1.4fr 1.3fr 56px 44px minmax(160px, 3fr) 36px;
  gap: var(--space-2);
  align-items: start;
}
.dfe-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
  padding: 0 2px;
  align-items: center;
}
.dfe-row {
  margin-bottom: var(--space-3);
  align-items: center;
}
.dfe-row.is-system {
  padding: var(--space-2);
  margin: 0 calc(-1 * var(--space-2)) var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
}
.dfe-sub {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: calc(-1 * var(--space-2)) 0 var(--space-3) 0;
  padding-left: var(--space-3);
  flex-wrap: wrap;
}
.sub-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 32px;
  flex-shrink: 0;
}
.sub-tags {
  flex: 1;
  min-width: 240px;
}
.col-req,
.col-pk {
  justify-self: center;
  align-self: center;
  text-align: center;
}
.col-desc {
  align-self: center;
  min-width: 0;
}
.dfe-head .col-desc {
  justify-self: start;
}
.sys-name {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.sys-text {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.sys-q {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c-text-faint);
  color: #ffffff;
  font-size: 10px;
  cursor: help;
}
.sys-dash {
  color: var(--c-text-faint);
  align-self: center;
}
.opt-label {
  margin-right: var(--space-2);
}
.opt-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cell-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: var(--lh-tight, 1.3);
}
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.dfe-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.dfe-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.dfe-err-text {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
