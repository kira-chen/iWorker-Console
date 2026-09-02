<script setup>
/**
 * 员工端运行时功能占位页（FRONT_RUNTIME_ENABLED=false 时由 router 挂载）。
 *
 * 对话 / 定时任务 / 个人空间 / 个人记忆的执行链路已随「主版本运行时剥离」迁往客户端运行时，
 * 本发布版后台不含对应后端端点（见 docs/architecture/主版本运行时剥离-配置分发化设计.md）。
 * 路由 name 保留（守卫与具名跳转依赖），仅组件替换为本占位页；
 * 执行链路就绪后将 utils/featureFlags.js 的 FRONT_RUNTIME_ENABLED 改回 true 即恢复原页面。
 */
</script>

<template>
  <div class="rt-placeholder">
    <el-empty
      description="该功能由客户端运行时提供，当前后台版本未包含执行链路"
      :image-size="96"
    />
  </div>
</template>

<style scoped>
.rt-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}
</style>
