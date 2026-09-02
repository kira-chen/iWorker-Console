import { describe, it, expect, vi, beforeEach } from 'vitest'

// myUserPosition.js 透传 import './request'（链路含 router→createWebHistory 需 window）。
// mock 掉 request 的 axios 实例，验证 US-6 收窄后的接口：
// - 保留：读视图 / 改字段(白名单 persona+buddyName) / 单字段还原 / 整体还原
// - 移除：R2 私有 Skill 副本相关（getSkillEditable / saveSkillOverride / resetSkill）

const get = vi.fn()
const put = vi.fn()
const del = vi.fn()
vi.mock('@/api/request', () => ({
  default: {
    get: (...a) => get(...a),
    put: (...a) => put(...a),
    delete: (...a) => del(...a)
  }
}))

const api = await import('@/api/myUserPosition')

describe('myUserPosition API · US-6 收窄', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
    del.mockReset()
  })

  it('getEffectivePosition → GET /my-positions/{id}', () => {
    api.getEffectivePosition(7)
    expect(get).toHaveBeenCalledWith('/my-positions/7')
  })

  it('updatePositionFields → PUT /fields，原样透传白名单字段（persona）', () => {
    api.updatePositionFields(7, { persona: '简洁直接' })
    expect(put).toHaveBeenCalledWith('/my-positions/7/fields', { persona: '简洁直接' })
  })

  it('updatePositionFields 走同一写通道携带 buddyName', () => {
    api.updatePositionFields(7, { buddyName: '小蓝' })
    expect(put).toHaveBeenCalledWith('/my-positions/7/fields', { buddyName: '小蓝' })
  })

  it('resetField → DELETE /fields/{field}', () => {
    api.resetField(7, 'persona')
    expect(del).toHaveBeenCalledWith('/my-positions/7/fields/persona')
  })

  it('resetAll → DELETE /personalization', () => {
    api.resetAll(7)
    expect(del).toHaveBeenCalledWith('/my-positions/7/personalization')
  })

  it('R2 私有 Skill 副本接口已下线（不再导出）', () => {
    expect(api.getSkillEditable).toBeUndefined()
    expect(api.saveSkillOverride).toBeUndefined()
    expect(api.resetSkill).toBeUndefined()
  })
})
