// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * RuntimeSpecUserDialog.vue 用例（2026-09-12 测试审计 T55·F32 新建；此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/运行规格/prd.运行规格.md
 *   §三.3.4 配置范围（两页签、岗位继承/平台默认只读不可逐人解除、管理员配置立即生效、撤销回退）/
 *   §三.3.5 审批状态查看（待审批 / 「已为 N 个用户配置规格，立即生效」）。
 *
 * 真实挂载（真 Element Plus + 真 el-dialog / el-tabs / el-table / el-checkbox / StatusTag），只 mock api 层；
 * ElMessage / ElMessageBox 用 spy 拦截。el-dialog append-to-body → 从 document.body 取节点。
 * 组件的 visible watcher 非 immediate，用持 ref 的宿主组件驱动 false→true。
 * 不写：md §三.3.5「已驳回 / 已撤回」展示（代码无此两态，记代码缺陷低）。
 */

const api = { listRuntimeSpecUsers: vi.fn(), assignRuntimeSpecUsers: vi.fn(), unassignRuntimeSpecUser: vi.fn() }
vi.mock('@/api/runtimeSpec', () => api)

const Dialog = (await import('@/components/admin/RuntimeSpecUserDialog.vue')).default

const SPEC = { id: 3, name: '重', boundaryDesc: '文档处理、数据分析、报告生成，可处理 500MB 以内文件', allowUserApply: true }
const user = (over) => ({
  userId: 0, username: '', displayName: '', status: 'active', roles: [], currentSpecId: null, currentSpecName: '', source: 'DEFAULT',
  positionName: '', approval: null, pendingSpecName: '', isCurrent: false, isEffective: false, isPending: false, ...over
})
const USERS = [
  user({ userId: 201, username: 'zhangwei', displayName: '张伟', currentSpecId: 3, currentSpecName: '重', source: 'POSITION', positionName: '财务审核岗', isCurrent: true, isEffective: true }),
  user({ userId: 208, username: 'zhaomin', displayName: '赵敏', currentSpecId: 3, currentSpecName: '重', source: 'USER', isCurrent: true, isEffective: true }),
  user({ userId: 210, username: 'hejing', displayName: '何静', currentSpecId: 2, currentSpecName: '标准', source: 'DEFAULT', approval: 'PENDING', pendingSpecName: '重', isCurrent: true, isPending: true }),
  user({ userId: 203, username: 'chenyu', displayName: '陈宇', currentSpecId: 2, currentSpecName: '标准', source: 'DEFAULT' }),
  user({ userId: 207, username: 'liuqiang', displayName: '刘强', currentSpecId: 2, currentSpecName: '标准', source: 'DEFAULT' }),
  user({ userId: 211, username: 'wujie', displayName: '吴杰', status: 'disabled', currentSpecId: 2, currentSpecName: '标准', source: 'DEFAULT' })
]

