/**
 * 知识库模块的枚举与展示口径单一真相源。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》+ 交互原型（知识库最终覆写态）对齐重排：
 * - 列表操作矩阵 / 四类确认弹窗文案（§三.4.3，逐字照 md）收敛为 KB_ACTION_CONFIRMS；
 * - 发布完整校验 5 条（§三.6）收敛为 publishBlockReason；
 * - 上传预处理项 / 检索方式 / 解析状态等文案按 md §五 更新；
 * - 检索阈值不再在管理端设置（md §五.1），UPLOAD_DEFAULTS 移除 threshold。
 * 2026-09-07 按 PRD-20260904 md §六 / §七 重排 API / MCP 数据源配置：
 * - API 鉴权改 NONE/API_KEY(多参数表)/BEARER；请求/响应映射改结构化行（预设行不可删）；
 * - MCP 删除「引用现有 MCP」模式，仅直接填写（transport=streamable-http/stdio），检索工具多选 config.tools。
 * 2026-09-08 按 PRD-20260908 md §六.2 / §七 回齐：
 * - MCP 数据源不再有请求 / 响应映射（md §七 删除两节；映射仅 API 数据源持有）；
 * - API 请求参数映射递归嵌套细化：新建默认三级示例组 mkRequestMapExampleRows、object/array 至少一个有效子字段校验。
 * 2026-09-18 推翻 09-08 决议，MCP 数据源重新加回两项映射，并顺带把 API 响应字段映射也改成同一套机制
 * （md §六.3 / §七.5，两者字段结构完全一致，仅预设字段与必填项不同）：
 * - 请求参数映射复用 mkRequestMapRows / validateRequestMap（预设 query/topK，API/MCP 完全一致，不单独建函数）；
 * - 响应字段映射改为显式改名：参数名=平台标准字段固定，另有可编辑的「接口返回字段名」（sourceField）列，
 *   按工具/接口实际返回的字段名填写（此前 API 侧「不做改名映射」的口径随之废止）；
 *   mkResponsePresetRows 统一生产预设行，API 预设 content/source/score（sourceField 默认与参数名同名，
 *   延续改造前行为）、MCP 预设 title/content/sourceName（sourceField 默认留空，由管理员按工具实际返回填写）；
 *   validateResponseMap 收口两者校验，MCP 侧另经 validateMcpResponseMap 多校验一个「结果数组路径」必填字段
 *   （工具返回结构无统一形状，需 JSONPath 定位结果数组，API 无此概念）。
 *
 * 状态三态：status ∈ DRAFT / PENDING_REVIEW / PUBLISHED；待发布与待停用由
 * pendingAction（PUBLISH / DELIST）标记，列表统一展示「审核中」（md §八.1），
 * 故 stateMeta 以 pendingAction 优先判定。
 */

/* ---------------- 类型（建后不可改）与可见范围派生 ---------------- */
export const KB_TYPE_OPTIONS = [
  { value: 'ENTERPRISE', label: '企业' },
  { value: 'EXPERT', label: '专家' },
  { value: 'POSITION', label: '岗位' }
]
export const KB_TYPE_LABELS = KB_TYPE_OPTIONS.reduce((acc, o) => ((acc[o.value] = o.label), acc), {})
/** 列表筛选用全称（md §三.1：全部、企业知识库、专家知识库、岗位知识库）。 */
export const KB_TYPE_FILTER_OPTIONS = [
  { value: 'ENTERPRISE', label: '企业知识库' },
  { value: 'EXPERT', label: '专家知识库' },
  { value: 'POSITION', label: '岗位知识库' }
]

/** 可见范围文案：企业=全员；专家/岗位=「专家：X」「岗位：X」，未选则「未指定」。 */
export function scopeText(row) {
  if (!row) return '—'
  if (row.kbType === 'ENTERPRISE') return '全员'
  const prefix = row.kbType === 'EXPERT' ? '专家' : row.kbType === 'POSITION' ? '岗位' : ''
  if (!prefix) return '—'
  return `${prefix}：${row.scopeRefName || '未指定'}`
}

