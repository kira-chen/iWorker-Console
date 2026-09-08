<script setup>
// 后台壳层：共享窄轨（AdminRail）+ 主区路由出口。
// 窄轨整块已抽到 AdminRail（AdminLayout 与 PositionWorkbench 共用），保证一致。
//
// 2026-09-08 原型复刻批次 1（A3）：主区改为灰底 + 限宽居中的 .page 容器（原型 L11 + L21–22：
// `.main{background:#f6f8f7}` / `.page{max-width:1480px;min-width:1120px;margin:0 auto;padding:26px 34px 48px}`），
// 表格/抽屉作为白卡浮在灰底上。底色走独立令牌 --bg-admin-main（员工端 --bg-app 不动）。
// 后台控件密度 / 表格白卡 / 弹窗尺寸等全局规则由 body.admin-scope 限定（见 assets/admin-shell.css，
// 类名由 router afterEach 按 /admin 前缀挂到 body，覆盖 teleport 到 body 的弹层）。
import AdminRail from '@/components/admin/AdminRail.vue'
</script>

<template>
  <div class="layout admin-shell">
    <AdminRail />

    <main class="main">
      <div class="page">
        <router-view />
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout {
  height: 100vh;
  display: flex;
  background: var(--bg-admin-main);
}

/* ---- 主区：灰底通栏，内容限宽居中（原型 .main / .page） ---- */
.main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--bg-admin-main);
}
.page {
  max-width: 1480px;
  min-width: 1120px;
  margin: 0 auto;
  padding: 26px 34px 48px;
}
</style>
