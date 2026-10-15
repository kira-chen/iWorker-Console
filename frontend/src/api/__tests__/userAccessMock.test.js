// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../mockPersist', () => ({ attachPersist: () => vi.fn() }))

import {
  getUserAccessOverview, listAccessMembers, updateAccess, batchGrantAccess,
  listAccessRequests, approveAccessRequest, rejectAccessRequest, submitAccessRequestAsEmployee, __resetUserAccessMock,
  listAccessOperations, accessOperationRecords
} from '../userAccessMock'
import { opsRecords, resetAccessAuditMock, listClientFacingOps } from '../accessAuditMock'
import { listUsersSync, createUser, updateUser, deleteUser, __resetOrgMock } from '../adminUserMock'
import { REJECT_REASON_MAX } from '../../utils/userAccess'

// 对齐 docs/PRD/数字员工管理端PRD/06组织/用户访问权限/prd.用户访问权限.md（§一·4 状态流转 / §三 授权名单 / §四 权限申请 / §五 用户联动 / §六 审计）。
// 授权与申请按运行环境（本机 LOCAL / 云端 CLOUD）区分：名单的一行 = 一位员工在一个环境下的授权状态，两个环境各授权各的。
//
// 种子速查（员工 id 取自 adminUserMock 种子，用户名 → id）：zhangwei 201 / li.na 202 / chenyu 203 / wangfang 204 /
// sun.xin 206 / liuqiang 207 / zhaomin 208 / hejing 210 / xulin 212；停用的 zhouming 205、wujie 211 不进清单。
// 已授权 5 项：张伟（本机 + 云端）、赵敏（本机 + 云端）、李娜（仅本机，申请通过）；
// 有待处理申请 2 项（授权状态仍是未授权）：陈宇本机 UA-1004、王芳云端 UA-1003；其余未授权。
// 已处理申请 2 条：李娜 UA-1002（本机）已通过、刘强 UA-1001（本机）已驳回。
const liveOps = () => opsRecords.filter((r) => r.live && r.module === '用户访问权限')
const liveClientOps = () => listClientFacingOps().filter((r) => r.kind === 'userAccess' && r.recordId >= 100)
const ALL = { size: 100 }
const memberOf = async (username) => (await listAccessMembers(ALL)).list.find((m) => m.username === username)
const stateOf = async (username, env) => (await memberOf(username)).envs[env].state
// 有待处理申请不是授权状态（授权只有已授权 / 未授权两态），由 pendingRequestId 表示
const hasPending = async (username, env) => !!(await memberOf(username)).envs[env].pendingRequestId

beforeEach(() => {
  __resetOrgMock()
  __resetUserAccessMock()
  resetAccessAuditMock()
})

