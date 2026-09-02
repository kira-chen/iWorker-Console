import { describe, it, expect } from 'vitest'
import {
  KIND,
  isReviewRequired,
  deriveBodyState,
  derivePublishView,
  isVisibleDownstream,
  isLocked,
  canDelete
} from '@/utils/publishState'

/**
 * 发布态统一前端层（发布统一方案 B3）单测。
 * 守护：可配置审核分流（技能走 7 态审核流、岗位/专家走免审二态子集）、展示视图口径、可见性/锁定谓词。
 */
describe('publishState 统一层', () => {
  it('reviewRequired：三类均需审核（V103/V104 岗位/专家纳入审核）', () => {
    expect(isReviewRequired(KIND.SKILL)).toBe(true)
    expect(isReviewRequired(KIND.POSITION)).toBe(true)
    expect(isReviewRequired(KIND.DOMAIN_EXPERT)).toBe(true)
  })

  it('本体态派生：pending_action 叠加审核态', () => {
    expect(deriveBodyState('published')).toBe('PUBLISHED')
    expect(deriveBodyState('draft')).toBe('INITIAL')
    expect(deriveBodyState(undefined)).toBe('INITIAL')
    // V103/V104 审核态：
    expect(deriveBodyState('draft', 'PUBLISH')).toBe('REVIEWING')
    expect(deriveBodyState('published', 'DELIST')).toBe('PUBLISHED_DELISTING')
  })

  it('岗位/专家展示视图：草稿态（可提交发布）', () => {
    const v = derivePublishView(KIND.POSITION, { status: 'draft' })
    expect(v.state).toBe('INITIAL')
    expect(v.label).toBe('草稿')
    expect(v.actions).toEqual(['submit'])
    expect(v.reviewRequired).toBe(true)
  })

  it('岗位/专家展示视图：发布审核中（可撤回）', () => {
    const v = derivePublishView(KIND.POSITION, { status: 'draft', pendingAction: 'PUBLISH' })
    expect(v.state).toBe('REVIEWING')
    expect(v.label).toBe('发布审核中')
    expect(v.tagType).toBe('warning')
    expect(v.actions).toEqual(['withdraw'])
  })

  it('岗位/专家展示视图：已发布可提新版（迭代能力）；停用审核中可撤回', () => {
    // 2026-08-22「已发布迭代新版」：PUBLISHED 态动作由 delist 改为 submit（可提新版，与技能一致）。
    // 整体停用不再走弹窗，挪到列表操作列（stopPosition/stopExpert）。
    const pub = derivePublishView(KIND.DOMAIN_EXPERT, { status: 'published' })
    expect(pub.state).toBe('PUBLISHED')
    expect(pub.actions).toEqual(['submit'])
    const delisting = derivePublishView(KIND.DOMAIN_EXPERT, { status: 'published', pendingAction: 'DELIST' })
    expect(delisting.state).toBe('PUBLISHED_DELISTING')
    expect(delisting.label).toBe('已发布 · 停用审核中')
    expect(delisting.actions).toEqual(['withdraw'])
  })

  it('岗位/专家展示视图：已发布 + pending=PUBLISH → 迭代新版审核中（线上供旧版，可撤回）', () => {
    // 首发在审(draft+PUBLISH)=REVIEWING；迭代在审(published+PUBLISH)=PUBLISHED_REVIEWING，二者按本体 status 分流。
    const v = derivePublishView(KIND.POSITION, { status: 'published', pendingAction: 'PUBLISH' })
    expect(v.state).toBe('PUBLISHED_REVIEWING')
    expect(v.label).toBe('已发布 · 新版审核中')
    expect(v.tagType).toBe('warning')
    expect(v.actions).toEqual(['withdraw'])
    // 迭代在审期间：线上旧版仍可见、编辑锁定、不可删。
    expect(isVisibleDownstream(KIND.POSITION, { status: 'published', pendingAction: 'PUBLISH' })).toBe(true)
    expect(isLocked(KIND.POSITION, { status: 'published', pendingAction: 'PUBLISH' })).toBe(true)
    expect(canDelete(KIND.POSITION, { status: 'published', pendingAction: 'PUBLISH' })).toBe(false)
  })

  it('技能展示视图：委托 skillPublication 的 7 态（审核中）', () => {
    const v = derivePublishView(KIND.SKILL, {
      publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }]
    })
    expect(v.state).toBe('REVIEWING')
    expect(v.reviewRequired).toBe(true)
    expect(v.actions).toEqual(['withdraw'])
  })

  it('技能展示视图：无发布行=INITIAL 可提交', () => {
    const v = derivePublishView(KIND.SKILL, { publications: [] })
    expect(v.state).toBe('INITIAL')
    expect(v.actions).toEqual(['submit'])
  })

  it('可见性谓词：岗位/专家 published 可见（待审停用期仍可见）', () => {
    expect(isVisibleDownstream(KIND.POSITION, { status: 'published' })).toBe(true)
    expect(isVisibleDownstream(KIND.POSITION, { status: 'draft' })).toBe(false)
    expect(isVisibleDownstream(KIND.POSITION, { status: 'published', pendingAction: 'DELIST' })).toBe(true)
  })

  it('可见性谓词：技能 PUBLISHED 在线', () => {
    expect(
      isVisibleDownstream(KIND.SKILL, { publications: [{ target: 'USER_END', status: 'PUBLISHED' }] })
    ).toBe(true)
    expect(
      isVisibleDownstream(KIND.SKILL, { publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] })
    ).toBe(false)
  })

  it('锁定谓词：技能审核中锁定；岗位/专家有待审动作时锁定', () => {
    expect(
      isLocked(KIND.SKILL, { publications: [{ target: 'USER_END', status: 'PENDING_REVIEW' }] })
    ).toBe(true)
    expect(isLocked(KIND.POSITION, { status: 'published' })).toBe(false)
    expect(isLocked(KIND.POSITION, { status: 'published', pendingAction: 'DELIST' })).toBe(true)
  })
})
