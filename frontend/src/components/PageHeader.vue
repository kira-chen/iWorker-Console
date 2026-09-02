<script setup>
/**
 * PageHeader —— 全站统一页头（标题 + 可选副标题 + 可选 emoji/徽标/作用域选择器/操作区）。
 *
 * 统一全站页头的标题字号、副标题口径与下边距，消除「各页各写一套 .xx-head」
 * 导致的字号/缩进漂移。吸收原 .page-head / .conn-title / .te-title / .td-name
 * 等多套写法。
 *
 * 用法：
 *   <PageHeader title="定时任务" subtitle="到点自动执行，结果推回对话" />
 *   带右侧操作（如「新建任务」）时用具名 slot：
 *   <PageHeader title="定时任务" subtitle="...">
 *     <template #actions><el-button type="primary">新建任务</el-button></template>
 *   </PageHeader>
 *   连接器页（emoji + 红点徽标）：
 *   <PageHeader emoji="🔌" title="MCP 接入" subtitle="...">
 *     <template #badge><span class="ph-reddot">2 异常</span></template>
 *     <template #scope>...</template>
 *     <template #actions>...</template>
 *   </PageHeader>
 *
 * 仅引用设计令牌，双主题自动适配。
 */
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  emoji: { type: String, default: '' },
  as: { type: String, default: 'h2' }
})
</script>

<template>
  <header class="page-header">
    <div class="page-header-text">
      <component :is="as" class="page-header-title">
        <span v-if="emoji" class="page-header-emoji">{{ emoji }}</span>
        {{ title }}
        <slot name="badge" />
      </component>
      <p v-if="subtitle" class="page-header-sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.scope" class="page-header-scope">
      <slot name="scope" />
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.page-header-text {
  min-width: 0;
}
.page-header-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  line-height: var(--lh-tight);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.page-header-emoji {
  font-size: 20px;
  line-height: 1;
}
.page-header-sub {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--c-text-muted);
}
.page-header-scope {
  flex-shrink: 0;
  width: 180px;
}
.page-header-actions {
  flex-shrink: 0;
}
/* 标题尾徽标（红点/计数）：供连接器页 #badge 插槽使用。
 * 用 :slotted 以命中父组件传入的插槽内容（.ph-reddot 写在调用页）。 */
.page-header-title :slotted(.ph-reddot) {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-danger);
  background: var(--c-danger-soft);
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
}
</style>
