/**
 * 岗位「样例定时任务」内存 mock（demo 数据层；开关同岗位工作台 VITE_POS_MOCK，见 sampleTask.js 头注释）。
 *
 * 2026-09-02 岗位工作台补 mock：覆盖 PositionDetailTabs「自动化任务」Tab（PositionSampleTaskStage +
 * SampleTaskEditor）所调端点：列表/详情/新建/编辑/排序/删除/启停/调度预览/试跑（试跑入口现由
 * EFFECT_TEST_ENABLED=false 隐藏，mock 仍给拟真结果兜底，避免开关打开后报错）。
 *
 * 种子与 positionMock 4 条岗位同源：401 经营分析岗 2 条、402 客户成功岗 1 条、404 市场研究岗 1 条、403 空态。
 * toolRefs / skillRefs 从 unifiedSkillMock 的工具目录与平台技能同口径取名，不造第二份真相。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
// 2026-09-09 收编：nowIso（带 +08:00 本地 ISO）与 fmtDt（Date→「YYYY-MM-DD HH:mm」）两份本地复制品
// 改引 utils/datetime 单一真相（fmtMinute 接受 Date 入参，输出同串）
import { nowIsoLocal as nowIso, fmtMinute as fmtDt } from '@/utils/datetime'

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

const SAMPLE_SOFT_LIMIT = 20 // 与 utils/positionModel LIMITS.SAMPLE_TASK_MAX 同口径

let sampleSeq = 7101

/* ---------------- 调度摘要 / 预览（本地纯计算，无时区：按浏览器本地墙钟） ---------------- */

const WEEK_CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
const IDLE_UNIT_CN = { DAY: '天', WEEK: '周', MONTH: '月' }
const IDLE_WINDOW_CN = { NIGHT: '夜间闲时（00:00–06:00）', ANYTIME: '不限时段，按系统负载调度' }

export function summarizeSchedule(schedule = {}) {
  const times = (schedule.times || []).filter(Boolean)
  const t = times.join('、')
  switch (schedule.scheduleType) {
    // 闲时（2026-09-23 新增）：无定点时间，人话摘要展示「每 X 次·时段」，触发时刻由系统择机决定
    case 'IDLE': {
      const unit = IDLE_UNIT_CN[schedule.idleCountUnit] || '天'
      const win = IDLE_WINDOW_CN[schedule.idleWindow] || IDLE_WINDOW_CN.NIGHT
      return `每${unit} ${schedule.idleCount || 1} 次 · ${win} · 系统择机执行`
    }
    case 'ONCE':
      return schedule.onceAt ? `${String(schedule.onceAt).replace('T', ' ')} 执行一次` : '执行一次'
    case 'WEEKLY': {
      const days = (schedule.daysOfWeek || []).map((d) => WEEK_CN[d] || d).join('、')
      return `每周${days || '—'} ${t}`
    }
    case 'MONTHLY': {
      const days = (schedule.daysOfMonth || []).join('、')
      return `每月 ${days || '—'} 日 ${t}`
    }
    case 'INTERVAL_HOUR':
      return `每 ${schedule.intervalCount || 1} 小时执行一次`
    case 'INTERVAL_DAY':
      return `每 ${schedule.intervalCount || 1} 天执行一次`
    case 'INTERVAL_WEEK':
      return `每 ${schedule.intervalCount || 1} 周执行一次`
    case 'DAILY':
    default:
      return `每天 ${t}`
  }
}

// 每间隔模式的步进（md §7.3 L394：小时 / 天 / 周）——按墙钟步进，保持起始时刻的时分不变
const INTERVAL_STEP = {
  INTERVAL_HOUR: (d, n) => d.setHours(d.getHours() + n),
  INTERVAL_DAY: (d, n) => d.setDate(d.getDate() + n),
  INTERVAL_WEEK: (d, n) => d.setDate(d.getDate() + 7 * n)
}

