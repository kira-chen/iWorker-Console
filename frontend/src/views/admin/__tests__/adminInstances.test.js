// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminInstances.vue（实例管理）真实挂载单测。
 * 2026-10-08 对齐 04运行/实例管理/prd.实例管理.md §五 / §七 / §九：三种查看方式（按规格 / 按岗位 / 实例明细）、
 * 四张指标卡、实例明细列与实例详情；本页只管实例，不含任务 / 排队 / 会话。
 * 状态机缺边（启动中→运行中/空闲、回收中→移除）见待办 clcao#2，此处不覆盖。
 * 只 mock @/api/instance；指标卡用例改喂 instanceMock 真种子以核对真实计数。
 *
 * 2026-10-08 补主流程（对齐同一 md §五.2 指标卡下钻与再次点击取消 / §六.3 汇总按筛选计算、【查看实例】带可见筛选 /
 * §八.4 不可操作展示原因 / §九 重建确认展示原规格与目标规格、提交成功 / 失败提示）。
 * 已登记缺陷不在此写成正常断言：「规格待生效」卡不能取消（clcao#2）、重建置灰不展示原因 / 切回汇总仍带下钻筛选（clcao#6）。
 */

// instanceMock 带 localStorage 持久化，jsdom 下置空（同 instanceMock.test.js）
vi.mock('@/api/mockPersist', () => ({ attachPersist: () => vi.fn() }))
const seed = await import('@/api/instanceMock')

const api = { listInstances: vi.fn(), operateInstance: vi.fn() }
vi.mock('@/api/instance', () => api)

const AdminInstances = (await import('@/views/admin/AdminInstances.vue')).default

const rows = [
  { id: 'ins-1', name: '张敏', username: 'zhangmin', position: '经营分析岗', status: 'RUNNING', actualSpec: '重', effectiveSpec: '重', cpu: '4 核 / 16 Gi', usage: '2.8 核 / 9.6 Gi', startedAt: '2026-09-16 09:12', active: '2026-09-16 15:28', updatedAt: '2026-09-16 15:30', error: '—', operable: false, operationHint: '实例当前繁忙', records: [] },
  { id: 'ins-2', name: '李琳', username: 'lilin', position: '客户成功岗', status: 'IDLE', actualSpec: '标准', effectiveSpec: '重', cpu: '2 核 / 4 Gi', usage: '0.2 核 / 0.8 Gi', startedAt: '2026-09-16 08:40', active: '2026-09-16 14:56', updatedAt: '2026-09-16 15:30', error: '—', operable: true, operationHint: '', records: [] }
]

let mounted
beforeEach(() => {
  vi.clearAllMocks()
  api.listInstances.mockResolvedValue({ list: rows, total: rows.length, updatedAt: '2026-09-16 15:30' })
  api.operateInstance.mockResolvedValue({})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

async function mountPage(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/instances', name: 'AdminInstances', component: AdminInstances }]
  })
  await router.push({ name: 'AdminInstances', query })
  await router.isReady()
  mounted = mountReal(AdminInstances, {}, { plugins: [router] })
  await flushAll(12)
  return mounted.container
}

async function openDetailAt(index) {
  const container = await mountPage()
  container.querySelectorAll('.view-switch .el-radio-button')[2].querySelector('input').click()
  await flushAll(6)
  const row = [...container.querySelectorAll('.el-table__body tr.el-table__row')][index]
  ;[...row.querySelectorAll('.el-button')].find((button) => button.textContent.trim() === '查看').click()
  await flushAll(6)
  return container
}

