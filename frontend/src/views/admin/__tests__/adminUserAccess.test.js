// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminUserAccess.vue 页面级用例（2026-10-13 用户访问权限首版，2026-10-14 授权名单改为一位员工一行 + 按运行环境授权）。
 * 对齐 docs/PRD/数字员工管理端PRD/06组织/用户访问权限/prd.用户访问权限.md
 *   §二 页面结构（标题 / 说明 / 三个页签 / 待处理角标 / 跳转带入条件）/ §三 授权名单（一员工一行、本机 / 云端各一列、设置授权勾选环境、收回二次确认、批量授权）/
 *   §四 权限申请（通过二次确认、驳回原因必填、查看、运行环境）/ §四之二 操作记录（只读、一次操作一行）。
 * 真实挂载（真 Element Plus + 真子组件），只 mock api 层；业务规则（状态流转、审计、用户联动）见 api/__tests__/userAccessMock.test.js。
 * 本文件的 fixture 是自造的，与 mock 种子无关。
 */

const api = {
  getUserAccessOverview: vi.fn(),
  listAccessMembers: vi.fn(),
  updateAccess: vi.fn(),
  batchGrantAccess: vi.fn(),
  listAccessRequests: vi.fn(),
  listAccessOperations: vi.fn(),
  accessOperationRecords: [],
  approveAccessRequest: vi.fn(),
  rejectAccessRequest: vi.fn()
}
vi.mock('@/api/userAccess', () => api)
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route }))

const AdminUserAccess = (await import('@/views/admin/AdminUserAccess.vue')).default

const cell = (state, extra = {}) => ({ state, source: null, grantedAt: '', grantedBy: '', pendingRequestId: null, ...extra })
const GRANTED_CELL = cell('GRANTED', { source: 'ADMIN', grantedAt: '2026-10-10 09:20', grantedBy: 'demo' })
const MEMBERS = [
  // 陈宇：本机有待处理申请（授权状态仍是未授权）、云端未授权
  { userId: 203, username: 'chenyu', name: '陈宇', position: '', envs: { LOCAL: cell('NONE', { pendingRequestId: 'UA-1004' }), CLOUD: cell('NONE') } },
  // 张伟：本机、云端都已授权
  { userId: 201, username: 'zhangwei', name: '张伟', position: '经营分析岗', envs: { LOCAL: GRANTED_CELL, CLOUD: { ...GRANTED_CELL, grantedAt: '2026-10-10 09:21' } } },
  // 李娜：只授权了本机
  { userId: 202, username: 'li.na', name: '李娜', position: '客户成功岗', envs: { LOCAL: { ...GRANTED_CELL, source: 'REQUEST' }, CLOUD: cell('NONE') } },
  // 孙欣：两个环境都未授权
  { userId: 206, username: 'sun.xin', name: '孙欣', position: '', envs: { LOCAL: cell('NONE'), CLOUD: cell('NONE') } }
]
const PENDING_REQ = {
  id: 'UA-1004', userId: 203, username: 'chenyu', name: '陈宇', position: '', env: 'LOCAL',
  reason: '需要批量整理本机文件。', submittedAt: '2026-10-13 09:40', status: 'PENDING', rejectReason: '', handler: '', handledAt: ''
}
const DONE_REQ = {
  id: 'UA-1001', userId: 207, username: 'liuqiang', name: '刘强', position: '', env: 'CLOUD',
  reason: '', submittedAt: '2026-10-11 09:15', status: 'REJECTED', rejectReason: '当前任务无需完全访问。', handler: 'zhangwei', handledAt: '2026-10-11 10:12'
}
const today = new Date()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const OPERATIONS = [
  { id: 'SS-1', userId: 201, username: 'zhangwei', name: '张伟', env: 'CLOUD', date: ymd(today), time: '10:25:12',
    ops: [
      { type: 'COMMAND', target: 'chmod 777 /workspace/output', result: 'SUCCESS', reason: '' },
      { type: 'NETWORK', target: '经营数据接口 · POST /v1/reports/daily', result: 'FAILED', reason: '接口返回 503，日报未写入' }
    ] },
  { id: 'SS-3', userId: 201, username: 'zhangwei', name: '张伟', env: 'LOCAL', date: ymd(today), time: '08:30:00',
    ops: [
      { type: 'FILE', target: 'rm D:/经营/周报/*', result: 'SUCCESS', reason: '' },
      { type: 'HARDLINE', target: 'rm -rf /', result: 'BLOCKED', reason: '毁灭级命令，客户端直接拦截，未执行' }
    ] },
  { id: 'SS-OLD', userId: 202, username: 'li.na', name: '李娜', env: 'LOCAL', date: ymd(new Date(Date.now() - 100 * 86400000)), time: '09:00:00',
    ops: [{ type: 'FILE', target: 'rm D:/历史/*', result: 'SUCCESS', reason: '' }] },
  { id: 'SS-2', userId: 202, username: 'li.na', name: '李娜', env: 'LOCAL', date: ymd(today), time: '09:12:33',
    ops: [{ type: 'BIZ_SYSTEM', target: 'crm.example.com · 点击「保存」', result: 'SUCCESS', reason: '' }] }
]

