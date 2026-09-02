<script setup>
import { computed } from 'vue'

/**
 * 分类三路分流的「弱提示」标签：帮助用户理解这条 AI 回复走了哪条路。
 * 克制、次要色、不喧宾夺主；未知/缺省值不渲染（兜底不崩）。
 */
const props = defineProps({
  route: { type: String, default: '' }
})

// 数据驱动的取值表；未命中（含未知值）返回 null → 不渲染
const ROUTE_MAP = {
  simple: { label: '快速回答', icon: 'ChatDotRound' },
  knowledge: { label: '知识问答', icon: 'Reading' },
  task: { label: '办事', icon: 'Promotion' }
}

const meta = computed(() => ROUTE_MAP[props.route] || null)
</script>

<template>
  <span v-if="meta" class="route-chip" :title="meta.label">
    <el-icon class="route-chip__icon"><component :is="meta.icon" /></el-icon>
    <span class="route-chip__text">{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.route-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  /* 弱提示：低饱和、次要色，不抢正文 */
  user-select: none;
}
.route-chip__icon {
  font-size: var(--fs-xs);
}
.route-chip__text {
  font-weight: var(--fw-regular);
}
</style>
