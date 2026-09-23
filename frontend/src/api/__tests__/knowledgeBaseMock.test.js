// @vitest-environment jsdom
// （knowledgeBaseMock → request.js → router 链路触达 window，故用 jsdom；同 adminModelMock.test.js）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写的行；状态机链路在单个用例内自洽驱动。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  list,
  get,
  create,
  update,
  remove,
  transition,
  search,
  listSources,
  getSource,
  createSource,
  updateSource,
  removeSource,
  testSource,
  listDocs,
  uploadDoc,
  MCP_TEST_TOOLS
} from '../knowledgeBaseMock'
import { listReviews } from '../reviewsMock'
import { listMyApplications } from '../myApplicationsMock'
import { maskSecret } from '@/utils/secretMask'
import { mkRequestMapRows, mkRequestMapExampleRows, mkResponseMapRows, mkMcpResponseMapRows, UPLOAD_DEFAULTS } from '@/utils/knowledgeBaseMeta'

/**
 * knowledgeBaseMock 状态机与口径单测。
 *
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md（长期正本，git 直改）：
 * - 知识库：§三.3.1 基本信息（名称 ≤64 / 描述必填 ≤2000（2026-09-18 待办 yuepu#5 改，原 100/500）/ 类型创建后不可改 / 可见范围必选 / 图标）、
 *   §三.3.2 数据源引用（每类 ≤5）、§三.4 状态与操作、§三.5 已发布关键变更回未发布、§三.6 发布完整校验 5 条、
 *   §三.7 检索测试（失败源单列 errors、其余照常）；
 * - 数据源：§四.2 被引用不可删、§三.3.2 被引用不可停用（09-09 拍板）、§六.1 API 连接配置（地址 ≤500 / 方法 / 超时 1000～60000）、
 *   §六.1.1 API KEY 多参数表 / Bearer、§六.2-§六.3 映射预设行与递归子字段、§六.4 改配置重置未验证、
 *   §七.2 MCP 传输方式（endpoint / 鉴权 Header 名 / stdio Command 枚举与 envVars）、§七.3 工具 ≥1、§七.4 超时 1000～120000、
 *   §七.5 改工具重置、§八.1 列表概要（未验证 / 已连通 / 连接失败）、§五.3 文档解析流转。
 * - 持久化（mockPersist v8，11 个写点）读回 / 旧版本回种子 / 坏形状兜底（文末一组，vi.resetModules 隔离）。
 * K40（2026-09-12 闭环）：引用已停用数据源被数据层拒绝（md §三.3.2 L94）；UPLOAD 源三必填 + 文档类型校验（md §五.1）。
 */

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`
// 合法 API / MCP config 构造器（2026-09-07 PRD-20260904 数据源新口径对齐）
const apiConfig = (over = {}) => ({
  url: 'https://a.example.com/search',
  method: 'POST',
  authType: 'NONE',
  authParams: [],
  requestMap: mkRequestMapRows(),
  responseMap: mkResponseMapRows(),
  timeoutMs: 8000,
  ...over
})
const mcpResponseMap = () => mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: r.name === 'sourceName' ? '' : 'text' }))
const mcpConfig = (over = {}) => ({
  transport: 'streamable-http',
  endpoint: 'https://mcp.example.com/mcp',
  authType: 'none',
  authHeaderName: '',
  command: 'npx',
  args: [],
  envVars: [],
  tools: ['search_documents'],
  requestMap: mkRequestMapRows(),
  responseMap: mcpResponseMap(),
  resultArrayPath: '$.content[0].items[*]',
  timeoutMs: 10000,
  ...over
})

describe('knowledgeBaseMock —— 知识库状态机（md §三.3-§三.6）', () => {
  it('创建：描述必填（md §三.3.1），缺失时报错并带 field', async () => {
    await expect(create({ name: uniq('无描述库'), kbType: 'ENTERPRISE', sourceIds: [] })).rejects.toMatchObject({
      field: 'description'
    })
  })

  it('发布完整校验（md §三.6）：无已启用数据源的草稿提交发布被拦、不进审核中', async () => {
    const kb = await create({ name: uniq('空源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [] })
    await expect(transition(kb.id, 'publish')).rejects.toMatchObject({
      message: '至少引用 1 个已启用数据源才能提交发布'
    })
    const again = (await list({ keyword: kb.name })).list[0]
    expect(again.pendingAction).toBe(null)
    expect(again.status).toBe('DRAFT')
  })

  it('发布完整校验：引用连接失败的 API 源被拦，换成验证成功的源后可提交', async () => {
    const bad = await createSource({ sourceType: 'API', name: uniq('未验证接口'), config: apiConfig() })
    const kb = await create({ name: uniq('接口库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [bad.id] })
    await expect(transition(kb.id, 'publish')).rejects.toMatchObject({
      message: expect.stringContaining('需最近一次连接测试成功')
    })
    // 测试连接成功后重新提交 → 进入审核中（pendingAction=PUBLISH）
    await testSource('API', { sourceId: bad.id, config: apiConfig() })
    const pending = await transition(kb.id, 'publish')
    expect(pending.pendingAction).toBe('PUBLISH')
    expect(pending.status).toBe('DRAFT') // 审核通过前 status 不变，列表按 pendingAction 展示审核中
  })

  it('状态机链（种子 kb_2 已发布，自洽驱动）：停用→审核中→撤回→已发布→改引用→回未发布→发布→审核中→撤回', async () => {
    // 提交停用 → pendingAction=DELIST，status 仍 PUBLISHED（审核通过前对可见范围仍生效）
    let r = await transition('kb_2', 'delist')
    expect(r.pendingAction).toBe('DELIST')
    expect(r.status).toBe('PUBLISHED')
    // 审核中出现在 PENDING_REVIEW 筛选里（待发布与待停用统一展示审核中）
    const pendingList = await list({ status: 'PENDING_REVIEW' })
    expect(pendingList.list.some((x) => x.id === 'kb_2')).toBe(true)
    // 审核中不可编辑
    await expect(update('kb_2', { name: r.name, description: r.description, sourceIds: r.sourceIds })).rejects.toMatchObject({ code: 409 })
    // 撤回 → 恢复提交前状态（已发布）
    r = await transition('kb_2', 'withdraw')
    expect(r.pendingAction).toBe(null)
    expect(r.status).toBe('PUBLISHED')
    // 已发布改数据源引用 → 回未发布（md §三.5）
    r = await update('kb_2', { name: r.name, description: r.description, sourceIds: [...r.sourceIds, 'ks_1b'] })
    expect(r.status).toBe('DRAFT')
    // 重新提交发布（引用的上传源都有解析成功文档）→ 审核中；再撤回 → 未发布
    r = await transition('kb_2', 'publish')
    expect(r.pendingAction).toBe('PUBLISH')
    r = await transition('kb_2', 'withdraw')
    expect(r.status).toBe('DRAFT')
    expect(r.pendingAction).toBe(null)
  })

  // 2026-09-09 PRD 复核·G3G6 · A6（Q265③「知识库也需要发布审核，逻辑同 MCP/API/模型」；
  // md `prd.审核中心.md` §二.2/§3.1、`prd.我的申请.md` §二.2/§3.1 业务类型含知识库）
  it('A6 提交端接线：提交发布 → 审核中心与我的申请各出一条知识库行；撤回 → 审核行摘掉、申请行置已撤回', async () => {
    // reviewsMock / myApplicationsMock 用文件顶部静态导入（与 knowledgeBaseMock 内部引用同一实例）：
    // 文末持久化组会 vi.resetModules()，此处若动态 import 会拿到新实例，shuffle 后随机假红（2026-09-12 实测）
    const src = await createSource({ sourceType: 'API', name: uniq('接线接口'), config: apiConfig() })
    await testSource('API', { sourceId: src.id, config: apiConfig() })
    const kb = await create({ name: uniq('接线库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [src.id] })

    await transition(kb.id, 'publish')
    const inReview = (await listReviews({ type: 'KNOWLEDGE_BASE', size: 200 })).list.find((r) => r.refId === kb.id)
    expect(inReview).toBeTruthy()
    expect(inReview.requestAction).toBe('FIRST_PUBLISH')
    expect(inReview.status).toBe('PENDING_REVIEW')
    const inApps = (await listMyApplications({ businessType: 'KNOWLEDGE_BASE', size: 200 })).list.find((r) => r.refId === kb.id)
    expect(inApps).toBeTruthy()
    expect(inApps.result).toBe('PENDING')

    await transition(kb.id, 'withdraw')
    const gone = (await listReviews({ type: 'KNOWLEDGE_BASE', size: 200 })).list.find((r) => r.refId === kb.id)
    expect(gone).toBeUndefined() // 撤回 → 摘掉待审行
    const withdrawn = (await listMyApplications({ businessType: 'KNOWLEDGE_BASE', size: 200 })).list.find((r) => r.refId === kb.id)
    expect(withdrawn.result).toBe('WITHDRAWN') // 申请行保留，置已撤回（md §3.1 四态）
  })

  it('已发布改可见范围 → 回未发布重审（md §三.5）；名称描述照常保存不回退', async () => {
    // 种子 kb_4：岗位知识库（ps_1）已发布。
    // 2026-09-10 D3：岗位种子对齐岗位模块四岗后，ps_1/ps_2 = 经营分析岗/财务审核岗，名称与断言随种子更新。
    let r = await update('kb_4', { name: '经营分析指标口径库', description: '仅改描述不回退', sourceIds: ['ks_4a'], scopeRefId: 'ps_1' })
    expect(r.status).toBe('PUBLISHED')
    r = await update('kb_4', { name: '经营分析指标口径库', description: '换岗位要回退', sourceIds: ['ks_4a'], scopeRefId: 'ps_2' })
    expect(r.status).toBe('DRAFT')
    expect(r.scopeRefName).toBe('财务审核岗')
  })
})

describe('knowledgeBaseMock —— 数据源（md §四～§八）', () => {
  it('被知识库引用的数据源删除被阻断，提示语含 md 口径「正被知识库引用，请先解除引用」', async () => {
    // 种子 ks_1a 被 kb_1 引用（本文件不动 kb_1 / ks_1a）
    await expect(removeSource('ks_1a')).rejects.toMatchObject({
      code: 409,
      message: expect.stringContaining('正被知识库引用，请先解除引用')
    })
    // 未被引用的可删
    const s = await createSource({ sourceType: 'API', name: uniq('临时接口'), config: apiConfig() })
    await expect(removeSource(s.id)).resolves.toBe(null)
  })

  // 2026-09-09 负责人拍板「停用的数据源不可被引用」→ 落地为「被引用时不允许停用」，
  // 与删除保护同一口径，保证不存在「已停用但仍被引用」的数据（md §三.3.2）。
  it('被知识库引用的数据源停用被阻断；解除引用后可停用', async () => {
    await expect(updateSource('ks_1a', { name: '产品资料', status: 'DISABLED' })).rejects.toMatchObject({
      code: 409,
      message: expect.stringContaining('请先解除引用后再停用')
    })
    // 未被引用的可正常停用
    const s = await createSource({ sourceType: 'API', name: uniq('可停用接口'), config: apiConfig() })
    const off = await updateSource(s.id, { sourceType: 'API', name: s.name, status: 'DISABLED', config: apiConfig() })
    expect(off.status).toBe('DISABLED')
  })

  it('知识库引用已停用数据源 → 拒「已停用，不可被引用」并带 field=sourceIds；改回启用后可引用（md §三.3.2 L94，K40）', async () => {
    const off = await createSource({ sourceType: 'API', name: uniq('停用接口'), config: apiConfig() })
    await updateSource(off.id, { sourceType: 'API', name: off.name, status: 'DISABLED', config: apiConfig() })
    await expect(create({ name: uniq('引停用源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [off.id] })).rejects.toMatchObject({
      field: 'sourceIds',
      message: expect.stringContaining('已停用，不可被引用')
    })
    // 重新启用后可引用
    await updateSource(off.id, { sourceType: 'API', name: off.name, status: 'ENABLED', config: apiConfig() })
    const kb = await create({ name: uniq('引启用源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [off.id] })
    expect(kb.sources.map((x) => x.id)).toEqual([off.id])
    // 编辑已有库时同样拦（种子 ks_old 为停用源）
    await expect(update(kb.id, { name: kb.name, description: '测试用', sourceIds: ['ks_old'] })).rejects.toMatchObject({ field: 'sourceIds' })
  })

  it('UPLOAD 源保存校验（md §五.1 三必填）：缺向量模型 / 检索策略非法 / Top-K 越界或非整数 / 文档类型非法 各回 field；默认值 + 向量模型即可创建', async () => {
    const base = { ...UPLOAD_DEFAULTS, embeddingModelId: 'md_emb_1' }
    const mk = (over) => createSource({ sourceType: 'UPLOAD', name: uniq('上传源'), config: { ...base, ...over } })
    await expect(mk({ embeddingModelId: '' })).rejects.toMatchObject({ field: 'embeddingModelId', message: '请选择向量模型' })
    await expect(mk({ retrieval: 'FUZZY' })).rejects.toMatchObject({ field: 'retrieval', message: '请选择检索策略' })
    await expect(mk({ topK: 0 })).rejects.toMatchObject({ field: 'topK', message: 'Top-K 需为 1～20 的整数' })
    await expect(mk({ topK: 21 })).rejects.toMatchObject({ field: 'topK' })
    await expect(mk({ topK: 2.5 })).rejects.toMatchObject({ field: 'topK' })
    await expect(mk({ docKind: 'VIDEO' })).rejects.toMatchObject({ field: 'docKind', message: '请选择文档类型' })
    await expect(createSource({ sourceType: 'UPLOAD', name: uniq('零配置'), config: {} })).rejects.toMatchObject({ field: 'docKind' })
    const ok = await mk({ topK: 20, retrieval: 'KEYWORD', docKind: 'FAQ' })
    expect(ok.config).toMatchObject({ embeddingModelId: 'md_emb_1', retrieval: 'KEYWORD', topK: 20, docKind: 'FAQ' })
  })

  it('API 保存校验（md §六.1）：地址必填合法 / 方法枚举 / 超时范围', async () => {
    await expect(createSource({ sourceType: 'API', name: uniq('无地址'), config: apiConfig({ url: '' }) })).rejects.toMatchObject({ field: 'url' })
    await expect(createSource({ sourceType: 'API', name: uniq('坏地址'), config: apiConfig({ url: 'ftp://x' }) })).rejects.toMatchObject({ field: 'url' })
    await expect(createSource({ sourceType: 'API', name: uniq('坏方法'), config: apiConfig({ method: 'HEAD' }) })).rejects.toMatchObject({ field: 'method' })
    await expect(createSource({ sourceType: 'API', name: uniq('坏超时'), config: apiConfig({ timeoutMs: 500 }) })).rejects.toMatchObject({ field: 'timeoutMs' })
  })

  it('API KEY 多参数表校验（md §六.1.1）：至少一行有效参数；未勾客户端填写必须有参数值', async () => {
    // 零行有效参数 → 拦
    await expect(
      createSource({ sourceType: 'API', name: uniq('空鉴权'), config: apiConfig({ authType: 'API_KEY', authParams: [] }) })
    ).rejects.toMatchObject({ field: 'authParams' })
    // 未勾客户端填写且无值 → 拦
    await expect(
      createSource({
        sourceType: 'API',
        name: uniq('缺值鉴权'),
        config: apiConfig({ authType: 'API_KEY', authParams: [{ key: 'X-Api-Key', in: 'HEADER', clientFill: false, value: '' }] })
      })
    ).rejects.toMatchObject({ field: 'authParams' })
    // 勾了客户端填写可以不填平台值
    const ok = await createSource({
      sourceType: 'API',
      name: uniq('客户端填写鉴权'),
      config: apiConfig({ authType: 'API_KEY', authParams: [{ key: 'X-Api-Key', in: 'HEADER', clientFill: true }] })
    })
    expect(ok.config.authParams[0].clientFill).toBe(true)
  })

  it('敏感凭证保存即 maskSecret 掩码，明文不出 mock（md §四.3 / §八.2）；编辑留空=保留原掩码', async () => {
    const plain = 'sk-test-abcdefgh12345678'
    const s = await createSource({
      sourceType: 'API',
      name: uniq('鉴权接口'),
      config: apiConfig({ authType: 'API_KEY', authParams: [{ key: 'X-Api-Key', in: 'HEADER', clientFill: false, value: plain }] })
    })
    expect(s.config.authParams[0].valueMasked).toBe(maskSecret(plain))
    expect(JSON.stringify(s)).not.toContain(plain)
    // 编辑保存不带 value（留空）→ 掩码保留
    const s2 = await updateSource(s.id, {
      sourceType: 'API',
      name: s.name,
      config: apiConfig({ authType: 'API_KEY', authParams: [{ key: 'X-Api-Key', in: 'HEADER', clientFill: false, value: '' }] })
    })
    expect(s2.config.authParams[0].valueMasked).toBe(maskSecret(plain))
  })

  it('Bearer Token（md §六.1.1）：新建必填；保存后仅存掩码', async () => {
    await expect(
      createSource({ sourceType: 'API', name: uniq('缺Token'), config: apiConfig({ authType: 'BEARER' }) })
    ).rejects.toMatchObject({ field: 'authValue' })
    const token = 'bearer-demo-0123456789'
    const s = await createSource({ sourceType: 'API', name: uniq('Bearer接口'), config: apiConfig({ authType: 'BEARER' }), authValue: token })
    expect(s.config.bearerMasked).toBe(maskSecret(token))
    expect(JSON.stringify(s)).not.toContain(token)
  })

  it('请求 / 响应映射预设行（md §六.2 / §六.3）：缺预设或响应零输出参数 → 保存被拦', async () => {
    await expect(
      createSource({ sourceType: 'API', name: uniq('缺预设'), config: apiConfig({ requestMap: [] }) })
    ).rejects.toMatchObject({ field: 'requestMap' })
    await expect(
      createSource({ sourceType: 'API', name: uniq('空响应'), config: apiConfig({ responseMap: [] }) })
    ).rejects.toMatchObject({ field: 'responseMap' })
  })

  it('请求映射递归子字段校验（md §六.2）：object/array 至少一个有效子字段、同父下不重名、子字段名必填', async () => {
    const withReq = (custom) => apiConfig({ requestMap: [...mkRequestMapRows(), ...custom] })
    const row = (over) => ({ name: '', type: 'string', required: false, clientField: '', defaultValue: '', preset: false, children: [], ...over })
    // 空 object → 拦
    await expect(
      createSource({ sourceType: 'API', name: uniq('空object'), config: withReq([row({ name: 'filters', type: 'object' })]) })
    ).rejects.toMatchObject({ field: 'requestMap', message: expect.stringContaining('至少需要一个有效子字段') })
    // 子层重名 → 拦
    await expect(
      createSource({
        sourceType: 'API',
        name: uniq('子重名'),
        config: withReq([row({ name: 'filters', type: 'object', children: [row({ name: 'a' }), row({ name: 'a' })] })])
      })
    ).rejects.toMatchObject({ field: 'requestMap', message: expect.stringContaining('重复') })
    // 子字段填了默认值没填名 → 拦
    await expect(
      createSource({
        sourceType: 'API',
        name: uniq('子缺名'),
        config: withReq([row({ name: 'filters', type: 'object', children: [row({ defaultValue: 'x' })] })])
      })
    ).rejects.toMatchObject({ field: 'requestMap', message: expect.stringContaining('子字段名必填') })
    // 基础类型行不看 children（切基础类型时的草稿不提交）
    const basic = await createSource({
      sourceType: 'API',
      name: uniq('基础类型'),
      config: withReq([row({ name: 'flag', type: 'boolean', children: [row({ name: 'a' }), row({ name: 'a' })] })])
    })
    expect(basic.config.requestMap.length).toBe(3)
    // 新建默认示例组 filters→rules→field/value 三级可直接保存
    const ok = await createSource({ sourceType: 'API', name: uniq('示例组'), config: withReq(mkRequestMapExampleRows()) })
    const filters = ok.config.requestMap.find((r) => r.name === 'filters')
    expect(filters.type).toBe('object')
    expect(filters.children[0].name).toBe('rules')
    expect(filters.children[0].children.map((c) => c.name)).toEqual(['field', 'value'])
    // K37（2026-09-12 md §六.2 L316）：filters 下与 rules 同级的 enabled(boolean) 子字段一并落库
    expect(filters.children[1]).toMatchObject({ name: 'enabled', type: 'boolean' })
  })

  it('修改请求地址 / 映射后保存 → 验证状态重置未验证；仅改名称不重置（md §六.4）', async () => {
    const s = await createSource({ sourceType: 'API', name: uniq('重测接口'), config: apiConfig() })
    await testSource('API', { sourceId: s.id, config: apiConfig() })
    let cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    // 仅改名称 → 不重置
    await updateSource(s.id, { sourceType: 'API', name: `${s.name}改名`, config: apiConfig() })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    // 改请求地址 → 重置
    await updateSource(s.id, { sourceType: 'API', name: `${s.name}改名`, config: apiConfig({ url: 'https://changed.example.com' }) })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
    // 再测成功后改响应映射 → 同样重置
    await testSource('API', { sourceId: s.id, config: apiConfig({ url: 'https://changed.example.com' }) })
    const respMap = [...mkResponseMapRows(), { name: 'extra', sourceField: 'extra', description: '', type: 'string' }]
    await updateSource(s.id, {
      sourceType: 'API',
      name: `${s.name}改名`,
      config: apiConfig({ url: 'https://changed.example.com', responseMap: respMap })
    })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
  })

  it('MCP config 请求 / 响应映射（2026-09-18 推翻 09-08 决议重新加回，md §七.4 / §七.5）：种子自带、与 API 同一套机制校验', async () => {
    const seeded = (await listSources({ sourceType: 'MCP' })).list
    expect(seeded.length).toBeGreaterThan(0)
    for (const s of seeded) {
      expect(s.config.requestMap.filter((r) => r.preset).map((r) => r.name)).toEqual(['query', 'topK'])
      expect(s.config.responseMap.filter((r) => r.preset).map((r) => r.name)).toEqual(['title', 'content', 'sourceName'])
      expect(s.config.resultArrayPath).toBeTruthy()
    }
    const s = await createSource({ sourceType: 'MCP', name: uniq('带映射MCP'), config: mcpConfig() })
    expect(s.config.requestMap.length).toBe(2)
    expect(s.config.tools).toEqual(['search_documents'])
  })

  it('MCP 请求参数映射校验（md §七.4，规则同 API §六.2）：缺预设行 query/topK 报错', async () => {
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('MCP无预设请求'), config: mcpConfig({ requestMap: [] }) })
    ).rejects.toMatchObject({ field: 'requestMap' })
  })

  it('MCP 响应字段校验（md §七.5）：结果数组路径必填；title/content 需填接口返回字段名；sourceName 可留空', async () => {
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('MCP无数组路径'), config: mcpConfig({ resultArrayPath: '' }) })
    ).rejects.toMatchObject({ field: 'responseMap' })
    const badMap = mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: r.name === 'title' ? '' : 'text' }))
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('MCP缺title映射'), config: mcpConfig({ responseMap: badMap }) })
    ).rejects.toMatchObject({ field: 'responseMap' })
    // sourceName 留空可直接保存（留空则取数据源名称）
    const okMap = mkMcpResponseMapRows().map((r) => ({ ...r, sourceField: r.name === 'sourceName' ? '' : 'text' }))
    const s = await createSource({ sourceType: 'MCP', name: uniq('MCP留空来源名'), config: mcpConfig({ responseMap: okMap }) })
    expect(s.config.responseMap.find((r) => r.name === 'sourceName').sourceField).toBe('')
  })

  it('修改 MCP 映射后保存 → 验证状态重置未验证（md §七.7，规则同 API §六.4）', async () => {
    const s = await createSource({ sourceType: 'MCP', name: uniq('重测MCP'), config: mcpConfig() })
    await testSource('MCP', { sourceId: s.id, config: mcpConfig() })
    let cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    await updateSource(s.id, { sourceType: 'MCP', name: s.name, config: mcpConfig({ resultArrayPath: '$.items[*]' }) })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
  })

  it('MCP 保存校验（md §七.2 / §七.3）：Endpoint 必填；检索工具 ≥1；stdio Command 枚举', async () => {
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('无地址MCP'), config: mcpConfig({ endpoint: '' }) })
    ).rejects.toMatchObject({ field: 'endpoint' })
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('无工具MCP'), config: mcpConfig({ tools: [] }) })
    ).rejects.toMatchObject({ field: 'tools', message: '至少选择一个检索工具' })
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('坏命令MCP'), config: mcpConfig({ transport: 'stdio', command: 'bash' }) })
    ).rejects.toMatchObject({ field: 'command' })
  })

  it('MCP API Key 鉴权（md §七.2.1）：Header 名仅字母数字连字符；访问凭证必填并掩码', async () => {
    await expect(
      createSource({
        sourceType: 'MCP',
        name: uniq('坏Header'),
        config: mcpConfig({ authType: 'header', authHeaderName: '非法 Header!' }),
        authValue: 'sec-0123456789'
      })
    ).rejects.toMatchObject({ field: 'authHeaderName' })
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('缺凭证'), config: mcpConfig({ authType: 'header', authHeaderName: 'X-Api-Key' }) })
    ).rejects.toMatchObject({ field: 'authValue' })
    const cred = 'sec-abcdef0123456789'
    const s = await createSource({
      sourceType: 'MCP',
      name: uniq('APIKeyMCP'),
      config: mcpConfig({ authType: 'header', authHeaderName: 'X-Api-Key' }),
      authValue: cred
    })
    expect(s.config.credentialMasked).toBe(maskSecret(cred))
    expect(JSON.stringify(s)).not.toContain(cred)
  })

  it('MCP stdio 环境变量表（md §七.2.2）：未勾客户端填写必须有平台值；保存后平台值掩码', async () => {
    const cfgBad = mcpConfig({ transport: 'stdio', command: 'npx', envVars: [{ key: 'API_KEY', clientFill: false, value: '' }] })
    await expect(createSource({ sourceType: 'MCP', name: uniq('缺Env值'), config: cfgBad })).rejects.toMatchObject({ field: 'envVars' })
    const plain = 'env-secret-0123456789'
    const s = await createSource({
      sourceType: 'MCP',
      name: uniq('stdioMCP'),
      config: mcpConfig({ transport: 'stdio', command: 'npx', args: ['-y', '@company/knowledge-mcp'], envVars: [{ key: 'API_KEY', description: '访问密钥', clientFill: false, value: plain }] })
    })
    expect(s.config.envVars[0].valueMasked).toBe(maskSecret(plain))
    expect(JSON.stringify(s)).not.toContain(plain)
  })

  it('MCP 测试连接成功返回固定工具清单（md §七.3：先完成连接测试以获取工具列表）', async () => {
    // 审计 T17：模块级 lastTest 记录「最近一次测试的配置签名」，草稿态（无 sourceId）测试后若别的用例
    // 恰用同一份 mcpConfig() 新建，会沿用这里的 SUCCESS 而非 UNVERIFIED（随机顺序下假绿）→ 用独占 endpoint
    const r = await testSource('MCP', { config: mcpConfig({ endpoint: 'https://mcp-tools-probe.example.com/mcp' }) })
    expect(r.verifyStatus).toBe('SUCCESS')
    expect(r.tools).toEqual(MCP_TEST_TOOLS)
    expect(MCP_TEST_TOOLS).toEqual(['search_documents', 'search_chunks', 'hybrid_search'])
  })

  it('MCP 改工具选择后保存 → 验证状态重置未验证（md §七.5）', async () => {
    const s = await createSource({ sourceType: 'MCP', name: uniq('改工具MCP'), config: mcpConfig() })
    await testSource('MCP', { sourceId: s.id, config: mcpConfig() })
    let cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    await updateSource(s.id, { sourceType: 'MCP', name: s.name, config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
  })

  it('列表概要（2026-09-08 决议第 9 项 md §八.1 L417）：新建未测试「未验证」→ 测试通过「已连通」(MCP 附工具名) → 保存刚测试失败的草稿「连接失败」→ 改配置重置「未验证」', async () => {
    // 新建保存未测试前 → 未验证
    const s = await createSource({ sourceType: 'MCP', name: uniq('概要MCP'), config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    expect(s.verifyStatus).toBe('UNVERIFIED')
    expect(s.summary).toBe('未验证')
    // 连接测试通过（测的就是已保存的这份配置）→ 立即回写列表概要「已连通 · 所选工具名」
    await testSource('MCP', { sourceId: s.id, config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    let cur = (await listSources({ sourceType: 'MCP' })).list.find((x) => x.id === s.id)
    expect(cur.verifyStatus).toBe('SUCCESS')
    expect(cur.summary).toBe('已连通 · search_documents、hybrid_search')
    // 测一份尚未保存的草稿改动（换服务地址）失败 → 只记 lastTest、不碰库内行，列表概要仍是刚才的
    // 「已连通」（2026-09-23 待办 yuepu#7⑦：此前会立即回写，改坏地址测完一取消，库内这行就被污染）
    await testSource('MCP', { sourceId: s.id, config: mcpConfig({ endpoint: 'https://mcp.fail.example.com/mcp', tools: ['search_documents'] }) })
    cur = (await listSources({ sourceType: 'MCP' })).list.find((x) => x.id === s.id)
    expect(cur.summary).toBe('已连通 · search_documents、hybrid_search') // 未被草稿测试污染
    // 保存刚测试过的这份草稿 → justTested 复用同一测试结果（决议第 9 项）→ 列表变「连接失败」
    const savedFail = await updateSource(s.id, { sourceType: 'MCP', name: s.name, config: mcpConfig({ endpoint: 'https://mcp.fail.example.com/mcp', tools: ['search_documents'] }) })
    expect(savedFail.summary).toBe('连接失败')
    // 再改连接配置（换服务地址）保存、且没测过这份新配置 → 重置未验证
    const s2 = await updateSource(s.id, { sourceType: 'MCP', name: s.name, config: mcpConfig({ endpoint: 'https://mcp2.example.com/mcp', tools: ['search_documents'] }) })
    expect(s2.verifyStatus).toBe('UNVERIFIED')
    expect(s2.summary).toBe('未验证')
    // API 已连通不附工具名；种子失败行「连接失败」
    const api = (await listSources({ sourceType: 'API' })).list
    expect(api.find((x) => x.id === 'ks_3a').summary).toBe('已连通')
    expect(api.find((x) => x.id === 'ks_old').summary).toBe('连接失败')
    // 上传源概要 = 文档数
    expect((await listSources({ sourceType: 'UPLOAD' })).list.find((x) => x.id === 'ks_1a').summary).toMatch(/^[\d,]+ 篇文档$/)
  })

  it('刚测试过的那份配置再保存不重置（2026-09-08 决议第 9 项）：新建态先测后存=已连通；编辑态测新地址后保存=已连通；改成别的配置才回未验证', async () => {
    // 新建态：先测（无 sourceId）再保存同一份配置 → 沿用测试结果
    const cfg = apiConfig({ url: 'https://tested.example.com/search' })
    await testSource('API', { config: cfg })
    const created = await createSource({ sourceType: 'API', name: uniq('先测后存'), config: cfg })
    expect(created.verifyStatus).toBe('SUCCESS')
    expect(created.summary).toBe('已连通')
    // 编辑态：对新地址测试通过后保存同一份 → 不重置
    const cfg2 = apiConfig({ url: 'https://tested2.example.com/search' })
    await testSource('API', { sourceId: created.id, config: cfg2 })
    const saved = await updateSource(created.id, { sourceType: 'API', name: created.name, config: cfg2 })
    expect(saved.verifyStatus).toBe('SUCCESS')
    // 保存的是另一份配置 → 重置未验证
    const saved2 = await updateSource(created.id, { sourceType: 'API', name: created.name, config: apiConfig({ url: 'https://untested.example.com/search' }) })
    expect(saved2.verifyStatus).toBe('UNVERIFIED')
    expect(saved2.summary).toBe('未验证')
  })

  it('测试未保存的草稿改动后取消（不调 updateSource）→ 库内行原封不动，不留痕（2026-09-23 待办 yuepu#7⑦）', async () => {
    const cfg = apiConfig({ url: 'https://kept.example.com/search' })
    await testSource('API', { config: cfg })
    const s = await createSource({ sourceType: 'API', name: uniq('取消不回滚'), config: cfg })
    await testSource('API', { sourceId: s.id, config: cfg }) // 测的是已保存的这份 → 立即回写
    const before = (await listSources({ keyword: s.name })).list[0]
    expect(before.verifyStatus).toBe('SUCCESS')
    expect(before.summary).toBe('已连通')
    // 编辑器里改坏地址后点【测试连接】，但用户随后点了【取消】——不调 updateSource
    await testSource('API', { sourceId: s.id, config: apiConfig({ url: 'https://mcp.fail.example.com/search' }) })
    const after = (await listSources({ keyword: s.name })).list[0]
    expect(after.verifyStatus).toBe('SUCCESS') // 库内仍是「已连通」，未被这次针对草稿的失败测试污染
    expect(after.summary).toBe('已连通')
    expect(after.config.url).toBe('https://kept.example.com/search') // 地址也没被草稿改动带偏
  })

  it('文档解析流转（md §五.3）：上传后进入等待/解析中，未到时限不会立即解析成功', async () => {
    // 审计 T16：夹具补齐 md §五.1 上传源必填项（文档类型 / 向量模型 / 检索方式与 Top K 走 UPLOAD_DEFAULTS）
    const s = await createSource({ sourceType: 'UPLOAD', name: uniq('文档源'), config: { ...UPLOAD_DEFAULTS, embeddingModelId: 'md_emb_1' } })
    await uploadDoc(s.id, { name: '新文档.pdf', size: 1024 * 1024 })
    const docs = await listDocs(s.id)
    const doc = docs.find((d) => d.fileName === '新文档.pdf')
    expect(['PENDING', 'PARSING']).toContain(doc.parseStatus)
    expect(doc.parseStatus).not.toBe('PARSED')
  })
})

/**
 * 2026-09-12 测试审计补缺口（E4 / A7 / A8 / A9 / A12）：沿用本文件约定——共享模块 + uniq 名字自建专属行，
 * 只读种子行（kb_1 / kb_3 / kb_5 / kb_7）不改写。
 */
describe('knowledgeBaseMock —— 补缺口：图标 / 基本信息校验 / 发布校验 / 删除与检索测试 / 数据源边界', () => {
  // mock 接口都 `await delay(250)`；本组调用密集，把 setTimeout 桩成立即回调免真等（不影响断言语义）
  beforeEach(() => vi.stubGlobal('setTimeout', (fn) => { queueMicrotask(fn); return 0 }))
  afterEach(() => vi.unstubAllGlobals())
  const uplSrc = (name) => createSource({ sourceType: 'UPLOAD', name: uniq(name), config: { ...UPLOAD_DEFAULTS, embeddingModelId: 'md_emb_1' } })

  // E4：icon（aee4775 v7）md §三.3.1「图标：否；展示于列表名称旁」
  it('E4 图标：新建落库并可读回；编辑不传 icon 保留；传空串即清除', async () => {
    const kb = await create({ name: uniq('带图标库'), kbType: 'ENTERPRISE', description: '测试用', icon: '🧪', sourceIds: [] })
    expect(kb.icon).toBe('🧪')
    expect((await get(kb.id)).icon).toBe('🧪')
    expect((await list({ keyword: kb.name })).list[0].icon).toBe('🧪')
    const kept = await update(kb.id, { name: kb.name, description: '改描述不碰图标', sourceIds: [] })
    expect(kept.icon).toBe('🧪')
    const cleared = await update(kb.id, { name: kb.name, description: '清图标', icon: '', sourceIds: [] })
    expect(cleared.icon).toBe('')
    expect((await get(kb.id)).icon).toBe('')
    // 图片 URL 形态原样落库（列表侧按 iconIsUrl 渲染 <img>）
    const img = await update(kb.id, { name: kb.name, description: '图片', icon: '/api/public/icons/kb.png', sourceIds: [] })
    expect(img.icon).toBe('/api/public/icons/kb.png')
  })

  // A7：md §三.3.1 基本信息表 + §三.3.2 每类 ≤5
  it('A7 名称超 64 字（2026-09-18 待办 yuepu#5① 一览表拍板收窄，原 100） → field=name「知识库名称最多 64 个字符」；描述超 2000 字（2026-09-18 待办 yuepu#5，代码追平 217ce1f 已改的 md，原 500） → field=description', async () => {
    await expect(create({ name: 'x'.repeat(65), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [] })).rejects.toMatchObject({
      field: 'name',
      message: '知识库名称最多 64 个字符'
    })
    await expect(create({ name: uniq('长描述库'), kbType: 'ENTERPRISE', description: 'd'.repeat(2001), sourceIds: [] })).rejects.toMatchObject({
      field: 'description',
      message: '描述最多 2000 个字符'
    })
    // 恰好 64 / 2000 放行
    const ok = await create({ name: `${'y'.repeat(58)}${Math.random().toString(36).slice(2, 8)}`, kbType: 'ENTERPRISE', description: 'd'.repeat(2000), sourceIds: [] })
    expect(ok.name.length).toBe(64)
    expect(ok.description.length).toBe(2000)
  })

  it('A7 专家 / 岗位知识库缺可见范围 → field=scopeRefId「请选择可见范围」；企业库不需要（md §三.3.1 可见范围必填）', async () => {
    await expect(create({ name: uniq('无专家'), kbType: 'EXPERT', description: '测试用', sourceIds: [] })).rejects.toMatchObject({ field: 'scopeRefId', message: '请选择可见范围' })
    await expect(create({ name: uniq('无岗位'), kbType: 'POSITION', description: '测试用', sourceIds: [] })).rejects.toMatchObject({ field: 'scopeRefId' })
    const ent = await create({ name: uniq('企业库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [] })
    expect(ent.scopeRefId).toBeNull()
    expect(ent.scopeRefName).toBe('')
    const ex = await create({ name: uniq('专家库'), kbType: 'EXPERT', scopeRefId: 'ex_2', description: '测试用', sourceIds: [] })
    expect(ex.scopeRefName).toBe('售后专家')
  })

  it('A7 同类数据源引用第 6 个 → 「上传 数据源最多引用 5 个」；5 个放行（md §三.3.2 每一类最多引用 5 个）', async () => {
    const ids = []
    for (let i = 0; i < 6; i++) ids.push((await uplSrc(`上限源${i}`)).id)
    await expect(create({ name: uniq('六源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: ids })).rejects.toMatchObject({
      message: '上传 数据源最多引用 5 个'
    })
    const five = await create({ name: uniq('五源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: ids.slice(0, 5) })
    expect(five.sources).toHaveLength(5)
    // 重复引用同一源 → 拦
    await expect(create({ name: uniq('重复源库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [ids[0], ids[0]] })).rejects.toMatchObject({ message: '数据源引用重复' })
  })

  it('A7 知识库类型创建后不可修改：update 传 kbType 被忽略（md §三.3.1「创建后不可修改」）', async () => {
    const kb = await create({ name: uniq('类型固定库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [] })
    const r = await update(kb.id, { name: kb.name, description: '测试用', kbType: 'EXPERT', scopeRefId: 'ex_1', sourceIds: [] })
    expect(r.kbType).toBe('ENTERPRISE')
    expect(r.scopeRefId).toBeNull() // 企业库可见范围恒为全员，不吃入参
    expect((await get(kb.id)).kbType).toBe('ENTERPRISE')
  })

  // A8：md §三.6 发布完整校验第 ①③ 条
  it('A8 种子 kb_7（描述为空）提交发布 → 拒「请填写知识库描述」，不进审核中（md §三.6 基本信息必填项完整）', async () => {
    await expect(transition('kb_7', 'publish')).rejects.toMatchObject({ message: '请填写知识库描述', code: 400 })
    const row = await get('kb_7')
    expect(row.pendingAction).toBeNull()
    expect(row.status).toBe('DRAFT')
  })

  it('A8 引用的上传数据源没有解析成功文档 → 拒「上传数据源「X」至少要有 1 个解析成功文档」（md §三.6 第 3 条）', async () => {
    const src = await uplSrc('空文档源')
    const kb = await create({ name: uniq('空文档库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [src.id] })
    await expect(transition(kb.id, 'publish')).rejects.toMatchObject({
      message: `上传数据源「${src.name}」至少要有 1 个解析成功文档`
    })
    expect((await get(kb.id)).pendingAction).toBeNull()
  })

  it('A8 专家库可见对象失效（scopeRefId 指向不存在的专家）仍按 §三.6 第 5 条以外的规则走：可见范围已选即通过，数据源为空被第 2 条拦', async () => {
    const kb = await create({ name: uniq('专家空源库'), kbType: 'EXPERT', scopeRefId: 'ex_1', description: '测试用', sourceIds: [] })
    await expect(transition(kb.id, 'publish')).rejects.toMatchObject({ message: '至少引用 1 个已启用数据源才能提交发布' })
  })

  // A9：md §三.4.3「删除：仅未发布且没有待审核操作时可用；删除知识库不删除其引用的数据源」+ §三.7 检索测试
  it('A9 remove：已发布 kb_1 / 审核中 kb_3 → 409「仅未发布且没有待审核操作的知识库可删除」，行仍在', async () => {
    await expect(remove('kb_1')).rejects.toMatchObject({ code: 409, message: '仅未发布且没有待审核操作的知识库可删除' })
    await expect(remove('kb_3')).rejects.toMatchObject({ code: 409 })
    expect((await get('kb_1')).status).toBe('PUBLISHED')
    expect((await get('kb_3')).pendingAction).toBe('PUBLISH')
    await expect(remove('kb_no_such')).rejects.toMatchObject({ code: 404, message: '知识库不存在' })
  })

  it('A9 remove：未发布库删除成功 → 列表消失；其引用的数据源仍在且不再被引用（删除知识库不删数据源）', async () => {
    const src = await createSource({ sourceType: 'API', name: uniq('被引用接口'), config: apiConfig() })
    const kb = await create({ name: uniq('待删库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [src.id] })
    expect((await getSource(src.id)).referencedBy.map((r) => r.id)).toContain(kb.id)
    await expect(remove(kb.id)).resolves.toBeNull()
    await expect(get(kb.id)).rejects.toMatchObject({ code: 404 })
    expect((await list({ keyword: kb.name })).total).toBe(0)
    const after = await getSource(src.id)
    expect(after.referencedBy).toEqual([])
  })

  it('A9 search(kb_5)：连接失败的 API 源 ks_5b 单列 errors 且不影响上传源 ks_5a 结果；topK=2 → rank [1,2]（md §三.7）', async () => {
    const r = await search('kb_5', { query: '报销制度', topK: 2 })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ sourceId: 'ks_5b', sourceType: 'API', sourceName: '情报平台接口' })
    expect(r.errors[0].message).toContain('情报平台接口 检索失败：')
    expect(r.items).toHaveLength(2)
    expect(r.items.every((it) => it.sourceId === 'ks_5a')).toBe(true)
    expect(r.items.map((it) => it.rank)).toEqual([1, 2])
    expect(r.items[0].score).toBeGreaterThanOrEqual(r.items[1].score)
    expect(r.items[0].content).toContain('（命中问题：报销制度）')
    expect(r.elapsedMs).toBeGreaterThan(0)
    // 限定单个数据源
    const only = await search('kb_5', { query: 'x', sourceId: 'ks_5b' })
    expect(only.items).toEqual([])
    expect(only.errors.map((e) => e.sourceId)).toEqual(['ks_5b'])
  })

  // A12：md §六.1 / §七.2 / §七.4 边界
  it('A12 API 边界：地址 501 字拒 / 500 字放行；超时 999 与 60001 拒、1000 与 60000 放行（md §六.1）', async () => {
    const longUrl = `https://a.example.com/${'p'.repeat(478)}` // 22 + 478 = 500
    expect(longUrl.length).toBe(500)
    await expect(createSource({ sourceType: 'API', name: uniq('501地址'), config: apiConfig({ url: `${longUrl}x` }) })).rejects.toMatchObject({ field: 'url', message: '请求地址最多 500 个字符' })
    const ok500 = await createSource({ sourceType: 'API', name: uniq('500地址'), config: apiConfig({ url: longUrl }) })
    expect(ok500.config.url).toBe(longUrl)
    await expect(createSource({ sourceType: 'API', name: uniq('超时999'), config: apiConfig({ timeoutMs: 999 }) })).rejects.toMatchObject({ field: 'timeoutMs', message: '超时时间需在 1000～60000ms 之间' })
    await expect(createSource({ sourceType: 'API', name: uniq('超时60001'), config: apiConfig({ timeoutMs: 60001 }) })).rejects.toMatchObject({ field: 'timeoutMs' })
    expect((await createSource({ sourceType: 'API', name: uniq('超时1000'), config: apiConfig({ timeoutMs: 1000 }) })).config.timeoutMs).toBe(1000)
    expect((await createSource({ sourceType: 'API', name: uniq('超时60000'), config: apiConfig({ timeoutMs: 60000 }) })).config.timeoutMs).toBe(60000)
  })

  it('A12 API KEY 参数缺位置 → field=authParams「鉴权参数 X-Api-Key 请选择位置」（md §六.1.1 位置必选）', async () => {
    await expect(
      createSource({
        sourceType: 'API',
        name: uniq('缺位置'),
        config: apiConfig({ authType: 'API_KEY', authParams: [{ key: 'X-Api-Key', in: '', clientFill: false, value: 'v-0123456789' }] })
      })
    ).rejects.toMatchObject({ field: 'authParams', message: '鉴权参数 X-Api-Key 请选择位置' })
  })

  it('A12 MCP 边界：超时 999 / 120001 拒、1000 / 120000 放行（md §七.4）；服务地址 501 字拒、非 http 拒（md §七.2.1）', async () => {
    await expect(createSource({ sourceType: 'MCP', name: uniq('MCP超时999'), config: mcpConfig({ timeoutMs: 999 }) })).rejects.toMatchObject({ field: 'timeoutMs', message: '超时时间需在 1000～120000ms 之间' })
    await expect(createSource({ sourceType: 'MCP', name: uniq('MCP超时120001'), config: mcpConfig({ timeoutMs: 120001 }) })).rejects.toMatchObject({ field: 'timeoutMs' })
    expect((await createSource({ sourceType: 'MCP', name: uniq('MCP超时1000'), config: mcpConfig({ timeoutMs: 1000 }) })).config.timeoutMs).toBe(1000)
    expect((await createSource({ sourceType: 'MCP', name: uniq('MCP超时120000'), config: mcpConfig({ timeoutMs: 120000 }) })).config.timeoutMs).toBe(120000)
    await expect(createSource({ sourceType: 'MCP', name: uniq('MCP长地址'), config: mcpConfig({ endpoint: `https://m.example.com/${'p'.repeat(490)}` }) })).rejects.toMatchObject({ field: 'endpoint', message: 'MCP 服务地址最多 500 个字符' })
    await expect(createSource({ sourceType: 'MCP', name: uniq('MCP坏协议'), config: mcpConfig({ endpoint: 'ws://m.example.com/mcp' }) })).rejects.toMatchObject({ field: 'endpoint', message: 'MCP 服务地址需以 http:// 或 https:// 开头' })
    await expect(createSource({ sourceType: 'MCP', name: uniq('MCP坏传输'), config: mcpConfig({ transport: 'websocket' }) })).rejects.toMatchObject({ field: 'transport' })
  })

  // 2026-09-21：MCP 数据源新增 sse（旧版 HTTP+SSE）传输方式，字段与规则同 streamable-http（md §七.2.3）
  it('MCP 数据源 sse：同样校验服务地址与鉴权凭证，保存后凭证脱敏', async () => {
    const sse = (over = {}) => mcpConfig({ transport: 'sse', endpoint: 'https://m.example.com/sse', ...over })
    await expect(createSource({ sourceType: 'MCP', name: uniq('SSE缺地址'), config: sse({ endpoint: '' }) })).rejects.toMatchObject({ field: 'endpoint', message: '请填写 MCP 服务地址' })
    await expect(createSource({ sourceType: 'MCP', name: uniq('SSE坏协议'), config: sse({ endpoint: 'ws://m.example.com/sse' }) })).rejects.toMatchObject({ field: 'endpoint' })
    await expect(
      createSource({ sourceType: 'MCP', name: uniq('SSE缺凭证'), config: sse({ authType: 'bearer' }) })
    ).rejects.toMatchObject({ field: 'authValue', message: '访问凭证必填' })
    const created = await createSource({
      sourceType: 'MCP',
      name: uniq('SSE成功'),
      config: sse({ authType: 'bearer' }),
      authValue: 'tok-0123456789'
    })
    expect(created.config.transport).toBe('sse')
    expect(created.config.endpoint).toBe('https://m.example.com/sse')
    // 与 streamable-http 一致：明文不落库，只留掩码；且不带 stdio 的环境变量
    expect(created.config.credentialMasked).toBeTruthy()
    expect(created.config.credentialMasked).not.toContain('tok-0123456789')
    expect(created.config.envVars).toEqual([])
  })
})

