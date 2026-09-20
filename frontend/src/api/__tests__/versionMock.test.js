// @vitest-environment jsdom
// （versionMock → request.js 链路触达 window，故用 jsdom；同 adminUserMock.test）
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as versionApi from '../versionMock'
import {
  listVersions,
  getVersion,
  getNextVersion,
  getVersionOverview,
  uploadVersionPackage,
  createVersion,
  updateVersion,
  publishVersion,
  stopVersion,
  withdrawVersion,
  applyVersionReviewResult,
  resetVersionMock
} from '../versionMock'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'
import { listReviews, approveReview, rejectReview, resetReviewsMock } from '../reviewsMock'
import { listMyApplications, resetMyApplicationsMock } from '../myApplicationsMock'
import { fmtMinute } from '@/utils/datetime'

/**
 * versionMock 业务规则单测。依据 prd.版本管理.md（2026-09-20 负责人拍板的规则）：
 * - 状态只有三种：未发布 / 审核中 / 已发布；**发布和停用都走审核**（提交 → 审核中 → 通过 / 驳回 / 撤回）；
 * - 被顶替 / 停用通过的旧版本回到「未发布」（保留上次发布信息），重新启用旧版本不免审核，**不做自动回退**；
 * - 仅「从未发布过」的未发布版本可编辑；**版本不可删除**；
 * - 同终端唯一已发布 / 唯一审核中；**发布不限制版本号高低**（用户端只比对是否一致）；发布人为登录用户名；新建时自动生成版本号；
 * - 访问审计写记录（发布 / 停用审核通过时、撤回时），变更内容一律为版本的更新说明。
 * 种子：Windows v1.2.0 / Mac v1.1.0 已发布；Windows v1.0.0 / v1.1.0、Mac v1.0.0 是被顶替回到未发布的旧版本（发布过）；
 * Windows v1.3.0（id 4）从未发布；Mac v1.2.0（id 7）发布审核中（审核中心 id 13、我的申请 id 518 同一笔）。
 */

const pkg = { fileName: 'iWorker-Setup-1.4.0.exe', fileSize: 1024, sha256: 'a'.repeat(64) }
const draft = (over = {}) => ({ terminal: 'WINDOWS', version: 'v1.4.0', releaseNotes: '说明', package: pkg, ...over })
const WIN_OLD = 2 // Windows v1.1.0：被顶替回到未发布（发布过）
const WIN_LIVE = 3 // Windows v1.2.0：已发布
const WIN_NEW = 4 // Windows v1.3.0：从未发布
const MAC_LIVE = 6 // Mac v1.1.0：已发布
const MAC_PENDING = 7 // Mac v1.2.0：发布审核中
const WIN_LIVE_NOTES = '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知\n3. 修复长对话滚动偶尔跳到顶部的问题'

beforeEach(() => {
  resetVersionMock()
  resetAccessAuditMock()
  resetReviewsMock()
  resetMyApplicationsMock()
})
const liveOps = () => opsRecords.filter((r) => r.live)
/** 以指定登录用户名执行（落盘身份里的 username），执行完清掉。 */
const asUser = (username, fn) => {
  localStorage.setItem('ai_assistant_user', JSON.stringify({ name: `姓名-${username}`, username }))
  return Promise.resolve(fn()).finally(() => localStorage.clear())
}
const reviewRowOf = async (refId) =>
  (await listReviews({ size: 50 })).list.find((r) => r.type === 'VERSION' && String(r.refId) === String(refId))
const appRowsOf = async (refId) =>
  (await listMyApplications({ size: 50 })).list.filter((r) => r.businessType === 'VERSION' && String(r.refId) === String(refId))
/** 提交发布审核并在审核中心通过。 */
const publishAndApprove = async (id) => {
  await publishVersion(id)
  await approveReview((await reviewRowOf(id)).id)
}
/** 提交停用审核并在审核中心通过。 */
const stopAndApprove = async (id) => {
  await stopVersion(id)
  await approveReview((await reviewRowOf(id)).id)
}

