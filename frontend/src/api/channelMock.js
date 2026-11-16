/**
 * 渠道开发期 mock（04运行 › 渠道，对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md）。
 *
 * 三块数据：机器人（第三、四章）、群（第五章）、消息设置（第三章 6，消息合并等待时长，2026-11-16 由「配额与限流」迁来）。
 * 平台差异、字段校验、权限清单都在 utils/channelMeta.js（PRD 第一章 6「平台描述配置」），本文件只管数据与规则。
 *
 * 【种子】（参照产品给的参考原型）
 *  - 飞书「iWorker 助手」：正常，长连接，4 个群；
 *  - 钉钉「iWorker 助手」：连接中断 · AppSecret 已失效（系统检测，操作记录里有「连接中断」）；1 个群；
 *  - 企业微信：未接入（新建机器人时只有它可选；每平台上限 N=1，见 DEPLOY.botsPerPlatform）。
 *
 * 【演示约定】（真实环境由平台接口返回，这里按密钥内容模拟，不区分大小写）
 *  - 密钥含 bad 或 wrong → 凭据验证失败「凭据验证失败：平台返回 invalid credentials」；
 *  - 密钥含 other → 「凭据属于另一个{平台}组织，与本企业不一致，员工身份无法复用」；
 *  - 密钥含 noperm → 凭据通过，但保存后的自动检测发现缺少必需权限（如钉钉 Card.Instance.Write），
 *    状态变为「连接中断 · 缺少必需权限」——用于演示 PRD 评审补充「缺少必需权限」的列表与编辑提示；
 *    例：编辑钉钉机器人，AppSecret 填 noperm-1234567890abcd 保存。
 *  - 其余 16–128 位不含空格的密钥都验证通过；HTTP 回调【检测校验】总是通过。
 *  - 新建、更换应用成功后状态为「待平台发布」；演示环境没有「平台已发布」的回调，需要正常状态可看飞书种子。
 *
 * 【访问审计】（PRD 第十章）写「管理端操作」，模块「渠道」：新建 / 编辑 / 停用 / 启用 / 更换应用 / 移出群 / 修改配置。
 * 系统检测到的状态变化（连接中断、恢复正常）只写机器人自己的操作记录，不进访问审计。
 * 密钥不落 mock（保存后不回显），只记「已配置」。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUserName, currentDemoUsername } from '@/utils/demoIdentity'
import { nowMinuteText } from '@/utils/datetime'
import {
  PLATFORMS,
  PLATFORM_KEYS,
  DEPLOY,
  LIMIT_TEXT,
  platformName,
  connLabel,
  isSecretDown,
  botNameError,
  orgError,
  appKeyError,
  secretError,
  simulateVerify,
  simulateMissingPerm,
  BOT_DESC_MAX,
  BOT_NAME_MAX,
  MERGE_WAIT_DEFAULT_SEC,
  MERGE_WAIT_LABEL,
  mergeWaitInputError,
  mergeWaitChangeText
} from '@/utils/channelMeta'

/** 模拟网络耗时的倍率：页面演示用 1；用例可调成 0 加快执行（__setChannelMockLatency） */
let latency = 1
const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms * latency))
/** 验证凭据 / 检测校验模拟平台往返，比普通请求慢一些，能看到「验证中…」 */
const VERIFY_MS = 500

const clone = (o) => JSON.parse(JSON.stringify(o))

/** 员工能力三行的数字（第四章 5.1；示例企业 32,580 人，已分配岗位 28,750 人） */
const CAPABILITY = { positionUserCount: 28750, builtinSkillCount: 18, builtinConnectorCount: 6 }

const log = (time, operator, action, detail = '') => ({ time, operator, action, detail })

