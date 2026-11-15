import { describe, it, expect } from 'vitest'
import { providerSystemDeleteBlockReason } from '../providerSystemMeta'

/**
 * utils/providerSystemMeta 单测（2026-11-10 产品优化需求-202611 修改点 14（R9）：服务提供系统由 API 与 MCP 共用，
 * 「删除服务提供系统时，除 API 外也要检查其下是否还有 MCP」）。
 * 拦截文案同时用于 API 列表【删除系统】置灰提示与 mock 兜底拒绝，这里只验文案本身的四种形态。
 */
describe('providerSystemDeleteBlockReason：删除服务提供系统的拦截原因', () => {
  it('只有 API：与 R9 之前的文案逐字一致（prd-API.md §二.5）', () => {
    expect(providerSystemDeleteBlockReason({ apiCount: 2 })).toBe('该系统下有 2 个 API，需先迁移或删除后才能删除系统')
  })

  it('只有 MCP：点名数量与名称', () => {
    expect(providerSystemDeleteBlockReason({ apiCount: 0, mcpNames: ['报销系统 MCP'] })).toBe(
      '该系统下有 1 个 MCP（报销系统 MCP），需先迁移或删除后才能删除系统'
    )
  })

  it('API 与 MCP 都有：两段用顿号并列，API 在前', () => {
    expect(providerSystemDeleteBlockReason({ apiCount: 2, mcpNames: ['报销系统 MCP', '合同系统 MCP'] })).toBe(
      '该系统下有 2 个 API、2 个 MCP（报销系统 MCP、合同系统 MCP），需先迁移或删除后才能删除系统'
    )
  })

  it('MCP 超过 3 个：只点名前 3 个并以「等」收尾，数量仍是全部', () => {
    expect(providerSystemDeleteBlockReason({ mcpNames: ['甲 MCP', '乙 MCP', '丙 MCP', '丁 MCP'] })).toBe(
      '该系统下有 4 个 MCP（甲 MCP、乙 MCP、丙 MCP等），需先迁移或删除后才能删除系统'
    )
  })

  it('既无 API 也无 MCP：返回空串（可删）', () => {
    expect(providerSystemDeleteBlockReason({ apiCount: 0, mcpNames: [] })).toBe('')
    expect(providerSystemDeleteBlockReason()).toBe('')
  })
})