describe('列表与概览', () => {
  it('默认排序：待处理（审核中、从未发布过的未发布）置顶，其余按发布时间倒序；升序只翻转非待处理记录', async () => {
    const { list, total } = await listVersions()
    expect(total).toBe(7)
    expect(list.slice(0, 2).map((v) => v.id).sort()).toEqual([WIN_NEW, MAC_PENDING])
    const rest = list.slice(2).map((v) => v.publishedAt)
    expect(rest).toEqual([...rest].sort().reverse())

    const asc = await listVersions({ sortDir: 'asc' })
    expect(asc.list.slice(0, 2).map((v) => v.id).sort()).toEqual([WIN_NEW, MAC_PENDING])
    const ascRest = asc.list.slice(2).map((v) => v.publishedAt)
    expect(ascRest).toEqual([...ascRest].sort())
  })

  it('筛选：终端 / 状态（三种）/ 关键字（版本号或更新说明）可组合', async () => {
    expect((await listVersions({ terminal: 'MAC' })).total).toBe(3)
    expect((await listVersions({ status: 'PUBLISHED' })).total).toBe(2)
    expect((await listVersions({ status: 'PENDING_REVIEW' })).list.map((v) => v.id)).toEqual([MAC_PENDING])
    expect((await listVersions({ status: 'UNPUBLISHED' })).list.map((v) => v.id).sort()).toEqual([1, 2, 4, 5])
    expect((await listVersions({ terminal: 'WINDOWS', status: 'UNPUBLISHED' })).total).toBe(3)
    expect((await listVersions({ keyword: 'v1.2' })).list.map((v) => v.version)).toContain('v1.2.0')
    expect((await listVersions({ keyword: '桌面通知' })).total).toBeGreaterThan(0)
    expect((await listVersions({ keyword: '不存在的内容' })).total).toBe(0)
  })

  it('关键字匹配「终端 + 版本号」：访问审计【查看】按操作对象名称（如 Windows v1.2.0）跳过来，只应命中那一行', async () => {
    const hit = await listVersions({ keyword: 'Windows v1.2.0' })
    expect(hit.list.map((v) => `${v.terminal} ${v.version}`)).toEqual(['WINDOWS v1.2.0'])
    expect((await listVersions({ keyword: 'mac v1.1.0' })).list.map((v) => v.id)).toEqual([MAC_LIVE])
  })

  it('分页：page/size 切片，total 为筛选后总数', async () => {
    const p1 = await listVersions({ page: 1, size: 3 })
    const p3 = await listVersions({ page: 3, size: 3 })
    expect(p1.list).toHaveLength(3)
    expect(p3.list).toHaveLength(1)
    expect(p1.total).toBe(7)
  })

  it('概览条：各终端当前下发的版本，发布审核中的不算；无下发版本为 null', async () => {
    const ov = await getVersionOverview()
    expect(ov.WINDOWS.version).toBe('v1.2.0')
    expect(ov.MAC.version).toBe('v1.1.0') // Mac v1.2.0 还在审核，不是下发版本
    await stopAndApprove(WIN_LIVE)
    expect((await getVersionOverview()).WINDOWS).toBeNull()
  })

  it('getVersion：按 id 取单条，附 name（终端 + 版本号）与统一的 pendingAction（审核中才有）', async () => {
    expect(await getVersion(MAC_PENDING)).toMatchObject({ name: 'Mac v1.2.0', pendingAction: 'PUBLISH', status: 'PENDING_REVIEW' })
    expect(await getVersion(WIN_LIVE)).toMatchObject({ name: 'Windows v1.2.0', pendingAction: null })
    await expect(getVersion(9999)).rejects.toMatchObject({ message: '版本不存在或已被删除' })
  })
})

describe('自动生成版本号（PRD §4.1）', () => {
  it('按终端取已有最大版本号，次版本位 +1：Windows 最大 v1.3.0 → v1.4.0；Mac 最大 v1.2.0 → v1.3.0', async () => {
    expect(await getNextVersion('WINDOWS')).toBe('v1.4.0')
    expect(await getNextVersion('MAC')).toBe('v1.3.0')
  })

  it('该终端没有任何版本 → v1.0.0', async () => {
    expect(await getNextVersion('LINUX')).toBe('v1.0.0')
  })

  it('新建后再取，基于新的最大版本号；生成的版本号直接可保存（不与已有重号）', async () => {
    const next = await getNextVersion('WINDOWS')
    await createVersion(draft({ version: next }))
    expect(await getNextVersion('WINDOWS')).toBe('v1.5.0')
    await createVersion(draft({ version: 'v1.9.0' })) // 用户手改成更高的版本号
    expect(await getNextVersion('WINDOWS')).toBe('v1.10.0')
  })

  it('审核中的版本也计入最大版本号（不会生成与审核中版本重号的结果）', async () => {
    // Mac 的最大版本号 v1.2.0 正在审核中，下一个是 v1.3.0
    expect(await getNextVersion('MAC')).toBe('v1.3.0')
  })
})

