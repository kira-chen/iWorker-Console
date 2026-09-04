/**
 * 岗位白板工作台 —— 纯逻辑工具（无 Vue / 无 DOM 依赖，便于单测）。
 *
 * 覆盖：采集字段 6 类型常量、中文→英文 key 自动生成、上限/软上限常量、
 * skill.md 工具引用标记解析（:::tool{code=x} / @tool[x] 去重）、占位符提取、
 * 健康状态中文映射、发布前检查计算、整体保存 payload 归一。
 *
 * 这些逻辑是工作台交互的核心（决议 6/13/3/2/8/9），独立成纯函数供组件复用 + 单测断言。
 */

/* ============================ 上限 / 软上限（交互规格 §12） ============================ */
export const LIMITS = {
  AGENT_MAX: 20, // 单岗位 Agent 上限（硬）
  SKILL_MAX: 20, // 单 Agent 技能上限（硬）
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

/* ============================ 中文 → 英文 key 自动生成（决议：采集 key 自动生成折叠） ============================ */
// 极简拼音首段映射：覆盖常见业务字段中文，命中即拼接；未命中字符回退为 'f'。
// 不引入重型 pinyin 依赖（约束：不擅自新增技术栈）；仅做「建议值」，FDE 可在展开 key 列手改。
const PINYIN_MAP = {
  负: 'fu', 责: 'ze', 区: 'qu', 域: 'yu', 行: 'hang', 业: 'ye', 客: 'ke', 户: 'hu',
  姓: 'xing', 名: 'ming', 部: 'bu', 门: 'men', 电: 'dian', 话: 'hua', 地: 'di', 址: 'zhi',
  金: 'jin', 额: 'e', 日: 'ri', 期: 'qi', 时: 'shi', 间: 'jian', 类: 'lei', 型: 'xing',
  状: 'zhuang', 态: 'tai', 备: 'bei', 注: 'zhu', 联: 'lian', 系: 'xi', 人: 'ren', 公: 'gong',
  司: 'si', 编: 'bian', 号: 'hao', 等: 'deng', 级: 'ji', 数: 'shu', 量: 'liang', 单: 'dan',
  价: 'jia', 总: 'zong', 项: 'xiang', 目: 'mu', 标: 'biao', 题: 'ti', 内: 'nei', 容: 'rong',
  来: 'lai', 源: 'yuan', 渠: 'qu', 道: 'dao', 优: 'you', 先: 'xian', 城: 'cheng', 市: 'shi',
  省: 'sheng', 国: 'guo', 家: 'jia', 产: 'chan', 品: 'pin', 价格: 'price'
}

/**
 * 由中文显示名生成英文字段 key 建议值。
 * - ASCII（字母/数字/下划线）原样保留并小写；
 * - 中文按 PINYIN_MAP 逐字转拼音段；未命中的字符跳过；
 * - 结果须符合 ^[a-z][a-z0-9_]*$：非字母开头补前缀 f_；空串兜底 field。
 */
export function genKeyFromLabel(label) {
  const raw = String(label || '').trim()
  if (!raw) return ''
  let out = ''
  for (const ch of raw) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toLowerCase()
    } else if (ch === '_' || ch === ' ' || ch === '-') {
      out += '_'
    } else if (PINYIN_MAP[ch]) {
      out += (out && !out.endsWith('_') ? '' : '') + PINYIN_MAP[ch]
    }
    // 未命中的中文/符号：跳过
  }
  out = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!out) return 'field'
  if (!/^[a-z]/.test(out)) out = 'f_' + out
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

/* ============================ N4 岗位推荐问题（固定 4 个，必填，不许增删） ============================ */
// 单条硬上限 30 字（输入框 maxlength 直接拦 + 字数计数，替代原 20 字软提示口径）。
export const RECOMMENDED_Q_COUNT = 4
export const RECOMMENDED_Q_MAX_LEN = 30

// 归一为固定 4 格数组（不足补空、超出截断）。编辑器 4 个输入框稳定绑定用。
export function normalizeRecommendedQuestions(list) {
  const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
  return [0, 1, 2, 3].map((i) => arr[i] ?? '')
}

