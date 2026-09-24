/**
 * 统一「AI 实况生成」机制（2026-09-04 PRD-20260903 对齐，基准=新交互原型最终覆写态
 * unified-ai-live-generation-module L4386-4432 + 《AI生成按钮Prompt规范.md》场景/变量参考）。
 *
 * demo 不真调模型：按「源文本」本地模板化即时生成（模板句照原型 questionSet 逐字），
 * 交互四件套与原型一致——
 * 1. 源文本为空 → 按钮禁用 + title「请先填写<源字段名>」（各接入方传 sourceLabel）；
 * 2. 点击 → 按钮进「生成中…」态约 500ms（AI_LIVE_DELAY_MS，模拟生成耗时）；
 * 3. 到点后按点击那刻的源文本调 generate 产出内容，交 apply 回填表单；
 * 4. 完成 toast「AI 内容已生成，请确认后保存」（AI_LIVE_DONE_TOAST）。
 *
 * 【接入方】ExpertEditor（专家帮你做，3 条）/ SkillFocusEditor（技能示例问题，1 条）/
 * BizSystemEditor（示例问题，3 条）；McpEditor 由后续 MCP 批次接入（复用
 * connectorQuestionSet + sourceLabel「服务描述」即可）；ApiEditor 冻结不接。
 *
 * 【导出签名（MCP 批次对接口径）】
 * useAiLiveGenerate({ getSourceText, sourceLabel, getSourceContext?, generate, apply,
 *                     isReadonly?, delayMs?, idleLabel? })
 *   → { busy, sourceEmpty, disabled, title, label, run }
 * 生成器（条数内嵌在生成器里）：expertQuestionSet(3 条) / connectorQuestionSet(3 条) /
 * skillExampleQuestion(1 条)；文本工具 shortText / limitLen。
 *
 * 【2026-09-09 PRD-20260908 复核批次 0 · Q363–Q366】三个生成器改吃「上下文对象」，
 * 补传对象名称（《AI生成按钮Prompt规范.md》各入口变量来源表要求 name 入参）：
 *   expertQuestionSet({ name, intro, roleDesc, category })   —— 规范 §4
 *   connectorQuestionSet({ name, description })              —— 规范 §5/§6/§7
 *   skillExampleQuestion({ name, description })              —— 规范 §1
 * 三者首参仍兼容旧的字符串写法。demo 本地模板只有一个主语位，故口径为
 * **名称优先做主语、名称为空回落描述**（不做多字段拼串——拼串后会被 18 字截断截没）；
 * 禁用判定仍只看 getSourceText，接入方契约不变。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

/** 「生成中…」态时长（2026-09-06 负责人拍板 Q10：全站统一 500ms，原型 420ms 口径废止） */
export const AI_LIVE_DELAY_MS = 500
/** 完成 toast（原型 toastMsg 逐字） */
export const AI_LIVE_DONE_TOAST = 'AI 内容已生成，请确认后保存'
/** 生成中按钮文案（原型 button.textContent） */
export const AI_LIVE_BUSY_LABEL = '生成中…'
/** 生成的示例问题截断长度（一览表示例类统一规则；2026-09-18 待办 yuepu#5⑥：此前 7 处硬编码 60，
 *  输入框已放宽到 300，生成内容仍被这里截到 60 字，活 bug——收成一个常量，改一处生效） */
export const AI_LIVE_QUESTION_MAX = 300