/**
 * 2026-09-12 测试审计补缺口（F5）：knowledgeBaseMock 持久化零用例（mockPersist v8；11 个写点：
 * create / update / remove / transition / createSource / updateSource / removeSource / testSource(带 sourceId) /
 * listDocs(状态流转时) / uploadDoc / deleteDoc）。
 * 本仓 jsdom 下 globalThis.localStorage 为 undefined → 注入内存版存储 + vi.resetModules 动态 import；
 * mock 接口都 `await delay()`，把 setTimeout 桩成立即回调免真等。
 */
describe('knowledgeBaseMock · 持久化（mockPersist v8）', () => {
  const KEY = 'iworker-demo-mock:knowledgeBase'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: vi.fn((k, v) => map.set(k, String(v))),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
    vi.stubGlobal('setTimeout', (fn) => { queueMicrotask(fn); return 0 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })
  const uplCfg = { ...UPLOAD_DEFAULTS, embeddingModelId: 'md_emb_1' }

  it('十一个写点各落盘一次（setItem 逐一 +1）；list / get / listSources / 草稿测试连接不落盘', async () => {
    const m = await import('../knowledgeBaseMock')
    const writes = () => globalThis.localStorage.setItem.mock.calls.filter(([k]) => k === KEY).length
    const base = writes()
    await m.list()
    await m.get('kb_1')
    await m.listSources()
    await m.testSource('API', { config: apiConfig() }) // 草稿态无 sourceId → 不回写
    expect(writes()).toBe(base)
    const src = await m.createSource({ sourceType: 'API', name: 'P 接口', config: apiConfig() })
    expect(writes()).toBe(base + 1)
    await m.updateSource(src.id, { sourceType: 'API', name: 'P 接口改', config: apiConfig() })
    expect(writes()).toBe(base + 2)
    await m.testSource('API', { sourceId: src.id, config: apiConfig() })
    expect(writes()).toBe(base + 3)
    const kb = await m.create({ name: 'P 库', kbType: 'ENTERPRISE', description: 'd', sourceIds: [src.id] })
    expect(writes()).toBe(base + 4)
    await m.update(kb.id, { name: 'P 库改', description: 'd', sourceIds: [src.id] })
    expect(writes()).toBe(base + 5)
    await m.transition(kb.id, 'publish')
    expect(writes()).toBe(base + 6)
    await m.transition(kb.id, 'withdraw')
    expect(writes()).toBe(base + 7)
    await m.remove(kb.id)
    expect(writes()).toBe(base + 8)
    await m.removeSource(src.id)
    expect(writes()).toBe(base + 9)
    const upl = await m.createSource({ sourceType: 'UPLOAD', name: 'P 文档源', config: uplCfg })
    expect(writes()).toBe(base + 10)
    const doc = await m.uploadDoc(upl.id, { name: 'a.pdf', size: 1024 })
    expect(writes()).toBe(base + 11)
    await m.listDocs(upl.id) // PENDING → PARSING 状态流转才落盘
    expect(writes()).toBe(base + 12)
    await m.deleteDoc(upl.id, doc.id)
    expect(writes()).toBe(base + 13)
  })

  it('新建知识库落盘（v=7，含 icon）→ 重新 import（模拟刷新）→ 列表仍有该库、图标仍在、种子 seq 延续', async () => {
    const first = await import('../knowledgeBaseMock')
    const kb = await first.create({ name: '刷新后还在', kbType: 'ENTERPRISE', description: 'd', icon: '🧪', sourceIds: ['ks_1a'] })
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(8)
    expect(snap.data.rows.find((r) => r.id === kb.id)).toMatchObject({ name: '刷新后还在', icon: '🧪' })
    vi.resetModules()
    const fresh = await import('../knowledgeBaseMock')
    const row = await fresh.get(kb.id)
    expect(row).toMatchObject({ name: '刷新后还在', icon: '🧪', status: 'DRAFT' })
    expect(row.sources.map((s) => s.id)).toEqual(['ks_1a'])
    expect((await fresh.list()).total).toBe(8)
    const another = await fresh.create({ name: '再建一个', kbType: 'ENTERPRISE', description: 'd', sourceIds: [] })
    expect(another.id).not.toBe(kb.id)
  })

  it('旧版本快照（v=6）→ 丢弃并回种子（7 个知识库 / 12 个数据源，不带入旧行）', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 6, data: { seq: 1, sources: [], rows: [{ id: 'kb_old', name: '旧库', sourceIds: [] }], docsBySource: {}, seedDocCount: {} } }))
    const m = await import('../knowledgeBaseMock')
    const { list: rows, total } = await m.list()
    expect(total).toBe(7)
    expect(rows.map((r) => r.id)).not.toContain('kb_old')
    expect((await m.listSources()).total).toBe(12)
  })

  it('坏形状快照（rows 不是数组）→ restore 抛「knowledgeBase 快照形状不合法」被兜底，回种子 + console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 8, data: { seq: 1, sources: [], rows: 'oops', docsBySource: {}, seedDocCount: {} } }))
    const m = await import('../knowledgeBaseMock')
    expect((await m.list()).total).toBe(7)
    const call = warn.mock.calls.find((c) => String(c[0]).includes('knowledgeBase'))
    expect(call).toBeTruthy()
    expect(String(call[1]?.message || '')).toContain('knowledgeBase 快照形状不合法')
    warn.mockRestore()
  })
})
