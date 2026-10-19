import { describe, it, expect, beforeEach } from 'vitest'
import { nextSnapshotKey, archiveSnapshot, findSnapshot } from '../reviewSnapshotArchive'
import {
  publishPosition,
  withdrawPosition,
  updatePosition,
  getPositionReviewSnapshot,
  __resetPositionMock
} from '../positionMock'
import { publishExpert, withdrawExpert, updateExpert, getExpertReviewSnapshot } from '../domainExpertMock'
import { publishSkill, withdrawPublish, getSkillReviewSnapshot } from '../unifiedSkillMock'
import { listReviews, rejectReview, approveReview } from '../reviewsMock'
import { listMyApplications } from '../myApplicationsMock'

/**
 * 审核快照历史归档（2026-10-19 yuepu#76，J28 随之）。
 * md `prd.我的申请.md` §详情：岗位 / 专家 / 专家团 / 技能的申请详情读取「提交时的版本快照」。
 * 原实现对象单槽位、出结论 / 撤回即删，之后回看读到的是对象当前配置；现改为在审快照移入归档，按 snapshotKey 取回。
 */
describe('reviewSnapshotArchive · 纯函数', () => {
  it('nextSnapshotKey：对象id#序号，序号随归档与在审快照累加，只增不减', () => {
    expect(nextSnapshotKey({}, {}, 7)).toBe('7#1')
    expect(nextSnapshotKey({ 7: { key: '7#1' } }, {}, 7)).toBe('7#2')
    expect(nextSnapshotKey({}, { 7: [{ key: '7#1' }, { key: '7#2' }] }, 7)).toBe('7#3')
  })

  it('archiveSnapshot：在审快照移入归档，在审位清空；没有在审快照时什么都不做', () => {
    const live = { 7: { key: '7#1' } }
    const archive = {}
    archiveSnapshot(live, archive, 7)
    expect(live[7]).toBeUndefined()
    expect(archive[7]).toEqual([{ key: '7#1' }])
    archiveSnapshot(live, archive, 7)
    expect(archive[7]).toHaveLength(1)
  })

  it('findSnapshot：不传 key 只看在审快照；传 key 在审 + 归档里精确匹配，找不到返回 null；返回深拷贝', () => {
    const live = { 7: { key: '7#2', detail: { n: 2 } } }
    const archive = { 7: [{ key: '7#1', detail: { n: 1 } }] }
    expect(findSnapshot(live, archive, 7).key).toBe('7#2')
    expect(findSnapshot({}, archive, 7)).toBeNull()
    expect(findSnapshot(live, archive, 7, '7#1').detail.n).toBe(1)
    expect(findSnapshot(live, archive, 7, '7#2').detail.n).toBe(2)
    expect(findSnapshot(live, archive, 7, '7#9')).toBeNull()
    const copy = findSnapshot(live, archive, 7, '7#1')
    copy.detail.n = 99
    expect(archive[7][0].detail.n).toBe(1)
  })
})

describe('岗位 · 撤回 / 驳回后「我的申请」仍能按 key 回看提交时的配置', () => {
  beforeEach(() => __resetPositionMock())

  it('撤回：在审快照没了（审核中心据此判缺失不再相关），但按 key 取得回提交时的配置，岗位后续改动不影响', async () => {
    await publishPosition(404, { releaseNotes: '首个版本' })
    const snap = getPositionReviewSnapshot(404)
    const submittedDesc = snap.detail.description
    await withdrawPosition(404)
    expect(getPositionReviewSnapshot(404)).toBeNull()

    await updatePosition(404, { description: '撤回之后才改的描述' })
    const back = getPositionReviewSnapshot(404, snap.key)
    expect(back.detail.description).toBe(submittedDesc)
    expect(back.detail.description).not.toBe('撤回之后才改的描述')
  })

  it('申请行带 snapshotKey（审核中心行与我的申请行同一个 key）', async () => {
    await publishPosition(404, { releaseNotes: '首个版本' })
    const snap = getPositionReviewSnapshot(404)
    const app = (await listMyApplications({ businessType: 'POSITION', result: 'PENDING' })).list.find((r) => String(r.refId) === '404')
    expect(app.snapshotKey).toBe(snap.key)
    const review = (await listReviews({ type: 'POSITION' })).list.find((r) => String(r.refId) === '404')
    expect(review.snapshotKey).toBe(snap.key)
  })

  it('驳回：审核有结论后在审快照没了，按 key 仍取得回提交时的配置；再次提交得到新 key，两次申请各读各的', async () => {
    await publishPosition(404, { releaseNotes: '第一次提交' })
    const first = getPositionReviewSnapshot(404)
    const row = (await listReviews({ type: 'POSITION' })).list.find((r) => String(r.refId) === '404')
    await rejectReview(row.id, '先补充资料')
    expect(getPositionReviewSnapshot(404)).toBeNull()

    await updatePosition(404, { description: '驳回后改了描述再提交' })
    await publishPosition(404, { releaseNotes: '第二次提交' })
    const second = getPositionReviewSnapshot(404)
    expect(second.key).not.toBe(first.key)
    expect(second.detail.description).toBe('驳回后改了描述再提交')
    // 第一次申请回看的仍是它提交时的描述，不是第二次的
    expect(getPositionReviewSnapshot(404, first.key).detail.description).toBe(first.detail.description)
    expect(getPositionReviewSnapshot(404, first.key).detail.description).not.toBe('驳回后改了描述再提交')
  })

  it('通过：审核有结论后同样入归档，按 key 可取', async () => {
    await publishPosition(404, { releaseNotes: '首个版本' })
    const snap = getPositionReviewSnapshot(404)
    const row = (await listReviews({ type: 'POSITION' })).list.find((r) => String(r.refId) === '404')
    await approveReview(row.id)
    expect(getPositionReviewSnapshot(404)).toBeNull()
    expect(getPositionReviewSnapshot(404, snap.key).detail.name).toBe('市场研究岗')
  })
})

describe('专家 / 技能 · 撤回后按 key 回看提交时的配置', () => {
  it('专家：撤回后按 key 仍取得回提交时的简介，之后改简介不影响', async () => {
    const id = 202
    await publishExpert(id, { releaseNotes: '测试提交' })
    const snap = getExpertReviewSnapshot(id)
    await withdrawExpert(id)
    expect(getExpertReviewSnapshot(id)).toBeNull()
    await updateExpert(id, { intro: '撤回之后才改的简介' })
    const back = getExpertReviewSnapshot(id, snap.key)
    expect(back.detail.name).toBe('企业知识助手')
    expect(JSON.stringify(back.detail)).not.toContain('撤回之后才改的简介')
  })

  it('技能：撤回后按 key 仍取得回提交时的快照', async () => {
    const id = 'sk_307'
    if (getSkillReviewSnapshot(id)) await withdrawPublish(id)
    await publishSkill(id, { releaseNotes: '首次发布' })
    const snap = getSkillReviewSnapshot(id)
    await withdrawPublish(id)
    expect(getSkillReviewSnapshot(id)).toBeNull()
    expect(getSkillReviewSnapshot(id, snap.key).detail.name).toBe(snap.detail.name)
  })
})
