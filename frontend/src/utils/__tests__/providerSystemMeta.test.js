import { describe, it, expect } from 'vitest'
import { providerSystemDeleteBlockReason } from '../providerSystemMeta'

/**
 * utils/providerSystemMeta 单测（2026-11-16：API 与 MCP 各有一套服务提供系统，删除时只查本页签的连接器）。
 * 拦截文案同时用于列表【删除系统】置灰提示与 mock 兜底拒绝，这里只验文案本身。
 */
describe('providerSystemDeleteBlockReason：删除服务提供系统的拦截原因', () => {
  it('API 页签：「该系统下有 N 个 API，需先迁移或删除后才能删除系统」（prd-API.md §二.5）', () => {
    expect(providerSystemDeleteBlockReason(2, 'API')).toBe('该系统下有 2 个 API，需先迁移或删除后才能删除系统')
  })

  it('MCP 页签：「该系统下有 N 个 MCP，需先迁移或删除后才能删除系统」（prd-连接器-MCP.md §二.7）', () => {
    expect(providerSystemDeleteBlockReason(1, 'MCP')).toBe('该系统下有 1 个 MCP，需先迁移或删除后才能删除系统')
  })

  it('系统下没有连接器：返回空串（可删）', () => {
    expect(providerSystemDeleteBlockReason(0, 'API')).toBe('')
    expect(providerSystemDeleteBlockReason(0, 'MCP')).toBe('')
  })
})
