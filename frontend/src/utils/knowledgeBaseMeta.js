/**
 * 知识库模块的枚举与展示口径单一真相源（2026-08-28，设计见 docs/frontend/交互设计-知识库管理.md）。
 *
 * 状态三态照抄模型页 V98 口径：status ∈ DRAFT / PENDING_REVIEW / PUBLISHED，
 * 审核中由 pendingAction（PUBLISH / DELIST）标记——待审停用的行 status 仍是 PUBLISHED，
 * 管理员看到的应是「审核中」，故 stateMeta 以 pendingAction 优先判定。
 */

/* ---------------- 类型（建后不可改）与可见范围派生 ---------------- */
export const KB_TYPE_OPTIONS = [
  { value: 'ENTERPRISE', label: '企业' },
  { value: 'EXPERT', label: '专家' },
  { value: 'POSITION', label: '岗位' }
]
export const KB_TYPE_LABELS = KB_TYPE_OPTIONS.reduce((acc, o) => ((acc[o.value] = o.label), acc), {})

/** 可见范围文案：企业=全员；专家/岗位=「专家：X」「岗位：X」，未选则「未指定」。 */
export function scopeText(row) {
  if (!row) return '—'
  if (row.kbType === 'ENTERPRISE') return '全员'
  const prefix = row.kbType === 'EXPERT' ? '专家' : row.kbType === 'POSITION' ? '岗位' : ''
  if (!prefix) return '—'
  return `${prefix}：${row.scopeRefName || '未指定'}`
}

/* ---------------- 数据源 ----------------
 * 2026-08-31 对齐「连接器」范式：数据源是独立一等对象（「数据源管理」子页建 / 配 / 删，
 * 带 ENABLED / DISABLED 启停位）；知识库只引用（sourceIds），每类上限 5（负责人 2026-08-28 定）。
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

/** 列表「数据源」列：按固定顺序连排已启用的类别，同类多份带 ×N；一份都没有返回空串。 */
export function sourcesText(row) {
  return SOURCE_TYPES.map((t) => {
    const n = enabledSourcesOf(row, t).length
    if (!n) return ''
    return n > 1 ? `${SOURCE_LABELS[t]} ×${n}` : SOURCE_LABELS[t]
  })
    .filter(Boolean)
    .join(' · ')
}

/** 是否引用了启用中的「上传」源——文档数只对内置 RAG 库有意义，没有则显示 —。 */
export function hasUploadSource(row) {
  return enabledSourcesOf(row, 'UPLOAD').length > 0
}

/* ---------------- 内置 RAG 参数（检索默认值来自 docs/ai/model-strategy/个人空间-向量RAG策略.md §0） ----------------
 * 2026-08-31 负责人定稿：拆分方式不暴露给用户（系统内置方案），上传类配置 = 文档类型 + 文本预处理规则。 */
