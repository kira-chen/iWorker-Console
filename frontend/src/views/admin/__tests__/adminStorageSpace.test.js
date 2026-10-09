// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminStorageSpace.vue 页面级用例（2026-10-09 存储空间首版）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md
 *   §二 页面结构（两个页签 + 待处理角标）/ §三 容量分配（默认容量条、列表、调整容量二次确认）/ §四 扩容申请（同意 / 拒绝）。
 * 真实挂载（真 Element Plus + 真子组件），只 mock api 层；业务规则（状态判定、联动结案、审计）见 storageSpaceMock.test.js。
 */

const api = {
  getStorageOverview: vi.fn(),
  listStorageMembers: vi.fn(),
  updateDefaultQuota: vi.fn(),
  adjustStorageQuota: vi.fn(),
  batchAdjustStorageQuota: vi.fn(),
  listExpansionRequests: vi.fn(),
  getExpansionRequest: vi.fn(),
  approveExpansionRequest: vi.fn(),
  rejectExpansionRequest: vi.fn()
}
vi.mock('@/api/storageSpace', () => api)
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route }))

const AdminStorageSpace = (await import('@/views/admin/AdminStorageSpace.vue')).default

const MEMBERS = [
  { userId: 203, username: 'chenyu', name: '陈宇', position: '经营分析岗', usedGb: 5, cacheGb: 0, totalGb: 5, ratio: 1, state: 'FULL', quotaSource: 'DEFAULT', statAt: '2026-10-09 10:02', pendingRequestId: 'ER-1003' },
  { userId: 201, username: 'zhangmin', name: '张敏', position: '经营分析岗', usedGb: 2.7, finalGb: 2.1, cacheGb: 0.6, totalGb: 5, ratio: 0.54, state: 'NORMAL', quotaSource: 'DEFAULT', statAt: '2026-10-09 09:12', pendingRequestId: null }
]
const REQUEST = {
  id: 'ER-1003', userId: 203, username: 'chenyu', name: '陈宇', position: '经营分析岗',
  usedGb: 5, totalGb: 5, cacheCleared: true, skippedAutomations: 2, reason: '报告产物较多，申请扩容到 10 GB。',
  submittedAt: '2026-10-09 10:05', status: 'PENDING', newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
}

