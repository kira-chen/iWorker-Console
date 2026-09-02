import { describe, it, expect } from 'vitest'
import {
  derivePlatformState,
  stateLabel,
  stateTagType,
  stateActions,
  skillOnlineState,
  isLocked,
  userEndPublication,
  targetActions,
  TARGETS,
  targetLabel
} from '@/utils/skillPublication'

/**
 * 平台技能发布态口径（去分端·单轨）单一真相直接单测：
 * 守护展示态派生、文案、StatusTag 颜色、动作矩阵、锁定谓词不被静默改坏。
 * 列表版本号 tag / 发布对话框 / 编辑器锁定 均依赖本模块，故口径偏移会同时打穿多处。
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

  it('derivePlatformState：七态派生（含 reviewPending 分流）', () => {
    expect(derivePlatformState([])).toBe('INITIAL')
    expect(derivePlatformState(null)).toBe('INITIAL')
    expect(derivePlatformState(u('PENDING_REVIEW'))).toBe('REVIEWING')
    expect(derivePlatformState(u('PUBLISHED'))).toBe('PUBLISHED')
    expect(derivePlatformState(u('PUBLISHED', { reviewPending: true }))).toBe('PUBLISHED_REVIEWING')
    expect(derivePlatformState(u('REJECTED'))).toBe('REJECTED')
    expect(derivePlatformState(u('DELISTED'))).toBe('DELISTED')
    expect(derivePlatformState(u('DELISTED', { reviewPending: true }))).toBe('DELISTED_REVIEWING')
  })

  it('stateLabel：七态→中文，未知/空兜底', () => {
    expect(stateLabel('INITIAL')).toBe('初始创建')
    expect(stateLabel('REVIEWING')).toBe('审核中')
    expect(stateLabel('PUBLISHED')).toBe('已发布')
    expect(stateLabel('PUBLISHED_REVIEWING')).toBe('已发布 · 新版审核中')
    expect(stateLabel('REJECTED')).toBe('已驳回')
    expect(stateLabel('DELISTED')).toBe('已下架')
    expect(stateLabel('DELISTED_REVIEWING')).toBe('已下架 · 新版审核中')
    expect(stateLabel('WEIRD')).toBe('WEIRD')
    expect(stateLabel()).toBe('—')
  })

  it('stateTagType：七态→StatusTag 语义色，未知回落 info', () => {
    expect(stateTagType('INITIAL')).toBe('info')
    expect(stateTagType('REVIEWING')).toBe('warning')
    expect(stateTagType('PUBLISHED')).toBe('success')
    expect(stateTagType('PUBLISHED_REVIEWING')).toBe('warning')
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

describe('skillPublication 连接器旧口径（沿用不动）', () => {
  it('TARGETS / targetLabel：连接器与版本历史仍分端', () => {
    expect(TARGETS).toEqual(['FDE_WORKBENCH', 'USER_END'])
    expect(targetLabel('FDE_WORKBENCH')).toBe('FDE 工作台')
    expect(targetLabel('USER_END')).toBe('用户端')
    expect(targetLabel()).toBe('—')
  })

  it('targetActions：连接器 status→动作矩阵', () => {
    expect(targetActions('NONE')).toEqual(['publish'])
    expect(targetActions('REJECTED')).toEqual(['publish'])
    expect(targetActions('PENDING_REVIEW')).toEqual(['withdraw'])
    expect(targetActions('PUBLISHED')).toEqual(['delist'])
    expect(targetActions('DELISTED')).toEqual(['relist'])
    expect(targetActions('WEIRD')).toEqual(['publish'])
  })
})
