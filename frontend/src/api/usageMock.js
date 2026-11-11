/**
 * 驾驶舱「使用情况」页签内存 mock（仅 DEV 生效，见 usage.js 头注释）。
 * 依据 docs/PRD/数字员工管理端PRD/01总览/驾驶舱/prd.驾驶舱.md 第二、五～七节。
 *
 * 【数据怎么来的】按固定种子一次性生成 241 名领用岗位员工 × 180 天的「会话」流水（每条会话带模型、调用次数、
 * 失败次数、Token、点赞 / 点踩、调用的能力），之后所有数字（概览卡、趋势、反馈、四张明细表）都是**对同一份
 * 流水按筛选条件聚合**出来的，所以不同区块的数字互相对得上（如 按用户 Token 合计 = 概览卡 Token）。
 * 这是给研发看的口径示意：真实系统里这份流水由客户端 / 网关上报，聚合在服务端做。
 *
 * 【口径】（产品侧假设，最终以研发数据方案为准，PRD 第五节第 2 条）
 * - 数据终点 = 昨日（ANCHOR），时间范围 N 天 = 终点向前推 N 天（含终点）；「上一周期」= 紧邻前一个等长区间，
 *   所以生成 180 天以保证 90 天范围也有上一周期可比。
 * - 活跃用户 = 区间内至少 1 条会话的用户（不是登录）；活跃率分母 = 筛选范围内领用岗位的员工数。
 * - 失败率 = 失败调用 ÷ 全部调用；Token 只算成功调用；点踩率 = 点踩 ÷（点踩 + 点赞）。
 * - 最近使用时间 / 最近调用时间不受时间范围限制（取全部历史），仍受终端 / 岗位筛选。
 *
 * 版本升级进度（getVersionAdoption）是静态示例，不随版本管理的发布联动。
 */

const DAY_MS = 86400000
const HISTORY_DAYS = 180
const LAST_DAY = HISTORY_DAYS - 1
const ANCHOR = Date.UTC(2026, 10, 1) // 2026-11-01，数据终点（昨日）

export const USAGE_RANGES = [7, 30, 90]

/** 确定性伪随机（mulberry32），种子固定 → 每次打开页面数据一致。 */
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad2 = (n) => String(n).padStart(2, '0')
const dayDate = (d) => new Date(ANCHOR - (LAST_DAY - d) * DAY_MS)
const fmtMD = (d) => { const x = dayDate(d); return `${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}` }
const fmtYMD = (d) => { const x = dayDate(d); return `${x.getUTCFullYear()}-${fmtMD(d)}` }
const fmtMinute = (d, t) => `${fmtYMD(d)} ${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`
const isWeekend = (d) => [0, 6].includes(dayDate(d).getUTCDay())

/* ---------------- 种子：岗位 / 模型 / 能力 ---------------- */

// 领用人数合计 241（与原驾驶舱「领用岗位员工数量 241 人」一致）
const POSITIONS = [
  { name: '销售顾问', version: 'v2.3.0', users: 48 },
  { name: '经营分析师', version: 'v1.6.0', users: 39 },
  { name: '项目经理助手', version: 'v1.4.0', users: 34 },
  { name: '产品经理助手', version: 'v2.1.0', users: 27 },
  { name: '公文写作', version: 'v1.2.0', users: 21 },
  { name: '生产计划员', version: 'v1.1.0', users: 28 },
  { name: '财务分析师', version: 'v1.3.0', users: 19 },
  { name: '法务助理', version: 'v1.0.2', users: 15 },
  { name: '客服专员', version: 'v1.5.0', users: 10 }
]
export const POSITION_NAMES = POSITIONS.map((p) => p.name)

const FAIL_REASONS = ['超时', '上游限流', '鉴权失败', '额度不足', '响应格式异常']