function seedBots() {
  return [
    {
      id: 'bot-feishu',
      ch: 'feishu',
      org: PLATFORMS.feishu.demoOrg,
      name: 'iWorker 助手',
      desc: '飞书上的统一入口',
      appKey: 'cli_a1b2c3d4e5f6',
      conn: 'ws',
      httpConfigured: false,
      status: 'NORMAL',
      downReason: null,
      statusBeforeStop: null,
      createdAt: '2026-06-10 09:30',
      updatedAt: '2026-09-12 16:20',
      logs: [
        log('2026-09-12 16:20', '王芳', '修改配置', '用途说明：— → 飞书上的统一入口'),
        log('2026-07-02 10:05', '王芳', '修改配置', 'App Secret 已更新'),
        log('2026-06-10 09:30', '王芳', '创建机器人')
      ]
    },
    {
      id: 'bot-dingtalk',
      ch: 'dingtalk',
      org: PLATFORMS.dingtalk.demoOrg,
      name: 'iWorker 助手',
      desc: '钉钉上的统一入口',
      appKey: 'dingzxa8k2m3n4b5v6c7',
      conn: 'ws',
      httpConfigured: false,
      status: 'DOWN',
      downReason: { kind: 'SECRET' },
      statusBeforeStop: null,
      createdAt: '2026-05-20 14:12',
      updatedAt: '2026-09-10 11:05',
      logs: [
        log('2026-09-14 22:03', '系统', '连接中断', 'AppSecret 失效，平台返回 invalid app secret'),
        log('2026-09-10 11:05', '李娜', '修改配置', '用途说明：— → 钉钉上的统一入口'),
        log('2026-05-20 14:12', '李娜', '创建机器人')
      ]
    }
  ]
}

function seedGroups() {
  const g = (id, name, ch, by, joinedAt, members, updatedAt) => ({ id, name, ch, by, joinedAt, members, updatedAt, removedAt: null })
  return [
    g('g1', '华东MES项目群', 'feishu', '刘敏', '2026-08-02 10:12', 18, '2026-09-08 14:30'),
    g('g2', '销售华东区', 'feishu', '陈杰', '2026-07-21 09:40', 24, '2026-09-01 11:02'),
    g('g3', '新能源事业部周会', 'feishu', '吴强', '2026-09-14 10:12', 9, '2026-09-14 10:12'),
    g('g5', '生产一厂日报群', 'feishu', '张浩', '2026-05-20 08:30', 31, '2026-08-26 09:10'),
    g('g6', '精密事业部周会', 'dingtalk', '王磊', '2026-06-03 16:00', 14, '2026-06-03 16:05')
  ]
}

let bots = seedBots()
let groups = seedGroups()
let mergeWaitSec = MERGE_WAIT_DEFAULT_SEC
let botSeq = 1
/** 新写入的记录排最前：同一分钟内多次更新时按写入先后排（不然新建的可能排到同分钟的老记录后面） */
let touchSeq = 0

// v1（2026-11-16）：首次接入持久化——机器人、群、消息合并等待时长（后者由已删除的 quotaThrottle 模块迁来，
// 旧 key「quotaThrottle」里存的值不再读取，演示环境回到出厂 5 秒）。
const persist = attachPersist('channel', {
  version: 1,
  snapshot: () => ({ bots, groups, mergeWaitSec, botSeq }),
  restore: (data) => {
    if (!Array.isArray(data?.bots) || !Array.isArray(data?.groups) || !Number.isInteger(data?.mergeWaitSec)) {
      throw new Error('channel 快照形状不合法')
    }
    bots = data.bots
    groups = data.groups
    mergeWaitSec = data.mergeWaitSec
    botSeq = Number.isInteger(data.botSeq) ? data.botSeq : 1
    touchSeq = Math.max(0, ...bots.map((b) => b.touched || 0))
  }
})

/* ---------------- 内部工具 ---------------- */

const notFound = () => new ApiError({ code: 40400, message: '机器人信息已变化' })
const fieldError = (field, message) => new ApiError({ code: 40000, message, field })

function findBot(id) {
  const b = bots.find((x) => x.id === id)
  if (!b) throw notFound()
  return b
}
const liveGroups = () => groups.filter((g) => !g.removedAt)
const groupCountOf = (ch) => liveGroups().filter((g) => g.ch === ch).length
const botsOf = (ch) => bots.filter((b) => b.ch === ch)
const isPlatformFull = (ch) => botsOf(ch).length >= DEPLOY.botsPerPlatform

