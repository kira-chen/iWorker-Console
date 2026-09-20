/**
 * 版本管理（客户端版本）内存 mock（仅 DEV 生效，见 version.js 头注释）。
 * 依据 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md。
 *
 * 【业务规则在这里落地，页面只负责展示】
 * - 状态流转：未发布 →发布→ 已发布 →停用→ 已停用 →发布→ 已发布（PRD §八）。
 * - 同一终端同一时间最多一个「已发布」版本：发布新版本时，该终端原已发布版本自动变「已停用」（PRD §五）。
 * - 发布前校验：待发布版本号须**大于**同终端当前已发布版本；同终端无已发布版本时不受限（PRD §五）。
 * - (终端 + 版本号) 唯一；仅「未发布」可编辑 / 删除；曾发布过的版本不可删除（PRD §七、§八）。
 * - 列表默认排序：未发布置顶，其余按发布时间排序（PRD §3.3）。
 * - 发布人（publishedBy）记登录用户名（如 xiaomei），不是姓名（PRD §3.3）。
 * - 发布 / 停用成功后往访问审计「管理端操作」写一条记录（PRD §八）：操作人=当前用户名、模块=版本管理、
 *   操作对象=「终端 + 版本号」（如 Windows v1.2.0）、变更内容=发布时取更新说明、停用为空。
 *   发布新版本引起的旧版本自动停用不单独记；规则报错（校验不通过）时不写。
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
import { VERSION_STATUS, normalizeVersion, compareVersions, terminalLabel } from '@/utils/versionMeta'

const { UNPUBLISHED, PUBLISHED, STOPPED } = VERSION_STATUS

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
// Windows：v1.2.0 下发中，v1.3.0 待发布；Mac：v1.1.0 下发中，v1.2.0 待发布——
// 两个终端各有一条「未发布」，可直接演示发布确认（含「原已发布版本将自动停用」）与版本号校验。
function seedRows() {
  return [
    {
      id: 1, terminal: 'WINDOWS', version: 'v1.0.0', packageName: 'iWorker-Setup-1.0.0.exe', packageSize: 82314240,
      sha256: fakeSha256('win-1.0.0'), status: STOPPED,
      releaseNotes: '首个正式版本：\n1. 支持岗位对话与技能调用\n2. 支持知识库检索\n3. 支持定时任务',
      publishedAt: '2026-06-20T10:00:00+08:00', publishedBy: 'zhang.wei', stoppedAt: '2026-07-18T10:05:00+08:00',
      createdAt: '2026-06-19T16:20:00+08:00', updatedAt: '2026-07-18T10:05:00+08:00'
    },
    {
      id: 2, terminal: 'WINDOWS', version: 'v1.1.0', packageName: 'iWorker-Setup-1.1.0.exe', packageSize: 86104064,
      sha256: fakeSha256('win-1.1.0'), status: STOPPED,
      releaseNotes: '新增技能市场；优化长对话滚动体验。',
      publishedAt: '2026-07-18T10:00:00+08:00', publishedBy: 'zhang.wei', stoppedAt: '2026-08-20T10:30:00+08:00',
      createdAt: '2026-07-17T15:40:00+08:00', updatedAt: '2026-08-20T10:30:00+08:00'
    },
    {
      id: 3, terminal: 'WINDOWS', version: 'v1.2.0', packageName: 'iWorker-Setup-1.2.0.exe', packageSize: 90596966,
      sha256: fakeSha256('win-1.2.0'), status: PUBLISHED,
      releaseNotes: '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知\n3. 修复长对话滚动偶尔跳到顶部的问题',
      publishedAt: '2026-08-20T10:30:00+08:00', publishedBy: 'li.na', stoppedAt: null,
      createdAt: '2026-08-19T17:10:00+08:00', updatedAt: '2026-08-20T10:30:00+08:00'
    },
    {
      id: 4, terminal: 'WINDOWS', version: 'v1.3.0', packageName: 'iWorker-Setup-1.3.0.exe', packageSize: 92274688,
      sha256: fakeSha256('win-1.3.0'), status: UNPUBLISHED,
      releaseNotes: '新增记忆管理；技能市场支持记住上次筛选条件。',
      publishedAt: null, publishedBy: null, stoppedAt: null,
      createdAt: '2026-09-18T14:20:00+08:00', updatedAt: '2026-09-18T14:20:00+08:00'
    },
    {
      id: 5, terminal: 'MAC', version: 'v1.0.0', packageName: 'iWorker-1.0.0.dmg', packageSize: 96468992,
      sha256: fakeSha256('mac-1.0.0'), status: STOPPED,
      releaseNotes: '首个正式版本（Mac）：支持岗位对话、技能调用与知识库检索。',
      publishedAt: '2026-06-20T10:10:00+08:00', publishedBy: 'zhang.wei', stoppedAt: '2026-08-20T10:32:00+08:00',
      createdAt: '2026-06-19T16:30:00+08:00', updatedAt: '2026-08-20T10:32:00+08:00'
    },
    {
      id: 6, terminal: 'MAC', version: 'v1.1.0', packageName: 'iWorker-1.1.0.dmg', packageSize: 99614720,
      sha256: fakeSha256('mac-1.1.0'), status: PUBLISHED,
      releaseNotes: '与 Windows 端同步：引用来源一键复制、任务完成桌面通知。',
      publishedAt: '2026-08-20T10:32:00+08:00', publishedBy: 'li.na', stoppedAt: null,
      createdAt: '2026-08-19T17:30:00+08:00', updatedAt: '2026-08-20T10:32:00+08:00'
    },
    {
      id: 7, terminal: 'MAC', version: 'v1.2.0', packageName: 'iWorker-1.2.0.dmg', packageSize: 101711872,
      sha256: fakeSha256('mac-1.2.0'), status: UNPUBLISHED,
      releaseNotes: '新增记忆管理；修复深色模式下部分弹窗文字看不清的问题。',
      publishedAt: null, publishedBy: null, stoppedAt: null,
      createdAt: '2026-09-18T14:35:00+08:00', updatedAt: '2026-09-18T14:35:00+08:00'
    }
  ]
}

let versions = seedRows()
let seq = 8

// version 1（2026-09-20 首版）；version 2（2026-09-20）：发布人由姓名改为登录用户名，旧快照弃用回种子。
// 快照结构 / 种子口径变了记得 +1。
const persist = attachPersist('version', {
  version: 2,
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
const currentPublished = (terminal) => versions.find((v) => v.terminal === terminal && v.status === PUBLISHED)

/* ---------------- 查询 ---------------- */