/* ---------------- 数据源 ----------------
 * 数据源是独立一等对象（「数据源管理」子页建 / 配 / 删，带 ENABLED / DISABLED 启停位）；
 * 知识库只引用（sourceIds），每类上限 5（md §三.3.2）。
 * 知识库 VO 的 sources 为解析后的引用（含 status / verifyStatus / docCount）。 */
export const SOURCE_TYPES = ['UPLOAD', 'API', 'MCP']
export const SOURCE_LABELS = { UPLOAD: '上传', API: 'API', MCP: 'MCP' }
export const MAX_SOURCES_PER_TYPE = 5
export const SOURCE_STATUS_META = {
  ENABLED: { label: '启用', type: 'success' },
  DISABLED: { label: '停用', type: 'info' }
}

/** 某类下引用的数据源列表。 */
export function sourcesOf(row, type) {
  return (row?.sources || []).filter((s) => s.sourceType === type)
}
/** 某类下引用且处于启用态的数据源。 */
export function enabledSourcesOf(row, type) {
  return sourcesOf(row, type).filter((s) => s.status !== 'DISABLED')
}

/** 列表「数据源」列（md §三.2）：按已启用类型汇总「上传 ×N / API ×N / MCP ×N」；无引用返回空串。 */
export function sourcesText(row) {
  return SOURCE_TYPES.map((t) => {
    const n = enabledSourcesOf(row, t).length
    return n ? `${SOURCE_LABELS[t]} ×${n}` : ''
  })
    .filter(Boolean)
    .join(' / ')
}

/** 是否引用了「上传」数据源——文档数只对引用上传源的库展示（md §三.2），没有则显示 —。 */
export function hasUploadSource(row) {
  return sourcesOf(row, 'UPLOAD').length > 0
}

/* ---------------- 上传数据源配置（md §五） ---------------- */
export const DOC_KIND_OPTIONS = [
  { value: 'DOC', label: '文档' },
  { value: 'TABLE', label: '表格' },
  { value: 'FAQ', label: 'FAQ' }
]
export const DOC_KIND_LABELS = DOC_KIND_OPTIONS.reduce((acc, o) => ((acc[o.value] = o.label), acc), {})
/**
 * 文本预处理可选项（md §五.1；系统已默认删除目录、页眉页脚、水印）。
 * kinds：按文档类型动态展示（md：不展示对当前类型无效的配置）。
 */
export const PREPROCESS_OPTIONS = [
  { key: 'extractContacts', label: '提取 URL 和邮箱地址', desc: '识别链接与联系方式，便于引用追溯（默认开启）', kinds: ['DOC', 'TABLE', 'FAQ'] },
  { key: 'plainTable', label: '纯文本化表格内容', desc: '将行列结构转为可检索文本', kinds: ['DOC', 'TABLE'] }
  // 「启用图片理解」已删（2026-09-06 负责人拍板 Q19：预处理按原型 3 项，md 第 4 项不实现）
  // 「替换连续空格、换行符和制表符」已删（2026-09-18 负责人拍板，md §五.1 同步去除）
]
export const RETRIEVAL_OPTIONS = [
  { value: 'HYBRID', label: '混合检索' },
  { value: 'VECTOR', label: '向量检索' },
  { value: 'KEYWORD', label: '关键词检索' }
]
export const UPLOAD_DEFAULTS = Object.freeze({
  docKind: 'DOC',
  // 预处理默认值：仅「提取 URL 和邮箱地址」默认开启（md §五.1）
  extractContacts: true,
  plainTable: false,
  embeddingModelId: '',
  retrieval: 'HYBRID',
  topK: 5
  // 检索阈值不在管理端设置，由客户端每次发起检索时提供（md §五.1）
})
/* ---------------- API / MCP 数据源配置（2026-09-07 PRD-20260904 md §六 / §七 新口径） ----------------
 * 旧字段 queryField / topKField / itemsPath / 透传字段组、MCP mode(EXISTING/INLINE) / mcpId / toolName
 * 全部废弃：请求 / 响应映射改为结构化行（requestMap / responseMap，仅 API 数据源），MCP 仅保留「直接填写」。 */

