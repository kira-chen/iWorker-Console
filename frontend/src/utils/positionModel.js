/**
 * 岗位白板工作台 —— 纯逻辑工具（无 Vue / 无 DOM 依赖，便于单测）。
 *
 * 覆盖：采集字段 6 类型常量、中文→英文 key 自动生成、上限/软上限常量、
 * skill.md 工具引用标记解析（:::tool{code=x} / @tool[x] 去重）、占位符提取、
 * 健康状态中文映射、发布前检查计算、整体保存 payload 归一。
 *
 * 这些逻辑是工作台交互的核心（决议 6/13/3/2/8/9），独立成纯函数供组件复用 + 单测断言。
 */

import { BIZ_QUESTION_MAX } from './defValidate'
import { pinyinOf } from './pinyinTable'

/* ============================ 上限 / 软上限（交互规格 §12） ============================ */
export const LIMITS = {
  // 单岗位技能引用上限（硬）：2026-09-09 负责人 Q378 决议单 Agent 由 20 放宽到 100；
  // 2026-11-09 产品优化需求-202611 R1 取消 Agent 后改为每个岗位最多 100 个，
  // 落点为「添加技能」抽屉的勾选区（达上限未勾选项置灰）。api/positionMock.js 直接引用本常量。
  SKILL_MAX: 100,
  INTAKE_MAX: 10, // 采集字段上限（硬）
  TRIGGER_MAX: 10, // 触发词个数上限（硬）
  TRIGGER_SOFT_LEN: 10, // N1：单个触发词字数软上限（软提示，超出不硬拦，客户端匹配以短词为佳）
  SKILL_MD_SOFT: 8000, // skill.md 软上限
  PERSONA_SOFT: 1000, // 岗位人格软上限
  SAMPLE_TASK_MAX: 20 // 单岗位样例定时任务软上限（达 20 置灰新增 + warning，不阻断改删排序）
}

/* ============================ 领用页文案（claimDesc 多条）约束（设计 §3.1 / §4.3） ============================ */
export const CLAIM_ITEM_MAX = 6 // 条数硬上限（达上限禁「+新增」）
export const CLAIM_ITEM_TEXT_SOFT = 80 // 单条净化后纯文本软上限（黄字提示，不阻断）

/* ============================ 采集字段 6 类型（契约 §1.2 type 枚举） ============================ */
export const INTAKE_TYPES = [
  { value: 'text', label: '单行文本', control: 'text' },
  { value: 'textarea', label: '多行文本', control: 'textarea' },
  { value: 'single_select', label: '单选', control: 'select' },
  { value: 'multi_select', label: '多选', control: 'select' },
  { value: 'number', label: '数字', control: 'number' },
  { value: 'date', label: '日期', control: 'date' }
]

const INTAKE_TYPE_VALUES = INTAKE_TYPES.map((t) => t.value)

export function isSelectType(type) {
  return type === 'single_select' || type === 'multi_select'
}

export function isValidIntakeType(type) {
  return INTAKE_TYPE_VALUES.includes(type)
}

/* ============================ 字段名 → 字段 key 建议值（产品优化需求-202611 修改点 5（R10）） ============================ */
// 原先只认约 80 个常用字（PINYIN_MAP），表外的字直接跳过，「分管专业」只剩「ye」。R10 改为完整全拼：
// 汉字查 utils/pinyinTable.js（GB2312 一级常用字 3755 个，离线由 pinyin-pro 生成，demo 不装运行时拼音库）。
// 用法：采集字段抽屉里 key 输入框的占位实时显示本函数结果；保存时 key 留空才取它，之后改字段名不再重新生成。

/**
 * 由字段名生成字段 key 建议值（PRD 生成规则 4 条，示例：分管专业→fenguanzhuanye、user name→user_name）：
 * 1. 汉字转不带声调的全拼，字与字直接连写；多音字取常用读音（行→xing，按字查表，不识别词组）；
 * 2. 英文字母转小写，数字原样保留；
 * 3. 空格、连字符转下划线（下划线本身保留），其他符号去掉；查不到拼音的生僻字按符号处理；
 * 4. 结果以数字开头加前缀 f_，结果为空（如全是符号）用 field。
 * 连续下划线合并为一个、首尾下划线去掉，保证结果符合 ^[a-z][a-z0-9_]*$（isValidKey）。
 * 字段名本身为空时返回空串（抽屉占位回落「auto」）。
 */
export function genKeyFromLabel(label) {
  // NFKC：全角字母 / 数字 / 空格先转半角，「ＩＤ」「１号」与半角同样处理
  const raw = String(label || '').normalize('NFKC').trim()
  if (!raw) return ''
  let out = ''
  for (const ch of raw) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toLowerCase()
    } else if (ch === '_' || ch === '-' || /\s/.test(ch)) {
      out += '_'
    } else {
      out += pinyinOf(ch) // 非汉字、表外生僻字返回空串，即去掉
    }
  }
  out = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!out) return 'field'
  if (/^[0-9]/.test(out)) out = 'f_' + out
  return out
}

// key 合法性：^[a-z][a-z0-9_]*$
export function isValidKey(key) {
  return /^[a-z][a-z0-9_]*$/.test(String(key || ''))
}

/* ============================ 触发词校验（N1：必填 + 软字数提示） ============================ */
// 硬校验：返回错误文案 or null。仅拦「空」「重复」；字数改为软提示（不硬拦，见 triggerSoftHint）。
export function validateTrigger(word, existing = []) {
  const w = String(word || '').trim()
  if (!w) return '触发词不能为空'
  if ((existing || []).includes(w)) return '触发词重复'
  return null
}

