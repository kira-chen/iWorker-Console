<script setup>
/**
 * 角色卡片复选（check-card）——用户新建窗「初始角色」与设置角色窗共用（2026-09-08 原型复刻批次 2A · G#6 / #8）。
 *
 * 【形态】照原型 L110 `.check-list{grid 两列 gap 10}` + `.check-card{flex;gap 9;padding 11;边框 8px 圆角}`
 *   卡内 = 原生 checkbox（accent 绿）+ `<strong>角色名</strong><small>授予对应平台权限</small>`；
 *   选中态 `:has(input:checked)` 绿边 + 浅绿底；未选校验错误 `.error-text`「请至少选择一个角色」内联在区块下方。
 * 【为什么不用 el-checkbox】原型是整卡可点的 label 包裹原生框，EP 复选的框 + 文案结构与之不同，
 *   用原生 input 更贴且测试可直接取 input 断言。
 *
 * props.modelValue = 已选角色 code[]；options = [{ code, name }]；error = 校验错误文案（空串不显示）。
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

function isOn(code) {
  return props.modelValue.includes(code)
}
function toggle(code, on) {
  const next = props.modelValue.filter((c) => c !== code)
  if (on) next.push(code)
  // 按选项顺序稳定输出，勾选先后不影响提交顺序
  const order = props.options.map((o) => o.code)
  next.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="rcc" :class="{ 'is-invalid': error }">
    <div class="check-list">
      <label v-for="o in options" :key="o.code" class="check-card" :class="{ 'is-checked': isOn(o.code) }">
        <input
          type="checkbox"
          :value="o.code"
          :checked="isOn(o.code)"
          :disabled="disabled"
          @change="toggle(o.code, $event.target.checked)"
        />
        <span>
          <strong>{{ o.name }}</strong>
          <small>授予对应平台权限</small>
        </span>
      </label>
    </div>
    <div v-if="error" class="error-text">{{ error }}</div>
  </div>
</template>

<style scoped>
.rcc {
  width: 100%;
}
.check-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.check-card {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px;
  border: 1px solid var(--border-admin-card, #dfe4e1);
  border-radius: 8px;
  background: var(--bg-surface);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
/* 选中态绿边 + 浅绿底（原型 border #8fc8b1 / bg #f1f8f5）：边色用 accent 晕色令牌，暗色主题随令牌走 */
.check-card:hover {
  border-color: var(--c-accent);
}
.check-card.is-checked {
  border-color: var(--c-accent);
  background: var(--c-accent-fill);
}
.check-card input {
  margin: 4px 0 0;
  accent-color: var(--c-accent);
  flex: none;
}
.check-card strong {
  display: block;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.check-card small {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rcc.is-invalid .check-card {
  border-color: var(--c-danger);
}
.error-text {
  margin-top: 5px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
@media (max-width: 620px) {
  .check-list {
    grid-template-columns: 1fr;
  }
}
</style>