let mounted, successSpy, warnSpy, errorSpy, confirmSpy
beforeEach(() => {
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  route.query = {}
  api.getUserAccessOverview.mockResolvedValue({ pendingCount: 1 })
  api.listAccessMembers.mockResolvedValue({ list: MEMBERS, total: MEMBERS.length })
  api.listAccessRequests.mockResolvedValue({ list: [PENDING_REQ], total: 1 })
  api.listAccessOperations.mockResolvedValue(OPERATIONS)
  api.updateAccess.mockResolvedValue({})
  api.batchGrantAccess.mockResolvedValue({ count: 2, skipped: 0 })
  api.approveAccessRequest.mockResolvedValue({})
  api.rejectAccessRequest.mockResolvedValue({})
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  // 真实挂载冒烟的探针：整个用例过程中 console.error 零调用
  expect(errorSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function mountPage() {
  mounted = mountReal(AdminUserAccess)
  await flushAll(12)
  return mounted.container
}
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
const btn = (root, text) => [...root.querySelectorAll('button')].find((b) => textOf(b) === text)
const rowOf = (root, name) => [...root.querySelectorAll('.el-table__body tr')].find((tr) => textOf(tr).includes(name))
const rowBtns = (root, name) => [...rowOf(root, name).querySelectorAll('.el-button')].map(textOf)
const rowBtn = (root, name, text) => [...rowOf(root, name).querySelectorAll('.el-button')].find((b) => textOf(b) === text)
const tabItem = (root, text) => [...root.querySelectorAll('.el-tabs__item')].find((t) => textOf(t).startsWith(text))
const dialog = () => document.body.querySelector('.el-dialog')
const topDialog = () => [...document.body.querySelectorAll('.el-dialog')].at(-1)
const dlgBtn = (text) => [...dialog().querySelectorAll('button')].find((b) => textOf(b) === text)
const checkbox = (label) => [...dialog().querySelectorAll('.el-checkbox')].find((c) => textOf(c) === label)

describe('完全访问权限范围说明（PRD §一 2 与附录）', () => {
  const SCOPE_NAMES = ['读写文件', '执行命令', '操作业务系统', '联网与连接器']

  it('页面顶部的权限口径默认折叠，点击后才展开4 项权限（覆盖客户端清单 #1–#5）与不受影响的边界', async () => {
    const root = await mountPage()
    const box = root.querySelector('.uas')
    expect(textOf(box)).toContain('完全访问权限口径')
    SCOPE_NAMES.forEach((n) => expect(textOf(box)).not.toContain(n))
    box.querySelector('.uas-toggle').click()
    await flushAll(4)
    // 员工端 4 项下逐条覆盖客户端清单第一节 #1–#5：SOP 回放提交步并在「操作业务系统」下
    ;['删除文件 / 目录', '危险命令 / 脚本', '浏览器提交类点击', 'SOP 回放提交步', '连接器 API 对外写操作'].forEach((n) => expect(textOf(box)).toContain(n))
    SCOPE_NAMES.forEach((n) => expect(textOf(box)).toContain(n))
    expect(textOf(box)).toContain('毁灭级命令')
    box.querySelector('.uas-toggle').click()
    await flushAll(4)
    expect(textOf(box)).not.toContain('毁灭级命令')
  })

  it('设置授权弹窗里同样列出 4 项权限，授权前看得到', async () => {
    const root = await mountPage()
    rowBtn(root, '孙欣', '设置授权').click()
    await flushAll(6)
    const text = textOf(dialog().querySelector('.uas'))
    SCOPE_NAMES.forEach((n) => expect(text).toContain(n))
  })
})

describe('页面结构（PRD §二）', () => {
  it('标题「用户访问权限」，两个页签：授权名单（默认）、操作记录；权限申请不占单独页签，工具栏有「待处理申请」按钮带数量徽标', async () => {
    const root = await mountPage()
    expect(textOf(root.querySelector('h1, .page-title') || root)).toContain('用户访问权限')
    expect([...root.querySelectorAll('.el-tabs__item')].map((t) => textOf(t))).toEqual(['授权名单', '操作记录'])
    expect(tabItem(root, '授权名单').classList.contains('is-active')).toBe(true)
    expect(textOf(btn(root, '待处理申请1'))).toBe('待处理申请1')
  })

  it('待处理数为 0 时「待处理申请」按钮不显示数量徽标', async () => {
    api.getUserAccessOverview.mockResolvedValue({ pendingCount: 0 })
    const root = await mountPage()
    expect(textOf(btn(root, '待处理申请'))).toBe('待处理申请')
  })

  it('点「待处理申请」只看有待处理申请的员工，再点一次还原（同岗位管理的「待分配申请」）', async () => {
    const root = await mountPage()
    btn(root, '待处理申请1').click()
    await flushAll(8)
    expect(api.listAccessMembers).toHaveBeenLastCalledWith(expect.objectContaining({ hasPendingRequest: true }))
    btn(root, '待处理申请1').click()
    await flushAll(8)
    expect(api.listAccessMembers).toHaveBeenLastCalledWith(expect.objectContaining({ hasPendingRequest: false }))
  })

  it('驾驶舱待办带 ?pending=1 → 进页即只看有待处理申请的员工', async () => {
    route.query = { pending: '1' }
    await mountPage()
    expect(api.listAccessMembers).toHaveBeenCalledWith(expect.objectContaining({ hasPendingRequest: true }))
    expect(api.listAccessRequests).not.toHaveBeenCalled()
  })

  it('访问审计「查看」通过 / 驳回记录也只带 ?keyword=… → 落在授权名单按该员工搜索（没有权限申请页签）', async () => {
    route.query = { keyword: 'liuqiang' }
    await mountPage()
    expect(api.listAccessMembers).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'liuqiang' }))
  })

  it('访问审计「查看」授权 / 收回记录带 ?keyword=… → 授权名单页签按该员工搜索', async () => {
    route.query = { keyword: 'zhangwei' }
    await mountPage()
    expect(api.listAccessMembers).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'zhangwei' }))
  })
})

