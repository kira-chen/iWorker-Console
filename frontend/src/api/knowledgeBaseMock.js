/**
 * 知识库开发期内存 mock（仅 DEV 生效，见 knowledgeBase.js 头注释）。后端落地后整文件删除。
 *
 * 模型（2026-09-04 按 PRD-20260903《prd.知识库.md》对齐重排）：
 * - 数据源是独立一等对象（上传 / API / MCP 三类），在「数据源管理」子页建 / 配 / 删；
 *   上传类各自持有文档；API / MCP 持有连通验证态；有 status 启停位。
 * - 知识库只**引用**数据源（kb.sourceIds，每类上限 5）；删除被引用的数据源被阻断（md §四.2）。
 * - 状态机（md §三.4 / §八.1）：DRAFT --提交发布--> 审核中(pendingAction=PUBLISH)；
 *   PUBLISHED --提交停用--> 审核中(pendingAction=DELIST)；撤回恢复提交前状态；
 *   提交发布须过完整校验 5 条（md §三.6）；已发布改数据源引用或可见范围 → 回 DRAFT 重审（md §三.5）。
 * - 敏感信息保存后遮罩展示（utils/secretMask 全站口径），明文绝不出 mock（md §四.3 / §八.2）。
 *
 * 2026-09-07 按 PRD-20260904 md §六 / §七 数据源新口径重排 API / MCP config：
 * - API：authType NONE/API_KEY(authParams 多参数行)/BEARER(bearerMasked)，requestMap / responseMap
 *   结构化预设行；旧 queryField / topKField / itemsPath / 透传字段组废弃。
 * - MCP：删除「引用现有 MCP」（mode/mcpId/toolName 废弃），仅直接填写：transport(streamable-http/stdio)、
 *   endpoint+鉴权 或 command/args/envVars、tools 多选数组。
 * - 测试连接（MCP）成功返回固定工具清单 MCP_TEST_TOOLS，供检索工具多选。
 * - 保存校验按 md：地址 / 方法 / 鉴权条件必填 / 映射预设行必填项（API）/ 工具 ≥1（MCP）（validateSourceConfig）。
 * 2026-09-08 按 PRD-20260908 md §七 回齐：MCP config 不再有 requestMap / responseMap（md 删除两节，回退 09-07 半边实现）；
 *   映射校验与连接签名的映射项仅 API 持有；API 请求映射补 object/array 子字段校验（knowledgeBaseMeta.validateRequestMap）。
 * 2026-09-18 推翻 09-08 决议：MCP config 重新加回 requestMap / responseMap / resultArrayPath（md §七.4 / §七.5），
 *   validateSourceConfig / connSignature 的映射项两类数据源同口径校验；API 响应字段映射同步改为显式改名
 *   （responseMap 行新增 sourceField，knowledgeBaseMeta.validateResponseMap 收口两者）。
 * 2026-09-08 决议第 9 项（md §八.1 L417）：数据源列表「概要」按验证状态由 mock 派生（sourceVO.summary）——
 *   新建保存未测试「未验证」→ 测试通过「已连通」（MCP 附所选检索工具名，如「已连通 · search_documents」）/
 *   测试失败「连接失败」→ 修改连接配置后保存重置「未验证」；对「刚测试过的这份配置」保存时不重置（lastTest 签名比对）。
 * 2026-09-09 PRD 复核 G3+G6 · A6（Q265③「知识库也需要发布审核，逻辑同 MCP/API/模型」）：
 *   transition() 的 publish / delist 同时向 reviewsMock + myApplicationsMock 写审核行与申请行，
 *   withdraw 摘审核行、申请行置「已撤回」；知识库按 md `prd.审核中心.md` §四**不生成快照**，
 *   审核详情读当前配置（GovObjectDetail → KnowledgeBaseEditor mode="view"）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
// 2026-09-09 A6：知识库提交发布/停用 → 挂进审核中心与我的申请（治理 mock 反向不引本模块，无环）
import { submitReviewRow, cancelReviewRow } from './reviewsMock'
import { submitApplicationRow, withdrawApplicationRow } from './myApplicationsMock'
import { reviewActionMatches } from './reviewEnroll' // 2026-09-18 R1：审核落地前核对申请类型
import { maskSecret } from '@/utils/secretMask'
import {
  MAX_SOURCES_PER_TYPE,
  SOURCE_LABELS,
  publishBlockReason,
  API_METHOD_OPTIONS,
  DOC_KIND_OPTIONS,
  RETRIEVAL_OPTIONS,
  mkRequestMapRows,
  mkResponseMapRows,
  mkMcpResponseMapRows,
  validateRequestMap,
  validateResponseMap,
  validateMcpResponseMap
} from '@/utils/knowledgeBaseMeta'
import { MCP_TRANSPORTS, isHttpTransport, MCP_COMMAND_OPTIONS } from '@/utils/defValidate'
// 2026-09-23 待办 yuepu#9④：岗位可见范围候选改从 positionMock 实时读，不再自己维护一份脱节的名单
import { listAllPositions } from './positionMock'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
let seq = 100
const nid = (p) => `${p}_${(seq++).toString(36).padStart(11, 'x')}`

const EXPERTS = [
  { id: 'ex_1', name: '方案专家' },
  { id: 'ex_2', name: '售后专家' }
]
const EMBEDDING_MODELS = [
  { id: 'md_emb_1', name: 'text-embedding-3-small' },
  { id: 'md_emb_2', name: 'bge-m3' }
]

/* ---------------- 数据源（全局独立对象） ---------------- */
const mkSrc = (id, sourceType, name, config = {}, verifyStatus = 'UNVERIFIED', status = 'ENABLED') => ({
  id,
  sourceType,
  name,
  status, // ENABLED | DISABLED（停用后检索时跳过，保留配置与引用）
  config,
  verifyStatus, // API/MCP：SUCCESS | FAILED | UNVERIFIED（不替代启用状态，md §八.1）
  verifiedAt: verifyStatus === 'SUCCESS' ? '2026-08-28T10:00:00Z' : null,
  verifyError: null,
  createdAt: '2026-08-28T09:00:00Z'
})
const upl = (id, name, over = {}) =>
  mkSrc(id, 'UPLOAD', name, {
    docKind: 'DOC',
    extractContacts: true,
    plainTable: false,
    embeddingModelId: 'md_emb_1',
    retrieval: 'HYBRID',
    topK: 5,
    ...over
  })
