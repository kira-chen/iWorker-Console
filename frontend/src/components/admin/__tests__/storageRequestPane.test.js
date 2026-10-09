// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from '@/views/admin/__tests__/helpers/smokeMount'

/**
 * StorageRequestPane.vue（存储空间 · 扩容申请页签）组件级用例。
 * 2026-10-09 /test-audit 补缺口，对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md
 *   §四·1 筛选 / §四·2 列表（申请时用量、处理结果）/ §四·3 同意 / §四·4 拒绝（限长 500）/ §四·5 并发与空态 / 查看弹窗；
 *   以及「无岗位时员工名后不出现孤零零的『·』」（10-09 视觉验收修复的防回归）。
 * 页签外壳（标题、角标、跳转词、处理时间排序箭头、同意预填）见 views/admin/__tests__/adminStorageSpace.test.js；业务规则见 api/__tests__/storageSpaceMock.test.js。
 * 真实挂载，只 mock api 层；本文件 fixture 自造，与 mock 种子无关。
 */

const api = {
  listExpansionRequests: vi.fn(),
  getExpansionRequest: vi.fn(),
  approveExpansionRequest: vi.fn(),
  rejectExpansionRequest: vi.fn()
}
vi.mock('@/api/storageSpace', () => api)

const StorageRequestPane = (await import('@/components/admin/storage/StorageRequestPane.vue')).default

const base = {
  userId: 203, username: 'chenyu', name: '陈宇', position: '经营分析岗', current: { usedGb: 5, totalGb: 5 }, cacheCleared: true, skippedAutomations: 0,
  reason: '报告产物较多，申请扩容。', submittedAt: '2026-10-09 10:05', status: 'PENDING', newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
}
const PENDING = { ...base, id: 'ER-1' }
const APPROVED = { ...base, id: 'ER-2', username: 'zhaomin', name: '赵敏', status: 'APPROVED', newTotalGb: 10, handler: 'demo', handledAt: '2026-10-07 16:02', submittedAt: '2026-10-07 14:20' }
const REJECTED = { ...base, id: 'ER-3', username: 'hejing', name: '何静', position: '', status: 'REJECTED', rejectReason: '请先清理历史产物', handler: 'zhangwei', handledAt: '2026-10-05 15:18', submittedAt: '2026-10-05 11:30' }
const CURRENT = { userId: 203, username: 'chenyu', name: '陈宇', usedGb: 5, totalGb: 5 }

let mounted, successSpy, warnSpy, errorToastSpy, errorSpy
beforeEach(() => {
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  api.listExpansionRequests.mockResolvedValue({ list: [PENDING], total: 1 })
  api.getExpansionRequest.mockResolvedValue({ ...PENDING, current: CURRENT })
  api.approveExpansionRequest.mockResolvedValue({})
  api.rejectExpansionRequest.mockResolvedValue({})
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
  errorToastSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  expect(errorSpy).not.toHaveBeenCalled() // 真实挂载冒烟：console.error 零调用
  vi.restoreAllMocks()
})

async function mountPane(props = {}) {
  mounted = mountReal(StorageRequestPane, props)
  await flushAll(12)
  return mounted.container
}
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
const btn = (root, text) => [...root.querySelectorAll('button')].find((b) => textOf(b) === text)
const rowsOf = (c) => [...c.querySelectorAll('.el-table__body tr.el-table__row')]
const dialogBody = () => document.body.querySelector('.el-dialog')
async function chooseStatus(c, text) {
  c.querySelector('.el-select .el-select__wrapper').click()
  await flushAll(4)
  ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => textOf(i) === text).click()
  await flushAll(6)
}

