<script setup>
/**
 * 岗位基础信息卡片（纯展示，单一职责）。
 * 用于「其他岗位」hover/详情、对话页头像堆叠 hover 浮窗等场景复用。
 *
 * position 形状（容忍字段缺省，做兜底）：
 *   { id|positionId, name, avatar(URL,可空), jobTag, intro, expertise }
 */
import { computed } from 'vue'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps({
  position: { type: Object, default: () => ({}) }
})

const name = computed(() => props.position?.name || '未命名搭子')
const avatar = computed(() => props.position?.avatar || null)
const jobTag = computed(() => props.position?.jobTag || '')
const intro = computed(() => props.position?.intro || '')
const expertise = computed(() => props.position?.expertise || '')

function avatarChar(n) {
  return (n || '岗')[0]
}
</script>

<template>
  <div class="position-info-card">
    <div class="eic-top">
      <el-avatar :size="44" :src="avatar" class="eic-avatar">
        {{ avatarChar(name) }}
      </el-avatar>
      <div class="eic-meta">
        <div class="eic-name" :title="name">{{ name }}</div>
        <StatusTag v-if="jobTag" type="info">{{ jobTag }}</StatusTag>
      </div>
    </div>
    <div v-if="intro" class="eic-intro">{{ intro }}</div>
    <div v-if="expertise" class="eic-skill">专长：{{ expertise }}</div>
  </div>
</template>

<style scoped>
.position-info-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.eic-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.eic-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  flex-shrink: 0;
}
.eic-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}
.eic-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eic-intro {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.eic-skill {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
}
</style>