// MCP 测试连接成功后返回的固定工具清单（md §七.3：工具清单在连接测试成功后获得）
export const MCP_TEST_TOOLS = ['search_documents', 'search_chunks', 'hybrid_search']
const apiSrc = (id, name, over = {}) =>
  mkSrc(
    id,
    'API',
    name,
    {
      url: 'https://rag.example.com/api/v1/search',
      method: 'POST',
      authType: 'API_KEY', // NONE | API_KEY | BEARER（md §六.1）
      // API KEY 多参数表（md §六.1.1）：参数值保存后仅存首尾掩码
      authParams: [{ key: 'X-Api-Key', description: '检索服务访问密钥', clientFill: false, in: 'HEADER', valueMasked: maskSecret('sk-demo-2f81c09f2') }],
      bearerMasked: '',
      requestMap: mkRequestMapRows(),
      responseMap: mkResponseMapRows(),
      timeoutMs: 8000,
      ...over
    },
    'SUCCESS'
  )
// 原「引用现有 MCP」种子（2026-09-07 PRD-20260904 删除该模式）改为直接填写等价配置
const mcpSrc = (id, name, over = {}) =>
  mkSrc(
    id,
    'MCP',
    name,
    {
      transport: 'streamable-http', // streamable-http | stdio | sse（md §七.2）
      endpoint: 'https://knowledge.intra/mcp',
      authType: 'bearer', // none | bearer | header（md §七.2.1）
      authHeaderName: '',
      credentialMasked: maskSecret('mcp-demo-9a3ef8d1c'),
      command: 'npx',
      args: [],
      envVars: [],
      tools: ['search_documents', 'hybrid_search'], // 检索工具多选（md §七.3：≥1）
      requestMap: mkRequestMapRows(), // 与 API 同构，预设 query/topK（md §七.4）
      // 响应字段（md §七.5）：接口返回字段名给出真实示例（title/content 必填映射，sourceName 留空演示取数据源名称）
      responseMap: mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: { title: 'title', content: 'text', sourceName: '' }[r.name] ?? '' })),
      resultArrayPath: '$.content[0].items[*]', // md §七.5：结果数组路径必填
      timeoutMs: 10000, // md §七.6：必填，系统默认值可直接修改
      ...over
    },
    'SUCCESS'
  )

let sources = [
  upl('ks_1a', '产品资料'),
  upl('ks_1b', '解决方案案例'),
  upl('ks_2a', '报价政策文档'),
  upl('ks_4a', '话术手册'),
  upl('ks_5a', '竞品资料'),
  upl('ks_6a', '白皮书'),
  apiSrc('ks_3a', '国标检索接口'),
  apiSrc('ks_3b', '行标检索接口'),
  apiSrc('ks_5b', '情报平台接口', { url: 'https://rag.fail.example.com/api/v1/search' }, 'FAILED'),
  mcpSrc('ks_1c', '法规库检索'),
  mcpSrc('ks_3c', '法规库 MCP'),
  apiSrc('ks_old', '旧版案例接口', {}, 'FAILED')
]
// 校正带四参的两条：mkSrc 包装函数第三参是 over，verifyStatus 需单独覆写
sources.find((s) => s.id === 'ks_5b').verifyStatus = 'FAILED'
sources.find((s) => s.id === 'ks_5b').verifiedAt = null
sources.find((s) => s.id === 'ks_5b').verifyError = 'TIMEOUT: 连接超时（8000 ms）'
Object.assign(sources.find((s) => s.id === 'ks_old'), { status: 'DISABLED', verifyStatus: 'FAILED', verifiedAt: null, verifyError: 'HTTP 502 Bad Gateway' })

