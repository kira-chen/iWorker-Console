<script setup>
/**
 * 「已回收」提示条：编辑 / 查看页顶部展示，「该{对象}已于 {时间} 被强制回收：{原因}」（PRD 各模块「强制回收」小节）。
 * info 为空（未被回收）时不渲染。
 */
defineProps({
  /** 对象类型名，如「技能」「专家」「MCP」「API」「业务系统」 */
  label: { type: String, required: true },
  /** 回收信息 { reason, at, operator }；空则不渲染 */
  info: { type: Object, default: null }
})
</script>

<template>
  <el-alert
    v-if="info"
    class="revoked-banner"
    type="error"
    show-icon
    :closable="false"
    :title="`该${label}已于 ${info.at} 被强制回收：${info.reason}`"
  />
</template>

<style scoped>
.revoked-banner {
  margin-bottom: var(--space-3);
}
</style>