function touch(bot) {
  bot.updatedAt = nowMinuteText()
  bot.touched = ++touchSeq
}

function addBotLog(bot, action, detail = '', operator = currentDemoUserName()) {
  bot.logs.unshift(log(nowMinuteText(), operator, action, detail))
}

function audit(action, target, detail = '') {
  appendOpsRecord({ operator: currentDemoUsername(), module: '渠道', action, target, detail })
}

/** 列表行 VO：不带操作记录与密钥 */
function toRow(b) {
  return {
    id: b.id,
    ch: b.ch,
    org: b.org,
    name: b.name,
    desc: b.desc,
    appKey: b.appKey,
    conn: b.conn,
    status: b.status,
    downReason: b.downReason ? clone(b.downReason) : null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    groupCount: groupCountOf(b.ch)
  }
}

const sortByUpdated = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || (b.touched || 0) - (a.touched || 0)

/* ---------------- 机器人 · 查询 ---------------- */

/**
 * 机器人列表（第三章 1、2）：搜索名称或用途说明（忽略前后空格、部分匹配）、按渠道、状态筛选；不分页；按最近更新倒序。
 */
export async function listBots({ keyword = '', ch = '', status = '' } = {}) {
  await delay()
  const kw = String(keyword).trim()
  const list = bots
    .filter((b) => (!kw || b.name.includes(kw) || b.desc.includes(kw)) && (!ch || b.ch === ch) && (!status || b.status === status))
    .sort(sortByUpdated)
    .map(toRow)
  return { list, total: list.length }
}

/** 底部汇总：「N 个机器人 · 已接入 N / M 个 IM 平台」，M 为已启用平台数 */
export async function getBotSummary() {
  await delay(60)
  return { botCount: bots.length, platformCount: new Set(bots.map((b) => b.ch)).size, platformTotal: PLATFORM_KEYS.length }
}

/** 各平台占用情况：新建抽屉的渠道卡片置灰、【+ 新建机器人】置灰都看它 */
export async function getPlatformSlots() {
  await delay(60)
  return PLATFORM_KEYS.map((ch) => ({ ch, full: isPlatformFull(ch), botName: botsOf(ch)[0]?.name || '' }))
}

/** 机器人详情：查看 / 编辑抽屉用；操作记录只给最近 5 条（完整记录在访问审计） */
export async function getBot(id) {
  await delay(200)
  const b = findBot(id)
  return { ...toRow(b), httpConfigured: b.httpConfigured, logs: clone(b.logs.slice(0, 5)), capability: { ...CAPABILITY } }
}

/* ---------------- 机器人 · 校验 ---------------- */

/** 应用标识唯一性：不能和其他机器人（含其他平台）重复 */
function assertAppKeyUnique(ch, appKey, exceptId) {
  if (bots.some((b) => b.id !== exceptId && b.appKey === appKey)) {
    throw fieldError('appKey', `该 ${PLATFORMS[ch].key.label} 已被其他机器人使用`)
  }
}

/** 平台往返：凭据有效、所属组织与本企业一致；返回所属组织 */
function verifyWithPlatform(ch, secret, org) {
  const reason = simulateVerify(ch, secret)
  if (reason) throw fieldError('secret', reason)
  return PLATFORMS[ch].org.needInput ? `corpId ${org}` : PLATFORMS[ch].demoOrg
}

/** HTTP 回调字段（首次切换为 HTTP 时必填），以及回调地址须检测校验通过 */
function assertHttpReady(ch, http = {}, callbackChecked) {
  for (const f of PLATFORMS[ch].httpFields) {
    if (!String(http[f.key] ?? '').trim()) throw fieldError(`http.${f.key}`, `请填写 ${f.label}`)
  }
  if (!callbackChecked) throw fieldError('callback', '请先在平台保存回调地址并完成校验')
}

/**
 * 【验证凭据】（第四章 3）：可选的提前验证。
 * @param {{ ch:string, org?:string, appKey?:string, secret:string, botId?:string }} p 编辑态传 botId，应用标识取当前值
 * @returns {Promise<{ org:string }>} 所属组织
 */