/** 请求 / 响应映射的变量类型枚举（md §六.2 / §六.3）。 */
export const VAR_TYPE_OPTIONS = ['string', 'number', 'integer', 'boolean', 'object', 'array']
/** API 请求方法枚举，默认 POST（md §六.1）。 */
export const API_METHOD_OPTIONS = ['POST', 'GET', 'PUT', 'DELETE', 'PATCH']
/** 请求参数映射「映射客户端字段」下拉（原型 sourceFields('API')：query（客户端）/ topK（客户端））。 */
export const CLIENT_FIELD_OPTIONS = [
  { value: 'query', label: 'query（客户端）' },
  { value: 'topK', label: 'topK（客户端）' }
]

/**
 * 请求参数映射预设两行（md §六.2：query 映射客户端检索词·必填，topK 映射客户端 Top K；固定行不可删）。
 * 行结构：{ name, type, required, clientField, defaultValue, preset, children[] }；
 * object/array 行经 children 挂子字段，子字段结构与一级字段一致、任意层级（md §六.2）。
 */
export function mkRequestMapRows() {
  return [
    { name: 'query', type: 'string', required: true, clientField: 'query', defaultValue: '', preset: true, children: [] },
    { name: 'topK', type: 'integer', required: false, clientField: 'topK', defaultValue: '', preset: true, children: [] }
  ]
}
/** 请求映射自定义空行（顶层与子层同构；子层的 required / clientField 不展示、保持默认）。 */
export function mkRequestMapRow(over = {}) {
  return { name: '', type: 'string', required: false, clientField: '', defaultValue: '', preset: false, children: [], ...over }
}
/**
 * 新建 API 数据源默认注入的三级递归示例组（md 知识库 §六.2 L316）：
 * filters(object) → rules(array) → field / value(string)，另在 filters 下与 rules 同级一个 enabled(boolean) 子字段
 * （2026-09-12 对齐 md §六.2 L316「另在 filters 下与 rules 同级展示一个 enabled（boolean）子字段」· 审计 K37；
 * 此前按 2026-09-07 旧口径不含 enabled，本版 md 已明确列出）。
 * 可编辑、可删除、非预设（不属于平台强制参数）；仅新建时注入（md「新建 API 数据源默认展示」），编辑已有源不注入。
 */
export function mkRequestMapExampleRows() {
  return [
    mkRequestMapRow({
      name: 'filters',
      type: 'object',
      children: [
        mkRequestMapRow({
          name: 'rules',
          type: 'array',
          children: [mkRequestMapRow({ name: 'field' }), mkRequestMapRow({ name: 'value' })]
        }),
        mkRequestMapRow({ name: 'enabled', type: 'boolean' })
      ]
    })
  ]
}
/**
 * 响应字段映射预设行工厂（2026-09-18 起 API §六.3 / MCP §七.5 同一套机制：参数名固定，另有可编辑的
 * 「接口返回字段名」（sourceField）做显式改名映射）。行结构：{ name, sourceField, description, type, preset }。
 */
function mkResponsePresetRows(presets) {
  return presets.map((p) => ({ name: p.name, sourceField: p.sourceField || '', description: p.description, type: p.type || 'string', preset: true }))
}
/**
 * 响应字段映射预设三行（md §六.3：content 内容·string / source 来源·string / score 相关度分数·number；
 * 预设不可删、变量类型可改）。接口返回字段名默认与参数名同名（沿用改造前"不做改名映射"的隐含口径），
 * 按需改为第三方实际返回的字段名；三者均无自然回退值，须保持非空。
 */