describe('授权名单：一位员工一行，两个运行环境各一份状态', () => {
  it('每位在职员工一行，行内有本机、云端两份授权状态；停用账号不进清单', async () => {
    const { list } = await listAccessMembers(ALL)
    const zhangwei = list.filter((m) => m.username === 'zhangwei')
    expect(zhangwei).toHaveLength(1)
    expect(Object.keys(zhangwei[0].envs).sort()).toEqual(['CLOUD', 'LOCAL'])
    expect(list.find((m) => m.username === 'zhouming')).toBeUndefined()
    expect(list.find((m) => m.username === 'wujie')).toBeUndefined()
    expect(new Set(list.map((m) => m.userId)).size).toBe(list.length)
  })

  it('状态按环境独立：有授权 = 已授权，其余未授权；有待处理申请只是未授权环境上的标记，不是状态', async () => {
    expect(await stateOf('zhangwei', 'LOCAL')).toBe('GRANTED')
    expect(await stateOf('zhangwei', 'CLOUD')).toBe('GRANTED')
    // 李娜只授权了本机，云端仍是未授权
    expect(await stateOf('li.na', 'LOCAL')).toBe('GRANTED')
    expect(await stateOf('li.na', 'CLOUD')).toBe('NONE')
    // 陈宇只申请了本机；王芳只申请了云端
    expect(await hasPending('chenyu', 'LOCAL')).toBe(true)
    expect(await stateOf('chenyu', 'CLOUD')).toBe('NONE')
    expect(await hasPending('wangfang', 'CLOUD')).toBe(true)
    expect(await stateOf('wangfang', 'LOCAL')).toBe('NONE')
  })

  it('每个环境的授权来源、授权时间、授权人各自一份：管理员授权 / 申请通过', async () => {
    expect((await memberOf('zhaomin')).envs.LOCAL).toMatchObject({ source: 'ADMIN', grantedAt: '2026-10-09 17:05', grantedBy: 'zhangwei' })
    expect((await memberOf('zhaomin')).envs.CLOUD).toMatchObject({ source: 'ADMIN', grantedAt: '2026-10-09 17:06' })
    expect((await memberOf('li.na')).envs.LOCAL).toMatchObject({ source: 'REQUEST' })
    expect((await memberOf('sun.xin')).envs.LOCAL).toMatchObject({ source: null, grantedAt: '' })
  })

  it('排序：任一环境审核中的在最前，其次有授权的（最近授权时间倒序），最后都未授权的', async () => {
    const { list } = await listAccessMembers(ALL)
    const names = list.map((m) => m.username)
    expect(names.slice(0, 2)).toEqual(['chenyu', 'wangfang'])
    // 最近授权：李娜 10-11 > 张伟 10-10 > 赵敏 10-09
    expect(names.slice(2, 5)).toEqual(['li.na', 'zhangwei', 'zhaomin'])
    expect(names.slice(5).every((n) => !['chenyu', 'wangfang', 'li.na', 'zhangwei', 'zhaomin'].includes(n))).toBe(true)
  })

  it('「待处理申请」按钮：hasPendingRequest 只返回任一环境有待处理申请的员工（陈宇本机、王芳云端）', async () => {
    const { list } = await listAccessMembers({ hasPendingRequest: true, ...ALL })
    expect(list.map((m) => m.username).sort()).toEqual(['chenyu', 'wangfang'])
    expect(list.every((m) => Object.values(m.envs).some((e) => !!e.pendingRequestId))).toBe(true)
    // 有待处理申请的环境授权状态仍是未授权（授权只有两态）
    expect(list.every((m) => Object.values(m.envs).filter((e) => e.pendingRequestId).every((e) => e.state === 'NONE'))).toBe(true)
  })

  it('focusUserId：把该员工置顶（处理申请后高亮用），其余顺序不变', async () => {
    const base = (await listAccessMembers(ALL)).list.map((m) => m.username)
    const { list } = await listAccessMembers({ focusUserId: (await memberOf('zhaomin')).userId, ...ALL })
    expect(list[0].username).toBe('zhaomin')
    expect(list.slice(1).map((m) => m.username)).toEqual(base.filter((n) => n !== 'zhaomin'))
  })

  it('筛选：关键字；状态不选环境 = 任一环境是该状态；选了环境 = 只看该环境', async () => {
    expect((await listAccessMembers({ keyword: ' 陈宇 ', ...ALL })).list.map((m) => m.username)).toEqual(['chenyu'])
    // 任一环境已授权：张伟、李娜、赵敏
    expect((await listAccessMembers({ state: 'GRANTED', ...ALL })).list.map((m) => m.username).sort()).toEqual(['li.na', 'zhangwei', 'zhaomin'])
    // 只看云端已授权：李娜（只有本机）不在其中
    expect((await listAccessMembers({ state: 'GRANTED', env: 'CLOUD', ...ALL })).list.map((m) => m.username).sort()).toEqual(['zhangwei', 'zhaomin'])
  })

  it('新建的员工两个环境都默认未授权', async () => {
    await createUser({ username: 'newbie', displayName: '新人', roleCodes: ['普通用户'] })
    const m = await memberOf('newbie')
    expect(m.envs.LOCAL).toMatchObject({ state: 'NONE', source: null, grantedAt: '' })
    expect(m.envs.CLOUD).toMatchObject({ state: 'NONE' })
  })
})

