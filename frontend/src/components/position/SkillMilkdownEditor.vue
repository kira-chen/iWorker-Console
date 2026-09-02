<script setup>
/**
 * skill.md 所见即所得编辑器（Milkdown v7 · Typora/Notion 式原地实时渲染）。
 *
 * 职责：把 skill.md（标准 markdown 字符串，唯一真相源）以 WYSIWYG 视图呈现给 FDE。
 * - 工具引用收敛为「单一行内徽标」：编辑器里显示药丸「🔧 业务名」，底层统一序列化为 `@tool[code]`；
 *   存量块级 `:::tool{code=x}`（独占行）加载时也识别成同一种 chip，保存时归一为 `@tool[code]`。
 * - 用户永不见 / 不手敲 raw code：插入由父组件工具坞驱动（defineExpose insertTool）。
 *
 * v-model 防回环（关键）：
 * - 初始化用 defaultValueCtx 灌入 modelValue；
 * - 编辑时 markdownUpdated → emit('update:modelValue', md)，并记下「编辑器当前 md」；
 * - 父组件外部改 modelValue 时，仅当与「编辑器当前 md」不同才 replaceAll 同步，
 *   避免每次 emit 又触发 watch 回灌 → 光标跳动 / 无限循环。
 *
 * 主题：正文/chip 全部只用站点 Notion 语义令牌（CSS 变量），由全站 <html data-theme> 级联自动切浅/暗，
 * 本组件无需自管主题作用域（CR：原 theme-* class 是死类，已移除）。
 *
 * 纯切分 / 序列化逻辑抽到 utils/skillToolRef.js（可单测）；本组件只做 Milkdown 接线 + DOM 节点视图。
 */
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { MilkdownProvider } from '@milkdown/vue'
import {
  wrapInHeadingCommand,
  turnIntoTextCommand,
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  liftListItemCommand
} from '@milkdown/kit/preset/commonmark'
// 插入表格命令（GFM 预设已 .use(gfm) 启用，Core 的 callCommand 已透传 payload）：
// 默认插入 3 行 × 3 列（含表头）。给用户直观创建表格入口，替代难发现的 |x| 简写规则。
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
// 撤销/重做命令（history 插件已在 Core 注册；此处仅取命令对象的 .key 走现有 run() 派发）。
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import SkillMilkdownCore from './SkillMilkdownCore.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // { [code]: bizName } —— 解析 chip 业务名；缺失回落 code
  toolNames: { type: Object, default: () => ({}) },
  placeholder: { type: String, default: '' },
  height: { type: String, default: '100%' },
  // 只读态（平台技能 Tab 只读详情）：隐藏格式工具栏（编辑入口）+ 内层 ProseMirror editable=false。
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// 占位符作为 CSS 字符串变量注入（::before content 读取），转义双引号防破坏
const phText = computed(() => `"${String(props.placeholder || '').replace(/"/g, '\\"')}"`)

/* ------- 内层 core（持有 Milkdown 实例，须在 MilkdownProvider 子树内） ------- */
const coreRef = ref(null)

function onUpdate(md) {
  emit('update:modelValue', md)
}

/* ============================================================
 * 格式工具栏（飞书式克制）。当前工具栏包含：撤销 / 重做 / 段落格式（标题层级）/
 * 加粗 / 斜体 / 无序列表 / 有序列表 / 插入表格。
 * ============================================================ */
// 当前编辑器态（core 在选区/内容变化时回吐），驱动工具栏按钮的 active 高亮与禁用态：
//  - 行内/块级激活态：heading（标题层级 0|1..6）、bold、italic、bullet、ordered；
//  - 撤销/重做可用性：canUndo / canRedo（core 依 undoDepth/redoDepth 回吐，驱动撤销·重做按钮禁用态）。
// 注：core 仍会回吐 code/quote/codeblock 等字段，此处不渲染对应按钮即可，多余字段无副作用。
const fmt = reactive({
  bold: false, italic: false,
  bullet: false, ordered: false,
  heading: 0,
  // 撤销/重做可用性（core 依 undoDepth/redoDepth 回吐），驱动对应按钮禁用态。
  canUndo: false, canRedo: false
})
function onFormatState(s) {
  Object.assign(fmt, s)
}

