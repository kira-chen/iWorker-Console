/**
 * mcpMeta 纯函数守卫。
 *
 * 2026-09-12 头注更新（审计 D8）：原各 describe 引用的「契约 §1.3 / §4.1 / §5.1 / 展示规格 §3.1.1」
 * 均为已退役的前后端接口契约（发布单元 2026-09-01 一并退役）；现口径 = md
 * `docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md` §二.2 L57（连接状态三态
 * 「连接正常 / 连接异常 / 未探测」）+ mcpMeta.js 自身注释。四态 displayStatus（含 DISABLED）
 * 由 api/mcpConnectorMock 下发，MCP 列表侧把 DISABLED 折回 UNKNOWN（AdminMcp.mcpConnStatus）。
 *
 * isRedDot / countUnhealthy / fmtCount / fmtDuration / fmtPercent / hasUsage 六个零调用方导出
 * 已于 2026-09-12 随死码清理删除（审计 J13），对应 19 条用例一并删。
 * 原「McpEditor 失败回显不引用 form.endpoint」源码正则用例已迁至
 * components/admin/__tests__/mcpEditor.test.js（审计 D9 / T37）。
 */
import { describe, it, expect } from 'vitest'
import { connMeta, mergeFetchedTools, resolveDisplayStatus } from '@/utils/mcpMeta'

describe('connMeta — 三态连接标签（md MCP §二.2 L57 三态文案）', () => {
  it('ok → success/连接正常', () => {
    expect(connMeta('ok')).toEqual({ tag: 'success', label: '连接正常' })
  })
  it('failed → danger/连接异常', () => {
    expect(connMeta('failed')).toEqual({ tag: 'danger', label: '连接异常' })
  })
  it('unknown → info/未探测', () => {
    expect(connMeta('unknown')).toEqual({ tag: 'info', label: '未探测' })
  })
  it('缺省 / null / 未知值 → 回退 未探测', () => {
    expect(connMeta(null)).toEqual({ tag: 'info', label: '未探测' })
    expect(connMeta(undefined)).toEqual({ tag: 'info', label: '未探测' })
    expect(connMeta('weird')).toEqual({ tag: 'info', label: '未探测' })
  })
})

describe('resolveDisplayStatus — 检活四态归一（mock 下发 displayStatus 优先，缺省按 status/connStatus 派生）', () => {
  it('优先取后端 displayStatus 四态', () => {
    expect(resolveDisplayStatus({ displayStatus: 'HEALTHY' })).toBe('HEALTHY')
    expect(resolveDisplayStatus({ displayStatus: 'UNHEALTHY' })).toBe('UNHEALTHY')
    expect(resolveDisplayStatus({ displayStatus: 'UNKNOWN' })).toBe('UNKNOWN')
    expect(resolveDisplayStatus({ displayStatus: 'DISABLED' })).toBe('DISABLED')
  })
  it('兼容 checkStatus 字段（referencedTools 口径）', () => {
    expect(resolveDisplayStatus({ checkStatus: 'UNHEALTHY' })).toBe('UNHEALTHY')
  })
  it('后端无四态时由 status=disabled/inactive 派生 DISABLED（盖过检活态）', () => {
    expect(resolveDisplayStatus({ status: 'disabled', connStatus: 'ok' })).toBe('DISABLED')
    expect(resolveDisplayStatus({ status: 'inactive', connStatus: 'ok' })).toBe('DISABLED')
  })
  it('后端无四态时按旧 connStatus 三态映射兜底', () => {
    expect(resolveDisplayStatus({ status: 'active', connStatus: 'ok' })).toBe('HEALTHY')
    expect(resolveDisplayStatus({ status: 'active', connStatus: 'failed' })).toBe('UNHEALTHY')
    expect(resolveDisplayStatus({ status: 'active', connStatus: 'unknown' })).toBe('UNKNOWN')
  })
  it('全缺省 → UNKNOWN（优雅降级，不报错）', () => {
    expect(resolveDisplayStatus({})).toBe('UNKNOWN')
    expect(resolveDisplayStatus(null)).toBe('UNKNOWN')
    expect(resolveDisplayStatus(undefined)).toBe('UNKNOWN')
  })
})

describe('mergeFetchedTools — 拉取刷新（工具清单只读化：server 返回即权威全集）', () => {
  it('权威字段一律以服务端为准；writeClass 保留界面已有标注', () => {
    const current = [
      {
        name: 'search_customer',
        writeClass: 'WRITE' // FDE 界面上标注（含未保存改动）
      }
    ]
    const fetched = [
      {
        name: 'search_customer',
        description: 'server给的描述',
        inputSchema: { type: 'object', properties: { kw: { type: 'string' } } },
        writeClass: 'READ' // 后端合并结果，被界面标注覆盖
      }
    ]
    const [merged] = mergeFetchedTools(current, fetched)
    expect(merged.description).toBe('server给的描述') // 服务端权威
    expect(merged.inputSchema).toEqual(fetched[0].inputSchema)
    expect(merged.writeClass).toBe('WRITE') // 界面标注优先
  })

  it('title 随拉取透传（2026-09-04 PRD-20260903 对齐：工具卡双层标题；无 title 空串回落代码名）', () => {
    const out = mergeFetchedTools([], [
      { name: 'with_title', title: '智能体对话' },
      { name: 'no_title' }
    ])
    expect(out[0].title).toBe('智能体对话')
    expect(out[1].title).toBe('')
  })

  it('新工具：服务端携带 writeClass（已存=合并结果、草稿=后端启发式回填）直接采用；缺失/非法 READ 兜底', () => {
    const fetched = [
      { name: 'create_ticket', description: '建单', writeClass: 'WRITE' },
      { name: 'get_ticket', description: '查单', writeClass: 'READ' },
      { name: 'no_wc', description: '异常缺失', inputSchema: { type: 'object' } },
      { name: 'bad_wc', description: '非法枚举', writeClass: 'FOO' }
    ]
    const out = mergeFetchedTools([], fetched)
    expect(out).toHaveLength(4)
    expect(out[0].writeClass).toBe('WRITE')
    expect(out[1].writeClass).toBe('READ')
    // 写类启发式词表单一来源在后端（McpToolsCacheMerger）：前端不再自备词表，缺失只做 READ 兜底。
    expect(out[2].writeClass).toBe('READ')
    // 非法枚举值（非 READ/WRITE 闭集）同走 READ 兜底，不透传脏值。
    expect(out[3].writeClass).toBe('READ')
  })

  it('服务端本次未返回的现有工具：删除（server 已不提供，不保留占位）', () => {
    const current = [{ name: 'manual_placeholder', writeClass: 'READ' }]
    const fetched = [{ name: 'remote_only', inputSchema: { type: 'object' } }]
    const out = mergeFetchedTools(current, fetched)
    expect(out.map((t) => t.name)).toEqual(['remote_only'])
  })

  it('保序：顺序 = 服务端返回序', () => {
    const current = [{ name: 'a' }, { name: 'b' }]
    const fetched = [{ name: 'b' }, { name: 'c' }]
    const out = mergeFetchedTools(current, fetched)
    expect(out.map((t) => t.name)).toEqual(['b', 'c'])
  })

  it('忽略无 name 的脏数据，空入参安全返回 []', () => {
    expect(mergeFetchedTools()).toEqual([])
    expect(mergeFetchedTools([], [{ description: '没有name' }, { name: '' }, null])).toEqual([])
  })
})