// share：被选为会话主模型的权重；failRate：单次调用失败概率；dislikeP：有反馈时给点踩的基础概率；
// p50 / p95：首响耗时（秒）；reasons：失败原因权重（与 FAIL_REASONS 同序）
const MODELS = [
  { name: 'DeepSeek V3', category: '文本生成', isDefault: true, share: 0.4, failRate: 0.028, dislikeP: 0.1, p50: 1.1, p95: 3.6, reasons: [5, 3, 0, 0, 1] },
  { name: 'Qwen3-Max', category: '文本生成', isDefault: false, share: 0.22, failRate: 0.035, dislikeP: 0.09, p50: 1.4, p95: 4.2, reasons: [4, 4, 0, 1, 0] },
  { name: 'GLM-4.6', category: '文本生成', isDefault: false, share: 0.14, failRate: 0.046, dislikeP: 0.13, p50: 1.3, p95: 4.8, reasons: [6, 2, 1, 0, 1] },
  { name: 'Kimi K2', category: '文本生成', isDefault: false, share: 0.12, failRate: 0.072, dislikeP: 0.15, p50: 1.8, p95: 6.1, reasons: [3, 6, 0, 2, 0] },
  { name: 'Qwen3-VL', category: '图像理解', isDefault: false, share: 0.07, failRate: 0.115, dislikeP: 0.21, p50: 2.6, p95: 9.4, reasons: [7, 1, 0, 0, 4] },
  { name: 'MiniMax-M2', category: '多模态', isDefault: false, share: 0.05, failRate: 0.058, dislikeP: 0.16, p50: 1.9, p95: 5.7, reasons: [3, 2, 0, 3, 2] }
]

// share：被会话调用的权重；ok：单次调用成功概率。share 为 0 = 已发布但没人用（演示「零使用」）；
// share 很小的低频能力在 7 天范围里自然会落成零使用
const ABILITIES = [
  { name: '报价单生成', type: '技能', share: 14, ok: 0.96 },
  { name: '合同风险审查', type: '技能', share: 11, ok: 0.93 },
  { name: '经营分析报告', type: '技能', share: 10, ok: 0.95 },
  { name: '周报生成', type: '技能', share: 9, ok: 0.98 },
  { name: '会议纪要整理', type: '技能', share: 8, ok: 0.97 },
  { name: '销售分析专家', type: '专家', share: 6, ok: 0.95 },
  { name: '公文润色', type: '技能', share: 6, ok: 0.98 },
  { name: '竞品分析', type: '技能', share: 5, ok: 0.91 },
  { name: '客户拜访邮件', type: '技能', share: 5, ok: 0.97 },
  { name: '排产优化', type: '技能', share: 3, ok: 0.88 },
  { name: '财务报表解读', type: '技能', share: 3, ok: 0.9 },
  { name: '法务合规专家', type: '专家', share: 3, ok: 0.92 },
  { name: '招聘简历筛选', type: '技能', share: 0.12, ok: 0.94 },
  { name: '专利检索', type: '技能', share: 0, ok: 0.9 },
  { name: '差旅报销审核', type: '技能', share: 0, ok: 0.9 },
  { name: '供应商评分', type: '专家', share: 0, ok: 0.9 }
]

/* ---------------- 生成流水（只跑一次，缓存） ---------------- */

const SURNAMES = '张王李刘陈杨赵黄周吴徐孙马朱胡郭何高林罗'
const GIVEN = '伟芳娜敏静磊洋艳勇军杰涛明超秀霞平刚桂英华建国丽强婷宇浩然欣怡子涵俊辰思远嘉怡梓轩雨泽'