describe('设置授权 / 批量授权（一位员工可同时授权本机与云端）', () => {
  it('同时授权本机和云端：一次提交，各写一条带环境的审计', async () => {
    const id = (await memberOf('sun.xin')).userId
    await updateAccess(id, { grant: ['LOCAL', 'CLOUD'] })
    expect(await stateOf('sun.xin', 'LOCAL')).toBe('GRANTED')
    expect(await stateOf('sun.xin', 'CLOUD')).toBe('GRANTED')
    expect(liveOps().map((r) => `${r.action}:${r.meta.env}:${r.detail}`).sort()).toEqual([
      '授权:CLOUD:未授权 → 已授权（云端）', '授权:LOCAL:未授权 → 已授权（本机）'
    ])
  })

  it('只授权一个环境，另一个环境不受影响', async () => {
    const id = (await memberOf('sun.xin')).userId
    await updateAccess(id, { grant: ['CLOUD'] })
    expect(await stateOf('sun.xin', 'CLOUD')).toBe('GRANTED')
    expect(await stateOf('sun.xin', 'LOCAL')).toBe('NONE')
    expect(liveOps()).toHaveLength(1)
  })

  it('收回只收回指定环境，另一个环境仍然有权限；同一次提交可一边授权一边收回', async () => {
    const id = (await memberOf('li.na')).userId // 本机已授权、云端未授权
    await updateAccess(id, { grant: ['CLOUD'], revoke: ['LOCAL'] })
    expect(await stateOf('li.na', 'LOCAL')).toBe('NONE')
    expect(await stateOf('li.na', 'CLOUD')).toBe('GRANTED')
    expect(liveOps().map((r) => `${r.action}:${r.meta.env}`).sort()).toEqual(['授权:CLOUD', '收回:LOCAL'])
    expect(liveOps().find((r) => r.action === '收回')).toMatchObject({ detail: '已授权 → 未授权（本机）' })
  })

  it('某环境审核中不能直接授权或收回该环境（整体拒绝、都不改）；另一个环境不受限', async () => {
    const id = (await memberOf('chenyu')).userId // 本机审核中
    await expect(updateAccess(id, { grant: ['LOCAL'] })).rejects.toMatchObject({ code: 40900, message: '陈宇 有待处理的本机权限申请，请先处理该申请' })
    // 同一次提交里夹带了合法的云端授权，也因本机冲突整体不生效
    await expect(updateAccess(id, { grant: ['CLOUD', 'LOCAL'] })).rejects.toMatchObject({ code: 40900 })
    expect(await stateOf('chenyu', 'CLOUD')).toBe('NONE')
    expect(liveOps()).toHaveLength(0)
    await updateAccess(id, { grant: ['CLOUD'] })
    expect(await stateOf('chenyu', 'CLOUD')).toBe('GRANTED')
  })

  it('已授权不能重复授权，未授权不能收回；没有任何修改、环境非法都报错', async () => {
    const zid = (await memberOf('zhangwei')).userId
    const sid = (await memberOf('sun.xin')).userId
    await expect(updateAccess(zid, { grant: ['LOCAL'] })).rejects.toMatchObject({ code: 40900 })
    await expect(updateAccess(sid, { revoke: ['LOCAL'] })).rejects.toMatchObject({ code: 40900 })
    await expect(updateAccess(sid, {})).rejects.toMatchObject({ code: 40001 })
    await expect(updateAccess(sid, { grant: ['MOON'] })).rejects.toMatchObject({ code: 40001, field: 'env' })
  })

  it('批量授权：为所选员工授权所选环境，已授权、审核中的（员工 × 环境）跳过并计数，逐项写审计', async () => {
    const ids = await Promise.all(['sun.xin', 'zhangwei', 'chenyu'].map(async (u) => (await memberOf(u)).userId))
    // 孙欣：本机、云端都可授权（2 项）；张伟：两个环境都已授权（跳过 2 项）；陈宇：本机审核中（跳过 1 项），云端可授权（1 项）
    const res = await batchGrantAccess(ids, ['LOCAL', 'CLOUD'])
    expect(res).toEqual({ count: 3, skipped: 3 })
    expect(await stateOf('sun.xin', 'LOCAL')).toBe('GRANTED')
    expect(await stateOf('chenyu', 'CLOUD')).toBe('GRANTED')
    expect(await hasPending('chenyu', 'LOCAL')).toBe(true)
    expect(liveOps()).toHaveLength(3)
  })

  it('批量授权只选一个环境：只授权该环境', async () => {
    const id = (await memberOf('sun.xin')).userId
    expect(await batchGrantAccess([id], ['CLOUD'])).toEqual({ count: 1, skipped: 0 })
    expect(await stateOf('sun.xin', 'LOCAL')).toBe('NONE')
  })

  it('批量授权不选员工或不选环境报错', async () => {
    await expect(batchGrantAccess([], ['LOCAL'])).rejects.toMatchObject({ message: '请先选择员工' })
    await expect(batchGrantAccess([201], [])).rejects.toMatchObject({ message: '请选择要授权的运行环境' })
  })
})