let mounted, savedSpy, confirmSpy, successSpy, errorSpy
beforeEach(() => {
  vi.clearAllMocks()
  api.listRuntimeSpecUsers.mockResolvedValue({ list: USERS.map((u) => ({ ...u })), total: USERS.length })
  savedSpy = vi.fn()
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm')
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function open(spec = SPEC) {
  const visible = ref(false)
  const Host = defineComponent({
    setup() {
      return () => h(Dialog, { spec, visible: visible.value, 'onUpdate:visible': (v) => { visible.value = v }, onSaved: savedSpy })
    }
  })
  mounted = mountReal(Host)
  await flushAll(2)
  visible.value = true
  await flushAll(12)
  return document.body.querySelector('.el-dialog')
}
// 两个页签的表格同时在 DOM 里（非激活页签 v-show 隐藏），「生效用户与待审」取第一个 tab-pane 内的行
const rowsOf = (dlg) => [...dlg.querySelectorAll('.el-tab-pane')[0].querySelectorAll('.el-table__body tr.el-table__row')]
const rowByName = (dlg, name) => rowsOf(dlg).find((r) => r.querySelector('.rsu-user-name')?.textContent.trim() === name)
const linkBtn = (row) => row.querySelector('.el-button')
async function switchToAddTab(dlg) {
  const tab = [...dlg.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.includes('添加个人例外'))
  tab.click()
  await flushAll(6)
}

describe('RuntimeSpecUserDialog · 配置范围（md §三.3.4 / §三.3.5）', () => {
  it('打开：标题「配置范围 · 重」+ 摘要 + 两页签；「生效用户与待审」列出 3 人：岗位继承行「按岗位生效」无解除、个人配置行【解除】、待审批行【撤回】+「待审批」', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dlg = await open()
    expect(dlg).toBeTruthy()
    expect(dlg.querySelector('.el-dialog__title').textContent.trim()).toBe('配置范围 · 重')
    expect(dlg.querySelector('.rsu-summary').textContent).toContain('开放用户申请')
    expect(dlg.querySelector('.rsu-summary').textContent).toContain(SPEC.boundaryDesc)
    expect(api.listRuntimeSpecUsers).toHaveBeenCalledWith(3)
    const tabs = [...dlg.querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
    expect(tabs).toEqual(['生效用户与待审 3', '添加个人例外'])

    expect(rowsOf(dlg)).toHaveLength(3)
    const zhangwei = rowByName(dlg, '张伟')
    expect(zhangwei.textContent).toContain('岗位继承 · 财务审核岗')
    expect(zhangwei.textContent).toContain('已生效')
    expect(zhangwei.querySelector('.rsu-empty').textContent.trim()).toBe('按岗位生效')
    expect(linkBtn(zhangwei)).toBeNull() // 岗位继承关系只读，不能逐人解除（md §三.3.4）

    const zhaomin = rowByName(dlg, '赵敏')
    expect(zhaomin.textContent).toContain('个人配置')
    expect(linkBtn(zhaomin).textContent.trim()).toBe('解除')

    const hejing = rowByName(dlg, '何静')
    expect(hejing.textContent).toContain('个人申请')
    expect(hejing.textContent).toContain('待审批')
    expect(linkBtn(hejing).textContent.trim()).toBe('撤回')

    // 第一页签底部只有【关闭】
    expect([...dlg.querySelectorAll('.el-dialog__footer .el-button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
    expect(consoleErr).not.toHaveBeenCalled()
  })

  it('「添加个人例外」页签：只列非当前用户、停用用户复选框禁用；勾 2 人 →【确认配置】→ assignRuntimeSpecUsers(3, 两人) →「已为 2 个用户配置规格，立即生效」+ emit saved + 回第一页签（md §三.3.4 / §三.3.5 L218）', async () => {
    api.assignRuntimeSpecUsers.mockResolvedValue({ count: 2, pending: false })
    const dlg = await open()
    await switchToAddTab(dlg)
    const pane = dlg.querySelector('.rsu-table')
    const candidates = [...pane.querySelectorAll('.el-table__body tr.el-table__row')]
    expect(candidates.map((r) => r.querySelector('.rsu-user-name').textContent.trim())).toEqual(['陈宇', '刘强', '吴杰'])
    // 停用用户不可新增个人配置（md §三.3.4 L200）
    const wujie = candidates.find((r) => r.textContent.includes('吴杰'))
    expect(wujie.querySelector('.el-checkbox').classList.contains('is-disabled')).toBe(true)
    expect(wujie.textContent).toContain('停用')
    // 未勾选时【确认配置】禁用
    const confirmBtn = () => [...dlg.querySelectorAll('.el-dialog__footer .el-button')].find((b) => b.textContent.trim() === '确认配置')
    expect(confirmBtn().disabled).toBe(true)

    for (const name of ['陈宇', '刘强']) {
      candidates.find((r) => r.textContent.includes(name)).querySelector('.el-checkbox input[type="checkbox"]').click()
      await flushAll(2)
    }
    expect(dlg.querySelector('.rsu-selection').textContent.trim()).toBe('已选择 2 个用户')
    expect(confirmBtn().disabled).toBe(false)
    confirmBtn().click()
    await flushAll(10)
    expect(api.assignRuntimeSpecUsers).toHaveBeenCalledWith(3, ['chenyu', 'liuqiang'])
    expect(successSpy).toHaveBeenCalledWith('已为 2 个用户配置规格，立即生效')
    expect(savedSpy).toHaveBeenCalled()
    // 成功后重拉名单、回到「生效用户与待审」页签
    expect(api.listRuntimeSpecUsers).toHaveBeenCalledTimes(2)
    expect(dlg.querySelector('.el-tabs__item.is-active').textContent).toContain('生效用户与待审')
  })

  it('配置失败 → toast 失败原因、保留选择（md §三.5「个人配置失败：保留窗口中的选择结果」）', async () => {
    api.assignRuntimeSpecUsers.mockRejectedValue(new Error('用户 陈宇 已停用，不能配置规格'))
    const dlg = await open()
    await switchToAddTab(dlg)
    const row = [...dlg.querySelectorAll('.rsu-table .el-table__body tr.el-table__row')].find((r) => r.textContent.includes('陈宇'))
    row.querySelector('.el-checkbox input[type="checkbox"]').click()
    await flushAll(2)
    ;[...dlg.querySelectorAll('.el-dialog__footer .el-button')].find((b) => b.textContent.trim() === '确认配置').click()
    await flushAll(8)
    expect(errorSpy).toHaveBeenCalledWith('用户 陈宇 已停用，不能配置规格')
    expect(savedSpy).not.toHaveBeenCalled()
    expect(dlg.querySelector('.rsu-selection').textContent.trim()).toBe('已选择 1 个用户')
  })

  it('待审批行点【撤回】→ 确认窗「撤回规格申请」→ unassignRuntimeSpecUser(3, hejing) →「申请已撤回」+ emit saved（md §三.3.4 L199）', async () => {
    confirmSpy.mockResolvedValue('confirm')
    api.unassignRuntimeSpecUser.mockResolvedValue(true)
    const dlg = await open()
    linkBtn(rowByName(dlg, '何静')).click()
    await flushAll(8)
    expect(confirmSpy).toHaveBeenCalledWith(
      '撤回 何静 使用「重」的待审批申请？',
      '撤回规格申请',
      expect.objectContaining({ type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' })
    )
    expect(api.unassignRuntimeSpecUser).toHaveBeenCalledWith(3, 'hejing')
    expect(successSpy).toHaveBeenCalledWith('申请已撤回')
    expect(savedSpy).toHaveBeenCalled()
  })

  it('个人配置行点【解除】→ 确认窗「解除规格配置」说明「回退到岗位规格或平台默认规格」→ unassign →「规格配置已解除」（md §三.3.4 L198）', async () => {
    confirmSpy.mockResolvedValue('confirm')
    api.unassignRuntimeSpecUser.mockResolvedValue(true)
    const dlg = await open()
    linkBtn(rowByName(dlg, '赵敏')).click()
    await flushAll(8)
    expect(confirmSpy).toHaveBeenCalledWith(
      '解除 赵敏 的个人配置？解除后将自动回退到岗位规格或平台默认规格。',
      '解除规格配置',
      expect.objectContaining({ confirmButtonText: '确认' })
    )
    expect(api.unassignRuntimeSpecUser).toHaveBeenCalledWith(3, 'zhaomin')
    expect(successSpy).toHaveBeenCalledWith('规格配置已解除')
    expect(savedSpy).toHaveBeenCalled()
  })

  it('解除确认取消 → 不调接口、名单不变', async () => {
    confirmSpy.mockRejectedValue('cancel')
    const dlg = await open()
    linkBtn(rowByName(dlg, '赵敏')).click()
    await flushAll(6)
    expect(api.unassignRuntimeSpecUser).not.toHaveBeenCalled()
    expect(savedSpy).not.toHaveBeenCalled()
    expect(rowsOf(dlg)).toHaveLength(3)
  })

  it('无生效用户或申请 → 空态「暂无用户生效或申请此规格」；名单加载失败 → 「用户关系加载失败」+【重试】', async () => {
    api.listRuntimeSpecUsers.mockResolvedValueOnce({ list: USERS.filter((u) => !u.isCurrent), total: 3 })
    let dlg = await open()
    expect(dlg.textContent).toContain('暂无用户生效或申请此规格')
    mounted.unmount()
    document.body.innerHTML = ''

    api.listRuntimeSpecUsers.mockRejectedValueOnce(new Error('boom'))
    dlg = await open()
    expect(dlg.textContent).toContain('用户关系加载失败')
    const retry = [...dlg.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试')
    retry.click()
    await flushAll(8)
    expect(rowsOf(dlg)).toHaveLength(3)
  })
})
