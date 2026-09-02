<script setup>
/**
 * SkillMilkdownEditor 的内层核心 —— 必须运行在 <MilkdownProvider> 子树内，
 * 才能调用 useEditor（Milkdown v7 useEditor/useInstance 依赖 provider 注入的实例上下文）。
 *
 * 本组件持有 Milkdown 实例、toolRef 节点 schema / remark / nodeView / inputRule、
 * v-model 防回环逻辑，并 defineExpose insertTool / focus 给外层转发。
 *
 * 纯切分 / 序列化逻辑复用 utils/skillToolRef.js（可单测）；此处只做 Milkdown 接线 + DOM nodeView。
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
// history 插件：注册后 Mod-z 撤销 / Shift-Mod-z 与 Mod-y 重做的键盘快捷键自动生效（其 historyKeymap 随插件注入）。
import { history } from '@milkdown/kit/plugin/history'
// ProseMirror history 深度探针：undoDepth/redoDepth 返回可撤销/重做步数（>0 即可用），用于工具栏按钮禁用态。
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { $node, $remark, $view, $inputRule, replaceAll, callCommand } from '@milkdown/kit/utils'
import { Milkdown, useEditor } from '@milkdown/vue'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { visit } from 'unist-util-visit'
import { splitTextToToolRefNodes, toolRefToMarkdown, resolveBizName } from '@/utils/skillToolRef'

const props = defineProps({
  modelValue: { type: String, default: '' },
  toolNames: { type: Object, default: () => ({}) },
  // 只读态（平台技能 Tab 只读详情）：ProseMirror editable=false（正文不可编辑、仍可滚动/选中查看）。
  readonly: { type: Boolean, default: false }
})
// formatState：把当前选区的「激活格式」(粗体/斜体/标题层级/列表…) 回吐给外层工具栏做 active 态联动（规格 §1.3）。
const emit = defineEmits(['update:modelValue', 'format-state'])

/* ------- 本会话插入映射 code→bizName -------
 * 序列化只写 @tool[code]（不含 bizName），编辑器 replaceAll 重解析后节点 bizName attr 为空。
 * 若此时 props.toolNames（来源 referencedTools）尚未刷新（保存前 / 自动保存往返中），chip 会退化成 code。
 * 这里记录「本次会话每次 insertTool 的 code→bizName」，作为 toolNames 之后的兜底，
 * 保证至少本次编辑插入过的工具在重解析时仍显示业务名、绝不露 code。
 * 用普通对象（非 reactive）即可：chip 文案在 nodeView/toDOM 渲染时同步读取，写入后由后续节点重建自然生效。
 *
 * 会话隔离（CR-P1）：本映射是 Core 实例级，但切技能时该编辑器子树实例复用、不重建
 * （PositionWorkbench 的 SkillFocusEditor 无 :key，switchSkill 只改 focusedSkillId 值不卸载）。
 * 若只增不清，技能 A 插入的名会残留到技能 B（B 引同 code 但 referencedTools 尚未刷新的瞬间会误显 A 的名）。
 * 故暴露 resetSession()，由上层在编辑的 skillId 变化时调用清空，保证会话名不跨技能泄漏；
 * 冷重载（新技能加载）仍靠 props.toolNames(referencedTools) 兜底，不依赖本映射。 */
let sessionBizNames = Object.create(null)

// 跳转定位高亮时长（UI #1：文本定位/工具 chip 定位统一为同一常量，去除 700/900 不一致）。
const FLASH_MS = 800

/* ------- 业务名解析：节点 attr → props.toolNames → 本会话映射 → code ------- */
function bizNameOf(code, attrBiz) {
  return resolveBizName(code, attrBiz, props.toolNames, sessionBizNames)
}
function chipText(code, attrBiz) {
  return `🔧 ${bizNameOf(code, attrBiz)}`
}
// 悬浮提示：业务名 + 底层 code（给进阶用户心智锚点 + 提示删除方式，设计 CR #3/#6）。
function chipTitle(code, attrBiz) {
  const biz = bizNameOf(code, attrBiz)
  const base = biz === code ? `工具引用：${code}` : `工具引用：${biz}（${code}）`
  return `${base} · 选中后按删除键移除`
}

/* ============================================================
 * toolRef 行内 atom 节点 schema
 * ============================================================ */
