// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

// 捕获 attachPersist 的 restore，用来构造「申请快照总量 ≠ 同意时当前总量」这种正常操作到不了的状态
const persistHarness = vi.hoisted(() => ({ options: null }))
vi.mock('../mockPersist', () => ({
  attachPersist: (key, options) => {
    // 用户 / 岗位 / 审计等模块也会 attach，只记存储空间自己的，不依赖加载顺序
    if (key === 'storageSpace') persistHarness.options = options
    return vi.fn()
  }
}))

import {
  getStorageOverview, listStorageMembers, adjustStorageQuota, batchAdjustStorageQuota,
  listExpansionRequests, getExpansionRequest, approveExpansionRequest, rejectExpansionRequest, __resetStorageSpaceMock
} from '../storageSpaceMock'
import { opsRecords, resetAccessAuditMock, listClientFacingOps } from '../accessAuditMock'
import { quotaInputError } from '../../utils/storageSpace'
import { listUsersSync, createUser, updateUser, deleteUser, __resetOrgMock } from '../adminUserMock'
import { setUserPosition, getAssignmentByUserId, __resetPositionAssignmentMock } from '../positionAssignmentMock'

// 2026-10-09 对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md（§一·4 状态判定 / §三 容量分配 / §四 扩容申请 / §五 用户联动 / §六 审计）
// 与 05治理/访问审计 §6.2 / §6.5.4。覆盖：状态与排序、调整 / 批量 / 恢复默认、有待处理申请不可调整、申请处理与并发、
// 审计 hidden 与客户端视图、与用户 / 岗位模块联动（reconcile）、种子自洽；持久化与读回见 storageSpaceMockPersist.test.js。
//
// 种子速查（员工 id 取自 adminUserMock 种子，用户名 → id）：zhangwei 201 / li.na 202 / chenyu 203 / wangfang 204 /
// sun.xin 206 / liuqiang 207 / zhaomin 208 / hejing 210 / xulin 212 / yangfan 209（未统计）/ ma.chao 213（未统计）；停用的 zhouming 205、wujie 211 不进清单。
// 默认 5 GB；待处理 4 条：刘强 ER-1003、孙欣 ER-1004（预警：申请后自行清了空间）、王芳 ER-1005、陈宇 ER-1006；
// 已处理 4 条：赵敏同意（个人 10 GB）、何静 / 刘强 / 孙欣被拒；徐琳个人 8 GB 且已满；李娜预警；张伟正常。
const liveOps = () => opsRecords.filter((r) => r.live && r.module === '存储空间')
// 客户端读取视图里本次测试新产生的存储空间记录（种子记录的 recordId < 100，排除掉）
const liveClientOps = () => listClientFacingOps().filter((r) => r.kind === 'storageQuota' && r.recordId >= 100)
const memberOf = async (username) => (await listStorageMembers({ size: 50 })).list.find((m) => m.username === username)

beforeEach(() => {
  __resetOrgMock()
  __resetPositionAssignmentMock()
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

  it('同一状态内按使用率降序（md 三·3）：正常组里使用率高的在前，调整容量后顺序随之变化', async () => {
    await adjustStorageQuota(202, 20) // 李娜 4.7/20 = 23.5%，变成正常；张伟 2.7/5 = 54%
    const normals = async () => (await listStorageMembers({ state: 'NORMAL', size: 50 })).list.map((m) => m.username)
    expect(await normals()).toEqual(['zhangwei', 'li.na'])
    await adjustStorageQuota(201, 100) // 张伟 2.7/100 = 2.7%，掉到李娜后面
    expect(await normals()).toEqual(['li.na', 'zhangwei'])
  })

  it('可按状态、有待处理申请、用户名或显示名筛选', async () => {
    expect((await listStorageMembers({ state: 'FULL', size: 50 })).list.map((m) => m.username).sort()).toEqual(['chenyu', 'hejing', 'liuqiang', 'wangfang', 'xulin'])
    expect((await listStorageMembers({ pending: true, size: 50 })).list.map((m) => m.username).sort()).toEqual(['chenyu', 'liuqiang', 'sun.xin', 'wangfang'])
    expect((await listStorageMembers({ keyword: ' 张伟 ', size: 50 })).list.map((m) => m.username)).toEqual(['zhangwei'])
  })

  it('列表行带最终产物与缓存两项明细，合计等于已用', async () => {
    const row = await memberOf('li.na')
    expect(row).toMatchObject({ finalGb: 4.1, cacheGb: 0.6, usedGb: 4.7 })
  })

  it('概览给出默认容量、按默认值计算的人数与待处理申请数', async () => {
    // 在职 11 人 − 个人设置 2 人（赵敏 10 GB、徐琳 8 GB）= 9 人用默认；待处理 4 条
    expect(await getStorageOverview()).toEqual({ defaultQuotaGb: 5, defaultMemberCount: 9, pendingCount: 4 })
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
    expect(liveClientOps().map((r) => r.type).sort()).toEqual(['同意扩容', '拒绝扩容', '调整容量'])
  })
})

