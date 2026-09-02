<script setup>
/**
 * 表单字段标签 + ? 悬浮说明（V77 模型配置表单引入，可全站复用）。
 * 用在 el-form-item 的 #label 插槽内；必填星号仍由 el-form-item 的 required 规则渲染。
 */
defineProps({
  label: { type: String, required: true },
  /** 小白能看懂的参数解释，悬浮 ? 图标显示 */
  tip: { type: String, required: true }
})
</script>

<template>
  <span class="fhl">
    {{ label }}
    <el-tooltip :content="tip" placement="top" :show-after="150" popper-class="fhl-popper">
      <el-icon class="fhl-icon"><QuestionFilled /></el-icon>
    </el-tooltip>
  </span>
</template>

<style scoped>
.fhl {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.fhl-icon {
  font-size: 14px;
  color: var(--c-text-muted);
  cursor: help;
}
.fhl-icon:hover {
  color: var(--c-text);
}
</style>

<!-- tooltip 挂 body，scoped 命不中：限制解释文案宽度保证多行可读 -->
<style>
.fhl-popper {
  max-width: 320px;
  line-height: 1.6;
}
</style>