// 4 格是否全部填写（去空白后非空）→ 满足必填。用于发布门与"是否可随保存下发"判定。
export function recommendedQuestionsComplete(list) {
  const arr = normalizeRecommendedQuestions(list)
  return arr.every((q) => String(q || '').trim().length > 0)
}

// 校验 4 格：返回 { ok, errors:[bool×4] }（errors[i]=true 表示第 i 格未填）。
export function validateRecommendedQuestions(list) {
  const arr = normalizeRecommendedQuestions(list)
  const errors = arr.map((q) => String(q || '').trim().length === 0)
  return { ok: errors.every((e) => !e), errors }
}

/* ============================ 人格页签必填要素（2026-09-04 PRD-20260903 对齐） ============================ */
// 岗位描述：必填，最多 500 字（新建弹窗 / 人格页签 / mock 校验三处同口径）。
export const DESCRIPTION_MAX_LEN = 500
// 岗位认领说明：动态列表，至少 1 条为发布必填项、最多 6 条、每条 100 字。
export const CLAIM_NOTE_MAX = 6
export const CLAIM_NOTE_LEN = 100
// 示例问题：固定 3 条，每条不超过 60 字（原 N4「推荐问题 4 条」口径由本组替代）。
export const EXAMPLE_Q_COUNT = 3
export const EXAMPLE_Q_MAX_LEN = 60
// 岗位 SOP：必填，最多 4000 字。
export const SOP_MAX_LEN = 4000

// 归一为固定 3 格数组（不足补空、超出截断），编辑器 3 个输入框稳定绑定用。
export function normalizeExampleQuestions(list) {
  const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
  return [0, 1, 2].map((i) => arr[i] ?? '')
}

// 3 条是否全部填写（去空白后非空）。发布前置校验用。
export function exampleQuestionsComplete(list) {
  return normalizeExampleQuestions(list).every((q) => String(q || '').trim().length > 0)
}

