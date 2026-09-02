<script setup>
/**
 * 用户端「采集表单」字段渲染器（填写侧，复用 FDE 配置侧 6 类型口径）。
 *
 * 单一职责：按 intakeSchema 动态渲染 6 类型控件 + 字段级校验态回显，
 * 通过 v-model:model 双向绑定 { [key]: value }。校验逻辑在父级用 intakeForm.js 完成，
 * 错误经 :errors={ [key]: msg } 传入，本组件只负责红框 + 错误文案展示。
 *
 * 6 类型：单行文本(input) / 多行文本(textarea) / 单选(opt chip 单选) /
 *        多选(opt chip 多选) / 数字(number) / 日期(date-picker)。
 *
 * 话术（Q14）：不暴露「采集/Agent/技能」等 FDE 术语；字段 label 用 FDE 配的中文显示名。
 */
import { isSelectType } from '@/utils/intakeForm'

const props = defineProps({
  schema: { type: Array, default: () => [] },
  model: { type: Object, default: () => ({}) },
  // 字段级错误：{ [key]: '错误文案' }
  errors: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:model'])

function setVal(key, value) {
  emit('update:model', { ...props.model, [key]: value })
}

// 单选：点击切换。
// - 必填单选：再点同值不取消，保持已选（防误清，必填语义更稳）。
// - 非必填单选：再点同值可回到「未选」（选错可取消）。
function pickSingle(field, opt) {
  if (!field.required && props.model[field.key] === opt) {
    setVal(field.key, '')
    return
  }
  setVal(field.key, opt)
}

// 多选：点击切换数组成员
function toggleMulti(field, opt) {
  const cur = Array.isArray(props.model[field.key]) ? props.model[field.key] : []
  const next = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]
  setVal(field.key, next)
}

function isOn(field, opt) {
  if (field.type === 'multi_select') {
    return Array.isArray(props.model[field.key]) && props.model[field.key].includes(opt)
  }
  return props.model[field.key] === opt
}

function errOf(key) {
  return props.errors?.[key] || ''
}
</script>

<template>
  <div class="iff">
    <div
      v-for="field in schema"
      :key="field.key"
      class="iff-field"
      :class="{ 'is-err': errOf(field.key) }"
    >
      <div class="iff-label">
        <span>{{ field.label || field.key }}</span>
        <span v-if="field.required" class="iff-req">*</span>
      </div>
      <div v-if="field.desc" class="iff-desc">{{ field.desc }}</div>

      <!-- 单行文本 -->
      <el-input
        v-if="field.type === 'text'"
        :model-value="model[field.key] ?? ''"
        :placeholder="field.placeholder || '请输入'"
        class="iff-ctrl"
        @update:model-value="setVal(field.key, $event)"
      />

      <!-- 多行文本 -->
      <el-input
        v-else-if="field.type === 'textarea'"
        :model-value="model[field.key] ?? ''"
        type="textarea"
        :rows="3"
        :placeholder="field.placeholder || '请输入'"
        class="iff-ctrl"
        @update:model-value="setVal(field.key, $event)"
      />

      <!-- 数字 -->
      <el-input-number
        v-else-if="field.type === 'number'"
        :model-value="model[field.key] === '' || model[field.key] == null ? undefined : Number(model[field.key])"
        controls-position="right"
        :placeholder="field.placeholder || '0'"
        class="iff-ctrl iff-number"
        @update:model-value="setVal(field.key, $event == null ? null : $event)"
      />

      <!-- 日期 -->
      <el-date-picker
        v-else-if="field.type === 'date'"
        :model-value="model[field.key] || ''"
        type="date"
        value-format="YYYY-MM-DD"
        :placeholder="field.placeholder || '选择日期'"
        class="iff-ctrl iff-date"
        @update:model-value="setVal(field.key, $event || '')"
      />

      <!-- 单选 / 多选：chip 形态 -->
      <div v-else-if="isSelectType(field.type)" class="iff-opts">
        <span
          v-for="opt in field.options || []"
          :key="opt"
          class="iff-opt"
          :class="{ on: isOn(field, opt) }"
          @click="field.type === 'multi_select' ? toggleMulti(field, opt) : pickSingle(field, opt)"
        >{{ opt }}</span>
        <span v-if="!(field.options && field.options.length)" class="iff-noopt">（暂无可选项）</span>
      </div>

      <div v-if="errOf(field.key)" class="iff-errmsg">
        <el-icon><WarningFilled /></el-icon>{{ errOf(field.key) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.iff {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.iff-field {
  display: flex;
  flex-direction: column;
}
.iff-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text);
  margin-bottom: 6px;
}
.iff-req {
  color: var(--c-danger);
}
.iff-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-bottom: 6px;
  margin-top: -2px;
}
.iff-ctrl {
  width: 100%;
}
.iff-number,
.iff-date {
  width: 100%;
}
.iff-number :deep(.el-input-number),
.iff-number {
  width: 100%;
}
/* 选项 chip */
.iff-opts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.iff-opt {
  padding: 6px 14px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  color: var(--c-text);
  cursor: pointer;
  transition: background var(--dur-fast, 0.12s), border-color var(--dur-fast, 0.12s), color var(--dur-fast, 0.12s);
  user-select: none;
}
.iff-opt:hover {
  background: var(--bg-hover);
}
.iff-opt.on {
  background: var(--bg-selected);
  border-color: var(--c-accent);
  color: var(--c-accent);
  font-weight: var(--fw-medium);
}
.iff-opt.on::before {
  content: '✓ ';
}
.iff-noopt {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 错误态 */
.iff-errmsg {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
  margin-top: 6px;
}
/* 焦点态柔光描边（贴近 mockups/intake-form.html） */
.iff-ctrl :deep(.el-input__wrapper.is-focus),
.iff-ctrl :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--c-accent) inset, 0 0 0 3px var(--c-accent-soft);
}
/* 错误态：红描边 + 外晕（贴近视觉稿） */
.iff-field.is-err :deep(.el-input__wrapper),
.iff-field.is-err :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset, 0 0 0 3px var(--c-danger-soft);
}
.iff-field.is-err .iff-opts {
  /* 选项区整体红描边 + 外晕提示（chip 形态无单一 wrapper） */
  padding: 4px;
  margin: -4px;
  border-radius: var(--radius-md);
  box-shadow: 0 0 0 1px var(--c-danger) inset, 0 0 0 3px var(--c-danger-soft);
}
</style>
