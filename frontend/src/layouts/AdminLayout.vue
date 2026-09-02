<script setup>
// 后台壳层：共享窄轨（AdminRail）+ 主区路由出口。
// 窄轨整块已抽到 AdminRail（AdminLayout 与 PositionWorkbench 共用），保证一致。
import AdminRail from '@/components/admin/AdminRail.vue'
</script>

<template>
  <div class="layout">
    <AdminRail />

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.layout {
  height: 100vh;
  display: flex;
  background: var(--bg-app);
}

/* ---- 主区：顶到顶部 ---- */
.main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--bg-app);
  padding: var(--space-6);
}
</style>
