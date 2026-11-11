import { describe, it, expect } from 'vitest'
import { getUsageSummary, getVersionAdoption, USAGE_RANGES } from '../usageMock'

/**
 * 驾驶舱「使用情况」mock 聚合口径单测。对齐 docs/PRD/数字员工管理端PRD/01总览/驾驶舱/prd.驾驶舱.md 第五～七节：
 * 不同区块（概览卡 / 趋势 / 反馈 / 四张明细表）是对同一份会话流水按筛选聚合的，所以必须互相对得上；
 * 这里守的是「数字对得上」与「口径规则」，不守具体数值（种子变了数值会变，口径不能变）。
 */

const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0)
const q = (filter) => getUsageSummary(filter)

describe('usageMock · 时间范围与趋势（PRD §五.1 / §五.3）', () => {
  it('趋势按天一个点：近 7 / 30 / 90 天分别 7 / 30 / 90 个点，终点是昨日 11-01', async () => {
    for (const range of USAGE_RANGES) {
      const r = await q({ range })
      expect(r.trend).toHaveLength(range)
      expect(r.trend.at(-1).date).toBe('11-01')
    }
  })

  it('非法时间范围回落到默认近 30 天', async () => {
    expect((await q({ range: 365 })).trend).toHaveLength(30)
    expect((await q({})).trend).toHaveLength(30)
  })

  it('同样的筛选条件每次打开结果一致（固定种子，演示数据不抖动）', async () => {
    const [a, b] = await Promise.all([q({ range: 30 }), q({ range: 30 })])
    expect(a).toEqual(b)
  })

  it('趋势各天加总 = 概览卡：会话数、Token 输入 / 输出一致', async () => {
    const r = await q({ range: 30 })
    expect(sum(r.trend, 'sessions')).toBe(r.kpis.sessions.value)
    expect(sum(r.trend, 'inputTokens')).toBe(r.kpis.tokens.input)
    expect(sum(r.trend, 'outputTokens')).toBe(r.kpis.tokens.output)
    expect(r.kpis.tokens.total).toBe(r.kpis.tokens.input + r.kpis.tokens.output)
  })

  it('每天的活跃用户不超过领用岗位员工数，且周末明显低于工作日', async () => {
    const r = await q({ range: 30 })
    expect(Math.max(...r.trend.map((p) => p.activeUsers))).toBeLessThanOrEqual(r.claimedUsers)
    // 11-01（周日）、10-31（周六）
    const byDate = Object.fromEntries(r.trend.map((p) => [p.date, p.activeUsers]))
    expect(byDate['11-01']).toBeLessThan(byDate['10-30'] / 2)
  })
})

describe('usageMock · 区块之间数字对得上（PRD §五～七）', () => {
  it('按用户、按岗位、按模型三张表的会话 / Token 加总都等于概览卡', async () => {
    const r = await q({ range: 30 })
    expect(sum(r.users, 'sessions')).toBe(r.kpis.sessions.value)
    expect(sum(r.positions, 'sessions')).toBe(r.kpis.sessions.value)
    const userTokens = sum(r.users, 'inputTokens') + sum(r.users, 'outputTokens')
    const modelTokens = sum(r.models, 'inputTokens') + sum(r.models, 'outputTokens')
    expect(userTokens).toBe(r.kpis.tokens.total)
    expect(modelTokens).toBe(r.kpis.tokens.total)
  })

  it('点赞 / 点踩：按用户、按岗位、按模型的加总都等于用户反馈汇总', async () => {
    const r = await q({ range: 30 })
    for (const rows of [r.users, r.positions, r.models]) {
      expect(sum(rows, 'likes')).toBe(r.feedback.likes)
      expect(sum(rows, 'dislikes')).toBe(r.feedback.dislikes)
    }
  })

  it('点踩率 = 点踩 ÷ （点踩 + 点赞），1 位小数（2026-10-12 口径）', async () => {
    const { feedback } = await q({ range: 30 })
    expect(feedback.rate).toBe(Math.round((feedback.dislikes / (feedback.likes + feedback.dislikes)) * 1000) / 10)
  })

  it('模型调用失败率 = 失败调用 ÷ 全部调用；按模型的调用次数加总 = 概览卡调用数', async () => {
    const r = await q({ range: 30 })
    const { failed, calls, value } = r.kpis.failRate
    expect(value).toBe(Math.round((failed / calls) * 1000) / 10)
    expect(sum(r.models, 'calls')).toBe(calls)
  })

  it('活跃用户 = 区间内至少 1 条会话的用户（按用户表里会话数 > 0 的人数），活跃率 = 活跃 ÷ 领用', async () => {
    const r = await q({ range: 30 })
    expect(r.users.filter((u) => u.sessions > 0)).toHaveLength(r.kpis.activeUsers.value)
    expect(r.kpis.activeUsers.rate).toBe(Math.round((r.kpis.activeUsers.value / r.claimedUsers) * 1000) / 10)
    expect(r.kpis.sessions.perUser).toBe(Math.round((r.kpis.sessions.value / r.kpis.activeUsers.value) * 10) / 10)
  })
})

