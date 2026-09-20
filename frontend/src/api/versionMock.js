/**
 * 版本管理（客户端版本）内存 mock（仅 DEV 生效，见 version.js 头注释）。
 * 依据 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md。
 *
 * 【业务规则在这里落地，页面只负责展示】
 * - **状态只有三种**（2026-09-20 负责人拍板）：未发布 / 审核中 / 已发布，与岗位 / 专家 / 技能同一套三态。
 * - **发布和停用都必须走审核**：点【发布】【停用】只是提交申请，版本进入「审核中」并同时写审核中心与我的申请
 *   （经 reviewEnroll，业务类型 VERSION，申请类型 新版本发布 / 停用）；审核通过才真正生效，
 *   驳回 / 撤回则回到提交前的状态（未发布或已发布）。
 * - 状态流转：未发布 →提交发布→ 审核中 →通过→ 已发布 →提交停用→ 审核中 →通过→ 未发布（PRD §八）。
 * - **被顶替的旧版本、停用通过的版本都回到「未发布」**，发布和停用走的审核流程与新版本完全一样（2026-09-20
 *   负责人拍板）：重新启用旧版本**不免审核**。回到未发布时**保留上次发布时间 / 发布人**（有发布时间 = 曾发布过）。
 *   **不做自动回退**：停用最新版本后该终端暂无下发版本；需回退时直接对旧版本发起发布即可（一次审核，无需先停用）。
 * - **版本不可删除**：没有删除功能（2026-09-20 负责人拍板），历史版本一律保留。
 * - 发布申请的申请类型一律记「新版本发布」（每个客户端版本都是一次新版本发布，不区分是否发布过）；停用申请记「停用」。
 * - 同一终端同一时间最多一个「已发布」版本：发布审核通过时，该终端原已发布版本自动回到「未发布」（PRD §五）。
 * - 同一终端同一时间最多一个「审核中」版本（发布审核和停用审核都算，避免审核结果互相打架）。
 * - 停用审核期间该版本**继续下发**（审核期间当前已发布版本继续可用，与其它模块一致），通过后才停止。
 * - **发布不限制版本号高低**：用户端只比对版本号是否一致、不比大小（2026-09-20 负责人拍板），
 *   所以低于当前下发版本的旧版本也能直接发布，审核通过后顶替当前版本 = 回退（PRD §五、§六）。
 * - (终端 + 版本号) 唯一；**仅「从未发布过」的未发布版本可编辑**（2026-09-20 负责人拍板）：审核中锁定，
 *   发布过的版本（含回到未发布的旧版本）内容冻结，如需更正新建更高版本号的版本（PRD §四、§八）。
 * - 新建版本时按终端**自动生成**下一个版本号（getNextVersion），用户可改（PRD §4.1）。
 * - 列表默认排序：待处理（审核中、从未发布过的未发布）置顶，其余按发布时间排序（PRD §3.3）。
 * - 发布人（publishedBy）= 提交发布申请的人的登录用户名（如 xiaomei），发布时间 = 最近一次审核通过生效的时间；
 *   从未发布过的显示「—」（PRD §3.3）。
 * - 往访问审计「管理端操作」写记录（PRD §八）：发布 / 停用**审核通过生效时**各写一条（操作人 = 申请人），
 *   撤回审核中的申请写「撤回」；操作对象 =「终端 + 版本号」，**变更内容一律 = 该版本的更新说明**（2026-09-20 负责人拍板）。
 *   提交审核本身、审核驳回、新版本生效引起的旧版本自动回到未发布不单独记；规则报错（校验不通过）时不写。
 * - 供其它模块调用的接口：applyVersionReviewResult（审核中心通过 / 驳回落地）、withdrawVersion（撤回，
 *   我的申请也走它）、getVersion（审核 / 申请详情按 refId 取当前配置）。
 *
 * 【版本包上传是示意】demo 不真实存储文件：uploadVersionPackage 只按文件名 / 大小模拟进度，
 * 并生成一个假的 SHA-256。为了能演示「上传失败」态，文件名含 `fail` 的文件会模拟网络中断。
 * 真实后端需在「点保存前」把上传文件当临时文件，取消 / 关闭抽屉时清理（PRD §4.2「落库时机」）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowIsoLocal } from '@/utils/datetime'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { appendOpsRecord } from './accessAuditMock'
// 审核接线公共件：一次调用同时写 / 摘 审核中心行 + 我的申请行（各业务模块统一走它，见其头注释）
import { enrollReview, unenrollReview, reviewActionMatches } from './reviewEnroll'
import {
  VERSION_STATUS,
  normalizeVersion,
  suggestNextVersion,
  terminalLabel
} from '@/utils/versionMeta'

const { UNPUBLISHED, PENDING_REVIEW, PUBLISHED } = VERSION_STATUS

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))
const err = (message, field = null) => new ApiError({ code: 40000, message, field })

/** 假 SHA-256：由种子字符串生成 64 位十六进制（仅演示，不是真实摘要）。 */
function fakeSha256(seed) {
  let h = 2166136261
  let out = ''
  for (let i = 0; out.length < 64; i++) {
    for (const ch of `${seed}#${i}`) {
      h ^= ch.charCodeAt(0)
      h = Math.imul(h, 16777619) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

/* ---------------- 种子 ---------------- */
// Windows：v1.2.0 下发中，v1.3.0 从未发布（可直接演示提交发布审核）；
// Mac：v1.1.0 下发中，v1.2.0「审核中」（审核中心与我的申请各有一条同一笔待审行，可直接演示审核通过 / 驳回 / 撤回）。
// 已被顶替的旧版本（Windows v1.0.0 / v1.1.0、Mac v1.0.0）是「未发布」态，但保留上次发布时间 / 发布人（内容冻结不可编辑）。
// 审核中的种子须与 reviewsMock / myApplicationsMock 种子逐字段一致，由 govSeedRefIntegrity 护栏守着。
function seedRows() {
  return [
    {
      id: 1, terminal: 'WINDOWS', version: 'v1.0.0', packageName: 'iWorker-Setup-1.0.0.exe', packageSize: 82314240,
      sha256: fakeSha256('win-1.0.0'), status: UNPUBLISHED,
      releaseNotes: '首个正式版本：\n1. 支持岗位对话与技能调用\n2. 支持知识库检索\n3. 支持定时任务',
      publishedAt: '2026-06-20T10:00:00+08:00', publishedBy: 'zhang.wei',
      createdAt: '2026-06-19T16:20:00+08:00', updatedAt: '2026-07-18T10:05:00+08:00'
    },
    {
      id: 2, terminal: 'WINDOWS', version: 'v1.1.0', packageName: 'iWorker-Setup-1.1.0.exe', packageSize: 86104064,
      sha256: fakeSha256('win-1.1.0'), status: UNPUBLISHED,
      releaseNotes: '新增技能市场；优化长对话滚动体验。',
      publishedAt: '2026-07-18T10:00:00+08:00', publishedBy: 'zhang.wei',
      createdAt: '2026-07-17T15:40:00+08:00', updatedAt: '2026-08-20T10:30:00+08:00'
    },
    {
      id: 3, terminal: 'WINDOWS', version: 'v1.2.0', packageName: 'iWorker-Setup-1.2.0.exe', packageSize: 90596966,
      sha256: fakeSha256('win-1.2.0'), status: PUBLISHED,
      releaseNotes: '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知\n3. 修复长对话滚动偶尔跳到顶部的问题',
      publishedAt: '2026-08-20T10:30:00+08:00', publishedBy: 'li.na',
      createdAt: '2026-08-19T17:10:00+08:00', updatedAt: '2026-08-20T10:30:00+08:00'
    },
    {
      id: 4, terminal: 'WINDOWS', version: 'v1.3.0', packageName: 'iWorker-Setup-1.3.0.exe', packageSize: 92274688,
      sha256: fakeSha256('win-1.3.0'), status: UNPUBLISHED,
      releaseNotes: '新增记忆管理；技能市场支持记住上次筛选条件。',
      publishedAt: null, publishedBy: null,
      createdAt: '2026-09-18T14:20:00+08:00', updatedAt: '2026-09-18T14:20:00+08:00'
    },
    {
      id: 5, terminal: 'MAC', version: 'v1.0.0', packageName: 'iWorker-1.0.0.dmg', packageSize: 96468992,
      sha256: fakeSha256('mac-1.0.0'), status: UNPUBLISHED,
      releaseNotes: '首个正式版本（Mac）：支持岗位对话、技能调用与知识库检索。',
      publishedAt: '2026-06-20T10:10:00+08:00', publishedBy: 'zhang.wei',
      createdAt: '2026-06-19T16:30:00+08:00', updatedAt: '2026-08-20T10:32:00+08:00'
    },
    {
      id: 6, terminal: 'MAC', version: 'v1.1.0', packageName: 'iWorker-1.1.0.dmg', packageSize: 99614720,
      sha256: fakeSha256('mac-1.1.0'), status: PUBLISHED,
      releaseNotes: '与 Windows 端同步：引用来源一键复制、任务完成桌面通知。',
      publishedAt: '2026-08-20T10:32:00+08:00', publishedBy: 'li.na',
      createdAt: '2026-08-19T17:30:00+08:00', updatedAt: '2026-08-20T10:32:00+08:00'
    },
    {
      id: 7, terminal: 'MAC', version: 'v1.2.0', packageName: 'iWorker-1.2.0.dmg', packageSize: 101711872,
      sha256: fakeSha256('mac-1.2.0'), status: PENDING_REVIEW,
      releaseNotes: '新增记忆管理；修复深色模式下部分弹窗文字看不清的问题。',
      publishedAt: null, publishedBy: null,
      // 审核中：提交前是「未发布」（驳回 / 撤回后回到这里）；发布申请的申请类型一律「新版本发布」
      pendingAction: 'PUBLISH', requestAction: 'VERSION_PUBLISH', submittedBy: 'li.na', submittedAt: '2026-09-19T16:30:00+08:00',
      prev: { status: UNPUBLISHED },
      createdAt: '2026-09-18T14:35:00+08:00', updatedAt: '2026-09-19T16:30:00+08:00'
    }
  ]
}

let versions = seedRows()
let seq = 8

// version 1（2026-09-20 首版）；version 2：发布人由姓名改为登录用户名；version 3：发布改走审核，
// 行结构增 审核中状态 / pendingAction / requestAction / submittedBy / submittedAt / prev；
// version 5（2026-09-20）：状态收成三态（去掉「已停用」）、停用也走审核、去掉删除、旧版本回到「未发布」时保留发布信息
// （行结构去掉 stoppedAt，prev 只记提交前状态），旧快照弃用回种子。快照结构 / 种子口径变了记得 +1。
const persist = attachPersist('version', {
  version: 5,
  snapshot: () => ({ seq, versions }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.seq) || !Array.isArray(d.versions)) {
      throw new Error('version 快照形状不合法')
    }
    seq = d.seq
    versions = d.versions
  }
})

/** 测试专用：重置内存态。 */
export function resetVersionMock() {
  versions = seedRows()
  seq = 8
}

const find = (id) => versions.find((v) => String(v.id) === String(id))
/** 线上下发中的版本：已发布；停用审核期间它虽是「审核中」，但仍在下发（审核期间当前已发布版本继续可用）。 */
const isLive = (v) => v.status === PUBLISHED || (v.status === PENDING_REVIEW && v.prev?.status === PUBLISHED)
const liveOf = (terminal) => versions.find((v) => v.terminal === terminal && isLive(v))
const pendingReviewOf = (terminal) => versions.find((v) => v.terminal === terminal && v.status === PENDING_REVIEW)
/** 曾发布过（有发布时间）的版本内容冻结：不可编辑。 */
const everPublished = (v) => !!v.publishedAt
/** 版本对象名：终端 + 版本号（审核行 / 申请行 / 访问审计操作对象 / getVersion.name 同口径）。 */
const objectName = (row) => `${terminalLabel(row.terminal)} ${row.version}`
/** 更新说明压成一行，作审核行 / 申请行的对象描述。 */
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim()

/* ---------------- 查询 ---------------- */

/**
 * 列表。params: { keyword?, terminal?, status?, sortDir?('asc'|'desc'), page?, size? } → { list, total }
 * 关键字匹配「终端 + 版本号」（如 Windows v1.2.0，访问审计【查看】按操作对象名称跳过来时注入的就是它）与更新说明。
 * 排序：待处理（审核中、从未发布过的未发布）始终置顶（按最近更新倒序），其余按发布时间排序，默认倒序。
 */
export async function listVersions(params = {}) {
  await delay()
  const q = String(params.keyword || '').trim().toLowerCase()
  const rows = versions.filter(
    (v) =>
      (!params.terminal || v.terminal === params.terminal) &&
      (!params.status || v.status === params.status) &&
      (!q || [`${terminalLabel(v.terminal)} ${v.version}`, v.releaseNotes].some((s) => String(s).toLowerCase().includes(q)))
  )
  const dir = params.sortDir === 'asc' ? 1 : -1
  const byTime = (a, b) => dir * String(a.publishedAt).localeCompare(String(b.publishedAt))
  const isTodo = (v) => v.status === PENDING_REVIEW || (v.status === UNPUBLISHED && !everPublished(v))
  const todos = rows.filter(isTodo).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const others = rows.filter((v) => !isTodo(v)).sort(byTime)
  const sorted = [...todos, ...others]
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: clone(sorted.slice((page - 1) * size, page * size)), total: sorted.length }
}