let rows = [
  { id: 'kb_1', name: '产品与解决方案库', icon: '📦', kbType: 'ENTERPRISE', scopeRefId: null, description: '公司全线产品的规格书、解决方案与典型案例，供售前与销售顾问检索。', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_1a', 'ks_1b', 'ks_1c'] },
  { id: 'kb_2', name: '报价政策与折扣权限', icon: '💰', kbType: 'ENTERPRISE', scopeRefId: null, description: '各产品线报价政策、折扣审批权限与常见报价问题，供销售与售前使用。', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_2a'] },
  { id: 'kb_3', name: '法规与标准库', icon: '⚖️', kbType: 'ENTERPRISE', scopeRefId: null, description: '行业法规、国标与行标条文检索，供合规与方案设计参考。', status: 'DRAFT', pendingAction: 'PUBLISH', sourceIds: ['ks_3a', 'ks_3b', 'ks_3c'] },
  // D3：两库分别挂经营分析岗（401）与财务审核岗（403），名称/描述随岗位改写，让两岗知识页签都有数据可演示
  // （2026-09-23 待办 yuepu#9④：scopeRefId 改用 positionMock 的真实 positionId，不再是脱节的 'ps_1'/'ps_2'）
  { id: 'kb_4', name: '经营分析指标口径库', icon: '📊', kbType: 'POSITION', scopeRefId: 401, description: '经营分析岗常用指标定义、统计口径与报表模板说明。', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_4a'] },
  { id: 'kb_5', name: '财务审核制度库', icon: '🧾', kbType: 'POSITION', scopeRefId: 403, description: '报销与付款审核的制度文件、稽核要点与常见问题。', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_5a', 'ks_5b'] },
  { id: 'kb_6', name: '2026 产品白皮书库', icon: '📄', kbType: 'EXPERT', scopeRefId: 'ex_1', description: '2026 年度产品白皮书与技术方案，供方案专家撰稿引用。', status: 'DRAFT', pendingAction: null, sourceIds: ['ks_6a'] },
  // kb_7：全套唯一的「无数据源草稿」样本，用于演示发布前校验拦截（sourceIds 为空，勿加数据源）。
  // 2026-09-23：icon / description 原为空串，而两者均已必填（61dbd19 图标改必填、描述早已必填），
  // 导致这条种子一点【编辑】就被必填卡死、存不回去；补齐两字段，「无数据源」这个演示点不受影响。
  { id: 'kb_7', name: '薪酬与绩效制度', icon: '💰', kbType: 'ENTERPRISE', scopeRefId: null, description: '薪酬结构、绩效考核办法与调薪流程说明，供 HR 与管理者查询。', status: 'DRAFT', pendingAction: null, sourceIds: [] }
]
// 文档按上传类数据源 id 归属；parseReadyAt=解析完成时间戳（listDocs 读到该时刻后 PARSING → PARSED，供轮询示意）
const docsBySource = {
  ks_1a: [
    { id: 'doc_1', fileName: '产品总目录-2026H2.pdf', size: 8.4 * 1024 * 1024, chunkCount: 412, parseStatus: 'PARSED', errorReason: null },
    { id: 'doc_3', fileName: '典型案例集-制造业.pdf', size: 12.7 * 1024 * 1024, chunkCount: 0, parseStatus: 'PARSING', errorReason: null },
    { id: 'doc_4', fileName: '报价单模板.xlsx', size: 340 * 1024, chunkCount: 0, parseStatus: 'FAILED', errorReason: '不支持 .xlsx 格式，请转为 PDF 或 DOCX 后重新上传' }
  ],
  ks_1b: [{ id: 'doc_2', fileName: '智慧园区解决方案.docx', size: 2.1 * 1024 * 1024, chunkCount: 96, parseStatus: 'PARSED', errorReason: null }]
}
const seedDocCount = { ks_2a: 46, ks_4a: 312, ks_5a: 168, ks_6a: 52 }

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处。
// docsBySource / seedDocCount 为 const 对象 → restore 就地覆写（不换引用）。
// version 2（2026-09-04）：PRD-20260903 对齐改了种子结构（预处理键 / MCP 同源 / 解析计时），旧快照直接弃用回种子。
// version 3（2026-09-06）：Q19 拍板预处理删「启用图片理解」，种子 config 去掉 imageUnderstand 键。
// version 4（2026-09-07）：PRD-20260904 数据源新口径——API config 改 authParams/requestMap/responseMap
// 结构化行，MCP 删除引用现有模式改 transport/tools 数组；旧快照结构不兼容，直接弃用回种子。
// version 5（2026-09-08）：PRD-20260908 md §七 删除 MCP 请求/响应映射——MCP 种子 config 去掉 requestMap/responseMap；
// 旧快照含该两键，弃用回种子。
// version 6（2026-09-10 D3）：岗位可见范围种子对齐岗位模块四岗（销售顾问/HR 专员 → 经营分析岗/财务审核岗，
// kb_4/kb_5 名称描述随岗位改写）；旧快照仍挂不存在的岗位名，弃用回种子。
// version 7（2026-09-11）：知识库种子加 icon 字段；旧快照无该字段，弃用回种子。
// version 8（2026-09-18）：①推翻 09-08 决议，MCP 种子加回 requestMap/responseMap/resultArrayPath，
// API 种子 responseMap 行加 sourceField；②上传预处理删「替换连续空格/换行符/制表符」，UPLOAD 种子去
// replaceWhitespace 键；旧快照两处结构均不兼容，弃用回种子。
// version 9（2026-09-23，两处种子改动合并到同一次 bump，双方都需要丢弃旧快照）：
// ① 待办 yuepu#9④：kb_4/kb_5 的 scopeRefId 由硬编码 'ps_1'/'ps_2' 改为 positionMock 真实 positionId
//    （401/403）；旧快照仍是 'ps_1'/'ps_2'，在新版 scopeName() 里查无此岗位、静默显示可见范围为空。
// ② kb_7 补 icon / description（原为空串，而两者均已必填 → 该种子一点编辑就存不回去）；
//    旧快照里的 kb_7 仍是空值。
const persist = attachPersist('knowledgeBase', {
  version: 9,
  snapshot: () => ({ seq, sources, rows, docsBySource, seedDocCount }),
  restore: (d) => {
    if (
      !d || !Number.isFinite(d.seq) || !Array.isArray(d.sources) || !Array.isArray(d.rows) ||
      typeof d.docsBySource !== 'object' || d.docsBySource === null ||
      typeof d.seedDocCount !== 'object' || d.seedDocCount === null
    ) {
      throw new Error('knowledgeBase 快照形状不合法')
    }
    seq = d.seq
    sources = d.sources
    rows = d.rows
    Object.keys(docsBySource).forEach((k) => delete docsBySource[k])
    Object.assign(docsBySource, d.docsBySource)
    Object.keys(seedDocCount).forEach((k) => delete seedDocCount[k])
    Object.assign(seedDocCount, d.seedDocCount)
  }
})

function parsedDocCountOf(sourceId) {
  const docs = docsBySource[sourceId]
  if (docs) return docs.filter((d) => d.parseStatus === 'PARSED').length
  return seedDocCount[sourceId] || 0
}
function docCountOf(sourceId) {
  const docs = docsBySource[sourceId]
  return docs ? docs.length : seedDocCount[sourceId] || 0
}
function findSource(id) {
  const s = sources.find((x) => x.id === id)
  if (!s) throw new ApiError({ message: '数据源不存在', code: 404 })
  return s
}
function referencedBy(sourceId) {
  return rows.filter((r) => r.sourceIds.includes(sourceId)).map((r) => ({ id: r.id, name: r.name }))
}
/**
 * 数据源列表「概要」（md §四.2 L202 / §八.1 L417，2026-09-08 决议第 9 项）：
 * 上传 = 文档总数；API/MCP 按验证状态：SUCCESS →「已连通」（MCP 附所选检索工具名）/ FAILED →「连接失败」/ 其余「未验证」。
 * 派生值不落库，验证状态一变概要即变（连接测试回写 / 修改配置重置均自动体现）。
 */
export function sourceSummary(s) {
  if (s.sourceType === 'UPLOAD') return `${Number(docCountOf(s.id) || 0).toLocaleString('en-US')} 篇文档`
  if (s.verifyStatus === 'SUCCESS') {
    const tools = s.sourceType === 'MCP' && Array.isArray(s.config?.tools) ? s.config.tools.filter(Boolean) : []
    return tools.length ? `已连通 · ${tools.join('、')}` : '已连通'
  }
  if (s.verifyStatus === 'FAILED') return '连接失败'
  return '未验证'
}
function sourceVO(s) {
  return {
    ...s,
    config: { ...s.config },
    docCount: s.sourceType === 'UPLOAD' ? docCountOf(s.id) : undefined,
    parsedDocCount: s.sourceType === 'UPLOAD' ? parsedDocCountOf(s.id) : undefined,
    referencedBy: referencedBy(s.id),
    summary: sourceSummary(s)
  }
}
function scopeName(r) {
  if (r.kbType === 'EXPERT') return EXPERTS.find((e) => e.id === r.scopeRefId)?.name || ''
  if (r.kbType === 'POSITION') return listAllPositions().find((p) => String(p.id) === String(r.scopeRefId))?.name || ''
  return ''
}
function vo(r) {
  const resolved = r.sourceIds.map((id) => sources.find((s) => s.id === id)).filter(Boolean).map(sourceVO)
  const docCount = resolved.filter((s) => s.sourceType === 'UPLOAD' && s.status === 'ENABLED').reduce((n, s) => n + (s.docCount || 0), 0)
  return { ...r, sourceIds: [...r.sourceIds], scopeRefName: scopeName(r), sources: resolved, docCount }
}
function find(id) {
  const r = rows.find((x) => x.id === id)
  if (!r) throw new ApiError({ message: '知识库不存在', code: 404 })
  return r
}
function conflict(msg) {
  throw new ApiError({ message: msg, code: 409 })
}

/* ================= 知识库 ================= */
export async function list(params = {}) {
  await delay()
  let out = rows
  if (params.keyword) out = out.filter((r) => r.name.includes(params.keyword))
  if (params.kbType) out = out.filter((r) => r.kbType === params.kbType)
  if (params.status) {
    // 待发布与待停用统一按「审核中」筛出（md §三.2）
    out = out.filter((r) => (params.status === 'PENDING_REVIEW' ? !!r.pendingAction : !r.pendingAction && r.status === params.status))
  }
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: out.slice((page - 1) * size, page * size).map(vo), total: out.length }
}
export async function get(id) {
  await delay()
  return vo(find(id))
}
function validate(payload, selfId) {
  if (!payload.name?.trim()) throw new ApiError({ message: '知识库名称不能为空', code: 400, field: 'name' })
  if (payload.name.trim().length > 64) throw new ApiError({ message: '知识库名称最多 64 个字符', code: 400, field: 'name' })
  // 描述必填（md §三.3.1：必填，最多 2000 字符；2026-09-16 217ce1f 全站字数统一时 md 改了这里，
  // 代码漏改，2026-09-18 待办 yuepu#5① 一并补上）
  if (!String(payload.description || '').trim()) throw new ApiError({ message: '请输入知识库描述', code: 400, field: 'description' })
  if (String(payload.description).trim().length > 2000) throw new ApiError({ message: '描述最多 2000 个字符', code: 400, field: 'description' })
  const dup = rows.find((r) => r.id !== selfId && r.kbType === payload.kbType && r.name.trim().toLowerCase() === payload.name.trim().toLowerCase())
  if (dup) throw new ApiError({ message: '同类型下已存在同名知识库', code: 409, field: 'name' })
  if (payload.kbType !== 'ENTERPRISE' && !payload.scopeRefId) throw new ApiError({ message: '请选择可见范围', code: 400, field: 'scopeRefId' })
  const ids = payload.sourceIds || []
  if (new Set(ids).size !== ids.length) throw new ApiError({ message: '数据源引用重复', code: 400 })
  for (const t of ['UPLOAD', 'API', 'MCP']) {
    const n = ids.filter((id) => sources.find((s) => s.id === id)?.sourceType === t).length
    if (n > MAX_SOURCES_PER_TYPE) throw new ApiError({ message: `${SOURCE_LABELS[t]} 数据源最多引用 ${MAX_SOURCES_PER_TYPE} 个`, code: 400 })
  }
  for (const id of ids) {
    const src = findSource(id)
    // 已停用的数据源不可被引用（2026-09-12 对齐 md §三.3.2 L94「已停用的数据源……不可被引用」09-09 拍板 · 审计 K40）：
    // UI 候选列表已滤掉停用源，数据层同样拦住，避免绕过 UI 的调用把停用源引进来。
    if (src.status === 'DISABLED') {
      throw new ApiError({ message: `数据源「${src.name}」已停用，不可被引用`, code: 400, field: 'sourceIds' })
    }
  }
}
export async function create(payload) {
  await delay()
  validate(payload)
  const r = { id: nid('kb'), name: payload.name.trim(), icon: payload.icon || '', kbType: payload.kbType, scopeRefId: payload.scopeRefId || null, description: String(payload.description || '').trim(), status: 'DRAFT', pendingAction: null, sourceIds: [...(payload.sourceIds || [])] }
  rows = [r, ...rows]
  persist()
  return vo(r)
}
export async function update(id, payload) {
  await delay()
  const r = find(id)
  if (r.pendingAction) conflict('审核中不可编辑，如需修改请先撤回')
  validate({ ...payload, kbType: r.kbType }, id)
  // 关键变更（md §三.5）：数据源引用集合变化 或 可见范围变化 → 已发布库回未发布重审
  const refsChanged = JSON.stringify([...r.sourceIds].sort()) !== JSON.stringify([...(payload.sourceIds || [])].sort())
  const nextScope = r.kbType === 'ENTERPRISE' ? null : payload.scopeRefId || r.scopeRefId
  const scopeChanged = nextScope !== r.scopeRefId
  Object.assign(r, {
    name: payload.name.trim(),
    icon: payload.icon ?? r.icon,
    description: String(payload.description || '').trim(),
    scopeRefId: nextScope,
    sourceIds: [...(payload.sourceIds || [])]
    // kbType 创建后不可修改（md §三.3.1）：忽略入参
  })
  if ((refsChanged || scopeChanged) && r.status === 'PUBLISHED') r.status = 'DRAFT'
  persist()
  return vo(r)
}
export async function remove(id) {
  await delay()
  const r = find(id)
  if (r.status === 'PUBLISHED' || r.pendingAction) conflict('仅未发布且没有待审核操作的知识库可删除')
  rows = rows.filter((x) => x.id !== id)
  persist()
  return null
}
/**
 * 状态流转（md §三.4）。
 *
 * 2026-09-09 PRD 复核 A6（Q265③「知识库也需要发布审核，逻辑同 MCP/API/模型」）：
 * 提交发布 / 提交停用同时把本库挂进审核中心与我的申请；撤回时摘掉审核行、申请行置「已撤回」。
 * 知识库按 md `prd.审核中心.md` §四「知识库……不生成快照，审核详情读取业务模块的当前配置」——
 * 本函数**不**写快照，审核详情按 refId 实时取当前配置。
 */
export async function transition(id, action) {
  await delay()
  const r = find(id)
  if (action === 'publish') {
    if (r.status !== 'DRAFT' || r.pendingAction) conflict('提交发布仅允许在未发布状态下执行')
    // 发布完整校验 5 条（md §三.6）：不通过则不进入审核中
    const reason = publishBlockReason(vo(r))
    if (reason) throw new ApiError({ message: reason, code: 400 })
    r.pendingAction = 'PUBLISH'
    enrollReview(r, 'PUBLISH')
  } else if (action === 'delist') {
    if (r.status !== 'PUBLISHED' || r.pendingAction) conflict('提交停用仅允许在已发布状态下执行')
    r.pendingAction = 'DELIST'
    enrollReview(r, 'DELIST')
  } else if (action === 'withdraw') {
    if (!r.pendingAction) conflict('当前没有待审核操作')
    r.pendingAction = null // 撤回恢复提交前状态（status 未曾变，天然回退）
    cancelReviewRow('KNOWLEDGE_BASE', r.id)
    withdrawApplicationRow('KNOWLEDGE_BASE', r.id)
  }
  persist()
  return vo(r)
}

/**
 * 审核结果落地（2026-09-12 负责人决策 5（审计 J12））：由 reviewsMock.applyReviewResult 分发到此。
 * md `prd.知识库.md` §三.4 L129「提交发布：……审核通过变为已发布」/ L130「提交停用：……审核通过变为未发布」；
 * 驳回与撤回同向（L372 撤回即恢复提交前状态，status 未曾变 → 只需清 pendingAction）。
 */
export function applyKnowledgeBaseReviewResult(refId, requestAction, approved) {
  const r = rows.find((x) => x.id === refId)
  if (!r || !r.pendingAction) return false
  if (requestAction && !reviewActionMatches(requestAction, r.pendingAction)) return false
  const isDelist = r.pendingAction === 'DELIST'
  if (approved) r.status = isDelist ? 'DRAFT' : 'PUBLISHED'
  r.pendingAction = null
  persist()
  return true
}

/** 提交端接线：一次提交同时落审核中心行与我的申请行（申请类型按 md 三项口径推导）。 */
function enrollReview(r, pendingAction) {
  // 首次发布 vs 新版本发布：知识库无版本号概念（md 无版本字段），已发布过（曾进入 PUBLISHED）即算新版本发布
  const requestAction = pendingAction === 'DELIST' ? 'DELIST' : r.status === 'PUBLISHED' ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH'
  submitReviewRow({
    type: 'KNOWLEDGE_BASE',
    refId: r.id,
    name: r.name,
    description: r.description || '',
    requestAction,
    version: '—'
  })
  submitApplicationRow({
    businessType: 'KNOWLEDGE_BASE',
    refId: r.id,
    objectName: r.name,
    description: r.description || '',
    applicationType: requestAction,
    version: '—',
    versionNotes: pendingAction === 'DELIST' ? '申请停止该知识库对外提供' : '申请发布该知识库'
  })
}

/* ---- 检索测试（不落库，md §三.7）：按启用数据源逐个拟真召回 ---- */
const SNIPPETS = {
  UPLOAD: [
    { source: '产品与解决方案手册.pdf', page: 18, content: '标准解决方案由业务场景分析、产品能力组合、实施计划和交付验收四部分组成，并根据客户规模提供基础版与企业版。基础版聚焦单场景快速落地，企业版覆盖跨部门流程与数据打通，两版均含标准交付 SOP 与验收清单。' },
    { source: '行业解决方案案例集.docx', page: 6, content: '方案设计应先确认业务目标和数据条件，再选择适用的能力模块及服务边界。' }
  ],
  API: [{ source: '第三方知识服务 · 标准方案条目', page: null, content: '标准解决方案包含需求诊断、方案蓝图、实施路径与运营支持四个阶段，各阶段有对应的交付物模板与里程碑检查项。' }],
  MCP: [{ source: 'MCP 工具返回 · 知识块', page: null, content: '解决方案标准内容清单：场景说明、能力矩阵、系统对接方式、数据安全说明、报价与服务目录。' }]
}
export async function search(id, params) {
  await delay(500)
  const r = find(id)
  const q = params?.query || ''
  const enabled = r.sourceIds.map((sid) => sources.find((s) => s.id === sid)).filter((s) => s && s.status === 'ENABLED')
  const want = params?.sourceId ? enabled.filter((s) => s.id === params.sourceId) : enabled
  const items = []
  const errors = []
  let base = 0.94
  for (const s of want) {
    // 连接失败的 API / MCP 源：展示该来源错误，但不影响其他数据源结果（md §三.7）
    if (s.sourceType !== 'UPLOAD' && s.verifyStatus === 'FAILED') {
      errors.push({ sourceType: s.sourceType, sourceId: s.id, sourceName: s.name, message: `${s.name} 检索失败：${s.verifyError || 'TIMEOUT（8000 ms）'}` })
      continue
    }
    for (const sn of SNIPPETS[s.sourceType] || []) {
      base -= 0.05
      items.push({ score: Math.max(0.35, base), sourceType: s.sourceType, sourceId: s.id, sourceName: s.name, source: sn.source, page: sn.page, content: `${sn.content}${q ? `（命中问题：${q}）` : ''}` })
    }
  }
  items.sort((a, b) => b.score - a.score)
  const topK = Number(params?.topK) || 5
  return { items: items.slice(0, topK).map((it, i) => ({ ...it, rank: i + 1 })), errors, elapsedMs: 286 }
}

/* ================= 数据源管理 ================= */
export async function listSources(params = {}) {
  await delay()
  let out = sources
  if (params.keyword) out = out.filter((s) => s.name.includes(params.keyword))
  if (params.sourceType) out = out.filter((s) => s.sourceType === params.sourceType)
  if (params.status) out = out.filter((s) => s.status === params.status) // 启用 / 停用筛选（新原型后置层）
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: out.slice((page - 1) * size, page * size).map(sourceVO), total: out.length }
}
export async function getSource(id) {
  await delay()
  return sourceVO(findSource(id))
}
function validateSource(payload, selfId) {
  if (!payload.name?.trim()) throw new ApiError({ message: '数据源名称不能为空', code: 400, field: 'name' })
  if (payload.name.trim().length > 64) throw new ApiError({ message: '数据源名称最多 64 个字符', code: 400, field: 'name' })
  const dup = sources.find((s) => s.id !== selfId && s.sourceType === payload.sourceType && s.name.trim().toLowerCase() === payload.name.trim().toLowerCase())
  if (dup) throw new ApiError({ message: '同类型下已存在同名数据源', code: 409, field: 'name' })
}
const HTTP_RE = /^https?:\/\//i
const bad = (message, field) => {
  throw new ApiError({ message, code: 400, field })
}
const prevParamRow = (prevRows, r, withIn) =>
  (prevRows || []).find((p) => p.key === (r.key || '').trim() && (!withIn || (p.in || '') === (r.in || '')))
/**
 * 数据源保存校验（md §五.1 UPLOAD / §六.1～§六.3 API / §七.2～§七.4 MCP；映射校验仅 API）。
 * prev = 编辑目标（判定「已配置密钥留空=保留」）。
 * UPLOAD 三必填（2026-09-12 对齐 md §五.1 · 审计 K40）：Embedding 模型 / 检索策略 / Top-K（1～20），文档类型亦必填。
 */
function validateSourceConfig(payload, prev) {
  const type = payload.sourceType || prev?.sourceType
  const cfg = payload.config || {}
  if (type === 'UPLOAD') {
    if (!DOC_KIND_OPTIONS.some((o) => o.value === cfg.docKind)) bad('请选择文档类型', 'docKind')
    if (!String(cfg.embeddingModelId || '').trim()) bad('请选择向量模型', 'embeddingModelId')
    if (!RETRIEVAL_OPTIONS.some((o) => o.value === cfg.retrieval)) bad('请选择检索策略', 'retrieval')
    const k = Number(cfg.topK)
    if (!Number.isInteger(k) || k < 1 || k > 20) bad('Top-K 需为 1～20 的整数', 'topK')
  } else if (type === 'API') {
    const url = String(cfg.url || '').trim()
    if (!url) bad('请填写请求地址', 'url')
    if (url.length > 500) bad('请求地址最多 500 个字符', 'url')
    if (!HTTP_RE.test(url)) bad('请求地址需为合法 HTTP/HTTPS 地址', 'url')
    if (!API_METHOD_OPTIONS.includes(cfg.method)) bad('请选择请求方法', 'method')
    const t = Number(cfg.timeoutMs)
    if (!Number.isFinite(t) || t < 1000 || t > 60000) bad('超时时间需在 1000～60000ms 之间', 'timeoutMs')
    if (cfg.authType === 'API_KEY') {
      // 多参数表：至少一行有效参数；位置必选；未勾客户端填写必须有值（新填或已配置留空=保留）（md §六.1.1）
      const rowsK = (cfg.authParams || []).filter((r) => (r?.key || '').trim())
      if (!rowsK.length) bad('已选 API KEY 鉴权，至少保留一行有效参数', 'authParams')
      for (const r of rowsK) {
        if (!['QUERY', 'BODY', 'HEADER', 'PATH'].includes(r.in)) bad(`鉴权参数 ${r.key} 请选择位置`, 'authParams')
        if (!r.clientFill && !(r.value || '').trim() && !r.valueMasked && !prevParamRow(prev?.config?.authParams, r, true)?.valueMasked) {
          bad(`鉴权参数 ${r.key} 未勾选客户端填写时必须填写参数值`, 'authParams')
        }
      }
    } else if (cfg.authType === 'BEARER') {
      if (!(payload.authValue || '').trim() && !prev?.config?.bearerMasked) bad('Bearer Token 必填', 'authValue')
    }
    // 请求 / 响应映射仅 API 数据源持有（md §六.2 / §六.3；含 object/array 子字段递归校验）
    const reqErr = validateRequestMap(cfg.requestMap)
    if (reqErr) bad(reqErr, 'requestMap')
    const respErr = validateResponseMap(cfg.responseMap)
    if (respErr) bad(respErr, 'responseMap')
  } else if (type === 'MCP') {
    if (!MCP_TRANSPORTS.includes(cfg.transport)) bad('请选择传输方式', 'transport')
    if (isHttpTransport(cfg.transport)) {
      const ep = String(cfg.endpoint || '').trim()
      if (!ep) bad('请填写 MCP 服务地址', 'endpoint')
      if (ep.length > 500) bad('MCP 服务地址最多 500 个字符', 'endpoint')
      if (!HTTP_RE.test(ep)) bad('MCP 服务地址需以 http:// 或 https:// 开头', 'endpoint')
      if (cfg.authType === 'header' && !/^[A-Za-z0-9-]{1,128}$/.test(String(cfg.authHeaderName || '').trim())) {
        bad('Header 名仅允许字母、数字和连字符（最多 128 个字符）', 'authHeaderName')
      }
      if (cfg.authType && cfg.authType !== 'none' && !(payload.authValue || '').trim() && !prev?.config?.credentialMasked) {
        bad('访问凭证必填', 'authValue')
      }
    } else {
      if (!MCP_COMMAND_OPTIONS.includes(cfg.command)) bad('请选择 Command', 'command')
      for (const r of (cfg.envVars || []).filter((x) => (x?.key || '').trim())) {
        if (!r.clientFill && !(r.value || '').trim() && !r.valueMasked && !prevParamRow(prev?.config?.envVars, r, false)?.valueMasked) {
          bad(`环境变量 ${r.key} 未勾选客户端填写时必须填写平台值`, 'envVars')
        }
      }
    }
    if (!Array.isArray(cfg.tools) || !cfg.tools.length) bad('至少选择一个检索工具', 'tools')
    const t = Number(cfg.timeoutMs)
    if (!Number.isFinite(t) || t < 1000 || t > 120000) bad('超时时间需在 1000～120000ms 之间', 'timeoutMs')
    // 请求 / 响应映射（md §七.4 / §七.5；与 API 同一套机制，MCP 多校验结果数组路径）
    const mcpReqErr = validateRequestMap(cfg.requestMap)
    if (mcpReqErr) bad(mcpReqErr, 'requestMap')
    const mcpRespErr = validateMcpResponseMap(cfg.responseMap, cfg.resultArrayPath)
    if (mcpRespErr) bad(mcpRespErr, 'responseMap')
  }
}
// 敏感信息：明文只在提交瞬间存在，落库即 maskSecret 掩码（md §四.3：保存后遮罩展示，不回显明文；
// 已配置行留空 = 保留原掩码，参考 apiConnectorMock 口径）
function maskParamRows(rows, prevRows, withIn) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => (r?.key || '').trim() || (r?.description || '').trim() || (r?.value || '').trim() || r?.valueMasked)
    .map((r) => {
      const out = { key: (r.key || '').trim(), description: (r.description || '').trim(), clientFill: !!r.clientFill }
      if (withIn) out.in = r.in || 'HEADER'
      if (!out.clientFill) {
        const plain = (r.value || '').trim()
        out.valueMasked = plain ? maskSecret(plain) : r.valueMasked || prevParamRow(prevRows, r, withIn)?.valueMasked || ''
      }
      return out
    })
}
function mergeConfig(prev, payload) {
  const type = payload.sourceType || prev?.sourceType
  const cfg = { ...(payload.config || {}) }
  delete cfg.authValue
  if (type === 'API') {
    cfg.authParams = cfg.authType === 'API_KEY' ? maskParamRows(cfg.authParams, prev?.config?.authParams, true) : []
    cfg.bearerMasked =
      cfg.authType === 'BEARER' ? (payload.authValue ? maskSecret(payload.authValue) : prev?.config?.bearerMasked || '') : ''
  } else if (type === 'MCP') {
    cfg.envVars = cfg.transport === 'stdio' ? maskParamRows(cfg.envVars, prev?.config?.envVars, false) : []
    const needsCred = isHttpTransport(cfg.transport) && cfg.authType && cfg.authType !== 'none'
    cfg.credentialMasked = needsCred ? (payload.authValue ? maskSecret(payload.authValue) : prev?.config?.credentialMasked || '') : ''
  }
  return cfg
}
/**
 * 连接签名：请求地址 / 鉴权 / 映射（API，md §六.4）+ 服务地址 / 鉴权 / 工具 / 映射（MCP，md §七.7）。
 * 保存时签名变化或提交了新密钥 → 验证状态重置为未验证；仅改名称 / 状态 / 超时不重置。
 */