export async function verifyBotCredentials(p) {
  await delay(VERIFY_MS)
  const bot = p.botId ? findBot(p.botId) : null
  const ch = bot ? bot.ch : p.ch
  if (!bot) {
    const e = orgError(ch, p.org) || ''
    if (e) throw fieldError('org', e)
    const k = appKeyError(ch, p.appKey)
    if (k) throw fieldError('appKey', k)
  }
  const s = secretError(ch, p.secret)
  if (s) throw fieldError('secret', s)
  return { org: verifyWithPlatform(ch, p.secret, bot ? bot.org : String(p.org ?? '').trim()) }
}

/** HTTP 回调【检测校验】：等待平台发起校验请求（演示环境总是通过） */
export async function checkCallback(ch) {
  await delay(VERIFY_MS)
  return { ok: true, url: `${DEPLOY.callbackBase}/open/im/${ch}/events` }
}

/* ---------------- 机器人 · 写 ---------------- */

/**
 * 新建（第四章 6.1）：校验顺序「必填 → 格式 → 数值范围 → 唯一性 → 平台权限」，页面已先校验一遍，这里兜底；
 * 成功后状态「待平台发布」，排最前；写访问审计「新建」，变更内容「渠道 · 连接方式」。
 */
export async function createBot(p) {
  await delay(p.verified ? 200 : VERIFY_MS)
  const ch = p.ch
  if (!ch || !PLATFORMS[ch]) throw fieldError('ch', '请选择渠道')
  if (isPlatformFull(ch)) throw fieldError('ch', `${platformName(ch)}已达到机器人上限，${LIMIT_TEXT}`)
  const name = String(p.name ?? '').trim()
  const nameErr = botNameError(name) || (name.length > BOT_NAME_MAX ? `机器人名称最多 ${BOT_NAME_MAX} 个字` : '')
  if (nameErr) throw fieldError('name', nameErr)
  const desc = String(p.desc ?? '').trim().slice(0, BOT_DESC_MAX)
  const orgErr = orgError(ch, p.org)
  if (orgErr) throw fieldError('org', orgErr)
  const keyErr = appKeyError(ch, p.appKey)
  if (keyErr) throw fieldError('appKey', keyErr)
  const secErr = secretError(ch, p.secret)
  if (secErr) throw fieldError('secret', secErr)
  const conn = PLATFORMS[ch].conns.some((c) => c.value === p.conn) ? p.conn : PLATFORMS[ch].conns[0].value
  if (conn === 'http') assertHttpReady(ch, p.http, p.callbackChecked)
  const appKey = String(p.appKey).trim()
  assertAppKeyUnique(ch, appKey)
  const org = verifyWithPlatform(ch, p.secret, String(p.org ?? '').trim())

  const now = nowMinuteText()
  const bot = {
    id: `bot-${ch}-${botSeq++}`,
    ch,
    org,
    name,
    desc,
    appKey,
    conn,
    httpConfigured: conn === 'http',
    status: 'PENDING',
    downReason: null,
    statusBeforeStop: null,
    createdAt: now,
    updatedAt: now,
    logs: []
  }
  touch(bot)
  addBotLog(bot, '创建机器人', `${platformName(ch)} · ${connLabel(ch, conn)}`)
  bots.push(bot)
  audit('新建', name, `${platformName(ch)} · ${connLabel(ch, conn)}`)
  persist()
  return toRow(bot)
}

/** 编辑保存的变更摘要（第十章：密钥只记「X 已更新」，不记内容） */
function editSummary(bot, next) {
  const out = []
  if (next.name !== bot.name) out.push(`机器人名称：${bot.name} → ${next.name}`)
  if (next.desc !== bot.desc) out.push(`用途说明：${bot.desc || '—'} → ${next.desc || '—'}`)
  if (next.conn !== bot.conn) out.push(`连接方式：${connLabel(bot.ch, bot.conn)} → ${connLabel(bot.ch, next.conn)}`)
  if (next.secret) out.push(`${PLATFORMS[bot.ch].secret.label} 已更新`)
  for (const f of PLATFORMS[bot.ch].httpFields) {
    if (next.conn === 'http' && bot.conn === 'http' && String(next.http?.[f.key] ?? '').trim()) out.push(`${f.label} 已更新`)
  }
  return out.join('；')
}

