// @vitest-environment jsdom
// （mcpConnectorMock → request.js → router 链路触达 window，故用 jsdom；同 bizSystemMock.test.js）
//
// 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md
//   §二.1（列表字段）/ §二.2（验证规则）/ §二.3.4-§二.3.7（发布 / 撤回 / 停用 / 删除）/ §二.4（状态规则）/
//   §三.4（鉴权与 Env 留空=保留）/ §三.5（测试连接只在抽屉内展示）/ §三.6（拉取工具）/ §三.9（最近发布时间）。
// 覆盖：工具种子 title 双层标题、示例问题落库+回显、args 回显、publishedAt；探测失败分支；
//   出参脱敏；authConfig / env 留空保留；listMcp 排序/搜索/筛选/分页；新建初值；删除/撤回/驳回；持久化 v5。
// 注意：本模块无 __reset 复位函数 + vitest 随机顺序执行——第一组用例只读 spark_bridge_mcp / 自建专属行；
//   第二组起（A19 / F8）每例 vi.resetModules() 动态 import 拿全新种子，互不串扰。
// 已知不写的用例（审计 K34 待代码修）：delistMcpService 直落 DELISTED（md §二.3.6 L135 要求进「审核中」）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getMcp,
  createMcp,
  updateMcp,
  testMcpConn,
  fetchMcpTools,
  fetchMcpToolsDraft,
  healthCheckMcpTool,
  publishMcpService,
  reviewMcpService
} from '../mcpConnectorMock'

// 新建一条合法 stdio MCP（code 唯一，避免用例间撞行）
function mkStdio(code) {
  return createMcp({
    code,
    name: `测试 MCP ${code}`,
    icon: '⌁',
    description: '测试用 MCP 服务',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-foo'],
    env: [],
    timeoutMs: 10000,
    exampleQuestions: ['帮我查一条记录', '帮我提交一笔申请', '帮我看看处理结果']
  })
}