/**
 * 按 id 取单条（审核中心 / 我的申请点【查看】时按 refId 取当前配置，读的是版本自身，无快照）。
 * 附 name（= 终端 + 版本号，与审核行 / 申请行 / 访问审计操作对象同口径）与统一的 pendingAction，
 * 形状对齐其它业务模块的 getter（govSeedRefIntegrity 护栏按 name / pendingAction 核对）。
 */
export async function getVersion(id) {
  await delay(80)
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  return clone({ ...row, name: objectName(row), pendingAction: row.status === PENDING_REVIEW ? row.pendingAction : null })
}

/**
 * 新建版本时按终端自动生成的版本号（utils/versionMeta.suggestNextVersion：该终端已有最大版本号的次版本位 +1，
 * 没有任何版本则 v1.0.0）。只是预填，用户可改；唯一性等校验仍以保存时为准。
 */
export async function getNextVersion(terminal) {
  await delay(60)
  return suggestNextVersion(versions.filter((v) => v.terminal === terminal).map((v) => v.version))
}

/** 概览条：各终端当前下发的版本（含停用审核期间仍在下发的），无则 null。 */
export async function getVersionOverview() {
  await delay(120)
  return clone({ WINDOWS: liveOf('WINDOWS') || null, MAC: liveOf('MAC') || null })
}