/**
 * 编辑保存（第三章 3.3、第四章 6）：可改名称、用途说明、应用密钥（留空不修改）、连接方式。
 * - baseUpdatedAt 与当前不一致 → 并发冲突（code 40900）「机器人已被其他管理员更新」；
 * - 因凭据失效而中断：必须填新密钥；填了新密钥且验证通过 → 恢复正常（演示约定 noperm 见头注）；
 * - 有变化才写访问审计「编辑」并更新最近更新时间。
 */
export async function updateBot(id, p) {
  const bot0 = findBot(id)
  const secret = String(p.secret ?? '').trim()
  await delay(secret && !p.verified ? VERIFY_MS : 200)
  const bot = findBot(id)
  if (bot !== bot0 || (p.baseUpdatedAt && p.baseUpdatedAt !== bot.updatedAt)) {
    throw new ApiError({ code: 40900, message: '机器人已被其他管理员更新' })
  }
  const ch = bot.ch
  const name = String(p.name ?? '').trim()
  const nameErr = botNameError(name)
  if (nameErr) throw fieldError('name', nameErr)
  const desc = String(p.desc ?? '').trim().slice(0, BOT_DESC_MAX)
  if (!secret && isSecretDown(bot)) throw fieldError('secret', `连接已中断，请填写新的 ${PLATFORMS[ch].secret.label}`)
  const secErr = secretError(ch, secret, { required: false })
  if (secErr) throw fieldError('secret', secErr)
  const conn = PLATFORMS[ch].conns.some((c) => c.value === p.conn) ? p.conn : bot.conn
  if (conn === 'http' && bot.conn !== 'http') assertHttpReady(ch, p.http, p.callbackChecked)
  if (secret) verifyWithPlatform(ch, secret, bot.org)

  const summary = editSummary(bot, { name, desc, conn, secret, http: p.http })
  if (!summary) return toRow(bot)
  Object.assign(bot, { name, desc, conn, httpConfigured: bot.httpConfigured || conn === 'http' })
  touch(bot)
  addBotLog(bot, '修改配置', summary)
  audit('编辑', name, summary)
  // 保存成功后立即检测一次（第四章 5.2）：系统检测结果只写机器人操作记录
  if (secret) {
    const missing = simulateMissingPerm(ch, secret)
    if (missing.length) {
      bot.status = 'DOWN'
      bot.downReason = { kind: 'PERMISSION', missing }
      addBotLog(bot, '连接中断', `缺少必需权限：${missing.join('、')}`, '系统')
    } else if (isSecretDown(bot)) {
      bot.status = 'NORMAL'
      bot.downReason = null
      addBotLog(bot, '恢复正常', '', '系统')
    }
  }
  persist()
  return toRow(bot)
}

/** 停用（第三章 3.5）：保留全部配置和群关系；启用时回到停用前的连接状态 */
export async function stopBot(id) {
  await delay()
  const bot = findBot(id)
  if (bot.status === 'STOPPED') return toRow(bot)
  bot.statusBeforeStop = bot.status
  bot.status = 'STOPPED'
  touch(bot)
  addBotLog(bot, '停用机器人')
  audit('停用', bot.name)
  persist()
  return toRow(bot)
}

/** 启用：直接生效，系统重新建立连接（演示：回到停用前的状态，连接中断的原因仍在则仍是中断） */
export async function enableBot(id) {
  await delay()
  const bot = findBot(id)
  if (bot.status !== 'STOPPED') return toRow(bot)
  bot.status = bot.statusBeforeStop || 'NORMAL'
  bot.statusBeforeStop = null
  touch(bot)
  addBotLog(bot, '启用机器人')
  audit('启用', bot.name)
  persist()
  return toRow(bot)
}