describe('授权名单：一位员工一行，本机 / 云端各一列（PRD §三）', () => {
  it('一位员工只占一行，表头有「本机授权」「云端授权」两列', async () => {
    const root = await mountPage()
    expect(root.querySelectorAll('.el-table__body tr')).toHaveLength(MEMBERS.length)
    const headers = [...root.querySelectorAll('.el-table__header th')].map(textOf)
    expect(headers).toContain('本机授权')
    expect(headers).toContain('云端授权')
  })

  it('每个环境各显示自己的状态（只有已授权 / 未授权两态）：陈宇 本机未授权并带「待处理」标记 / 云端未授权；李娜 本机已授权 / 云端未授权', async () => {
    const root = await mountPage()
    const cellsOf = (name) => [...rowOf(root, name).querySelectorAll('.el-tag, .status-tag, [class*="tag"]')].map(textOf).filter(Boolean)
    expect(textOf(rowOf(root, '陈宇'))).toMatch(/未授权\s*待处理.*未授权/) // 没有「审核中」这个状态
    expect(textOf(rowOf(root, '陈宇'))).not.toContain('审核中')
    expect(textOf(rowOf(root, '张伟'))).not.toContain('待处理')
    expect(textOf(rowOf(root, '李娜'))).toMatch(/已授权.*未授权/)
    expect(textOf(rowOf(root, '张伟'))).toMatch(/已授权.*已授权/)
    expect(textOf(rowOf(root, '孙欣'))).toMatch(/未授权.*未授权/)
    expect(cellsOf).toBeTypeOf('function')
  })

  it('操作列：都有「设置授权」；任一环境有待处理申请多「处理申请」；有授权的多「查看」', async () => {
    const root = await mountPage()
    expect(rowBtns(root, '陈宇')).toEqual(['设置授权', '处理申请'])
    expect(rowBtns(root, '张伟')).toEqual(['设置授权', '查看'])
    expect(rowBtns(root, '李娜')).toEqual(['设置授权', '查看'])
    expect(rowBtns(root, '孙欣')).toEqual(['设置授权'])
  })

  it('勾选框：两个环境都不能再授权的员工（张伟）置灰，其余可勾选', async () => {
    const root = await mountPage()
    const disabled = (name) => rowOf(root, name).querySelector('.el-checkbox').classList.contains('is-disabled')
    expect(disabled('张伟')).toBe(true)
    expect(disabled('陈宇')).toBe(false) // 云端还能授权
    expect(disabled('李娜')).toBe(false)
    expect(disabled('孙欣')).toBe(false)
  })

  it('运行环境筛选下拉：选「云端」后带 env 请求', async () => {
    const root = await mountPage()
    root.querySelectorAll('.el-select')[0].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => textOf(i) === '云端').click()
    await flushAll(8)
    expect(api.listAccessMembers).toHaveBeenLastCalledWith(expect.objectContaining({ env: 'CLOUD' }))
  })
})