/** 从当前时刻起算的未来 count 个触发时间（人话字符串数组，供预览面板）。 */
export function computeNextRunTimes(schedule = {}, count = 3) {
  if (schedule.scheduleType === 'ONCE') {
    return schedule.onceAt ? [fmtDt(new Date(schedule.onceAt))] : []
  }
  // 闲时（2026-09-23 新增）：触发时刻不固定，不产出具体时间点，人话摘要已经说明「系统择机执行」
  if (schedule.scheduleType === 'IDLE') return []
  const out = []
  const now = new Date()
  const times = (schedule.times || []).filter(Boolean)
  const start = schedule.startDate ? new Date(`${schedule.startDate}T00:00:00`) : null
  const end = schedule.endDate ? new Date(`${schedule.endDate}T23:59:59`) : null

  // 每间隔（2026-09-12 对齐 md §7.3 L394/L396/L401，审计 K5）：以「起始日期（缺省今天）+ 起始时刻 times[0]」
  // 为锚点，按 intervalCount × 单位固定步进；锚点已过则步进到第一个未来时刻再往后数 count 次。
  const step = INTERVAL_STEP[schedule.scheduleType]
  if (step) {
    const n = Math.max(1, Number(schedule.intervalCount) || 1)
    const [h, m] = String(times[0] || '09:00').split(':').map(Number)
    const base = start && start > now ? start : now
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h || 0, m || 0)
    while (dt <= now) step(dt, n)
    for (let i = 0; i < 400 && out.length < count; i++) {
      if (end && dt > end) break
      out.push(fmtDt(dt))
      step(dt, n)
    }
    return out
  }

  for (let i = 0; i < 400 && out.length < count; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    if (start && day < start) continue
    if (end && day > end) break
    const dow = day.getDay() === 0 ? 7 : day.getDay()
    if (schedule.scheduleType === 'WEEKLY' && !(schedule.daysOfWeek || []).includes(dow)) continue
    if (schedule.scheduleType === 'MONTHLY' && !(schedule.daysOfMonth || []).includes(day.getDate())) continue
    for (const t of [...times].sort()) {
      const [h, m] = String(t).split(':').map(Number)
      const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0)
      if (dt <= now) continue
      out.push(fmtDt(dt))
      if (out.length >= count) break
    }
  }
  return out
}

/* ---------------- 种子（与 positionMock 4 条岗位同源） ---------------- */