// 标题下拉
const headingOpen = ref(false)
const headingMenuRef = ref(null)
const HEADINGS = [
  { level: 0, label: '正文', tag: '' },
  { level: 1, label: '一级标题', tag: 'H1' },
  { level: 2, label: '二级标题', tag: 'H2' },
  { level: 3, label: '三级标题', tag: 'H3' },
  { level: 4, label: '四级标题', tag: 'H4' },
  { level: 5, label: '五级标题', tag: 'H5' },
  { level: 6, label: '六级标题', tag: 'H6' }
]
const headingLabel = computed(
  () => HEADINGS.find((h) => h.level === fmt.heading)?.label || '正文'
)
function toggleHeadingMenu() {
  headingOpen.value = !headingOpen.value
}
// 点击外部关闭标题下拉（复用站内 click-outside 模式）
function onHeadingClickOutside(e) {
  if (headingOpen.value && headingMenuRef.value && !headingMenuRef.value.contains(e.target)) {
    headingOpen.value = false
  }
}
function pickHeading(level) {
  headingOpen.value = false
  if (level === 0) {
    // 「正文」= 把当前块转回普通段落
    coreRef.value?.runCommand(turnIntoTextCommand.key)
  } else {
    coreRef.value?.runCommand(wrapInHeadingCommand.key, level)
  }
}

// 通用命令派发
function run(commandKey, payload) {
  coreRef.value?.runCommand(commandKey, payload)
}

/* 列表按钮做成开关（修复「列表退不出去」死开关 bug）：
 * 光标已在该类型列表内 → liftListItem 退出一层 / 退回顶格普通段落（等价 Shift+Tab，
 *   多项列表里的空项退成顶格段落、其余项仍在列表，嵌套列表退一层）；
 * 否则 → 包成对应列表。
 * fmt.bullet / fmt.ordered 由 core 的 computeFormatState 依最近一层 list 祖先回吐，
 * 可靠反映光标当前是否在该类型列表内。 */
function toggleBullet() {
  if (fmt.bullet) coreRef.value?.runCommand(liftListItemCommand.key)
  else coreRef.value?.runCommand(wrapInBulletListCommand.key)
}
function toggleOrdered() {
  if (fmt.ordered) coreRef.value?.runCommand(liftListItemCommand.key)
  else coreRef.value?.runCommand(wrapInOrderedListCommand.key)
}

/* ------- 暴露：转发到内层 core ------- */
function insertTool(code, bizName) {
  coreRef.value?.insertTool(code, bizName)
}
function focus() {
  coreRef.value?.focus()
}
// 会话隔离：转发到内层 core，清空本会话插入映射（切技能时由上层调用，CR-P1）。
function resetSession() {
  coreRef.value?.resetSession()
}
// 定位到正文中引用某 code 的工具 chip（需求 #3；#7 多处循环跳转）：转发到内层 core。
// codeOrCodes = 单 code 或 code 数组（整表收敛聚合成员）；occurrence = 目标序号（对总数取模回绕）；
// 返回命中的引用总数（0=未找到）。
function scrollToTool(codeOrCodes, occurrence = 0) {
  return coreRef.value?.scrollToTool(codeOrCodes, occurrence)
}
// 跨文件查找精确定位（组③）：按命中文本定位。转发到内层 core。
function scrollToText(keyword) {
  return coreRef.value?.scrollToText?.(keyword)
}
defineExpose({ insertTool, focus, resetSession, scrollToTool, scrollToText })

onMounted(() => document.addEventListener('click', onHeadingClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onHeadingClickOutside))
</script>

