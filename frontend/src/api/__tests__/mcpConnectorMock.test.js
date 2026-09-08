// @vitest-environment jsdom
// （mcpConnectorMock → request.js → router 链路触达 window，故用 jsdom；同 bizSystemMock.test.js）
// 2026-09-04 PRD-20260903 对齐新口径：工具种子 title（工具卡双层标题）、示例问题落库+回显、
// args 持久化回显、publishedAt（最近发布时间）出参与审核通过刷新。
// 注意：vitest 随机顺序执行——种子断言只读 spark_bridge_mcp（本文件不改写它）；
// 增改/发布用例各自新建专属行自洽驱动。
import { describe, it, expect } from 'vitest'
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

describe('mcpConnectorMock —— 2026-09-04 PRD-20260903 对齐新口径', () => {
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

  it('种子示例问题照新原型兜底 3 条', async () => {
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
})
