import { describe, it, expect } from 'vitest'
import {
  statusMeta,
  writeClassMeta,
  publishActions,
  TARGETS,
  targetLabel,
  targetTagType,
  publishOutcomeLabel,
  isPublishOutcomeOk
} from '@/utils/marketMeta'

describe('marketMeta · statusMeta / writeClassMeta', () => {
  it('四态状态映射到正确 StatusTag type', () => {
    expect(statusMeta('PENDING_REVIEW').type).toBe('warning')
    expect(statusMeta('PUBLISHED').type).toBe('success')
    expect(statusMeta('REJECTED').type).toBe('danger')
    expect(statusMeta('DELISTED').type).toBe('info')
  })
  it('未知状态回落 info', () => {
    expect(statusMeta('FOO').type).toBe('info')
  })
  it('writeClass 二态有标签，未知返回 null', () => {
    expect(writeClassMeta('READ').label).toBe('读')
    expect(writeClassMeta('WRITE').label).toBe('写')
    expect(writeClassMeta(null)).toBeNull()
  })
})

describe('marketMeta · publishActions（§5.4 状态→可见操作矩阵）', () => {
  it('PENDING_REVIEW → 仅 撤回 + 编辑（不放 下架/上架/重提）', () => {
    const a = publishActions('PENDING_REVIEW')
    expect(a).toEqual({ withdraw: true, edit: true })
  })
  it('PUBLISHED → 仅 下架 + 编辑（不放 重新上架，§3.5②非法）', () => {
    const a = publishActions('PUBLISHED')
    expect(a).toEqual({ delist: true, edit: true })
    expect(a.relist).toBeUndefined()
  })
  it('REJECTED → 仅 重提 + 编辑', () => {
    const a = publishActions('REJECTED')
    expect(a).toEqual({ resubmit: true, edit: true })
  })
  it('DELISTED → 仅 重新上架 + 编辑（不放 下架/撤回）', () => {
    const a = publishActions('DELISTED')
    expect(a).toEqual({ relist: true, edit: true })
  })
  it('未知状态 → 无任何操作', () => {
    expect(publishActions('FOO')).toEqual({})
  })
})

describe('marketMeta · 发布目标 target（V36）', () => {
  it('TARGETS = 两个发布目标枚举（与 skill_publication 同域）', () => {
    expect(TARGETS).toEqual(['FDE_WORKBENCH', 'USER_END'])
  })
  it('targetLabel：枚举→业务友好短名，未知/空兜底', () => {
    expect(targetLabel('FDE_WORKBENCH')).toBe('FDE 工作台')
    expect(targetLabel('USER_END')).toBe('用户端')
    expect(targetLabel('XXX')).toBe('XXX')
    expect(targetLabel()).toBe('—')
  })
  it('targetTagType：用户端=accent（强调），FDE 工作台=info（中性），未知回落 info', () => {
    expect(targetTagType('USER_END')).toBe('accent')
    expect(targetTagType('FDE_WORKBENCH')).toBe('info')
    expect(targetTagType('XXX')).toBe('info')
  })
})

describe('marketMeta · 逐 target 发布结果 outcome（§6.1）', () => {
  it('publishOutcomeLabel：三态文案，未知兜底原值', () => {
    expect(publishOutcomeLabel('CREATED')).toBe('已提交')
    expect(publishOutcomeLabel('RESUBMITTED')).toBe('已重新提交')
    expect(publishOutcomeLabel('CONFLICT')).toBe('已存在')
    expect(publishOutcomeLabel('WEIRD')).toBe('WEIRD')
  })
  it('isPublishOutcomeOk：CREATED/RESUBMITTED 成功，CONFLICT/未知 视为非成功（提示但不算失败）', () => {
    expect(isPublishOutcomeOk('CREATED')).toBe(true)
    expect(isPublishOutcomeOk('RESUBMITTED')).toBe(true)
    expect(isPublishOutcomeOk('CONFLICT')).toBe(false)
    expect(isPublishOutcomeOk('WEIRD')).toBe(false)
  })
})