describe('storageSpaceMock —— 调整容量', () => {
  it('单个调整后总量与容量来源更新，并写「调整容量」（变更内容「原总量 → 新总量」）', async () => {
    await adjustStorageQuota(201, 8)
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 8, quotaSource: 'PERSONAL' })
    expect(liveOps()[0]).toMatchObject({ action: '调整容量', target: 'zhangwei', detail: '5 GB → 8 GB', objectId: 201 })
  })

  it('总量没变不写审计，也不改变容量来源：默认员工填 5 仍是「默认」，不会悄悄变成个人设置', async () => {
    await adjustStorageQuota(201, 5)
    expect(liveOps()).toHaveLength(0)
    expect(await memberOf('zhangwei')).toMatchObject({ totalGb: 5, quotaSource: 'DEFAULT' })
    expect((await getStorageOverview()).defaultMemberCount).toBe(9)
  })

  it('调整容量可任意调小，不受当前容量限制：10 GB 的员工直接调到 3 GB，已用不高于新总量时随即处于已满状态', async () => {
    await adjustStorageQuota(208, 3) // 赵敏原为 10 GB，已用 9.7
    expect(await memberOf('zhaomin')).toMatchObject({ totalGb: 3, state: 'FULL' })
  })

  it('调整容量最小 1 GB：1 可以，0 报「容量不能小于 1 GB」', async () => {
    await adjustStorageQuota(208, 1)
    expect((await memberOf('zhaomin')).totalGb).toBe(1)
    await expect(adjustStorageQuota(208, 0)).rejects.toThrow('容量不能小于 1 GB')
  })

  it('调整容量不设上限', async () => {
    await adjustStorageQuota(208, 50000)
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
    await expect(batchAdjustStorageQuota([201], 0)).rejects.toThrow('容量不能小于 1 GB')
  })

  it('批量调整逐人写审计，总量没变的不记', async () => {
    const result = await batchAdjustStorageQuota([201, 202, 208], 10)
    expect(result).toEqual({ count: 3, changed: 2, skipped: 0 }) // 赵敏本来就是 10
    expect(liveOps().map((r) => r.target).sort()).toEqual(['li.na', 'zhangwei'])
  })

  it('批量里重复的员工 id 只处理一次（审计也只记一条）', async () => {
    await batchAdjustStorageQuota([201, 201, 201], 8)
    expect(liveOps()).toHaveLength(1)
  })

  it('批量里夹了不存在的员工 → 整批报错，已存在的员工也不改（原子）', async () => {
    await expect(batchAdjustStorageQuota([201, 999], 8)).rejects.toThrow('员工不存在')
    expect((await memberOf('zhangwei')).totalGb).toBe(5)
    expect(liveOps()).toHaveLength(0)
  })

  it('恢复默认对本来就是默认的员工没有变化：不写审计', async () => {
    await adjustStorageQuota(201, null, { restoreDefault: true })
    expect(liveOps()).toHaveLength(0)
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

  it('申请处理后恢复可调整：拒绝之后可以直接调整容量，审计各记一条', async () => {
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
    expect(desc.slice(4)).toEqual(['ER-1002', 'ER-1001', 'ER-0999', 'ER-0998']) // 处理时间 10-07、10-05、09-28、09-20：倒序
    expect(asc.slice(4)).toEqual(['ER-0998', 'ER-0999', 'ER-1001', 'ER-1002']) // 正序
    expect(asc.slice(0, 4)).toEqual(desc.slice(0, 4)) // 待处理的顺序（先到先处理）不受影响
  })

  it('待处理排最前且先提交的在前；已处理按处理时间倒序', async () => {
    const all = (await listExpansionRequests({ size: 10 })).list
    expect(all.map((r) => r.id)).toEqual(['ER-1003', 'ER-1004', 'ER-1005', 'ER-1006', 'ER-1002', 'ER-1001', 'ER-0999', 'ER-0998'])
    expect((await listExpansionRequests({ status: 'PENDING', size: 10 })).total).toBe(4)
  })

  it('同意：员工总量变为新总量，申请记已同意并写「同意扩容」，客户端字段带申请单标识与新总量', async () => {
    await approveExpansionRequest('ER-1006', 12)
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 12, state: 'NORMAL', pendingRequestId: null })
    const req = await getExpansionRequest('ER-1006')
    expect(req).toMatchObject({ status: 'APPROVED', newTotalGb: 12, handler: 'demo' })
    expect(liveOps()[0]).toMatchObject({ action: '同意扩容', detail: '5 GB → 12 GB' })
    expect(liveClientOps()[0]).toMatchObject({
      type: '同意扩容', username: 'chenyu', userId: 203, requestId: 'ER-1006', newTotalGb: 12
    })
  })

  it('员工在申请待处理期间自行清出空间、不再满：申请仍待处理，管理员可照常同意（md 四·5）', async () => {
    expect(await memberOf('sun.xin')).toMatchObject({ state: 'WARN', pendingRequestId: 'ER-1004' }) // 种子：申请后清了空间
    await approveExpansionRequest('ER-1004', 9)
    expect(await memberOf('sun.xin')).toMatchObject({ totalGb: 9, pendingRequestId: null })
  })

  it('同意扩容审计的「原总量」取同意那一刻员工的当前总量', async () => {
    // 构造：陈宇原来是默认 5 GB，同意时他的当前总量已是个人设置的 8 GB（正常操作到不了，因为有待处理申请的员工不能被调整，所以用 restore 造状态）
    const snap = persistHarness.options.snapshot()
    snap.members.find((m) => m.userId === 203).quotaGb = 8
    persistHarness.options.restore(snap)
    await approveExpansionRequest('ER-1006', 12)
    expect(liveOps()[0]).toMatchObject({ action: '同意扩容', detail: '8 GB → 12 GB' })
    expect(liveClientOps()[0]).toMatchObject({ type: '同意扩容', newTotalGb: 12 })
  })

  it('同意：新总量必须大于当前总量且在范围内', async () => {
    await expect(approveExpansionRequest('ER-1006', 5)).rejects.toThrow('新总量须大于当前总量 5 GB')
    await expect(approveExpansionRequest('ER-1006', 3)).rejects.toThrow('新总量须大于当前总量 5 GB') // 同意扩容只能往大调
    await expect(approveExpansionRequest('ER-1006', 2.5)).rejects.toThrow('容量只能填整数')
    expect((await getExpansionRequest('ER-1006')).status).toBe('PENDING')
  })

  it('拒绝原因必填且 ≤ 500 字：空白报「请输入拒绝原因」，501 字报「拒绝原因最多 500 字」，失败后申请仍待处理', async () => {
    await expect(rejectExpansionRequest('ER-1006', '   ')).rejects.toThrow('请输入拒绝原因')
    await expect(rejectExpansionRequest('ER-1006', '字'.repeat(501))).rejects.toThrow('拒绝原因最多 500 字')
    expect((await getExpansionRequest('ER-1006')).status).toBe('PENDING')
  })

  it('拒绝成功：申请记已拒绝并存原因，员工容量不变、仍是已满', async () => {
    await rejectExpansionRequest('ER-1006', '请先清理历史产物')
    expect(await memberOf('chenyu')).toMatchObject({ totalGb: 5, state: 'FULL' })
    expect(await getExpansionRequest('ER-1006')).toMatchObject({ status: 'REJECTED', rejectReason: '请先清理历史产物', handler: 'demo' })
  })

  it('拒绝成功：审计记「拒绝扩容」（变更内容 = 拒绝原因），客户端视图带拒绝原因', async () => {
    await rejectExpansionRequest('ER-1006', '请先清理历史产物')
    expect(liveOps()[0]).toMatchObject({ action: '拒绝扩容', target: 'chenyu', detail: '请先清理历史产物' })
    expect(liveClientOps()[0]).toMatchObject({ type: '拒绝扩容', rejectReason: '请先清理历史产物' })
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

  it('同意弹窗取到员工当前用量（current）', async () => {
    const detail = await getExpansionRequest('ER-1006')
    expect(detail.current).toMatchObject({ username: 'chenyu', usedGb: 5, totalGb: 5, state: 'FULL' })
    expect(detail).not.toHaveProperty('usedGb') // 申请记录本身不再存申请时用量
  })

  it('申请列表每行带员工当前用量（current），员工容量变化后刷新即变；申请记录不带申请时用量', async () => {
    const find = async (id) => (await listExpansionRequests({ size: 50 })).list.find((r) => r.id === id)
    expect(await find('ER-1004')).toMatchObject({ current: { usedGb: 4.6, totalGb: 5 } }) // 孙欣：申请后清了空间，当前 4.6 / 5
    expect(await find('ER-1004')).not.toHaveProperty('usedGb')
    expect(await find('ER-1004')).not.toHaveProperty('totalGb')
    await approveExpansionRequest('ER-1004', 9)
    expect(await find('ER-1004')).toMatchObject({ current: { usedGb: 4.6, totalGb: 9 } })
  })
})

