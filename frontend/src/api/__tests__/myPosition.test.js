import { describe, it, expect, vi, beforeEach } from 'vitest'

// myPosition.js 依赖 ./request（其链路含 router 需 window）。mock 掉 axios 实例，
// 仅验证各 API 的 method/path/body 与契约 §5 一致 + 写接口带 skipGlobalError。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }
}))

const request = (await import('@/api/request')).default
const { getIntakeSchema, claimPosition, updateIntakeValues, getCurrentPosition } = await import(
  '@/api/myPosition'
)

describe('myPosition API · 契约 §5', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getIntakeSchema → GET /my-positions/{id}/intake-schema', () => {
    getIntakeSchema(5)
    expect(request.get).toHaveBeenCalledWith('/my-positions/5/intake-schema')
  })

  it('claimPosition → POST /claim，body {intakeValues}，带 skipGlobalError', () => {
    claimPosition(5, { region: '华东' })
    expect(request.post).toHaveBeenCalledWith(
      '/my-positions/5/claim',
      { intakeValues: { region: '华东' } },
      { skipGlobalError: true }
    )
  })

  it('updateIntakeValues → PUT /intake-values，body {intakeValues}，带 skipGlobalError', () => {
    updateIntakeValues(5, { region: '华北' })
    expect(request.put).toHaveBeenCalledWith(
      '/my-positions/5/intake-values',
      { intakeValues: { region: '华北' } },
      { skipGlobalError: true }
    )
  })

  it('getCurrentPosition → GET /my-positions/current', () => {
    getCurrentPosition()
    expect(request.get).toHaveBeenCalledWith('/my-positions/current')
  })
})
