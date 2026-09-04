/**
 * 统一「AI 实况生成」机制（2026-09-04 PRD-20260903 对齐，基准=新交互原型最终覆写态
 * unified-ai-live-generation-module L4386-4432 + 《AI生成按钮Prompt规范.md》场景/变量参考）。
 *
 * demo 不真调模型：按「源文本」本地模板化即时生成（模板句照原型 questionSet 逐字），
 * 交互四件套与原型一致——
 * 1. 源文本为空 → 按钮禁用 + title「请先填写<源字段名>」（各接入方传 sourceLabel）；
 * 2. 点击 → 按钮进「生成中…」态约 420ms（AI_LIVE_DELAY_MS，模拟生成耗时）；
 * 3. 到点后按点击那刻的源文本调 generate 产出内容，交 apply 回填表单；
 * 4. 完成 toast「AI 内容已生成，请确认后保存」（AI_LIVE_DONE_TOAST）。
 *
 * 【接入方】ExpertEditor（专家帮你做，3 条）/ SkillFocusEditor（技能示例问题，1 条）/
 * BizSystemEditor（示例问题，3 条）；McpEditor 由后续 MCP 批次接入（复用
 * connectorQuestionSet + sourceLabel「服务描述」即可）；ApiEditor 冻结不接。
 *
 * 【导出签名（MCP 批次对接口径）】
 * useAiLiveGenerate({ getSourceText, sourceLabel, generate, apply, isReadonly?, delayMs?, idleLabel? })
 *   → { busy, sourceEmpty, disabled, title, label, run }
 * 生成器（条数内嵌在生成器里）：expertQuestionSet(3 条) / connectorQuestionSet(3 条) /
 * skillExampleQuestion(1 条)；文本工具 shortText / limitLen。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

/** 「生成中…」态时长（原型 setTimeout 420ms） */
export const AI_LIVE_DELAY_MS = 420
/** 完成 toast（原型 toastMsg 逐字） */
export const AI_LIVE_DONE_TOAST = 'AI 内容已生成，请确认后保存'
/** 生成中按钮文案（原型 button.textContent） */
export const AI_LIVE_BUSY_LABEL = '生成中…'

/** 压空白 + 截断加省略号（原型 shortText 同口径），用于把源文本收成模板主语。 */
export function shortText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/** 按码点硬截断到 max 字（原型 limit 同口径，对齐输入框 maxlength=60）。 */
export function limitLen(text, max) {
  const chars = Array.from(String(text || ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 专家「专家帮你做」3 条（源=专家简介；模板照原型 questionSet('expert') 逐字，60 字截断）。 */
export function expertQuestionSet(sourceText) {
  const subject = shortText(sourceText, 18)
  return [
    limitLen(`请围绕"${subject}"给出专业分析`, 60),
    limitLen(`请基于"${subject}"识别关键问题并提出建议`, 60),
    limitLen(`请针对"${subject}"整理一份可执行方案`, 60)
  ]
}

/** 连接器（业务系统 / MCP / API）示例问题 3 条（模板照原型 questionSet('connector') 逐字）。 */
export function connectorQuestionSet(sourceText) {
  const subject = shortText(sourceText, 18)
  return [
    limitLen(`请查询与"${subject}"相关的信息`, 60),
    limitLen(`请处理一项关于"${subject}"的业务请求`, 60),
    limitLen(`请返回"${subject}"的最新处理结果`, 60)
  ]
}

/** 技能示例问题 1 条（源=技能描述；模板照原型 skill-example-ai apply 逐字）。 */
export function skillExampleQuestion(sourceText) {
  return limitLen(`请帮我使用这个技能完成"${shortText(sourceText, 24)}"`, 60)
}

/**
 * AI 实况生成 composable（Vue 组件内调用；驱动一个「AI 生成」按钮）。
 *
 * @param {Object} options
 * @param {() => string} options.getSourceText 取源文本（每次求值，实况跟随输入框）
 * @param {string} options.sourceLabel 源字段名（禁用 title「请先填写<sourceLabel>」）
 * @param {(sourceText: string) => any} options.generate 本地模板生成器（条数内嵌其中）
 * @param {(result: any) => void} options.apply 生成结果回填（组件侧写表单/清红框）
 * @param {() => boolean} [options.isReadonly] 只读/锁定态（真 → 按钮禁用、不给「请先填写」title）
 * @param {number} [options.delayMs] 「生成中…」时长，默认 AI_LIVE_DELAY_MS（测试可传 0）
 * @param {string} [options.idleLabel] 空闲态按钮文案，默认「AI 生成」
 * @returns {{ busy, sourceEmpty, disabled, title, label, run }} 均为 ref/computed + 触发函数
 */
export function useAiLiveGenerate({
  getSourceText,
  sourceLabel,
  generate,
  apply,
  isReadonly = () => false,
  delayMs = AI_LIVE_DELAY_MS,
  idleLabel = 'AI 生成'
}) {
  const busy = ref(false)
  const sourceEmpty = computed(() => !String(getSourceText() || '').trim())
  const disabled = computed(() => busy.value || sourceEmpty.value || !!isReadonly())
  // 原型 syncButton：仅「空且非只读」给引导 title，其余还原按钮原 title（此处即空串）
  const title = computed(() => (sourceEmpty.value && !isReadonly() ? `请先填写${sourceLabel}` : ''))
  const label = computed(() => (busy.value ? AI_LIVE_BUSY_LABEL : idleLabel))

  function run() {
    if (disabled.value) return
    // 源文本取点击那刻的值（原型 liveValue(config.source)）
    const sourceText = String(getSourceText() || '').trim()
    busy.value = true
    setTimeout(() => {
      busy.value = false
      apply(generate(sourceText))
      ElMessage.success(AI_LIVE_DONE_TOAST)
    }, delayMs)
  }

  return { busy, sourceEmpty, disabled, title, label, run }
}