export function mkResponseMapRows() {
  return mkResponsePresetRows([
    { name: 'content', sourceField: 'content', description: '内容' },
    { name: 'source', sourceField: 'source', description: '来源' },
    { name: 'score', sourceField: 'score', description: '相关度分数', type: 'number' }
  ])
}
/** 响应映射自定义空行。 */
export function mkResponseMapRow() {
  return { name: '', sourceField: '', description: '', type: 'string', preset: false }
}

/**
 * MCP 响应字段预设三行（md §七.5：title 标题·string / content 内容·string / sourceName 来源名称·string；
 * 预设不可删、变量类型可改）。接口返回字段名留空展示，由管理员按工具实际返回结构填写
 * （title/content 必填，sourceName 可留空——留空则取数据源名称，见 validateResponseMap 的 optionalPresetNames）。
 */
export function mkMcpResponseMapRows() {
  return mkResponsePresetRows([
    { name: 'title', description: '标题' },
    { name: 'content', description: '内容' },
    { name: 'sourceName', description: '来源名称' }
  ])
}
/** 行结构与 API 响应字段映射完全一致，直接复用同一个自定义空行工厂。 */
export const mkMcpResponseMapRow = mkResponseMapRow

/** 空白自定义行（无名 / 无默认值 / 无子字段）：保存时丢弃、校验时跳过。 */
function isBlankRequestRow(r) {
  return !r?.preset && !(r?.name || '').trim() && !(r?.defaultValue || '').trim() && !(r?.children || []).some((c) => !isBlankRequestRow(c))
}
/**
 * 校验请求参数映射行（编辑器与 mock 共用，md §六.2）：预设 query/topK 两行必在且参数名非空；
 * 自定义行填了内容就必须有参数名、类型合法；同一父字段下参数名不重复；
 * object / array 至少包含一个有效子字段（2026-09-08 PRD-20260908 补）；children 递归同规则。
 * 返回错误文案，无错 ''。
 */
export function validateRequestMap(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.filter((r) => r.preset).length < 2) return '请求参数映射缺少预设参数 query / topK'
  function walk(rs, path) {
    const seen = new Set()
    for (const r of rs) {
      const name = (r?.name || '').trim()
      if (isBlankRequestRow(r)) continue // 完全空白的自定义行：保存时丢弃
      if (!name) return `请求参数映射${path}：${path ? '子字段名' : '参数名'}必填`
      if (!VAR_TYPE_OPTIONS.includes(r.type)) return `请求参数映射${path}：${name} 请选择类型`
      if (seen.has(name)) return `请求参数映射${path}：${path ? '子字段名' : '参数名'}重复（${name}）`
      seen.add(name)
      if (r.type === 'object' || r.type === 'array') {
        const kids = (r.children || []).filter((c) => !isBlankRequestRow(c))
        if (!kids.length) return `请求参数映射${path}：${name} 为 ${r.type}，至少需要一个有效子字段`
        const err = walk(kids, `${path}·${name}`)
        if (err) return err
      }
    }
    return ''
  }
  return walk(list, '')
}
/**
 * 校验响应字段映射行（API md §六.3 / MCP md §七.5 共用）：预设行须填写接口返回字段名（除 optionalPresetNames
 * 列出的字段——留空取运行时默认值，如 MCP 的 sourceName）；自定义行填了内容就必须有参数名、接口返回字段名、
 * 合法变量类型；参数名不重复；至少一条输出参数。返回错误文案，无错 ''。
 * opts.minPreset：预设行数量下限（防御性校验，正常流程由 mk*ResponseMapRows 保证）。
 */