<template>
  <div
    class="skill-mde"
    :data-empty="!props.modelValue"
    :style="{ height: props.height, '--ph-text': phText }"
  >
    <!-- 格式工具栏（sticky 吸顶，规格 §1）：左格式组 → 弹性中缝 → 右侧（字数 / 工具引用入口，由父级 slot 注入）。
         只读态（平台技能 Tab）：格式按钮均为编辑写入口，整条工具栏 v-if 不渲染（仅保留右侧 slot 字数提示另起一行）。 -->
    <div v-if="!readonly" class="ed-md-bar">
      <!-- @ 撤销 / 重做（history 插件；键盘 ⌘Z / ⇧⌘Z 亦自动生效，此处提供可视入口 + 禁用态） -->
      <button
        type="button" class="tb-btn"
        :disabled="!fmt.canUndo"
        title="撤销 ⌘Z" aria-label="撤销"
        @click="run(undoCommand.key)"
      >↶</button>
      <button
        type="button" class="tb-btn"
        :disabled="!fmt.canRedo"
        title="重做 ⇧⌘Z" aria-label="重做"
        @click="run(redoCommand.key)"
      >↷</button>

      <span class="tb-sep"></span>

      <!-- A 段落级：标题下拉 -->
      <div ref="headingMenuRef" class="tb-heading-wrap">
        <button
          type="button"
          class="tb-btn tb-heading"
          :class="{ active: headingOpen || fmt.heading > 0 }"
          title="段落格式"
          aria-label="段落格式"
          @click.stop="toggleHeadingMenu"
        >
          <span class="tb-heading-lab">{{ headingLabel }}</span>
          <span class="tb-caret">▾</span>
        </button>
        <div v-if="headingOpen" class="tb-heading-menu">
          <div
            v-for="h in HEADINGS"
            :key="h.level"
            class="tb-heading-item"
            :class="{ on: fmt.heading === h.level }"
            @click="pickHeading(h.level)"
          >
            <span>{{ h.label }}</span>
            <span v-if="h.tag" class="tb-heading-tag">{{ h.tag }}</span>
          </div>
        </div>
      </div>

      <span class="tb-sep"></span>

      <!-- B 行内标记 -->
      <button
        type="button" class="tb-btn tb-b" :class="{ active: fmt.bold }"
        title="加粗 ⌘B" aria-label="加粗"
        @click="run(toggleStrongCommand.key)"
      >B</button>
      <button
        type="button" class="tb-btn tb-i" :class="{ active: fmt.italic }"
        title="斜体 ⌘I" aria-label="斜体"
        @click="run(toggleEmphasisCommand.key)"
      >I</button>

      <span class="tb-sep"></span>

      <!-- C 列表（开关语义：active 高亮时再点即退出列表/向前缩进一位，消除死开关） -->
      <button
        type="button" class="tb-btn" :class="{ active: fmt.bullet }"
        title="无序列表 · 再点退出" aria-label="无序列表"
        @click="toggleBullet"
      >•</button>
      <button
        type="button" class="tb-btn" :class="{ active: fmt.ordered }"
        title="有序列表 · 再点退出" aria-label="有序列表"
        @click="toggleOrdered"
      >1.</button>

      <span class="tb-sep"></span>

      <!-- D 插入表格（默认 3×3 含表头，payload 经 Core callCommand 透传） -->
      <button
        type="button" class="tb-btn"
        title="插入表格" aria-label="插入表格"
        @click="run(insertTableCommand.key, { row: 3, col: 3 })"
      >▦</button>

      <span class="tb-spacer"></span>

      <!-- 右段：字数软提示（父级通过 slot 注入） -->
      <div class="tb-right">
        <slot name="bar-right"></slot>
      </div>
    </div>

    <div class="skill-mde-scroll">
      <MilkdownProvider>
        <SkillMilkdownCore
          ref="coreRef"
          :model-value="props.modelValue"
          :tool-names="props.toolNames"
          :readonly="props.readonly"
          @update:model-value="onUpdate"
          @format-state="onFormatState"
        />
      </MilkdownProvider>
    </div>
  </div>
</template>

<style scoped>
.skill-mde {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-elevated);
  color: var(--c-text);
  border-radius: var(--radius-md);
}

/* 滚动容器：toolbar sticky 吸顶以此为参照（规格 §1.1） */
.skill-mde-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ============================================================
 * 格式工具栏（规格 §1）
 * ============================================================ */