/**
 * 列表。params: { keyword?, terminal?, status?, sortDir?('asc'|'desc'), page?, size? } → { list, total }
 * 关键字匹配「终端 + 版本号」（如 Windows v1.2.0，访问审计【查看】按操作对象名称跳过来时注入的就是它）与更新说明。
 * 排序：未发布（无发布时间）始终置顶（按创建时间倒序），其余按发布时间排序，默认倒序。
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
  const drafts = rows.filter((v) => v.status === UNPUBLISHED).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const others = rows.filter((v) => v.status !== UNPUBLISHED).sort(byTime)
  const sorted = [...drafts, ...others]
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: clone(sorted.slice((page - 1) * size, page * size)), total: sorted.length }
}

/** 概览条：各终端当前下发（已发布）的版本，无则 null。 */
export async function getVersionOverview() {
  await delay(120)
  return clone({ WINDOWS: currentPublished('WINDOWS') || null, MAC: currentPublished('MAC') || null })
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
    id: seq++, status: UNPUBLISHED, publishedAt: null, publishedBy: null, stoppedAt: null, createdAt: now
  }
  applyFields(row, payload, key)
  versions.push(row)
  persist()
  return clone(row)
}

/** 编辑：仅「未发布」可改，终端不可改。 */
export async function updateVersion(id, payload) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status !== UNPUBLISHED) throw err('仅未发布版本可编辑')
  const key = checkPayload({ ...payload, terminal: row.terminal }, row.id)
  applyFields(row, payload, key)
  persist()
  return clone(row)
}

/** 往访问审计「管理端操作」写一条版本管理记录（发布带更新说明，停用为空）。 */
function auditVersionOp(row, action, detail = '') {
  appendOpsRecord({
    operator: currentDemoUsername(),
    module: '版本管理',
    action,
    target: `${terminalLabel(row.terminal)} ${row.version}`,
    detail
  })
}

/** 发布 / 重新发布：见头注释的规则。 */
export async function publishVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status === PUBLISHED) throw err('该版本已发布')
  const current = currentPublished(row.terminal)
  if (current && compareVersions(row.version, current.version) <= 0) {
    throw err(`版本号须高于当前已发布版本 ${current.version}`)
  }
  const now = nowIsoLocal()
  if (current) {
    current.status = STOPPED
    current.stoppedAt = now
    current.updatedAt = now
  }
  row.status = PUBLISHED
  row.publishedAt = now
  row.publishedBy = currentDemoUsername()
  row.stoppedAt = null
  row.updatedAt = now
  persist()
  auditVersionOp(row, '发布', row.releaseNotes)
  return clone(row)
}

/** 停用：仅「已发布」可停用。 */
export async function stopVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status !== PUBLISHED) throw err('仅已发布版本可停用')
  const now = nowIsoLocal()
  row.status = STOPPED
  row.stoppedAt = now
  row.updatedAt = now
  persist()
  auditVersionOp(row, '停用')
  return clone(row)
}

/** 删除：仅「未发布」可删；曾发布过的版本保留历史。 */
export async function deleteVersion(id) {
  await delay()
  const row = find(id)
  if (!row) throw err('版本不存在或已被删除')
  if (row.status !== UNPUBLISHED) {
    throw err(`${terminalLabel(row.terminal)} ${row.version} 曾发布过，不可删除`)
  }
  versions = versions.filter((v) => v.id !== row.id)
  persist()
  return true
}