// N1 软提示：触发词整组里有超过软上限（10 字）的词 → 返回提示文案；无则空串。
// 软提示不阻断保存，仅提醒「关键词偏长，客户端匹配以短词为佳」。
export function triggerSoftHint(triggers = []) {
  const over = (triggers || []).some((t) => String(t || '').trim().length > LIMITS.TRIGGER_SOFT_LEN)
  return over ? `关键词偏长，建议每个 ${LIMITS.TRIGGER_SOFT_LEN} 字内，客户端匹配以短词为佳` : ''
}

// N1 必填：触发词是否满足「至少 1 个非空白」。用于保存/发布门与必填提示。
export function hasAtLeastOneTrigger(triggers = []) {
  return (triggers || []).some((t) => String(t || '').trim().length > 0)
}

/* ============================ N2 技能示例问题（1 个，必填） ============================ */
// 单条软上限 20 字（软提示"太长客户端会截断"，超出不硬拦，参照 N4 推荐问题口径）。
export const EXAMPLE_QUESTION_SOFT_LEN = 20

// 必填：示例问题是否已填（去空白后非空）。用于保存/发布门与必填提示。
export function hasExampleQuestion(text) {
  return String(text || '').trim().length > 0
}

// 单条软提示：超软上限 → 返回提示文案；否则空串（不硬拦）。
export function exampleQuestionSoftHint(text) {
  return String(text || '').trim().length > EXAMPLE_QUESTION_SOFT_LEN
    ? `建议 ${EXAMPLE_QUESTION_SOFT_LEN} 字内，太长客户端会截断`
    : ''
}

/* ============================ 人格页签必填要素（2026-09-04 PRD-20260903 对齐） ============================ */
// 岗位描述：必填，最多 2000 字（一览表描述类统一规则；2026-09-16 与其余描述类字段对齐）。
export const DESCRIPTION_MAX_LEN = 2000
// 领用页文案（原「岗位认领说明」，2026-09-08 PRD-20260908 md §2.4 改名）：动态文本列表，
// 必填（2026-09-21 负责人拍板：至少 1 条，参与发布阻断；保存不阻断）；最多 6 条、每条 300 字
// （一览表示例类统一规则）。底层字段仍为 claimDescriptions。
export const CLAIM_NOTE_MAX = 6
export const CLAIM_NOTE_LEN = 300
// 示例问题：固定 3 条，每条不超过 300 字（一览表示例类统一规则）。
export const EXAMPLE_Q_COUNT = 3
export const EXAMPLE_Q_MAX_LEN = BIZ_QUESTION_MAX // 示例问题 300 的单一来源在 defValidate.js，各处只引用不另写
// 岗位 SOP：必填，最多 4000 字。
export const SOP_MAX_LEN = 4000
// SOP 简版（产品优化需求-202611 修改点 18）：选填，最多 200 字，给客户端岗位卡片展示；数字员工执行仍按完整版
export const SOP_BRIEF_MAX_LEN = 200
// 自动化任务「提示词」：必填，最多 8000 字（md §7.4）。UI 校验 / 字数计数与 sampleTaskMock 共用这一处，
// 别再各写裸数字（前科：示例问题 mock 卡 60、UI 放 300，见 待办 yuepu#19②）。
export const SAMPLE_TASK_PROMPT_MAX_LEN = 8000

// 归一为固定 3 格数组（不足补空、超出截断），编辑器 3 个输入框稳定绑定用。
export function normalizeExampleQuestions(list) {
  const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
  return [0, 1, 2].map((i) => arr[i] ?? '')
}

// 3 条是否全部填写（去空白后非空）。发布前置校验用。
export function exampleQuestionsComplete(list) {
  return normalizeExampleQuestions(list).every((q) => String(q || '').trim().length > 0)
}

// 归一领用页文案（claimDescriptions）为字符串数组（去 null、截 6 条上限交由交互层控制，这里只清洗类型）。
export function normalizeClaimNotes(list) {
  return Array.isArray(list) ? list.map((s) => (s == null ? '' : String(s))) : []
}

// 领用页文案是否已填（至少 1 条去空白后非空）。发布前置校验用。
export function claimNotesComplete(list) {
  return normalizeClaimNotes(list).some((s) => s.trim().length > 0)
}

// 采集字段有效个数（2026-09-21 负责人拍板：至少 1 个）：字段名去空白后非空才算一个有效字段。
// 保存时 normalizeIntakeForSubmit 本就会丢掉无字段名的行，这里与之同口径。
export function intakeFieldCount(schema) {
  return (Array.isArray(schema) ? schema : []).filter((f) => String(f?.label || '').trim()).length
}

