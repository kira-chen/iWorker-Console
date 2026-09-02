<script setup>
/**
 * 术语「?」气泡说明（功能波次 2a · 组②）。
 *
 * 背景：技能编辑器满屏术语，不懂技术的配置者看不懂（最终用户痛点 3）。给关键术语挂一个克制的「?」小圆，
 * hover/点击出一句大白话说明（el-tooltip 同时支持 hover 与点触屏的 focus 触发）。
 *
 * 用法：<TermHelp text="主文件，AI 从这里开始读" />
 * 纯展示、零业务；面向小白，文案由调用方给（口语化）。双主题用语义令牌。
 */
// el-tooltip / el-icon 走全局注册（app.use(ElementPlus)），不直接 import（与站内其它组件一致、便于测试 stub）。
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  // 一句话说明（大白话）。
  text: { type: String, required: true },
  // tooltip 弹出方位。
  placement: { type: String, default: 'top' }
})
</script>

<template>
  <el-tooltip :content="text" :placement="placement" effect="dark" :show-after="80">
    <el-icon
      class="term-help"
      tabindex="0"
      role="img"
      aria-label="说明"
      @click.stop
    >
      <QuestionFilled />
    </el-icon>
  </el-tooltip>
</template>

<style scoped>
.term-help {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--c-text-faint);
  cursor: help;
  vertical-align: middle;
  transition: color var(--dur-fast, 0.15s) ease;
}
.term-help:hover,
.term-help:focus {
  color: var(--c-accent);
  outline: none;
}
</style>