describe('usageMock · 筛选（PRD §五.1）', () => {
  it('不筛选时领用岗位员工共 241 人（与原驾驶舱「领用岗位员工数量 241 人」一致），按岗位表列出 9 个已发布岗位', async () => {
    const r = await q({ range: 30 })
    expect(r.claimedUsers).toBe(241)
    expect(r.users).toHaveLength(241)
    expect(r.positions).toHaveLength(9)
    expect(sum(r.positions, 'claimed')).toBe(241)
  })

  it('按终端筛选：只剩该终端的用户，领用人数 / 活跃率分母随之变化', async () => {
    const [all, mac] = await Promise.all([q({ range: 30 }), q({ range: 30, terminal: 'MAC' })])
    expect(mac.users.every((u) => u.terminal === 'MAC')).toBe(true)
    expect(mac.claimedUsers).toBe(all.users.filter((u) => u.terminal === 'MAC').length)
    expect(mac.claimedUsers).toBeLessThan(all.claimedUsers)
    expect(mac.kpis.activeUsers.claimedUsers).toBe(mac.claimedUsers)
  })

  it('按岗位筛选：按用户表只剩该岗位，按岗位表只剩一行；岗位下拉选项始终是全部岗位', async () => {
    const r = await q({ range: 30, position: '销售顾问' })
    expect(r.users.every((u) => u.position === '销售顾问')).toBe(true)
    expect(r.positions.map((p) => p.name)).toEqual(['销售顾问'])
    expect(r.claimedUsers).toBe(48)
    expect(r.positionOptions).toHaveLength(9)
  })
})

describe('usageMock · 沉默用户与最近使用（PRD §七.2）', () => {
  it('领用了岗位但时间范围内没会话的是沉默用户；范围越短沉默的越多（7 天 ≥ 30 天 ≥ 90 天）', async () => {
    const [d7, d30, d90] = await Promise.all(USAGE_RANGES.map((range) => q({ range })))
    const silent = (r) => r.users.filter((u) => u.sessions === 0).length
    expect(silent(d30)).toBeGreaterThan(0)
    expect(silent(d7)).toBeGreaterThanOrEqual(silent(d30))
    expect(silent(d30)).toBeGreaterThanOrEqual(silent(d90))
  })

  it('从未使用过的用户：最近使用时间为 null，且任何时间范围里都是沉默用户', async () => {
    const r = await q({ range: 90 })
    const never = r.users.filter((u) => u.lastUsedAt == null)
    expect(never.length).toBeGreaterThan(0)
    expect(never.every((u) => u.sessions === 0 && u.activeDays === 0)).toBe(true)
  })

  it('最近使用时间不受时间范围限制：7 天内没会话的用户，仍有更早的最近使用时间', async () => {
    const r = await q({ range: 7 })
    const silentButUsed = r.users.filter((u) => u.sessions === 0 && u.lastUsedAt)
    expect(silentButUsed.length).toBeGreaterThan(0)
    expect(silentButUsed[0].lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('usageMock · 按模型 / 按能力（PRD §七.4 / §七.5）', () => {
  it('六个已发布模型，恰有一个默认模型；失败原因 Top 是枚举里的原因、占比 1～100 的整数', async () => {
    const { models } = await q({ range: 30 })
    expect(models).toHaveLength(6)
    expect(models.filter((m) => m.isDefault)).toHaveLength(1)
    const reasons = ['超时', '上游限流', '鉴权失败', '额度不足', '响应格式异常']
    for (const m of models) {
      expect(reasons).toContain(m.topReason.label)
      expect(Number.isInteger(m.topReason.pct)).toBe(true)
      expect(m.topReason.pct).toBeGreaterThan(0)
      expect(m.topReason.pct).toBeLessThanOrEqual(100)
      expect(m.p95).toBeGreaterThan(m.p50) // 首响 P95 一定不低于 P50
    }
  })

  it('已发布但没人用的能力：调用次数 0、成功率 / 最近调用时间为 null（演示「零使用」）', async () => {
    const { abilities } = await q({ range: 30 })
    const zero = abilities.filter((a) => a.calls === 0)
    expect(zero.map((a) => a.name)).toEqual(expect.arrayContaining(['专利检索', '差旅报销审核', '供应商评分']))
    for (const a of zero) {
      expect(a.users).toBe(0)
      expect(a.successRate).toBeNull()
      expect(a.lastCalledAt).toBeNull()
    }
  })

  it('能力同时包含技能与专家两种类型；低频能力在更短的时间范围里更容易落成零使用', async () => {
    const [d7, d90] = await Promise.all([q({ range: 7 }), q({ range: 90 })])
    expect(new Set(d90.abilities.map((a) => a.type))).toEqual(new Set(['技能', '专家']))
    const zeroCount = (r) => r.abilities.filter((a) => a.calls === 0).length
    expect(zeroCount(d7)).toBeGreaterThanOrEqual(zeroCount(d90))
  })
})

describe('usageMock · 较上一周期（PRD §五.2）', () => {
  it('90 天范围也有上一周期可比（生成了 180 天历史）：变化值不是 null', async () => {
    const r = await q({ range: 90 })
    expect(r.kpis.sessions.change).not.toBeNull()
    expect(r.feedback.prevRate).not.toBeNull()
  })

  it('失败率的变化是百分点差值，用量类指标的变化是相对百分比', async () => {
    const r = await q({ range: 30 })
    expect(Math.abs(r.kpis.failRate.change)).toBeLessThan(5) // 差值：几个百分点以内
    expect(r.kpis.sessions.change).toBeTypeOf('number')
  })
})

describe('usageMock · 版本升级进度（静态示例，PRD §二.1）', () => {
  it('Windows / Mac 各一组「已升级 / 未升到该版本」人数', async () => {
    expect(await getVersionAdoption()).toEqual({
      WINDOWS: { upgraded: 126, behind: 35 },
      MAC: { upgraded: 44, behind: 9 }
    })
  })
})
