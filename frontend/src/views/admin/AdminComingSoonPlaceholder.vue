<script setup>
/**
 * 后台「功能开发中」统一占位页。
 *
 * 左侧导航新增的规划中入口（驾驶舱 / 知识库 / 实例与会话 / 运行规格 / 配额与限流）
 * 尚无真实页面，统一挂本占位页：点击后正常跳转并高亮该导航项，页面提示「开发中」。
 * 各入口的展示名从路由 meta.title 读取，单页复用、不为每个占位项单独建组件。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => route.meta?.title || '功能')
</script>

<template>
  <div class="coming-soon">
    <el-empty :description="`「${title}」功能开发中，敬请期待`" :image-size="120" />
  </div>
</template>

<style scoped>
.coming-soon {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}
</style>
