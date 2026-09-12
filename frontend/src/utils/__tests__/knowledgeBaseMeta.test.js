import { describe, it, expect } from 'vitest'
import {
  API_DEFAULTS,
  MCP_DEFAULTS,
  UPLOAD_DEFAULTS,
  API_METHOD_OPTIONS,
  KB_ACTION_CONFIRMS,
  publishBlockReason,
  sourceRefsChanged,
  stateMeta,
  isOffline,
  isOnline
} from '@/utils/knowledgeBaseMeta'

/**
 * knowledgeBaseMeta 纯函数 / 常量守卫（2026-09-12 测试审计新建，E5）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 * - §六.1 L273-275 API 连接配置默认值：方法 POST / 鉴权 **API KEY** / 超时 8000；
 * - §七.2.1 L363 MCP streamable-http 鉴权默认 **无鉴权**；§七.4 L406 超时默认 10000（1000～120000）；
 * - §三.4.3 行内操作确认弹窗四组文案；§三.6 发布完整校验 5 条；§三.5 关键变更判定；§三.2 状态三态。
 *
 * 为什么单独钉 API / MCP 默认鉴权：两处默认值恰好相反（API 默认 API KEY、MCP 默认无鉴权），
 * 2026-09-09 PRD 复核 P0 曾发现被写反（编辑器新建态一打开就选错鉴权），此处防回归。
 */
describe('knowledgeBaseMeta · API_DEFAULTS / MCP_DEFAULTS 默认值方向（md §六.1 / §七.2.1 / §七.4）', () => {
  it('API 新建默认：鉴权 API_KEY、方法 POST、超时 8000ms、地址空（md §六.1 L272-275）', () => {
    expect(API_DEFAULTS).toEqual({ url: '', method: 'POST', authType: 'API_KEY', timeoutMs: 8000 })
    expect(API_METHOD_OPTIONS).toEqual(['POST', 'GET', 'PUT', 'DELETE', 'PATCH'])
    expect(API_METHOD_OPTIONS[0]).toBe(API_DEFAULTS.method)
  })

  it('MCP 新建默认：鉴权 none（无鉴权）、传输 streamable-http、Command npx、超时 10000ms（md §七.2.1 L363 / §七.4 L406）', () => {
    expect(MCP_DEFAULTS).toEqual({
      transport: 'streamable-http',
      endpoint: '',
      authType: 'none',
      authHeaderName: '',
      command: 'npx',
      timeoutMs: 10000
    })
  })

  it('两处默认鉴权方向相反（API=API_KEY、MCP=none），不得互抄（09-09 P0 取反修复防回归）', () => {
    expect(API_DEFAULTS.authType).toBe('API_KEY')
    expect(MCP_DEFAULTS.authType).toBe('none')
    expect(API_DEFAULTS.authType).not.toBe(MCP_DEFAULTS.authType)
    // 两个常量都是冻结对象，运行时不可被页面误改
    expect(Object.isFrozen(API_DEFAULTS)).toBe(true)
    expect(Object.isFrozen(MCP_DEFAULTS)).toBe(true)
  })

  it('上传源默认：仅「提取 URL 和邮箱地址」开启、混合检索、Top K 5、向量模型留空待选（md §五.1）', () => {
    expect(UPLOAD_DEFAULTS).toMatchObject({ docKind: 'DOC', replaceWhitespace: false, extractContacts: true, plainTable: false, embeddingModelId: '', retrieval: 'HYBRID', topK: 5 })
    expect(UPLOAD_DEFAULTS).not.toHaveProperty('threshold')
  })
})

describe('knowledgeBaseMeta · 行内操作确认弹窗文案（md §三.4.3 L123-126 逐字）', () => {
  it.each([
    ['publish', '提交发布', '提交后进入审核流程，审核通过后对可见范围生效。确认提交？', '提交发布', '已提交发布，等待审核'],
    ['delist', '提交停用', '提交停用后进入审核，审核通过前该知识库对可见范围仍然生效。确认提交？', '提交停用', '已提交停用，等待审核'],
    ['withdraw', '撤回提交', '撤回本次提交后将回到修改前状态。确认撤回？', '撤回', '已撤回'],
    ['remove', '删除知识库', '删除后配置无法恢复，确认删除？', '删除', '知识库已删除']
  ])('%s → 标题「%s」/ 正文 / 确认按钮「%s」/ toast', (key, title, content, confirmText, toast) => {
    expect(KB_ACTION_CONFIRMS[key]).toEqual({ title, content, confirmText, toast })
  })
})

