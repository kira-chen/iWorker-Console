<script setup>
/**
 * 多岗位头像堆叠（overlap）。仅展示 + hover 信息卡，点击无任何切换行为。
 *
 * props.positions：有序岗位数组，按「各自首次出现顺序」由父组件给定。
 *   每项形状（容忍缺省）：{ id|positionId, name, avatar, jobTag, intro, expertise }
 *
 * 设计：自建 CSS 堆叠（负 margin 重叠 + 描边），hover 上浮并置顶；
 *   信息卡用 el-popover（teleport 到 body）规避容器裁剪，trigger=hover。
 */
import { computed } from 'vue'
import PositionInfoCard from '@/components/PositionInfoCard.vue'

const props = defineProps({
  positions: { type: Array, default: () => [] }
})

// 兜底：过滤掉空项；保留传入顺序（首次出现序由父组件负责）
const list = computed(() => (props.positions || []).filter(Boolean))

function keyOf(e, i) {
  return e?.id ?? e?.positionId ?? `exp_${i}`
}
function avatarChar(name) {
  return (name || '岗')[0]
}
</script>

<template>
  <div v-if="list.length" class="avatar-stack" :aria-label="`本会话搭子 ${list.length} 个`">
    <el-popover
      v-for="(e, i) in list"
      :key="keyOf(e, i)"
      placement="bottom-start"
      trigger="hover"
      :width="280"
      :show-arrow="true"
      :offset="8"
      popper-class="position-stack-popper"
    >
      <template #reference>
        <span class="stack-item" :style="{ zIndex: list.length - i }">
          <el-avatar :size="28" :src="e.avatar" class="stack-avatar">
            {{ avatarChar(e.name) }}
          </el-avatar>
        </span>
      </template>
      <PositionInfoCard :position="e" />
    </el-popover>
  </div>
</template>

<style scoped>
.avatar-stack {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
/* 头像重叠：从第二个起负左外边距形成堆叠；hover 上浮置顶 */
.stack-item {
  display: inline-flex;
  position: relative;
  cursor: default;
  transition: transform var(--dur-fast) var(--ease-out);
}
.stack-item:not(:first-child) {
  margin-left: -10px;
}
.stack-item:hover {
  transform: translateY(-3px);
  z-index: 999 !important;
}
.stack-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  font-size: var(--fs-xs);
  /* 描边：与背景同色，使重叠处有清晰分隔 */
  border: 2px solid var(--bg-surface);
  box-sizing: content-box;
}
</style>

<!-- el-popover 内容 teleport 到 body，scoped 不附着，用 popper-class 命中 Notion 主题样式 -->
<style>
.position-stack-popper.el-popover.el-popper {
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
}
.position-stack-popper .el-popper__arrow::before {
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
}
</style>