describe('新建与编辑（PRD §四 / §八）', () => {
  it('新建：状态恒为未发布；版本号规范为 vX.Y.Z；带上版本包信息；无发布信息', async () => {
    const row = await createVersion(draft({ version: '1.4.0' }))
    expect(row).toMatchObject({ status: 'UNPUBLISHED', version: 'v1.4.0', packageName: pkg.fileName, publishedAt: null, publishedBy: null })
    expect((await listVersions()).total).toBe(8)
  })

  it('(终端 + 版本号) 唯一：同终端重复按 version 字段报错，不同终端可同号', async () => {
    await expect(createVersion(draft({ version: 'v1.2.0' }))).rejects.toMatchObject({
      field: 'version',
      message: '该终端下已存在版本 v1.2.0'
    })
    await expect(createVersion(draft({ terminal: 'MAC', version: 'v1.3.0' }))).resolves.toBeTruthy()
  })

  it('必填与格式：终端 / 版本号 / 版本包 / 更新说明缺一不可', async () => {
    await expect(createVersion(draft({ terminal: '' }))).rejects.toMatchObject({ field: 'terminal', message: '请选择终端' })
    await expect(createVersion(draft({ version: '1.2' }))).rejects.toMatchObject({
      field: 'version',
      message: '版本号格式应为 X.Y.Z，如 v1.2.0'
    })
    await expect(createVersion(draft({ package: null }))).rejects.toMatchObject({ field: 'package', message: '请上传版本包' })
    await expect(createVersion(draft({ releaseNotes: '   ' }))).rejects.toMatchObject({
      field: 'releaseNotes',
      message: '请填写更新说明'
    })
  })

  it('编辑：从未发布过的未发布版本可改，终端不可改；改版本号同样校验唯一（排除自身）', async () => {
    const edited = await updateVersion(WIN_NEW, draft({ terminal: 'MAC', version: 'v1.3.1' })) // 传 MAC 也应被忽略
    expect(edited).toMatchObject({ terminal: 'WINDOWS', version: 'v1.3.1' })
    await expect(updateVersion(WIN_NEW, draft({ version: 'v1.3.1' }))).resolves.toBeTruthy()
    await expect(updateVersion(WIN_NEW, draft({ version: 'v1.2.0' }))).rejects.toMatchObject({ field: 'version' })
  })

  it('已发布过的版本不可编辑：已发布的、被顶替回到未发布的旧版本都一样', async () => {
    const msg = '曾发布过的版本不可编辑，如需更正请新建更高版本号的版本'
    await expect(updateVersion(WIN_LIVE, draft())).rejects.toMatchObject({ message: msg })
    await expect(updateVersion(WIN_OLD, draft())).rejects.toMatchObject({ message: msg })
  })

  it('审核中锁定：不可编辑，提示先撤回；撤回后（从未发布过）可继续编辑', async () => {
    await expect(updateVersion(MAC_PENDING, draft({ terminal: 'MAC', version: 'v1.2.9' }))).rejects.toMatchObject({
      message: '审核中，已锁定不可修改。可先撤回申请后继续编辑'
    })
    await withdrawVersion(MAC_PENDING)
    await expect(updateVersion(MAC_PENDING, draft({ terminal: 'MAC', version: 'v1.2.9', package: { ...pkg, fileName: 'x.dmg' } }))).resolves.toBeTruthy()
  })

  it('版本不可删除：没有删除接口（2026-09-20 负责人拍板）', () => {
    expect(versionApi).not.toHaveProperty('deleteVersion')
  })
})