let mounted, successSpy, warnSpy
beforeEach(() => {
  vi.clearAllMocks()
  route.query = {}
  api.getStorageOverview.mockResolvedValue({ defaultQuotaGb: 5, defaultMemberCount: 2, pendingCount: 1 })
  api.listStorageMembers.mockResolvedValue({ list: MEMBERS, total: MEMBERS.length })
  api.listExpansionRequests.mockResolvedValue({ list: [REQUEST], total: 1 })
  api.getExpansionRequest.mockResolvedValue({ ...REQUEST, current: MEMBERS[0] })
  api.adjustStorageQuota.mockResolvedValue({})
  api.approveExpansionRequest.mockResolvedValue({})
  api.rejectExpansionRequest.mockResolvedValue({})
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mountPage() {
  mounted = mountReal(AdminStorageSpace)
  await flushAll(12)
  return mounted.container
}
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
const btn = (root, text) => [...root.querySelectorAll('button')].find((b) => textOf(b) === text)
const dialogBody = () => document.body.querySelector('.el-dialog')
/** 点 el-input-number 的加减键：Element Plus 用 mousedown（按住连发）+ mouseup 触发，不是 click */
async function pressStep(selector) {
  const el = dialogBody().querySelector(selector)
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await flushAll(4)
}
/** 往 el-input-number 里输入数值：Element Plus 监听 input / change 事件 */
async function typeNumber(value) {
  const input = dialogBody().querySelector('.el-input-number input')
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushAll(4)
}

describe('AdminStorageSpace · 容量分配页签（PRD §二 / §三）', () => {
  it('展示标题、默认容量条与「扩容申请」页签的待处理角标', async () => {
    const c = await mountPage()
    expect(textOf(c)).toContain('存储空间')
    expect(textOf(c.querySelector('.sq-default'))).toContain('默认容量：5 GB')
    expect(textOf(c.querySelector('.ss-badge'))).toBe('1')
    expect(api.getStorageOverview).toHaveBeenCalled()
  })

  it('员工行展示「已用 / 总量」、状态标签与待处理申请入口；正常员工没有申请入口', async () => {
    const c = await mountPage()
    const rows = [...c.querySelectorAll('.el-table__body tr.el-table__row')]
    expect(rows).toHaveLength(2)
    expect(textOf(rows[0])).toContain('陈宇')
    expect(textOf(rows[0])).toContain('5 GB / 5 GB')
    expect(textOf(rows[0])).toContain('已满')
    expect(btn(rows[0], '待处理')).toBeTruthy()
    expect(textOf(rows[1])).toContain('2.7 GB / 5 GB')
    expect(btn(rows[1], '待处理')).toBeUndefined()
  })

  it('操作列：有待处理申请的显示「待处理」不显示「调整容量」，没有的显示「调整容量」；不再有单独的「扩容申请」列', async () => {
    const c = await mountPage()
    const rows = c.querySelectorAll('.el-table__body tr.el-table__row')
    expect(btn(rows[0], '待处理')).toBeTruthy()
    expect(btn(rows[0], '调整容量')).toBeUndefined()
    expect(btn(rows[1], '调整容量')).toBeTruthy()
    expect(btn(rows[1], '待处理')).toBeUndefined()
    const heads = [...c.querySelectorAll('.el-table__header th')].map((th) => textOf(th))
    expect(heads).not.toContain('扩容申请')
    expect(heads).toContain('操作')
  })

  it('批量勾选：有待处理申请的行勾选框置灰，没有的可勾选', async () => {
    const c = await mountPage()
    const rows = c.querySelectorAll('.el-table__body tr.el-table__row')
    expect(rows[0].querySelector('.el-checkbox.is-disabled')).toBeTruthy()
    expect(rows[1].querySelector('.el-checkbox.is-disabled')).toBeNull()
  })

  it('点「待处理」跳到扩容申请页签，并以该员工用户名搜索、状态为待处理', async () => {
    const c = await mountPage()
    btn(c.querySelectorAll('.el-table__body tr.el-table__row')[0], '待处理').click()
    await flushAll(12)
    expect(api.listExpansionRequests).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'chenyu', status: 'PENDING' }))
    expect(textOf(c)).toContain('报告产物较多，申请扩容到 10 GB。')
  })

  it('新总量不高于已用时先二次确认；取消则不提交', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const c = await mountPage()
    btn(c.querySelectorAll('.el-table__body tr.el-table__row')[1], '调整容量').click()
    await flushAll(6)
    await typeNumber(2) // 张敏已用 2.7 GB，新总量 2 不高于已用
    btn(dialogBody(), '确定').click()
    await flushAll(6)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0][0])).toContain('已满状态')
    expect(api.adjustStorageQuota).not.toHaveBeenCalled()
  })

  it('调整容量输入框带上下加减键（点加减按钮数字 ±1），减到 1 不能再减', async () => {
    const c = await mountPage()
    btn(c.querySelectorAll('.el-table__body tr.el-table__row')[1], '调整容量').click()
    await flushAll(6)
    const input = dialogBody().querySelector('.el-input-number input')
    expect(input.value).toBe('5')
    await pressStep('.el-input-number__increase')
    expect(input.value).toBe('6')
    await pressStep('.el-input-number__decrease')
    expect(input.value).toBe('5')
    for (let i = 0; i < 6; i++) await pressStep('.el-input-number__decrease') // 减到 1 就不能再减
    expect(input.value).toBe('1')
    expect(dialogBody().querySelector('.el-input-number__decrease').classList.contains('is-disabled')).toBe(true)
  })

  it('默认容量固定 5 GB：容量条只展示，没有「修改默认容量」按钮', async () => {
    const c = await mountPage()
    expect(textOf(c.querySelector('.sq-default'))).toContain('默认容量：5 GB')
    expect(btn(c, '修改默认容量')).toBeUndefined()
  })

  it('容量分配列表不展示统计时间列，也没有时间排序；仍按状态严重度排（已满在前）', async () => {
    const c = await mountPage()
    const heads = [...c.querySelectorAll('.el-table__header th')].map((th) => textOf(th))
    expect(heads).not.toContain('统计时间')
    expect(c.querySelector('.el-table__header .time-sort')).toBeNull()
    expect(api.listStorageMembers.mock.calls.at(-1)[0].sortOrder).toBeUndefined()
  })

  it('列表展示最终产物与缓存两列', async () => {
    const c = await mountPage()
    const heads = [...c.querySelectorAll('.el-table__header th')].map((th) => textOf(th))
    expect(heads).toEqual(expect.arrayContaining(['最终产物', '缓存']))
    const row = c.querySelectorAll('.el-table__body tr.el-table__row')[1] // 张敏 2.7 = 最终产物 2.1 + 缓存 0.6
    expect(textOf(row)).toContain('2.7 GB / 5 GB')
    expect(textOf(row)).toContain('2.1 GB')
    expect(textOf(row)).toContain('0.6 GB')
  })

  it('新总量高于已用时直接提交并提示；输入小于 1 的数被拉回 1、小数就地报错不提交，不设上限', async () => {
    const c = await mountPage()
    btn(c.querySelectorAll('.el-table__body tr.el-table__row')[1], '调整容量').click()
    await flushAll(6)
    await typeNumber(0) // 小于下限 1：输入框直接拉回 1，不会带着非法值提交
    expect(dialogBody().querySelector('.el-input-number input').value).toBe('1')
    await typeNumber(8.5) // 小数不能被输入框悄悄取整，要提示
    expect(dialogBody().querySelector('.el-input-number input').value).toBe('8.5')
    btn(dialogBody(), '确定').click()
    await flushAll(4)
    expect(textOf(dialogBody())).toContain('容量只能填整数')
    expect(api.adjustStorageQuota).not.toHaveBeenCalled()
    await typeNumber(8)
    btn(dialogBody(), '确定').click()
    await flushAll(8)
    expect(api.adjustStorageQuota).toHaveBeenCalledWith(201, 8)
    expect(successSpy).toHaveBeenCalledWith('已将 张敏 的容量调整为 8 GB')
  })

})