/** 压空白 + 截断加省略号（原型 shortText 同口径），用于把源文本收成模板主语。 */
export function shortText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/** 按码点硬截断到 max 字，与调用处 maxlength 同口径。 */
export function limitLen(text, max) {
  const chars = Array.from(String(text || ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/**
 * 主语挑选（2026-09-09 PRD-20260908 复核批次 0 · Q363–Q366 新增）：
 * 《AI生成按钮Prompt规范.md》要求每个入口把「对象名称」一并送进上下文，但 demo 走本地模板、
 * 模板句只有一个主语位。口径：**名称优先做主语，名称为空时回落到描述**——这样既让名称真正参与
 * 生成（规范 §1/§4/§5/§6/§7 的 `name` 变量），又不会因为把 4 个字段拼成长串后被 18 字截断
 * 而把内容截没（原 expertQuestionSet 的隐患）。次要字段做名称缺失时的兜底源，不参与拼串。
 *
 * @param {Array<string>} candidates 按优先级排列的候选文本（先名称、后描述类字段）
 * @param {number} max 主语收束字数
 */
function pickSubject(candidates, max) {
  for (const c of candidates) {
    const clean = shortText(c, max)
    if (clean) return clean
  }
  return ''
}

/**
 * 专家「专家帮你做」3 条（模板照原型 questionSet('expert') 逐字，60 字截断）。
 *
 * 2026-09-09 Q363：上下文由「仅简介」扩为规范 §4 的四变量（名称 / 简介 / 职责描述 / 分类）。
 * 签名向下兼容——首参仍可传字符串（老调用方等价于「只有简介」）。
 * @param {string|{name?:string,intro?:string,roleDesc?:string,category?:string}} ctx
 */
export function expertQuestionSet(ctx) {
  const c = typeof ctx === 'string' ? { intro: ctx } : ctx || {}
  const subject = pickSubject([c.name, c.intro, c.roleDesc, c.category], 18)
  return [
    limitLen(`请围绕"${subject}"给出专业分析`, AI_LIVE_QUESTION_MAX),
    limitLen(`请基于"${subject}"识别关键问题并提出建议`, AI_LIVE_QUESTION_MAX),
    limitLen(`请针对"${subject}"整理一份可执行方案`, AI_LIVE_QUESTION_MAX)
  ]
}

/**
 * 连接器（业务系统 / MCP / API）示例问题 3 条（模板照原型 questionSet('connector') 逐字）。
 *
 * 2026-09-09 Q366：补传连接器名称（规范 §5/§6/§7 的 `name` 变量）。首参兼容旧字符串写法。
 * @param {string|{name?:string,description?:string}} ctx
 */
export function connectorQuestionSet(ctx) {
  const c = typeof ctx === 'string' ? { description: ctx } : ctx || {}
  const subject = pickSubject([c.name, c.description], 18)
  return [
    limitLen(`请查询与"${subject}"相关的信息`, AI_LIVE_QUESTION_MAX),
    limitLen(`请处理一项关于"${subject}"的业务请求`, AI_LIVE_QUESTION_MAX),
    limitLen(`请返回"${subject}"的最新处理结果`, AI_LIVE_QUESTION_MAX)
  ]
}

/**
 * 技能示例问题 1 条（模板照原型 skill-example-ai apply 逐字）。
 *
 * 2026-09-09 Q364：补传技能名称（规范 §1 的 `name` 变量）。首参兼容旧字符串写法。
 * @param {string|{name?:string,description?:string}} ctx
 */
export function skillExampleQuestion(ctx) {
  const c = typeof ctx === 'string' ? { description: ctx } : ctx || {}
  const subject = pickSubject([c.name, c.description], 24)
  return limitLen(`请帮我使用这个技能完成"${subject}"`, AI_LIVE_QUESTION_MAX)
}

/**
 * AI 实况生成 composable（Vue 组件内调用；驱动一个「AI 生成」按钮）。
 *
 * 【2026-09-09 PRD-20260908 复核批次 0 · Q363–Q366】新增可选 `getSourceContext`：
 * 生成器的入参由它决定（用于把「对象名称」等附加变量一并送进上下文，见
 * 《AI生成按钮Prompt规范.md》各入口的变量来源表）。**契约未变**——
 * `getSourceText` 仍是唯一的「空则禁用」判定源（哪个字段为空要拦，由接入方自己指定，
 * 通常就是 sourceLabel 指向的那个描述类字段），名称补传不参与禁用判定，
 * 因此不会出现「填了名称没填描述却放行」的口径漂移。未传时退化为旧行为（生成器吃源文本串）。
 *
 * @param {Object} options
 * @param {() => string} options.getSourceText 取源文本（每次求值，实况跟随输入框）；**唯一的禁用判定源**
 * @param {string} options.sourceLabel 源字段名（禁用 title「请先填写<sourceLabel>」）
 * @param {() => any} [options.getSourceContext] 取生成上下文（默认 = 源文本串）；只喂 generate，不参与禁用判定
 * @param {(ctx: any) => any} options.generate 本地模板生成器（条数内嵌其中）
 * @param {(result: any) => void} options.apply 生成结果回填（组件侧写表单/清红框）
 * @param {() => boolean} [options.isReadonly] 只读/锁定态（真 → 按钮禁用、不给「请先填写」title）
 * @param {number} [options.delayMs] 「生成中…」时长，默认 AI_LIVE_DELAY_MS（测试可传 0）
 * @param {string} [options.idleLabel] 空闲态按钮文案，默认「AI 生成」
 * @param {() => any} [options.getEntityId] 取当前编辑对象 id（每次求值）；组件按路由参数切换对象而不
 *   重新挂载时（如 SkillFocusEditor 随 route.params.id 复用实例），定时器触发时用它核对对象是否还是
 *   点击那一刻的对象，变了就丢弃结果、不回填（2026-09-18 待办 yuepu#13·技能 S1）。不传则不做该项校验
 *   （弹窗式编辑器 visible 切换会整个重新挂载，天然不受影响，无需接入）。
 * @returns {{ busy, sourceEmpty, disabled, title, label, run }} 均为 ref/computed + 触发函数
 */
export function useAiLiveGenerate({
  getSourceText,
  sourceLabel,
  getSourceContext = null,
  generate,
  apply,
  isReadonly = () => false,
  delayMs = AI_LIVE_DELAY_MS,
  idleLabel = 'AI 生成',
  getEntityId = null
}) {
  const busy = ref(false)
  const sourceEmpty = computed(() => !String(getSourceText() || '').trim())
  const disabled = computed(() => busy.value || sourceEmpty.value || !!isReadonly())
  // 原型 syncButton：仅「空且非只读」给引导 title，其余还原按钮原 title（此处即空串）
  const title = computed(() => (sourceEmpty.value && !isReadonly() ? `请先填写${sourceLabel}` : ''))
  const label = computed(() => (busy.value ? AI_LIVE_BUSY_LABEL : idleLabel))

  function run() {
    if (disabled.value) return
    // 源文本/上下文/对象 id 均取点击那刻的值（原型 liveValue(config.source)）
    const ctx = getSourceContext ? getSourceContext() : String(getSourceText() || '').trim()
    const entityAtClick = getEntityId ? getEntityId() : undefined
    busy.value = true
    setTimeout(() => {
      busy.value = false
      if (getEntityId && getEntityId() !== entityAtClick) return // 生成期间切换了对象，结果作废
      apply(generate(ctx))
      ElMessage.success(AI_LIVE_DONE_TOAST)
    }, delayMs)
  }

  return { busy, sourceEmpty, disabled, title, label, run }
}