// 归一岗位认领说明为字符串数组（去 null、截 6 条上限交由交互层控制，这里只清洗类型）。
export function normalizeClaimNotes(list) {
  return Array.isArray(list) ? list.map((s) => (s == null ? '' : String(s))) : []
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
 * 基于岗位名称 + 岗位描述本地生成编号步骤式岗位 SOP（原型 sop 模板）。截断到 4000 字。
 */
export function genPositionSop(name, description) {
  const subject = shortText(description || name, 48)
  const sop =
    `1. 理解用户目标，并结合岗位描述"${subject}"确认任务范围。\n` +
    '2. 收集完成任务所需的信息，必要时向用户补充提问。\n' +
    '3. 选择合适的 Agent、技能、知识库与工具执行任务。\n' +
    '4. 核对关键结果与数据口径，输出结论、依据和后续建议。'
  return limitLen(sop, SOP_MAX_LEN)
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

// 语义化版本三段数值化（供比较）；非法返回 null。
function semverTriple(label) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(label || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// 建议是否递增：填的号 ≤ 历史最大号 → 软提示（不阻断）。both 为 vX.Y.Z 字符串；缺失历史返回空串。
export function versionIncrementHint(label, prevMaxLabel) {
  const cur = semverTriple(label)
  const prev = semverTriple(prevMaxLabel)
  if (!cur || !prev) return ''
  const cmp = cur[0] - prev[0] || cur[1] - prev[1] || cur[2] - prev[2]
  return cmp <= 0 ? `建议版本号递增（历史最大 ${prevMaxLabel}），当前 ${label} 未递增` : ''
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

/* ============================ 发布前检查（§6.2） ============================ */
/**
 * 计算发布前检查清单 + 完成度。输入岗位详情（name/intro + agents[]）。
 * 返回 { items:[{ key,label,ok,blocking,warning,detail }], blockingPassed, doneRatio, warnings }
 *
 * 规则：
 * - 岗位名必填（硬阻断）；
 * - ≥1 Agent 且每个 Agent ≥1 技能（硬阻断，§6.2 / 契约 1003）；
 * - 采集字段定义完整：单/多选须有选项（硬阻断，避免领用页空选项）；
 * - 引用 UNHEALTHY 工具 → warning（不阻断，调用方按 referencedTools 传入 unhealthyTools 列表）。
 *   （收纳区退役：原「未绑定 Agent 技能 warning」已删除——游离技能不再属任何岗位。）
 */
export function computePublishCheck(detail) {
  const d = detail || {}
  const agents = Array.isArray(d.agents) ? d.agents : []
  const intake = Array.isArray(d.intakeSchema) ? d.intakeSchema : []
  const unhealthyTools = Array.isArray(d.unhealthyTools) ? d.unhealthyTools : []
  // 2026-09-04 PRD-20260903 对齐：原 N4「推荐问题 4 条」改为「示例问题 3 条」。
  const eqComplete = exampleQuestionsComplete(d.exampleQuestions)

  const items = []

  // 1. 岗位名（硬）
  items.push({
    key: 'name',
    label: '岗位名称已填写',
    ok: !!String(d.name || '').trim(),
    blocking: true
  })

  // 2. ≥1 Agent 且每 Agent ≥1 技能（硬）
  const skillCountOf = (a) => (Array.isArray(a.skills) ? a.skills.length : a.skillCount || 0)
  const hasAgent = agents.length > 0
  const everyAgentHasSkill = hasAgent && agents.every((a) => skillCountOf(a) > 0)
  const emptyAgents = agents.filter((a) => skillCountOf(a) === 0).map((a) => a.name)
  items.push({
    key: 'agents',
    label: '至少 1 个 Agent，且每个 Agent 含 ≥1 技能',
    ok: everyAgentHasSkill,
    blocking: true,
    detail: emptyAgents.length ? `空 Agent：${emptyAgents.join('、')}` : ''
  })

  // 3. 采集字段完整（单/多选有选项）（硬）
  const badIntake = intake.filter(
    (f) => isSelectType(f.type) && !(Array.isArray(f.options) && f.options.length)
  )
  items.push({
    key: 'intake',
    label: '采集字段定义完整（单/多选有选项）',
    ok: badIntake.length === 0,
    blocking: true,
    detail: badIntake.length ? `缺选项：${badIntake.map((f) => f.label || f.key).join('、')}` : ''
  })

  // 4. 示例问题 3 条必填（硬，2026-09-04 PRD-20260903 对齐：替代原 N4 推荐问题 4 条口径）。
  items.push({
    key: 'exampleQuestions',
    label: '3 条示例问题已填写',
    ok: eqComplete,
    blocking: true,
    detail: eqComplete ? '' : '示例问题固定 3 条，需全部填写才能发布'
  })

  // 5. 引用 UNHEALTHY 工具 → warning
  //（收纳区退役：原「未绑定 Agent 技能 → warning」已删除——删 Agent 后技能彻底脱离岗位，不再是本岗位资产，
  // 岗位发布检查不应再提它们。）
  if (unhealthyTools.length) {
    items.push({
      key: 'unhealthy',
      label: `${unhealthyTools.length} 个被引用工具当前异常`,
      ok: false,
      blocking: false,
      warning: true,
      detail: `异常工具：${unhealthyTools.join('、')}（运行时可能降级）`
    })
  }

  const blockingItems = items.filter((i) => i.blocking)
  const blockingPassed = blockingItems.every((i) => i.ok)
  const passedCount = blockingItems.filter((i) => i.ok).length
  const doneRatio = blockingItems.length ? passedCount / blockingItems.length : 1
  const warnings = items.filter((i) => i.warning)

  return { items, blockingPassed, doneRatio, warnings }
}

/* ============================ 整体保存 payload 归一（决议 9：调序/迁移走整体 PUT） ============================ */
// 把白板当前结构归一为后端可接受的 agents/skills 顺序。本期工作台对 Agent/技能的增删改
// 走各自 REST 接口（POST/PUT/DELETE），调序与归属变更通过逐条 PUT 提交（见 store）。
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
