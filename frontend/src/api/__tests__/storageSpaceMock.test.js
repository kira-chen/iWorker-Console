// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../mockPersist', () => ({ attachPersist: () => vi.fn() }))

import {
  getStorageOverview, listStorageMembers, adjustStorageQuota, batchAdjustStorageQuota,
  listExpansionRequests, getExpansionRequest, approveExpansionRequest, rejectExpansionRequest, __resetStorageSpaceMock
} from '../storageSpaceMock'
import { opsRecords, resetAccessAuditMock, listClientFacingOps } from '../accessAuditMock'

// 对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md 与 05治理/访问审计 §6.2 / §6.5.4。
// 种子：默认 5 GB；已满且有待处理申请的 4 人（刘强 ER-1003、孙欣 ER-1004、王芳 ER-1005、陈宇 ER-1006）；
// 何静已满（申请已拒绝）；李娜预警；赵敏个人 10 GB（申请已同意）；杨帆、马超未统计；张伟正常。
const liveOps = () => opsRecords.filter((r) => r.live && r.module === '存储空间')
const memberOf = async (username) => (await listStorageMembers({ size: 50 })).list.find((m) => m.username === username)

beforeEach(() => {
  __resetStorageSpaceMock()
  resetAccessAuditMock()
})

describe('storageSpaceMock —— 容量口径与状态判定', () => {
  it('员工总量 = 个人设置值，没有则取默认容量；容量来源据此标注', async () => {
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 5, quotaSource: 'DEFAULT' })
    expect(await memberOf('zhaomin')).toMatchObject({ totalGb: 10, quotaSource: 'PERSONAL' })
  })

  it('状态：已用 ≥ 总量为已满，≥ 90% 且未满为预警，其余正常，没有统计结果为未统计', async () => {
    expect((await memberOf('chenyu')).state).toBe('FULL') // 5.0 / 5
    expect((await memberOf('li.na')).state).toBe('WARN') // 4.7 / 5 = 94%
    expect((await memberOf('zhangwei')).state).toBe('NORMAL') // 2.7 / 5
    expect((await memberOf('yangfan')).state).toBe('UNKNOWN')
  })

  it('默认列表按状态严重度（已满 > 预警 > 正常 > 未统计）排序', async () => {
    const states = (await listStorageMembers({ size: 50 })).list.map((m) => m.state)
    const order = { FULL: 0, WARN: 1, NORMAL: 2, UNKNOWN: 3 }
    expect(states.map((s) => order[s])).toEqual([...states.map((s) => order[s])].sort((a, b) => a - b))
  })

  it('可按状态、有待处理申请、用户名或显示名筛选', async () => {
    expect((await listStorageMembers({ state: 'FULL', size: 50 })).list.map((m) => m.username).sort()).toEqual(['chenyu', 'hejing', 'liuqiang', 'sun.xin', 'wangfang'])
    expect((await listStorageMembers({ pending: true, size: 50 })).list.map((m) => m.username).sort()).toEqual(['chenyu', 'liuqiang', 'sun.xin', 'wangfang'])
    expect((await listStorageMembers({ keyword: ' 张伟 ', size: 50 })).list.map((m) => m.username)).toEqual(['zhangwei'])
  })

  it('列表行带最终产物与缓存两项明细，合计等于已用', async () => {
    const row = await memberOf('li.na')
    expect(row).toMatchObject({ finalGb: 4.1, cacheGb: 0.6, usedGb: 4.7 })
  })

  it('概览给出默认容量、按默认值计算的人数与待处理申请数', async () => {
    expect(await getStorageOverview()).toEqual({ defaultQuotaGb: 5, defaultMemberCount: 9, pendingCount: 4 })
  })
})

describe('storageSpaceMock —— 默认排序', () => {
  it('容量分配：按状态严重度排序（已满 > 预警 > 正常 > 未统计）', async () => {
    const states = (await listStorageMembers({ size: 50 })).list.map((m) => m.state)
    const order = { FULL: 0, WARN: 1, NORMAL: 2, UNKNOWN: 3 }
    expect(states.map((s) => order[s])).toEqual([...states.map((s) => order[s])].sort((a, b) => a - b))
    expect(states[0]).toBe('FULL')
    expect(states.at(-1)).toBe('UNKNOWN')
  })
})

describe('storageSpaceMock —— 访问审计可见性', () => {
  it('同意 / 拒绝扩容的审计记录标 hidden（访问审计页不展示），调整容量不标；客户端读取视图三类都在', async () => {
    await approveExpansionRequest('ER-1006', 10)
    await rejectExpansionRequest('ER-1005', '先清理历史产物')
    await adjustStorageQuota(201, 8)
    const byAction = Object.fromEntries(liveOps().map((r) => [r.action, r]))
    expect(byAction['同意扩容'].hidden).toBe(true)
    expect(byAction['拒绝扩容'].hidden).toBe(true)
    expect(byAction['调整容量'].hidden).toBeUndefined()
    expect(listClientFacingOps().filter((r) => r.kind === 'storageQuota').map((r) => r.type).sort()).toEqual(['同意扩容', '拒绝扩容', '调整容量'])
  })
})

