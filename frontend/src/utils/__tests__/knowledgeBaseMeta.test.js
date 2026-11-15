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
  isOnline,
  scopeText,
  scopeFullText,
  mkResponseMapRows,
  mkMcpResponseMapRows,
  validateResponseMap,
  validateMcpResponseMap,
  mkMcpToolConfig,
  validateMcpToolConfig,
  resolveMcpResultRoot,
  pickResultArray,
  evalMcpResultArray
} from '@/utils/knowledgeBaseMeta'

/**
 * knowledgeBaseMeta 纯函数 / 常量守卫（2026-09-12 测试审计新建，E5）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 * - §六.1 连接配置表「请求方法…默认 POST」「鉴权方式…默认 API KEY」「超时时间 1000～60000ms，默认 8000ms」；
 * - §七.2.1 streamable-http「鉴权方式…默认无鉴权」；§七.6 超时时间「取值范围 1000～120000ms，默认 10000ms」；
 * - §三.4.3 行内操作确认弹窗四组文案；§三.6 发布完整校验 5 条；§三.5 关键变更判定；§三.2 状态三态。
 *
 * 为什么单独钉 API / MCP 默认鉴权：两处默认值恰好相反（API 默认 API KEY、MCP 默认无鉴权），
 * 2026-09-09 PRD 复核 P0 曾发现被写反（编辑器新建态一打开就选错鉴权），此处防回归。
 */
