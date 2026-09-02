// @vitest-environment jsdom
// （skillReviewMock → request.js → router 链路触达 window，故用 jsdom，同 domainExpertMock.test.js）
// 用户技能审核 mock 单测（2026-09-02 补齐 mock 层时新增）。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listReviewApplications,
  getReviewApplication,
  reviewApplication,
  __resetSkillReviewMock
} from '../skillReviewMock'

beforeEach(() => __resetSkillReviewMock())

describe('skillReviewMock', () => {
  it('列表：默认按提交时间倒序返回 {list,total}，含页面消费的关键字段', async () => {
    const { list, total } = await listReviewApplications({ page: 1, size: 20 })
    expect(total).toBe(4)
    expect(list[0].createdAt >= list[1].createdAt).toBe(true)
    const row = list[0]
    for (const k of ['id', 'skillName', 'purpose', 'reviewStatus', 'applicantName', 'createdAt']) {
      expect(row).toHaveProperty(k)
    }
  })

  it('列表筛选：status/purpose/keyword 均生效', async () => {
    expect((await listReviewApplications({ status: 'PENDING' })).total).toBe(2)
    expect((await listReviewApplications({ purpose: 'SELF_USE' })).total).toBe(1)
    expect((await listReviewApplications({ keyword: '报销' })).total).toBe(1)
  })

  it('详情：含 SkillFocusEditor 需要的 riskItems{typeName,levelName,description}', async () => {
    const d = await getReviewApplication('sk_308')
    expect(d.riskItems.length).toBeGreaterThan(0)
    expect(d.riskItems[0]).toHaveProperty('typeName')
    expect(d.riskItems[0]).toHaveProperty('levelName')
    expect(d.riskItems[0]).toHaveProperty('description')
  })

  it('种子 id 必须能在 unifiedSkillMock 解析出文件树（详情页 listSkillFiles 依赖）', async () => {
    const skillMock = await import('../unifiedSkillMock')
    const { list } = await listReviewApplications({})
    for (const r of list) {
      const tree = await skillMock.listSkillFiles(r.id)
      expect(Array.isArray(tree.files)).toBe(true)
    }
  })

  it('审核：PENDING 可通过/拒绝并落审核意见；重复审核被拒', async () => {
    const d = await reviewApplication('sk_308', { approved: false, comment: '请补充确认环节' })
    expect(d.reviewStatus).toBe('REJECTED')
    expect(d.reviewComment).toBe('请补充确认环节')
    expect(d.reviewedAt).toMatch(/\+08:00$/)
    await expect(reviewApplication('sk_308', { approved: true })).rejects.toMatchObject({
      message: '该申请已审核，不能重复操作'
    })
  })

  it('不存在的申请：详情与审核均报 40400', async () => {
    await expect(getReviewApplication('sk_999')).rejects.toMatchObject({ code: 40400 })
    await expect(reviewApplication('sk_999', { approved: true })).rejects.toMatchObject({ code: 40400 })
  })
})