function connSignature(type, cfg = {}) {
  if (type === 'API') {
    return JSON.stringify({
      url: cfg.url,
      authType: cfg.authType,
      auth: (cfg.authParams || []).map((r) => [r.key, r.in, !!r.clientFill]),
      req: cfg.requestMap,
      resp: cfg.responseMap
    })
  }
  if (type === 'MCP') {
    return JSON.stringify({
      transport: cfg.transport,
      endpoint: cfg.endpoint,
      authType: cfg.authType,
      header: cfg.authHeaderName,
      command: cfg.command,
      args: cfg.args,
      env: (cfg.envVars || []).map((r) => [r.key, !!r.clientFill]),
      tools: cfg.tools,
      req: cfg.requestMap,
      resp: cfg.responseMap,
      resultArrayPath: cfg.resultArrayPath
    })
  }
  return ''
}
const hasNewSecret = (payload) =>
  !!(payload.authValue || '').trim() ||
  (payload.config?.authParams || []).some((r) => (r?.value || '').trim()) ||
  (payload.config?.envVars || []).some((r) => (r?.value || '').trim())
/**
 * 「被测试的配置」签名 = 连接签名 + 密钥掩码（明文不进签名）。testSource 记录最近一次测试的签名与结果，
 * createSource / updateSource 保存时若配置与最近一次测试完全一致，则沿用该测试结果而不重置为未验证
 * （2026-09-08 决议第 9 项：测试通过 → 保存 → 列表概要「已连通」）。仅内存，不持久化。
 */