const toolRefNodeSchema = $node('toolRef', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',
  attrs: {
    code: { default: '' },
    bizName: { default: '' }
  },
  parseDOM: [
    {
      tag: 'span[data-tool-ref]',
      getAttrs: (dom) => ({
        code: dom.getAttribute('data-tool-ref') || '',
        bizName: dom.getAttribute('data-biz-name') || ''
      })
    }
  ],
  toDOM: (node) => [
    'span',
    {
      'data-tool-ref': node.attrs.code,
      'data-biz-name': node.attrs.bizName,
      title: chipTitle(node.attrs.code, node.attrs.bizName),
      class: 'tool-ref-chip'
    },
    chipText(node.attrs.code, node.attrs.bizName)
  ],
  // mdast(toolRef) → prosemirror 节点
  parseMarkdown: {
    match: (n) => n.type === 'toolRef',
    runner: (state, n, type) => {
      state.addNode(type, { code: n.code || '', bizName: n.bizName || '' })
    }
  },
  // prosemirror 节点 → mdast：写回行内 `@tool[code]`（统一收敛形态）。
  // 关键：用 mdast `html` 节点而非 `text` 节点——text 会被 remark-stringify 转义成 `@tool\[code\]`
  // （`[`/`_` 是 markdown 特殊字符），导致后端正则 `@tool\[...\]` 匹配不到 → 白名单不收（Playwright 逮到的真 bug）。
  // html 节点原样输出不转义；重新加载时 `@tool[code]` 作为普通文本被 remark transformer 再切成 chip，round-trip 成立。
  toMarkdown: {
    match: (n) => n.type.name === 'toolRef',
    runner: (state, n) => {
      state.addNode('html', undefined, toolRefToMarkdown(n.attrs.code))
    }
  }
}))

/* ============================================================
 * remark transformer：mdast text 节点 → 切出 toolRef 节点
 *  - 行内 @tool[x] + 块级 :::tool{code=x} 均由 splitTextToToolRefNodes 处理
 * ============================================================ */
const toolRefRemark = $remark('toolRefSplit', () => () => (tree) => {
  visit(tree, 'text', (node, index, parent) => {
    if (!parent || index == null) return undefined
    const parts = splitTextToToolRefNodes(node.value)
    if (!parts) return undefined // 无标记，原样不动
    parent.children.splice(index, 1, ...parts)
    return index + parts.length // 跳过新插入的节点，继续遍历
  })
})

/* ============================================================
 * DOM NodeView：行内药丸，atom 不可编辑内部、可整体选中/删除
 * ============================================================ */
const toolRefView = $view(toolRefNodeSchema, () => (node) => {
  const dom = document.createElement('span')
  dom.className = 'tool-ref-chip'
  dom.setAttribute('data-tool-ref', node.attrs.code)
  dom.setAttribute('contenteditable', 'false')
  dom.title = chipTitle(node.attrs.code, node.attrs.bizName)
  dom.textContent = chipText(node.attrs.code, node.attrs.bizName)
  return {
    dom,
    ignoreMutation: () => true,
    stopEvent: () => false
  }
})

/* ============================================================
 * 输入规则：手敲 @tool[code] 即时转 chip（容错；正常走工具坞）
 * ============================================================ */
const toolRefInputRule = $inputRule((ctx) => {
  // code 字符集与后端 SkillMdToolParser 一致 [a-z][a-z0-9_]*（CR-P1，不放宽，否则 chip 显示但白名单不收）。
  return new InputRule(/@tool\[([a-z][a-z0-9_]*)\]$/, (state, match, start, end) => {
    const code = match[1]
    if (!code) return null
    const type = toolRefNodeSchema.type(ctx)
    return state.tr.replaceWith(start, end, type.create({ code, bizName: '' }))
  })
})

/* ============================================================
 * Milkdown 实例（useEditor 须在 MilkdownProvider 子树内）
 * ============================================================ */
const lastMarkdown = ref(props.modelValue || '') // 编辑器当前 markdown（防回环基准）