describe('发布 = 提交发布审核，不直接生效（PRD §五）', () => {
  it('提交后版本进入「审核中」，记下申请人与申请时间、提交前状态；线上下发版本不变（此时还没生效）', async () => {
    const row = await asUser('xiaomei', () => publishVersion(WIN_NEW)) // Windows v1.3.0 > 当前 v1.2.0
    expect(row).toMatchObject({
      status: 'PENDING_REVIEW',
      publishedAt: null,
      pendingAction: 'PUBLISH',
      requestAction: 'VERSION_PUBLISH',
      submittedBy: 'xiaomei',
      prev: { status: 'UNPUBLISHED' }
    })
    expect(row.submittedAt).toBeTruthy()
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0') // 仍是老版本在下发
    expect((await getVersion(WIN_LIVE)).status).toBe('PUBLISHED') // 老版本也没被顶替
  })

  it('同时写审核中心与我的申请各一行：业务类型 VERSION，申请类型「新版本发布」，对象名 = 终端 + 版本号，描述 = 更新说明压成一行', async () => {
    await updateVersion(WIN_NEW, draft({ version: 'v1.3.0', releaseNotes: '第一行\n第二行' }))
    await asUser('xiaomei', () => publishVersion(WIN_NEW))
    expect(await reviewRowOf(WIN_NEW)).toMatchObject({
      status: 'PENDING_REVIEW',
      name: 'Windows v1.3.0',
      description: '第一行 第二行',
      requestAction: 'VERSION_PUBLISH',
      version: 'v1.3.0',
      submitterName: 'xiaomei'
    })
    const apps = await appRowsOf(WIN_NEW)
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({
      objectName: 'Windows v1.3.0',
      businessType: 'VERSION',
      applicationType: 'VERSION_PUBLISH',
      version: 'v1.3.0',
      result: 'PENDING',
      submitter: 'xiaomei',
      versionNotes: '第一行\n第二行'
    })
  })

  it('提交审核本身不写访问审计', async () => {
    await publishVersion(WIN_NEW)
    expect(liveOps()).toHaveLength(0)
  })

  it('同一终端同一时间只能有一个版本在审核：Mac 已有 v1.2.0 在审，再提交 Mac 的别的版本被拦', async () => {
    const other = await createVersion(draft({ terminal: 'MAC', version: 'v1.5.0', package: { ...pkg, fileName: 'x.dmg' } }))
    await expect(publishVersion(other.id)).rejects.toMatchObject({
      message: 'Mac 已有版本 v1.2.0 在审核中，请等待审核结果或先撤回后再提交'
    })
    expect((await getVersion(other.id)).status).toBe('UNPUBLISHED')
    expect(await reviewRowOf(other.id)).toBeUndefined()
  })

  it('已在审 / 已发布的版本不能重复提交发布', async () => {
    await expect(publishVersion(MAC_PENDING)).rejects.toMatchObject({ message: '该版本已提交审核，请等待审核结果或先撤回' })
    await expect(publishVersion(WIN_LIVE)).rejects.toMatchObject({ message: '该版本已发布' })
  })

  it('发布不限制版本号高低：低于当前下发版本的新建版本、被顶替的旧版本都能直接提交发布审核（用户端只比对是否一致，不比大小）', async () => {
    const low = await createVersion(draft({ version: 'v1.1.5' })) // 低于线上 v1.2.0
    expect(await publishVersion(low.id)).toMatchObject({ status: 'PENDING_REVIEW', requestAction: 'VERSION_PUBLISH' })
    await withdrawVersion(low.id)
    expect(await publishVersion(WIN_OLD)).toMatchObject({ status: 'PENDING_REVIEW', prev: { status: 'UNPUBLISHED' } }) // 旧版本 v1.1.0
    expect(await reviewRowOf(WIN_OLD)).toMatchObject({ name: 'Windows v1.1.0', requestAction: 'VERSION_PUBLISH' })
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0') // 审核通过前线上不变
  })

  it('重新启用旧版本不免审核：先停用当前版本（停用审核通过），再对旧版本提交发布，进入审核中，申请类型仍是「新版本发布」', async () => {
    await stopAndApprove(WIN_LIVE)
    const row = await publishVersion(WIN_OLD) // 旧版本 v1.1.0，此时该终端无下发版本
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', requestAction: 'VERSION_PUBLISH', prev: { status: 'UNPUBLISHED' } })
    expect((await getVersionOverview()).WINDOWS).toBeNull() // 审核通过前仍是无下发版本
    expect(await reviewRowOf(WIN_OLD)).toMatchObject({ name: 'Windows v1.1.0', requestAction: 'VERSION_PUBLISH' })
  })
})