export function validateResponseMap(rows, opts = {}) {
  const { label = '响应字段映射', minPreset = null, optionalPresetNames = [] } = opts
  const list = Array.isArray(rows) ? rows : []
  if (minPreset != null && list.filter((r) => r.preset).length < minPreset) return `${label}缺少预设字段`
  const seen = new Set()
  let effective = 0
  for (const r of list) {
    const name = (r?.name || '').trim()
    const sourceField = (r?.sourceField || '').trim()
    if (r?.preset) {
      if (!optionalPresetNames.includes(name) && !sourceField) return `${label}：${name} 需填写接口返回字段名`
      seen.add(name)
      effective++
      continue
    }
    if (!name && !sourceField && !(r?.description || '').trim()) continue // 空白自定义行：保存时丢弃
    if (!name) return `${label}：参数名必填`
    if (!sourceField) return `${label}：${name} 需填写接口返回字段名`
    if (!VAR_TYPE_OPTIONS.includes(r.type)) return `${label}：${name} 请选择变量类型`
    if (seen.has(name)) return `${label}：参数名重复（${name}）`
    seen.add(name)
    effective++
  }
  if (!effective) return `${label}至少存在一条输出参数`
  return ''
}
/** 校验 MCP 响应字段（md §七.5）：结果数组路径必填 + 复用 validateResponseMap（sourceName 可留空）。 */
export function validateMcpResponseMap(rows, resultArrayPath) {
  if (!String(resultArrayPath || '').trim()) return '请填写结果数组路径'
  return validateResponseMap(rows, { label: '响应字段', minPreset: 3, optionalPresetNames: ['sourceName'] })
}

export const API_DEFAULTS = Object.freeze({
  url: '', // 请求地址：≤500，合法 http/https（md §六.1）
  method: 'POST', // POST | GET | PUT | DELETE | PATCH，默认 POST（md §六.1）
  // NONE | API_KEY | BEARER（md §六.1：无鉴权、API KEY、Bearer Token，默认 **API KEY**）
  // 注意别照抄 MCP 侧：§七.2.1 的 streamable-http 默认才是「无鉴权」，两处默认值相反。
  authType: 'API_KEY',
  timeoutMs: 8000 // 1000～60000ms，默认 8000ms（md §六.1）
})
export const MCP_DEFAULTS = Object.freeze({
  transport: 'streamable-http', // streamable-http | stdio（md §七.2）
  endpoint: '', // streamable-http：≤500，http(s):// 开头（md §七.2.1）
  authType: 'none', // none | bearer | header（md §七.2.1：无鉴权、Bearer Token、API Key，默认无鉴权）
  authHeaderName: '', // API Key 模式 Header 名：≤128，仅字母数字连字符（md §七.2.1）
  command: 'npx', // stdio：npx | uvx | node | python3 | docker（md §七.2.2）
  timeoutMs: 10000, // 必填，使用系统默认值可直接修改；默认 10000，范围 1000～120000（md §七.6，取值维持现实现）
  resultArrayPath: '$.content[0].items[*]' // 结果数组路径示例值，新建默认展示（md §七.5）
})
/** 各文档类型可接受的文件格式（md §五.2） */
export const ACCEPT_BY_DOC_KIND = Object.freeze({
  DOC: ['.pdf', '.docx', '.doc', '.md', '.txt', '.html'],
  TABLE: ['.xlsx', '.xls', '.csv'],
  FAQ: ['.xlsx', '.csv']
})
export const MAX_DOC_MB = 50

/* ---------------- 状态（md §八.1） ---------------- */
export const STATE_META = {
  DRAFT: { label: '未发布', type: 'info' },
  PENDING_REVIEW: { label: '审核中', type: 'warning' },
  PUBLISHED: { label: '已发布', type: 'success' }
}
export const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '未发布' },
  { value: 'PENDING_REVIEW', label: '审核中' },
  { value: 'PUBLISHED', label: '已发布' }
]

export function isPending(row) {
  return !!row?.pendingAction
}
export function stateMeta(row) {
  if (isPending(row)) return STATE_META.PENDING_REVIEW
  return STATE_META[row?.status] || { label: row?.status || '—', type: 'info' }
}
/** 未发布且无待审：可编辑 / 删除 / 提交发布。 */
export function isOffline(row) {
  return row?.status !== 'PUBLISHED' && !isPending(row)
}
/** 已发布且无待审：可编辑（关键变更回未发布）/ 提交停用 / 检索测试。 */
export function isOnline(row) {
  return row?.status === 'PUBLISHED' && !isPending(row)
}

