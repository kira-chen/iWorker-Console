import { describe, it, expect } from 'vitest'
import {
  connMeta,
  mergeFetchedTools,
  resolveDisplayStatus,
  isRedDot,
  countUnhealthy,
  fmtCount,
  fmtDuration,
  fmtPercent,
  hasUsage
} from '@/utils/mcpMeta'

describe('connMeta — 三态连接标签（契约 §1.3）', () => {
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

describe('resolveDisplayStatus — 检活四态归一（切片3a，契约 §4.1/§5.1）', () => {
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

describe('isRedDot / countUnhealthy — 红点提示（契约 §4.1）', () => {
  it('优先取后端 redDot 布尔', () => {
    expect(isRedDot({ redDot: true, displayStatus: 'HEALTHY' })).toBe(true)
    expect(isRedDot({ redDot: false, displayStatus: 'UNHEALTHY' })).toBe(false)
  })
  it('无 redDot 时由四态推导（仅 UNHEALTHY 红点）', () => {
    expect(isRedDot({ displayStatus: 'UNHEALTHY' })).toBe(true)
    expect(isRedDot({ displayStatus: 'HEALTHY' })).toBe(false)
    expect(isRedDot({ displayStatus: 'DISABLED' })).toBe(false)
    expect(isRedDot({ displayStatus: 'UNKNOWN' })).toBe(false)
    expect(isRedDot({ status: 'active', connStatus: 'failed' })).toBe(true)
  })
  it('countUnhealthy 统计列表红点数', () => {
    const rows = [
      { displayStatus: 'HEALTHY' },
      { displayStatus: 'UNHEALTHY' },
      { connStatus: 'failed', status: 'active' },
      { displayStatus: 'DISABLED' }
    ]
    expect(countUnhealthy(rows)).toBe(2)
    expect(countUnhealthy([])).toBe(0)
    expect(countUnhealthy()).toBe(0)
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

describe('使用统计格式化（展示规格 §3.1.1 D/E）— 不外泄 NaN/null/Infinity', () => {
  describe('fmtCount — 千分位，无效值归 0', () => {
    it('正常千分位分组', () => {
      expect(fmtCount(0)).toBe('0')
      expect(fmtCount(1280)).toBe('1,280')
      expect(fmtCount(1000000)).toBe('1,000,000')
    })
    it('小数截断为整数', () => {
      expect(fmtCount(1280.9)).toBe('1,280')
    })
    it('null/undefined/NaN/Infinity/非数 → 0', () => {
      expect(fmtCount(null)).toBe('0')
      expect(fmtCount(undefined)).toBe('0')
      expect(fmtCount(NaN)).toBe('0')
      expect(fmtCount(Infinity)).toBe('0')
      expect(fmtCount('123')).toBe('0')
    })
  })

  describe('fmtDuration — ms<1000 显 ms，≥1000 换 s 保留1位；空值 —', () => {
    it('<1000ms 显整数 ms', () => {
      expect(fmtDuration(820)).toBe('820 ms')
      expect(fmtDuration(0)).toBe('0 ms')
      expect(fmtDuration(999.6)).toBe('1000 ms') // 四舍五入仍 <1000 分支边界
    })
    it('≥1000ms 换算 s 保留 1 位', () => {
      expect(fmtDuration(1000)).toBe('1.0 s')
      expect(fmtDuration(1400)).toBe('1.4 s')
      expect(fmtDuration(1820)).toBe('1.8 s')
    })
    it('null/undefined/NaN/Infinity/负数 → —', () => {
      expect(fmtDuration(null)).toBe('—')
      expect(fmtDuration(undefined)).toBe('—')
      expect(fmtDuration(NaN)).toBe('—')
      expect(fmtDuration(Infinity)).toBe('—')
      expect(fmtDuration(-5)).toBe('—')
    })
  })

  describe('fmtPercent — 0~1→%，整百显 100%，否则 1 位；空值 —', () => {
    it('整百不补 .0', () => {
      expect(fmtPercent(1)).toBe('100%')
      expect(fmtPercent(0)).toBe('0%')
      expect(fmtPercent(0.5)).toBe('50%')
    })
    it('非整百保留 1 位', () => {
      expect(fmtPercent(0.992)).toBe('99.2%')
      expect(fmtPercent(0.3334)).toBe('33.3%')
    })
    it('越界裁剪到 0~100，不外泄异常', () => {
      expect(fmtPercent(1.5)).toBe('100%')
      expect(fmtPercent(-0.2)).toBe('0%')
    })
    it('null/undefined/NaN/Infinity → —', () => {
      expect(fmtPercent(null)).toBe('—')
      expect(fmtPercent(undefined)).toBe('—')
      expect(fmtPercent(NaN)).toBe('—')
      expect(fmtPercent(Infinity)).toBe('—')
    })
  })

  describe('hasUsage — callCount>0 才有调用记录', () => {
    it('callCount>0 → true', () => {
      expect(hasUsage({ callCount: 1 })).toBe(true)
      expect(hasUsage({ callCount: 1280 })).toBe(true)
    })
    it('0/缺省/null/NaN/无 row → false', () => {
      expect(hasUsage({ callCount: 0 })).toBe(false)
      expect(hasUsage({})).toBe(false)
      expect(hasUsage({ callCount: null })).toBe(false)
      expect(hasUsage({ callCount: NaN })).toBe(false)
      expect(hasUsage(null)).toBe(false)
      expect(hasUsage(undefined)).toBe(false)
    })
  })
})

describe('失败提示脱敏（契约 §6）— 渲染层不应拼出 endpoint', () => {
  // McpEditor 直接展示后端已脱敏的 failReason/message，前端不再二次拼接 endpoint。
  // 此处以静态源码断言守住：失败回显模板中不得引用 form.endpoint。
  it('McpEditor 失败回显不引用 form.endpoint', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/admin/McpEditor.vue'),
      'utf-8'
    )
    // 失败 alert 块用 testResult.failReason，且其 default 文案为固定人话，不插值 endpoint
    expect(src).toContain('testResult.failReason')
    // 失败提示文案不得包含 endpoint 变量插值
    const failBlock = src.slice(src.indexOf('type="error"'))
    const failAlertEnd = failBlock.indexOf('</el-alert>')
    const failAlert = failBlock.slice(0, failAlertEnd)
    expect(failAlert).not.toMatch(/form\.endpoint/)
  })
})