describe('storageSpaceMock —— 默认容量固定 5 GB', () => {
  it('没有个人设置值的员工总量恒为 5 GB，概览里默认容量固定为 5；不再提供修改默认容量', async () => {
    expect((await getStorageOverview()).defaultQuotaGb).toBe(5)
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 5, quotaSource: 'DEFAULT' })
    const mock = await import('../storageSpaceMock')
    expect(mock.updateDefaultQuota).toBeUndefined()
  })
})

describe('storageSpaceMock —— 调整容量', () => {
  it('单个调整后总量与容量来源更新，并写「调整容量」（变更内容「原总量 → 新总量」）', async () => {
    await adjustStorageQuota(201, 8)
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 8, quotaSource: 'PERSONAL' })
    expect(liveOps()[0]).toMatchObject({ action: '调整容量', target: 'zhangwei', detail: '5 GB → 8 GB', objectId: 201 })
  })

  it('总量没变不写审计', async () => {
    await adjustStorageQuota(201, 5)
    expect(liveOps()).toHaveLength(0)
  })

  it('调整容量最小 1 GB，可任意调大调小；调到不高于已用时允许保存，员工随即处于已满状态', async () => {
    await adjustStorageQuota(208, 3) // 赵敏原为 10 GB，已用 9.7，可调到低于默认容量
    expect(await memberOf('zhaomin')).toMatchObject({ totalGb: 3, state: 'FULL' })
    await adjustStorageQuota(208, 1)
    expect((await memberOf('zhaomin')).totalGb).toBe(1)
    await expect(adjustStorageQuota(208, 0)).rejects.toThrow('新总量不能小于 1 GB')
    await adjustStorageQuota(208, 50000) // 不设上限
    expect((await memberOf('zhaomin')).totalGb).toBe(50000)
  })

  it('恢复默认：清除个人设置值，总量回到默认容量', async () => {
    await adjustStorageQuota(208, null, { restoreDefault: true })
    expect(await memberOf('zhaomin')).toMatchObject({ totalGb: 5, quotaSource: 'DEFAULT' })
    expect(liveOps()[0]).toMatchObject({ action: '调整容量', detail: '10 GB → 5 GB' })
  })

  it('批量设置最小 1 GB', async () => {
    await batchAdjustStorageQuota([201, 202], 1)
    expect((await memberOf('zhangwei')).totalGb).toBe(1)
    await expect(batchAdjustStorageQuota([201], 0)).rejects.toThrow('新总量不能小于 1 GB')
  })

  it('批量调整逐人写审计，总量没变的不记', async () => {
    const result = await batchAdjustStorageQuota([201, 202, 208], 10)
    expect(result).toEqual({ count: 3, changed: 2, skipped: 0 }) // 赵敏本来就是 10
    expect(liveOps().map((r) => r.target).sort()).toEqual(['li.na', 'zhangwei'])
  })

  it('批量未选员工时拦截；员工不存在时报错', async () => {
    await expect(batchAdjustStorageQuota([], 10)).rejects.toThrow('请先选择员工')
    await expect(adjustStorageQuota(999, 10)).rejects.toThrow('员工不存在')
  })
})

describe('storageSpaceMock —— 有待处理申请的员工不能在容量分配页调整', () => {
  it('单个调整 / 恢复默认被拦，提示先去扩容申请页签处理；容量、申请、审计都不变', async () => {
    await expect(adjustStorageQuota(203, 10)).rejects.toThrow('陈宇 有待处理的扩容申请，请先在扩容申请页签处理')
    await expect(adjustStorageQuota(203, null, { restoreDefault: true })).rejects.toThrow('待处理的扩容申请')
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 5, pendingRequestId: 'ER-1006' })
    expect((await getExpansionRequest('ER-1006')).status).toBe('PENDING')
    expect(liveOps()).toHaveLength(0)
  })

  it('批量设置只作用于没有待处理申请的员工，带申请的跳过并计数', async () => {
    const result = await batchAdjustStorageQuota([203, 204, 201, 202], 8) // 陈宇、王芳有待处理申请
    expect(result).toEqual({ count: 2, changed: 2, skipped: 2 })
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 5 })
    expect(await memberOf('wangfang')).toMatchObject({ totalGb: 5 })
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 8 })
    expect(liveOps().map((r) => r.target).sort()).toEqual(['li.na', 'zhangwei'])
  })

  it('申请处理后恢复可调整：拒绝之后可以直接调整容量，且没有「同意扩容」之外的联动记录', async () => {
    await rejectExpansionRequest('ER-1006', '先清理历史产物')
    await adjustStorageQuota(203, 3)
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 3, pendingRequestId: null })
    expect(liveOps().map((r) => r.action)).toEqual(['调整容量', '拒绝扩容'])
  })

  it('成员行带 pendingRequestId，用于页面把操作列显示成「待处理」', async () => {
    expect((await memberOf('chenyu')).pendingRequestId).toBe('ER-1006')
    expect((await memberOf('zhangwei')).pendingRequestId).toBeNull()
  })
})

