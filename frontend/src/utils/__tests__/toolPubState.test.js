import { describe, it, expect } from 'vitest'
import { TOOL_PUB_STATE, toolPubTag, unpublishedToolsMessage } from '@/utils/toolPubState'

/**
 * 技能引用工具的连接器发布态口径（产品优化需求-202611 修改点 13（R4））：
 * 工具卡 / 「本技能已引用」标签 + 技能提交发布的阻断提示，mock 与页面共用这一份。
 */
describe('toolPubTag：工具卡名称旁的发布态标签', () => {
  it('未发布标「未发布」、审核中标「审核中」，配色与连接器列表三态一致', () => {
    expect(toolPubTag(TOOL_PUB_STATE.UNPUBLISHED)).toMatchObject({ label: '未发布', type: 'info' })
    expect(toolPubTag(TOOL_PUB_STATE.REVIEWING)).toMatchObject({ label: '审核中', type: 'warning' })
  })

  it('已发布不标；已停用 / 已回收 / 已删除（pubState 为 null）也不标', () => {
    expect(toolPubTag(TOOL_PUB_STATE.PUBLISHED)).toBeNull()
    expect(toolPubTag(null)).toBeNull()
    expect(toolPubTag(undefined)).toBeNull()
  })
})

describe('unpublishedToolsMessage：技能提交发布的阻断提示', () => {
  it('引用了一个未发布的连接器 → 草案原句「引用的「名称」尚未发布，请先发布该连接器或移除引用」', () => {
    expect(unpublishedToolsMessage([{ code: 'mcp__mail_center', bizName: '邮件中心 MCP', pubState: 'UNPUBLISHED' }])).toBe(
      '引用的「邮件中心 MCP」尚未发布，请先发布该连接器或移除引用'
    )
  })

  it('审核中的同样拦；只拦未发布 / 审核中，已发布与已停用（null）不进提示', () => {
    const msg = unpublishedToolsMessage([
      { code: 'mcp__knowledge_hub', bizName: '企业知识库 MCP', pubState: 'PUBLISHED' },
      { code: 'biz__biz_2102', bizName: '人力资源系统', pubState: 'REVIEWING' },
      { code: 'mcp__stopped', bizName: '已停用 MCP', pubState: null }
    ])
    expect(msg).toBe('引用的「人力资源系统」尚未发布，请先发布该连接器或移除引用')
  })

  it('同时有多个 → 名称用顿号并列在同一句里，按引用顺序', () => {
    expect(
      unpublishedToolsMessage([
        { code: 'mcp__a', bizName: '甲 MCP', pubState: 'UNPUBLISHED' },
        { code: 'api__b', bizName: '乙接口', pubState: 'REVIEWING' }
      ])
    ).toBe('引用的「甲 MCP」、「乙接口」尚未发布，请先发布该连接器或移除引用')
  })

  it('没有未发布 / 审核中的引用 → 空串（放行）', () => {
    expect(unpublishedToolsMessage([{ code: 'mcp__x', bizName: 'X', pubState: 'PUBLISHED' }])).toBe('')
    expect(unpublishedToolsMessage([])).toBe('')
    expect(unpublishedToolsMessage(undefined)).toBe('')
  })

  it('连接器名称缺失（如已被删除）时提示里回落工具 code', () => {
    expect(unpublishedToolsMessage([{ code: 'mcp__nameless', pubState: 'UNPUBLISHED' }])).toBe(
      '引用的「mcp__nameless」尚未发布，请先发布该连接器或移除引用'
    )
  })
})
