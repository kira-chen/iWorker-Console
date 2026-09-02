<script setup>
/**
 * Markdown 编辑器（Sprint 2.1 设计 §3，D-C WYSIWYG）。
 * 单一职责：封装 md-editor-v3，v-model 即标准 Markdown 源文本（直接落 sop_doc）。
 *
 * 体积控制（设计 §3.2 / 前端 CR AC-2）：
 * - 按需禁用未用插件：代码高亮(highlight)、公式(katex)、流程图(mermaid) 通过 `noXxx`
 *   全部关闭，不引入对应重型 CDN/依赖。
 * - 工具栏裁剪为 SOP 编写所需子集（标题/列表/表格/引用/插入片段等），去掉公式/流程图/截图等。
 * - previewTheme/codeTheme 仅用内置，不额外引高亮主题包。
 *
 * 主题：md-editor-v3 暗/亮主题随全站主题（useThemeStore）联动；
 * 外层用 design tokens 包边框/圆角与现有表单一致。
 */
import { computed, ref, useSlots } from 'vue'
import { MdEditor, config } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

// 全局关闭扩展能力：不渲染数学公式/流程图/图表，避免按需加载 katex/mermaid/echarts。
// config 是幂等的模块级配置，多次 setup 调用安全。
config({
  editorExtensions: {
    highlight: { instance: undefined },
    katex: { instance: undefined },
    mermaid: { instance: undefined }
  }
})

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  // 字段级错误（来自后端 data.field 命中 sopDoc 时），命中描红边框
  error: { type: String, default: '' },
  // 纯单栏编辑（用户拍板：无预览、加大空间），默认高度调大；仍可由父级 props.height 覆盖。
  height: { type: String, default: '520px' },
  // 启用内置 pageFullscreen（铺满视口，由 md-editor-v3 内部托管，不自研全屏逻辑）。
  // 默认 false：既有 SOP/技能编辑用法零回归；技能聚焦态白板编辑置 true。
  fullscreen: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// 是否提供了 #toolbar-extra 具名 slot：有则在工具栏首位插入自定义按钮槽（defToolbars 第 0 项）。
const slots = useSlots()
const hasExtraToolbar = computed(() => !!slots['toolbar-extra'])

// 工具栏：仅保留 SOP 编写所需。纯单栏无预览，已去掉 preview/previewOnly/catalog（预览/目录在单栏下无意义）。
// fullscreen / toolbar-extra 参数化（取代既有重复的 SkillMdEditor）：
// - hasExtraToolbar 时把自定义按钮槽（0）放工具栏首位；
// - fullscreen 时把 pageFullscreen 追加到右侧（'=' 之后）。
const toolbars = computed(() => {
  const left = [
    'bold',
    'italic',
    'strikeThrough',
    '-',
    'title',
    'quote',
    'unorderedList',
    'orderedList',
    '-',
    'codeRow',
    'code',
    'link',
    'table',
    '-',
    'revoke',
    'next'
  ]
  const bar = hasExtraToolbar.value ? [0, '-', ...left] : left
  return props.fullscreen ? [...bar, '=', 'pageFullscreen'] : bar
})

const inner = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

// md-editor-v3 组件实例 ref：v6 通过 defineExpose 暴露 insert(generate) 等编辑器 API。
const mdRef = ref(null)

/**
 * 对外暴露的插入能力（#3 MCP 工具「插入」用）。
 * 优先用 md-editor-v3 的光标插入 API（在当前光标处插入，保留撤销栈）；
 * 若实例方法不可用（如测试 jsdom 环境/旧版本），降级为把文本追加到 v-model 末尾、
 * 自动补换行，保证幂等可读。无论哪条路径都保证内容写入。
 */
function insertText(text) {
  if (!text) return
  const api = mdRef.value
  if (api && typeof api.insert === 'function') {
    api.insert(() => ({
      // 在当前光标处插入引用文本（text 已带尾随换行，由调用方保证可读分行）
      targetValue: text,
      select: false,
      deviationStart: 0,
      deviationEnd: 0
    }))
    return
  }
  // 降级：追加到末尾并补换行
  const cur = props.modelValue || ''
  const sep = cur && !cur.endsWith('\n') ? '\n' : ''
  emit('update:modelValue', cur + sep + text + '\n')
}

defineExpose({ insertText })
</script>

<template>
  <div class="mde" :class="{ 'mde-error': !!error, 'mde-fill': height === '100%' }" :style="{ '--mde-h': height }">
    <MdEditor
      ref="mdRef"
      v-model="inner"
      :theme="themeStore.theme"
      preview-theme="default"
      :preview="false"
      :toolbars="toolbars"
      :placeholder="placeholder"
      :no-katex="true"
      :no-mermaid="true"
      :no-highlight="true"
      :no-upload-img="true"
      :no-img-zoom-in="true"
      :show-code-row-number="false"
      :style="{ height: 'var(--mde-h)' }"
    >
      <!-- 工具栏首位自定义按钮槽（toolbars 第 0 项）：透传父级 #toolbar-extra（如「插入工具引用」） -->
      <template v-if="hasExtraToolbar" #defToolbars>
        <slot name="toolbar-extra" />
      </template>
    </MdEditor>
    <div v-if="error" class="mde-err-text">{{ error }}</div>
  </div>
</template>

<style scoped>
.mde {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: border-color var(--dur-fast);
}
/* height=100% 时铺满 flex 父容器（技能聚焦态白板编辑用），固定 px 用法不受影响 */
.mde-fill {
  height: 100%;
}
.mde-error {
  border-color: var(--c-danger);
}
.mde :deep(.md-editor) {
  --md-bk-color: var(--bg-surface);
  border: none;
  border-radius: 0;
}
/* 纯单栏：编辑区铺满容器宽度（无预览半屏） */
.mde :deep(.md-editor-input-wrapper) {
  width: 100%;
}
.mde-err-text {
  padding: var(--space-1) var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
