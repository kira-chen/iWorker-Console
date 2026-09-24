import { describe, it, expect } from 'vitest'
import { parseMcpConfig } from '@/utils/mcpImport'

describe('parseMcpConfig — 标准 stdio 配置', () => {
  it('解析 mcpServers 包裹的 stdio 服务（command/args/env）', () => {
    const text = JSON.stringify({
      mcpServers: {
        'amap-maps': {
          args: ['-y', '@amap/amap-maps-mcp-server'],
          command: 'npx',
          env: { AMAP_MAPS_API_KEY: '' }
        }
      }
    })
    const r = parseMcpConfig(text)
    expect(r.ok).toBe(true)
    expect(r.key).toBe('amap-maps')
    expect(r.transport).toBe('stdio')
    expect(r.command).toBe('npx')
    expect(r.args).toEqual(['-y', '@amap/amap-maps-mcp-server'])
    expect(r.env).toEqual([{ key: 'AMAP_MAPS_API_KEY', value: '' }])
    // env 值为空 → 告警提示补全
    expect(r.warnings.some((w) => w.includes('值为空'))).toBe(true)
  })

  it('无 env 的 stdio 服务（如支付宝示例）也能解析', () => {
    const text = JSON.stringify({
      mcpServers: { 'alipay-subscription': { args: ['-y', '@alipay/open-mcp-server'], command: 'npx' } }
    })
    const r = parseMcpConfig(text)
    expect(r.ok).toBe(true)
    expect(r.transport).toBe('stdio')
    expect(r.env).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe('parseMcpConfig — http / transport 推断', () => {
  it('有 url → 判定 streamable-http，url 落 endpoint', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { url: 'https://x/mcp' } } }))
    expect(r.ok).toBe(true)
    expect(r.transport).toBe('streamable-http')
    expect(r.endpoint).toBe('https://x/mcp')
  })

  it('显式 type=sse 保持为 sse（旧版 HTTP+SSE），不再悄悄转成 streamable-http', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { type: 'sse', url: 'https://x/sse' } } }))
    expect(r.ok).toBe(true)
    expect(r.transport).toBe('sse')
    expect(r.endpoint).toBe('https://x/sse')
  })

  it('type 大小写不敏感：SSE → sse；http / streamablehttp 仍归一为 streamable-http', () => {
    const parse = (type) => parseMcpConfig(JSON.stringify({ mcpServers: { foo: { type, url: 'https://x/y' } } })).transport
    expect(parse('SSE')).toBe('sse')
    expect(parse('http')).toBe('streamable-http')
    expect(parse('streamablehttp')).toBe('streamable-http')
  })

  it('sse 带 command 时不被当成 stdio 的 command 分支处理（type 显式声明优先）', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { type: 'sse', url: 'https://x/sse', command: 'npx' } } }))
    expect(r.transport).toBe('sse')
    expect(r.warnings.some((w) => w.includes('command'))).toBe(true)
  })

  it('http 带 headers → 告警提示手动配鉴权', () => {
    const r = parseMcpConfig(
      JSON.stringify({ mcpServers: { foo: { url: 'https://x', headers: { Authorization: 'Bearer t' } } } })
    )
    expect(r.warnings.some((w) => w.includes('headers'))).toBe(true)
  })
})

describe('parseMcpConfig — 兼容形态与边界', () => {
  it('裸单服务对象（无 mcpServers 包裹）', () => {
    const r = parseMcpConfig(JSON.stringify({ command: 'uvx', args: ['mcp-server-time'] }))
    expect(r.ok).toBe(true)
    expect(r.transport).toBe('stdio')
    expect(r.command).toBe('uvx')
    expect(r.key).toBe('')
  })

  it('多个服务 → 取第一个，其余记入 extraKeys 并告警', () => {
    const r = parseMcpConfig(
      JSON.stringify({ mcpServers: { a: { command: 'npx' }, b: { command: 'uvx' } } })
    )
    expect(r.key).toBe('a')
    expect(r.extraKeys).toEqual(['b'])
    expect(r.warnings.some((w) => w.includes('仅导入'))).toBe(true)
  })

  it('空文本 → 报错', () => {
    expect(parseMcpConfig('').ok).toBe(false)
    expect(parseMcpConfig('   ').ok).toBe(false)
  })

  it('非法 JSON → 报错', () => {
    const r = parseMcpConfig('{ not json')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('JSON 解析失败')
  })

  it('mcpServers 为空对象 → 报错', () => {
    expect(parseMcpConfig(JSON.stringify({ mcpServers: {} })).ok).toBe(false)
  })

  it('command 不在 md §三.4.2 五项枚举内（bash / 绝对路径等）→ 不回填并提示手动选择（2026-09-18 待办 yuepu#13·连接器 C1）', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { command: 'bash', args: ['-c', 'x'] } } }))
    expect(r.ok).toBe(true)
    expect(r.transport).toBe('stdio')
    expect(r.command).toBe('')
    expect(r.args).toEqual(['-c', 'x'])
    expect(r.warnings.some((w) => w.includes('启动命令「bash」不在可选范围') && w.includes('npx / uvx / node / python3 / docker'))).toBe(true)
    // 枚举内的照常回填、无该条提示
    const ok = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { command: 'docker', args: ['run'] } } }))
    expect(ok.command).toBe('docker')
    expect(ok.warnings.some((w) => w.includes('不在可选范围'))).toBe(false)
  })

  it('既无 command 也无 url → 报错', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { description: 'x' } } }))
    expect(r.ok).toBe(false)
  })

  it('args 非数组 / env 非对象 → 忽略并告警', () => {
    const r = parseMcpConfig(
      JSON.stringify({ mcpServers: { foo: { command: 'npx', args: 'oops', env: 'oops' } } })
    )
    expect(r.ok).toBe(true)
    expect(r.args).toEqual([])
    expect(r.env).toEqual([])
    expect(r.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