describe('停用 = 提交停用审核，同样不直接生效（PRD §六）', () => {
  it('提交后版本进入「审核中」（申请类型 DELIST）；审核期间该版本继续下发，概览条不变', async () => {
    const row = await asUser('xiaomei', () => stopVersion(WIN_LIVE))
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', pendingAction: 'STOP', requestAction: 'DELIST', submittedBy: 'xiaomei', prev: { status: 'PUBLISHED' } })
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0') // 审核期间仍在下发
    expect(liveOps()).toHaveLength(0) // 提交时不写审计
  })

  it('审核中心与我的申请各写一行：申请类型「停用」，申请版本为该版本号', async () => {
    await asUser('xiaomei', () => stopVersion(WIN_LIVE))
    expect(await reviewRowOf(WIN_LIVE)).toMatchObject({ name: 'Windows v1.2.0', requestAction: 'DELIST', version: 'v1.2.0', submitterName: 'xiaomei' })
    const apps = await appRowsOf(WIN_LIVE)
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ businessType: 'VERSION', applicationType: 'DELIST', result: 'PENDING', submitter: 'xiaomei' })
  })

  it('仅已发布的版本可提交停用（未发布 / 审核中都不行）', async () => {
    await expect(stopVersion(WIN_NEW)).rejects.toMatchObject({ message: '仅已发布版本可停用' })
    await expect(stopVersion(MAC_PENDING)).rejects.toMatchObject({ message: '仅已发布版本可停用' })
    await expect(stopVersion(9999)).rejects.toMatchObject({ message: '版本不存在或已被删除' })
  })

  it('同一终端有版本在审核中时（发布审核或停用审核都算），不能再提交停用 / 发布', async () => {
    // Mac v1.2.0 发布审核中 → Mac 已发布的 v1.1.0 不能提交停用
    await expect(stopVersion(MAC_LIVE)).rejects.toMatchObject({ message: 'Mac 已有版本 v1.2.0 在审核中，请等待审核结果或先撤回后再提交' })
    // Windows v1.2.0 停用审核中 → Windows v1.3.0 不能提交发布
    await stopVersion(WIN_LIVE)
    await expect(publishVersion(WIN_NEW)).rejects.toMatchObject({ message: 'Windows 已有版本 v1.2.0 在审核中，请等待审核结果或先撤回后再提交' })
  })

  it('停用审核通过：版本回到「未发布」（保留上次发布信息），该终端暂无下发版本；**不自动回退**到上一个版本', async () => {
    await stopAndApprove(WIN_LIVE)
    const row = await getVersion(WIN_LIVE)
    expect(row).toMatchObject({ status: 'UNPUBLISHED', publishedBy: 'li.na', pendingAction: null, prev: null })
    expect(row.publishedAt).toBeTruthy() // 保留上次发布时间 → 仍视为发布过，内容冻结
    expect((await getVersionOverview()).WINDOWS).toBeNull()
    // 上一个版本 v1.1.0 没有被自动顶上来
    expect((await getVersion(WIN_OLD)).status).toBe('UNPUBLISHED')
    expect((await listVersions({ terminal: 'WINDOWS', status: 'PUBLISHED' })).total).toBe(0)
    expect((await appRowsOf(WIN_LIVE))[0]).toMatchObject({ result: 'APPROVED' })
  })

  it('停用审核被驳回：版本仍是「已发布」、继续下发；申请行「已驳回」带原因', async () => {
    await stopVersion(WIN_LIVE)
    await rejectReview((await reviewRowOf(WIN_LIVE)).id, '暂不停用')
    expect(await getVersion(WIN_LIVE)).toMatchObject({ status: 'PUBLISHED', pendingAction: null })
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0')
    expect((await appRowsOf(WIN_LIVE))[0]).toMatchObject({ result: 'REJECTED', rejectReason: '暂不停用' })
    expect(liveOps()).toHaveLength(0) // 驳回不写审计
  })
})

describe('撤回审核中的申请', () => {
  it('发布申请撤回：版本回到未发布，审核中心行被摘掉、我的申请行置「已撤回」', async () => {
    const row = await withdrawVersion(MAC_PENDING)
    expect(row).toMatchObject({ status: 'UNPUBLISHED', pendingAction: null, submittedBy: null, prev: null })
    expect(await reviewRowOf(MAC_PENDING)).toBeUndefined()
    const apps = await appRowsOf(MAC_PENDING)
    expect(apps.map((a) => a.result)).toEqual(['WITHDRAWN'])
    expect(apps[0].reviewer).toBe('—')
  })

  it('停用申请撤回：版本回到已发布、继续下发', async () => {
    await stopVersion(WIN_LIVE)
    const row = await withdrawVersion(WIN_LIVE)
    expect(row.status).toBe('PUBLISHED')
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0')
    expect(await reviewRowOf(WIN_LIVE)).toBeUndefined()
    expect((await appRowsOf(WIN_LIVE))[0]).toMatchObject({ result: 'WITHDRAWN' })
  })

  it('撤回后可重新提交（生成新的待审申请，原申请行保留为历史）', async () => {
    await withdrawVersion(MAC_PENDING)
    await publishVersion(MAC_PENDING)
    expect((await appRowsOf(MAC_PENDING)).map((a) => a.result).sort()).toEqual(['PENDING', 'WITHDRAWN'])
  })

  it('重新启用的旧版本（发布过）提交后被撤回：回到未发布，上次发布信息不变', async () => {
    await stopAndApprove(WIN_LIVE)
    const before = await getVersion(WIN_OLD)
    await publishVersion(WIN_OLD)
    const back = await withdrawVersion(WIN_OLD)
    expect(back).toMatchObject({ status: 'UNPUBLISHED', publishedAt: before.publishedAt, publishedBy: before.publishedBy })
  })

  it('撤回写一条访问审计「撤回」，变更内容为该版本的更新说明；不在审核中的版本不可撤回', async () => {
    await withdrawVersion(MAC_PENDING)
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({
      module: '版本管理',
      action: '撤回',
      target: 'Mac v1.2.0',
      detail: '新增记忆管理；修复深色模式下部分弹窗文字看不清的问题。'
    })
    await expect(withdrawVersion(WIN_LIVE)).rejects.toMatchObject({ message: '该版本当前没有审核中的申请' })
    await expect(withdrawVersion(9999)).rejects.toMatchObject({ message: '版本不存在或已被删除' })
  })
})

