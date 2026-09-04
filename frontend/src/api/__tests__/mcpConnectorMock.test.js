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
  fetchMcpToolsDraft,
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
})
