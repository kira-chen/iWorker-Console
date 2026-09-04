/**
 * 知识库模块的枚举与展示口径单一真相源。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》+ 交互原型（知识库最终覆写态）对齐重排：
 * - 列表操作矩阵 / 四类确认弹窗文案（§三.4.3，逐字照 md）收敛为 KB_ACTION_CONFIRMS；
 * - 发布完整校验 5 条（§三.6）收敛为 publishBlockReason；
 * - 上传预处理项 / 检索方式 / 解析状态等文案按 md §五 更新；
 * - 检索阈值不再在管理端设置（md §五.1），UPLOAD_DEFAULTS 移除 threshold。
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
  { key: 'replaceWhitespace', label: '替换连续空格、换行符和制表符', desc: '压缩空白字符，保留语义连续性', kinds: ['DOC', 'TABLE', 'FAQ'] },
  { key: 'extractContacts', label: '提取 URL 和邮箱地址', desc: '识别链接与联系方式，便于引用追溯（默认开启）', kinds: ['DOC', 'TABLE', 'FAQ'] },
  { key: 'plainTable', label: '纯文本化表格内容', desc: '将行列结构转为可检索文本', kinds: ['DOC', 'TABLE'] },
  { key: 'imageUnderstand', label: '启用图片理解', desc: '对文档中的插图、图表进行识别和理解，适用于复杂版式文档', kinds: ['DOC'] }
]
export const RETRIEVAL_OPTIONS = [
  { value: 'HYBRID', label: '混合检索' },
  { value: 'VECTOR', label: '向量检索' },
  { value: 'KEYWORD', label: '关键词检索' }
]
export const UPLOAD_DEFAULTS = Object.freeze({
  docKind: 'DOC',
  // 预处理默认值：仅「提取 URL 和邮箱地址」默认开启（md §五.1）
  replaceWhitespace: false,
  extractContacts: true,
  plainTable: false,
  imageUnderstand: false,
  embeddingModelId: '',
  retrieval: 'HYBRID',
  topK: 5
  // 检索阈值不在管理端设置，由客户端每次发起检索时提供（md §五.1）
})
export const API_DEFAULTS = Object.freeze({
  url: '',
  method: 'POST',
  authType: 'NONE', // NONE | API_KEY（md §六.1：无鉴权、API Key）
  authName: '',
  authIn: 'HEADER', // HEADER | QUERY（md §六.1）
  queryField: 'query',
  topKField: 'top_k',
  itemsPath: '$.data[*]',
  contentField: 'content',
  sourceField: 'source',
  scoreField: 'score',
  timeoutMs: 8000 // 1000～60000ms，默认 8000ms（md §六.1）
})
export const MCP_DEFAULTS = Object.freeze({
  mode: 'EXISTING', // EXISTING=引用连接器已登记 MCP；INLINE=内联配置（md §七.1）
  mcpId: '',
  endpoint: '',
  authType: 'none', // none | bearer | header（md §七.2：无鉴权、Bearer Token、自定义 Header）
  authHeaderName: '',
  toolName: '',
  queryParam: 'query',
  topKParam: 'top_k',
  contentField: 'content',
  sourceField: 'source',
  scoreField: 'score',
  timeoutMs: 10000 // 系统默认值、允许直接修改，不采用「留空跟随全局」（md §七.2）
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