describe('knowledgeBaseMeta · API_DEFAULTS / MCP_DEFAULTS 默认值方向（md §六.1 / §七.2.1 / §七.6）', () => {
  it('API 新建默认：鉴权 API_KEY、方法 POST、超时 8000ms、地址空（md §六.1 连接配置表）', () => {
    expect(API_DEFAULTS).toEqual({ url: '', method: 'POST', authType: 'API_KEY', timeoutMs: 8000 })
    expect(API_METHOD_OPTIONS).toEqual(['POST', 'GET', 'PUT', 'DELETE', 'PATCH'])
    expect(API_METHOD_OPTIONS[0]).toBe(API_DEFAULTS.method)
  })

  it('MCP 新建默认：鉴权 none（无鉴权）、传输 streamable-http、Command npx、超时 10000ms（md §七.2.1 / §七.6）', () => {
    // 结果数组路径不在数据源级默认值里：改为每个检索工具各配一份，且新建留空（产品优化需求-202611 修改点 9 / 10）
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
    expect(UPLOAD_DEFAULTS).toMatchObject({ docKind: 'DOC', extractContacts: true, plainTable: false, embeddingModelId: '', retrieval: 'HYBRID', topK: 5 })
    expect(UPLOAD_DEFAULTS).not.toHaveProperty('threshold')
    expect(UPLOAD_DEFAULTS).not.toHaveProperty('replaceWhitespace')
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
  const base = { name: '库', icon: '📘', description: '描述', kbType: 'ENTERPRISE', scopeRefIds: [], sources: [okUpload, okApi] }

  it('全部满足 → null（可发布）', () => {
    expect(publishBlockReason(base)).toBeNull()
  })
  it('① 名称 / 描述缺失 → 「请填写知识库名称」/「请填写知识库描述」', () => {
    expect(publishBlockReason({ ...base, name: ' ' })).toBe('请填写知识库名称')
    expect(publishBlockReason({ ...base, description: '' })).toBe('请填写知识库描述')
  })
  it('① 图标缺失（含纯空白 / 缺键）→ 「请选择知识库图标」；名称、描述都填了才轮到它（待办 yuepu#34：查看态发布只靠这道门，此前漏查）', () => {
    expect(publishBlockReason({ ...base, icon: '' })).toBe('请选择知识库图标')
    expect(publishBlockReason({ ...base, icon: '   ' })).toBe('请选择知识库图标')
    const { icon, ...noIconKey } = base
    expect(publishBlockReason(noIconKey)).toBe('请选择知识库图标')
    expect(publishBlockReason({ ...base, icon: '/api/public/icons/kb.png' })).toBeNull()
    expect(publishBlockReason({ ...base, name: '', icon: '' })).toBe('请填写知识库名称')
    expect(publishBlockReason({ ...base, description: '', icon: '' })).toBe('请填写知识库描述')
  })
  // 已保存的专家 / 岗位库至少选过 1 个对象，可见范围为空只可能是对象都被删了：与列表「无有效专家 / 岗位」同一种说法（R3）
  it('⑤ 专家 / 岗位库可见范围为空（空数组 / 缺键）→ 「可见范围无有效专家 / 岗位，请重新选择后再发布」；选了即放行', () => {
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefIds: [] })).toBe('可见范围无有效专家，请重新选择后再发布')
    const { scopeRefIds, ...noScopeKey } = base
    expect(publishBlockReason({ ...noScopeKey, kbType: 'POSITION' })).toBe('可见范围无有效岗位，请重新选择后再发布')
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefIds: [201] })).toBeNull()
  })
  it('⑤ yuepu#62⑧ 可见对象已不存在（候选路径）：所选 id 一个都不在候选 id 列表里 → 同「无有效专家 / 岗位」', () => {
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefIds: [999, 998] }, { scopeOptionIds: [201] })).toBe('可见范围无有效专家，请重新选择后再发布')
    expect(publishBlockReason({ ...base, kbType: 'POSITION', scopeRefIds: [401] }, { scopeOptionIds: ['402'] })).toBe('可见范围无有效岗位，请重新选择后再发布')
  })
  it('⑤ R3 多选：所选对象里至少 1 个仍在候选中即放行（部分被删不拦；id 数字 / 字符串同视）', () => {
    expect(publishBlockReason({ ...base, kbType: 'POSITION', scopeRefIds: [999, 401] }, { scopeOptionIds: ['401', '402'] })).toBeNull()
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefIds: [201] }, { scopeOptionIds: ['201'] })).toBeNull()
  })
  it('⑤ yuepu#62⑧ 可见对象已不存在（VO 路径）：行上解析出的 scopeRefNames 为空数组 → 拦；有名称则放行', () => {
    expect(publishBlockReason({ ...base, kbType: 'EXPERT', scopeRefIds: [999], scopeRefNames: [] })).toBe('可见范围无有效专家，请重新选择后再发布')
    expect(publishBlockReason({ ...base, kbType: 'POSITION', scopeRefIds: [401, 999], scopeRefNames: ['经营分析岗'] })).toBeNull()
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

/**
 * 列表「可见范围」列文案（产品优化需求-202611 R3：可见范围改多选）：
 * 「列表「可见范围」列展示前 2 个名称，超过时显示"等 N 位"（专家）或"等 N 个"（岗位），悬停展示全部」；
 * 「某个知识库因此一个对象都没有时，可见范围标"无有效专家"或"无有效岗位"」。
 */
describe('knowledgeBaseMeta · scopeText / scopeFullText 可见范围文案（R3 多选）', () => {
  it('企业知识库 → 「全员」（列表与悬停同文）', () => {
    expect(scopeText({ kbType: 'ENTERPRISE', scopeRefNames: [] })).toBe('全员')
    expect(scopeFullText({ kbType: 'ENTERPRISE', scopeRefNames: [] })).toBe('全员')
  })
  it('不超过 2 个名称 → 全部展示，顿号连接，不带「等 N」', () => {
    expect(scopeText({ kbType: 'EXPERT', scopeRefNames: ['经营分析专家'] })).toBe('专家：经营分析专家')
    expect(scopeText({ kbType: 'POSITION', scopeRefNames: ['经营分析岗', '市场研究岗'] })).toBe('岗位：经营分析岗、市场研究岗')
  })
  it('专家超过 2 位 → 前 2 个名称 +「等 N 位」', () => {
    expect(scopeText({ kbType: 'EXPERT', scopeRefNames: ['甲专家', '乙专家', '丙专家'] })).toBe('专家：甲专家、乙专家 等 3 位')
  })
  it('岗位超过 2 个 → 前 2 个名称 +「等 N 个」', () => {
    expect(scopeText({ kbType: 'POSITION', scopeRefNames: ['甲岗', '乙岗', '丙岗', '丁岗'] })).toBe('岗位：甲岗、乙岗 等 4 个')
  })
  it('一个有效对象都没有（被删光 / 未解析出名称）→ 「无有效专家」/「无有效岗位」', () => {
    expect(scopeText({ kbType: 'EXPERT', scopeRefIds: [999], scopeRefNames: [] })).toBe('无有效专家')
    expect(scopeText({ kbType: 'POSITION', scopeRefIds: [] })).toBe('无有效岗位')
  })
  it('scopeFullText（悬停）→ 全部名称，不截断', () => {
    expect(scopeFullText({ kbType: 'EXPERT', scopeRefNames: ['甲专家', '乙专家', '丙专家'] })).toBe('专家：甲专家、乙专家、丙专家')
    expect(scopeFullText({ kbType: 'POSITION', scopeRefNames: ['甲岗', '乙岗', '丙岗'] })).toBe('岗位：甲岗、乙岗、丙岗')
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

describe('knowledgeBaseMeta · 响应字段映射（2026-09-18 推翻 09-08 决议，API §六.3 / MCP §七.5 同一套显式改名机制）', () => {
  it('mkResponseMapRows（API）：预设 content/source/score，接口返回字段名默认与参数名同名（延续改造前"不做改名映射"口径）', () => {
    expect(mkResponseMapRows()).toEqual([
      { name: 'content', sourceField: 'content', description: '内容', type: 'string', preset: true },
      { name: 'source', sourceField: 'source', description: '来源', type: 'string', preset: true },
      { name: 'score', sourceField: 'score', description: '相关度分数', type: 'number', preset: true }
    ])
  })
  it('mkMcpResponseMapRows（MCP）：预设 title/content/sourceName，接口返回字段名默认留空待管理员填写', () => {
    expect(mkMcpResponseMapRows()).toEqual([
      { name: 'title', sourceField: '', description: '标题', type: 'string', preset: true },
      { name: 'content', sourceField: '', description: '内容', type: 'string', preset: true },
      { name: 'sourceName', sourceField: '', description: '来源名称', type: 'string', preset: true }
    ])
  })
  it('validateResponseMap（API）：预设行清空接口返回字段名即报错；自定义行须补全参数名 / 接口返回字段名 / 变量类型', () => {
    const cleared = mkResponseMapRows().map((r) => (r.name === 'source' ? { ...r, sourceField: '' } : r))
    expect(validateResponseMap(cleared)).toBe('响应字段映射：source 需填写接口返回字段名')
    const dupName = [...mkResponseMapRows(), { name: 'content', sourceField: 'x', description: '', type: 'string', preset: false }]
    expect(validateResponseMap(dupName)).toBe('响应字段映射：参数名重复（content）')
    expect(validateResponseMap(mkResponseMapRows())).toBe('')
    expect(validateResponseMap([])).toBe('响应字段映射至少存在一条输出参数')
  })
  it('validateMcpResponseMap（MCP）：结果数组路径必填；title/content 必须填接口返回字段名，sourceName 可留空', () => {
    const filled = mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: r.name === 'sourceName' ? '' : 'text' }))
    expect(validateMcpResponseMap(filled, '')).toBe('请填写结果数组路径')
    expect(validateMcpResponseMap(filled, '$.content[0].items[*]')).toBe('')
    const missingTitle = filled.map((r) => (r.name === 'title' ? { ...r, sourceField: '' } : r))
    expect(validateMcpResponseMap(missingTitle, '$.content[0].items[*]')).toBe('响应字段：title 需填写接口返回字段名')
    // sourceName 留空不报错（留空则取数据源名称）
    expect(validateMcpResponseMap(mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: r.name === 'sourceName' ? '' : 'text' })), '$.a[*]')).toBe('')
  })
})

