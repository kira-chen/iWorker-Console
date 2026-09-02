<script setup>
/**
 * 主题切换按钮（浅/暗）。日/月图标，点击即时切换并持久化。
 * 全站复用：员工端顶栏、管理端顶栏均放此组件，行为一致。
 */
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const isDark = computed(() => themeStore.theme === 'dark')
const tip = computed(() => (isDark.value ? '切换到浅色' : '切换到暗色'))
</script>

<template>
  <el-tooltip :content="tip" placement="bottom" :show-after="300">
    <button class="theme-toggle" type="button" :aria-label="tip" @click="themeStore.toggle">
      <el-icon><Moon v-if="isDark" /><Sunny v-else /></el-icon>
    </button>
  </el-tooltip>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: 17px;
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.theme-toggle:hover {
  background: var(--bg-hover);
  color: var(--c-text-strong);
}
</style>
