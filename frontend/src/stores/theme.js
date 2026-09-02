import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全站主题（Notion 风 · 浅/暗双主题）单一管理点。
 * - 持久化：localStorage（key=ai_theme）
 * - 应用方式：data-theme 写到 <html>，EP 弹层（挂 body）与 md-editor 一并命中
 * - 默认主题：DEFAULT_THEME 单点可改（当前 light，Notion 经典文档感作首屏）
 *
 * 全站统一主题，不再区分前台/后台；管理端与员工端共用同一主题切换。
 */
const STORAGE_KEY = 'ai_theme'
const THEMES = ['light', 'dark']
const DEFAULT_THEME = 'light' // 单点默认主题，改这一处即可

function readStored() {
  const v = localStorage.getItem(STORAGE_KEY)
  return THEMES.includes(v) ? v : DEFAULT_THEME
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref(readStored())

  /** 应用到 <html>，并持久化 */
  function apply(next) {
    if (!THEMES.includes(next)) return
    theme.value = next
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  /** 浅 / 暗互切 */
  function toggle() {
    apply(theme.value === 'dark' ? 'light' : 'dark')
  }

  /** 应用启动时初始化（main.js 调用一次） */
  function init() {
    apply(theme.value)
  }

  return { theme, apply, toggle, init }
})
