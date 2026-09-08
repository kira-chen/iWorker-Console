import { describe, it, expect } from 'vitest'
import {
  REVIEW_BIZ_TYPE_OPTIONS,
  REQUEST_ACTION_OPTIONS,
  MYAPP_BIZ_TYPE_OPTIONS,
  MYAPP_RESULT_OPTIONS,
  reviewTypeMatch,
  reviewBizTypeLabel,
  reviewBizTypeTagType,
  requestActionLabel,
  requestActionTagType,
  myAppBizTypeLabel,
  myAppBizTypeTagType,
  myAppResultMeta
} from '../reviewMeta'

/**
 * 治理两页展示词表（2026-09-01 PRD 对齐改造）回归保护：
 * 文案逐字对齐交互原型 v2（typeLabel/typeKind/reviewActionLabel/myBusinessLabel/
 * myBusinessKind/myResultMeta），色系映射按报告口径（蓝→accent / 紫→purple 新变体）。
 */
describe('reviewMeta · 审核中心新口径', () => {
  // 2026-09-09 PRD 复核·G3G6 · A6：md `prd.审核中心.md` §二.2 / §3.1 业务类型八项，含「知识库」
  it('业务类型筛选八项词表（md §二.2 顺序与文案，含知识库）', () => {
    expect(REVIEW_BIZ_TYPE_OPTIONS.map((o) => o.label)).toEqual([
      '岗位', '专家', '技能', '知识库', 'MCP', 'API', '业务系统', '模型'
    ])
    expect(reviewTypeMatch({ type: 'KNOWLEDGE_BASE' }, 'KNOWLEDGE_BASE')).toBe(true)
    expect(reviewTypeMatch({ type: 'SKILL' }, 'KNOWLEDGE_BASE')).toBe(false)
    expect(reviewBizTypeLabel({ type: 'KNOWLEDGE_BASE' })).toBe('知识库')
  })

  it('reviewTypeMatch：MCP/API 由 TOOL+subType 拆分，CONNECTOR_BIZ=BIZ_SYSTEM', () => {
    expect(reviewTypeMatch({ type: 'TOOL', subType: 'MCP' }, 'CONNECTOR_MCP')).toBe(true)
    expect(reviewTypeMatch({ type: 'TOOL', subType: 'API' }, 'CONNECTOR_MCP')).toBe(false)
    expect(reviewTypeMatch({ type: 'TOOL', subType: 'API' }, 'CONNECTOR_API')).toBe(true)
    expect(reviewTypeMatch({ type: 'BIZ_SYSTEM' }, 'CONNECTOR_BIZ')).toBe(true)
    expect(reviewTypeMatch({ type: 'SKILL' }, '')).toBe(true)
  })

  // 2026-09-09 PRD 复核·G3G6 · A7（Q262「不加，当前没有这个业务逻辑」）：技能不再细分来源
  it('业务类型标签：技能统一「技能」不带来源后缀（A7）；TOOL 直显 MCP/API（不带「连接器·」前缀）', () => {
    expect(reviewBizTypeLabel({ type: 'SKILL', platformSource: 'USER_UPLOADED' })).toBe('技能')
    expect(reviewBizTypeLabel({ type: 'SKILL', platformSource: 'PLATFORM_CREATED' })).toBe('技能')
    expect(reviewBizTypeLabel({ type: 'SKILL' })).toBe('技能')
    expect(reviewBizTypeLabel({ type: 'TOOL', subType: 'MCP' })).toBe('MCP')
    expect(reviewBizTypeLabel({ type: 'TOOL', subType: 'API' })).toBe('API')
    expect(reviewBizTypeLabel({ type: 'POSITION' })).toBe('岗位')
  })

  it('色系：TOOL/BIZ_SYSTEM 蓝(accent)、SKILL/知识库 绿、MODEL 橙、POSITION 紫、EXPERT 灰', () => {
    expect(reviewBizTypeTagType('TOOL')).toBe('accent')
    expect(reviewBizTypeTagType('BIZ_SYSTEM')).toBe('accent')
    expect(reviewBizTypeTagType('SKILL')).toBe('success')
    expect(reviewBizTypeTagType('KNOWLEDGE_BASE')).toBe('success')
    expect(reviewBizTypeTagType('MODEL')).toBe('warning')
    expect(reviewBizTypeTagType('POSITION')).toBe('purple')
    expect(reviewBizTypeTagType('EXPERT')).toBe('info')
  })

  it('申请类型：三项词表；停用橙、发布绿', () => {
    expect(REQUEST_ACTION_OPTIONS.map((o) => o.label)).toEqual(['首次发布', '新版本发布', '停用'])
    expect(requestActionLabel('VERSION_PUBLISH')).toBe('新版本发布')
    expect(requestActionTagType('DELIST')).toBe('warning')
    expect(requestActionTagType('FIRST_PUBLISH')).toBe('success')
  })
})

describe('reviewMeta · 我的申请口径', () => {
  // 2026-09-09 PRD 复核·G3G6 · A6：md `prd.我的申请.md` §二.2 / §3.1 业务类型八项，含「知识库」
  it('业务类型下拉八项（md §二.2 顺序，含知识库）；不含「其他」（2026-09-08 决议第 8 项）', () => {
    expect(MYAPP_BIZ_TYPE_OPTIONS.map((o) => o.label)).toEqual([
      '专家', '岗位', '技能', '知识库', 'MCP', 'API', '业务系统', '模型'
    ])
    expect(MYAPP_BIZ_TYPE_OPTIONS.map((o) => o.value)).not.toContain('OTHER')
    expect(myAppBizTypeLabel('OTHER')).toBe('OTHER')
    expect(myAppBizTypeLabel('KNOWLEDGE_BASE')).toBe('知识库')
    expect(myAppBizTypeTagType('POSITION')).toBe('purple')
    expect(myAppBizTypeTagType('MCP')).toBe('accent')
    expect(myAppBizTypeTagType('KNOWLEDGE_BASE')).toBe('success')
  })

  it('审核结果四态：待审核橙/已通过绿/已驳回红/已撤回灰', () => {
    expect(MYAPP_RESULT_OPTIONS.map((o) => o.label)).toEqual(['待审核', '已通过', '已驳回', '已撤回'])
    expect(myAppResultMeta('PENDING')).toEqual({ label: '待审核', type: 'warning' })
    expect(myAppResultMeta('APPROVED')).toEqual({ label: '已通过', type: 'success' })
    expect(myAppResultMeta('REJECTED')).toEqual({ label: '已驳回', type: 'danger' })
    expect(myAppResultMeta('WITHDRAWN')).toEqual({ label: '已撤回', type: 'info' })
  })
})