describe('发布审核结论落地（经审核中心 approveReview / rejectReview）', () => {
  it('通过：版本变「已发布」，发布人 = 申请人、发布时间 = 通过时间；该终端原下发版本自动回到「未发布」（保留上次发布信息）；两张表行同步', async () => {
    await approveReview(13) // 审核中心种子行：Mac v1.2.0，申请人 li.na
    const row = await getVersion(MAC_PENDING)
    expect(row).toMatchObject({ status: 'PUBLISHED', publishedBy: 'li.na', pendingAction: null, submittedBy: null })
    expect(row.publishedAt).toBeTruthy()
    const old = await getVersion(MAC_LIVE) // Mac v1.1.0 被顶替
    expect(old).toMatchObject({ status: 'UNPUBLISHED', publishedBy: 'li.na' })
    expect(old.publishedAt).toBe('2026-08-20T10:32:00+08:00') // 上次发布时间原样保留
    expect((await getVersionOverview()).MAC.version).toBe('v1.2.0')
    expect(await reviewRowOf(MAC_PENDING)).toBeUndefined() // 离开待审列表
    expect((await appRowsOf(MAC_PENDING))[0]).toMatchObject({ result: 'APPROVED' })
  })

  it('通过后同终端始终只有一个已发布版本，另一终端不受影响', async () => {
    await publishAndApprove(WIN_NEW)
    const win = (await listVersions({ terminal: 'WINDOWS', size: 50 })).list
    expect(win.filter((v) => v.status === 'PUBLISHED').map((v) => v.version)).toEqual(['v1.3.0'])
    expect(win.find((v) => v.version === 'v1.2.0').status).toBe('UNPUBLISHED')
    expect((await getVersionOverview()).MAC.version).toBe('v1.1.0')
  })

  it('发布人是「提交申请的人」，不是审核人：xiaomei 提交、demo 审核 → 发布人 xiaomei', async () => {
    await asUser('xiaomei', () => publishVersion(WIN_NEW))
    await approveReview((await reviewRowOf(WIN_NEW)).id) // 审核人取当前 demo 身份（无落盘身份 → 演示管理员）
    expect((await getVersion(WIN_NEW)).publishedBy).toBe('xiaomei')
  })

  it('驳回：版本回到未发布，线上版本不受影响；申请行「已驳回」并带驳回原因', async () => {
    await rejectReview(13, '更新说明不完整')
    expect(await getVersion(MAC_PENDING)).toMatchObject({ status: 'UNPUBLISHED', pendingAction: null, submittedBy: null, prev: null })
    expect((await getVersionOverview()).MAC.version).toBe('v1.1.0')
    expect(await reviewRowOf(MAC_PENDING)).toBeUndefined()
    expect((await appRowsOf(MAC_PENDING))[0]).toMatchObject({ result: 'REJECTED', rejectReason: '更新说明不完整' })
  })

  it('驳回后可【前往修改】再重新提交（我的申请重新提交走 publishVersion，生成新的待审申请）', async () => {
    await rejectReview(13, '更新说明不完整')
    await publishVersion(MAC_PENDING)
    expect((await getVersion(MAC_PENDING)).status).toBe('PENDING_REVIEW')
    expect((await appRowsOf(MAC_PENDING)).map((a) => a.result).sort()).toEqual(['PENDING', 'REJECTED'])
  })

  it('回退一步到位：直接对旧版本发布，一次审核通过后顶替当前版本（无需先停用），当前版本回到「未发布」', async () => {
    await publishAndApprove(WIN_NEW) // v1.3.0 上线，v1.2.0 回到未发布
    await publishAndApprove(WIN_LIVE) // 发现问题：直接发布 v1.2.0（低于线上 v1.3.0）
    expect(await getVersion(WIN_LIVE)).toMatchObject({ status: 'PUBLISHED' })
    expect(await getVersion(WIN_NEW)).toMatchObject({ status: 'UNPUBLISHED', publishedBy: 'demo' }) // 被顶替，保留发布信息
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0')
  })

  it('回退也可以分两步：停用最新版本并通过后，对上一个版本提交发布审核，通过后才恢复下发', async () => {
    await publishAndApprove(WIN_NEW) // v1.3.0 上线，v1.2.0 回到未发布
    await stopAndApprove(WIN_NEW) // 发现问题，停用 v1.3.0：此时无下发版本，不自动回退
    expect((await getVersionOverview()).WINDOWS).toBeNull()
    await publishAndApprove(WIN_LIVE) // 重新启用 v1.2.0：走一遍发布审核
    expect(await getVersion(WIN_LIVE)).toMatchObject({ status: 'PUBLISHED' })
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0')
  })

  it('落地接口对不上时返回 false：版本不在审核中 / 申请类型与在途事项不同向', async () => {
    expect(applyVersionReviewResult(WIN_NEW, 'VERSION_PUBLISH', true)).toBe(false) // 未发布，不在审核中
    expect(applyVersionReviewResult(9999, 'VERSION_PUBLISH', true)).toBe(false)
    expect(applyVersionReviewResult(MAC_PENDING, 'DELIST', true)).toBe(false) // 发布事项收到停用结论
    await stopVersion(WIN_LIVE)
    expect(applyVersionReviewResult(WIN_LIVE, 'VERSION_PUBLISH', true)).toBe(false) // 停用事项收到发布结论
    expect((await getVersion(MAC_PENDING)).status).toBe('PENDING_REVIEW') // 没被改动
    expect((await getVersion(WIN_LIVE)).status).toBe('PENDING_REVIEW')
  })

  it('审核行与版本脱节（版本已被撤回）时，审核中心通过 → 409，审核行保持待审、不改任何版本', async () => {
    await withdrawVersion(MAC_PENDING) // 撤回会摘掉审核行；重新把一条脱节的行塞回去
    const { submitReviewRow } = await import('../reviewsMock')
    const stale = submitReviewRow({ type: 'VERSION', refId: MAC_PENDING, name: 'Mac v1.2.0', requestAction: 'VERSION_PUBLISH', version: 'v1.2.0' })
    await expect(approveReview(stale.id)).rejects.toMatchObject({ code: 409 })
    expect((await getVersion(MAC_PENDING)).status).toBe('UNPUBLISHED')
    expect((await reviewRowOf(MAC_PENDING)).status).toBe('PENDING_REVIEW')
  })
})

