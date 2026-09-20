// @vitest-environment jsdom
// （versionMock → request.js 链路触达 window，故用 jsdom；同 adminUserMock.test）
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  listVersions,
  getVersionOverview,
  uploadVersionPackage,
  createVersion,
  updateVersion,
  publishVersion,
  stopVersion,
  deleteVersion,
  resetVersionMock
} from '../versionMock'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'
import { fmtMinute } from '@/utils/datetime'

/**
 * versionMock 业务规则单测。依据 prd.版本管理.md：
 * §3.3 默认排序（未发布置顶）、§五 发布规则（同终端唯一已发布 / 须高于当前）、§六 停用与回退、
 * §七 删除限制、§八 唯一性与不可变与「审计」（发布 / 停用写访问审计「管理端操作」）、§3.3 发布人为登录用户名。
 * 种子：Windows v1.2.0 / Mac v1.1.0 已发布，各有一条未发布（id 4 / 7）。
 */

const pkg = { fileName: 'iWorker-Setup-1.4.0.exe', fileSize: 1024, sha256: 'a'.repeat(64) }
const draft = (over = {}) => ({ terminal: 'WINDOWS', version: 'v1.4.0', releaseNotes: '说明', package: pkg, ...over })

beforeEach(() => {
  resetVersionMock()
  resetAccessAuditMock()
})
const liveOps = () => opsRecords.filter((r) => r.live)

describe('列表与概览', () => {
  it('默认排序：未发布置顶，其余按发布时间倒序；升序只翻转非未发布记录', async () => {
    const { list, total } = await listVersions()
    expect(total).toBe(7)
    expect(list.slice(0, 2).every((v) => v.status === 'UNPUBLISHED')).toBe(true)
    const published = list.slice(2).map((v) => v.publishedAt)
    expect(published).toEqual([...published].sort().reverse())

    const asc = await listVersions({ sortDir: 'asc' })
    expect(asc.list.slice(0, 2).every((v) => v.status === 'UNPUBLISHED')).toBe(true)
    const ascTimes = asc.list.slice(2).map((v) => v.publishedAt)
    expect(ascTimes).toEqual([...ascTimes].sort())
  })

  it('筛选：终端 / 状态 / 关键字（版本号或更新说明）可组合', async () => {
    expect((await listVersions({ terminal: 'MAC' })).total).toBe(3)
    expect((await listVersions({ status: 'PUBLISHED' })).total).toBe(2)
    expect((await listVersions({ terminal: 'WINDOWS', status: 'STOPPED' })).total).toBe(2)
    expect((await listVersions({ keyword: 'v1.2' })).list.map((v) => v.version)).toContain('v1.2.0')
    expect((await listVersions({ keyword: '桌面通知' })).total).toBeGreaterThan(0)
    expect((await listVersions({ keyword: '不存在的内容' })).total).toBe(0)
  })

  it('关键字匹配「终端 + 版本号」：访问审计【查看】按操作对象名称（如 Windows v1.2.0）跳过来，只应命中那一行', async () => {
    const hit = await listVersions({ keyword: 'Windows v1.2.0' })
    expect(hit.list.map((v) => `${v.terminal} ${v.version}`)).toEqual(['WINDOWS v1.2.0'])
    expect((await listVersions({ keyword: 'mac v1.1.0' })).list.map((v) => v.id)).toEqual([6])
    // 只写终端名也能筛出该终端的版本
    expect((await listVersions({ keyword: 'windows' })).list.every((v) => v.terminal === 'WINDOWS' || /windows/i.test(v.releaseNotes))).toBe(true)
  })

  it('分页：page/size 切片，total 为筛选后总数', async () => {
    const p1 = await listVersions({ page: 1, size: 3 })
    const p3 = await listVersions({ page: 3, size: 3 })
    expect(p1.list).toHaveLength(3)
    expect(p3.list).toHaveLength(1)
    expect(p1.total).toBe(7)
  })

  it('概览条：各终端当前下发版本；无已发布版本为 null', async () => {
    const ov = await getVersionOverview()
    expect(ov.WINDOWS.version).toBe('v1.2.0')
    expect(ov.MAC.version).toBe('v1.1.0')
    await stopVersion(3)
    expect((await getVersionOverview()).WINDOWS).toBeNull()
  })
})

