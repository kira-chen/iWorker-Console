import { describe, it, expect } from 'vitest'
import { explainMcpError, MCP_ERROR_CATALOG } from '@/utils/mcpVerify'

describe('mcpVerify · 检活错误分类反查', () => {
  it('登记过的中文简述 → 反查出技术错误码与人话原因', () => {
    expect(explainMcpError('连接超时')).toEqual({
      code: 'TIMEOUT',
      reason: '在超时时间内没有收到响应'
    })
    expect(explainMcpError('连接失败').code).toBe('CONN_FAILED')
    expect(explainMcpError('响应解析失败').code).toBe('PROTOCOL_ERROR')
  })

  it('前后空白不影响匹配（落库值可能带空白）', () => {
    expect(explainMcpError('  连接超时  ').code).toBe('TIMEOUT')
  })

  it('空值 → UNKNOWN 且原因为空（调用方据此显「未知原因」）', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(explainMcpError(v)).toEqual({ code: 'UNKNOWN', reason: '' })
    }
  })

  it('未登记的简述 → 原文透出、码显 UNKNOWN，绝不编造分类', () => {
    // 后端新增 ErrorKind 但前端漏登记时的兜底：原文本身就是最贴近事实的说明，
    // 猜一个码反而会误导排障的人。
    const r = explainMcpError('服务端证书校验失败')
    expect(r.code).toBe('UNKNOWN')
    expect(r.reason).toBe('服务端证书校验失败')
  })

  /**
   * 错误目录封闭集守卫。
   *
   * 2026-09-12 头注更新（审计 D8）：原注释引用的后端 `ToolHealthService#failReason` /
   * `McpProvisionService#failReason` 已随发布单元退役；本仓为纯前端 demo，检活简述由
   * api/mcpConnectorMock 下发（种子 lastCheckError 为「连接超时」「服务端返回错误」，
   * 见该文件 MCP_SEEDS）。目录 key 即前端自己维护的封闭集，此处逐条锁定——
   * 目录被误删一条，列表验证列悬浮的「错误码」会退成 UNKNOWN（md MCP §二.2 L61）。
   *
   * 注：mock 手动检活失败用的 MOCK_FAIL_REASON 自 2026-09-12（审计 J16 闭环）起改为目录 key「连接失败」
   * （mcpConnectorMock / apiConnectorMock 同改），下方遍历即覆盖；其断言见各 mock 的测试文件。
   */
  it('五种传输层错误简述全部登记在案（mock 种子 lastCheckError 也在其中）', () => {
    for (const brief of [
      '连接超时',
      '连接失败',
      '服务端无对应方法',
      '服务端返回错误',
      '响应解析失败'
    ]) {
      expect(MCP_ERROR_CATALOG[brief], `错误简述「${brief}」未登记`).toBeTruthy()
      expect(explainMcpError(brief).code).not.toBe('UNKNOWN')
    }
  })

  it('探测前置校验的三种简述也已登记', () => {
    for (const brief of ['该接入方式暂未支持', 'endpoint 未配置', '工具清单响应异常']) {
      expect(explainMcpError(brief).code).not.toBe('UNKNOWN')
    }
  })
})