/* ---------------- 版本包上传（示意） ---------------- */

/**
 * 模拟上传：按 ~900ms 推进度；signal 中止时以 AbortError 拒绝；文件名含 `fail` 模拟失败。
 * 成功返回版本包描述 { packageId, fileName, fileSize, sha256 }，保存版本时随表单一并提交。
 */
export function uploadVersionPackage(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    let pct = 0
    const abort = () => {
      clearInterval(timer)
      reject(Object.assign(new Error('上传已取消'), { name: 'AbortError' }))
    }
    const timer = setInterval(() => {
      pct += 10
      onProgress?.(Math.min(pct, 100))
      if (/fail/i.test(file.name) && pct >= 50) {
        clearInterval(timer)
        signal?.removeEventListener('abort', abort)
        reject(err('网络中断，上传失败'))
        return
      }
      if (pct >= 100) {
        clearInterval(timer)
        signal?.removeEventListener('abort', abort)
        resolve({
          packageId: `pkg_${Date.now()}`,
          fileName: file.name,
          fileSize: file.size,
          sha256: fakeSha256(`${file.name}:${file.size}:${file.lastModified || 0}`)
        })
      }
    }, 90)
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/* ---------------- 增改删 ---------------- */

/** 校验并规范化表单（新建 / 编辑共用）。version 重复时按字段回传，供抽屉就地标红。 */
function checkPayload(payload, selfId = null) {
  const terminal = payload.terminal
  if (!terminal) throw err('请选择终端', 'terminal')
  const version = normalizeVersion(payload.version)
  if (!version) throw err('版本号格式应为 X.Y.Z，如 v1.2.0', 'version')
  if (versions.some((v) => v.terminal === terminal && v.version === version && v.id !== selfId)) {
    throw err(`该终端下已存在版本 ${version}`, 'version')
  }
  if (!payload.package?.fileName) throw err('请上传版本包', 'package')
  if (!String(payload.releaseNotes || '').trim()) throw err('请填写更新说明', 'releaseNotes')
  return { terminal, version }
}

function applyFields(row, payload, { terminal, version }) {
  row.terminal = terminal
  row.version = version
  row.packageName = payload.package.fileName
  row.packageSize = payload.package.fileSize
  row.sha256 = payload.package.sha256
  row.releaseNotes = payload.releaseNotes
  row.updatedAt = nowIsoLocal()
}

/** 新建（状态恒为「未发布」）。payload: { terminal, version, releaseNotes, package:{fileName,fileSize,sha256} } */
export async function createVersion(payload) {
  await delay()
  const key = checkPayload(payload)
  const now = nowIsoLocal()
  const row = {
    id: seq++, status: UNPUBLISHED, publishedAt: null, publishedBy: null, createdAt: now
  }
  applyFields(row, payload, key)
  versions.push(row)
  persist()
  return clone(row)
}

/** 编辑：仅「从未发布过」的未发布版本可改（审核中锁定需先撤回；发布过的内容冻结），终端不可改。 */
export async function updateVersion(id, payload) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status === PENDING_REVIEW) throw err('审核中，已锁定不可修改。可先撤回申请后继续编辑')
  if (row.status !== UNPUBLISHED || everPublished(row)) {
    throw err('曾发布过的版本不可编辑，如需更正请新建更高版本号的版本')
  }
  const key = checkPayload({ ...payload, terminal: row.terminal }, row.id)
  applyFields(row, payload, key)
  persist()
  return clone(row)
}

