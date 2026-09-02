<script setup>
/**
 * 强制首改密码页（forced）：全屏承载页，内嵌 ChangePasswordDialog（forced 态，不可关闭）。
 *
 * 进入路径：路由守卫在 userStore.mustChangePassword 为 true 时把一切目标跳到此页（除本页外）。
 * 改密成功：ChangePasswordDialog 内清 store.mustChangePassword → @done 触发 → 本页放行跳到目标/首页。
 * 与后端 403 硬拦截配合，前端此页仅做体验层强跳，不承担鉴权。
 */
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 改密成功放行：优先回 redirect（守卫携带的原目标），否则交由默认跳转（后台账号进 /admin、员工进 /）
function onDone() {
  const redirect = route.query.redirect
  if (redirect && String(redirect) !== route.fullPath) {
    router.replace(String(redirect))
  } else if (userStore.isBackstage) {
    router.replace('/admin')
  } else {
    router.replace('/')
  }
}
</script>

<template>
  <div class="cpw-page">
    <div class="cpw-topbar">
      <ThemeToggle />
    </div>
    <!-- forced：弹窗常显不可关，页面本身作为遮蔽底 -->
    <ChangePasswordDialog :visible="true" forced @done="onDone" />
  </div>
</template>

<style scoped>
.cpw-page {
  position: relative;
  height: 100vh;
  background: var(--bg-app);
}
.cpw-topbar {
  position: absolute;
  top: var(--space-5);
  right: var(--space-5);
}
</style>