describe('storageSpaceMock —— 与用户模块 / 岗位分配联动（reconcile）', () => {
  it('员工清单 = 用户模块的在职账号；停用账号（周明、吴杰）不在清单里', async () => {
    const names = (await listStorageMembers({ size: 50 })).list.map((m) => m.username).sort()
    const active = listUsersSync().filter((u) => u.status === 'active').map((u) => u.username).sort()
    expect(names).toEqual(active)
    expect(names).not.toContain('zhouming')
    expect(names).not.toContain('wujie')
  })

  it('岗位取岗位分配的当前值；改了岗位列表跟着变，而申请上的岗位仍是提交时的快照', async () => {
    expect(await memberOf('li.na')).toMatchObject({ position: getAssignmentByUserId(202).positionName })
    expect((await memberOf('chenyu')).position).toBe('') // 陈宇未绑定岗位
    await setUserPosition(203, 401)
    expect((await memberOf('chenyu')).position).toBe(getAssignmentByUserId(203).positionName)
    expect((await getExpansionRequest('ER-1006')).position).toBe('') // 提交时未绑定岗位
  })

  it('用户模块新增员工 → 出现在清单里，没统计过 = 未统计；改显示名同步', async () => {
    await createUser({ username: 'newbie', displayName: '新人', roleCodes: ['普通用户'] })
    expect(await memberOf('newbie')).toMatchObject({ name: '新人', state: 'UNKNOWN', usedGb: null, totalGb: 5 })
    const zhangwei = listUsersSync().find((u) => u.username === 'zhangwei')
    await updateUser(zhangwei.id, { displayName: '张伟伟' })
    expect((await memberOf('zhangwei')).name).toBe('张伟伟')
  })

  it('用户模块删除员工 → 其容量记录与待处理申请一并移除，角标同步减少', async () => {
    await deleteUser(203) // 陈宇，有待处理申请 ER-1006
    expect(await memberOf('chenyu')).toBeUndefined()
    expect((await listExpansionRequests({ size: 20 })).list.map((r) => r.id)).not.toContain('ER-1006')
    expect((await getStorageOverview()).pendingCount).toBe(3)
    await expect(getExpansionRequest('ER-1006')).rejects.toThrow('申请不存在')
  })

  it('停用账号退出清单，重新启用后用量还在', async () => {
    await updateUser(210, { status: 'disabled' })
    expect(await memberOf('hejing')).toBeUndefined()
    await updateUser(210, { status: 'active' })
    expect(await memberOf('hejing')).toMatchObject({ finalGb: 5, state: 'FULL' })
  })

  it('停用有待处理申请的账号：其申请不展示、不计入角标、不能被处理；重新启用后恢复', async () => {
    await updateUser(204, { status: 'disabled' }) // 王芳，待处理 ER-1005
    const ids = (await listExpansionRequests({ size: 50 })).list.map((r) => r.id)
    expect(ids).not.toContain('ER-1005')
    expect((await getStorageOverview()).pendingCount).toBe(3)
    await expect(getExpansionRequest('ER-1005')).rejects.toThrow('申请不存在')
    await expect(approveExpansionRequest('ER-1005', 9)).rejects.toThrow('申请不存在')
    await expect(rejectExpansionRequest('ER-1005', '原因')).rejects.toThrow('申请不存在')
    await updateUser(204, { status: 'active' })
    expect((await listExpansionRequests({ size: 50 })).list.map((r) => r.id)).toContain('ER-1005')
    expect((await getStorageOverview()).pendingCount).toBe(4)
    expect((await getExpansionRequest('ER-1005')).status).toBe('PENDING')
  })
})