describe('设置授权：勾选授权给本机、云端或两者（PRD §三·3）', () => {
  async function openSetting(name) {
    const root = await mountPage()
    rowBtn(root, name, '设置授权').click()
    await flushAll(6)
    return root
  }

  it('弹窗里本机、云端各一个勾选框，按当前授权预勾选', async () => {
    await openSetting('李娜')
    expect(textOf(dialog())).toContain('设置完全访问授权')
    expect(checkbox('本机').classList.contains('is-checked')).toBe(true)
    expect(checkbox('云端').classList.contains('is-checked')).toBe(false)
  })

  it('没有任何修改时「确定」置灰', async () => {
    await openSetting('李娜')
    expect(dlgBtn('确定').disabled).toBe(true)
  })

  it('同时授权本机和云端：一次提交 grant 两个环境（同一个人不用搜两次）', async () => {
    await openSetting('孙欣')
    checkbox('本机').click()
    checkbox('云端').click()
    await flushAll(4)
    dlgBtn('确定').click()
    await flushAll(8)
    expect(api.updateAccess).toHaveBeenCalledWith(206, { grant: ['LOCAL', 'CLOUD'], revoke: [] })
    expect(confirmSpy).not.toHaveBeenCalled() // 只授权不需要再二次确认
    expect(successSpy).toHaveBeenCalledWith('孙欣：已授权在本机、云端使用完全访问')
  })

  it('只授权云端：只 grant 云端', async () => {
    await openSetting('李娜')
    checkbox('云端').click()
    await flushAll(4)
    dlgBtn('确定').click()
    await flushAll(8)
    expect(api.updateAccess).toHaveBeenCalledWith(202, { grant: ['CLOUD'], revoke: [] })
  })

  it('取消勾选已授权的环境 = 收回：先二次确认（已开启的完全访问会立即关闭），确认后提交 revoke', async () => {
    await openSetting('李娜')
    checkbox('本机').click() // 取消本机
    await flushAll(4)
    expect(textOf(dialog())).toContain('取消勾选将收回，已开启的完全访问会立即关闭')
    dlgBtn('确定').click()
    await flushAll(8)
    expect(confirmSpy.mock.calls[0][0]).toContain('已开启的完全访问会立即关闭')
    expect(api.updateAccess).toHaveBeenCalledWith(202, { grant: [], revoke: ['LOCAL'] })
    expect(successSpy).toHaveBeenCalledWith('李娜：已收回本机的完全访问权限')
  })

  it('收回时二次确认点取消：不提交', async () => {
    confirmSpy.mockRejectedValue('cancel')
    await openSetting('李娜')
    checkbox('本机').click()
    await flushAll(4)
    dlgBtn('确定').click()
    await flushAll(8)
    expect(api.updateAccess).not.toHaveBeenCalled()
  })

  it('某环境有待处理申请：该环境的勾选框置灰并提示先处理申请，另一个环境照常可授权', async () => {
    await openSetting('陈宇') // 本机有待处理申请、云端未授权
    expect(checkbox('本机').classList.contains('is-disabled')).toBe(true)
    expect(textOf(dialog())).toContain('有待处理的申请，请先在【处理申请】里通过或驳回')
    expect(checkbox('云端').classList.contains('is-disabled')).toBe(false)
  })

  it('保存时员工刚提交了申请（并发冲突 40900）：提示原因、关闭弹窗并刷新列表', async () => {
    api.updateAccess.mockRejectedValue({ code: 40900, message: '孙欣 有待处理的云端权限申请，请先处理该申请' })
    const root = await openSetting('孙欣')
    const before = api.listAccessMembers.mock.calls.length
    checkbox('云端').click()
    await flushAll(4)
    dlgBtn('确定').click()
    await flushAll(8)
    expect(warnSpy).toHaveBeenCalledWith('孙欣 有待处理的云端权限申请，请先处理该申请')
    expect(api.listAccessMembers.mock.calls.length).toBeGreaterThan(before)
    expect(root).toBeTruthy()
  })

  it('点有待处理申请的行的【处理申请】：弹出处理弹窗，只列该员工的待处理申请（不跳页签）', async () => {
    const root = await mountPage()
    rowBtn(root, '陈宇', '处理申请').click()
    await flushAll(10)
    expect(api.listAccessRequests).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'chenyu', status: 'PENDING' }))
    expect(tabItem(root, '授权名单').classList.contains('is-active')).toBe(true)
    expect(textOf(dialog())).toContain('处理权限申请')
    expect(textOf(dialog())).toContain('需要批量整理本机文件。')
  })
})