/**
 * MCP 检索工具的映射配置（产品优化需求-202611 修改点 10（R7）方案 A）：
 * 「每个已勾选的工具单独一张配置卡……卡内是该工具的请求参数映射、结果数组路径和响应字段映射」；
 * 修改点 9（R6）：「新建数据源时结果数组路径留空，示例只作占位提示，不预填」。
 */
describe('knowledgeBaseMeta · MCP 检索工具配置（R7 方案 A / R6）', () => {
  it('mkMcpToolConfig：新勾选工具的空白配置——请求预设 query/topK、结果数组路径留空（不预填示例）、响应预设三行待填', () => {
    const tc = mkMcpToolConfig()
    expect(tc.resultArrayPath).toBe('')
    expect(tc.requestMap.map((r) => r.name)).toEqual(['query', 'topK'])
    expect(tc.responseMap.map((r) => [r.name, r.sourceField])).toEqual([['title', ''], ['content', ''], ['sourceName', '']])
  })
  it('validateMcpToolConfig：空白配置不完整（缺结果数组路径），补齐路径与 title / content 后两段错误都为空', () => {
    expect(validateMcpToolConfig(mkMcpToolConfig())).toEqual({ request: '', response: '请填写结果数组路径' })
    const filled = { ...mkMcpToolConfig(), resultArrayPath: '$.items[*]' }
    filled.responseMap = filled.responseMap.map((r) => ({ ...r, sourceField: r.name === 'sourceName' ? '' : r.name }))
    expect(validateMcpToolConfig(filled)).toEqual({ request: '', response: '' })
  })
})