describe('权限申请（按环境）', () => {
  it('默认排序：待处理在前、先到先处理；已处理按处理时间，默认倒序可切正序', async () => {
    const all = (await listAccessRequests({ size: 50 })).list
    expect(all.map((r) => r.id)).toEqual(['UA-1003', 'UA-1004', 'UA-1002', 'UA-1001'])
    const asc = (await listAccessRequests({ size: 50, sortOrder: 'ascending' })).list
    expect(asc.map((r) => r.id)).toEqual(['UA-1003', 'UA-1004', 'UA-1001', 'UA-1002'])
  })

  it('每条申请带运行环境；可按状态、环境和关键字筛选', async () => {
    const all = (await listAccessRequests({ size: 50 })).list
    expect(Object.fromEntries(all.map((r) => [r.id, r.env]))).toEqual({ 'UA-1004': 'LOCAL', 'UA-1003': 'CLOUD', 'UA-1002': 'LOCAL', 'UA-1001': 'LOCAL' })
    expect((await listAccessRequests({ status: 'PENDING' })).total).toBe(2)
    expect((await listAccessRequests({ status: 'PENDING', env: 'CLOUD' })).list.map((r) => r.id)).toEqual(['UA-1003'])
    expect((await listAccessRequests({ keyword: 'liuqiang' })).list.map((r) => r.id)).toEqual(['UA-1001'])
  })

  it('申请理由选填：王芳没填理由', async () => {
    const wang = (await listAccessRequests({ size: 50 })).list.find((r) => r.id === 'UA-1003')
    expect(wang.reason).toBe('')
  })

  it('通过：申请结案、员工在该环境变已授权（来源申请通过）、另一个环境不变、写带环境的审计', async () => {
    await approveAccessRequest('UA-1004')
    expect((await memberOf('chenyu')).envs.LOCAL).toMatchObject({ state: 'GRANTED', source: 'REQUEST' })
    expect(await stateOf('chenyu', 'CLOUD')).toBe('NONE')
    const req = (await listAccessRequests({ keyword: 'chenyu' })).list[0]
    expect(req).toMatchObject({ status: 'APPROVED', handler: expect.any(String) })
    expect(liveOps()[0]).toMatchObject({ action: '通过申请', target: 'chenyu', detail: '未授权 → 已授权（申请通过·本机）', meta: { requestId: 'UA-1004', env: 'LOCAL' } })
  })

  it('驳回：原因必填、限 500 字；驳回后该环境回未授权，可再申请', async () => {
    await expect(rejectAccessRequest('UA-1004', '  ')).rejects.toMatchObject({ message: '请输入驳回原因' })
    await expect(rejectAccessRequest('UA-1004', 'x'.repeat(REJECT_REASON_MAX + 1))).rejects.toMatchObject({ code: 40001 })
    await rejectAccessRequest('UA-1004', '用途不明确')
    expect(await stateOf('chenyu', 'LOCAL')).toBe('NONE')
    expect(liveOps()[0]).toMatchObject({ action: '驳回申请', detail: '用途不明确', meta: { env: 'LOCAL' } })
    const id = (await memberOf('chenyu')).userId
    await expect(submitAccessRequestAsEmployee(id, 'LOCAL', '补充说明')).resolves.toMatchObject({ status: 'PENDING', env: 'LOCAL' })
    expect(await hasPending('chenyu', 'LOCAL')).toBe(true)
  })

  it('并发：已被处理的申请不能再次处理，不存在的报申请不存在', async () => {
    await approveAccessRequest('UA-1004')
    await expect(approveAccessRequest('UA-1004')).rejects.toMatchObject({ code: 40900, message: '该申请已被处理' })
    await expect(rejectAccessRequest('UA-1004', '晚了')).rejects.toMatchObject({ code: 40900 })
    await expect(approveAccessRequest('UA-9999')).rejects.toMatchObject({ code: 40400, message: '申请不存在' })
  })

  it('员工端拦截按环境：该环境已授权或已有待处理申请不能再提交；另一个环境可以单独申请', async () => {
    const z = (await memberOf('zhangwei')).userId
    const c = (await memberOf('chenyu')).userId
    await expect(submitAccessRequestAsEmployee(z, 'LOCAL')).rejects.toMatchObject({ code: 40900 })
    await expect(submitAccessRequestAsEmployee(c, 'LOCAL')).rejects.toMatchObject({ code: 40900 })
    await expect(submitAccessRequestAsEmployee(c, undefined)).rejects.toMatchObject({ code: 40001 })
    // 陈宇本机审核中，云端还没申请过：可以再申请云端，两条互不影响
    await expect(submitAccessRequestAsEmployee(c, 'CLOUD', '云端也要用')).resolves.toMatchObject({ env: 'CLOUD' })
    expect(await hasPending('chenyu', 'LOCAL')).toBe(true)
    expect(await hasPending('chenyu', 'CLOUD')).toBe(true)
  })

  it('角标只数待处理（每个环境的申请各算一条）', async () => {
    expect((await getUserAccessOverview()).pendingCount).toBe(2)
    await approveAccessRequest('UA-1004')
    expect((await getUserAccessOverview()).pendingCount).toBe(1)
  })
})

