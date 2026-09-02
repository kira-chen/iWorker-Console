/**
 * skill.md 工具引用（toolRef）纯逻辑层 —— 无 Vue / 无 ProseMirror / 无 DOM 依赖，便于单测。
 *
 * 背景：FDE 在 Milkdown 所见即所得编辑器里写 skill.md，工具引用收敛为「单一行内徽标」。
 * - 底层存储统一为行内形态 `@tool[code]`（唯一收敛形态）；
 * - 存量块级形态 `:::tool{code=x}`（独占行）加载时也识别成 chip，保存时归一为 `@tool[code]`；
 * - 编辑器里渲染成药丸「🔧 业务名」，用户永不见/不手敲 raw code。
 *
 * 本模块提供「mdast 层」的解析与序列化纯函数：
 * - splitTextToToolRefNodes(text)：把一段文本切成 mdast 节点序列（text / toolRef 交替）；
 * - toolRefToMarkdown(code)：把 toolRef 节点写回行内 `@tool[code]`。
 *
 * 真正接入 Milkdown 的 remark transformer / 节点 schema 在 SkillMilkdownEditor.vue 里，
 * 但其切分 / 回写逻辑全部复用此处的纯函数，从而可被 Vitest 在 node 环境直接断言 round-trip。
 *
 * 正则与后端 SkillMdToolParser 口径**严格对齐**：code 字符集 `^[a-z][a-z0-9_]*`
 * （小写字母开头，仅 `[a-z0-9_]`）。前端不得比后端宽——否则「编辑器收/渲染成 chip，
 * 但后端 INLINE_TOOL 匹配不到 → 保存后不进白名单」，造成静默失效（CR-P1）。
 */

// code 字符集：与后端 SkillMdToolParser 完全一致 [a-z][a-z0-9_]*（小写起头，仅 a-z 0-9 _）。
// 不可放宽到大写/冒号/点/连字符——后端正则不认，放宽会导致 chip 显示但白名单不收。
const CODE = '[a-z][a-z0-9_]*'

// 块级 :::tool{code=x}（允许内部空格），行内 @tool[x]。
// 用「全局且带捕获」的单一交替正则，按出现顺序逐段切分文本。
export const TOOL_BLOCK_RE = new RegExp(`:::tool\\{\\s*code\\s*=\\s*(${CODE})\\s*\\}`)
export const TOOL_INLINE_RE = new RegExp(`@tool\\[(${CODE})\\]`)
// 合并匹配（用于一次扫描切分）：块级捕获组 1，行内捕获组 2。
const TOOL_SPLIT_RE = new RegExp(
  `:::tool\\{\\s*code\\s*=\\s*(${CODE})\\s*\\}|@tool\\[(${CODE})\\]`,
  'g'
)

/**
 * mdast toolRef 节点工厂。
 * @param {string} code 工具 code
 * @returns {{type:'toolRef', code:string}}
 */
export function toolRefNode(code) {
  return { type: 'toolRef', code }
}

/**
 * 把一段纯文本切分为 mdast 节点序列：散文 text 节点与 toolRef 节点交替。
 * - 命中 `:::tool{code=x}` 或 `@tool[x]` → {type:'toolRef', code}
 * - 其余文本 → {type:'text', value}
 * 不产生空 text 节点。若整段无引用，返回 null（调用方保持原 text 节点不动，零副作用）。
 *
 * @param {string} value 文本内容
 * @returns {Array<{type:'text',value:string}|{type:'toolRef',code:string}>|null}
 */
export function splitTextToToolRefNodes(value) {
  const text = String(value == null ? '' : value)
  TOOL_SPLIT_RE.lastIndex = 0
  let m
  let last = 0
  const out = []
  let hit = false
  while ((m = TOOL_SPLIT_RE.exec(text)) !== null) {
    hit = true
    if (m.index > last) {
      out.push({ type: 'text', value: text.slice(last, m.index) })
    }
    const code = m[1] || m[2]
    out.push(toolRefNode(code))
    last = m.index + m[0].length
    // 防止零宽匹配死循环（理论上不会，正则均非空匹配，仍做兜底）
    if (TOOL_SPLIT_RE.lastIndex === m.index) TOOL_SPLIT_RE.lastIndex++
  }
  if (!hit) return null
  if (last < text.length) {
    out.push({ type: 'text', value: text.slice(last) })
  }
  return out
}

/**
 * toolRef 节点 → 收敛后的行内 markdown 文本片段（统一 `@tool[code]`）。
 * @param {string} code
 * @returns {string}
 */
export function toolRefToMarkdown(code) {
  return `@tool[${code}]`
}

/**
 * chip 业务名解析（纯逻辑，可单测）。优先级：
 *   1. 节点 attr 携带的 bizName（刚插入 / parseDOM 拿到，最准）；
 *   2. 持久回显映射 toolNames（来源 referencedTools，保存+重载后稳定）；
 *   3. 本会话插入映射 sessionNames（保存前 / 重解析时兜住「本次插过的工具」，防退化成 code）；
 *   4. 都没有 → 回落 code（最后兜底，绝不报错）。
 *
 * 背景：序列化只写 `@tool[code]` 不含 bizName，编辑器 replaceAll 重解析后节点 bizName attr 为空，
 * 若此时 referencedTools 尚未刷新（如保存前或自动保存往返中），chip 就会退化成 code。
 * 本函数让 Core 在解析业务名时多一层「本会话插入过的 code→bizName」兜底，稳住本次编辑的全部工具。
 *
 * @param {string} code 工具 code
 * @param {string} [attrBiz] 节点 attr 上的 bizName
 * @param {Object} [toolNames] { [code]: bizName } 持久回显映射
 * @param {Object} [sessionNames] { [code]: bizName } 本会话插入映射
 * @returns {string} 解析出的业务名（最终至少为 code）
 */
export function resolveBizName(code, attrBiz, toolNames, sessionNames) {
  if (attrBiz) return attrBiz
  const fromPersisted = toolNames && toolNames[code]
  if (fromPersisted) return fromPersisted
  const fromSession = sessionNames && sessionNames[code]
  if (fromSession) return fromSession
  return code
}

/**
 * 端到端 round-trip 纯逻辑：把一段含 raw 标记的 markdown 文本归一为「@tool[code] 收敛形态」。
 * 等价于「解析成 toolRef 节点再写回」。供单测直接断言混排文本不丢内容、块级归一为行内。
 * 注意：这是行级文本归一，真实编辑器还会经 remark/prosemirror，但 toolRef 部分与此一致。
 *
 * @param {string} markdown
 * @returns {string}
 */
export function normalizeToolRefs(markdown) {
  const text = String(markdown == null ? '' : markdown)
  TOOL_SPLIT_RE.lastIndex = 0
  return text.replace(TOOL_SPLIT_RE, (full, blockCode, inlineCode) =>
    toolRefToMarkdown(blockCode || inlineCode)
  )
}