/* ---------------- 发布 / 停用（提交审核）与撤回 ---------------- */

/** 往访问审计「管理端操作」写一条版本管理记录：变更内容一律取该版本的更新说明（发布 / 停用 / 撤回同）。 */
function auditVersionOp(row, action, operator = currentDemoUsername()) {
  appendOpsRecord({ operator, module: '版本管理', action, target: objectName(row), detail: row.releaseNotes })
}

/** 提交审核前的通用校验：版本存在、该终端没有别的版本在审核中。 */
function assertNoOtherPending(row) {
  const other = pendingReviewOf(row.terminal)
  if (other && other.id !== row.id) {
    throw err(`${terminalLabel(row.terminal)} 已有版本 ${other.version} 在审核中，请等待审核结果或先撤回后再提交`)
  }
}

/** 进入审核中：记下提交前状态与申请信息。 */
function enterReview(row, { pendingAction, requestAction }) {
  const now = nowIsoLocal()
  row.prev = { status: row.status }
  row.status = PENDING_REVIEW
  row.pendingAction = pendingAction
  row.requestAction = requestAction
  row.submittedBy = currentDemoUsername()
  row.submittedAt = now
  row.updatedAt = now
}

/** 清掉审核中标记，恢复提交前的状态（撤回 / 驳回共用）。 */
function restoreBeforeReview(row) {
  row.status = row.prev?.status || UNPUBLISHED
  row.pendingAction = null
  row.requestAction = null
  row.submittedBy = null
  row.submittedAt = null
  row.prev = null
}