describe('mcpConnectorMock —— 工具双层标题 / 示例问题 / args / publishedAt（md §三.5-§三.9）', () => {
  it('工具种子带 title 中文名（工具卡「中文名 + 灰色代码名」双层）', async () => {
    const m = await getMcp('spark_bridge_mcp')
    const byName = Object.fromEntries(m.tools.map((t) => [t.name, t.title]))
    expect(byName.spark_agent_chat).toBe('智能体对话')
    expect(byName.spark_scene_run).toBe('任务链执行')
    expect(byName.spark_knowledge_qa).toBe('知识库问答')
  })

  it('拉取工具（草稿）返回的工具同样带 title + 连接元信息（协议/Server 版本）', async () => {
    const r = await fetchMcpToolsDraft()
    expect(r.tools[0].title).toBe('智能体对话')
    expect(r.protocolVersion).toBeTruthy()
    expect(r.serverVersion).toBeTruthy()
  })

  it('种子示例问题固定 3 条（md §三.7 示例问题区三行，spark_bridge_mcp 种子逐字）', async () => {
    const m = await getMcp('spark_bridge_mcp')
    expect(m.exampleQuestions).toEqual([
      '帮我发起一个明天下午的请假审批',
      '帮我查询当前可用的工具',
      '帮我执行一次常用业务操作'
    ])
  })

  it('保存持久化 args 与示例问题（落库 + 回显）', async () => {
    const created = await mkStdio('mcp_test_args_eq')
    expect(created.args).toEqual(['-y', '@modelcontextprotocol/server-foo'])
    await updateMcp(created.id, {
      args: ['mcp-server-time'],
      exampleQuestions: ['问题一', '问题二', '问题三']
    })
    const m = await getMcp(created.id)
    expect(m.args).toEqual(['mcp-server-time'])
    expect(m.exampleQuestions).toEqual(['问题一', '问题二', '问题三'])
  })

  it('publishedAt：新建为 null（界面显「—」）；提交审核不置；审核通过刷新最近发布时间', async () => {
    const created = await mkStdio('mcp_test_published_at')
    expect(created.publishedAt).toBeNull()
    await publishMcpService(created.id)
    expect((await getMcp(created.id)).publishedAt).toBeNull()
    await reviewMcpService(created.id, { approve: true })
    expect((await getMcp(created.id)).publishedAt).toBeTruthy()
  })

  it('测试连接：仅握手回显协议/Server 版本与延迟（不返回工具列表）', async () => {
    const r = await testMcpConn({})
    expect(r.ok).toBe(true)
    expect(r.protocolVersion).toBeTruthy()
    expect(r.serverVersion).toBeTruthy()
    expect(r.latencyMs).toBeGreaterThan(0)
    expect(r.tools).toBeUndefined()
  })

  /**
   * 2026-09-09 PRD 复核轮 · G4（B 组·MCP 测试失败分支）。
   * md prd-连接器-MCP.md §三.5 L299-300 定义了红色失败结果卡，§二.2 L61/L66-68 定义了检活异常
   * 的悬浮与提示，但 mock 此前写死 `{ ok:true }`、检活恒 HEALTHY，失败态 UI 永远走不到。
   * 口径照 API 连接器：种子 health='bad' 的行带 `_mockUnhealthy`，改过连接配置后清除。
   *
   * 用种子行 `expense_mcp`（报销系统 MCP，health='bad'）驱动；只读不改写它的连接字段，
   * 恢复路径另用新建行 + 显式置标记验证，避免污染其它随机顺序执行的用例。
   */
  describe('B 组：连接探测失败分支', () => {
    it('种子 health=bad 的行：测试连接返回 ok=false + 失败原因', async () => {
      const r = await testMcpConn({ id: 'expense_mcp' })
      expect(r.ok).toBe(false)
      expect(r.failReason).toContain('CONN_REFUSED')
    })

    it('种子 health=ok 的行：测试连接照常成功', async () => {
      const r = await testMcpConn({ id: 'knowledge_hub' })
      expect(r.ok).toBe(true)
    })

    it('草稿探测（新建态、无 id）恒成功——没有历史标记可依据', async () => {
      const r = await testMcpConn({ transport: 'stdio', command: 'npx' })
      expect(r.ok).toBe(true)
    })

    it('检活：正常行落 HEALTHY + 清错误', async () => {
      const ok = await healthCheckMcpTool('calendar')
      expect(ok.displayStatus).toBe('HEALTHY')
      expect(ok.errorBrief).toBeNull()
      expect((await getMcp('calendar')).lastCheckError).toBeNull()
    })

    /**
     * 失败行 `assets`（资产管理 MCP，种子 health='bad'）的完整路径一次跑完：
     * 检活异常 → 拉取工具抛错并落「连接异常」 → 改连接配置（endpoint）→ 标记清除、探测恢复正常。
     * 合成一个用例是刻意的：本文件随机顺序执行，把这条行的多步改写拆散会互相污染。
     */
    it('失败行全链路：检活异常 → 拉取工具抛错落异常 → 改连接配置后恢复正常', async () => {
      // 1) 检活：异常 + 错误摘要
      const bad = await healthCheckMcpTool('assets')
      expect(bad.displayStatus).toBe('UNHEALTHY')
      expect(bad.errorBrief).toContain('CONN_REFUSED')

      // 2) 拉取工具：抛错（不假装拉到空清单），行落「连接异常」
      await expect(fetchMcpTools('assets')).rejects.toThrow(/拉取工具失败/)
      const m = await getMcp('assets')
      expect(m.displayStatus).toBe('UNHEALTHY')
      expect(m.connStatus).toBe('failed')
      expect(m.lastCheckError).toContain('CONN_REFUSED')

      // 3) 改 endpoint（属连接配置）→ demo 失败标记清除
      await updateMcp('assets', { endpoint: 'https://assets-fixed.intra/mcp' })
      expect((await testMcpConn({ id: 'assets' })).ok).toBe(true)
      expect((await healthCheckMcpTool('assets')).displayStatus).toBe('HEALTHY')
    })

    it('只改名称（非连接配置）不清失败标记', async () => {
      // 用 expense_mcp（另一条 health='bad' 种子行），只改名称不碰连接字段
      await updateMcp('expense_mcp', { name: '报销系统 MCP' })
      expect((await testMcpConn({ id: 'expense_mcp' })).ok).toBe(false)
    })
  })
  // 2026-09-09 收口回归 P2：stdio 种子原本 env 全空，A11 新做的「改值 / 待删除 / 撤销」三步式
  // 交互开箱一个入口都点不到，演示时会被误判为功能没做。种子补样例后钉住，防再被清空。
  describe('P2：stdio 种子自带 env 样例（三步式交互开箱可达）', () => {
    it('本地文件 MCP 带两条 env：平台值行掩码、客户端填写行无值', async () => {
      const d = await getMcp('local_files')
      expect(d.transport).toBe('stdio')
      const env = d.env || []
      expect(env.length).toBe(2)

      const platform = env.find((e) => e.key === 'WORKSPACE_ROOT')
      expect(platform).toBeTruthy()
      expect(platform.clientFill).toBe(false)
      // 平台值出参必须是掩码串、绝不回显明文（mock 头注的脱敏约定）
      expect(platform.valueMasked).toBeTruthy()
      expect(platform.valueMasked).not.toContain('/srv/iworker/workspace')

      const clientFill = env.find((e) => e.key === 'ACCESS_TOKEN')
      expect(clientFill).toBeTruthy()
      expect(clientFill.clientFill).toBe(true)
      expect(clientFill.valueMasked).toBe(false)
    })
  })
})

