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
 * 2026-09-12 审计 K30 ①②③ 闭环后补：§三.3.6 L222 默认规格【删除】置灰 + 悬停提示、§二.3 L110【清空筛选】、
 *   §三.1 L123-127 列格式「2 核 / 4 Gi」「20 Gi」「10 分钟」「20 分钟」「不限 / 24 小时」。
 */

const api = { listRuntimeSpecs: vi.fn(), deleteRuntimeSpec: vi.fn(), getRuntimeSpec: vi.fn(), getRuntimeSpecLimits: vi.fn(), createRuntimeSpec: vi.fn(), updateRuntimeSpec: vi.fn(), listRuntimeSpecUsers: vi.fn(), assignRuntimeSpecUsers: vi.fn(), applyRuntimeSpecForUser: vi.fn(), unassignRuntimeSpecUser: vi.fn() }
vi.mock('@/api/runtimeSpec', () => api)
vi.mock('@/api/position', () => ({ listPositions: vi.fn().mockResolvedValue({ list: [], total: 0 }) }))
// 访问审计「查看」跳转会注入 ?keyword=；本文件不测该跳转本身（见 adminLoginLogsOps.test.js），只需 useRoute() 不炸。
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

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
    const timeTh = [...mounted.container.querySelectorAll('.el-table__header th')].find((th) => th.textContent.includes('最近更新时间'))  // md prd.运行规格.md L131 列头（09-17 对齐 0914 C2）
    expect(timeTh.classList.contains('col-nowrap')).toBe(true)
    expect(mounted.container.querySelector('.list-pager-info').textContent).toContain('共 5 ')
    expect(consoleErr).not.toHaveBeenCalled()
  })

  it('最大存活时长：0 → 「不限」，24 → 「24 小时」（md §三.1 L127「0 展示为不限」；小时写法照 L125 分钟同款）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    expect(rowByName('标准').textContent).toContain('不限')
    expect(rowByName('重').textContent).toContain('24 小时')
    expect(rowByName('重').textContent).not.toContain('不限')
  })

  it('列格式逐字 md §三.1 L123-126：「4 核 / 16 Gi」「100 Gi」「10 分钟」「20 分钟」；不再出现「4c / 16Gi」「min」（审计 K30③）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    const cells = [...rowByName('重').querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())
    expect(cells).toContain('4 核 / 16 Gi')
    expect(cells).toContain('100 Gi')
    expect(cells).toContain('10 分钟')
    expect(cells).toContain('20 分钟')
    expect(rowByName('重').textContent).not.toMatch(/\dc \//)
    expect(rowByName('重').textContent).not.toMatch(/\d min/)
    expect(rowByName('标准').textContent).toContain('2 核 / 4 Gi')
  })

  it('默认规格【删除】置灰且悬停提示「默认运行规格用于平台兜底，不能删除」；非默认规格无该提示（md §三.3.6 L222，审计 K30①）', async () => {
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    const defWrap = rowBtn(rowByName('标准'), '删除').closest('.rs-del-wrap')
    expect(rowBtn(rowByName('标准'), '删除').disabled).toBe(true)
    expect(defWrap.getAttribute('title')).toBe('默认运行规格用于平台兜底，不能删除')
    const otherWrap = rowBtn(rowByName('高敏'), '删除').closest('.rs-del-wrap')
    expect(otherWrap.hasAttribute('title')).toBe(false)
  })

  it('无查询结果 → 空态「没有符合条件的运行规格」+【清空筛选】；点击后关键词与使用状态清空并按默认条件重查、按钮消失（md §二.3 L110，审计 K30②）', async () => {
    api.listRuntimeSpecs.mockImplementation((params = {}) => Promise.resolve(
      params.keyword || params.usage
        ? { list: [], total: 0, summary: SUMMARY }
        : { list: LIST, total: LIST.length, summary: SUMMARY }
    ))
    mounted = mountReal(AdminRuntimeSpecs)
    await flushAll(10)
    expect(mounted.container.querySelector('.rs-empty-actions')).toBeNull() // 有数据不出
    const input = mounted.container.querySelector('input[placeholder="搜索规格名称或能力边界说明"]')
    input.value = '不存在的规格'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(8)
    expect(mounted.container.querySelector('.ls-empty-text').textContent).toBe('没有符合条件的运行规格')
    expect(input.value).toBe('不存在的规格') // 保留当前查询条件
    const clearBtn = [...mounted.container.querySelectorAll('.rs-empty-actions .el-button')].find((b) => b.textContent.trim() === '清空筛选')
    expect(clearBtn).toBeTruthy()
    clearBtn.click()
    await flushAll(10)
    // useAdminList 会剔除空筛选项：重查参数里不再有 keyword / usage，且回第 1 页
    const last = api.listRuntimeSpecs.mock.calls.at(-1)[0]
    expect(last).toMatchObject({ page: 1 })
    expect(last).not.toHaveProperty('keyword')
    expect(last).not.toHaveProperty('usage')
    expect(input.value).toBe('')
    expect(rows()).toHaveLength(5)
    expect(mounted.container.querySelector('.rs-empty-actions')).toBeNull()
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