/* ---------------- 操作确认弹窗（md §三.4.3，标题 / 正文 / 确认按钮 / toast 逐字照 md） ---------------- */
export const KB_ACTION_CONFIRMS = {
  publish: {
    title: '提交发布',
    content: '提交后进入审核流程，审核通过后对可见范围生效。确认提交？',
    confirmText: '提交发布',
    toast: '已提交发布，等待审核'
  },
  delist: {
    title: '提交停用',
    content: '提交停用后进入审核，审核通过前该知识库对可见范围仍然生效。确认提交？',
    confirmText: '提交停用',
    toast: '已提交停用，等待审核'
  },
  withdraw: {
    title: '撤回提交',
    content: '撤回本次提交后将回到修改前状态。确认撤回？',
    confirmText: '撤回',
    toast: '已撤回'
  },
  remove: {
    title: '删除知识库',
    content: '删除后配置无法恢复，确认删除？',
    confirmText: '删除',
    toast: '知识库已删除'
  }
}

/* ---------------- 数据源删除保护（md §四.2，文案逐字照 md） ---------------- */
export const SOURCE_REFERENCED_TIP = '正被知识库引用，请先解除引用'

/* ---------------- 文档解析状态（md §五.3） ---------------- */
export const DOC_PARSE_META = {
  PENDING: { label: '等待解析', type: 'info' },
  PARSING: { label: '解析中', type: 'warning' },
  PARSED: { label: '解析成功', type: 'success' },
  FAILED: { label: '解析失败', type: 'danger' }
}

/* ---------------- 发布完整校验（md §三.6，5 条） ---------------- */
/**
 * 提交发布前置校验，入参为知识库行（含 name / description / kbType / scopeRefId / sources）。
 * 返回 null 表示可发布，否则返回第一条不满足的原因（供 toast / tooltip）。
 * 校验失败时调用方须保留当前编辑内容、就地展示原因，不进入审核中（md §三.6）。
 */
export function publishBlockReason(row) {
  // ① 基本信息必填项完整
  if (row && ('name' in row || 'description' in row)) {
    if (!String(row.name || '').trim()) return '请填写知识库名称'
    if (!String(row.description || '').trim()) return '请填写知识库描述'
  }
  // ⑤ 专家或岗位知识库已选择有效的可见对象（提前判，属基本信息段）
  if (row?.kbType && row.kbType !== 'ENTERPRISE' && !row.scopeRefId) {
    return row.kbType === 'EXPERT' ? '请选择可见范围专家' : '请选择可见范围岗位'
  }
  // ② 至少引用 1 个已启用数据源
  const enabled = (row?.sources || []).filter((s) => s.status !== 'DISABLED')
  if (!enabled.length) return '至少引用 1 个已启用数据源才能提交发布'
  for (const s of enabled) {
    const label = s.name ? `「${s.name}」` : `「${SOURCE_LABELS[s.sourceType]}」`
    // ③ 引用上传数据源时，该数据源至少存在 1 个解析成功文档（parsedDocCount 缺省时退回 docCount）
    if (s.sourceType === 'UPLOAD') {
      const parsed = s.parsedDocCount != null ? s.parsedDocCount : s.docCount
      if (!(parsed > 0)) return `上传数据源${label}至少要有 1 个解析成功文档`
    } else if (s.verifyStatus !== 'SUCCESS') {
      // ④ 引用 API 或 MCP 数据源时，最近一次连接测试成功
      return `${SOURCE_LABELS[s.sourceType]} 数据源${label}需最近一次连接测试成功`
    }
  }
  return null
}

/**
 * 知识库侧影响使用范围 / 检索内容的关键变更 = 数据源引用集合变化（md §三.5）。
 * 可见范围变更同样视为关键变更，由调用方比对 scopeRefId。已发布库关键变更保存后回未发布重审。
 */
export function sourceRefsChanged(beforeIds, afterIds) {
  return JSON.stringify([...(beforeIds || [])].sort()) !== JSON.stringify([...(afterIds || [])].sort())
}