export const DOC_KIND_OPTIONS = [
  { value: 'DOC', label: '文档' },
  { value: 'TABLE', label: '表格' },
  { value: 'FAQ', label: 'FAQ' }
]
export const DOC_KIND_LABELS = DOC_KIND_OPTIONS.reduce((acc, o) => ((acc[o.value] = o.label), acc), {})
/** 文本预处理规则（系统已默认删除目录、页眉页脚、水印；以下为可选项，文案对齐负责人截图） */
export const PREPROCESS_OPTIONS = [
  { key: 'simCheck', label: '文本相似度计算', desc: '仅对本次上传的 doc、docx、pdf、txt 文件与库中同等格式全量文档进行检测' },
  { key: 'extractLinks', label: '提取超链接', desc: '识别超链接格式（支持 doc、docx、html 三类文档）并保留格式入库，适用于需点击查看超链接内容场景' },
  { key: 'plainTextOnly', label: '仅提取纯文本', desc: '适用于文档中无效插图需去除场景' },
  { key: 'imageUnderstand', label: '图片理解', desc: '适用于 ppt、pdf 类文档或内容包含表格、图表、公式等复杂版式的 word 文档，开启后会对插图进行识别和理解' }
]
export const RETRIEVAL_OPTIONS = [
  { value: 'HYBRID', label: '混合（向量 + 关键词）' },
  { value: 'VECTOR', label: '向量' },
  { value: 'KEYWORD', label: '关键词' }
]
export const UPLOAD_DEFAULTS = Object.freeze({
  docKind: 'DOC',
  // 预处理规则默认值：仅「提取超链接」默认开（对齐截图）
  simCheck: false,
  extractLinks: true,
  plainTextOnly: false,
  imageUnderstand: false,
  embeddingModelId: '',
  retrieval: 'HYBRID',
  topK: 5,
  threshold: 0.35
})
export const API_DEFAULTS = Object.freeze({
  url: '',
  method: 'POST',
  authType: 'NONE',
  authName: '',
  authIn: 'HEADER',
  queryField: 'query',
  topKField: 'top_k',
  itemsPath: '$.data[*]',
  contentField: 'content',
  sourceField: 'source',
  scoreField: 'score',
  timeoutMs: 8000
})
export const MCP_DEFAULTS = Object.freeze({
  mode: 'EXISTING', // EXISTING=选连接器里已有 MCP；INLINE=直接填写
  mcpId: '',
  endpoint: '',
  authType: 'none',
  authHeaderName: '',
  toolName: '',
  queryParam: 'query',
  topKParam: 'limit',
  contentField: 'text',
  sourceField: 'title',
  scoreField: 'score'
})
/** 各文档类型可接受的文件格式（文档类型建后决定该库收什么文件） */
export const ACCEPT_BY_DOC_KIND = Object.freeze({
  DOC: ['.pdf', '.docx', '.doc', '.md', '.txt', '.html'],
  TABLE: ['.xlsx', '.xls', '.csv'],
  FAQ: ['.xlsx', '.csv']
})
export const ACCEPTED_DOC_EXT = ACCEPT_BY_DOC_KIND.DOC
export const MAX_DOC_MB = 50

/* ---------------- 状态（对齐模型页 V98） ---------------- */
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
/** 已发布且无待审：可编辑（部分字段回草稿）/ 提交停用。 */
export function isOnline(row) {
  return row?.status === 'PUBLISHED' && !isPending(row)
}

/* ---------------- 发布前置门 ---------------- */
export const DOC_PARSE_META = {
  PENDING: { label: '待解析', type: 'info' },
  PARSING: { label: '解析中', type: 'warning' },
  PARSED: { label: '已解析', type: 'success' },
  FAILED: { label: '失败', type: 'danger' }
}

/**
 * 提交发布的前置：≥1 个数据源启用；上传源须 ≥1 篇文档解析成功；API / MCP 源须最近一次测试连接成功。
 * 返回 null 表示可发布，否则返回不可发布的原因（供按钮 tooltip）。
 */
export function publishBlockReason(row) {
  const enabled = (row?.sources || []).filter((s) => s.status !== 'DISABLED')
  if (!enabled.length) return '至少引用一个启用中的数据源才能提交发布'
  for (const s of enabled) {
    const label = s.name ? `「${s.name}」` : `「${SOURCE_LABELS[s.sourceType]}」`
    if (s.sourceType === 'UPLOAD') {
      if (!(s.docCount > 0)) return `上传库${label}至少要有一篇文档解析成功`
    } else if (s.verifyStatus !== 'SUCCESS') {
      return `${SOURCE_LABELS[s.sourceType]} 数据源${label}需先测试连接成功`
    }
  }
  return null
}

/**
 * 知识库侧影响检索行为的改动 = 数据源引用集合变化（增删引用）——已发布库改动回草稿重审。
 * 名称 / 描述不算；数据源自身的配置在「数据源管理」里改，影响所有引用它的库（权威裁决在后端）。
 */
export function sourceRefsChanged(beforeIds, afterIds) {
  return JSON.stringify([...(beforeIds || [])].sort()) !== JSON.stringify([...(afterIds || [])].sort())
}