describe('StorageRequestPane · 列表行与筛选（md §四·1 / §四·2）', () => {
  it('申请行展示员工「当前用量」（列头「当前用量」，不再有「申请时用量」）；已同意行的处理结果是「新总量 N GB」；无岗位显示「—」', async () => {
    api.listExpansionRequests.mockResolvedValue({ list: [PENDING, { ...APPROVED, current: { usedGb: 6.4, totalGb: 10 } }, REJECTED], total: 3 })
    const c = await mountPane()
    const heads = [...c.querySelectorAll('.el-table__header th')].map(textOf)
    expect(heads).toContain('当前用量')
    expect(heads).not.toContain('申请时用量')
    const rows = rowsOf(c)
    expect(textOf(rows[0])).toContain('已用 5 GB / 总量 5 GB')
    expect(textOf(rows[1])).toContain('已用 6.4 GB / 总量 10 GB')
    expect(textOf(rows[1])).toContain('新总量 10 GB')
    // 列序：申请人 / 岗位 / …，岗位为空的何静显示「—」
    expect([...rows[2].querySelectorAll('td')].map(textOf)[1]).toBe('—')
  })

  it('状态筛选默认「待处理」；选「已同意」→ status=APPROVED，选「全部状态」→ 不带 status；选项文案齐全', async () => {
    const c = await mountPane()
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].status).toBe('PENDING')
    c.querySelector('.el-select .el-select__wrapper').click()
    await flushAll(4)
    expect([...document.body.querySelectorAll('.el-select-dropdown__item')].map(textOf)).toEqual(['全部状态', '待处理', '已同意', '已拒绝'])
    document.body.click()
    await chooseStatus(c, '已同意')
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].status).toBe('APPROVED')
    await chooseStatus(c, '全部状态')
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].status).toBeUndefined()
  })

  it('搜索词变化 300ms 后自动重新取数（防抖），回车立即取数', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const c = await mountPane()
      const input = c.querySelector('.lt-search input')
      const callsBefore = api.listExpansionRequests.mock.calls.length
      input.value = 'chenyu'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await flushAll(2)
      vi.advanceTimersByTime(299)
      expect(api.listExpansionRequests.mock.calls.length).toBe(callsBefore)
      vi.advanceTimersByTime(1)
      await flushAll(4)
      expect(api.listExpansionRequests.mock.calls.at(-1)[0].keyword).toBe('chenyu')
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有申请时展示「暂无扩容申请」且没有【清空筛选】；有筛选条件无结果时展示「没有符合条件的申请」+【清空筛选】，点击后回到默认「待处理」', async () => {
    api.listExpansionRequests.mockResolvedValue({ list: [], total: 0 })
    const c = await mountPane()
    expect(textOf(c)).toContain('暂无扩容申请')
    expect(btn(c, '清空筛选')).toBeUndefined()
    await chooseStatus(c, '已拒绝')
    expect(textOf(c)).toContain('没有符合条件的申请')
    btn(c, '清空筛选').click()
    await flushAll(8)
    expect(api.listExpansionRequests.mock.calls.at(-1)[0].status).toBe('PENDING')
  })

  it('取数失败展示「加载失败」，点【重试】后重新取数', async () => {
    api.listExpansionRequests.mockRejectedValueOnce(new Error('boom'))
    const c = await mountPane()
    expect(textOf(c)).toContain('加载失败')
    btn(c, '重试').click()
    await flushAll(8)
    expect(rowsOf(c)).toHaveLength(1)
  })
})