describe('storageSpaceMock —— 种子自洽（与用户 / 岗位 / 访问审计种子对齐）', () => {
  it('种子里每个员工都是用户模块里真实存在的账号，用户名与显示名一致', async () => {
    const users = listUsersSync()
    const reqs = (await listExpansionRequests({ size: 50 })).list
    for (const r of reqs) {
      const u = users.find((x) => x.id === r.userId)
      expect(u, `申请 ${r.id} 的员工 ${r.username} 应存在于用户模块`).toBeTruthy()
      expect(u.username).toBe(r.username)
      expect(u.displayName).toBe(r.name)
    }
  })

  it('申请上的岗位快照与岗位分配种子一致', async () => {
    const reqs = (await listExpansionRequests({ size: 50 })).list
    for (const r of reqs) {
      expect(r.position, `申请 ${r.id}`).toBe(getAssignmentByUserId(r.userId)?.positionName || '')
    }
  })

  it('已处理的申请在访问审计种子里有对应的 hidden 记录（处理人、时间、申请单标识一致），个人设置的徐琳有「调整容量」记录', async () => {
    const reqs = (await listExpansionRequests({ size: 50 })).list.filter((r) => r.status !== 'PENDING')
    const seeds = opsRecords.filter((r) => r.module === '存储空间' && !r.live)
    for (const r of reqs) {
      const rec = seeds.find((x) => x.meta?.requestId === r.id)
      expect(rec, `申请 ${r.id} 应有审计种子`).toBeTruthy()
      expect(rec).toMatchObject({ hidden: true, operator: r.handler, time: r.handledAt, target: r.username })
      expect(rec.action).toBe(r.status === 'APPROVED' ? '同意扩容' : '拒绝扩容')
    }
    const adjust = seeds.find((x) => x.action === '调整容量')
    expect(adjust).toMatchObject({ target: 'xulin', detail: '5 GB → 8 GB' })
    expect(adjust.hidden).toBeUndefined()
    expect((await memberOf('xulin')).totalGb).toBe(8)
  })

  it('演示种子守卫——覆盖各种状态：个人设置且已满（徐琳）、预警但仍有待处理申请（孙欣）、未统计、超长申请说明与拒绝原因', async () => {
    expect(await memberOf('xulin')).toMatchObject({ quotaSource: 'PERSONAL', state: 'FULL' })
    expect(await memberOf('sun.xin')).toMatchObject({ state: 'WARN', pendingRequestId: 'ER-1004' })
    expect((await memberOf('yangfan')).state).toBe('UNKNOWN')
    const reqs = (await listExpansionRequests({ size: 50 })).list
    // 120：列表里申请说明 / 拒绝原因超长省略号 + 悬停的演示阈值（列宽放不下 100 字左右），种子要有超过它的样例
    expect(Math.max(...reqs.map((r) => r.reason.length))).toBeGreaterThan(120)
    expect(Math.max(...reqs.map((r) => r.rejectReason.length))).toBeGreaterThan(120)
    expect(new Set(reqs.map((r) => r.handler).filter(Boolean)).size).toBeGreaterThanOrEqual(2) // 不止一位处理人
  })
})