.ed-md-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 var(--space-3);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-soft);
  /* 工具栏在 flex 顶部固定、正文在下方独立滚动容器，等效吸顶且不抖动（无需 sticky）。
     position:relative 使 z-index 生效，保证标题下拉等浮层不被正文盖住（CR）。 */
  position: relative;
  z-index: var(--z-sticky);
}
.tb-spacer {
  flex: 1;
}
.tb-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
.tb-sep {
  width: 1px;
  height: 18px;
  background: var(--border-soft);
  margin: 0 var(--space-2);
  flex-shrink: 0;
}
.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 5px;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: 1;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.tb-btn:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.tb-btn:active {
  background: var(--bg-active);
}
.tb-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--c-accent-soft), 0 0 0 1px var(--c-accent) inset;
}
.tb-btn.active {
  background: var(--bg-selected);
  color: var(--c-accent);
  font-weight: var(--fw-medium);
}
.tb-btn:disabled {
  color: var(--c-text-faint);
  cursor: not-allowed;
  background: transparent;
}
/* 字形微调：B 粗体 / I 斜体 / <> code / {} 代码块 */
.tb-b { font-weight: var(--fw-bold); }
.tb-i { font-style: italic; font-family: Georgia, 'Times New Roman', serif; }
.tb-code { font-family: var(--font-mono); font-size: var(--fs-xs); }

/* 标题下拉 */
.tb-heading-wrap {
  position: relative;
}
.tb-heading {
  min-width: 84px;
  justify-content: space-between;
  padding: 0 8px;
  gap: 6px;
}
.tb-heading-lab {
  font-size: var(--fs-sm);
}
.tb-caret {
  font-size: 10px;
  color: var(--c-text-faint);
}
.tb-heading-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 160px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--space-1);
  z-index: var(--z-sticky);
}
.tb-heading-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.tb-heading-item:hover {
  background: var(--bg-hover);
}
.tb-heading-item.on {
  background: var(--bg-selected);
  color: var(--c-accent);
  font-weight: var(--fw-medium);
}
.tb-heading-tag {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  font-family: var(--font-mono);
}

/* Milkdown 容器 / ProseMirror 正文：Notion 令牌排版 */
.skill-mde :deep(.milkdown) {
  height: 100%;
}
.skill-mde :deep(.ProseMirror) {
  min-height: 100%;
  /* 2026-08-18：左右边距 space-5 → space-3，与基本信息区文本缩进统一收窄 */
  padding: var(--space-4) var(--space-3);
  outline: none;
  color: var(--c-text);
  font-size: var(--fs-md, 15px);
  line-height: 1.7;
  caret-color: var(--c-accent);
  -webkit-font-smoothing: antialiased;
}
.skill-mde :deep(.ProseMirror:focus) {
  outline: none;
}

/* 空文档占位符（ProseMirror 无原生 placeholder：空首段 ::before 兜底） */
.skill-mde[data-empty='true']
  :deep(.ProseMirror > p:first-child:last-child::before) {
  content: var(--ph-text, '');
  color: var(--c-text-faint);
  pointer-events: none;
  position: absolute;
  height: 0;
}

/* 正文排版 */
/* 2026-08-18：首块元素抹掉自带上外边距，避免与容器上内边距叠出过大顶部空白 */
.skill-mde :deep(.ProseMirror > :first-child) {
  margin-top: 0;
}
.skill-mde :deep(.ProseMirror h1),
.skill-mde :deep(.ProseMirror h2),
.skill-mde :deep(.ProseMirror h3) {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
  line-height: 1.3;
  margin: 1.2em 0 0.5em;
}
.skill-mde :deep(.ProseMirror h1) {
  font-size: 1.6em;
}
.skill-mde :deep(.ProseMirror h2) {
  font-size: 1.35em;
}
.skill-mde :deep(.ProseMirror h3) {
  font-size: 1.15em;
}
.skill-mde :deep(.ProseMirror p) {
  margin: 0.5em 0;
}
.skill-mde :deep(.ProseMirror ul),
.skill-mde :deep(.ProseMirror ol) {
  padding-left: 1.4em;
  margin: 0.4em 0;
}
.skill-mde :deep(.ProseMirror li) {
  margin: 0.2em 0;
}
.skill-mde :deep(.ProseMirror code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--bg-sunken);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  color: var(--c-accent);
}
.skill-mde :deep(.ProseMirror pre) {
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  overflow: auto;
}
.skill-mde :deep(.ProseMirror pre code) {
  background: none;
  padding: 0;
  color: var(--c-text);
}
.skill-mde :deep(.ProseMirror blockquote) {
  border-left: 3px solid var(--border-strong);
  margin: 0.6em 0;
  padding-left: var(--space-3);
  color: var(--c-text-muted);
}
.skill-mde :deep(.ProseMirror a) {
  color: var(--c-accent);
  text-decoration: underline;
}
.skill-mde :deep(.ProseMirror hr) {
  border: none;
  border-top: 1px solid var(--border-base);
  margin: 1em 0;
}

