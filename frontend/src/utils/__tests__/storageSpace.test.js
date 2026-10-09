import { describe, it, expect } from 'vitest'
import {
  quotaInputError, fmtGb, STORAGE_STATE, REQUEST_STATE, QUOTA_MIN_GB, DEFAULT_QUOTA_GB, REJECT_REASON_MAX
} from '../storageSpace'

/**
 * utils/storageSpace.js（04运行 › 存储空间的展示常量与校验）。
 * 2026-10-09 对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md（§一·4 状态 / §三·4 输入校验 / §四·4 拒绝原因）与一览表「十六、存储空间」。
 * quotaInputError 是页面输入弹窗与 storageSpaceMock 共用的校验文案单一来源，文案变了两边一起变，所以在这里钉一份。
 */

describe('quotaInputError —— 容量输入校验文案', () => {
  it('空值 / 非数字提示「请输入正整数」', () => {
    expect(quotaInputError(null)).toBe('请输入正整数')
    expect(quotaInputError(undefined)).toBe('请输入正整数')
    expect(quotaInputError('')).toBe('请输入正整数')
    expect(quotaInputError('abc')).toBe('请输入正整数')
    expect(quotaInputError(NaN)).toBe('请输入正整数')
  })

  it('小数提示「容量只能填整数」（输入框不取整，由这里提示）', () => {
    expect(quotaInputError(2.5)).toBe('容量只能填整数')
    expect(quotaInputError('8.5')).toBe('容量只能填整数')
  })

  it('小于下限提示「容量不能小于 N GB」，默认下限 1 GB', () => {
    expect(quotaInputError(0)).toBe('容量不能小于 1 GB')
    expect(quotaInputError(-3)).toBe('容量不能小于 1 GB')
    expect(quotaInputError(3, 5)).toBe('容量不能小于 5 GB')
  })

  it('合法返回空串；不设上限；数字字符串也认', () => {
    expect(quotaInputError(1)).toBe('')
    expect(quotaInputError('8')).toBe('')
    expect(quotaInputError(100000)).toBe('')
  })
})

describe('fmtGb —— 容量数值展示', () => {
  it('整数不带小数点，其余保留 1 位，空值显示「—」', () => {
    expect(fmtGb(5)).toBe('5 GB')
    expect(fmtGb(2.7)).toBe('2.7 GB')
    expect(fmtGb(0)).toBe('0 GB')
    expect(fmtGb(null)).toBe('—')
    expect(fmtGb(undefined)).toBe('—')
  })
})

describe('状态文案与常量', () => {
  it('容量状态：正常 / 预警 / 已满 / 未统计，对应 StatusTag 类型', () => {
    expect(Object.fromEntries(Object.entries(STORAGE_STATE).map(([k, v]) => [k, v.label]))).toEqual({
      NORMAL: '正常', WARN: '预警', FULL: '已满', UNKNOWN: '未统计'
    })
    expect(STORAGE_STATE.FULL.tag).toBe('danger')
    expect(STORAGE_STATE.WARN.tag).toBe('warning')
  })

  it('申请状态只有 待处理 / 已同意 / 已拒绝 三种（没有多余状态）', () => {
    expect(Object.fromEntries(Object.entries(REQUEST_STATE).map(([k, v]) => [k, v.label]))).toEqual({
      PENDING: '待处理', APPROVED: '已同意', REJECTED: '已拒绝'
    })
  })

  it('下限 1 GB、默认容量固定 5 GB、拒绝原因限长 500', () => {
    expect(QUOTA_MIN_GB).toBe(1)
    expect(DEFAULT_QUOTA_GB).toBe(5)
    expect(REJECT_REASON_MAX).toBe(500)
  })
})