describe('storageSpaceMock —— 扩容申请处理', () => {
  it('已处理的申请按处理时间排序：默认倒序，sortOrder=ascending 为正序；待处理始终排在最前', async () => {
    const desc = (await listExpansionRequests({ size: 10 })).list.map((r) => r.id)
    const asc = (await listExpansionRequests({ sortOrder: 'ascending', size: 10 })).list.map((r) => r.id)
    expect(desc.slice(-2)).toEqual(['ER-1002', 'ER-1001']) // 处理时间 10-07、10-05：倒序
    expect(asc.slice(-2)).toEqual(['ER-1001', 'ER-1002']) // 正序
    expect(asc.slice(0, 4)).toEqual(desc.slice(0, 4)) // 待处理的顺序（先到先处理）不受影响
  })

  it('待处理排最前且先提交的在前；已处理按处理时间倒序', async () => {
    const all = (await listExpansionRequests({ size: 10 })).list
    expect(all.map((r) => r.id)).toEqual(['ER-1003', 'ER-1004', 'ER-1005', 'ER-1006', 'ER-1002', 'ER-1001'])
    expect((await listExpansionRequests({ status: 'PENDING', size: 10 })).total).toBe(4)
  })

  it('同意：员工总量变为新总量，申请记已同意并写「同意扩容」，客户端字段带申请单标识与新总量', async () => {
    await approveExpansionRequest('ER-1006', 12)
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 12, state: 'NORMAL', pendingRequestId: null })
    const req = await getExpansionRequest('ER-1006')
    expect(req).toMatchObject({ status: 'APPROVED', newTotalGb: 12, handler: 'demo' })
    expect(liveOps()[0]).toMatchObject({ action: '同意扩容', detail: '5 GB → 12 GB' })
    expect(listClientFacingOps().find((r) => r.kind === 'storageQuota')).toMatchObject({
      type: '同意扩容', username: 'chenyu', userId: 203, requestId: 'ER-1006', newTotalGb: 12
    })
  })

  it('同意：新总量必须大于当前总量且在范围内', async () => {
    await expect(approveExpansionRequest('ER-1006', 5)).rejects.toThrow('新总量须大于当前总量 5 GB')
    await expect(approveExpansionRequest('ER-1006', 3)).rejects.toThrow('新总量须大于当前总量 5 GB') // 同意扩容只能往大调
    await expect(approveExpansionRequest('ER-1006', 2.5)).rejects.toThrow('新总量只能填整数')
    expect((await getExpansionRequest('ER-1006')).status).toBe('PENDING')
  })

  it('拒绝：原因必填且 ≤ 500 字；成功后容量不变，原因写进审计变更内容', async () => {
    await expect(rejectExpansionRequest('ER-1006', '   ')).rejects.toThrow('请输入拒绝原因')
    await expect(rejectExpansionRequest('ER-1006', '字'.repeat(501))).rejects.toThrow('拒绝原因最多 500 字')
    await rejectExpansionRequest('ER-1006', '请先清理历史产物')
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 5, state: 'FULL' })
    expect(await getExpansionRequest('ER-1006')).toMatchObject({ status: 'REJECTED', rejectReason: '请先清理历史产物' })
    expect(liveOps()[0]).toMatchObject({ action: '拒绝扩容', target: 'chenyu', detail: '请先清理历史产物' })
    expect(listClientFacingOps().find((r) => r.kind === 'storageQuota')).toMatchObject({ type: '拒绝扩容', rejectReason: '请先清理历史产物' })
  })

  it('500 字刚好允许', async () => {
    await expect(rejectExpansionRequest('ER-1006', '字'.repeat(500))).resolves.toMatchObject({ status: 'REJECTED' })
  })

  it('已处理的申请再次处理提示「该申请已被处理」且不写审计', async () => {
    await approveExpansionRequest('ER-1006', 10)
    const before = liveOps().length
    const conflict = await approveExpansionRequest('ER-1006', 20).catch((e) => e)
    expect(conflict.message).toBe('该申请已被处理')
    expect(conflict.code).toBe(40900)
    await expect(rejectExpansionRequest('ER-1006', '重复')).rejects.toThrow('该申请已被处理')
    expect(liveOps()).toHaveLength(before)
  })

  it('同意弹窗取到员工当前用量（current），与申请时的快照分开存放', async () => {
    const detail = await getExpansionRequest('ER-1006')
    expect(detail).toMatchObject({ usedGb: 5, totalGb: 5 }) // 申请时快照
    expect(detail.current).toMatchObject({ username: 'chenyu', usedGb: 5, totalGb: 5, state: 'FULL' }) // 当前最新
  })
})
