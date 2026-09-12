import { describe, it, expect } from 'vitest'
import {
  derivePlatformState,
  stateLabel,
  stateTagType,
  stateActions,
  skillOnlineState,
  isLocked,
  userEndPublication
} from '@/utils/skillPublication'

/**
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §二.3.3-3.5 / §二.5 / §三.1：
 * 平台技能发布态口径（去分端·单轨）单一真相直接单测：
 * 守护展示态派生、文案、StatusTag 颜色、动作矩阵、锁定谓词不被静默改坏。
 * 列表版本号 tag / 发布对话框 / 编辑器锁定 均依赖本模块，故口径偏移会同时打穿多处。
 * 第 8 态 PUBLISHED_DELISTING（已发布 + pendingAction:'DELIST'）= md L96「确认后提交停用审核，状态变为审核中」、
 * L120「存在审核中操作时编辑页锁定，仅允许查看和撤回」、L131「审核中重复提交：版本发布弹窗仅提供【撤回提交】」。
 */

const u = (status, extra = {}) => [{ target: 'USER_END', status, ...extra }]

describe('skillPublication 单轨展示态', () => {
  it('userEndPublication：取 USER_END 行，无则 null', () => {
    expect(userEndPublication(u('PUBLISHED')).status).toBe('PUBLISHED')
    expect(userEndPublication([])).toBe(null)
    expect(userEndPublication()).toBe(null)
    // 混入 FDE_WORKBENCH 行也只取 USER_END
    const mixed = [
      { target: 'FDE_WORKBENCH', status: 'PUBLISHED' },
      { target: 'USER_END', status: 'REJECTED' }
    ]
    expect(userEndPublication(mixed).status).toBe('REJECTED')
  })

  it('derivePlatformState：八态派生（含 reviewPending 分流 + 停用审核中）', () => {
    expect(derivePlatformState([])).toBe('INITIAL')
    expect(derivePlatformState(null)).toBe('INITIAL')
    expect(derivePlatformState(u('PENDING_REVIEW'))).toBe('REVIEWING')
    expect(derivePlatformState(u('PUBLISHED'))).toBe('PUBLISHED')
    expect(derivePlatformState(u('PUBLISHED', { reviewPending: true }))).toBe('PUBLISHED_REVIEWING')
    expect(derivePlatformState(u('REJECTED'))).toBe('REJECTED')
    expect(derivePlatformState(u('DELISTED'))).toBe('DELISTED')
    expect(derivePlatformState(u('DELISTED', { reviewPending: true }))).toBe('DELISTED_REVIEWING')
  })

  it('已发布 + pendingAction=DELIST → 第 8 态 PUBLISHED_DELISTING，文案「已发布 · 停用审核中」、色 warning（md L96）', () => {
    // 提交停用审核后 status 仍 PUBLISHED（线上继续可用），靠 pendingAction 区分
    expect(derivePlatformState(u('PUBLISHED', { pendingAction: 'DELIST' }))).toBe('PUBLISHED_DELISTING')
    // 只有 PUBLISHED 行才认 DELIST 挂起；其它 status 不受 pendingAction 影响
    expect(derivePlatformState(u('DELISTED', { pendingAction: 'DELIST' }))).toBe('DELISTED')
    expect(derivePlatformState(u('PENDING_REVIEW', { pendingAction: 'DELIST' }))).toBe('REVIEWING')
    expect(stateLabel('PUBLISHED_DELISTING')).toBe('已发布 · 停用审核中')
    expect(stateTagType('PUBLISHED_DELISTING')).toBe('warning')
  })

  it('stateLabel：八态→中文，未知/空兜底', () => {
    expect(stateLabel('INITIAL')).toBe('初始创建')
    expect(stateLabel('REVIEWING')).toBe('审核中')
    expect(stateLabel('PUBLISHED')).toBe('已发布')
    expect(stateLabel('PUBLISHED_REVIEWING')).toBe('已发布 · 新版审核中')
    expect(stateLabel('PUBLISHED_DELISTING')).toBe('已发布 · 停用审核中')
    expect(stateLabel('REJECTED')).toBe('已驳回')
    expect(stateLabel('DELISTED')).toBe('已下架')
    expect(stateLabel('DELISTED_REVIEWING')).toBe('已下架 · 新版审核中')
    expect(stateLabel('WEIRD')).toBe('WEIRD')
    expect(stateLabel()).toBe('—')
  })

  it('stateTagType：八态→StatusTag 语义色，未知回落 info', () => {
    expect(stateTagType('INITIAL')).toBe('info')
    expect(stateTagType('REVIEWING')).toBe('warning')
    expect(stateTagType('PUBLISHED')).toBe('success')
    expect(stateTagType('PUBLISHED_REVIEWING')).toBe('warning')
    expect(stateTagType('PUBLISHED_DELISTING')).toBe('warning')
    expect(stateTagType('REJECTED')).toBe('danger')
    expect(stateTagType('DELISTED')).toBe('info')
    expect(stateTagType('DELISTED_REVIEWING')).toBe('warning')
    expect(stateTagType('WEIRD')).toBe('info')
  })

  it('stateActions：发布弹窗内动作矩阵（技能级上下线不在弹窗）', () => {
    // 提交态：可提交（新版）发布
    expect(stateActions('INITIAL')).toEqual(['submit'])
    expect(stateActions('REJECTED')).toEqual(['submit'])
    expect(stateActions('PUBLISHED')).toEqual(['submit'])
    expect(stateActions('DELISTED')).toEqual(['submit'])
    // 在审态：仅撤回
    expect(stateActions('REVIEWING')).toEqual(['withdraw'])
    expect(stateActions('PUBLISHED_REVIEWING')).toEqual(['withdraw'])
    expect(stateActions('DELISTED_REVIEWING')).toEqual(['withdraw'])
    // 未知态回落 submit（不死锁）
    expect(stateActions('WEIRD')).toEqual(['submit'])
  })

  it('停用审核中 → 弹窗仅【撤回提交】、编辑锁定、操作列不再给「停用」（md L98/L120/L131）', () => {
    const pubs = u('PUBLISHED', { pendingAction: 'DELIST' })
    expect(stateActions('PUBLISHED_DELISTING')).toEqual(['withdraw'])
    expect(isLocked(pubs)).toBe(true)
    // 已提交停用审核 → 归 NONE，操作列不显「停用」（避免重复提交）
    expect(skillOnlineState(pubs)).toBe('NONE')
  })

  it('skillOnlineState：技能级上下架态（供操作列「下架/上架」）', () => {
    expect(skillOnlineState([])).toBe('NONE') // 无发布行
    expect(skillOnlineState(u('PENDING_REVIEW'))).toBe('NONE') // 首发在审，从未上线
    expect(skillOnlineState(u('REJECTED'))).toBe('NONE')
    expect(skillOnlineState(u('PUBLISHED'))).toBe('ONLINE')
    expect(skillOnlineState(u('PUBLISHED', { reviewPending: true }))).toBe('ONLINE') // 新版在审，线上仍在
    expect(skillOnlineState(u('DELISTED'))).toBe('OFFLINE')
    expect(skillOnlineState(u('DELISTED', { reviewPending: true }))).toBe('OFFLINE')
  })

  it('isLocked：在审提交态锁定编辑，其余不锁', () => {
    expect(isLocked(u('PENDING_REVIEW'))).toBe(true) // REVIEWING
    expect(isLocked(u('PUBLISHED', { reviewPending: true }))).toBe(true) // PUBLISHED_REVIEWING
    expect(isLocked(u('DELISTED', { reviewPending: true }))).toBe(true) // DELISTED_REVIEWING
    expect(isLocked([])).toBe(false) // INITIAL
    expect(isLocked(u('PUBLISHED'))).toBe(false)
    expect(isLocked(u('REJECTED'))).toBe(false)
    expect(isLocked(u('DELISTED'))).toBe(false)
  })
})