describe('与用户模块联动', () => {
  const userIdOf = (username) => listUsersSync().find((u) => u.username === username).id

  it('停用账号的申请不展示、不计角标，重新启用后恢复', async () => {
    const id = userIdOf('chenyu')
    await updateUser(id, { status: 'disabled' })
    expect((await getUserAccessOverview()).pendingCount).toBe(1)
    expect((await listAccessRequests({ keyword: 'chenyu' })).total).toBe(0)
    await updateUser(id, { status: 'active' })
    expect((await getUserAccessOverview()).pendingCount).toBe(2)
  })

  it('用户被删除，其授权与申请一并移除', async () => {
    await deleteUser(userIdOf('li.na'))
    await deleteUser(userIdOf('chenyu'))
    expect(await memberOf('li.na')).toBeUndefined()
    expect((await listAccessRequests({ status: 'APPROVED' })).total).toBe(0)
    expect((await getUserAccessOverview()).pendingCount).toBe(1)
  })
})

describe('落给客户端的数据', () => {
  it('四类动作都出现在客户端视图，带用户标识、运行环境、申请单标识与驳回原因', async () => {
    await updateAccess((await memberOf('sun.xin')).userId, { grant: ['LOCAL'] })
    await updateAccess((await memberOf('zhangwei')).userId, { revoke: ['CLOUD'] })
    await approveAccessRequest('UA-1004')
    await rejectAccessRequest('UA-1003', '请补充用途')
    const types = liveClientOps().map((r) => r.type).sort()
    expect(types).toEqual(['授权', '收回', '通过申请', '驳回申请'].sort())
    const rejected = liveClientOps().find((r) => r.type === '驳回申请')
    expect(rejected).toMatchObject({ username: 'wangfang', env: 'CLOUD', requestId: 'UA-1003', rejectReason: '请补充用途' })
    expect(typeof rejected.userId).toBe('number')
    const revoked = liveClientOps().find((r) => r.type === '收回')
    expect(revoked).toMatchObject({ env: 'CLOUD', requestId: null, rejectReason: '' })
  })

  it('审计种子与授权、申请种子一致（含运行环境）', () => {
    const seeds = listClientFacingOps().filter((r) => r.kind === 'userAccess' && r.recordId < 100)
    expect(seeds.map((r) => `${r.type}:${r.username}:${r.env}`).sort()).toEqual([
      '授权:zhangwei:CLOUD', '授权:zhangwei:LOCAL', '授权:zhaomin:CLOUD', '授权:zhaomin:LOCAL',
      '通过申请:li.na:LOCAL', '驳回申请:liuqiang:LOCAL'
    ].sort())
  })
})