/**
 * 结果数组路径的取值口径（产品优化需求-202611 修改点 9（R6），口径待研发确认，demo 按草案建议口径）：
 * 「工具返回带 structuredContent 时以它为根；否则取第一个 type 为 text 的内容块，把 text 按 JSON 解析后作为根。
 *  路径从根写起，如 $.items[*]、$.data.list[*]」；
 * 「按路径取不到数组时，提示"按结果数组路径未取到数组，请检查路径"；text 不是合法 JSON 时，提示"工具返回内容不是 JSON，无法按路径取值"」。
 */
describe('knowledgeBaseMeta · MCP 结果数组路径取值（R6）', () => {
  const textResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })

  it('无 structuredContent：取第一个 text 块解析出的 JSON 为根，$.items[*] 取到数组', () => {
    expect(evalMcpResultArray(textResult({ items: [{ t: 1 }, { t: 2 }] }), '$.items[*]')).toEqual({ items: [{ t: 1 }, { t: 2 }] })
  })
  it('多个内容块时跳过非 text 块，取第一个 type 为 text 的块', () => {
    const r = { content: [{ type: 'image', data: 'xx' }, { type: 'text', text: '{"data":{"list":[1,2,3]}}' }, { type: 'text', text: '{"data":{"list":[9]}}' }] }
    expect(resolveMcpResultRoot(r)).toEqual({ root: { data: { list: [1, 2, 3] } } })
  })
  it('带 structuredContent：以它为根，text 即使不是 JSON 也不影响取值', () => {
    const r = { content: [{ type: 'text', text: '命中 2 条' }], structuredContent: { results: [{ a: 1 }, { a: 2 }] } }
    expect(evalMcpResultArray(r, '$.results[*]')).toEqual({ items: [{ a: 1 }, { a: 2 }] })
  })
  it('路径写进协议层（$.content[0].items[*]）→ 从结果数据的根取不到 →「按结果数组路径未取到数组，请检查路径」', () => {
    expect(evalMcpResultArray(textResult({ items: [1] }), '$.content[0].items[*]')).toEqual({ error: '按结果数组路径未取到数组，请检查路径' })
  })
  it('无 structuredContent 且 text 不是合法 JSON →「工具返回内容不是 JSON，无法按路径取值」', () => {
    expect(evalMcpResultArray({ content: [{ type: 'text', text: '共找到 2 条结果' }] }, '$.items[*]')).toEqual({ error: '工具返回内容不是 JSON，无法按路径取值' })
  })
  it('pickResultArray：点分多层 + [下标] + [*] 都能取；终点本身是数组时不写 [*] 也认', () => {
    const root = { data: { list: [{ id: 1 }, { id: 2 }] }, pages: [{ rows: ['a'] }, { rows: ['b', 'c'] }] }
    expect(pickResultArray(root, '$.data.list[*]')).toEqual([{ id: 1 }, { id: 2 }])
    expect(pickResultArray(root, '$.pages[1].rows[*]')).toEqual(['b', 'c'])
    expect(pickResultArray(root, '$.data.list')).toEqual([{ id: 1 }, { id: 2 }])
  })
  it('pickResultArray：终点不是数组 / 中途字段不存在 / 不以 $ 开头 → 取不到（null）', () => {
    const root = { total: 2, data: { list: [1, 2] } }
    expect(pickResultArray(root, '$.total')).toBeNull()
    expect(pickResultArray(root, '$.data.rows[*]')).toBeNull()
    expect(pickResultArray(root, 'data.list[*]')).toBeNull()
  })
})