describe('AdminInstances · 实例管理范围纠偏', () => {
  it('真实挂载展示实例汇总：查看方式正好三种、四张指标卡按种子计数；实例明细表头不含任务 / 排队 / 会话', async () => {
    // 喂 instanceMock 真种子（5 个实例：运行中 ins-240901；空闲 ins-240902、ins-240904；异常 ins-240903；
    // 启动中 ins-240905；实际≠生效规格只有 ins-240904「标准→重」）
    seed.__resetInstanceMock()
    api.listInstances.mockResolvedValue(await seed.listInstances({ size: 200 }))
    const container = await mountPage()
    expect(container.textContent).toContain('实例管理')
    expect(api.listInstances).toHaveBeenCalledWith({ size: 200 })
    // 查看方式：正好三项，不多不少
    const viewOptions = [...container.querySelectorAll('.view-switch .el-radio-button')].map((b) => b.textContent.trim())
    expect(viewOptions).toEqual(['按规格', '按岗位', '实例明细'])
    // 四张指标卡：标签与数字
    const cards = [...container.querySelectorAll('.metric-card')].map((c) => [c.querySelector('span').textContent.trim(), c.querySelector('strong').textContent.trim()])
    expect(cards).toEqual([['运行中', '1'], ['空闲', '2'], ['异常', '1'], ['规格待生效', '1']])
    // 切到实例明细：表头只有实例维度的列，没有任务 / 排队 / 会话
    container.querySelectorAll('.view-switch .el-radio-button')[2].querySelector('input').click()
    await flushAll(12)
    const headers = [...container.querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim()).filter(Boolean)
    expect(headers).toContain('实例状态')
    expect(headers).toContain('当前实际规格')
    for (const word of ['任务', '排队', '会话']) {
      expect(headers.filter((h) => h.includes(word))).toEqual([])
    }
  })

  it('未定义的 view/instance 深链参数不再改变页面状态', async () => {
    const container = await mountPage({ view: 'detail', instance: 'ins-2' })
    expect(container.querySelector('.view-switch .el-radio-button.is-active').textContent.trim()).toBe('按规格')
    expect(container.textContent).not.toContain('实例详情 · 李琳')
  })
})

/* ===== 2026-10-08 主流程补缺口 ===== */
async function mountWithSeed() {
  seed.__resetInstanceMock()
  api.listInstances.mockResolvedValue(await seed.listInstances({ size: 200 }))
  return mountPage()
}
const metricCard = (c, label) => [...c.querySelectorAll('.metric-card')].find((b) => b.querySelector('span').textContent.trim() === label)
const activeView = (c) => c.querySelector('.view-switch .el-radio-button.is-active')?.textContent.trim()
const bodyRows = (c) => [...c.querySelectorAll('.el-table__body tr.el-table__row')]
const detailUsers = (c) => bodyRows(c).map((tr) => tr.querySelector('.primary-text').childNodes[0].textContent.trim())
// 工具栏三个下拉依次为：状态 / 岗位 / 运行规格；取下拉框里当前显示的已选文字（未选时为占位）
const selectShown = (c, idx) => c.querySelectorAll('.el-select')[idx].querySelector('.el-select__selected-item:not(.is-hidden)')?.textContent.trim()
const headerIndex = (c, label) => [...c.querySelectorAll('.el-table__header th')].findIndex((th) => th.textContent.trim() === label)
const groupCell = (c, groupName, label) => {
  const tr = bodyRows(c).find((r) => r.querySelector('.primary-text')?.textContent.trim() === groupName)
  return tr?.querySelectorAll('td')[headerIndex(c, label)]?.textContent.trim()
}
const pageInstance = () => mounted.app._instance.subTree.component
const drawer = () => document.body.querySelector('.el-drawer')
const drawerBtn = (text) => [...drawer().querySelectorAll('.detail-actions .el-button')].find((b) => b.textContent.trim() === text)