const { get } = useEditor((root) =>
  Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, props.modelValue || '')
      // 只读态：ProseMirror editable=false（不渲染光标/不接受输入，仅展示 + 可滚动查看）。
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !props.readonly }))
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        lastMarkdown.value = markdown
        emit('update:modelValue', markdown)
        // 内容变化也可能改变光标所在块级（如刚 wrap 成标题），同步 active 态。
        emitFormatState()
      })
      // 选区/光标移动时同步 active 态（监听 ProseMirror 事务 → 重算激活格式）。
      // 注意：@milkdown/plugin-listener 的 selectionUpdated 在 ProseMirror 插件 state.apply(tr) 内同步触发，
      // 此刻 view.updateState 尚未提交，view.state / editorStateCtx 都还是「上一次选区」→ 直接算会滞后一步。
      // 故延一帧（待 view.state 提交后）再 emit，保证读到的是最新选区（修「格式指示滞后一步」bug）。
      ctx.get(listenerCtx).selectionUpdated(() => emitFormatStateDeferred())
    })
    .use(commonmark)
    .use(gfm)
    // history 紧跟 gfm：注册撤销/重做及其键盘快捷键（Mod-z / Shift-Mod-z / Mod-y），与 commonmark keymap 不冲突。
    .use(history)
    .use(listener)
    .use(toolRefRemark)
    .use(toolRefNodeSchema)
    .use(toolRefView)
    .use(toolRefInputRule)
)

function withEditor(fn) {
  const editor = get()
  if (!editor) return undefined
  return fn(editor)
}

/* ============================================================
 * §13.2 Markdown 即时渲染竞态修复
 * ============================================================
 * 根因：useEditor 异步创建，实例就绪前 get()=null。整页编辑器场景 modelValue 是「加载后派生」的，
 * 实例未就绪时外部内容到达 → watch 里 withEditor 拿不到实例直接 return、replaceAll 被静默跳过，
 * 内容未经 markdown parser 转节点就以初始 defaultValue（可能空/旧）上屏 → 显示原始 `##`，编辑后才纠正。
 *
 * 修法（纯前端、零依赖、复用 replaceAll，走 remark parser）：
 *  ① 编辑器就绪后主动用当前 props.modelValue 跑一次 replaceAll 重灌（消除「内容早于实例到达被丢」）。
 *  ② watch 在实例未就绪时不静默吞——挂起 pending 值，待就绪补灌。
 *  ③ replaceAll(md, true) 带 flush，确保重解析（commonmark/gfm parser → 节点）。 */
let pendingMarkdown = null // 实例未就绪时挂起的待灌内容（null = 无挂起）
let readyTimer = null

// 用最新 modelValue 经 parser 重灌（就绪后兜底 + 挂起补灌共用）。
function applyMarkdown(md) {
  const next = md || ''
  withEditor((editor) => {
    lastMarkdown.value = next
    editor.action(replaceAll(next, true)) // flush=true → 重解析为节点，非纯文本插入
  })
}

// 轮询等编辑器就绪（useEditor 无显式 ready promise；get() 由 null→实例即就绪），就绪后重灌一次当前内容。
function flushWhenReady() {
  if (get()) {
    // 就绪：优先灌挂起值，否则用当前 props.modelValue 兜底重灌一次（防初始内容未解析上屏）。
    const md = pendingMarkdown != null ? pendingMarkdown : props.modelValue
    pendingMarkdown = null
    applyMarkdown(md)
    return
  }
  readyTimer = setTimeout(flushWhenReady, 30) // 未就绪：短轮询重试，不静默放弃
}

onMounted(() => flushWhenReady())
let fmtRaf = 0 // selectionUpdated 延帧 emit 的 rAF 句柄（emitFormatStateDeferred 用；卸载时取消）
onBeforeUnmount(() => {
  if (readyTimer) clearTimeout(readyTimer)
  if (fmtRaf) cancelAnimationFrame(fmtRaf)
})

/* ------- 外部 modelValue → 仅当与编辑器当前 md 不同才 replaceAll（防回环 / 防光标跳） ------- */
watch(
  () => props.modelValue,
  (val) => {
    const next = val || ''
    if (next === lastMarkdown.value) return
    if (!get()) {
      // ② 实例未就绪：挂起待就绪补灌，不静默吞（§13.2.2）。
      pendingMarkdown = next
      return
    }
    applyMarkdown(next)
  }
)

/* ============================================================
 * 格式工具栏：执行命令 + 计算 active 态（规格 §1）
 *  - runCommand：外层工具栏点按钮 → callCommand 执行 commonmark 命令；
 *  - emitFormatState：选区/内容变化时算出当前激活格式回吐外层做按钮高亮。
 * ============================================================ */
// 执行一条 commonmark 命令（commandKey 为命令对象的 .key；payload 可选，如 heading level）。
function runCommand(commandKey, payload) {
  withEditor((editor) => {
    editor.action(callCommand(commandKey, payload))
    // 命令执行后立刻刷新 active 态（部分命令不触发 markdownUpdated，如纯标记 toggle 在空选区）。
    emitFormatState()
    // 回焦编辑器，保证连续操作（点工具栏不丢光标）。
    editor.action((ctx) => ctx.get(editorViewCtx).focus())
  })
}