describe('新建与编辑（PRD §四 / §八）', () => {
  it('新建：状态恒为未发布；版本号规范为 vX.Y.Z；带上版本包信息', async () => {
    const row = await createVersion(draft({ version: '1.4.0' }))
    expect(row).toMatchObject({ status: 'UNPUBLISHED', version: 'v1.4.0', packageName: pkg.fileName, publishedAt: null })
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

  it('编辑：仅未发布可改，终端不可改；改版本号同样校验唯一（排除自身）', async () => {
    const edited = await updateVersion(4, draft({ terminal: 'MAC', version: 'v1.3.1' })) // 传 MAC 也应被忽略
    expect(edited).toMatchObject({ terminal: 'WINDOWS', version: 'v1.3.1' })
    // 保持自身版本号不算重复
    await expect(updateVersion(4, draft({ version: 'v1.3.1' }))).resolves.toBeTruthy()
    // 与同终端其他版本重号
    await expect(updateVersion(4, draft({ version: 'v1.2.0' }))).rejects.toMatchObject({ field: 'version' })
    // 已发布不可编辑（不可变）
    await expect(updateVersion(3, draft())).rejects.toMatchObject({ message: '仅未发布版本可编辑' })
  })
})

describe('发布与停用（PRD §五 / §六）', () => {
  it('发布新版本：该终端原已发布版本自动变已停用，同终端始终只有一个已发布', async () => {
    const row = await publishVersion(4) // Windows v1.3.0 > 当前 v1.2.0
    expect(row).toMatchObject({ status: 'PUBLISHED', publishedBy: expect.any(String) })
    expect(row.publishedAt).toBeTruthy()
    const all = (await listVersions({ terminal: 'WINDOWS' })).list
    expect(all.filter((v) => v.status === 'PUBLISHED').map((v) => v.version)).toEqual(['v1.3.0'])
    expect(all.find((v) => v.version === 'v1.2.0')).toMatchObject({ status: 'STOPPED' })
    expect(all.find((v) => v.version === 'v1.2.0').stoppedAt).toBeTruthy()
    // 另一终端不受影响
    expect((await getVersionOverview()).MAC.version).toBe('v1.1.0')
  })

  it('发布须高于同终端当前已发布版本；不满足不改任何状态', async () => {
    const low = await createVersion(draft({ version: 'v1.1.5' }))
    await expect(publishVersion(low.id)).rejects.toMatchObject({ message: '版本号须高于当前已发布版本 v1.2.0' })
    const high = await createVersion(draft({ version: 'v1.9.0' }))
    await publishVersion(high.id) // 高于则通过
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.9.0')
    // 未变更：低版本仍是未发布
    expect((await listVersions({ keyword: 'v1.1.5' })).list[0].status).toBe('UNPUBLISHED')
  })

  it('不能重复发布已发布版本', async () => {
    await expect(publishVersion(3)).rejects.toMatchObject({ message: '该版本已发布' })
  })

  it('停用：仅已发布可停用；停用后该终端暂无下发版本', async () => {
    await expect(stopVersion(4)).rejects.toMatchObject({ message: '仅已发布版本可停用' })
    const row = await stopVersion(3)
    expect(row.status).toBe('STOPPED')
    expect(row.stoppedAt).toBeTruthy()
    expect((await getVersionOverview()).WINDOWS).toBeNull()
  })

  it('回退：先停用问题版本，再重新发布上一个稳定版本（此时无已发布版本，不受「须高于」限制）', async () => {
    await publishVersion(4) // v1.3.0 上线，v1.2.0 已停用
    await stopVersion(4) // 发现问题，停用 v1.3.0
    const back = await publishVersion(3) // 重新发布 v1.2.0
    expect(back.status).toBe('PUBLISHED')
    expect(back.stoppedAt).toBeNull() // 重新发布清掉停用时间
    expect((await getVersionOverview()).WINDOWS.version).toBe('v1.2.0')
  })
})

describe('删除（PRD §七）', () => {
  it('仅未发布可删；曾发布过的版本（已发布 / 已停用）保留历史', async () => {
    await expect(deleteVersion(4)).resolves.toBe(true)
    expect((await listVersions()).total).toBe(6)
    await expect(deleteVersion(3)).rejects.toMatchObject({ message: expect.stringContaining('不可删除') })
    await expect(deleteVersion(1)).rejects.toMatchObject({ message: expect.stringContaining('不可删除') })
  })

  it('不存在的版本给出明确提示', async () => {
    await expect(deleteVersion(9999)).rejects.toMatchObject({ message: '版本不存在或已被删除' })
    await expect(publishVersion(9999)).rejects.toMatchObject({ message: '版本不存在或已被删除' })
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
})

describe('发布人为登录用户名（PRD §3.3）', () => {
  it('种子发布人是用户名（zhang.wei / li.na），不是姓名', async () => {
    const { list } = await listVersions({ status: 'PUBLISHED' })
    expect(list.map((v) => v.publishedBy).sort()).toEqual(['li.na', 'li.na'])
    const all = (await listVersions({ size: 50 })).list.filter((v) => v.publishedBy)
    for (const v of all) expect(v.publishedBy).toMatch(/^[a-z]+(.[a-z]+)?$/)
  })

  it('新发布的版本，发布人取当前登录用户名（不是姓名）', async () => {
    localStorage.setItem('ai_assistant_user', JSON.stringify({ name: '小美', username: 'xiaomei' }))
    try {
      const row = await publishVersion(4)
      expect(row.publishedBy).toBe('xiaomei')
    } finally {
      localStorage.clear()
    }
  })

  it('无落盘身份时回落到内置演示管理员的用户名 demo', async () => {
    expect((await publishVersion(4)).publishedBy).toBe('demo')
  })
})

describe('写访问审计「管理端操作」（PRD §八 审计 / prd.访问审计.md §6.2）', () => {
  it('发布成功写一条：模块「版本管理」、动作「发布」、操作对象「终端 + 版本号」、变更内容=更新说明、操作人=用户名', async () => {
    localStorage.setItem('ai_assistant_user', JSON.stringify({ name: '小美', username: 'xiaomei' }))
    try {
      await publishVersion(4) // Windows v1.3.0
    } finally {
      localStorage.clear()
    }
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({
      operator: 'xiaomei',
      module: '版本管理',
      action: '发布',
      target: 'Windows v1.3.0',
      detail: '新增记忆管理；技能市场支持记住上次筛选条件。'
    })
  })

  it('停用成功写一条「停用」，变更内容为空', async () => {
    await stopVersion(3) // Windows v1.2.0
    expect(liveOps()).toHaveLength(1)
    expect(liveOps()[0]).toMatchObject({ module: '版本管理', action: '停用', target: 'Windows v1.2.0', detail: '' })
  })

  it('发布新版本引起的旧版本自动停用不单独记一条「停用」，只记这次「发布」', async () => {
    await publishVersion(4) // v1.3.0 上线，v1.2.0 被自动停用
    expect(liveOps().map((r) => `${r.action} ${r.target}`)).toEqual(['发布 Windows v1.3.0'])
  })

  it('规则报错（版本号不高于当前 / 已发布不可停用 / 重复发布）时不写记录', async () => {
    const low = await createVersion(draft({ version: 'v1.1.5' }))
    await expect(publishVersion(low.id)).rejects.toBeTruthy()
    await expect(stopVersion(4)).rejects.toBeTruthy() // 未发布不可停用
    await expect(publishVersion(3)).rejects.toBeTruthy() // 已发布不可重复发布
    expect(liveOps()).toHaveLength(0)
  })

  it('新建 / 编辑 / 删除（未上线的草稿）不写记录', async () => {
    const row = await createVersion(draft({ version: 'v1.5.0' }))
    await updateVersion(row.id, draft({ version: 'v1.5.1' }))
    await deleteVersion(row.id)
    expect(liveOps()).toHaveLength(0)
  })

  it('回退（先停用再重新发布）会各留一条记录，按时间倒序可追溯', async () => {
    await publishVersion(4)
    await stopVersion(4)
    await publishVersion(3)
    expect(liveOps().map((r) => `${r.action} ${r.target}`)).toEqual(['发布 Windows v1.2.0', '停用 Windows v1.3.0', '发布 Windows v1.3.0'])
  })
})

describe('审计种子与版本种子一致（防两份手写种子漂移）', () => {
  it('每个有发布时间的种子版本，在访问审计里都有一条同时间 / 同操作人 / 同更新说明的「发布」记录，且无多余记录', async () => {
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