describe('AdminInstances · 指标卡、汇总下钻与关键词（md §五.2 / §六.3）', () => {
  it('点「异常」指标卡 → 切到实例明细、状态筛选显示「异常」、只剩周明一行；再点一次 → 取消状态筛选，5 个实例全回来', async () => {
    const c = await mountWithSeed()
    expect(activeView(c)).toBe('按规格')
    metricCard(c, '异常').click()
    await flushAll(8)
    expect(activeView(c)).toBe('实例明细')
    expect(selectShown(c, 0)).toBe('异常')
    expect(detailUsers(c)).toEqual(['周明'])
    metricCard(c, '异常').click()
    await flushAll(8)
    expect(activeView(c)).toBe('实例明细')
    expect(selectShown(c, 0)).toBe('全部状态')
    expect(detailUsers(c)).toHaveLength(5)
  })

  it('按规格汇总点「重」的【查看实例】→ 切到实例明细，运行规格筛选显示「重」，只列生效规格为「重」的张伟、赵敏', async () => {
    const c = await mountWithSeed()
    const tr = bodyRows(c).find((r) => r.querySelector('.primary-text')?.textContent.trim() === '重')
    ;[...tr.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看实例').click()
    await flushAll(8)
    expect(activeView(c)).toBe('实例明细')
    expect(selectShown(c, 2)).toBe('重')
    expect(detailUsers(c)).toEqual(['张伟', '赵敏'])
  })

  it('按规格汇总时输入关键词「赵敏」→「重」行的「当前实例」由 2 变 1（汇总按当前搜索计算，不混用全局数据）', async () => {
    const c = await mountWithSeed()
    expect(groupCell(c, '重', '当前实例')).toBe('2')
    const input = c.querySelector('input[placeholder="搜索规格、岗位、用户或实例标识"]')
    input.value = '赵敏'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(8)
    expect(groupCell(c, '重', '当前实例')).toBe('1')
    expect(groupCell(c, '标准', '当前实例')).toBeUndefined()
  })
})

describe('AdminInstances · 运行操作（md §八.4 / §九）', () => {
  it('不可操作的实例（张敏，繁忙）→ 详情里三个运行操作按钮全部置灰，并展示服务端给的原因「实例当前繁忙」', async () => {
    await openDetailAt(0)
    expect(document.body.querySelectorAll('.el-drawer')).toHaveLength(1)
    expect(drawer().textContent).toContain('实例详情 · 张敏')
    expect(['重启', '按最新规格重建', '回收'].map((t) => drawerBtn(t).disabled)).toEqual([true, true, true])
    expect(drawer().querySelector('.el-alert--warning').textContent).toContain('实例当前繁忙')
  })

  it('兜底：页面上的实例状态已过期、仍对不可操作实例触发重启 → 只提示 warning「实例当前繁忙」，不调用操作接口', async () => {
    const warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
    // 万一放行到确认框，按取消立即返回，失败落在断言上而不是等超时
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await mountPage({ view: 'detail' })
    await pageInstance().setupState.instanceAction(rows[0], 'restart')
    expect(warnSpy).toHaveBeenCalledWith('实例当前繁忙')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.operateInstance).not.toHaveBeenCalled()
  })

  it('对李琳点【按最新规格重建】→ 确认文案写明「从「标准」切换为「重」」；确认后提示「实例按最新规格重建操作已提交」并重新拉取实例', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
    await openDetailAt(1)
    const callsBefore = api.listInstances.mock.calls.length
    drawerBtn('按最新规格重建').click()
    await flushAll(10)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('从「标准」切换为「重」')
    expect(confirmSpy.mock.calls[0][1]).toBe('按最新规格重建实例')
    expect(api.operateInstance).toHaveBeenCalledWith('ins-2', 'rebuild')
    expect(successSpy).toHaveBeenCalledWith('实例按最新规格重建操作已提交')
    expect(api.listInstances.mock.calls.length).toBe(callsBefore + 1)
  })

  it('提交运行操作失败 → 错误提示展示接口给出的具体原因，不提示成功', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
    api.operateInstance.mockRejectedValue(new Error('实例状态已变化，请刷新后重试'))
    await openDetailAt(1)
    drawerBtn('重启').click()
    await flushAll(10)
    expect(api.operateInstance).toHaveBeenCalledWith('ins-2', 'restart')
    expect(errorSpy).toHaveBeenCalledWith('实例状态已变化，请刷新后重试')
    expect(successSpy).not.toHaveBeenCalled()
  })
})