// 计算当前选区激活的格式：{ bold, italic, code, bullet, ordered, quote, codeblock, heading: 0|1..6 }
function computeFormatState(state) {
  const { schema, selection } = state
  const { from, $from, to, empty } = selection
  const marks = schema.marks
  const nodes = schema.nodes

  // 行内标记 active：空选区看 storedMarks/光标处 marks；有选区看整段是否带该 mark。
  function markActive(markType) {
    if (!markType) return false
    if (empty) {
      const stored = state.storedMarks || $from.marks()
      return !!markType.isInSet(stored)
    }
    return state.doc.rangeHasMark(from, to, markType)
  }

  // 当前光标所在最近的块级节点类型（用于标题层级 / 列表 / 引用 / 代码块 active）。
  let headingLevel = 0
  let inBullet = false
  let inOrdered = false
  let inQuote = false
  let inCodeBlock = false
  let listResolved = false // 列表只取最近一层 list 祖先（嵌套列表不同时高亮 bullet+ordered，CR-P2）
  for (let d = $from.depth; d >= 0; d -= 1) {
    const node = $from.node(d)
    const t = node.type
    if (t === nodes.heading && !headingLevel) headingLevel = node.attrs.level || 0
    if (!listResolved && t === nodes.bullet_list) {
      inBullet = true
      listResolved = true
    }
    if (!listResolved && t === nodes.ordered_list) {
      inOrdered = true
      listResolved = true
    }
    if (t === nodes.blockquote) inQuote = true
    if (t === nodes.code_block) inCodeBlock = true
  }

  return {
    bold: markActive(marks.strong),
    italic: markActive(marks.emphasis),
    code: markActive(marks.inlineCode),
    bullet: inBullet,
    ordered: inOrdered,
    quote: inQuote,
    codeblock: inCodeBlock,
    heading: headingLevel,
    // 撤销/重做可用性：由 ProseMirror history 深度决定（>0 即有可撤销/重做步），随 format-state 回吐外层做禁用态。
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0
  }
}

function emitFormatState() {
  withEditor((editor) => {
    editor.action((ctx) => {
      // 读实时 view.state（ProseMirror dispatch 提交后即最新）。runCommand/markdownUpdated 路径调用时
      // 事务已提交，可直接读；selectionUpdated 路径在提交前触发，须走下方 deferred 版。
      const state = ctx.get(editorViewCtx).state
      emit('format-state', computeFormatState(state))
    })
  })
}

// 延一帧再 emit：用于 selectionUpdated（在 state.apply 内、view.state 提交前触发）。
// rAF 合并同一帧内的多次选区事件，避免重复计算；卸载时取消（见 onBeforeUnmount），防泄漏。
function emitFormatStateDeferred() {
  if (fmtRaf) cancelAnimationFrame(fmtRaf)
  fmtRaf = requestAnimationFrame(() => {
    fmtRaf = 0
    emitFormatState()
  })
}

/* ------- 暴露：insertTool / focus ------- */
function insertTool(code, bizName) {
  if (!code) return
  // 记住本次插入的 code→bizName，供后续 replaceAll 重解析（节点 attr 丢名）时兜底，防 chip 退化成 code。
  if (bizName) sessionBizNames[code] = bizName
  withEditor((editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = toolRefNodeSchema.type(ctx)
      const node = type.create({ code, bizName: bizName || '' })
      const tr = view.state.tr.replaceSelectionWith(node, false)
      view.dispatch(tr.scrollIntoView())
      view.focus()
    })
  })
}

function focus() {
  withEditor((editor) => {
    editor.action((ctx) => {
      ctx.get(editorViewCtx).focus()
    })
  })
}

/* ------- 定位到正文中引用某 code 的工具 chip（需求 #3；布局调整 #7 支持多处循环跳转） -------
 * codeOrCodes 可为单 code 或 code 数组（整表收敛：数据表行聚合存量操作级引用，跳转遍历全部成员）。
 * 遍历文档收集全部 type.name==='toolRef' 且 attrs.code 命中的节点位置（文档序）→
 * 取第 occurrence % 总数 处（调用方每次点击递增 occurrence 即得「跳下一处、末尾回绕」），
 * NodeSelection 选中 + scrollIntoView + focus，并给其 nodeView dom 加短暂 .flash 高亮。
 * 返回命中的引用总数（0 = 未找到，静默不报错），供调用方推进循环序号。 */