describe('发布人为登录用户名（PRD §3.3）', () => {
  it('种子发布人是用户名（zhang.wei / li.na），不是姓名', async () => {
    const { list } = await listVersions({ size: 50 })
    const withPublisher = list.filter((v) => v.publishedBy)
    expect(withPublisher.map((v) => v.publishedBy).sort()).toEqual(['li.na', 'li.na', 'zhang.wei', 'zhang.wei', 'zhang.wei'])
    for (const v of withPublisher) expect(v.publishedBy).toMatch(/^[a-z]+(\.[a-z]+)?$/)
  })

  it('无落盘身份时，自己提交并通过的版本发布人回落到内置演示管理员的用户名 demo', async () => {
    await publishAndApprove(WIN_NEW)
    expect((await getVersion(WIN_NEW)).publishedBy).toBe('demo')
  })
})

describe('写访问审计「管理端操作」（PRD §八 审计 / prd.访问审计.md §6.2）', () => {
  it('发布审核通过生效时写一条「发布」：模块「版本管理」、操作对象「终端 + 版本号」、变更内容 = 更新说明、操作人 = 发布人（申请人）', async () => {
    await asUser('xiaomei', () => publishVersion(WIN_NEW)) // Windows v1.3.0
    expect(liveOps()).toHaveLength(0) // 提交时不写
    await approveReview((await reviewRowOf(WIN_NEW)).id) // 审核人是 demo，但操作人记发布人
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({
      operator: 'xiaomei',
      module: '版本管理',
      action: '发布',
      target: 'Windows v1.3.0',
      detail: '新增记忆管理；技能市场支持记住上次筛选条件。'
    })
  })

  it('停用审核通过生效时写一条「停用」，变更内容同样是该版本的更新说明，操作人 = 申请人', async () => {
    await asUser('xiaomei', () => stopVersion(WIN_LIVE))
    await approveReview((await reviewRowOf(WIN_LIVE)).id)
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ operator: 'xiaomei', module: '版本管理', action: '停用', target: 'Windows v1.2.0', detail: WIN_LIVE_NOTES })
  })

  it('版本管理的记录（发布 / 停用 / 撤回）变更内容一律是更新说明，不为空', async () => {
    await publishAndApprove(WIN_NEW)
    await stopAndApprove(WIN_NEW)
    await withdrawVersion(MAC_PENDING)
    expect(liveOps().map((r) => r.action)).toEqual(['撤回', '停用', '发布'])
    for (const r of liveOps()) expect(r.detail).toBeTruthy()
  })

  it('新版本生效引起的旧版本被顶替不单独记「停用」', async () => {
    await approveReview(13)
    expect(liveOps().map((r) => `${r.action} ${r.target}`)).toEqual(['发布 Mac v1.2.0'])
  })

  it('审核驳回不写记录', async () => {
    await rejectReview(13, '不通过')
    expect(liveOps()).toHaveLength(0)
  })

  it('规则报错（同终端已有审核中 / 未发布不可停用 / 已发布不可重复提交）时不写记录', async () => {
    const other = await createVersion(draft({ terminal: 'MAC', version: 'v1.5.0', package: { ...pkg, fileName: 'x.dmg' } }))
    await expect(publishVersion(other.id)).rejects.toBeTruthy() // Mac v1.2.0 在审
    await expect(stopVersion(WIN_NEW)).rejects.toBeTruthy()
    await expect(publishVersion(WIN_LIVE)).rejects.toBeTruthy()
    expect(liveOps()).toHaveLength(0)
  })

  it('新建 / 编辑不写记录', async () => {
    const row = await createVersion(draft({ version: 'v1.5.0' }))
    await updateVersion(row.id, draft({ version: 'v1.5.1' }))
    expect(liveOps()).toHaveLength(0)
  })

  it('回退全程按时间倒序可追溯：发布 v1.3.0 → 停用 v1.3.0 → 重新发布 v1.2.0', async () => {
    await publishAndApprove(WIN_NEW)
    await stopAndApprove(WIN_NEW)
    await publishAndApprove(WIN_LIVE)
    expect(liveOps().map((r) => `${r.action} ${r.target}`)).toEqual(['发布 Windows v1.2.0', '停用 Windows v1.3.0', '发布 Windows v1.3.0'])
  })
})