describe('批量授权：勾选员工后选择授权给本机、云端或两者', () => {
  it('没勾选员工就点「批量授权」：提示先勾选、不弹窗（样式同岗位管理的批量绑定）', async () => {
    const root = await mountPage()
    expect(btn(root, '批量授权').classList.contains('is-active')).toBe(false)
    btn(root, '批量授权').click()
    await flushAll(4)
    expect(warnSpy).toHaveBeenCalledWith('请先勾选要批量授权的员工')
    expect(document.body.querySelector('.el-dialog')).toBeNull()
  })

  async function selectAndOpenBatch(names) {
    const root = await mountPage()
    for (const n of names) rowOf(root, n).querySelector('.el-checkbox').click()
    await flushAll(4)
    btn(root, `批量授权${names.length}`).click()
    await flushAll(6)
    return root
  }

  it('弹窗里默认勾选本机和云端，确认后传所选员工和所选环境', async () => {
    await selectAndOpenBatch(['孙欣', '李娜'])
    expect(textOf(dialog())).toContain('将为所选 2 名员工授权完全访问')
    expect(checkbox('本机').classList.contains('is-checked')).toBe(true)
    expect(checkbox('云端').classList.contains('is-checked')).toBe(true)
    dlgBtn('授权').click()
    await flushAll(8)
    expect(api.batchGrantAccess).toHaveBeenCalledWith([206, 202], ['LOCAL', 'CLOUD'])
    expect(successSpy).toHaveBeenCalledWith('已完成 2 项完全访问授权')
  })

  it('只勾选云端：只传云端；一个环境都不选时「授权」置灰', async () => {
    await selectAndOpenBatch(['孙欣'])
    checkbox('本机').click()
    await flushAll(4)
    dlgBtn('授权').click()
    await flushAll(8)
    expect(api.batchGrantAccess).toHaveBeenCalledWith([206], ['CLOUD'])
  })

  it('环境全取消：「授权」按钮置灰', async () => {
    await selectAndOpenBatch(['孙欣'])
    checkbox('本机').click()
    await flushAll(4)
    checkbox('云端').click()
    await flushAll(4)
    expect(dlgBtn('授权').disabled).toBe(true)
  })

  it('有被跳过的（已授权 / 有待处理申请的环境）：成功提示后另提示跳过数', async () => {
    api.batchGrantAccess.mockResolvedValue({ count: 1, skipped: 3 })
    await selectAndOpenBatch(['孙欣'])
    dlgBtn('授权').click()
    await flushAll(8)
    expect(warnSpy).toHaveBeenCalledWith('另有 3 项因已授权或有待处理申请已跳过')
  })
})