describe('预警 / 已满阈值按整数比较（md 存储空间 §一·4「已用 ≥ 总量 90% 且未满为预警」；原 yuepu#86 浮点误判）', () => {
  const stateWith = async (usedGb, quotaGb) => {
    const snap = persistHarness.options.snapshot()
    Object.assign(snap.members.find((m) => m.userId === 201), { finalGb: usedGb, cacheGb: 0, quotaGb })
    persistHarness.options.restore(snap)
    return memberOf('zhangwei')
  }

  // 用量保留一位小数时，这些组合恰好 90%，浮点比较会误判成正常
  it.each([[11.7, 13], [18.9, 21], [23.4, 26], [27.9, 31], [33.3, 37], [37.8, 42], [42.3, 47], [46.8, 52]])(
    '%s / %s GB 恰好 90% 为预警',
    async (used, total) => {
      expect(await stateWith(used, total)).toMatchObject({ usedGb: used, totalGb: total, state: 'WARN' })
    },
  )

  it('略低于 90%（11.6 / 13）为正常', async () => {
    expect((await stateWith(11.6, 13)).state).toBe('NORMAL')
  })

  it('恰好 100%（13 / 13）为已满，不是预警', async () => {
    expect((await stateWith(13, 13)).state).toBe('FULL')
  })
})