function testedSig(type, prev, payload) {
  const cfg = mergeConfig(prev, payload)
  return JSON.stringify([
    connSignature(type, cfg),
    cfg.bearerMasked || '',
    cfg.credentialMasked || '',
    (cfg.authParams || []).map((r) => r.valueMasked || ''),
    (cfg.envVars || []).map((r) => r.valueMasked || '')
  ])
}
let lastTest = null // { sourceId: string|null, sig, result: { verifyStatus, verifiedAt, verifyError } }
const pickVerify = (r) => ({ verifyStatus: r.verifyStatus, verifiedAt: r.verifiedAt, verifyError: r.verifyError })
export async function createSource(payload) {
  await delay()
  validateSource(payload)
  validateSourceConfig(payload, null)
  const s = mkSrc(nid('ks'), payload.sourceType, payload.name.trim(), mergeConfig(null, payload), 'UNVERIFIED', payload.status || 'ENABLED')
  // 新建保存未测试前「未验证」；新建态里已对这份配置测试过 → 沿用测试结果（md §八.1）
  if (s.sourceType !== 'UPLOAD' && lastTest && lastTest.sourceId === null && lastTest.sig === testedSig(s.sourceType, null, payload)) {
    Object.assign(s, pickVerify(lastTest.result))
    lastTest = null
  }
  sources = [s, ...sources]
  persist()
  return sourceVO(s)
}
export async function updateSource(id, payload) {
  await delay()
  const s = findSource(id)
  // 被知识库引用时不允许停用（2026-09-09 负责人拍板「数据源被绑定时不允许停用，必须先解除
  // 关联」）——与删除保护同一口径，使「停用的数据源不可被引用」在数据上恒成立：既不能引用
  // 停用的源（候选列表已过滤），也不能把已被引用的源停用。
  // 放在字段校验之前：这道拦截与配置填得对不对无关，不该被校验错误盖过。
  if ((payload.status || s.status) === 'DISABLED' && s.status !== 'DISABLED') {
    const refs = referencedBy(id)
    if (refs.length) conflict(`正被知识库引用，请先解除引用后再停用（${refs.map((r) => r.name).join('、')}）`)
  }
  validateSource(payload, id)
  validateSourceConfig(payload, s)
  const cfg = mergeConfig(s, payload)
  const connChanged = connSignature(s.sourceType, s.config) !== connSignature(s.sourceType, cfg) || hasNewSecret(payload)
  // 改动后的配置恰是最近一次连接测试的那份 → 不重置，沿用测试结果（2026-09-08 决议第 9 项）
  const justTested = lastTest && lastTest.sourceId === id && lastTest.sig === testedSig(s.sourceType, s, payload)
  Object.assign(s, { name: payload.name.trim(), status: payload.status || s.status, config: cfg })
  // 修改请求地址 / 鉴权 / 映射（API）或服务地址 / 鉴权 / 工具（MCP）后保存 → 验证状态重置为未验证（md §六.4 / §七.5）
  if (connChanged && s.sourceType !== 'UPLOAD') {
    Object.assign(s, justTested ? pickVerify(lastTest.result) : { verifyStatus: 'UNVERIFIED', verifiedAt: null, verifyError: null })
  }
  if (justTested) lastTest = null
  persist()
  return sourceVO(s)
}
export async function removeSource(id) {
  await delay()
  const s = findSource(id)
  const refs = referencedBy(id)
  // 被知识库引用的数据源不可删除（md §四.2）
  if (refs.length) conflict(`正被知识库引用，请先解除引用（${refs.map((r) => r.name).join('、')}）`)
  sources = sources.filter((x) => x.id !== id)
  delete docsBySource[id] // 上传数据源删除时同时删除其文档和索引数据（md §四.2）
  delete seedDocCount[id]
  persist()
  return null
}
export async function testSource(sourceType, payload) {
  await delay(900)
  const cfg = payload?.config || {}
  const target = sourceType === 'API' ? cfg.url : cfg.transport === 'stdio' ? cfg.command : cfg.endpoint
  if (!target) {
    throw new ApiError({
      message: sourceType === 'API' ? '请先填写请求地址' : cfg.transport === 'stdio' ? '请先选择 Command' : '请先填写 MCP 服务地址',
      code: 400
    })
  }
  const failed = /fail|timeout/i.test(String(target))
  // MCP 测试成功返回固定工具清单（md §七.3：直接填写时需先完成连接测试以获取工具列表）
  const result = failed
    ? { verifyStatus: 'FAILED', verifiedAt: new Date().toISOString(), verifyError: 'TIMEOUT: 连接超时（8000 ms）', latencyMs: 8000 }
    : {
        verifyStatus: 'SUCCESS',
        verifiedAt: new Date().toISOString(),
        verifyError: null,
        latencyMs: 168,
        ...(sourceType === 'MCP' ? { tools: [...MCP_TEST_TOOLS], toolCount: MCP_TEST_TOOLS.length } : {})
      }
  // 回写：仅当「本次测的配置」与库内已保存的配置一致时才立即写回该行（列表概要随之变为
  // 「已连通」/「连接失败」，决议第 9 项要的「测完不用保存就能看到」）；若表单里还带着未保存的
  // 连接相关改动（地址/鉴权/映射/工具等，含尚未落库的新密钥），只记 lastTest 供保存时判定复用，
  // 不碰库内行——否则【取消】不会回滚，库内行会被一次针对草稿改动的测试结果污染（2026-09-23
  // 待办 yuepu#7⑦：改坏地址测试后取消，旧地址那行却被标了新结果，发布校验也跟着被放行/误拦）。
  const prev = payload?.sourceId ? sources.find((x) => x.id === payload.sourceId) : null
  const draftUnsaved =
    prev &&
    (connSignature(sourceType, prev.config) !== connSignature(sourceType, mergeConfig(prev, payload)) ||
      hasNewSecret(payload))
  if (prev && !draftUnsaved) {
    Object.assign(prev, pickVerify(result))
    persist()
  }
  lastTest = { sourceId: prev ? prev.id : null, sig: testedSig(sourceType, prev, payload || {}), result: pickVerify(result) }
  return result
}
// 「引用现有 MCP」模式已删除（2026-09-07 PRD-20260904 md §七.1 仅直接填写），
// 原 mcpTools(mcpId) / mcps() 连接器同源取数一并移除；工具清单改由 testSource 成功返回。