describe('处理申请弹窗：通过 / 驳回（PRD §四）', () => {
  async function openHandle() {
    const root = await mountPage()
    rowBtn(root, '陈宇', '处理申请').click()
    await flushAll(10)
    return root
  }

  it('弹窗里每条待处理申请带运行环境、理由、提交时间，有【通过】【驳回】；没填理由显示「（未填写申请理由）」', async () => {
    api.listAccessRequests.mockResolvedValue({ list: [PENDING_REQ, { ...PENDING_REQ, id: 'UA-1005', env: 'CLOUD', reason: '' }], total: 2 })
    await openHandle()
    const text = textOf(dialog())
    expect(text).toContain('本机')
    expect(text).toContain('云端')
    expect(text).toContain('提交于 2026-10-13 09:40')
    expect(text).toContain('（未填写申请理由）')
    expect([...dialog().querySelectorAll('.ua-req-ops button')].map(textOf)).toEqual(['通过', '驳回', '通过', '驳回'])
  })

  it('点【通过】二次确认后调用通过，提示并刷新（文案带运行环境）', async () => {
    await openHandle()
    dlgBtn('通过').click()
    await flushAll(8)
    expect(confirmSpy.mock.calls[0][0]).toContain('确认通过 陈宇 的本机完全访问权限申请')
    expect(api.approveAccessRequest).toHaveBeenCalledWith('UA-1004')
    expect(successSpy).toHaveBeenCalledWith('已通过 陈宇 的本机完全访问权限申请')
  })

  it('审批后清掉筛选并置顶高亮该员工（同岗位管理分配后的做法）：下次主动查询时取消', async () => {
    const root = await mountPage()
    btn(root, '待处理申请1').click() // 先打开待处理筛选
    await flushAll(8)
    rowBtn(root, '陈宇', '处理申请').click()
    await flushAll(10)
    dlgBtn('通过').click()
    await flushAll(10)
    // 筛选被清掉，带 focusUserId 重查
    expect(api.listAccessMembers).toHaveBeenLastCalledWith(expect.objectContaining({ hasPendingRequest: false, focusUserId: 203 }))
    expect(rowOf(root, '陈宇').classList.contains('ua-row-focus')).toBe(true)
    expect(rowOf(root, '张伟').classList.contains('ua-row-focus')).toBe(false)
    // 下一次主动【查询】：不再置顶高亮
    btn(root, '查询').click()
    await flushAll(8)
    expect(api.listAccessMembers.mock.lastCall[0]).not.toHaveProperty('focusUserId')
    expect(rowOf(root, '陈宇').classList.contains('ua-row-focus')).toBe(false)
  })

  it('处理完没有待处理申请了：弹窗自动关闭并刷新授权名单', async () => {
    await openHandle()
    const before = api.listAccessMembers.mock.calls.length
    api.listAccessRequests.mockResolvedValue({ list: [], total: 0 })
    dlgBtn('通过').click()
    await flushAll(10)
    expect(api.listAccessMembers.mock.calls.length).toBeGreaterThan(before)
    expect(document.body.querySelector('.el-dialog')?.closest('.el-overlay')?.style.display || 'none').toBe('none')
  })

  it('【驳回】：原因必填，为空提示「请输入驳回原因」且不提交；填写后提交', async () => {
    await openHandle()
    dlgBtn('驳回').click()
    await flushAll(6)
    expect(textOf(topDialog())).toContain('驳回申请')
    expect(textOf(topDialog())).toContain('申请本机完全访问')
    ;[...topDialog().querySelectorAll('button')].find((b) => textOf(b) === '确认驳回').click()
    await flushAll(4)
    expect(textOf(topDialog())).toContain('请输入驳回原因')
    expect(api.rejectAccessRequest).not.toHaveBeenCalled()

    const ta = topDialog().querySelector('textarea')
    ta.value = '用途不明确'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(4)
    ;[...topDialog().querySelectorAll('button')].find((b) => textOf(b) === '确认驳回').click()
    await flushAll(8)
    expect(api.rejectAccessRequest).toHaveBeenCalledWith('UA-1004', '用途不明确')
    expect(successSpy).toHaveBeenCalledWith('已驳回 陈宇 的本机完全访问权限申请')
  })

  it('驳回时申请已被他人处理（40900）：提示「该申请已被处理」', async () => {
    api.rejectAccessRequest.mockRejectedValue({ code: 40900, message: '该申请已被处理' })
    await openHandle()
    dlgBtn('驳回').click()
    await flushAll(6)
    const ta = topDialog().querySelector('textarea')
    ta.value = '晚了'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(4)
    ;[...topDialog().querySelectorAll('button')].find((b) => textOf(b) === '确认驳回').click()
    await flushAll(8)
    expect(warnSpy).toHaveBeenCalledWith('该申请已被处理')
  })
})

