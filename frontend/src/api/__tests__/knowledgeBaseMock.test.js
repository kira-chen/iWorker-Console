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
import { mkRequestMapRows, mkResponseMapRows } from '@/utils/knowledgeBaseMeta'

/**
 * knowledgeBaseMock 状态机与口径单测。
 * 知识库部分沿用 2026-09-04 PRD-20260903 对齐用例；数据源部分 2026-09-07 按
 * PRD-20260904 数据源新口径对齐重写（md §六 API / §七 MCP / §八 状态与异常）：
 * API authType 三枚举 + authParams 多参数表 + requestMap/responseMap 结构化预设行；
 * MCP 仅直接填写（transport/tools 数组，「引用现有 MCP」废弃）；测试成功返回固定工具清单；
 * 敏感信息保存即掩码；修改请求地址 / 鉴权 / 工具 / 映射后保存 → 验证状态重置未验证。
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
  requestMap: mkRequestMapRows(),
  responseMap: mkResponseMapRows(),
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

  it('MCP 改工具选择后保存 → 验证状态重置未验证（md §七.7）', async () => {
    const s = await createSource({ sourceType: 'MCP', name: uniq('改工具MCP'), config: mcpConfig() })
    await testSource('MCP', { sourceId: s.id, config: mcpConfig() })
    let cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    await updateSource(s.id, { sourceType: 'MCP', name: s.name, config: mcpConfig({ tools: ['search_documents', 'hybrid_search'] }) })
    cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('UNVERIFIED')
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