/**
 * 2026-09-12 测试审计补缺口（A19）：8 组零用例的 mock 行为。
 * 每例 vi.resetModules() 后动态 import → 全新种子（11 条），不依赖执行顺序、不污染上一组的共享模块。
 */
// mock 每个接口都 `await delay(150~900ms)` 模拟网络；下面两组用例把 setTimeout 桩成「立即回调」，
// 让几十次调用不用真等（真等一轮约 30s）。需要真实时间流逝的地方用 realSleep。
const realSetTimeout = globalThis.setTimeout
const realSleep = (ms) => new Promise((r) => realSetTimeout(r, ms))
function stubInstantTimers() {
  vi.stubGlobal('setTimeout', (fn) => { queueMicrotask(fn); return 0 })
}

describe('mcpConnectorMock · A19 补缺口（每例全新模块）', () => {
  let m
  beforeEach(async () => {
    vi.resetModules()
    stubInstantTimers()
    m = await import('../mcpConnectorMock')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const mkStdioIn = (code, extra = {}) => ({
    code,
    name: `测试 MCP ${code}`,
    description: '测试用',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server-foo'],
    env: [],
    timeoutMs: 10000,
    ...extra
  })

  // ① md §三.5 L302「测试连接结果仅在当前抽屉内展示」→ 不写库
  it('① 测试连接不改列表验证状态：未探测行（project_hub）测试成功后仍是 UNKNOWN、lastCheckedAt 仍为空', async () => {
    const before = await m.getMcp('project_hub')
    expect(before.displayStatus).toBe('UNKNOWN')
    const r = await m.testMcpConn({ id: 'project_hub' })
    expect(r.ok).toBe(true)
    const after = await m.getMcp('project_hub')
    expect(after.displayStatus).toBe('UNKNOWN')
    expect(after.lastCheckedAt).toBeNull()
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  // ② md §二.1 L49「最近更新时间 = 基本信息 / 连接配置 / 工具清单最近一次保存成功的时间」→ 检活 / 发布动作不算
  it('② 检活 / 提交发布 / 撤回 / 审核通过不改 updatedAt；updateMcp 保存才刷新', async () => {
    const created = await m.createMcp(mkStdioIn('mcp_upd_rule'))
    const t0 = created.updatedAt
    await m.healthCheckMcpTool(created.id)
    expect((await m.getMcp(created.id)).updatedAt).toBe(t0)
    await m.publishMcpService(created.id)
    expect((await m.getMcp(created.id)).updatedAt).toBe(t0)
    await m.withdrawMcpService(created.id)
    expect((await m.getMcp(created.id)).updatedAt).toBe(t0)
    await m.publishMcpService(created.id)
    await m.reviewMcpService(created.id, { approve: true })
    expect((await m.getMcp(created.id)).updatedAt).toBe(t0)
    await realSleep(5) // 让 updatedAt 真的能跨过 1ms
    await m.updateMcp(created.id, { description: '改了描述' })
    const t1 = (await m.getMcp(created.id)).updatedAt
    expect(t1).not.toBe(t0)
    expect(Date.parse(t1)).toBeGreaterThan(Date.parse(t0))
  })

  // ③ 出参脱敏（mock 头注：明文绝不出 mock）
  it('③ 出参不含 authSecret / authHeaderName / authType 明文字段；authInfo.valueMasked 为首尾掩码串', async () => {
    const row = await m.getMcp('spark_bridge_mcp')
    expect(row).not.toHaveProperty('authSecret')
    expect(row).not.toHaveProperty('authHeaderName')
    expect(row).not.toHaveProperty('authType')
    expect(row.authConfigMasked).toBe(true)
    expect(row.authInfo.type).toBe('bearer')
    // 种子明文 '9a7f3c21:e4b8d6f2a1c95370'（25 位）→ 保留首尾 3 位，中间全星
    expect(row.authInfo.valueMasked).toBe('9a7*******************370')
    expect(row.authInfo.valueMasked).not.toContain('e4b8d6f2')
    // 列表出参同样脱敏
    const { list } = await m.listMcp({ keyword: '星火' })
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('authSecret')
    expect(list[0].authInfo.valueMasked).toBe('9a7*******************370')
  })

  // ④ md §三.4.1：编辑时密钥留空 = 保留；换鉴权类型 / 切「无鉴权」→ 清
  it('④ authConfig：同类型留空保留旧密钥；换类型留空即清空；type=none 清空并出参 authInfo=null', async () => {
    const created = await m.createMcp(mkStdioIn('mcp_auth_rule', { authConfig: { type: 'bearer', token: 'tok-abcdefgh-1' } }))
    expect(created.authConfigMasked).toBe(true)
    const masked = created.authInfo.valueMasked
    // 同类型留空 → 保留
    const kept = await m.updateMcp(created.id, { authConfig: { type: 'bearer', token: '' } })
    expect(kept.authConfigMasked).toBe(true)
    expect(kept.authInfo.valueMasked).toBe(masked)
    // 换成 header 且留空 → 旧 bearer 密钥不能沿用
    const switched = await m.updateMcp(created.id, { authConfig: { type: 'header', headerName: 'X-Api-Key', value: '' } })
    expect(switched.authConfigMasked).toBe(false)
    expect(switched.authInfo).toEqual({ type: 'header', headerName: 'X-Api-Key', valueMasked: '' })
    // header 填值 → 落库掩码
    const filled = await m.updateMcp(created.id, { authConfig: { type: 'header', headerName: 'X-Api-Key', value: 'key-123456789' } })
    expect(filled.authInfo.valueMasked).toBe('key*******789')
    // 切无鉴权 → 全清
    const none = await m.updateMcp(created.id, { authConfig: { type: 'none' } })
    expect(none.authInfo).toBeNull()
    expect(none.authConfigMasked).toBe(false)
  })

  // ⑤ Env 按 KEY merge（md §三.4.2 平台值留空=保留；客户端填写行不存值）
  it('⑤ env 按 KEY 合并：留空保留旧值、新 KEY 追加、删掉的 KEY 消失、clientFill 行无值、空 KEY 行丢弃', async () => {
    const created = await m.createMcp(
      mkStdioIn('mcp_env_rule', {
        env: [
          { key: 'A_KEY', description: '甲', clientFill: false, value: 'secret-aaaa-1' },
          { key: 'GONE', description: '会被删', clientFill: false, value: 'gone-value-1' }
        ]
      })
    )
    const a0 = created.env.find((e) => e.key === 'A_KEY')
    expect(a0.valueMasked).toBe('sec*******a-1')
    expect(created.env.map((e) => e.key)).toEqual(['A_KEY', 'GONE'])
    const updated = await m.updateMcp(created.id, {
      env: [
        { key: 'A_KEY', description: '甲改', clientFill: false, value: '' },
        { key: 'B_KEY', description: '乙', clientFill: false, value: 'bbbbbbbb-2' },
        { key: 'C_TOKEN', description: '客户端填', clientFill: true, value: 'should-not-store' },
        { key: '   ', description: '空 KEY', clientFill: false, value: 'x' }
      ]
    })
    expect(updated.env.map((e) => e.key)).toEqual(['A_KEY', 'B_KEY', 'C_TOKEN'])
    const a1 = updated.env.find((e) => e.key === 'A_KEY')
    expect(a1.valueMasked).toBe('sec*******a-1') // 留空保留旧明文（掩码不变）
    expect(a1.description).toBe('甲改')
    expect(updated.env.find((e) => e.key === 'B_KEY').valueMasked).toBe('bbb****b-2')
    const c = updated.env.find((e) => e.key === 'C_TOKEN')
    expect(c.clientFill).toBe(true)
    expect(c.valueMasked).toBe(false)
    updated.env.forEach((e) => expect(e).not.toHaveProperty('value'))
  })

  // ⑥ listMcp：md §二.1 L49 时间排序（默认由近到远）、§一.1 L13 名称/描述搜索、§二.4 三态归并、分页 total
  it('⑥ listMcp：默认按 updatedAt 降序、asc 反转；keyword 命中名称或描述；分页返回当页 + 全量 total', async () => {
    const all = await m.listMcp()
    expect(all.total).toBe(11)
    expect(all.list).toHaveLength(11)
    const times = all.list.map((r) => Date.parse(r.updatedAt))
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
    expect(all.list[0].name).toBe('星火智能体桥接 MCP')
    const asc = await m.listMcp({ sort: 'asc' })
    expect(asc.list[0].name).toBe('资产管理 MCP')
    expect(asc.list.at(-1).name).toBe('星火智能体桥接 MCP')
    // 名称命中
    const byName = await m.listMcp({ keyword: '报销' })
    expect(byName.list.map((r) => r.name)).toEqual(['报销系统 MCP'])
    // 描述命中（「查询团队日程并创建会议」）
    const byDesc = await m.listMcp({ keyword: '团队日程' })
    expect(byDesc.list.map((r) => r.name)).toEqual(['日历 MCP'])
    // 无命中 → 空
    expect((await m.listMcp({ keyword: '不存在的关键词' })).total).toBe(0)
    // 分页：size 5 → 第 2 页 5 条、第 3 页 1 条，total 恒 11
    const p2 = await m.listMcp({ page: 2, size: 5 })
    expect(p2.list).toHaveLength(5)
    expect(p2.total).toBe(11)
    expect(p2.list[0].name).toBe(all.list[5].name)
    const p3 = await m.listMcp({ page: 3, size: 5 })
    expect(p3.list).toHaveLength(1)
    expect(p3.total).toBe(11)
  })

  it('⑥ listMcp state 筛选：PUBLISHED / PENDING_REVIEW 精确；NOT_PUBLISHED 含已停用（DELISTED）与已驳回（REJECTED）（md §二.4 L155）', async () => {
    const pub = await m.listMcp({ state: 'PUBLISHED' })
    expect(pub.list.map((r) => r.code).sort()).toEqual(['calendar', 'expense_mcp', 'knowledge_hub', 'spark_bridge_mcp'])
    const pending = await m.listMcp({ state: 'PENDING_REVIEW' })
    expect(pending.list.map((r) => r.code).sort()).toEqual(['crm', 'local_files'])
    const np0 = await m.listMcp({ state: 'NOT_PUBLISHED' })
    expect(np0.total).toBe(5)
    // 已发布 calendar 停用 → 归未发布；审核中 crm 驳回 → 归未发布
    await m.delistMcpService('calendar')
    await m.reviewMcpService('crm', { approve: false })
    const np1 = await m.listMcp({ state: 'NOT_PUBLISHED' })
    expect(np1.total).toBe(7)
    expect(np1.list.map((r) => r.code)).toEqual(expect.arrayContaining(['calendar', 'crm']))
    expect((await m.listMcp({ state: 'PUBLISHED' })).list.map((r) => r.code)).not.toContain('calendar')
    // 聚合态原值仍可从发布状态端点读到（DELISTED / REJECTED 不被抹平）
    expect((await m.getMcpServicePublishStatus('calendar')).targets[0].aggregateStatus).toBe('DELISTED')
    expect((await m.getMcpServicePublishStatus('crm')).targets[0].aggregateStatus).toBe('REJECTED')
  })

  // ⑦ 新建初值（md §二.2 L58 从未验证：不展示时间；§二.4 新建即未发布）
  it('⑦ 新建：验证态 UNKNOWN / connStatus unknown / lastCheckedAt null / publishedAt null / 聚合态 NOT_PUBLISHED / 工具 0 个', async () => {
    const created = await m.createMcp(mkStdioIn('mcp_fresh'))
    expect(created).toMatchObject({
      displayStatus: 'UNKNOWN',
      connStatus: 'unknown',
      lastCheckedAt: null,
      lastCheckError: null,
      publishedAt: null,
      toolCount: 0,
      referencedBySkillCount: 0,
      status: 'active'
    })
    expect(created.createdAt).toBeTruthy()
    const st = await m.getMcpServicePublishStatus(created.id)
    expect(st.targets).toEqual([{ target: 'USER_END', aggregateStatus: 'NOT_PUBLISHED' }])
    expect(st.toolTotal).toBe(0)
    // code 重复被拦（field=code）
    await expect(m.createMcp(mkStdioIn('mcp_fresh'))).rejects.toMatchObject({ field: 'code' })
    // code 留空自动编号
    const auto = await m.createMcp(mkStdioIn(''))
    expect(auto.code).toMatch(/^mcp_\d+$/)
  })

  // ⑧ 删除（md §二.3.7 软引用）/ 撤回（§二.3.5）/ 发布状态端点 / 审核驳回
  it('⑧ deleteMcp：被 3 个技能引用的 knowledge_hub 也能删（软引用）；删后详情报「MCP 不存在」、列表 total 减 1', async () => {
    expect((await m.getMcp('knowledge_hub')).referencedBySkillCount).toBe(3)
    await m.deleteMcp('knowledge_hub')
    await expect(m.getMcp('knowledge_hub')).rejects.toThrow('MCP 不存在')
    const { list, total } = await m.listMcp()
    expect(total).toBe(10)
    expect(list.map((r) => r.code)).not.toContain('knowledge_hub')
  })

  it('⑧ 状态机：发布 → 审核中；撤回 → 未发布（不置 publishedAt）；再发布后驳回 → REJECTED（列表归未发布）', async () => {
    const created = await m.createMcp(mkStdioIn('mcp_state'))
    const agg = async () => (await m.getMcpServicePublishStatus(created.id)).targets[0].aggregateStatus
    expect(await agg()).toBe('NOT_PUBLISHED')
    await m.publishMcpService(created.id)
    expect(await agg()).toBe('PENDING_REVIEW')
    await m.withdrawMcpService(created.id)
    expect(await agg()).toBe('NOT_PUBLISHED')
    expect((await m.getMcp(created.id)).publishedAt).toBeNull()
    await m.publishMcpService(created.id)
    await m.reviewMcpService(created.id, { approve: false })
    expect(await agg()).toBe('REJECTED')
    expect((await m.getMcp(created.id)).publishedAt).toBeNull()
    const np = await m.listMcp({ state: 'NOT_PUBLISHED', keyword: 'mcp_state' })
    expect(np.list.map((r) => r.code)).toEqual(['mcp_state'])
    // 发布不存在的 id → 报错
    await expect(m.publishMcpService('no_such_mcp')).rejects.toThrow('MCP 不存在')
  })

  it('⑧ 拉取工具成功：工具全集覆盖为 SPARK_TOOLS（3 个）+ 行落 HEALTHY + 写最近验证时间（md §三.6）', async () => {
    const created = await m.createMcp(mkStdioIn('mcp_fetch'))
    const r = await m.fetchMcpTools(created.id)
    expect(r.tools.map((t) => t.name)).toEqual(['spark_agent_chat', 'spark_scene_run', 'spark_knowledge_qa'])
    const row = await m.getMcp(created.id)
    expect(row.toolCount).toBe(3)
    expect(row.displayStatus).toBe('HEALTHY')
    expect(row.lastCheckedAt).toBeTruthy()
    expect(row.serverName).toBe('spark-bridge')
  })
})

/**
 * 2026-09-12 测试审计补缺口（F8）：mcpConnectorMock 持久化零用例（mockPersist v5；7 个业务写点：
 * createMcp / updateMcp / deleteMcp / fetchMcpTools / healthCheckMcpTool / publishMcpService / setAgg 系）。
 * 本仓 jsdom 下 globalThis.localStorage 为 undefined → 注入内存版存储 + vi.resetModules 动态 import。
 */
describe('mcpConnectorMock · 持久化（mockPersist v5）', () => {
  const KEY = 'iworker-demo-mock:mcpConnector'
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
    globalThis.localStorage = makeStorage()
    vi.resetModules()
    stubInstantTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.localStorage
    vi.resetModules()
  })

  it('七个写点各落盘一次（setItem 逐一 +1）；列表 / 详情 / 测试连接 / 读发布态不落盘', async () => {
    const m = await import('../mcpConnectorMock')
    const writes = () => globalThis.localStorage.setItem.mock.calls.filter(([k]) => k === KEY).length
    const base = writes()
    await m.listMcp()
    await m.getMcp('calendar')
    await m.testMcpConn({ id: 'calendar' })
    await m.getMcpServicePublishStatus('calendar')
    expect(writes()).toBe(base)
    const created = await m.createMcp({ code: 'mcp_persist', name: 'P', transport: 'stdio', command: 'npx' })
    expect(writes()).toBe(base + 1)
    await m.updateMcp(created.id, { description: 'd' })
    expect(writes()).toBe(base + 2)
    await m.fetchMcpTools(created.id)
    expect(writes()).toBe(base + 3)
    await m.healthCheckMcpTool(created.id)
    expect(writes()).toBe(base + 4)
    await m.publishMcpService(created.id)
    expect(writes()).toBe(base + 5)
    await m.withdrawMcpService(created.id)
    expect(writes()).toBe(base + 6)
    await m.deleteMcp(created.id)
    expect(writes()).toBe(base + 7)
  })

  it('新建落盘（v=5）→ 重新 import（模拟刷新）→ 新行仍在、发布态仍在、mcpSeq 延续', async () => {
    const first = await import('../mcpConnectorMock')
    const created = await first.createMcp({ code: 'mcp_reload', name: '刷新后还在', transport: 'stdio', command: 'npx' })
    await first.publishMcpService(created.id)
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(5)
    expect(snap.data.mcps.map((x) => x.code)).toContain('mcp_reload')
    expect(snap.data.pubAgg.mcp_reload).toBe('PENDING_REVIEW')
    vi.resetModules()
    const fresh = await import('../mcpConnectorMock')
    const row = await fresh.getMcp('mcp_reload')
    expect(row.name).toBe('刷新后还在')
    expect((await fresh.getMcpServicePublishStatus('mcp_reload')).targets[0].aggregateStatus).toBe('PENDING_REVIEW')
    expect((await fresh.listMcp()).total).toBe(12)
    const auto = await fresh.createMcp({ code: '', name: '自动编号', transport: 'stdio', command: 'npx' })
    expect(auto.code).toBe(`mcp_${snap.data.mcpSeq}`)
  })

  it('旧版本快照（v=4）→ 丢弃并回种子 11 条（不带入旧行）', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 4, data: { mcpSeq: 99, mcps: [{ id: 'old', code: 'old', name: '旧', tools: [], env: [] }], pubAgg: {} } }))
    const m = await import('../mcpConnectorMock')
    const { list, total } = await m.listMcp()
    expect(total).toBe(11)
    expect(list.map((r) => r.code)).not.toContain('old')
  })

  it('坏形状快照（mcps 不是数组）→ restore 抛「mcpConnector 快照形状不合法」被兜底，回种子 + console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 5, data: { mcpSeq: 1, mcps: 'oops', pubAgg: {} } }))
    const m = await import('../mcpConnectorMock')
    expect((await m.listMcp()).total).toBe(11)
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][1]?.message || '')).toContain('mcpConnector 快照形状不合法')
    warn.mockRestore()
  })
})