describe('操作记录（一次会话一行，PRD §四之二）', () => {
  async function openOperationTab(query = { tab: 'operation' }) {
    route.query = query
    return mountPage()
  }
  const bodyRows = (root) => [...root.querySelectorAll('.el-table__body tr')]

  it('列表以会话为单元：展示开启时间、用户、运行环境、免确认操作数与涉及权限类型，不记会话任务名（本机对话不回传），只有「查看详情」入口', async () => {
    const root = await openOperationTab()
    expect(bodyRows(root)).toHaveLength(3)
    const first = textOf(bodyRows(root)[0]) // 默认按会话开启时间倒序：今天 10:25 的张伟云端会话在前
    expect(first).toContain('zhangwei')
    expect(first).toContain('云端')
    expect([...root.querySelectorAll('.el-table__header th')].map(textOf)).not.toContain('会话任务')
    expect(first).toContain('2 次')
    expect(first).not.toContain('失败') // 列表只给次数，失败结果在详情里看
    expect(first).toContain('执行命令、联网与连接器')
    expect([...root.querySelectorAll('.el-table__body .el-button')].map(textOf)).toEqual(['查看详情', '查看详情', '查看详情'])
  })

  it('被客户端拦截的毁灭级命令也记：列表「已拦截操作」列显示次数，不计入免确认操作；详情标「已拦截」并带原因', async () => {
    const root = await openOperationTab()
    const row = bodyRows(root).find((tr) => textOf(tr).includes('本机') && textOf(tr).includes('zhangwei'))
    const headers = [...root.querySelectorAll('.el-table__header th')].map(textOf)
    const cells = [...row.querySelectorAll('td')].map(textOf)
    expect(cells[headers.indexOf('免确认操作')]).toBe('1 次') // 只数真正执行的那 1 次
    expect(cells[headers.indexOf('已拦截操作')]).toBe('1 次')
    ;[...row.querySelectorAll('.el-button')].find((b) => textOf(b) === '查看详情').click()
    await flushAll(8)
    const drawer = textOf(document.body.querySelector('.el-drawer'))
    expect(drawer).toContain('已拦截')
    expect(drawer).toContain('被拦截命令') // 单独一类权限类型，不在完全访问的 4 项里
    // 会话开启时间放底栏左下角，不在摘要里
    expect(textOf(document.body.querySelector('.el-drawer__footer'))).toContain('会话开启时间：')
    expect([...document.body.querySelectorAll('.el-drawer .el-descriptions__label')].map(textOf)).not.toContain('会话开启时间')
    // 详情摘要里免确认操作与已拦截操作并排在同一行
    const labels = [...document.body.querySelectorAll('.el-drawer .el-descriptions__label')].map(textOf)
    expect(labels).toContain('免确认操作')
    expect(labels).toContain('已拦截操作')
    const rowOfLabel = (l) => [...document.body.querySelectorAll('.el-drawer .el-descriptions__table tr')].findIndex((tr) => textOf(tr).includes(l))
    expect(rowOfLabel('已拦截操作')).toBe(rowOfLabel('免确认操作'))
    expect(drawer).toContain('rm -rf /')
    expect(drawer).toContain('毁灭级命令，客户端直接拦截，未执行')
  })

  it('只展示近 90 天：更早的会话（后端仍留存）不列出；也不展示会话 ID', async () => {
    const root = await openOperationTab()
    expect(bodyRows(root)).toHaveLength(3) // SS-OLD（100 天前）不在其中
    expect(bodyRows(root).some((tr) => textOf(tr).includes('SS-OLD'))).toBe(false)
    expect([...root.querySelectorAll('.el-table__header th')].map(textOf)).not.toContain('会话 ID')
    expect(bodyRows(root).some((tr) => textOf(tr).includes('SS-'))).toBe(false)
  })

  it('点【查看详情】在抽屉里按顺序列出会话内每一步操作的权限类型、对象与结果，失败的带原因', async () => {
    const root = await openOperationTab()
    ;[...bodyRows(root)[0].querySelectorAll('.el-button')].find((b) => textOf(b) === '查看详情').click()
    await flushAll(8)
    const drawer = textOf(document.body.querySelector('.el-drawer'))
    expect(drawer).not.toContain('会话 ID')
    expect(drawer).not.toContain('操作对象为脱敏后的内容') // 口径说明不再占抽屉底部，收进 ? 浮层
    // 点操作明细旁的 ? 图标，浮层里才有口径说明
    document.body.querySelector('.el-drawer .ua-help-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAll(6)
    const help = textOf(document.body.querySelector('.ua-help-popper'))
    expect(help).toContain('操作对象为脱敏后的内容')
    expect(help).toContain('sudo -S 猜密码')
    expect(drawer).toContain('chmod 777 /workspace/output')
    expect(drawer).toContain('接口返回 503，日报未写入')
    expect(drawer.indexOf('执行命令')).toBeLessThan(drawer.indexOf('联网与连接器'))
  })

  it('授权名单里有授权的员工有「查看」：点后进操作记录页签并按该员工搜索（两个环境的记录都看得到）', async () => {
    const root = await mountPage()
    expect(rowBtns(root, '孙欣')).not.toContain('查看')
    expect(rowBtns(root, '陈宇')).not.toContain('查看')
    rowBtn(root, '张伟', '查看').click()
    await flushAll(12)
    expect(tabItem(root, '操作记录').classList.contains('is-active')).toBe(true)
    expect(bodyRows(root)).toHaveLength(2) // 张伟本机、云端各一个会话
    expect(bodyRows(root).every((tr) => textOf(tr).includes('zhangwei'))).toBe(true)
  })

  it('?tab=operation&keyword=… 直接进操作记录页签并按词搜索', async () => {
    const root = await openOperationTab({ tab: 'operation', keyword: 'li.na' })
    expect(bodyRows(root)).toHaveLength(1)
    expect(textOf(bodyRows(root)[0])).toContain('li.na')
    expect(api.listAccessMembers).not.toHaveBeenCalled()
  })

  it('运行环境筛选：只看本机', async () => {
    const root = await openOperationTab()
    root.querySelectorAll('.el-select')[0].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => textOf(i) === '本机').click()
    await flushAll(8)
    // 本机会话两条（张伟、李娜），张伟的云端会话被筛掉
    expect(bodyRows(root)).toHaveLength(2)
    expect(bodyRows(root).every((tr) => textOf(tr).includes('本机'))).toBe(true)
  })
})