describe('操作记录（只读留痕）', () => {
  it('种子以会话为单元，只含在该环境拥有完全访问资格的员工；会话里的操作落 4 项权限 + 单独一类「被拦截命令」，本机 / 云端都有', async () => {
    const list = await listAccessOperations()
    expect(new Set(list.map((r) => r.username))).toEqual(new Set(['zhangwei', 'li.na', 'zhaomin']))
    expect(new Set(list.map((r) => r.env))).toEqual(new Set(['LOCAL', 'CLOUD']))
    expect(list.every((r) => r.id && !('title' in r) && !('sessionId' in r) && r.ops.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}:\d{2}$/.test(r.time))).toBe(true)
    const types = new Set(list.flatMap((r) => r.ops.map((o) => o.type)))
    expect(types).toEqual(new Set(['FILE', 'COMMAND', 'BIZ_SYSTEM', 'NETWORK', 'HARDLINE']))
    // 被拦截的操作都是「被拦截命令」这一类，结果都是已拦截；免确认的 4 项里没有被拦截的
    const ops = list.flatMap((r) => r.ops)
    expect(ops.filter((o) => o.result === 'BLOCKED').every((o) => o.type === 'HARDLINE')).toBe(true)
    expect(ops.filter((o) => o.type === 'HARDLINE').every((o) => o.result === 'BLOCKED')).toBe(true)
    expect(list.every((r) => r.ops.every((o) => o.target && ['SUCCESS', 'FAILED', 'BLOCKED'].includes(o.result)))).toBe(true)
  })

  it('操作对象一律是脱敏后的内容：接口入参只留参数名不留值，路径不落到具体文件', async () => {
    const targets = (await listAccessOperations()).flatMap((r) => r.ops.map((o) => o.target))
    expect(targets.length).toBeGreaterThan(0)
    // 接口入参「入参：date」只有参数名，没有「=值」
    expect(targets.filter((t) => t.includes('入参')).every((t) => !/入参[：=].*=/.test(t))).toBe(true)
    // 带通配 * 的路径只保留到目录，不出现具体文件扩展名
    expect(targets.some((t) => /\.(xlsx|docx|csv|pptx)\b/.test(t))).toBe(false)
  })

  it('留痕种子与授权种子一致：每条记录对应的（员工 × 环境）当前都是已授权', async () => {
    for (const r of accessOperationRecords) {
      expect(await stateOf(r.username, r.env), `${r.id} ${r.username} ${r.env}`).toBe('GRANTED')
    }
  })

  it('员工显示名取用户模块当前值：改名后记录跟着变；用户被删除后记录保留', async () => {
    const zhangwei = listUsersSync().find((u) => u.username === 'zhangwei')
    await updateUser(zhangwei.id, { displayName: '张伟（改名）' })
    expect((await listAccessOperations()).find((r) => r.userId === zhangwei.id).name).toBe('张伟（改名）')
    const lina = listUsersSync().find((u) => u.username === 'li.na')
    const before = (await listAccessOperations()).filter((r) => r.userId === lina.id).length
    await deleteUser(lina.id)
    expect((await listAccessOperations()).filter((r) => r.userId === lina.id)).toHaveLength(before)
  })
})
