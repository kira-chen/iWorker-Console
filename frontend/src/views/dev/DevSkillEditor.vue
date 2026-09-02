<script setup>
/**
 * 【DEV ONLY · 仅开发环境】SkillMilkdownEditor 隔离挂载页，供 Playwright e2e 在真实浏览器里验证
 * 所见即所得渲染 / 工具 chip / insertTool / v-model 序列化回环。生产构建不挂此路由（router 仅 DEV 注册）。
 */
import { ref } from 'vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'

const initialMd = [
  '# 办事流程标题',
  '',
  '**重点**：先查后写。区域 {{intake.region}}。',
  '',
  '- 第一步：用 @tool[crm_query] 查客户',
  '- 第二步：命中后 :::tool{code=crm_update} 更新',
  ''
].join('\n')

const md = ref(initialMd)
const toolNames = { crm_query: '查询客户', crm_update: '更新客户', get_weather: '查询天气' }
const editorRef = ref(null)

function insertWeather() {
  editorRef.value?.insertTool('get_weather', '查询天气')
}
</script>

<template>
  <div style="max-width: 820px; margin: 24px auto; padding: 16px">
    <h3>DEV · SkillMilkdownEditor 验证页</h3>
    <button data-testid="insert-tool" @click="insertWeather">插入「查询天气」工具</button>
    <div data-testid="editor-wrap" style="height: 360px; border: 1px solid #ddd; margin: 12px 0">
      <SkillMilkdownEditor
        ref="editorRef"
        v-model="md"
        :tool-names="toolNames"
        placeholder="写技能的办事流程…"
      />
    </div>
    <pre data-testid="md-out" style="background: #f5f5f5; padding: 10px; white-space: pre-wrap">{{ md }}</pre>
  </div>
</template>