describe('审计种子与版本种子一致（防两份手写种子漂移）', () => {
  it('每个有发布时间（发布过）的种子版本，在访问审计里都有一条同时间 / 同操作人 / 同更新说明的「发布」记录，且无多余记录', async () => {
    const { list } = await listVersions({ size: 50 })
    const published = list.filter((v) => v.publishedAt)
    const seeds = opsRecords.filter((r) => r.module === '版本管理' && !r.live)
    expect(seeds).toHaveLength(published.length)
    for (const v of published) {
      const target = `${v.terminal === 'MAC' ? 'Mac' : 'Windows'} ${v.version}`
      const rec = seeds.find((r) => r.target === target)
      expect(rec, target).toBeTruthy()
      expect(rec).toMatchObject({ action: '发布', operator: v.publishedBy, time: fmtMinute(v.publishedAt), detail: v.releaseNotes })
    }
  })
})

describe('版本包上传（示意）', () => {
  it('成功：回调进度 0→100，返回版本包描述（含 64 位十六进制校验值）', async () => {
    vi.useFakeTimers()
    const progress = []
    const p = uploadVersionPackage({ name: 'x.exe', size: 2048 }, { onProgress: (n) => progress.push(n) })
    await vi.advanceTimersByTimeAsync(1000)
    const res = await p
    vi.useRealTimers()
    expect(progress.at(-1)).toBe(100)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(res).toMatchObject({ fileName: 'x.exe', fileSize: 2048 })
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('文件名含 fail 模拟网络中断（演示上传失败态）', async () => {
    vi.useFakeTimers()
    const p = uploadVersionPackage({ name: 'will-fail.exe', size: 2048 })
    const assertion = expect(p).rejects.toMatchObject({ message: '网络中断，上传失败' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    vi.useRealTimers()
  })

  it('中止：以 AbortError 拒绝，不再回调进度', async () => {
    vi.useFakeTimers()
    const ctl = new AbortController()
    const progress = vi.fn()
    const p = uploadVersionPackage({ name: 'x.exe', size: 2048 }, { onProgress: progress, signal: ctl.signal })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(200)
    const calls = progress.mock.calls.length
    ctl.abort()
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    vi.useRealTimers()
    expect(progress.mock.calls.length).toBe(calls)
  })

  it('不限制大小：GB 级文件照常上传成功（2026-09-20 负责人拍板）', async () => {
    vi.useFakeTimers()
    const p = uploadVersionPackage({ name: 'big.exe', size: 8 * 1024 ** 3 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toMatchObject({ fileName: 'big.exe', fileSize: 8 * 1024 ** 3 })
    vi.useRealTimers()
  })
})