/* ---- 文档（上传类数据源持有，md §五.3） ---- */
export async function listDocs(sourceId) {
  await delay(150)
  findSource(sourceId)
  let changed = false
  if (!docsBySource[sourceId] && seedDocCount[sourceId]) {
    docsBySource[sourceId] = Array.from({ length: 3 }, (_, i) => ({ id: nid('doc'), fileName: `示例文档-${i + 1}.pdf`, size: (i + 1) * 1.3 * 1024 * 1024, chunkCount: 60 + i * 17, parseStatus: 'PARSED', errorReason: null }))
    seedDocCount[sourceId] = 0
    changed = true
  }
  const docs = docsBySource[sourceId] || []
  const now = Date.now()
  docs.forEach((d) => {
    // 解析流转示意：PENDING → PARSING（下一次读到）→ PARSED（到达 parseReadyAt 后），供 3 秒轮询观测
    if (d.parseStatus === 'PENDING') {
      d.parseStatus = 'PARSING'
      changed = true
    } else if (d.parseStatus === 'PARSING' && (!d.parseReadyAt || now >= d.parseReadyAt)) {
      Object.assign(d, { parseStatus: 'PARSED', chunkCount: Math.max(12, Math.round(d.size / 20000)), parseReadyAt: undefined })
      changed = true
    }
  })
  if (changed) persist()
  return docs.map((d) => ({ ...d }))
}
export async function uploadDoc(sourceId, file) {
  await delay(600)
  findSource(sourceId)
  const d = { id: nid('doc'), fileName: file.name, size: file.size, chunkCount: 0, parseStatus: 'PENDING', parseReadyAt: Date.now() + 6000, errorReason: null }
  docsBySource[sourceId] = [...(docsBySource[sourceId] || []), d]
  persist()
  return { ...d }
}
export async function deleteDoc(sourceId, docId) {
  await delay(200)
  findSource(sourceId)
  docsBySource[sourceId] = (docsBySource[sourceId] || []).filter((d) => d.id !== docId)
  persist()
  return null
}

/* ---- 选择器 ---- */
export async function experts() {
  await delay(100)
  return EXPERTS.map((e) => ({ ...e }))
}
export async function positions() {
  await delay(100)
  return listAllPositions()
}
export async function embeddingModels() {
  await delay(100)
  return EMBEDDING_MODELS.map((m) => ({ ...m }))
}