/* ============================================================
 * GFM 表格（Milkdown gfm 预设：ProseMirror table 节点 + prosemirror-tables 列宽拖拽）
 * 全部走 Notion 语义令牌，浅/暗双主题自动切换。类名均为 prosemirror-tables 真实产出：
 * .tableWrapper / .selectedCell / col / .column-resize-handle（已核对源码，非死类）。
 * ============================================================ */
/* 外层包裹：长表格横向滚动，不撑破正文宽度（tableWrapper 是 prosemirror-tables 生成的容器 div） */
.skill-mde :deep(.ProseMirror .tableWrapper) {
  overflow-x: auto;
  margin: 0.8em 0;
}
.skill-mde :deep(.ProseMirror table) {
  border-collapse: collapse;
  table-layout: auto;
  width: 100%;
  margin: 0.8em 0;
}
/* tableWrapper 内的 table 已由包裹层带 margin，避免双重外边距 */
.skill-mde :deep(.ProseMirror .tableWrapper table) {
  margin: 0;
}
.skill-mde :deep(.ProseMirror th),
.skill-mde :deep(.ProseMirror td) {
  border: 1px solid var(--border-base);
  padding: 6px 12px;
  text-align: left;
  vertical-align: top;
  min-width: 4em;
  position: relative; /* 供列宽拖拽把手绝对定位 */
}
/* 表头：弱底 + 强字色，与 ChatMarkdown 保持一致（th 用 --bg-hover） */
.skill-mde :deep(.ProseMirror th) {
  background: var(--bg-hover);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
/* 选中单元格：accent 弱底反馈（CellSelection 时 prosemirror-tables 给单元格加 .selectedCell） */
.skill-mde :deep(.ProseMirror .selectedCell) {
  background: var(--bg-selected);
}
/* 表头选中态覆盖弱底，保持可辨识 */
.skill-mde :deep(.ProseMirror th.selectedCell) {
  background: var(--c-accent-soft);
}
/* 列宽拖拽把手（columnResizing 插件产出）：右缘细竖条，hover 走 accent 色 */
.skill-mde :deep(.ProseMirror .column-resize-handle) {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--c-accent);
  pointer-events: none;
}

/* 工具引用药丸 chip（行内 atom） */
.skill-mde :deep(.tool-ref-chip) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 9px;
  margin: 0 1px;
  font-size: 0.86em;
  font-weight: var(--fw-medium);
  line-height: 1.5;
  white-space: nowrap;
  max-width: 18em; /* 长业务名省略，防撑破行（设计 CR #2） */
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: default;
  user-select: none;
  vertical-align: baseline;
  transition: border-color var(--dur-fast, 0.12s);
}
/* hover：浮现边框，提示「这是可操作的工具引用而非普通文字」（设计 CR #3） */
.skill-mde :deep(.tool-ref-chip:hover) {
  border-color: var(--c-accent);
}
/* 被选中（整体删除前的 selectable 高亮） */
.skill-mde :deep(.tool-ref-chip.ProseMirror-selectednode) {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
/* 左栏「已引用工具」点击定位时的短暂高亮脉冲（需求 #3）：~800ms 后由 JS 移除 .flash class
   （与 SkillMilkdownCore 的 FLASH_MS=800 统一，跳转高亮时长一致）。
   双主题均走 accent 语义令牌，醒目而不刺眼，结束后回落常态（不影响选中/hover/删除）。 */
.skill-mde :deep(.tool-ref-chip.flash) {
  animation: toolChipFlash 0.8s var(--ease-out);
}
@keyframes toolChipFlash {
  0% {
    background: var(--c-accent);
    color: var(--c-text-on-accent);
    box-shadow: 0 0 0 3px var(--c-accent-soft);
  }
  100% {
    background: var(--c-accent-soft);
    color: var(--c-accent);
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>
