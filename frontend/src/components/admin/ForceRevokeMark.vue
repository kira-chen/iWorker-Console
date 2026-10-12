<script setup>
/**
 * 「强制回收」申请标记：停用申请勾选了强制回收时，在审核中心 / 我的申请的「申请类型」旁追加红色小标签，
 * 悬停展示回收原因，便于审核人区别于普通停用（PRD 审核中心 §5.2、各模块「强制回收（停用时勾选）」）。
 * reason 为空（普通停用 / 发布申请）时不渲染。
 */
import StatusTag from '@/components/StatusTag.vue'

defineProps({
  /** 申请行上的 forceRevokeReason */
  reason: { type: String, default: '' }
})
</script>

<template>
  <el-tooltip v-if="reason" :content="`回收原因：${reason}`" placement="top">
    <span class="frm"><StatusTag type="danger">强制回收</StatusTag></span>
  </el-tooltip>
</template>

<style scoped>
.frm {
  margin-left: var(--space-1);
  cursor: default;
}
</style>
