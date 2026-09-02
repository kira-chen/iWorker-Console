<script setup>
/**
 * 对话回答 Markdown 渲染器（只读）。
 * 单一职责：把助手「回答正文」按 Markdown 渲染（加粗 / 列表 / 代码块 / 表格 / 引用…），
 * 与后台 MarkdownEditor 同一手法复用 md-editor-v3，仅取更轻的只读 MdPreview。
 *
 * 体积控制（同 MarkdownEditor §3.2）：
 * - noKatex / noMermaid / noHighlight 关闭公式 / 流程图 / 代码高亮三类重型扩展，
 *   不引入对应 CDN/依赖；previewTheme 仅用内置 default，不额外引高亮主题包。
 *
 * 安全（渲染 LLM 输出，必须防 XSS）：
 * - md-editor-v3 默认 sanitize 为恒等函数（不过滤）。这里全局注册其自带 XSSPlugin
 *   （基于内置 xss 白名单），对所有 MdPreview/MdEditor 编译产物统一净化，不引新依赖。
 * - 白名单收紧：XSSPlugin 默认会在 js-xss 白名单之上额外放行 <iframe>（src/allowfullscreen），
 *   LLM 输出理论上可借此嵌入外链/点击劫持。对话回答永远不需要 iframe/object/embed，
 *   故传入 xss 自定义函数，从 js-xss 的 getDefaultWhiteList() 出发删去这些嵌入/对象类标签，
 *   并显式保留任务列表 input、img 的 class（md-editor 原扩展里的非嵌入项），其余默认白名单不动。
 *   <script>/on* 事件属性/javascript: 链接本就不在白名单，继续被挡。
 *
 * 主题：theme 绑 useThemeStore().theme，与 MarkdownEditor 一致，浅/暗随全站切换。
 * 流式：modelValue 随 SSE 累加变化即重渲，MdPreview 自身做了渲染优化，
 *   对话级 token 量无明显卡顿，故流式期间直接实时渲染（caret 由父组件负责）。
 */
import { MdPreview, config, XSSPlugin } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

// 不允许出现在对话渲染中的嵌入 / 对象类标签（即便上游白名单放行也要剥离）。
const EMBED_TAGS = ['iframe', 'object', 'embed', 'frame', 'frameset', 'applet', 'param']

// XSSPlugin 的 xss 选项支持传函数 (xss) => IFilterXSSOptions；返回函数形式时插件
// 直接用我们给的配置构造 FilterXSS，从而绕过其内置 iframe 扩展白名单（关键）。
// 防御性：函数形式整段 try 兜底——任何上游签名/字段变更若使其抛错，
// 不能把整个 markdown-it 编译链带崩（否则 MdPreview 退回显示原文，丢失渲染）。
// 兜底回退到「内置默认白名单（不放行 iframe 等嵌入标签）」，XSS 防护不削弱。
const xssOptions = (xss) => {
  const whiteList = xss.getDefaultWhiteList()
  // 防御性删除嵌入/对象类标签（默认白名单虽不含，但显式删确保不被任何上游变更放回）。
  EMBED_TAGS.forEach((tag) => {
    delete whiteList[tag]
  })
  // 保留 md-editor 原扩展里的非嵌入项：任务列表复选框 + img 的 class。
  whiteList.input = [...new Set([...(whiteList.input || []), 'class', 'disabled', 'type', 'checked'])]
  whiteList.img = [...new Set([...(whiteList.img || []), 'class'])]
  return { whiteList }
}

// 全局注册 XSS 净化插件（幂等：config 为模块级，多次 setup 调用安全）。
// 用 try/catch 包裹：即便注册因上游 API 变化抛错，也只是退化为「无自定义白名单收紧」，
// 绝不让模块初始化失败而导致组件整体不渲染（曾被怀疑为「Markdown 显示原文」的成因）。
try {
  config({
    markdownItPlugins(plugins) {
      // 内层再 try：单个插件构造失败时跳过 XSS 插件而非中断整条插件链，
      // 保证 markdown 仍能渲染（宁可这一次不净化也要先确保不崩——但函数本身已尽量健壮）。
      try {
        return [...plugins, { type: 'xss', plugin: XSSPlugin, options: { xss: xssOptions } }]
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ChatMarkdown] XSS 插件注册失败，本次跳过净化以保渲染：', e)
        return plugins
      }
    }
  })
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[ChatMarkdown] md-editor config() 调用失败：', e)
}

const props = defineProps({
  content: { type: String, default: '' }
})

// 稳定的预览容器 id（每个组件实例一个，挂载期间不变）。
// 不用「无依赖的 computed + Math.random」——语义上易被误读为每次取值重算；
// 这里直接生成一次并固定，避免任何重渲时 id 漂移导致 md-editor 内部 DOM 关联错乱。
const previewId = `chat-md-${Math.random().toString(36).slice(2)}`
</script>

<template>
  <MdPreview
    :id="previewId"
    class="chat-md"
    :model-value="content"
    :theme="themeStore.theme"
    preview-theme="default"
    :no-katex="true"
    :no-mermaid="true"
    :no-highlight="true"
    :no-img-zoom-in="true"
  />
</template>

<style scoped>
/* 让预览融入气泡：去掉默认外边距/底色，字号行高对齐对话正文。
   颜色一律走 md-editor 暗/亮主题内置变量映射到我们的语义令牌，零硬编码色值。 */
.chat-md :deep(.md-editor-preview-wrapper) {
  padding: 0;
}
.chat-md :deep(.md-editor-preview) {
  font-family: var(--font-sans);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--c-text);
}
.chat-md :deep(.md-editor-preview p) {
  margin: var(--space-2) 0;
}
.chat-md :deep(.md-editor-preview p:first-child),
.chat-md :deep(.md-editor-preview > :first-child) {
  margin-top: 0;
}
.chat-md :deep(.md-editor-preview > :last-child) {
  margin-bottom: 0;
}
/* 行内代码 / 代码块：弱底克制，浅暗双主题清晰 */
.chat-md :deep(.md-editor-preview code) {
  font-family: var(--font-mono);
}
.chat-md :deep(.md-editor-preview p code),
.chat-md :deep(.md-editor-preview li code) {
  background: var(--bg-hover);
  color: var(--c-text-strong);
  border-radius: var(--radius-xs);
  padding: 1px 5px;
}
.chat-md :deep(.md-editor-preview pre) {
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
/* 引用块：左侧 accent 竖条 + 弱底 */
.chat-md :deep(.md-editor-preview blockquote) {
  border-left: 3px solid var(--c-accent);
  background: var(--c-accent-soft);
  color: var(--c-text-muted);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
/* 表格：克制边框，表头弱底 */
.chat-md :deep(.md-editor-preview table) {
  border-color: var(--border-base);
}
.chat-md :deep(.md-editor-preview th) {
  background: var(--bg-hover);
}
.chat-md :deep(.md-editor-preview th),
.chat-md :deep(.md-editor-preview td) {
  border-color: var(--border-soft);
}
/* 链接走 accent */
.chat-md :deep(.md-editor-preview a) {
  color: var(--c-accent);
}
</style>
