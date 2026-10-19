// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, reactive, nextTick } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { installJsdomPolyfills } from '@/views/admin/__tests__/helpers/smokeMount'

/**
 * UserAccessHandleDialog（06 组织 / 用户访问权限 · 处理权限申请弹窗）。
 * 待办 yuepu#96：①关掉 A 再开 B，取数完成前不能留着 A 的申请（否则【通过】【驳回】点到别人的单子），迟到的响应也不能覆盖；
 * 另：【通过】确认框 + 请求期间不能重复提交。
 * 业务规则（状态流转、审计）见 api/__tests__/userAccessMock.test.js。
 */
const api = {
  listAccessRequests: vi.fn(),
  approveAccessRequest: vi.fn(),
  rejectAccessRequest: vi.fn()
}
vi.mock('@/api/userAccess', () => api)

const Dialog = (await import('@/components/admin/userAccess/UserAccessHandleDialog.vue')).default

const req = (userId, name, id) => ({
  id, userId, username: `u${userId}`, name, position: '', env: 'LOCAL', reason: '', submittedAt: '2026-10-19 09:00', status: 'PENDING'
})
const A = { userId: 1, username: 'u1', name: '甲', position: '' }
const B = { userId: 2, username: 'u2', name: '乙', position: '' }
const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async (n = 6) => { for (let i = 0; i < n; i++) { await Promise.resolve(); await nextTick() } }

let app, container, state
function mount() {
  installJsdomPolyfills()
  state = reactive({ visible: false, member: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () => h(Dialog, {
      visible: state.visible,
      member: state.member,
      'onUpdate:visible': (v) => (state.visible = v)
    })
  })
  app.use(ElementPlus)
  app.mount(container)
}
const open = async (member) => { state.member = member; state.visible = true; await flush() }
const close = async () => { state.visible = false; await flush() }
const dialogText = () => document.body.querySelector('.el-dialog')?.textContent || ''
const approveBtns = () => [...document.body.querySelectorAll('.el-dialog .el-button')].filter((b) => b.textContent.trim() === '通过')

beforeEach(() => {
  api.listAccessRequests.mockReset()
  api.approveAccessRequest.mockReset().mockResolvedValue({})
  api.rejectAccessRequest.mockReset()
  mount()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('处理申请弹窗：切换员工不串单（yuepu#96①）', () => {
  it('关掉甲再开乙：乙的取数没回来前，列表是空的、没有任何【通过】按钮（不留甲的申请）', async () => {
    api.listAccessRequests.mockResolvedValueOnce({ list: [req(1, '甲', 'UA-1')] })
    await mount_open_A()
    expect(approveBtns()).toHaveLength(1)

    const slow = deferred()
    api.listAccessRequests.mockReturnValueOnce(slow.promise)
    await close()
    await open(B)
    expect(approveBtns()).toHaveLength(0)
    expect(dialogText()).not.toContain('UA-1')

    slow.resolve({ list: [req(2, '乙', 'UA-2')] })
    await flush()
    expect(approveBtns()).toHaveLength(1)
  })

  it('甲的响应迟到：不能覆盖已经换成乙之后的列表（请求序号）', async () => {
    const slowA = deferred()
    api.listAccessRequests.mockReturnValueOnce(slowA.promise)
    await open(A)
    api.listAccessRequests.mockResolvedValueOnce({ list: [req(2, '乙', 'UA-2')] })
    await close()
    await open(B)
    expect(approveBtns()).toHaveLength(1)

    slowA.resolve({ list: [req(1, '甲', 'UA-1')] })
    await flush()
    // 甲迟到的结果被丢弃：仍只有乙的一条
    expect(approveBtns()).toHaveLength(1)
    expect(api.listAccessRequests).toHaveBeenCalledTimes(2)
  })

  async function mount_open_A() { await open(A) }
})

describe('【通过】防重复提交（yuepu#96 顺手清理）', () => {
  it('确认框与请求期间再点【通过】不会重复提交：approve 只调一次', async () => {
    api.listAccessRequests.mockResolvedValue({ list: [req(1, '甲', 'UA-1')] })
    const confirm = deferred()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(confirm.promise)
    await open(A)

    approveBtns()[0].click()
    approveBtns()[0].click()
    await flush()
    confirm.resolve('confirm')
    await flush()

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(api.approveAccessRequest).toHaveBeenCalledTimes(1)
  })
})