function buildSeed() {
  return {
    401: [
      {
        id: 7001,
        positionId: 401,
        name: '每日经营晨报',
        prompt: '汇总昨日各业务线经营数据，识别异常并生成晨报发我',
        remark: '工作日早会前送达',
        status: 'ENABLED',
        schedule: { scheduleType: 'DAILY', times: ['08:30'], daysOfWeek: [], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 每日经营晨报\n\n1. 拉取昨日营收 / 毛利 / 回款数据\n2. 与近 7 日均值对比，标注异常指标\n3. 生成三段式晨报：总览 / 异常 / 建议动作\n',
        toolRefs: [
          { type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' },
          { type: 'API', code: 'api__customer', bizName: '客户数据 API' }
        ],
        skillRefs: [{ platformSkillId: 'sk_302', name: '经营数据分析' }],
        sortOrder: 0,
        createdAt: '2026-08-15T10:00:00+08:00',
        updatedAt: '2026-08-25T15:30:00+08:00'
      },
      {
        id: 7002,
        positionId: 401,
        name: '周度经营复盘提醒',
        prompt: '整理上周经营数据形成复盘要点，并列出待跟进事项',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'WEEKLY', times: ['09:00'], daysOfWeek: [1], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 周度经营复盘\n\n1. 汇总上周核心指标完成度\n2. 对照月度目标给出差距分析\n3. 输出待跟进事项清单\n',
        toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
        skillRefs: [],
        sortOrder: 1,
        createdAt: '2026-08-18T11:00:00+08:00',
        updatedAt: '2026-08-24T09:10:00+08:00'
      },
      {
        id: 7011,
        positionId: 401,
        name: '月度目标达成预警',
        prompt: '每月 25 日检查本月目标达成进度，低于 80% 时发出预警',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'MONTHLY', times: ['10:00'], daysOfMonth: [25], daysOfWeek: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 月度目标达成预警\n\n1. 拉取本月 KPI 完成数据\n2. 计算达成率\n3. 低于 80% 触发预警通知\n',
        toolRefs: [{ type: 'API', code: 'api__customer', bizName: '客户数据 API' }],
        skillRefs: [],
        sortOrder: 2,
        createdAt: '2026-08-20T09:00:00+08:00',
        updatedAt: '2026-08-20T09:00:00+08:00'
      },
      {
        id: 7012,
        positionId: 401,
        name: '供应商付款提醒',
        prompt: '每周五下班前汇总本周应付未付的供应商账款，提醒财务处理',
        remark: '',
        status: 'DISABLED',
        schedule: { scheduleType: 'WEEKLY', times: ['17:00'], daysOfWeek: [5], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 供应商付款提醒\n\n1. 查询本周到期应付账款\n2. 按优先级排序\n3. 生成汇总清单发财务\n',
        toolRefs: [],
        skillRefs: [],
        sortOrder: 3,
        createdAt: '2026-08-21T10:00:00+08:00',
        updatedAt: '2026-08-21T10:00:00+08:00'
      },
      {
        id: 7013,
        positionId: 401,
        name: '库存低位预警',
        prompt: '每天检查核心 SKU 库存水位，低于安全库存时发出补货预警',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'DAILY', times: ['09:00'], daysOfWeek: [], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 库存低位预警\n\n1. 拉取核心 SKU 实时库存\n2. 对照安全库存阈值\n3. 低于阈值触发补货建议\n',
        toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
        skillRefs: [],
        sortOrder: 4,
        createdAt: '2026-08-22T11:00:00+08:00',
        updatedAt: '2026-08-22T11:00:00+08:00'
      },
      {
        id: 7014,
        positionId: 401,
        name: '客户满意度周报',
        prompt: '每周汇总客户投诉、好评与 NPS 数据，生成满意度周报',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'WEEKLY', times: ['08:00'], daysOfWeek: [2], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 客户满意度周报\n\n1. 汇总本周客户反馈\n2. 统计投诉率与好评率\n3. 计算 NPS 并与上周对比\n',
        toolRefs: [{ type: 'API', code: 'api__customer', bizName: '客户数据 API' }],
        skillRefs: [{ platformSkillId: 'sk_302', name: '经营数据分析' }],
        sortOrder: 5,
        createdAt: '2026-08-23T09:00:00+08:00',
        updatedAt: '2026-08-23T09:00:00+08:00'
      },
      {
        id: 7015,
        positionId: 401,
        name: '季度财务简报',
        prompt: '季度末汇总财务核心指标，生成董事会简报',
        remark: '仅季末执行',
        status: 'ENABLED',
        schedule: { scheduleType: 'MONTHLY', times: ['09:00'], daysOfMonth: [28], daysOfWeek: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 季度财务简报\n\n1. 汇总收入、成本、利润三张表\n2. 对照年度预算计算偏差\n3. 生成董事会格式简报\n',
        toolRefs: [
          { type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' },
          { type: 'API', code: 'api__customer', bizName: '客户数据 API' }
        ],
        skillRefs: [],
        sortOrder: 6,
        createdAt: '2026-08-24T10:00:00+08:00',
        updatedAt: '2026-08-24T10:00:00+08:00'
      },
      {
        id: 7016,
        positionId: 401,
        name: '员工考勤异常汇总',
        prompt: '每周一汇总上周员工考勤异常情况（迟到/早退/缺勤）',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'WEEKLY', times: ['09:30'], daysOfWeek: [1], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 员工考勤异常汇总\n\n1. 拉取上周打卡记录\n2. 识别迟到、早退、缺勤条目\n3. 按部门汇总并通知 HR\n',
        toolRefs: [],
        skillRefs: [],
        sortOrder: 7,
        createdAt: '2026-08-25T09:00:00+08:00',
        updatedAt: '2026-08-25T09:00:00+08:00'
      }
    ],
    402: [
      {
        id: 7003,
        positionId: 402,
        name: '拜访前资料准备',
        prompt: '每天早上把当日待拜访客户的资料与提纲准备好',
        remark: '',
        status: 'ENABLED',
        schedule: { scheduleType: 'DAILY', times: ['08:00'], daysOfWeek: [], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 拜访前资料准备\n\n1. 查询当日拜访计划\n2. 汇总客户近 30 天动态与历史沟通记录\n3. 生成拜访提纲（目标 / 问题清单 / 风险点）\n',
        toolRefs: [{ type: 'API', code: 'api__customer', bizName: '客户数据 API' }],
        skillRefs: [],
        sortOrder: 0,
        createdAt: '2026-08-17T10:00:00+08:00',
        updatedAt: '2026-08-23T16:00:00+08:00'
      }
    ],
    403: [],
    // 2026-09-09 负责人要求补全市场研究岗（404）：自动化任务是发布阻断六项之一，缺它这条
    // 岗位就永远发不出去、发布前检查弹窗也点不到。补 1 条与该岗位职责一致的周期任务。
    404: [
      {
        id: 7004,
        positionId: 404,
        name: '每周竞品动态汇总',
        prompt: '汇总本周主要竞品的产品、价格与市场动作，输出对比结论',
        remark: '周一晨会前送达',
        status: 'ENABLED',
        schedule: { scheduleType: 'WEEKLY', times: ['09:00'], daysOfWeek: [1], daysOfMonth: [], onceAt: '', startDate: '', endDate: '' },
        sopDoc: '# 每周竞品动态汇总\n\n1. 收集主要竞品本周的公开动作（产品 / 价格 / 市场）\n2. 与上周对比，标注变化点\n3. 区分事实与推断，输出对比结论与关注建议\n',
        toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
        skillRefs: [{ platformSkillId: 'sk_303', name: '会议纪要整理' }],
        sortOrder: 0,
        createdAt: '2026-08-23T10:00:00+08:00',
        updatedAt: '2026-08-23T10:00:00+08:00'
      }
    ]
  }
}

let samplesByPosition = buildSeed()

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处（只读与调度预览不落盘）。
const persist = attachPersist('sampleTask', {
  // v2（2026-09-09）：404 市场研究岗补 1 条自动化任务（种子结构变更须 bump，否则存量快照会
  // 把「404 无任务」的旧值带回来，岗位又变回不可发布）
  // v5（2026-09-12 审计 K1）：preKick 缺省由 false 改 true（md §7.3 L398「默认开启」），VO 形状变更 bump
  // v6（2026-09-23 负责人拍板）：删除 preKick 字段、执行频率新增「闲时」模式，VO 形状变更 bump
  version: 6,
  snapshot: () => ({ sampleSeq, samplesByPosition }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.sampleSeq) || typeof d.samplesByPosition !== 'object' || d.samplesByPosition === null) {
      throw new Error('sampleTask 快照形状不合法')
    }
    sampleSeq = d.sampleSeq
    samplesByPosition = d.samplesByPosition
  }
})

function listOf(positionId) {
  const key = String(positionId)
  if (!samplesByPosition[key]) samplesByPosition[key] = []
  return samplesByPosition[key]
}

function findSample(positionId, sampleId) {
  return listOf(positionId).find((s) => String(s.id) === String(sampleId))
}

function toVO(s, warnings) {
  const vo = {
    ...s,
    schedule: JSON.parse(JSON.stringify(s.schedule)),
    toolRefs: (s.toolRefs || []).map((t) => ({ ...t })),
    skillRefs: (s.skillRefs || []).map((r) => ({ ...r })),
    scheduleType: s.schedule?.scheduleType || 'DAILY',
    scheduleSummary: summarizeSchedule(s.schedule),
    execType: s.execType || 'SKILL',
    execAgentId: s.execAgentId ?? null,
    execModel: s.execModel || ''
  }
  if (warnings && warnings.length) vo.warnings = warnings
  return vo
}

function normalizeUpsert(payload = {}) {
  return {
    name: String(payload.name || '').trim(),
    prompt: String(payload.prompt || ''),
    remark: String(payload.remark || ''),
    schedule: {
      scheduleType: payload.schedule?.scheduleType || 'DAILY',
      scheduleMode: payload.schedule?.scheduleMode || 'PERIODIC',
      periodicPreset: payload.schedule?.periodicPreset || 'DAILY',
      intervalCount: payload.schedule?.intervalCount || 1,
      intervalUnit: payload.schedule?.intervalUnit || 'DAY',
      idleCount: payload.schedule?.idleCount || 1,
      idleCountUnit: payload.schedule?.idleCountUnit || 'DAY',
      idleWindow: payload.schedule?.idleWindow || 'NIGHT',
      times: [...(payload.schedule?.times || [])],
      daysOfWeek: [...(payload.schedule?.daysOfWeek || [])],
      daysOfMonth: [...(payload.schedule?.daysOfMonth || [])],
      onceAt: payload.schedule?.onceAt || '',
      startDate: payload.schedule?.startDate || '',
      endDate: payload.schedule?.endDate || ''
    },
    sopDoc: String(payload.sopDoc || ''),
    toolRefs: (payload.toolRefs || []).map((t) => ({ type: t.type, code: t.code, bizName: t.bizName || t.code })),
    skillRefs: (payload.skillRefs || []).map((r) => ({ platformSkillId: r.platformSkillId, name: r.name || '' })),
    execType: payload.execType || 'SKILL',
    execAgentId: payload.execType === 'AGENT' ? (payload.execAgentId ?? null) : null,
    execModel: payload.execModel || ''
  }
}

function assertUpsert(data) {
  if (!data.name) throw err('请填写任务名称', 'name')
  if (data.name.length > 64) throw err('任务名称最多 64 个字符', 'name')
  if (data.prompt.length > 2000) throw err('一句话指令最多 2000 个字符', 'prompt')
  // 提示词非必填（md §7.7 必填只有名称 + 一句话指令；2026-09-12 审计 J7），仅守 §7.4 8000 字上限（K7）
  if (data.sopDoc.length > 8000) throw err('提示词最多 8000 个字符', 'sopDoc')
}

/* ============================ 查 ============================ */

// 4.1 列表（按 sortOrder,id 升序）
export async function listSampleTasks(positionId) {
  await delay()
  const list = listOf(positionId)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((s) => toVO(s))
  return { list, total: list.length }
}

// 4.2 详情
export async function getSampleTask(positionId, sampleId) {
  await delay()
  const s = findSample(positionId, sampleId)
  if (!s) throw err('样例任务不存在或已被删除', null, 404)
  return toVO(s)
}

/* ============================ 增 / 改 ============================ */

// 4.3 新建（sortOrder 追加末尾；软上限只 warning 不阻断）
export async function createSampleTask(positionId, payload) {
  await delay()
  const data = normalizeUpsert(payload)
  assertUpsert(data)
  const list = listOf(positionId)
  const now = nowIso()
  const s = {
    id: sampleSeq++,
    positionId: Number(positionId),
    status: 'ENABLED',
    ...data,
    sortOrder: list.length,
    createdAt: now,
    updatedAt: now
  }
  list.push(s)
  persist()
  const warnings =
    list.length > SAMPLE_SOFT_LIMIT
      ? [{ code: 'sample_over_soft_limit', message: `样例任务已超过建议上限 ${SAMPLE_SOFT_LIMIT} 条，建议精简` }]
      : []
  return toVO(s, warnings)
}

// 4.4 编辑（全量覆盖）
export async function updateSampleTask(positionId, sampleId, payload) {
  await delay()
  const s = findSample(positionId, sampleId)
  if (!s) throw err('样例任务不存在或已被删除', null, 404)
  const data = normalizeUpsert(payload)
  assertUpsert(data)
  Object.assign(s, data, { updatedAt: nowIso() })
  persist()
  return toVO(s)
}

/* ============================ 排序 ============================ */

// 4.5 排序（orderedIds 须与现存集合一致）
export async function reorderSampleTasks(positionId, orderedIds) {
  await delay(80)
  const list = listOf(positionId)
  const ids = (orderedIds || []).map(String)
  if (ids.length !== list.length || list.some((s) => !ids.includes(String(s.id)))) {
    throw err('排序集合与现存样例不一致，请刷新后重试', null, 409)
  }
  list.forEach((s) => {
    s.sortOrder = ids.indexOf(String(s.id))
  })
  persist()
  return {}
}

/* ============================ 删 / 启停 ============================ */

// 4.6 删除（软删）
export async function deleteSampleTask(positionId, sampleId) {
  await delay()
  const s = findSample(positionId, sampleId)
  if (!s) throw err('样例任务不存在或已被删除', null, 404)
  samplesByPosition[String(positionId)] = listOf(positionId).filter((x) => x !== s)
  persist()
  return {}
}

// 4.7 启停
export async function setSampleTaskStatus(positionId, sampleId, status) {
  await delay()
  const s = findSample(positionId, sampleId)
  if (!s) throw err('样例任务不存在或已被删除', null, 404)
  if (!['ENABLED', 'DISABLED'].includes(status)) throw err('状态非法', 'status')
  s.status = status
  s.updatedAt = nowIso()
  persist()
  return {}
}

/* ============================ 调度预览 / 试跑 ============================ */

// 4.8 调度预览（无副作用）→ { summary, nextRunTimes[] }
export async function previewSampleSchedule(positionId, payload = {}) {
  await delay(80)
  const schedule = payload.schedule || {}
  if (schedule.scheduleType === 'ONCE' && !schedule.onceAt) throw err('请选择执行时间', 'schedule')
  return {
    summary: summarizeSchedule(schedule),
    nextRunTimes: computeNextRunTimes(schedule, payload.count || 3)
  }
}

// 4.9 试跑（demo 拟真：不触达真实工具，回 AttemptResult 口径）
export async function testRunSampleTask(positionId, sampleId) {
  await delay(600)
  const s = findSample(positionId, sampleId)
  if (!s) throw err('样例任务不存在或已被删除', null, 404)
  return {
    success: true,
    resultSummary: `已按样例「${s.name}」模拟执行一轮（demo 仿真，不触达真实工具）`,
    summary: `已按样例「${s.name}」模拟执行一轮（demo 仿真，不触达真实工具）`,
    steps: [
      { type: 'THOUGHT', text: '解析样例指令与 SOP，规划执行步骤' },
      ...(s.toolRefs || []).map((t) => ({ type: 'OBSERVATION', text: `调用 ${t.bizName || t.code}（模拟返回成功）`, simulated: true, simulatedTool: t.code })),
      { type: 'FINAL', text: '生成结果摘要并结束本轮试跑' }
    ],
    failureReason: null
  }
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetSampleTaskMock() {
  sampleSeq = 7101
  samplesByPosition = buildSeed()
  persist()
}
