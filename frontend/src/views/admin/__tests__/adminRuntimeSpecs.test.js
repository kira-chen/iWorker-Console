// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminRuntimeSpecs.vue 页面级用例（2026-09-12 测试审计 T55·F30 新建；此前 09-11 改 4 次零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/运行规格/prd.运行规格.md
 *   §二.1 导航栏 / §二.3 页面状态（双空态）/ §三.1 列表展示与底部汇总 / §三.3.1 默认规格【删除】置灰 / §三.3.6 删除。
 *
 * 真实挂载（真 Element Plus + 真 ListStates / ListPagination / StatusTag / RuntimeSpecEditor / RuntimeSpecUserDialog），
 * 只 mock api 层；ElMessage / ElMessageBox 用 spy 拦截（不桩组件）。
 * 只写代码已实现且与 md 一致的规则：K28（校验文案）、md §二.3【清空筛选】、§三.1「2 核 / 4 Gi」列格式等代码缺陷不写。
 */

const api = { listRuntimeSpecs: vi.fn(), deleteRuntimeSpec: vi.fn(), getRuntimeSpec: vi.fn(), getRuntimeSpecLimits: vi.fn(), createRuntimeSpec: vi.fn(), updateRuntimeSpec: vi.fn(), listRuntimeSpecUsers: vi.fn(), assignRuntimeSpecUsers: vi.fn(), applyRuntimeSpecForUser: vi.fn(), unassignRuntimeSpecUser: vi.fn() }
vi.mock('@/api/runtimeSpec', () => api)
vi.mock('@/api/position', () => ({ listPositions: vi.fn().mockResolvedValue({ list: [], total: 0 }) }))

const AdminRuntimeSpecs = (await import('@/views/admin/AdminRuntimeSpecs.vue')).default

const spec = (over) => ({
  id: 0, name: '', boundaryDesc: '', cpu: 2, memoryGi: 4, diskGi: 20, readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0,
  isDefault: false, positionIds: [], positionNames: [], positionCount: 0, directUsers: [], allowUserApply: true, requireApproval: true,
  effectiveUsers: [], pendingUsers: [], usedCount: 0, pendingCount: 0, createdAt: '2026-08-15 10:20', updatedAt: '2026-08-28 09:40', ...over
})
const LIST = [
  spec({ id: 2, name: '标准', boundaryDesc: '大多数用户的常用配置', isDefault: true, allowUserApply: false, usedCount: 9, updatedAt: '2026-08-30 14:12' }),
  spec({ id: 1, name: '轻', boundaryDesc: '轻量问答与日常处理', cpu: 1, memoryGi: 2, diskGi: 5, positionIds: [402], positionNames: ['客户成功岗'], positionCount: 1, usedCount: 1, updatedAt: '2026-08-28 09:40' }),
  spec({ id: 3, name: '重', boundaryDesc: '文档处理、数据分析', cpu: 4, memoryGi: 16, diskGi: 100, maxLifetimeHours: 24, positionIds: [401], positionNames: ['财务审核岗'], positionCount: 1, directUsers: [{ username: 'zhaomin', name: '赵敏', approval: null }], usedCount: 3, updatedAt: '2026-08-29 16:55' }),
  spec({ id: 4, name: '高敏', boundaryDesc: '处理敏感数据的隔离运行环境', cpu: 2, memoryGi: 8, diskGi: 50, maxLifetimeHours: 8, updatedAt: '2026-08-18 11:30' }),
  spec({ id: 5, name: '专属 · 生产计划员', boundaryDesc: '排产表体积大', directUsers: [{ username: 'zhouming', name: '周明', approval: 'PENDING' }], updatedAt: '2026-08-26 10:08' })
]
const SUMMARY = { specCount: 5, userCount: 13, positionCount: 2 }

