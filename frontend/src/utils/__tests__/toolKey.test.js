import { describe, it, expect } from 'vitest'
import {
  normType,
  toolKey,
  isToolSelected,
  toggleTool,
  setToolConfirm,
  selectedOrder,
  TOOL_TYPES
} from '@/utils/toolKey'

describe('normType', () => {
  it('大写归一，缺省 / 非法兜底 MOCK', () => {
    expect(normType('mock')).toBe('MOCK')
    expect(normType('Mcp')).toBe('MCP')
    expect(normType('api')).toBe('API')
    expect(normType(undefined)).toBe('MOCK')
    expect(normType('weird')).toBe('MOCK')
  })
  it('TOOL_TYPES 暴露三来源', () => {
    expect(TOOL_TYPES).toEqual(['MOCK', 'MCP', 'API'])
  })
})

describe('toolKey 联合键', () => {
  it('type+code 组合，type 归一', () => {
    expect(toolKey('mcp', 'query')).toBe('MCP::query')
    expect(toolKey('MOCK', 'query')).toBe('MOCK::query')
  })
  it('同 code 跨源键不同（B3 关键：不可只用 code）', () => {
    expect(toolKey('MOCK', 'query')).not.toBe(toolKey('MCP', 'query'))
  })
})

describe('isToolSelected', () => {
  const sel = [
    { type: 'MOCK', code: 'a' },
    { type: 'MCP', code: 'mcp__x__q' }
  ]
  it('按 type+code 联合键命中', () => {
    expect(isToolSelected(sel, 'MOCK', 'a')).toBe(true)
    expect(isToolSelected(sel, 'MCP', 'mcp__x__q')).toBe(true)
  })
  it('同 code 不同 type 不误判命中', () => {
    expect(isToolSelected(sel, 'MCP', 'a')).toBe(false)
    expect(isToolSelected(sel, 'API', 'a')).toBe(false)
  })
  it('type 大小写不影响匹配', () => {
    expect(isToolSelected(sel, 'mock', 'a')).toBe(true)
  })
})

describe('toggleTool', () => {
  it('勾选追加并以工具默认 requiresConfirmation 初始化', () => {
    const next = toggleTool([], { type: 'MCP', code: 'mcp__x__q', requiresConfirmation: true }, true)
    expect(next).toEqual([{ type: 'MCP', code: 'mcp__x__q', requiresConfirmation: true }])
  })
  it('重复勾选不重复追加（去重按联合键）', () => {
    const base = [{ type: 'MCP', code: 'q', requiresConfirmation: false }]
    const next = toggleTool(base, { type: 'MCP', code: 'q' }, true)
    expect(next).toBe(base) // 原样返回，未变更
  })
  it('取消按 type+code 精确移除，不误删同 code 异源', () => {
    const base = [
      { type: 'MOCK', code: 'q', requiresConfirmation: false },
      { type: 'MCP', code: 'q', requiresConfirmation: false }
    ]
    const next = toggleTool(base, { type: 'MCP', code: 'q' }, false)
    expect(next).toEqual([{ type: 'MOCK', code: 'q', requiresConfirmation: false }])
  })
  it('勾选保持已有顺序、追加到末尾', () => {
    const base = [{ type: 'MOCK', code: 'a', requiresConfirmation: false }]
    const next = toggleTool(base, { type: 'API', code: 'b' }, true)
    expect(next.map((s) => s.code)).toEqual(['a', 'b'])
  })
})

describe('setToolConfirm', () => {
  it('按 type+code 定位修改 requiresConfirmation，不波及同 code 异源', () => {
    const base = [
      { type: 'MOCK', code: 'q', requiresConfirmation: false },
      { type: 'MCP', code: 'q', requiresConfirmation: false }
    ]
    const next = setToolConfirm(base, 'MCP', 'q', true)
    expect(next.find((s) => s.type === 'MCP').requiresConfirmation).toBe(true)
    expect(next.find((s) => s.type === 'MOCK').requiresConfirmation).toBe(false)
  })
})

describe('selectedOrder', () => {
  it('返回 1 起序号；未选返回 0', () => {
    const sel = [
      { type: 'MOCK', code: 'a' },
      { type: 'MCP', code: 'b' }
    ]
    expect(selectedOrder(sel, 'MOCK', 'a')).toBe(1)
    expect(selectedOrder(sel, 'MCP', 'b')).toBe(2)
    expect(selectedOrder(sel, 'API', 'c')).toBe(0)
  })
})