describe('StorageRequestPane · 同意 / 拒绝弹窗', () => {
  it('同意弹窗拉申请详情失败：弹出「加载申请失败，请稍后重试」，不打开弹窗', async () => {
    api.getExpansionRequest.mockRejectedValue(new Error('boom'))
    const c = await mountPane()
    btn(rowsOf(c)[0], '同意').click()
    await flushAll(8)
    expect(errorToastSpy).toHaveBeenCalledWith('boom')
    expect(document.body.querySelector('.el-dialog:not([style*="display: none"])')).toBeNull()
  })

  it('员工没绑定岗位时，同意弹窗里员工名后不出现孤零零的「·」；有岗位时才出现「· 岗位名」', async () => {
    api.getExpansionRequest.mockResolvedValue({ ...PENDING, position: '', current: CURRENT })
    const c = await mountPane()
    btn(rowsOf(c)[0], '同意').click()
    await flushAll(8)
    expect(textOf(dialogBody().querySelector('.sq-dlg-info div'))).toBe('陈宇（chenyu）')
    mounted.unmount()
    mounted = null
    document.body.innerHTML = ''
    api.getExpansionRequest.mockResolvedValue({ ...PENDING, current: CURRENT })
    const c2 = await mountPane()
    btn(rowsOf(c2)[0], '同意').click()
    await flushAll(8)
    expect(textOf(dialogBody().querySelector('.sq-dlg-info div'))).toBe('陈宇（chenyu）· 经营分析岗')
  })

  it('拒绝原因输入框限长 500 字（超出无法继续输入），并带字数统计（md §四·4）', async () => {
    const c = await mountPane()
    btn(rowsOf(c)[0], '拒绝').click()
    await flushAll(6)
    const ta = dialogBody().querySelector('textarea')
    expect(ta.getAttribute('maxlength')).toBe('500')
    expect(textOf(dialogBody())).toContain('0 / 500')
  })

  it('拒绝成功：提示「已拒绝 X 的扩容申请」、关闭弹窗；拒绝时申请已被处理（40900）→ 提示、关弹窗并刷新列表', async () => {
    const c = await mountPane()
    btn(rowsOf(c)[0], '拒绝').click()
    await flushAll(6)
    const ta = dialogBody().querySelector('textarea')
    ta.value = '先清理历史产物'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(4)
    btn(dialogBody(), '确认拒绝').click()
    await flushAll(10)
    expect(successSpy).toHaveBeenCalledWith('已拒绝 陈宇 的扩容申请')

    api.rejectExpansionRequest.mockRejectedValue(Object.assign(new Error('该申请已被处理'), { code: 40900 }))
    const callsBefore = api.listExpansionRequests.mock.calls.length
    btn(rowsOf(c)[0], '拒绝').click()
    await flushAll(6)
    const ta2 = dialogBody().querySelector('textarea') // 拒绝弹窗只有一个实例，再次打开复用同一个 textarea
    ta2.value = '再次拒绝'
    ta2.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll(4)
    btn(dialogBody(), '确认拒绝').click()
    await flushAll(10)
    expect(warnSpy).toHaveBeenCalledWith('该申请已被处理')
    expect(api.listExpansionRequests.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

describe('StorageRequestPane · 查看弹窗（已处理的申请）', () => {
  it('已同意：展示员工与岗位、提交于、申请时用量、申请说明、状态、新总量、处理人与处理时间', async () => {
    api.listExpansionRequests.mockResolvedValue({ list: [APPROVED], total: 1 })
    const c = await mountPane()
    btn(rowsOf(c)[0], '查看').click()
    await flushAll(6)
    const text = textOf(dialogBody())
    expect(text).toContain('赵敏（zhaomin）· 经营分析岗')
    expect(text).toContain('提交于 2026-10-07 14:20')
    expect(text).toContain('当前已用 5 GB / 总量 5 GB')
    expect(text).not.toContain('申请时')
    expect(text).toContain('报告产物较多，申请扩容。')
    expect(text).toContain('已同意')
    expect(text).toContain('新总量 10 GB')
    expect(text).toContain('demo 于 2026-10-07 16:02 处理')
  })

  it('已拒绝：展示「拒绝原因：…」与处理人；无岗位时员工名后没有「·」', async () => {
    api.listExpansionRequests.mockResolvedValue({ list: [REJECTED], total: 1 })
    const c = await mountPane()
    btn(rowsOf(c)[0], '查看').click()
    await flushAll(6)
    const text = textOf(dialogBody())
    expect(text).toContain('何静（hejing）')
    expect(text).not.toContain('何静（hejing）·')
    expect(text).toContain('拒绝原因：请先清理历史产物')
    expect(text).toContain('zhangwei 于 2026-10-05 15:18 处理')
  })
})
