import { describe, it, expect } from 'vitest'
import { statusMeta, writeClassMeta, mcpListStateMeta } from '@/utils/marketMeta'

describe('marketMeta · statusMeta / writeClassMeta', () => {
  it('四态状态映射到正确 StatusTag type', () => {
    expect(statusMeta('PENDING_REVIEW').type).toBe('warning')
    expect(statusMeta('PUBLISHED').type).toBe('success')
    expect(statusMeta('REJECTED').type).toBe('danger')
    expect(statusMeta('DELISTED').type).toBe('info')
  })
  it('未知状态回落 info', () => {
    expect(statusMeta('FOO').type).toBe('info')
  })
  it('writeClass 二态有标签，未知返回 null', () => {
    expect(writeClassMeta('READ').label).toBe('读')
    expect(writeClassMeta('WRITE').label).toBe('写')
    expect(writeClassMeta(null)).toBeNull()
  })
})

describe('marketMeta · mcpListStateMeta（MCP 列表三态归并，md MCP §二.4 L155）', () => {
  it('PUBLISHED → 已发布 / PENDING_REVIEW → 审核中 / NOT_PUBLISHED、DELISTED、REJECTED、PARTIAL、未知 → 未发布', () => {
    expect(mcpListStateMeta('PUBLISHED')).toEqual({ type: 'success', label: '已发布' })
    expect(mcpListStateMeta('PENDING_REVIEW')).toEqual({ type: 'warning', label: '审核中' })
    for (const s of ['NOT_PUBLISHED', 'DELISTED', 'REJECTED', 'PARTIAL', 'WHATEVER', undefined]) {
      expect(mcpListStateMeta(s)).toEqual({ type: 'info', label: '未发布' })
    }
  })
})
