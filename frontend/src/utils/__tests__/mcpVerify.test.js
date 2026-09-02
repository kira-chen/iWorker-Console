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
   * 与后端 failReason 的对齐守卫。
   *
   * 后端 `ToolHealthService#failReason` / `McpProvisionService#failReason` 把
   * McpTransportException.ErrorKind 穷举映射成这五条中文简述。两处 switch 完全一致，
   * 是封闭集合。此处逐条锁定——后端改了措辞而前端没跟，这条会红。
   */
  it('五种 ErrorKind 的中文简述全部登记在案（与后端 failReason 对齐）', () => {
    for (const brief of [
      '连接超时',
      '连接失败',
      '服务端无对应方法',
      '服务端返回错误',
      '响应解析失败'
    ]) {
      expect(MCP_ERROR_CATALOG[brief], `后端 failReason 的「${brief}」未登记`).toBeTruthy()
      expect(explainMcpError(brief).code).not.toBe('UNKNOWN')
    }
  })

  it('探测前置校验的三种简述也已登记', () => {
    for (const brief of ['该接入方式暂未支持', 'endpoint 未配置', '工具清单响应异常']) {
      expect(explainMcpError(brief).code).not.toBe('UNKNOWN')
    }
  })
})