/* ---------- 本地 AI 生成（demo：无后端，纯前端拟真；原型 questionSet / SOP 模板口径） ---------- */
function shortText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(clean)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : clean
}
function limitLen(text, max) {
  const chars = Array.from(String(text || ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/**
 * 基于岗位名称 + 岗位描述本地生成 3 条示例问题（原型 questionSet('position') 模板）。
 * 每条截断到 60 字。描述为空时由调用方禁用入口（title 提示「请先填写岗位描述」）。
 */
export function genExampleQuestions(name, description) {
  const subject = shortText(description || name, 18)
  return [
    limitLen(`这个岗位可以如何协助我完成"${subject}"？`, EXAMPLE_Q_MAX_LEN),
    limitLen(`请围绕"${subject}"分析关键问题并给出建议`, EXAMPLE_Q_MAX_LEN),
    limitLen(`请基于"${subject}"整理一份可执行的工作方案`, EXAMPLE_Q_MAX_LEN)
  ]
}

/**
 * 基于岗位名称 + 岗位描述本地生成编号步骤式岗位 SOP。截断到 4000 字。
 *
 * 2026-09-09 PRD 复核（A18 / Q370，二轮决策选 A）：按《AI生成按钮Prompt规范.md》§3 第 2 条
 * 「覆盖：理解意图 → 选择能力 → 执行任务 → 核对结果 → 输出结论」输出 5 步，
 * 取代旧 4 步模板（旧第 1 步合并了理解意图+确认范围，旧第 4 步合并了核对+输出）。
 */
export function genPositionSop(name, description) {
  const subject = shortText(description || name, 48)
  const sop =
    `1. 理解用户意图，并结合岗位描述"${subject}"确认任务目标与范围。\n` +
    '2. 选择完成任务所需的技能、专家、知识库与工具，必要时向用户补充提问。\n' +
    '3. 按选定能力执行任务，逐步推进并记录关键中间结果。\n' +
    '4. 核对关键结果与数据口径，确认结论可靠、无遗漏。\n' +
    '5. 输出结论、依据和后续建议，交付用户可直接使用的结果。'
  return limitLen(sop, SOP_MAX_LEN)
}

const SOP_BRIEF_MAX_STEPS = 5 // 简版最多 5 步
const SOP_BRIEF_STEP_MAX_LEN = 20 // 每步不超过 20 字

/**
 * 由完整版岗位 SOP 本地生成 SOP 简版（产品优化需求-202611 修改点 18；demo 无后端，真实产品走模型，
 * 提示词见《AI生成按钮Prompt规范.md》）。按 PRD 生成要求：保留编号步骤，3–5 步，每步一句、不超过 20 字，全文不超过 200 字。
 * 本地做法：
 * 1. 拆步骤——有编号 / 列表行就只取这些行（标题、引言不要）；没有就按行拆，只有一段时按句号拆；
 * 2. 去掉「第 N 步：」这类序号前缀，每步只留第一个逗号 / 句号 / 冒号前的主干，再截到 20 字；
 * 3. 超过 5 步时均匀抽 5 步，首尾两步必留（怎么接活、最后交付什么）；不足 3 步的有几步留几步；
 * 4. 重新编号，全文再按 200 字兜底截断。
 */
export function genPositionSopBrief(fullSop) {
  const text = String(fullSop || '').trim()
  const STEP_MARK = /^(\d+\s*[.、．)）]|[-*•])\s*/
  let items = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const marked = items.filter((l) => STEP_MARK.test(l))
  if (marked.length) items = marked
  else if (items.length <= 1) items = text.split(/[。；;]/)
  let steps = items
    .map((l) => l.trim().replace(STEP_MARK, '').replace(/^第\s*\d+\s*步\s*[：:、.．]?\s*/, ''))
    .map((l) => limitLen(l.split(/[，,。；;：:]/)[0].trim(), SOP_BRIEF_STEP_MAX_LEN))
    .filter(Boolean)
  if (steps.length > SOP_BRIEF_MAX_STEPS) {
    const last = steps.length - 1
    steps = Array.from({ length: SOP_BRIEF_MAX_STEPS }, (_, i) => steps[Math.round((i * last) / (SOP_BRIEF_MAX_STEPS - 1))])
  }
  return limitLen(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), SOP_BRIEF_MAX_LEN)
}

/* ============================ 岗位展示版本号（语义化 vX.Y.Z） ============================ */
// 2026-09-02 口径统一：原 N5 的 v001~v999 三位数字格式废止，与列表页版本抽屉 / PRD 版本管理
// （修订/功能/重大三段式）统一为语义化版本号 vX.Y.Z（如 v2.1.0）。
export const VERSION_LABEL_RE = /^v\d+\.\d+\.\d+$/
export const VERSION_LABEL_SAMPLE = '请填语义化版本号，例如 v1.2.0'

// 校验展示版本号格式（严格 ^v主.次.修订$）。返回错误文案 or null。
export function validateVersionLabel(label) {
  const v = String(label || '').trim()
  if (!v) return `版本号必填（${VERSION_LABEL_SAMPLE}）`
  if (!VERSION_LABEL_RE.test(v)) return `版本号格式不对，${VERSION_LABEL_SAMPLE}`
  return null
}

/* ============================ skill.md 工具引用解析（决议 6 / §5.4） ============================ */
// 解析正文中的 :::tool{code=x} 与 @tool[x] 两种标记，去重返回 code 列表 + 每 code 引用次数。
// 与后端 SkillMdToolParser 口径**严格对齐**（CR-P0/P1）：
//  ① code 字符集 [a-z][a-z0-9_]*（小写起头，不放宽到大写/冒号/点——后端不认，放宽会导致左栏统计含后端不收的 code）；
//  ② 解析前先遮罩「代码区」（YAML frontmatter / 围栏代码块 / 行内代码），与后端 CodeRegionMask 一致——
//     避免 FDE 在示例/代码块里写的 @tool[x] 被左栏统计进去而后端白名单不收（三方口径必须一致）。
const TOOL_RE_BLOCK = /:::tool\{\s*code\s*=\s*([a-z][a-z0-9_]*)\s*\}/g
const TOOL_RE_INLINE = /@tool\[([a-z][a-z0-9_]*)\]/g

// 遮罩代码区（同后端 CodeRegionMask 口径）：把 frontmatter / 围栏块 / 行内代码替换为等量空格（保留换行，
// 维持行结构），使其中的工具标记不被统计。仅用于"识别工具引用"前的预处理，不改用户原文。
function maskCodeRegions(md) {
  let s = String(md || '')
  const blank = (m) => m.replace(/[^\n]/g, ' ')
  s = s.replace(/^---\n[\s\S]*?\n---(?=\n|$)/, blank) // 起始 YAML frontmatter
  s = s.replace(/```[\s\S]*?```/g, blank) // ``` 围栏块
  s = s.replace(/~~~[\s\S]*?~~~/g, blank) // ~~~ 围栏块
  s = s.replace(/`[^`\n]*`/g, blank) // 行内代码
  return s
}

export function parseSkillMdTools(md) {
  const text = maskCodeRegions(md)
  const counts = {}
  const order = []
  const collect = (re) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const code = m[1]
      if (!(code in counts)) {
        counts[code] = 0
        order.push(code)
      }
      counts[code] += 1
    }
  }
  collect(TOOL_RE_BLOCK)
  collect(TOOL_RE_INLINE)
  return order.map((code) => ({ code, count: counts[code] }))
}

/**
 * 合并左栏「已引用工具」回显视图（决议 6 / CR-P1）。纯函数，便于单测护栏。
 *
 * 把三处来源合并为左栏渲染所需的行：
 *  - parsedRefs：正文解析出的 [{ code, count }]（顺序即正文出现序，count 为引用次数）；
 *  - refStatusMap：后端 referencedTools 回显 { [code]: { checkStatus, requiresConfirmation, bizName } }；
 *  - localInsertNames：本会话刚插入的 { [code]: bizName } 本地兜底（回显未到时即时显示业务名，消除「先 code 后中文」闪现）。
 *
 * 业务名回落优先级：回显 bizName > 本地插入名 > 空（模板再回落 code）。
 * checkStatus 无回显 → 'UNKNOWN' 占位（优雅降级）；known = code 是否在回显 map 中。
 *
 * 整表收敛（2026-07-08）：FDE 只面对「表」一个概念——正文里的存量操作级引用 table__X__op
 * 按表聚合为一行表级条目（count 合计、codes 记录聚合成员 code，供定位循环遍历 / 移除一次清完），
 * 展示名即表名，不再出现「表名 · 操作」。非数据表 code 原样一行（codes=[code]）。
 *
 * @param {Array<{code:string,count:number}>} parsedRefs
 * @param {Object} refStatusMap
 * @param {Object} localInsertNames
 * @returns {Array<{code,codes,count,checkStatus,requiresConfirmation,bizName,known}>}
 */
export function mergeReferencedView(parsedRefs, refStatusMap, localInsertNames) {
  const refs = Array.isArray(parsedRefs) ? parsedRefs : []
  const statusMap = refStatusMap || {}
  const localMap = localInsertNames || {}
  const rows = []
  const byKey = new Map()
  for (const r of refs) {
    const key = tableLevelCodeOf(r.code) || r.code
    let row = byKey.get(key)
    if (!row) {
      row = { code: key, codes: [], count: 0 }
      byKey.set(key, row)
      rows.push(row)
    }
    row.codes.push(r.code)
    row.count += r.count
  }
  return rows.map((row) => {
    const meta = statusMap[row.code] || statusMap[row.codes[0]] || {}
    return {
      code: row.code,
      codes: row.codes,
      count: row.count,
      checkStatus: meta.checkStatus || 'UNKNOWN',
      requiresConfirmation: !!meta.requiresConfirmation,
      bizName: meta.bizName || localMap[row.code] || '',
      known: row.code in statusMap || row.codes.some((c) => c in statusMap)
    }
  })
}

// 返回某 code 在正文中的引用位置列表（行号 1-based + 该行去首尾空白片段），供「只读定位列表」展示（§5.4）。
export function locateToolRefs(md, code) {
  const text = String(md || '')
  if (!code) return []
  const lines = text.split('\n')
  const out = []
  const needleBlock = `:::tool{code=${code}}`
  lines.forEach((line, i) => {
    // 宽松匹配：忽略 block 标记内空格 + inline @tool[code]
    const blockHit = new RegExp(`:::tool\\{\\s*code\\s*=\\s*${escapeRe(code)}\\s*\\}`).test(line)
    const inlineHit = new RegExp(`@tool\\[${escapeRe(code)}\\]`).test(line)
    if (blockHit || inlineHit) {
      out.push({ line: i + 1, text: line.trim() || needleBlock })
    }
  })
  return out
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 删除正文中某 code 的全部引用标记（§5.4 情形 B「移除全部 N 处」/ 情形 A）。
export function removeToolRefs(md, code) {
  const text = String(md || '')
  if (!code) return text
  const reBlock = new RegExp(`:::tool\\{\\s*code\\s*=\\s*${escapeRe(code)}\\s*\\}`, 'g')
  const reInline = new RegExp(`@tool\\[${escapeRe(code)}\\]`, 'g')
  return text.replace(reBlock, '').replace(reInline, '')
}

/* ============================ 数据表工具 code（工具坞「数据表」Tab · 整表引用） ============================ */
// 现行口径（与后端 TableToolCodec 严格一致）：
//  - 表级引用 code：table__<tableCode>（体部不含 __）——tool-picker / skill.md 插入 / referencedTools 回显
//    统一用此形态，FDE 只面对「表」一个概念；
//  - 操作级 code：table__<tableCode>__<op>（op ∈ create|query|update|delete）——运行时派生 4 个可执行工具，
//    以及存量 skill.md 中按操作插入的旧引用（保存兼容，见 tableToolOpAliases 展示别名）。

const TABLE_OP_ORDER = ['create', 'query', 'update', 'delete']
// 操作级 code 形态正则：op 集合唯一真相是 TABLE_OP_ORDER（tableToolOpAliases 正向、tableLevelCodeOf 逆向共用）。
const TABLE_OP_CODE_RE = new RegExp(`^table__(.+)__(?:${TABLE_OP_ORDER.join('|')})$`)

// 是否为表级整表引用 code：table__<tableCode> 且体部不含 __。
export function isTableLevelToolCode(code) {
  const s = String(code || '')
  if (!s.startsWith('table__')) return false
  const body = s.slice(7)
  return !!body && !body.includes('__')
}

/**
 * 存量操作级 code → 所属表级 code：table__<tableCode>__<op>（op ∈ 4 类）→ table__<tableCode>；
 * 其余（含表级本身/非数据表/空）→ null。已引用视图按此把存量操作级引用聚合归一为表级条目。
 */
export function tableLevelCodeOf(code) {
  const m = TABLE_OP_CODE_RE.exec(String(code || ''))
  // 体部不含 __（与 isTableLevelToolCode 的表级 code 约定一致）
  if (!m || m[1].includes('__')) return null
  return `table__${m[1]}`
}

/**
 * 存量兼容展示别名：由表级回显项（code=table__<tableCode>, bizName=表名）derive 4 个操作级 code 的
 * 展示条目。整表收敛（2026-07-08）：操作概念对 FDE 完全隐藏，展示名一律就是<b>表名</b>
 *（不再是「表名 · 操作」）——旧文档里按操作插入的 chip / 已引用徽标显示的都是表本身；
 * 非表级 code 返回空数组。
 */
export function tableToolOpAliases(code, bizName) {
  if (!isTableLevelToolCode(code)) return []
  const name = bizName || String(code)
  return TABLE_OP_ORDER.map((op) => ({
    code: `${code}__${op}`,
    bizName: name
  }))
}

// 生成一处工具引用标记。已收敛为单一行内形态 @tool[code]（与 Milkdown 编辑器 chip 序列化一致，CR）。
// 注：白板编辑器插入工具现走 SkillMilkdownEditor.insertTool（chip 节点），此函数仅留作非编辑器场景的文本拼接。
export function toolRefMarker(code) {
  return `@tool[${code}]`
}

/* ============================ 占位符 {{intake.key}} 提取（§5.6 软提示） ============================ */
const PLACEHOLDER_RE = /\{\{\s*intake\.([a-zA-Z0-9_]+)\s*\}\}/g

// 返回正文里引用的 intake key 列表（去重）。
export function parseIntakePlaceholders(md) {
  const text = String(md || '')
  PLACEHOLDER_RE.lastIndex = 0
  const set = new Set()
  let m
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) set.add(m[1])
  return [...set]
}

/* ============================ 健康状态四态 → 中文（§5.2） ============================ */
// displayStatus / checkStatus ∈ HEALTHY | UNHEALTHY | UNKNOWN | DISABLED
// 文案对齐 PRD-20260828 连接器（未探测 / 连接正常 / 连接异常）；全站单一真相，MCP/API/知识库同步生效
const HEALTH_MAP = {
  HEALTHY: { label: '连接正常', cls: 'ok' },
  UNHEALTHY: { label: '连接异常', cls: 'bad' },
  DISABLED: { label: '已停用', cls: 'off' },
  UNKNOWN: { label: '未探测', cls: 'unknown' }
}

export function healthLabel(status) {
  return (HEALTH_MAP[status] || HEALTH_MAP.UNKNOWN).label
}

export function healthClass(status) {
  return (HEALTH_MAP[status] || HEALTH_MAP.UNKNOWN).cls
}

/* ============================ 发布告警归一（切片3a，契约 §1.6.1 + §0 软提示） ============================ */
// 发布响应 data.warnings:[{type,message,detail}]（不阻断）。前端把告警归一为可读条目，
// 并单列「引用异常工具」类（type=unhealthy_tool）供发布结果提示突出展示受影响工具。
const WARN_TYPE_LABEL = {
  unhealthy_tool: '引用了异常工具',
  disabled_tool: '引用了已停用工具',
  missing_tool: '引用了不存在的工具',
  intake_placeholder: '占位符无对应采集字段',
  soft_limit: '内容超过软上限'
}

/**
 * 归一发布告警列表为展示条目。
 * @param {Array} warnings 后端 data.warnings
 * @returns {{ items:Array<{type,label,message,detail}>, unhealthy:Array, count:number }}
 *   items：全部告警的展示条目；unhealthy：仅 type=unhealthy_tool 的条目（发布结果突出展示）。
 */
export function normalizePublishWarnings(warnings) {
  const list = Array.isArray(warnings) ? warnings : []
  const items = list.map((w) => ({
    type: w?.type || '',
    label: WARN_TYPE_LABEL[w?.type] || '提示',
    message: w?.message || '',
    detail: w?.detail || ''
  }))
  return {
    items,
    unhealthy: items.filter((i) => i.type === 'unhealthy_tool'),
    count: items.length
  }
}

/* ============================ 升级类型（md §3.7 · 原型 positionPublishHtml L1224） ============================ */
// 更新类型词 + hint（原型 positionBumpHint），顺序照原型：修复更新 / 功能更新 / 重大更新。
// 列表页版本管理侧栏（AdminPositions bumpOptions）与详情页发布前检查弹窗共用同一份。
export const POSITION_BUMP_OPTIONS = [
  { value: 'NONE', label: '修复更新', hint: '修复问题或小幅配置调整' }, // md §3.7 逐字（Patch）
  { value: 'MINOR', label: '功能更新', hint: '新增岗位能力或岗位技能' },
  { value: 'MAJOR', label: '重大更新', hint: '岗位职责或流程发生不兼容变更' }
]

/* ============================ 完整性校验（md §9.1，2026-09-09 Q11 新决策） ============================ */
/**
 * md §9.1 第 8 条（产品优化需求-202611 R1 改后）：岗位至少引用 1 个技能。
 * 悬空引用（skillRefVO 标 deleted:true，技能本体已被删除）不算数——否则技能被删后发布门仍放行
 * （2026-09-23 待办 yuepu#9⑤）。
 */
export function skillsRefOk(skills) {
  return Array.isArray(skills) && skills.some((s) => !s?.deleted)
}

/**
 * 引用的专家 / 专家团里不可用的对象（产品优化需求-202611 R13 §3）：每条是发布前检查里的一行动态阻断项。
 * - 专家 / 团未发布、已停用、已回收 → 「引用的「名称」已停用（已被回收），请移除后再发布」；
 * - 团缺员 → 「专家团「名称」缺员 N 人，请移除后再发布」；
 * - 团里的岗位私有成员没加入本岗位 → 「专家团「团名」的成员「专家名」没有加入本岗位，该岗位员工将无法使用，请添加或调整」。
 * - 自动化任务的执行对象不能用了（2026-11-09 执行对象放开到通用、市场专家（团）后，它们不在页签里，单列一类）→
 *   「自动化任务「任务名」的执行对象「名称」已不可用（停用、回收或缺员），请重新选择」（没设主理人不算不可用，R13-6）。
 * 入参是 getPositionExperts 回的 experts[] / teams[] / execTargetIssues[]（unavailable / missingCount / unboundMembers 由数据层算好）。
 */
export function positionExpertIssues(experts, teams, execTargetIssues) {
  const out = []
  const unavailableText = (reason) => (reason === '已回收' ? '已被回收' : reason)
  for (const x of Array.isArray(experts) ? experts : []) {
    if (x?.unavailable) out.push({ name: x.name, detail: '引用的「' + x.name + '」' + unavailableText(x.unavailable) + '，请移除后再发布' })
  }
  for (const t of Array.isArray(teams) ? teams : []) {
    if (t?.unavailable) {
      out.push({ name: t.name, detail: '引用的「' + t.name + '」' + unavailableText(t.unavailable) + '，请移除后再发布' })
      continue
    }
    if (t?.missingCount > 0) out.push({ name: t.name, detail: '专家团「' + t.name + '」缺员 ' + t.missingCount + ' 人，请移除后再发布' })
    for (const m of t?.unboundMembers || []) {
      out.push({ name: t.name, detail: '专家团「' + t.name + '」的成员「' + m.name + '」没有加入本岗位，该岗位员工将无法使用，请添加或调整' })
    }
  }
  for (const s of Array.isArray(execTargetIssues) ? execTargetIssues : []) {
    out.push({
      name: s.targetName,
      label: '自动化任务「' + s.taskName + '」',
      detail: '自动化任务「' + s.taskName + '」的执行对象「' + s.targetName + '」已不可用（停用、回收或缺员），请重新选择'
    })
  }
  return out
}

/**
 * 专家 / 专家团停用、强制回收确认窗口的影响范围（产品优化需求-202611 R13 §5）。
 * 入参是 getExpertUsage 回的 { positionCount, taskCount }；都为 0 返回空串（窗口里不出这句）。
 */
export function expertUsageImpactText({ positionCount = 0, taskCount = 0 } = {}) {
  const parts = []
  if (positionCount > 0) parts.push('已被 ' + positionCount + ' 个岗位引用，这些岗位再发布前要先移除它')
  if (taskCount > 0) parts.push(taskCount + ' 条自动化任务由它执行，停用后这些任务将被挂起')
  return parts.length ? parts.join('；') + '。' : ''
}

/**
 * md §9.1 完整性校验 9 项（2026-09-21 负责人拍板新增「岗位图标」「领用页文案」「采集字段」）：返回未完成项的文案数组（按 md 列举顺序）。
 * 【保存】与【发布岗位】共用同一份口径：
 * - 【发布岗位】：数组非空即阻断（toast「请先填写：…」+ 定位到第一个缺失项所在页签）；
 * - 【保存】：数组非空不阻断，仅在页面顶部提示条列出（md §9.1 末段）。
 *
 * 入参同 computePublishCheck 的 detail（store.checkInput）。
 * 每项附 tab 字段，供调用方按 md「自动定位到第一个缺失项所在页签」跳转。
 */
export const COMPLETENESS_ITEMS = [
  { key: 'name', label: '岗位名称', tab: 'persona' },
  { key: 'icon', label: '岗位图标', tab: 'persona' },
  { key: 'description', label: '岗位描述', tab: 'persona' },
  { key: 'claimDescriptions', label: '领用页文案', tab: 'persona' },
  { key: 'exampleQuestions', label: '3 条示例问题', tab: 'persona' },
  { key: 'positionSop', label: '岗位 SOP', tab: 'persona' },
  { key: 'intakeSchema', label: '采集字段', tab: 'intake' },
  { key: 'skills', label: '技能', tab: 'skills' },
  // tab 标识 `tasks` 照 md §1.3 L160（2026-09-12 审计 J8③；key 为完整性内部键不随之改）
  { key: 'sampleTasks', label: '自动化任务', tab: 'tasks' }
]

export function computeCompletenessMissing(detail) {
  const d = detail || {}
  const okMap = {
    name: !!String(d.name || '').trim(),
    icon: !!String(d.icon || '').trim(),
    description: !!String(d.description || '').trim(),
    claimDescriptions: claimNotesComplete(d.claimDescriptions),
    exampleQuestions: exampleQuestionsComplete(d.exampleQuestions),
    positionSop: !!String(d.positionSop || '').trim(),
    intakeSchema: intakeFieldCount(d.intakeSchema) > 0,
    skills: skillsRefOk(d.skills),
    sampleTasks: Number(d.sampleTaskCount || 0) > 0
  }
  return COMPLETENESS_ITEMS.filter((i) => !okMap[i.key])
}

/* ============================ 发布前检查（md §9.2 · 原型 openPub L2132） ============================ */
/**
 * 计算发布前检查清单 + 完成度。输入岗位详情
 * （name/description/exampleQuestions/positionSop + skills[] + experts[] / teams[] + sampleTaskCount）。
 * 返回 { items:[{ key,label,ok,blocking,warning,detail }], blockingPassed, doneRatio, warnings }
 *
 * 2026-09-09 PRD 复核（A1 / Q11 负责人新决策，推翻 2026-09-08 的「阻断四项」口径）：
 * md §9.1 阻断 6 项 = 岗位名称 / 岗位描述 / 示例问题 3 条 / 岗位 SOP /
 * 技能（R1 改后：至少引用 1 个技能）/ 自动化任务（至少 1 条）。
 * 2026-09-21 负责人拍板追加：岗位图标（已选择）、领用页文案（至少 1 条）、采集字段（至少 1 个）→ 共 9 项。
 * 清单条目对应 md §9.2：
 * - 岗位名称与描述（硬）——「必填内容已填写」；
 * - 岗位图标（硬，2026-09-21 新增）——已选择图标；
 * - 领用页文案（硬，2026-09-21 新增）——至少 1 条；
 * - 示例问题（硬）——「3 条示例问题已填写」；
 * - 岗位 SOP（硬）——「岗位能力综述已填写」；
 * - 采集字段（硬，2026-09-21 新增）——至少 1 个有效字段（原「采集字段不参与发布阻断」已被推翻）；
 * - 技能（硬，md §6.5；R1 改后）——至少引用 1 个技能；
 *   未验证工具降级为该条目上的附注（不影响 ok），仍计入 warnings 供弹窗提示行使用；
 * - 自动化任务（硬，md §7.6）——至少 1 条。
 * warnings 仅在确有告警（未验证工具）时非空，供弹窗提示行「存在告警项（不阻断）…」判定。
 */
export function computePublishCheck(detail) {
  const d = detail || {}
  const unhealthyTools = Array.isArray(d.unhealthyTools) ? d.unhealthyTools : []
  const eqComplete = exampleQuestionsComplete(d.exampleQuestions)
  const nameOk = !!String(d.name || '').trim()
  const descOk = !!String(d.description || '').trim()
  const iconOk = !!String(d.icon || '').trim()
  const claimOk = claimNotesComplete(d.claimDescriptions)
  const sopOk = !!String(d.positionSop || '').trim()
  const intakeCount = intakeFieldCount(d.intakeSchema)
  const intakeOk = intakeCount > 0
  const skillsOk = skillsRefOk(d.skills)
  const taskCount = Number(d.sampleTaskCount || 0)
  const tasksOk = taskCount > 0

  const items = []

  // 1. 岗位名称与描述（硬）
  items.push({
    key: 'name',
    label: '岗位名称',
    ok: nameOk && descOk,
    blocking: true,
    detail: nameOk && descOk ? `已填写"${String(d.name).trim()}"` : `请先填写：${[!nameOk && '岗位名称', !descOk && '岗位描述'].filter(Boolean).join('、')}`
  })

  // 2. 岗位图标（硬，2026-09-21 负责人拍板：必填）
  items.push({
    key: 'icon',
    label: '岗位图标',
    ok: iconOk,
    blocking: true,
    detail: iconOk ? '已选择' : '请先选择岗位图标'
  })

  // 3. 领用页文案（硬，2026-09-21 负责人拍板：至少 1 条）
  items.push({
    key: 'claimDescriptions',
    label: '领用页文案',
    ok: claimOk,
    blocking: true,
    detail: claimOk ? '已填写' : '请先填写领用页文案（至少 1 条）'
  })

  // 4. 示例问题 3 条（硬）
  items.push({
    key: 'exampleQuestions',
    label: '示例问题',
    ok: eqComplete,
    blocking: true,
    detail: eqComplete ? '3 个引导问题已填写' : '示例问题固定 3 条，需全部填写才能发布'
  })

  // 5. 岗位 SOP（硬）
  items.push({
    key: 'sop',
    label: '岗位 SOP',
    ok: sopOk,
    blocking: true,
    detail: sopOk ? '岗位能力综述已填写' : '请先填写岗位 SOP'
  })

  // 6. 采集字段（硬，2026-09-21 负责人拍板：至少 1 个）
  items.push({
    key: 'intakeSchema',
    label: '采集字段',
    ok: intakeOk,
    blocking: true,
    detail: intakeOk ? `已配置 ${intakeCount} 个` : '至少配置 1 个采集字段'
  })

  // 7. 技能（硬，md §6.5 / §9.1 第 8 条；产品优化需求-202611 R1 改为「至少引用 1 个技能」）
  const hasUnhealthy = unhealthyTools.length > 0
  items.push({
    key: 'skills',
    label: '技能',
    ok: skillsOk,
    blocking: true,
    warning: hasUnhealthy,
    // 仅确有未验证工具时计入 warnings（弹窗据此出「存在告警项」提示行）
    actionable: hasUnhealthy,
    detail: skillsOk
      ? hasUnhealthy
        ? `存在 ${unhealthyTools.length} 个工具未验证，不阻断发布`
        : '已引用技能'
      : '至少引用 1 个技能'
  })

  // 7.1 引用已被强制回收的技能 / 连接器（硬，岗位 PRD §6.4 / §8「被强制回收」）：每个已回收对象一行；
  // 没有已回收对象时不出行（不改变原有清单条数与完成度口径）。连接器名由调用方传入 revokedConnectors。
  const revokedNames = [
    ...(Array.isArray(d.skills) ? d.skills : []).filter((s) => s?.revoked).map((s) => s.name),
    ...(Array.isArray(d.revokedConnectors) ? d.revokedConnectors : [])
  ]
  revokedNames.forEach((name, i) => {
    items.push({
      key: 'revokedRef_' + i,
      label: '引用「' + name + '」',
      ok: false,
      blocking: true,
      detail: '引用的「' + name + '」已被回收，请移除后再发布'
    })
  })

  // 7.2 引用的专家 / 专家团不可用（硬，产品优化需求-202611 R13 §3）：每个问题一行；没有问题时不出行
  positionExpertIssues(d.experts, d.teams, d.execTargetIssues).forEach((issue, i) => {
    items.push({
      key: 'expertRef_' + i,
      label: issue.label || '引用「' + issue.name + '」',
      ok: false,
      blocking: true,
      detail: issue.detail
    })
  })

  // 8. 自动化任务（硬，md §7.6 / §9.1 第 9 条）
  items.push({
    key: 'sampleTasks',
    label: '自动化任务',
    ok: tasksOk,
    blocking: true,
    detail: tasksOk ? `已配置 ${taskCount} 条自动化任务` : '至少配置 1 条自动化任务'
  })

  const blockingItems = items.filter((i) => i.blocking)
  const blockingPassed = blockingItems.every((i) => i.ok)
  const passedCount = blockingItems.filter((i) => i.ok).length
  const doneRatio = blockingItems.length ? passedCount / blockingItems.length : 1
  const warnings = items.filter((i) => i.warning && i.actionable)

  return { items, blockingPassed, doneRatio, warnings }
}

/* ============================ 整体保存 payload 归一（决议 9：调序/迁移走整体 PUT） ============================ */
// 工作台对技能 / 专家引用的增删走各自 REST 接口（见 store）。
// 此处提供「采集 schema 归一」：把行编辑器的字段行转成契约 intakeSchema 项。
export function normalizeIntakeForSubmit(rows) {
  return (rows || [])
    .filter((r) => String(r.label || '').trim())
    .map((r, idx) => {
      const item = {
        key: (r.key || '').trim() || genKeyFromLabel(r.label),
        label: String(r.label).trim(),
        type: isValidIntakeType(r.type) ? r.type : 'text',
        required: !!r.required,
        sortOrder: idx
      }
      if (isSelectType(item.type)) item.options = (r.options || []).filter((o) => String(o).trim())
      if (r.placeholder) item.placeholder = String(r.placeholder).trim()
      if (r.defaultValue !== null && r.defaultValue !== undefined && r.defaultValue !== '') {
        item.defaultValue = r.defaultValue
      }
      if (r.desc) item.desc = String(r.desc).trim()
      return item
    })
}

// 前端轻校验采集字段行：key 合法/唯一、单多选有选项；返回 { ok, errors:{[idx]:{key:msg}} }
export function validateIntakeRows(rows) {
  const list = rows || []
  const errors = {}
  let ok = true
  const setErr = (idx, key, msg) => {
    if (!errors[idx]) errors[idx] = {}
    errors[idx][key] = msg
    ok = false
  }
  // key 唯一性（用显示出来或自动生成的 key）
  const effectiveKey = (r) => (r.key || '').trim() || genKeyFromLabel(r.label)
  const keyCount = {}
  list.forEach((r) => {
    if (!String(r.label || '').trim()) return
    const k = effectiveKey(r)
    if (k) keyCount[k] = (keyCount[k] || 0) + 1
  })
  list.forEach((r, idx) => {
    if (!String(r.label || '').trim()) {
      setErr(idx, 'label', '显示名必填')
      return
    }
    const userKey = (r.key || '').trim()
    if (userKey && !isValidKey(userKey)) {
      setErr(idx, 'key', '小写字母开头，仅小写字母/数字/下划线')
    } else if (keyCount[effectiveKey(r)] > 1) {
      setErr(idx, 'key', `字段 key 重复：${effectiveKey(r)}`)
    }
    if (isSelectType(r.type) && !(Array.isArray(r.options) && r.options.filter((o) => String(o).trim()).length)) {
      setErr(idx, 'options', '单选/多选需至少 1 个选项')
    }
  })
  return { ok, errors }
}
