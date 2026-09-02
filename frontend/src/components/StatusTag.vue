<script setup>
/**
 * StatusTag —— 全站统一的状态胶囊（小圆角软色标签）。
 *
 * 用 tokens 语义软色渲染，双主题自动适配，替代散落的各类状态标签
 * （已发布 / 草稿 / 启用中 / 已连接 / 上传中 / 失败 …）。
 *
 * 用法：<StatusTag type="success">已发布</StatusTag>
 *
 * type 取值：
 *   success —— 成功 / 已发布 / 已连接（绿）
 *   warning —— 进行中 / 草稿 / 上传中（黄）
 *   danger  —— 失败 / 异常（红）
 *   info    —— 中性 / 默认（灰，缺省）
 *   accent  —— 强调 / 选中（蓝）
 *   purple  —— 紫（2026-09-01 治理三页 PRD 对齐新增：业务类型「岗位」/ 终端「Windows」）
 */
import { computed } from 'vue'

const props = defineProps({
  type: {
    type: String,
    default: 'info',
    validator: (v) => ['success', 'warning', 'danger', 'info', 'accent', 'purple'].includes(v)
  }
})

const tagClass = computed(() => `st--${props.type}`)
</script>

<template>
  <span class="status-tag" :class="tagClass">
    <slot />
  </span>
</template>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  line-height: 1.4;
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}
.st--success {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.st--warning {
  color: var(--c-warning);
  background: var(--c-warning-soft);
}
.st--danger {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.st--info {
  color: var(--c-text-muted);
  background: var(--bg-hover);
}
.st--accent {
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.st--purple {
  color: var(--c-purple);
  background: var(--c-purple-soft);
}
</style>