function scrollToTool(codeOrCodes, occurrence = 0) {
  const codeSet = new Set(
    (Array.isArray(codeOrCodes) ? codeOrCodes : [codeOrCodes]).filter(Boolean)
  )
  if (!codeSet.size) return 0
  return (
    withEditor((editor) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { doc } = view.state
        const positions = []
        doc.descendants((node, p) => {
          if (node.type.name === 'toolRef' && codeSet.has(node.attrs.code)) {
            positions.push(p)
            return false
          }
          return true
        })
        if (!positions.length) return 0
        const idx = ((occurrence % positions.length) + positions.length) % positions.length
        const pos = positions[idx]
        const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
        view.dispatch(tr.scrollIntoView())
        view.focus()
        // 短暂高亮：找到该 pos 的 nodeView DOM，加 .flash class，FLASH_MS 后移除（不破坏 chip 既有渲染/选中/删除）。
        try {
          const dom = view.nodeDOM(pos)
          if (dom && dom.classList) {
            dom.classList.add('flash')
            setTimeout(() => dom.classList.remove('flash'), FLASH_MS)
          }
        } catch {
          /* nodeDOM 偶发取不到 DOM 时忽略高亮，定位本身已生效 */
        }
        return positions.length
      })
    ) || 0
  )
}

/* ------- 跨文件查找命中精确定位（组③增强，本期 backlog 落地）：在已渲染文档里找含 keyword 的首个文本节点 →
 * 定位到其所在块的起点 + scrollIntoView + flash。Milkdown 无行号映射，故用「命中文本内容」在节点树里查找定位
 * （比按行号可靠：行号是源码维度，富文本是节点维度）。找不到 → 返回 false，上层兜底（提示用 Ctrl/⌘+F）。 */
function scrollToText(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return false
  const kwLow = kw.toLowerCase()
  return (
    withEditor((editor) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { doc } = view.state
        let hitPos = -1
        doc.descendants((node, pos) => {
          if (hitPos !== -1) return false
          // 优先按文本节点命中（精确到命中文本的位置）；命中即记录该文本节点起点。
          if (node.isText && node.text && node.text.toLowerCase().includes(kwLow)) {
            const idx = node.text.toLowerCase().indexOf(kwLow)
            hitPos = pos + idx
            return false
          }
          return true
        })
        if (hitPos === -1) return false
        // 选中命中文本片段（from..to）→ 滚动到位 + flash 所在块。
        const from = hitPos
        const to = Math.min(hitPos + kw.length, doc.content.size)
        let sel
        try {
          sel = TextSelection.create(doc, from, to)
        } catch {
          sel = TextSelection.near(doc.resolve(Math.min(from, doc.content.size)))
        }
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
        view.focus()
        flashAt(view, hitPos)
        return true
      })
    ) || false
  )
}

// 给某 pos 所在节点的 DOM 加短暂 .flash 高亮（复用 scrollToTool 的视觉，统一 FLASH_MS）。
function flashAt(view, pos) {
  try {
    let dom = view.nodeDOM(pos)
    // 文本命中时 nodeDOM(pos) 可能是文本节点容器或父块；向上找元素节点加 class。
    if (dom && dom.nodeType === 3) dom = dom.parentElement
    if (!dom) {
      const at = view.domAtPos(pos)
      dom = at?.node?.nodeType === 1 ? at.node : at?.node?.parentElement
    }
    if (dom && dom.classList) {
      dom.classList.add('flash')
      setTimeout(() => dom.classList.remove('flash'), FLASH_MS)
    }
  } catch {
    /* 取不到 DOM 时忽略高亮，定位本身已生效 */
  }
}

/* ------- 会话隔离：切技能时清空本会话插入映射（CR-P1） -------
 * 上层在编辑的 skillId 变化时调用，避免技能 A 的会话名残留污染技能 B。
 * 重建为新对象（而非清 key）以彻底断开旧引用；之后的 chip 解析自动回落 toolNames / code。 */
function resetSession() {
  sessionBizNames = Object.create(null)
}

defineExpose({ insertTool, focus, runCommand, resetSession, scrollToTool, scrollToText })
// 实例销毁：@milkdown/vue 的 useEditor 在组件 scope dispose 时自动 editor.destroy()，无需手动 onBeforeUnmount。
</script>

<template>
  <Milkdown />
</template>