let mounted, confirmSpy, alertSpy, successSpy, errorSpy
beforeEach(() => {
  vi.clearAllMocks()
  api.listRuntimeSpecs.mockResolvedValue({ list: LIST, total: LIST.length, summary: SUMMARY })
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm')
  alertSpy = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue()
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

const rows = () => [...mounted.container.querySelectorAll('.el-table__body tr.el-table__row')]
const rowByName = (name) => rows().find((r) => r.querySelector('.rs-name')?.textContent.includes(name))
const rowBtn = (row, text) => [...row.querySelectorAll('.rs-actions .el-button')].find((b) => b.textContent.trim() === text)

describe('AdminRuntimeSpecs · 列表页（md 运行规格 §二 / §三）', () => {
  it('真实挂载冒烟：页头「运行规格」+ 说明 + 业务说明条、5 行、汇总行「5 个规格 · 2 个岗位已配置 · 13 个用户有生效规格」、时间列 th 带 col-nowrap、console.error 零调用（md §二.1 / §三.1）', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => { mounted = mountReal(AdminRuntimeSpecs) }).not.toThrow()
    await flushAll(10)
    const text = mounted.container.textContent
    expect(text).toContain('运行规格')
    expect(text).toContain('定义标准运行环境，通过岗位批量配置，并支持个人按需申请')
    expect(text).toContain('个人配置 ＞ 岗位规格 ＞ 平台默认')
    expect(text).toContain('新建规格')
    expect(mounted.container.querySelector('input[placeholder="搜索规格名称或能力边界说明"]')).toBeTruthy()
    expect(mounted.container.querySelector('.el-select__placeholder').textContent.trim()).toBe('全部使用状态')
    expect(rows()).toHaveLength(5)
    // 默认规格：名称后「默认」标签；适用岗位列「默认」/ 岗位名 / 「未指定」（md §三.1）
    expect(rowByName('标准').querySelector('.rs-name').textContent).toContain('默认')
    expect(rowByName('轻').textContent).toContain('客户成功岗')
    expect(rowByName('高敏').textContent).toContain('未指定')
    // 用户申请列（md §三.1）
    expect(rowByName('标准').textContent).toContain('关闭申请')
    expect(rowByName('轻').textContent).toContain('开放申请')
    // 底部汇总（md §三.1「N 个规格 · P 个岗位已配置 · M 个用户有生效规格」）
    expect(mounted.container.querySelector('.rs-foot-sum').textContent.replace(/\s+/g, ' ').trim()).toBe('5 个规格 · 2 个岗位已配置 · 13 个用户有生效规格')
    // 时间列表头不换行（2026-09-11 补 col-nowrap，否则 132px 内折成两行读不出分钟）
    const timeTh = [...mounted.container.querySelectorAll('.el-table__header th')].find((th) => th.textContent.includes('最近更新'))
    expect(timeTh.classList.contains('col-nowrap')).toBe(true)
    expect(mounted.container.querySelector('.list-pager-info').textContent).toContain('共 5 ')
    expect(consoleErr).not.toHaveBeenCalled()
  })

  it('最大存活时长：0 → 「不限」，24 → 「24 h」（md §三.1「0 展示为不限」）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    expect(rowByName('标准').textContent).toContain('不限')
    expect(rowByName('重').textContent).toContain('24 h')
    expect(rowByName('重').textContent).not.toContain('不限')
  })

  it('操作列四个按钮；默认规格【删除】置灰、其它规格可点（md §三.3.1 L154/L158）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    for (const r of rows()) {
      expect([...r.querySelectorAll('.rs-actions .el-button')].map((b) => b.textContent.trim())).toEqual(['查看', '编辑', '配置范围', '删除'])
    }
    expect(rowBtn(rowByName('标准'), '删除').disabled).toBe(true)
    expect(rowBtn(rowByName('高敏'), '删除').disabled).toBe(false)
    // 点默认规格的删除：禁用按钮不触发任何弹窗与接口
    rowBtn(rowByName('标准'), '删除').click()
    await flushAll(4)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(api.deleteRuntimeSpec).not.toHaveBeenCalled()
  })

  it('有适用岗位的规格点【删除】→ 提示窗「无法删除规格」说明「请先解除岗位配置」，不调 deleteRuntimeSpec（md §三.3.6 L224）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    rowBtn(rowByName('轻'), '删除').click()
    await flushAll(4)
    expect(alertSpy).toHaveBeenCalledWith(
      '该规格已配置给 1 个岗位（客户成功岗），请先解除岗位配置。',
      '无法删除规格',
      expect.objectContaining({ confirmButtonText: '知道了' })
    )
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.deleteRuntimeSpec).not.toHaveBeenCalled()
  })

  it('有个人配置 / 待审批申请的规格点【删除】→ 提示窗说明「请先处理后再删除」，不调 deleteRuntimeSpec（md §三.3.6 L224）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    rowBtn(rowByName('专属 · 生产计划员'), '删除').click()
    await flushAll(4)
    expect(alertSpy).toHaveBeenCalledWith(
      '该规格存在 1 个个人配置或待审批申请，请先处理后再删除。',
      '无法删除规格',
      expect.anything()
    )
    expect(api.deleteRuntimeSpec).not.toHaveBeenCalled()
  })

  it('可删规格点【删除】→ 二次确认文案逐字对齐 md §三.3.6 L225，【删除】危险样式 → deleteRuntimeSpec →「规格已删除」+ 重拉列表与汇总', async () => {
    confirmSpy.mockResolvedValue('confirm')
    api.deleteRuntimeSpec.mockResolvedValue(true)
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    const callsBefore = api.listRuntimeSpecs.mock.calls.length
    rowBtn(rowByName('高敏'), '删除').click()
    await flushAll(8)
    expect(confirmSpy).toHaveBeenCalledWith(
      '删除后规格「高敏」将不可再配置给岗位或用户，已运行实例不受影响。确认删除？',
      '删除规格',
      expect.objectContaining({ type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' })
    )
    expect(api.deleteRuntimeSpec).toHaveBeenCalledWith(4)
    expect(successSpy).toHaveBeenCalledWith('规格已删除')
    // refresh = 列表 + 汇总各重拉一次
    expect(api.listRuntimeSpecs.mock.calls.length).toBe(callsBefore + 2)
  })

  it('删除确认取消 → 不调 deleteRuntimeSpec、不重拉（md §三.3.6 L226「取消时不执行删除」）', async () => {
    confirmSpy.mockRejectedValue('cancel')
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    const callsBefore = api.listRuntimeSpecs.mock.calls.length
    rowBtn(rowByName('高敏'), '删除').click()
    await flushAll(6)
    expect(confirmSpy).toHaveBeenCalled()
    expect(api.deleteRuntimeSpec).not.toHaveBeenCalled()
    expect(api.listRuntimeSpecs.mock.calls.length).toBe(callsBefore)
  })

  it('删除失败 → toast 具体原因，列表保留（md §三.3.6 L228）', async () => {
    confirmSpy.mockResolvedValue('confirm')
    api.deleteRuntimeSpec.mockRejectedValue(new Error('规格不存在或已被删除'))
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    rowBtn(rowByName('高敏'), '删除').click()
    await flushAll(8)
    expect(errorSpy).toHaveBeenCalledWith('规格不存在或已被删除')
    expect(successSpy).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(5)
  })

  it('双空态：无筛选「还没有运行规格 · 点「新建规格」创建第一个」；有搜索词「没有符合条件的运行规格」（md §二.3）', async () => {
    api.listRuntimeSpecs.mockResolvedValue({ list: [], total: 0, summary: { specCount: 0, userCount: 0, positionCount: 0 } })
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    expect(mounted.container.querySelector('.ls-empty-text').textContent).toBe('还没有运行规格 · 点「新建规格」创建第一个')
    const input = mounted.container.querySelector('input[placeholder="搜索规格名称或能力边界说明"]')
    input.value = '不存在的规格'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(8)
    expect(api.listRuntimeSpecs).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: '不存在的规格' }))
    expect(mounted.container.querySelector('.ls-empty-text').textContent).toBe('没有符合条件的运行规格')
  })

  it('加载失败 → 「加载失败」+【重试】；点重试按当前条件重拉（md §二.3）', async () => {
    api.listRuntimeSpecs.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ list: LIST, total: 5, summary: SUMMARY })
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    expect(mounted.container.textContent).toContain('加载失败')
    const retry = [...mounted.container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试')
    retry.click()
    await flushAll(10)
    expect(rows()).toHaveLength(5)
  })
})