/** 回到「未发布」：被新版本顶替 / 停用审核通过。保留上次发布时间 / 发布人（有发布时间 = 曾发布过，内容冻结）。 */
function backToUnpublished(row, now) {
  restoreBeforeReview(row)
  row.status = UNPUBLISHED
  row.updatedAt = now
}

/**
 * 发布（提交发布审核）：**不会直接生效**。校验通过后版本进入「审核中」，同时写审核中心与我的申请各一行
 * （业务类型 VERSION，申请类型一律「新版本发布」）。审核结果由审核中心经 applyVersionReviewResult 落地。
 * 曾发布过又回到未发布的旧版本重新发布**同样要走审核**，与新版本没有区别。
 */
export async function publishVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status === PUBLISHED) throw err('该版本已发布')
  if (row.status === PENDING_REVIEW) throw err('该版本已提交审核，请等待审核结果或先撤回')
  assertNoOtherPending(row)
  const requestAction = 'VERSION_PUBLISH'
  enterReview(row, { pendingAction: 'PUBLISH', requestAction })
  persist()
  enrollReview({
    businessType: 'VERSION',
    refId: row.id,
    name: objectName(row),
    description: oneLine(row.releaseNotes),
    requestAction,
    version: row.version,
    versionNotes: row.releaseNotes,
    submitter: row.submittedBy
  })
  return clone(row)
}