describe('knowledgeBaseMeta · publishBlockReason 发布完整校验（md §三.6 五条，按顺序取第一条）', () => {
  const okUpload = { id: 's1', name: '产品资料', sourceType: 'UPLOAD', status: 'ENABLED', docCount: 3, parsedDocCount: 2 }
  const okApi = { id: 's2', name: '检索接口', sourceType: 'API', status: 'ENABLED', verifyStatus: 'SUCCESS' }
  const base = { name: '库', description: '描述', kbType: 'ENTERPRISE', scopeRefId: null, sources: [okUpload, okApi] }

  it('全部满足 → null（可发布）', () => {
    expect(publishBlockReason(base)).toBeNull()
  })
  it('① 名称 / 描述缺失 → 「请填写知识库名称」/「请填写知识库描述」', () => {
    expect(publishBlockReason({ ...base, name: ' ' })).toBe('请填写知识库名称')
    expect(publishBlockReason({ ...base, description: '' })).toBe('请填写知识库描述')
  })
  it('⑤ 专家 / 岗位库未选可见对象 → 「请选择可见范围专家」/「请选择可见范围岗位」', () => {
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefId: '' })).toBe('请选择可见范围专家')
    expect(publishBlockReason({ ...base, kbType: 'POSITION', scopeRefId: null })).toBe('请选择可见范围岗位')
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefId: 'ex_1' })).toBeNull()
  })
  it('② 无已启用数据源（空 / 全停用）→ 「至少引用 1 个已启用数据源才能提交发布」', () => {
    expect(publishBlockReason({ ...base, sources: [] })).toBe('至少引用 1 个已启用数据源才能提交发布')
    expect(publishBlockReason({ ...base, sources: [{ ...okUpload, status: 'DISABLED' }] })).toBe('至少引用 1 个已启用数据源才能提交发布')
  })
  it('③ 上传源无解析成功文档 → 「上传数据源「X」至少要有 1 个解析成功文档」（parsedDocCount 缺省时退回 docCount）', () => {
    expect(publishBlockReason({ ...base, sources: [{ ...okUpload, parsedDocCount: 0 }] })).toBe('上传数据源「产品资料」至少要有 1 个解析成功文档')
    expect(publishBlockReason({ ...base, sources: [{ ...okUpload, parsedDocCount: undefined, docCount: 0 }] })).toBe('上传数据源「产品资料」至少要有 1 个解析成功文档')
    expect(publishBlockReason({ ...base, sources: [{ ...okUpload, parsedDocCount: undefined, docCount: 1 }] })).toBeNull()
  })
  it('④ API / MCP 源最近一次连接测试未成功 → 「API 数据源「X」需最近一次连接测试成功」', () => {
    expect(publishBlockReason({ ...base, sources: [{ ...okApi, verifyStatus: 'FAILED' }] })).toBe('API 数据源「检索接口」需最近一次连接测试成功')
    expect(publishBlockReason({ ...base, sources: [{ id: 's3', name: '法规 MCP', sourceType: 'MCP', status: 'ENABLED', verifyStatus: 'UNVERIFIED' }] })).toBe('MCP 数据源「法规 MCP」需最近一次连接测试成功')
  })
})

describe('knowledgeBaseMeta · 状态与关键变更（md §三.2 / §三.5）', () => {
  it('stateMeta：pendingAction 优先显「审核中」；否则按 status 显 未发布 / 已发布', () => {
    expect(stateMeta({ status: 'DRAFT', pendingAction: null })).toEqual({ label: '未发布', type: 'info' })
    expect(stateMeta({ status: 'PUBLISHED', pendingAction: null })).toEqual({ label: '已发布', type: 'success' })
    expect(stateMeta({ status: 'PUBLISHED', pendingAction: 'DELIST' })).toEqual({ label: '审核中', type: 'warning' })
    expect(stateMeta({ status: 'DRAFT', pendingAction: 'PUBLISH' })).toEqual({ label: '审核中', type: 'warning' })
  })
  it('isOffline / isOnline：审核中两者皆否', () => {
    expect(isOffline({ status: 'DRAFT', pendingAction: null })).toBe(true)
    expect(isOnline({ status: 'PUBLISHED', pendingAction: null })).toBe(true)
    expect(isOffline({ status: 'DRAFT', pendingAction: 'PUBLISH' })).toBe(false)
    expect(isOnline({ status: 'PUBLISHED', pendingAction: 'DELIST' })).toBe(false)
  })
  it('sourceRefsChanged：集合比对（顺序无关），增删替换任一即为关键变更', () => {
    expect(sourceRefsChanged(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sourceRefsChanged(['a'], ['a', 'b'])).toBe(true)
    expect(sourceRefsChanged(['a', 'b'], ['a'])).toBe(true)
    expect(sourceRefsChanged(['a'], ['c'])).toBe(true)
    expect(sourceRefsChanged(undefined, [])).toBe(false)
  })
})
