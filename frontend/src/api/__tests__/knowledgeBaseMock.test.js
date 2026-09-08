// @vitest-environment jsdom
// （knowledgeBaseMock → request.js → router 链路触达 window，故用 jsdom；同 adminModelMock.test.js）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写的行；状态机链路在单个用例内自洽驱动。
import { describe, it, expect } from 'vitest'
import {
  list,
  create,
  update,
  transition,
  listSources,
  createSource,
  updateSource,
  removeSource,
  testSource,
  listDocs,
  uploadDoc,
  MCP_TEST_TOOLS
} from '../knowledgeBaseMock'
import { maskSecret } from '@/utils/secretMask'
import { mkRequestMapRows, mkRequestMapExampleRows, mkResponseMapRows } from '@/utils/knowledgeBaseMeta'

/**
 * knowledgeBaseMock 状态机与口径单测。
 * 知识库部分沿用 2026-09-04 PRD-20260903 对齐用例；数据源部分 2026-09-07 按
 * PRD-20260904 数据源新口径对齐重写（md §六 API / §七 MCP / §八 状态与异常）：
 * API authType 三枚举 + authParams 多参数表 + requestMap/responseMap 结构化预设行；
 * MCP 仅直接填写（transport/tools 数组，「引用现有 MCP」废弃）；测试成功返回固定工具清单；
 * 敏感信息保存即掩码；修改请求地址 / 鉴权 / 工具 / 映射后保存 → 验证状态重置未验证。
 * 2026-09-08 PRD-20260908 对齐：MCP config 不再有 requestMap/responseMap（md §七 删两节）；
 * API 请求映射补 object/array 子字段递归校验 + 新建示例组可保存（md §六.2）。
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
const mcpConfig = (over = {}) => ({
  transport: 'streamable-http',
  endpoint: 'https://mcp.example.com/mcp',
  authType: 'none',
  authHeaderName: '',
  command: 'npx',
  args: [],
  envVars: [],
  tools: ['search_documents'],
  timeoutMs: 10000,
  ...over
})

describe('knowledgeBaseMock —— 知识库状态机（PRD-20260903 §三）', () => {
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
    const { listReviews } = await import('../reviewsMock')
    const { listMyApplications } = await import('../myApplicationsMock')
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
    // 种子 kb_4：岗位知识库（ps_1）已发布
    let r = await update('kb_4', { name: '销售话术与异议处理', description: '仅改描述不回退', sourceIds: ['ks_4a'], scopeRefId: 'ps_1' })
    expect(r.status).toBe('PUBLISHED')
    r = await update('kb_4', { name: '销售话术与异议处理', description: '换岗位要回退', sourceIds: ['ks_4a'], scopeRefId: 'ps_2' })
    expect(r.status).toBe('DRAFT')
    expect(r.scopeRefName).toBe('HR 专员')
  })
})

describe('knowledgeBaseMock —— 数据源（2026-09-07 PRD-20260904 数据源新口径对齐，md §四～§八）', () => {
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

  it('请求映射递归子字段校验（2026-09-08 PRD-20260908 md §六.2）：object/array 至少一个有效子字段、同父下不重名、子字段名必填', async () => {
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
    const respMap = [...mkResponseMapRows(), { name: 'extra', description: '', type: 'string' }]
    await updateSource(s.id, {
      sourceType: 'API',
      name: `${s.name}改名`,
      config: apiConfig({ url: 'https://changed.example.com', responseMap: respMap })
    })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
  })

  it('MCP config 无请求 / 响应映射（2026-09-08 PRD-20260908 md §七 删两节）：不校验、种子不带、保存原样落库', async () => {
    const seeded = (await listSources({ sourceType: 'MCP' })).list
    expect(seeded.length).toBeGreaterThan(0)
    for (const s of seeded) {
      expect(s.config).not.toHaveProperty('requestMap')
      expect(s.config).not.toHaveProperty('responseMap')
    }
    // MCP 不再要求映射预设行：无 requestMap/responseMap 可直接保存
    const s = await createSource({ sourceType: 'MCP', name: uniq('无映射MCP'), config: mcpConfig() })
    expect(s.config).not.toHaveProperty('requestMap')
    expect(s.config.tools).toEqual(['search_documents'])
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
    const r = await testSource('MCP', { config: mcpConfig() })
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

  it('列表概要（2026-09-08 决议第 9 项 md §八.1 L417）：新建未测试「未验证」→ 测试通过「已连通」(MCP 附工具名) → 失败「连接失败」→ 改配置重置「未验证」', async () => {
    // 新建保存未测试前 → 未验证
    const s = await createSource({ sourceType: 'MCP', name: uniq('概要MCP'), config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    expect(s.verifyStatus).toBe('UNVERIFIED')
    expect(s.summary).toBe('未验证')
    // 连接测试通过 → 回写列表概要「已连通 · 所选工具名」
    await testSource('MCP', { sourceId: s.id, config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    let cur = (await listSources({ sourceType: 'MCP' })).list.find((x) => x.id === s.id)
    expect(cur.verifyStatus).toBe('SUCCESS')
    expect(cur.summary).toBe('已连通 · search_documents、hybrid_search')
    // 测试失败 → 连接失败
    await testSource('MCP', { sourceId: s.id, config: mcpConfig({ endpoint: 'https://mcp.fail.example.com/mcp', tools: ['search_documents'] }) })
    cur = (await listSources({ sourceType: 'MCP' })).list.find((x) => x.id === s.id)
    expect(cur.summary).toBe('连接失败')
    // 修改连接配置（换服务地址）后保存 → 重置未验证
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

  it('文档解析流转（md §五.3）：上传后进入等待/解析中，未到时限不会立即解析成功', async () => {
    const s = await createSource({ sourceType: 'UPLOAD', name: uniq('文档源'), config: { docKind: 'DOC' } })
    await uploadDoc(s.id, { name: '新文档.pdf', size: 1024 * 1024 })
    const docs = await listDocs(s.id)
    const doc = docs.find((d) => d.fileName === '新文档.pdf')
    expect(['PENDING', 'PARSING']).toContain(doc.parseStatus)
    expect(doc.parseStatus).not.toBe('PARSED')
  })
})
