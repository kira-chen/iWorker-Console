import { describe, it, expect, beforeEach } from 'vitest'

/**
 * reviewEnroll.js（审核接线公共件）直接单测。
 *
 * 业务模块提交发布 / 停用时只调一次 enrollReview，由它同时落「审核中心行」与「我的申请行」（reviewEnroll 头注）。
 * 本文件守的是 2026-10-12「强制回收并入停用」新增的透传规则（PRD 审核中心 §5.2、各模块「强制回收（停用时勾选）」）：
 * forceRevokeReason 非空 → 两张表的行都带该字段（审核中心 / 我的申请据此展示红色「强制回收」标记）；
 * 空串 / 缺省 → 两张表的行都**没有**该键（普通停用不留空字段）。
 *
 * 两个治理 mock 一律动态 import，保证与 reviewEnroll 内部静态引用的是同一个模块实例（见 reviewFlowIntegration 头注）。
 */
const load = async () => ({
  enroll: await import('../reviewEnroll'),
  gov: await import('../reviewsMock'),
  app: await import('../myApplicationsMock')
})

describe('reviewEnroll.enrollReview · 强制回收原因透传两张表', { timeout: 60000 }, () => {
  let t
  beforeEach(async () => {
    t = await load()
    t.gov.resetReviewsMock()
    t.app.resetMyApplicationsMock()
  })

  const base = { businessType: 'EXPERT', refId: 9001, name: '示例专家', requestAction: 'DELIST', version: 'v1.0.0' }
  const rowsOf = async () => ({
    review: (await t.gov.listReviews({ keyword: '示例专家', size: 50 })).list.find((r) => r.refId === 9001),
    application: (await t.app.listMyApplications({ keyword: '示例专家', size: 50 })).list.find((r) => r.refId === 9001)
  })

  it('带 forceRevokeReason → 审核中心行与我的申请行都带该字段', async () => {
    t.enroll.enrollReview({ ...base, forceRevokeReason: '内容违规' })
    const { review, application } = await rowsOf()
    expect(review).toMatchObject({ requestAction: 'DELIST', forceRevokeReason: '内容违规' })
    expect(application).toMatchObject({ applicationType: 'DELIST', forceRevokeReason: '内容违规' })
  })

  it('空串 → 两张表的行都没有 forceRevokeReason 键', async () => {
    t.enroll.enrollReview({ ...base, forceRevokeReason: '' })
    const { review, application } = await rowsOf()
    expect(review).toBeTruthy()
    expect(application).toBeTruthy()
    expect('forceRevokeReason' in review).toBe(false)
    expect('forceRevokeReason' in application).toBe(false)
  })

  it('缺省（普通停用 / 发布申请）→ 两张表的行都没有 forceRevokeReason 键', async () => {
    t.enroll.enrollReview({ ...base, requestAction: 'FIRST_PUBLISH' })
    const { review, application } = await rowsOf()
    expect('forceRevokeReason' in review).toBe(false)
    expect('forceRevokeReason' in application).toBe(false)
  })

  it('同一对象先提交普通停用、撤回后再提交强制回收停用 → 新行带标记；再撤回重提普通停用 → 标记不残留', async () => {
    t.enroll.enrollReview(base)
    t.enroll.unenrollReview('EXPERT', 9001)
    t.enroll.enrollReview({ ...base, forceRevokeReason: '接口下线' })
    expect((await rowsOf()).review.forceRevokeReason).toBe('接口下线')
    t.enroll.unenrollReview('EXPERT', 9001)
    t.enroll.enrollReview(base)
    const { review, application } = await rowsOf()
    expect('forceRevokeReason' in review).toBe(false)
    expect('forceRevokeReason' in application).toBe(false)
  })
})