function pickWeighted(rng, weights) {
  let total = 0
  for (const w of weights) total += w
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

let cache = null
function build() {
  if (cache) return cache
  const rng = makeRng(20261101)

  // 用户：按岗位领用人数铺开；约 76% Windows；6 人从未使用，约 10% 在历史中途停用（演示沉默用户）
  const users = []
  const usedNames = new Set()
  POSITIONS.forEach((pos, pi) => {
    for (let k = 0; k < pos.users; k++) {
      let name
      do {
        name = SURNAMES[Math.floor(rng() * SURNAMES.length)] + GIVEN[Math.floor(rng() * GIVEN.length)] + GIVEN[Math.floor(rng() * GIVEN.length)]
      } while (usedNames.has(name))
      usedNames.add(name)
      const prefer = pickWeighted(rng, MODELS.map((m) => m.share))
      users.push({
        id: users.length,
        name,
        pos: pi,
        terminal: rng() < 0.76 ? 'WINDOWS' : 'MAC',
        prop: 0.2 + rng() * 0.6, // 工作日活跃概率
        prefer, // 偏好的主模型
        quitDay: -1,
        never: false
      })
    }
  })
  users.forEach((u, i) => {
    if (i % 41 === 7) u.never = true
    else if (rng() < 0.1) u.quitDay = LAST_DAY - 8 - Math.floor(rng() * 70) // 8～78 天前起不再使用
  })

  const abWeights = ABILITIES.map((a) => a.share)
  const sessions = []
  for (const u of users) {
    if (u.never) continue
    for (let d = 0; d <= LAST_DAY; d++) {
      if (u.quitDay >= 0 && d > u.quitDay) break
      const growth = 0.85 + 0.15 * (d / LAST_DAY) // 用量缓慢上升
      const p = u.prop * growth * (isWeekend(d) ? 0.12 : 1)
      if (rng() >= p) continue
      const n = 1 + Math.floor(rng() * rng() * 5)
      for (let s = 0; s < n; s++) {
        const m = rng() < 0.75 ? u.prefer : pickWeighted(rng, MODELS.map((x) => x.share))
        const model = MODELS[m]
        const calls = 1 + Math.floor(rng() * 4)
        let fails = 0
        const fr = []
        let inT = 0
        let outT = 0
        for (let c = 0; c < calls; c++) {
          if (rng() < model.failRate) {
            fails++
            fr.push(pickWeighted(rng, model.reasons.map((w) => w + 0.0001)))
          } else {
            inT += 1200 + Math.floor(rng() * 5200)
            outT += 400 + Math.floor(rng() * 2600)
          }
        }
        let like = 0
        let dislike = 0
        if (rng() < 0.38) {
          // 点踩概率随时间下降（越早越高），演示「点踩率持续改善」
          const dp = model.dislikeP * (1 + 0.25 * (1 - d / LAST_DAY))
          if (rng() < dp) dislike = 1
          else like = 1
        }
        const ab = []
        const r = rng()
        const abN = r < 0.25 ? 0 : r < 0.8 ? 1 : 2
        for (let a = 0; a < abN; a++) {
          const ai = pickWeighted(rng, abWeights)
          if (ABILITIES[ai].share <= 0) continue
          ab.push(ai * 2 + (rng() < ABILITIES[ai].ok ? 1 : 0))
        }
        sessions.push({ u: u.id, d, t: 8 * 60 + Math.floor(rng() * 11 * 60), m, calls, fails, fr, inT, outT, like, dislike, ab })
      }
    }
  }
  cache = { users, sessions }
  return cache
}

/* ---------------- 聚合 ---------------- */

const round1 = (v) => Math.round(v * 10) / 10
/** 较上一周期变化百分比（1 位小数）；上一周期为 0 / 无数据返回 null。 */
const changePct = (cur, prev) => (prev > 0 ? round1(((cur - prev) / prev) * 100) : null)

function emptyBucket() {
  return { users: new Set(), sessions: 0, inT: 0, outT: 0, calls: 0, fails: 0, likes: 0, dislikes: 0 }
}
function addTo(b, s) {
  b.users.add(s.u)
  b.sessions++
  b.inT += s.inT
  b.outT += s.outT
  b.calls += s.calls
  b.fails += s.fails
  b.likes += s.like
  b.dislikes += s.dislike
}
const rateOf = (likes, dislikes) => (likes + dislikes > 0 ? round1((dislikes / (likes + dislikes)) * 100) : null)

/**
 * 按筛选条件聚合。filter: { range: 7|30|90, terminal: ''|'WINDOWS'|'MAC', position: ''|岗位名 }
 * 返回 { claimedUsers, positionOptions, kpis, trend, feedback, users, positions, models, abilities }，字段含义见 PRD 第五～七节。
 */
function aggregate(filter) {
  const range = USAGE_RANGES.includes(Number(filter.range)) ? Number(filter.range) : 30
  const { users, sessions } = build()
  const fromD = LAST_DAY - range + 1
  const prevFrom = fromD - range
  const inScope = users.map(
    (u) => (!filter.terminal || u.terminal === filter.terminal) && (!filter.position || POSITIONS[u.pos].name === filter.position)
  )

  const cur = emptyBucket()
  const prev = emptyBucket()
  const daily = Array.from({ length: range }, () => ({ users: new Set(), sessions: 0, inT: 0, outT: 0 }))
  const perUser = users.map(() => ({ sessions: 0, days: 0, lastDay: -1, inT: 0, outT: 0, likes: 0, dislikes: 0, lastD: -1, lastT: 0 }))
  const perPos = POSITIONS.map(() => emptyBucket())
  const perModel = MODELS.map(() => ({ ...emptyBucket(), reasons: FAIL_REASONS.map(() => 0) }))
  const perAb = ABILITIES.map(() => ({ calls: 0, users: new Set(), ok: 0, lastD: -1, lastT: 0 }))

  for (const s of sessions) {
    if (!inScope[s.u]) continue
    const pu = perUser[s.u]
    if (s.d > pu.lastD || (s.d === pu.lastD && s.t > pu.lastT)) { pu.lastD = s.d; pu.lastT = s.t }
    for (const code of s.ab) {
      const pa = perAb[code >> 1]
      if (s.d > pa.lastD || (s.d === pa.lastD && s.t > pa.lastT)) { pa.lastD = s.d; pa.lastT = s.t }
    }
    if (s.d >= prevFrom && s.d < fromD) { addTo(prev, s); continue }
    if (s.d < fromD) continue

    addTo(cur, s)
    const day = daily[s.d - fromD]
    day.users.add(s.u)
    day.sessions++
    day.inT += s.inT
    day.outT += s.outT
    pu.sessions++
    if (pu.lastDay !== s.d) { pu.days++; pu.lastDay = s.d }
    pu.inT += s.inT
    pu.outT += s.outT
    pu.likes += s.like
    pu.dislikes += s.dislike
    addTo(perPos[users[s.u].pos], s)
    const pm = perModel[s.m]
    addTo(pm, s)
    for (const r of s.fr) pm.reasons[r]++
    for (const code of s.ab) {
      const pa = perAb[code >> 1]
      pa.calls++
      pa.users.add(s.u)
      pa.ok += code & 1
    }
  }

  const claimed = users.filter((_, i) => inScope[i])
  const claimedUsers = claimed.length
  const curTok = cur.inT + cur.outT
  const prevTok = prev.inT + prev.outT
  const failRate = cur.calls ? round1((cur.fails / cur.calls) * 100) : 0
  const prevFailRate = prev.calls ? round1((prev.fails / prev.calls) * 100) : null

  const kpis = {
    activeUsers: { value: cur.users.size, change: changePct(cur.users.size, prev.users.size), rate: claimedUsers ? round1((cur.users.size / claimedUsers) * 100) : 0, claimedUsers },
    sessions: { value: cur.sessions, change: changePct(cur.sessions, prev.sessions), perUser: cur.users.size ? round1(cur.sessions / cur.users.size) : 0 },
    tokens: { total: curTok, input: cur.inT, output: cur.outT, change: changePct(curTok, prevTok) },
    failRate: { value: failRate, change: prevFailRate == null ? null : round1(failRate - prevFailRate), failed: cur.fails, calls: cur.calls }
  }

  const trend = daily.map((x, i) => ({ date: fmtMD(fromD + i), activeUsers: x.users.size, sessions: x.sessions, inputTokens: x.inT, outputTokens: x.outT }))

  const feedback = {
    likes: cur.likes,
    dislikes: cur.dislikes,
    rate: rateOf(cur.likes, cur.dislikes),
    prevRate: rateOf(prev.likes, prev.dislikes)
  }

  const userRows = claimed.map((u) => {
    const p = perUser[u.id]
    return {
      id: u.id,
      name: u.name,
      position: POSITIONS[u.pos].name,
      terminal: u.terminal,
      activeDays: p.days,
      sessions: p.sessions,
      inputTokens: p.inT,
      outputTokens: p.outT,
      lastUsedAt: p.lastD >= 0 ? fmtMinute(p.lastD, p.lastT) : null,
      likes: p.likes,
      dislikes: p.dislikes,
      dislikeRate: rateOf(p.likes, p.dislikes)
    }
  })

  const positionRows = POSITIONS.map((pos, pi) => {
    const b = perPos[pi]
    const claimedN = claimed.filter((u) => u.pos === pi).length
    return {
      name: pos.name,
      version: pos.version,
      claimed: claimedN,
      active: b.users.size,
      activeRate: claimedN ? round1((b.users.size / claimedN) * 100) : null,
      sessions: b.sessions,
      avgTokens: b.users.size ? Math.round((b.inT + b.outT) / b.users.size) : null,
      likes: b.likes,
      dislikes: b.dislikes,
      dislikeRate: rateOf(b.likes, b.dislikes)
    }
  }).filter((r) => r.claimed > 0)

  const modelRows = MODELS.map((m, mi) => {
    const b = perModel[mi]
    const topIdx = b.reasons.reduce((best, c, i) => (c > b.reasons[best] ? i : best), 0)
    const jitter = 1 + (((mi * 7 + range) % 5) - 2) * 0.02
    return {
      name: m.name,
      category: m.category,
      isDefault: m.isDefault,
      calls: b.calls,
      inputTokens: b.inT,
      outputTokens: b.outT,
      activeUsers: b.users.size,
      failRate: b.calls ? round1((b.fails / b.calls) * 100) : null,
      topReason: b.fails ? { label: FAIL_REASONS[topIdx], pct: Math.round((b.reasons[topIdx] / b.fails) * 100) } : null,
      p50: round1(m.p50 * jitter),
      p95: round1(m.p95 * jitter),
      likes: b.likes,
      dislikes: b.dislikes,
      dislikeRate: rateOf(b.likes, b.dislikes)
    }
  })

  const abilityRows = ABILITIES.map((a, ai) => {
    const b = perAb[ai]
    return {
      name: a.name,
      type: a.type,
      calls: b.calls,
      users: b.users.size,
      successRate: b.calls ? round1((b.ok / b.calls) * 100) : null,
      lastCalledAt: b.lastD >= 0 ? fmtMinute(b.lastD, b.lastT) : null
    }
  })

  return { range, claimedUsers, positionOptions: POSITION_NAMES, kpis, trend, feedback, users: userRows, positions: positionRows, models: modelRows, abilities: abilityRows }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** 使用情况页签全部数据（筛选条件变化时整体重取，PRD 第五节第 1 条）。 */
export async function getUsageSummary(filter = {}) {
  await delay(300)
  return aggregate(filter)
}

/**
 * 各终端版本升级进度（静态示例）：近 7 天有检测上报的用户中，已升到下发版本 / 未升到的人数。
 * 真实口径见 PRD 第二节：用户端每次检测更新都上报「终端 + 当前版本号」，已升级 = 版本号与下发版本一致。
 */
export async function getVersionAdoption() {
  await delay(120)
  return { WINDOWS: { upgraded: 126, behind: 35 }, MAC: { upgraded: 44, behind: 9 } }
}