describe('AdminStorageSpace · 扩容申请页签（PRD §四）', () => {
  // 手动点开「扩容申请」页签（默认状态筛选为待处理）；带 ?tab=request 直接进入是访问审计的跳转口径，见专门用例
  async function openRequestTab() {
    const c = await mountPage()
    c.querySelectorAll('.el-tabs__item')[1].click()
    await flushAll(12)
    return c
  }

  it('从访问审计带 ?keyword= 跳入容量分配页签时按用户名搜索；切走再切回后搜索词清空', async () => {
    route.query = { keyword: 'chenyu' }
    const c = await mountPage()
    expect(api.listStorageMembers.mock.calls[0][0].keyword).toBe('chenyu')
    const tabs = c.querySelectorAll('.el-tabs__item')
    tabs[1].click()
    await flushAll(12)
    api.listStorageMembers.mockClear()
    tabs[0].click()
    await flushAll(12)
    expect(api.listStorageMembers.mock.calls[0][0].keyword).toBeUndefined()
  })

  it('扩容申请列表不展示提交时间列，处理人、处理时间各占一列', async () => {
    const c = await openRequestTab()
    const heads = [...c.querySelectorAll('.el-table__header th')].map((th) => textOf(th))
    expect(heads).not.toContain('提交时间')
    expect(heads).toEqual(expect.arrayContaining(['处理人', '处理时间 ↓']))
    expect(heads).not.toContain('处理人 / 时间')
  })

  it('「处理时间」列头带排序箭头：默认 ↓ 倒序，点击切 ↑ 正序再切回，并以 sortOrder 重新取数', async () => {
    const c = await openRequestTab()
    const sortBtn = () => c.querySelector('.el-table__header .time-sort')
    expect(textOf(sortBtn())).toBe('处理时间 ↓')
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].sortOrder).toBe('descending')
    sortBtn().click()
    await flushAll(8)
    expect(textOf(sortBtn())).toBe('处理时间 ↑')
    expect(api.listExpansionRequests.mock.calls.at(-1)[0]).toMatchObject({ sortOrder: 'ascending', page: 1 })
    sortBtn().click()
    await flushAll(8)
    expect(textOf(sortBtn())).toBe('处理时间 ↓')
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].sortOrder).toBe('descending')
  })

  it('已处理的申请显示处理人与处理时间；待处理显示「—」', async () => {
    api.listExpansionRequests.mockResolvedValue({
      list: [REQUEST, { ...REQUEST, id: 'ER-9', status: 'APPROVED', newTotalGb: 10, handler: 'demo', handledAt: '2026-10-09 11:00' }],
      total: 2
    })
    const c = await openRequestTab()
    const rows = [...c.querySelectorAll('.el-table__body tr.el-table__row')]
    expect(textOf(rows[1])).toContain('demo')
    expect(textOf(rows[1])).toContain('2026-10-09 11:00')
    expect(textOf(rows[0])).not.toContain('2026-10-09 11:00')
  })

  it('待处理申请展示事实标签与【同意】【拒绝】；同意弹窗预填「当前总量 + 5」', async () => {
    const c = await openRequestTab()
    const row = c.querySelector('.el-table__body tr.el-table__row')
    expect(textOf(row)).toContain('缓存已清理')
    expect(textOf(row)).toContain('2 个自动化待执行')
    btn(row, '同意').click()
    await flushAll(8)
    const input = dialogBody().querySelector('.el-input-number input')
    expect(input.value).toBe('10')
  })

  it('同意：新总量必须大于当前总量，不满足就地报错；满足后提交并提示', async () => {
    const c = await openRequestTab()
    btn(c.querySelector('.el-table__body tr.el-table__row'), '同意').click()
    await flushAll(8)
    await typeNumber(10.5)
    btn(dialogBody(), '确认同意').click()
    await flushAll(4)
    expect(textOf(dialogBody())).toContain('新总量只能填整数')
    expect(api.approveExpansionRequest).not.toHaveBeenCalled()
    await typeNumber(5)
    btn(dialogBody(), '确认同意').click()
    await flushAll(4)
    expect(textOf(dialogBody())).toContain('新总量须大于当前总量 5 GB')
    expect(api.approveExpansionRequest).not.toHaveBeenCalled()
    await typeNumber(12)
    btn(dialogBody(), '确认同意').click()
    await flushAll(8)
    expect(api.approveExpansionRequest).toHaveBeenCalledWith('ER-1003', 12)
    expect(successSpy).toHaveBeenCalledWith('已同意 陈宇 的扩容申请，容量调整为 12 GB')
  })

  it('拒绝：原因为空提示「请输入拒绝原因」且不提交；填写后提交（去掉首尾空格）', async () => {
    const c = await openRequestTab()
    btn(c.querySelector('.el-table__body tr.el-table__row'), '拒绝').click()
    await flushAll(6)
    expect(dialogBody().querySelector('textarea').getAttribute('placeholder')).toBe('请输入拒绝原因，将展示给申请人')
    btn(dialogBody(), '确认拒绝').click()
    await flushAll(4)
    expect(textOf(dialogBody())).toContain('请输入拒绝原因')
    expect(api.rejectExpansionRequest).not.toHaveBeenCalled()
    const ta = dialogBody().querySelector('textarea')
    ta.value = '  请先清理历史产物  '
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(4)
    btn(dialogBody(), '确认拒绝').click()
    await flushAll(8)
    expect(api.rejectExpansionRequest).toHaveBeenCalledWith('ER-1003', '请先清理历史产物')
  })

  it('提交时申请已被处理（并发）：提示「该申请已被处理」、关闭弹窗并刷新列表', async () => {
    api.approveExpansionRequest.mockRejectedValue(Object.assign(new Error('该申请已被处理'), { code: 40900 }))
    const c = await openRequestTab()
    btn(c.querySelector('.el-table__body tr.el-table__row'), '同意').click()
    await flushAll(8)
    const callsBefore = api.listExpansionRequests.mock.calls.length
    btn(dialogBody(), '确认同意').click()
    await flushAll(10)
    expect(warnSpy).toHaveBeenCalledWith('该申请已被处理')
    expect(api.listExpansionRequests.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('已处理的申请只读【查看】，展示拒绝原因；无同意 / 拒绝按钮', async () => {
    api.listExpansionRequests.mockResolvedValue({
      list: [{ ...REQUEST, status: 'REJECTED', rejectReason: '请先清理历史产物', handler: 'demo', handledAt: '2026-10-09 11:00' }],
      total: 1
    })
    const c = await openRequestTab()
    const row = c.querySelector('.el-table__body tr.el-table__row')
    expect(btn(row, '同意')).toBeUndefined()
    expect(textOf(row)).toContain('已拒绝')
    expect(textOf(row)).toContain('请先清理历史产物')
    btn(row, '查看').click()
    await flushAll(6)
    expect(textOf(dialogBody())).toContain('拒绝原因：请先清理历史产物')
  })

  it('没有申请时展示「暂无扩容申请」', async () => {
    api.listExpansionRequests.mockResolvedValue({ list: [], total: 0 })
    const c = await openRequestTab()
    expect(textOf(c)).toContain('暂无扩容申请')
  })
})