function checkSwapInput(bot, p) {
  const ch = bot.ch
  const appKey = String(p.appKey ?? '').trim()
  const keyErr = appKeyError(ch, appKey) || (appKey === bot.appKey ? '和当前应用相同，无需更换' : '')
  if (keyErr) throw fieldError('appKey', keyErr)
  const secErr = secretError(ch, p.secret)
  if (secErr) throw fieldError('secret', secErr)
  assertAppKeyUnique(ch, appKey, bot.id)
  verifyWithPlatform(ch, p.secret, bot.org)
  return appKey
}

/** 更换应用 ·【验证新应用】（第四章 3.1）：新应用必须与原组织一致 */
export async function verifySwapApp(id, p) {
  await delay(VERIFY_MS)
  const bot = findBot(id)
  checkSwapInput(bot, p)
  return { org: bot.org }
}

/** 更换应用 · 确认：状态变为「待平台发布」，写访问审计「更换应用」，变更内容「原应用标识 → 新应用标识」 */
export async function swapApp(id, p) {
  await delay()
  const bot = findBot(id)
  const appKey = checkSwapInput(bot, p)
  const old = bot.appKey
  bot.appKey = appKey
  bot.status = 'PENDING'
  bot.downReason = null
  bot.statusBeforeStop = null
  touch(bot)
  addBotLog(bot, '更换应用', `${old} → ${appKey}`)
  audit('更换应用', bot.name, `${old} → ${appKey}`)
  persist()
  return toRow(bot)
}

/* ---------------- 群聊治理 ---------------- */

function toGroupRow(g) {
  const bot = botsOf(g.ch)[0]
  return { ...g, botName: bot?.name || '' }
}

/** 群列表（第五章 1）：搜索群名称或拉入人；按渠道筛选；已移出的不展示；按最近更新倒序 */
export async function listGroups({ keyword = '', ch = '' } = {}) {
  await delay()
  const kw = String(keyword).trim()
  const list = liveGroups()
    .filter((g) => (!kw || g.name.includes(kw) || g.by.includes(kw)) && (!ch || g.ch === ch))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toGroupRow)
  return { list, total: list.length }
}

export async function getGroup(id) {
  await delay()
  const g = liveGroups().find((x) => x.id === id)
  if (!g) throw new ApiError({ code: 40400, message: '群信息已变化' })
  return toGroupRow(g)
}

/** 移出（第五章 2）：机器人退出群，群记录保留 30 天（列表不再展示）；写访问审计「移出群」，对象为群名称 */
export async function removeGroup(id) {
  await delay()
  const g = liveGroups().find((x) => x.id === id)
  if (!g) throw new ApiError({ code: 40400, message: '群信息已变化' })
  g.removedAt = nowMinuteText()
  audit('移出群', g.name)
  persist()
  return { id }
}

/* ---------------- 消息设置（第三章 6） ---------------- */

export async function getMessageSettings() {
  await delay(60)
  return { mergeWaitSec }
}

/**
 * 保存消息合并等待时长。非法值抛 ApiError（field = mergeWaitSec），弹窗就地提示；
 * 值有变化时写访问审计「修改配置」，对象固定「消息合并等待时长」，变更内容「5 秒 → 8 秒」；值没变不写。
 */
export async function saveMessageSettings(value) {
  await delay()
  const message = mergeWaitInputError(value)
  if (message) throw fieldError('mergeWaitSec', message)
  const next = Number(String(value).trim())
  const prev = mergeWaitSec
  if (next !== prev) {
    mergeWaitSec = next
    audit('修改配置', MERGE_WAIT_LABEL, mergeWaitChangeText(prev, next))
    persist()
  }
  return { mergeWaitSec }
}

/** 测试专用：调整模拟耗时倍率（0 = 不等待） */
export function __setChannelMockLatency(factor) {
  latency = factor
}

/** 测试专用：回到种子态 */
export function __resetChannelMock() {
  bots = seedBots()
  groups = seedGroups()
  mergeWaitSec = MERGE_WAIT_DEFAULT_SEC
  botSeq = 1
  touchSeq = 0
  persist()
}
