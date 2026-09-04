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
  mcps,
  mcpTools
} from '../knowledgeBaseMock'
import { maskSecret } from '@/utils/secretMask'

/**
 * knowledgeBaseMock 状态机与口径单测（2026-09-04 PRD-20260903 对齐）。
 * 覆盖：描述必填 / 发布完整校验（md §三.6）/ 三态状态机与撤回（md §三.4·§八.1）/
 * 已发布关键变更回未发布（md §三.5）/ 被引用数据源删除阻断（md §四.2）/
 * 敏感信息掩码与连接配置变更重置验证态（md §六.3）/ 文档解析流转（md §五.3）/ MCP 连接器同源（md §七.1）。
 */

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`

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
    const bad = await createSource({ sourceType: 'API', name: uniq('未验证接口'), config: { url: 'https://a.example.com' } })
    const kb = await create({ name: uniq('接口库'), kbType: 'ENTERPRISE', description: '测试用', sourceIds: [bad.id] })
    await expect(transition(kb.id, 'publish')).rejects.toMatchObject({
      message: expect.stringContaining('需最近一次连接测试成功')
    })
    // 测试连接成功后重新提交 → 进入审核中（pendingAction=PUBLISH）
    await testSource('API', { sourceId: bad.id, config: { url: 'https://a.example.com' } })
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

describe('knowledgeBaseMock —— 数据源（PRD-20260903 §四～§七）', () => {
  it('被知识库引用的数据源删除被阻断，提示语含 md 口径「正被知识库引用，请先解除引用」', async () => {
    // 种子 ks_1a 被 kb_1 引用（本文件不动 kb_1 / ks_1a）
    await expect(removeSource('ks_1a')).rejects.toMatchObject({
      code: 409,
      message: expect.stringContaining('正被知识库引用，请先解除引用')
    })
    // 未被引用的可删
    const s = await createSource({ sourceType: 'API', name: uniq('临时接口'), config: { url: 'https://t.example.com' } })
    await expect(removeSource(s.id)).resolves.toBe(null)
  })

  it('敏感凭证保存即 maskSecret 掩码，明文不出 mock（md §四.3）', async () => {
    const plain = 'sk-test-abcdefgh12345678'
    const s = await createSource({
      sourceType: 'API',
      name: uniq('鉴权接口'),
      config: { url: 'https://sec.example.com', authType: 'API_KEY', authName: 'X-Api-Key', authIn: 'HEADER' },
      authValue: plain
    })
    expect(s.config.authValueMasked).toBe(maskSecret(plain))
    expect(JSON.stringify(s)).not.toContain(plain)
  })

  it('修改连接配置后验证状态重置为未验证（md §六.3）', async () => {
    const s = await createSource({ sourceType: 'API', name: uniq('重测接口'), config: { url: 'https://ok.example.com' } })
    await testSource('API', { sourceId: s.id, config: { url: 'https://ok.example.com' } })
    let cur = (await listSources({ keyword: s.name })).list[0]
    expect(cur.verifyStatus).toBe('SUCCESS')
    await updateSource(s.id, { sourceType: 'API', name: s.name, config: { url: 'https://changed.example.com' } })
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

  it('MCP 引用现有 MCP 与连接器 mock 同源（md §七.1）：可取到服务与含 inputSchema 的工具', async () => {
    const options = await mcps()
    expect(options.some((m) => m.id === 'spark_bridge_mcp')).toBe(true)
    const tools = await mcpTools('spark_bridge_mcp')
    expect(tools.length).toBeGreaterThan(0)
    expect(tools[0]).toHaveProperty('name')
    expect(tools[0]).toHaveProperty('inputSchema')
  })
})