/**
 * 停用（提交停用审核）：**同样不会直接生效**。仅「已发布」的版本可提交；审核期间该版本继续下发，
 * 审核通过后才回到「未发布」、该终端暂无下发版本；**不自动回退到上一个版本**（回退 = 对旧版本重新发布，走发布审核）。
 */
export async function stopVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status !== PUBLISHED) throw err('仅已发布版本可停用')
  assertNoOtherPending(row)
  enterReview(row, { pendingAction: 'STOP', requestAction: 'DELIST' })
  persist()
  enrollReview({
    businessType: 'VERSION',
    refId: row.id,
    name: objectName(row),
    description: oneLine(row.releaseNotes),
    requestAction: 'DELIST',
    version: row.version,
    versionNotes: '申请停用该版本，停用后该终端暂无下发版本。',
    submitter: row.submittedBy
  })
  return clone(row)
}

/**
 * 撤回审核中的申请（发布申请或停用申请）：版本回到提交前的状态（未发布 / 已发布），
 * 审核中心行摘掉、我的申请行置「已撤回」，访问审计记一条「撤回」。我的申请页的【撤回】也走这里。
 */
export async function withdrawVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status !== PENDING_REVIEW) throw err('该版本当前没有审核中的申请')
  restoreBeforeReview(row)
  row.updatedAt = nowIsoLocal()
  persist()
  unenrollReview('VERSION', row.id)
  auditVersionOp(row, '撤回')
  return clone(row)
}

/**
 * 审核结论落地（审核中心 reviewsMock 经 LOADERS 调用；同步返回 boolean，false = 对不上，审核行保持待审）：
 * - 发布通过：该终端原下发版本自动回到「未发布」（保留上次发布信息），本版本变「已发布」，发布人 = 申请人，
 *   发布时间 = 通过时间，访问审计记一条「发布」（操作人 = 发布人，变更内容 = 更新说明）。
 * - 停用通过：本版本回到「未发布」（保留上次发布信息），该终端暂无下发版本，
 *   访问审计记一条「停用」（操作人 = 申请人，变更内容 = 该版本的更新说明）。
 * - 驳回：回到提交前的状态（发布申请 → 未发布；停用申请 → 仍是已发布、继续下发），不写审计。
 * 对不上的情形：版本已不在审核中（已撤回 / 已处理）、申请类型与在途事项不同向。
 */
export function applyVersionReviewResult(refId, requestAction, approved) {
  const row = find(refId)
  if (!row || row.status !== PENDING_REVIEW) return false
  if (requestAction && !reviewActionMatches(requestAction, row.pendingAction)) return false
  const now = nowIsoLocal()
  if (!approved) {
    restoreBeforeReview(row)
    row.updatedAt = now
    persist()
    return true
  }
  const submitter = row.submittedBy
  if (row.pendingAction === 'STOP') {
    backToUnpublished(row, now)
    persist()
    auditVersionOp(row, '停用', submitter)
    return true
  }
  const live = liveOf(row.terminal)
  if (live) backToUnpublished(live, now)
  restoreBeforeReview(row)
  row.status = PUBLISHED
  row.publishedAt = now
  row.publishedBy = submitter
  row.updatedAt = now
  persist()
  auditVersionOp(row, '发布', submitter)
  return true
}
