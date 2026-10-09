<script setup>
/**
 * 「已回收」红色小标签（强制回收后的标记，PRD 各模块「强制回收」小节）。
 *
 * 用在两处：①列表状态列「未发布」标签旁；②岗位 / 专家 / 技能里被回收对象的引用行。
 * 悬停展示回收原因、操作人和时间；info 为空（未被回收）时不渲染。
 */
import { revokedTip } from '@/utils/forceRevoke'

defineProps({
  /** 回收信息 { reason, at, operator }；空则不渲染 */
  info: { type: Object, default: null }
})
</script>

<template>
  <el-tooltip v-if="info" :content="revokedTip(info)" placement="top">
    <span class="revoked-tag">已回收</span>
  </el-tooltip>
</template>

<style scoped>
.revoked-tag {
  display: inline-flex;
  align-items: center;
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  font-size: var(--fs-xs);
  line-height: 20px;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  background: var(--c-danger-soft);
  white-space: nowrap;
  cursor: default;
}
</style>
