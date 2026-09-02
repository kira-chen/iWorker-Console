import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'
import { useUserStore } from './stores/user'
import { ensureDemoIdentity } from './utils/demoIdentity'
import { disableDialogEsc } from './utils/disableDialogEsc'
import './assets/main.css'

// 全局弹窗不响应 Esc（输入法候选态按 Esc 会误关弹窗），须在任何弹窗挂载前执行。
disableDialogEsc()

const app = createApp(App)

// 注册全部 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 主题初始化：从 localStorage 读取并应用 data-theme 到 <html>（首屏即生效）
useThemeStore().init()

// Demo 身份注入（取消登录，2026-09-01）：启动即写入内置「演示管理员」，直接进管理后台。
// 原 /auth/me 静默刷新随登录功能一并移除（demo 无后端）。
ensureDemoIdentity(useUserStore())

app.mount('#app')
