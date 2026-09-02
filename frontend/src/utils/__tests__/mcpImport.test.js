import { describe, it, expect } from 'vitest'
import { parseMcpConfig, suggestCodeFromKey } from '@/utils/mcpImport'

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

  it('显式 type=sse 归一为 streamable-http', () => {
    const r = parseMcpConfig(JSON.stringify({ mcpServers: { foo: { type: 'sse', url: 'https://x/sse' } } }))
    expect(r.transport).toBe('streamable-http')
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

describe('suggestCodeFromKey — 别名规整为候选 code', () => {
  it('连字符转下划线', () => {
    expect(suggestCodeFromKey('amap-maps')).toBe('amap_maps')
  })
  it('大写转小写、去首尾下划线', () => {
    expect(suggestCodeFromKey('-My.Server-')).toBe('my_server')
  })
  it('空输入 → 空串', () => {
    expect(suggestCodeFromKey('')).toBe('')
  })
})
