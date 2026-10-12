// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '@/views/admin/__tests__/helpers/smokeMount'

/**
 * StorageQuotaPane.vue（存储空间 · 容量分配页签）组件级用例。
 * 2026-10-09 /test-audit 补缺口，对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md
 *   §三·2 筛选 / §三·3 列表（未统计行、进度条颜色、容量来源、列提示）/ §三·5 批量（红字提示、二次确认、全选不含待处理）/ §三·6 空态与【清空筛选】。
 * 页签外壳的行为（标题、角标、页签切换与跳转词）见 views/admin/__tests__/adminStorageSpace.test.js；业务规则见 api/__tests__/storageSpaceMock.test.js。
 * 真实挂载（真 Element Plus + 真 ListToolbar / ListStates / ListPagination），只 mock api 层；本文件 fixture 自造，与 mock 种子无关。
 */

const api = {
  getStorageOverview: vi.fn(),
  listStorageMembers: vi.fn(),
  adjustStorageQuota: vi.fn(),
  batchAdjustStorageQuota: vi.fn()
}
vi.mock('@/api/storageSpace', () => api)

const StorageQuotaPane = (await import('@/components/admin/storage/StorageQuotaPane.vue')).default

// 字段含义见 storageSpaceMock.toMemberRow；ratio = 已用 / 总量
const member = (over) => ({
  userId: 1, username: 'u1', name: '员工一', position: '', usedGb: 2, finalGb: 1.5, cacheGb: 0.5, totalGb: 5, ratio: 0.4,
  state: 'NORMAL', quotaSource: 'DEFAULT', statAt: '2026-10-09 09:00', pendingRequestId: null, ...over
})
const NORMAL = member({ userId: 1, username: 'normal', name: '正常员工' })
const WARN = member({ userId: 2, username: 'warn', name: '预警员工', usedGb: 4.6, ratio: 0.92, state: 'WARN', quotaSource: 'PERSONAL', totalGb: 5 })
const FULL = member({ userId: 3, username: 'full', name: '已满员工', usedGb: 5, ratio: 1, state: 'FULL' })
const PENDING = member({ userId: 4, username: 'pend', name: '待处理员工', usedGb: 5, ratio: 1, state: 'FULL', pendingRequestId: 'ER-9' })
const UNKNOWN = member({ userId: 5, username: 'unk', name: '未统计员工', usedGb: null, finalGb: null, cacheGb: null, ratio: null, state: 'UNKNOWN', statAt: null })

let mounted, successSpy, warnSpy, errorSpy
beforeEach(() => {
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  api.getStorageOverview.mockResolvedValue({ defaultQuotaGb: 5, defaultMemberCount: 4, pendingCount: 1 })
  api.listStorageMembers.mockResolvedValue({ list: [NORMAL, WARN, FULL, PENDING, UNKNOWN], total: 5 })
  api.adjustStorageQuota.mockResolvedValue({})
  api.batchAdjustStorageQuota.mockResolvedValue({ count: 2, changed: 2, skipped: 0 })
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  expect(errorSpy).not.toHaveBeenCalled() // 真实挂载冒烟：console.error 零调用
  vi.restoreAllMocks()
})

async function mountPane(props = {}) {
  mounted = mountReal(StorageQuotaPane, props)
  await flushAll(12)
  return mounted.container
}
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
const btn = (root, text) => [...root.querySelectorAll('button')].find((b) => textOf(b) === text)
const rowsOf = (c) => [...c.querySelectorAll('.el-table__body tr.el-table__row')]
const rowByName = (c, name) => rowsOf(c).find((r) => textOf(r).includes(name))
const dialogBody = () => document.body.querySelector('.el-dialog')
async function chooseOption(c, nth, text) {
  c.querySelectorAll('.el-select')[nth].querySelector('.el-select__wrapper').click()
  await flushAll(4)
  ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => textOf(i) === text).click()
  await flushAll(6)
}
async function typeNumber(value) {
  const input = dialogBody().querySelector('.el-input-number input')
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushAll(4)
}

describe('StorageQuotaPane · 列表呈现（md §三·3）', () => {
  it('未统计的员工：已用显示「—」、状态「未统计」、没有进度条，仍可调整容量；弹窗里「当前已用 —」', async () => {
    const c = await mountPane()
    const row = rowByName(c, '未统计员工')
    expect(textOf(row)).toContain('— / 5 GB')
    expect(textOf(row)).toContain('未统计')
    expect(row.querySelector('.el-progress')).toBeNull()
    btn(row, '调整容量').click()
    await flushAll(6)
    expect(textOf(dialogBody())).toContain('当前已用 —')
  })

  it('进度条颜色：预警（≥ 90%）黄、已满红、正常默认色', async () => {
    const c = await mountPane()
    expect(rowByName(c, '预警员工').querySelector('.el-progress.el-progress--line.is-warning')).toBeTruthy()
    expect(rowByName(c, '已满员工').querySelector('.el-progress.is-exception')).toBeTruthy()
    const normal = rowByName(c, '正常员工').querySelector('.el-progress')
    expect(normal.classList.contains('is-warning')).toBe(false)
    expect(normal.classList.contains('is-exception')).toBe(false)
  })

  it('容量来源列展示「默认」或「个人设置」；最终产物 / 缓存两列带 md 规定的悬停提示', async () => {
    const c = await mountPane()
    expect(textOf(rowByName(c, '正常员工'))).toContain('默认')
    expect(textOf(rowByName(c, '预警员工'))).toContain('个人设置')
    const row = rowByName(c, '正常员工')
    const titles = [...row.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
    expect(titles).toContain('不可删除，只能靠扩容释放压力')
    expect(titles).toContain('可由员工自行清理')
  })

  it('已满且清单里有「待处理」入口：点【待处理】向外抛出 open-request（带该员工行）', async () => {
    const onOpenRequest = vi.fn()
    const c = await mountPane({ onOpenRequest })
    btn(rowByName(c, '待处理员工'), '待处理').click()
    expect(onOpenRequest).toHaveBeenCalledTimes(1)
    expect(onOpenRequest.mock.calls[0][0]).toMatchObject({ username: 'pend', pendingRequestId: 'ER-9' })
  })
})

describe('StorageQuotaPane · 筛选与空态（md §三·2 / §三·6）', () => {
  it('状态筛选选「已满」→ state=FULL；申请筛选选「有待处理申请」→ pending=true；下拉选项文案齐全', async () => {
    const c = await mountPane()
    c.querySelectorAll('.el-select')[0].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const options = [...document.body.querySelectorAll('.el-select-dropdown__item')].map(textOf)
    expect(options).toEqual(expect.arrayContaining(['正常', '预警', '已满', '未统计']))
    document.body.click()
    await chooseOption(c, 0, '已满')
    expect(api.listStorageMembers.mock.calls.at(-1)[0].state).toBe('FULL')
    await chooseOption(c, 1, '有待处理申请')
    expect(api.listStorageMembers.mock.calls.at(-1)[0].pending).toBe(true)
  })

  it('没有任何员工时展示「还没有可分配容量的员工」，且不出现【清空筛选】', async () => {
    api.listStorageMembers.mockResolvedValue({ list: [], total: 0 })
    const c = await mountPane()
    expect(textOf(c)).toContain('还没有可分配容量的员工')
    expect(btn(c, '清空筛选')).toBeUndefined()
  })

  it('有筛选条件且无结果时展示「没有符合条件的员工」+【清空筛选】，点击后筛选恢复默认并重新取数', async () => {
    const c = await mountPane()
    await chooseOption(c, 0, '已满')
    api.listStorageMembers.mockResolvedValue({ list: [], total: 0 })
    await chooseOption(c, 0, '预警')
    expect(textOf(c)).toContain('没有符合条件的员工')
    api.listStorageMembers.mockResolvedValue({ list: [NORMAL], total: 1 })
    btn(c, '清空筛选').click()
    await flushAll(8)
    const params = api.listStorageMembers.mock.calls.at(-1)[0]
    expect(params.state).toBeUndefined()
    expect(rowsOf(c)).toHaveLength(1)
  })
})

describe('StorageQuotaPane · 批量设置（md §三·5）', () => {
  /** 勾选指定姓名的行，打开批量弹窗 */
  async function openBatch(c, names) {
    for (const name of names) rowByName(c, name).querySelector('.el-checkbox').click()
    await flushAll(4)
    btn(c, `批量设置容量（${names.length}）`).click()
    await flushAll(6)
  }

  it('没勾选任何员工时【批量设置容量】置灰；勾选后按钮带人数，待处理员工的勾选框置灰不可选（全选交互 jsdom 触发不了，靠行级置灰守「全选也不含待处理」）', async () => {
    const c = await mountPane()
    const batchBtn = () => [...c.querySelectorAll('button')].find((b) => textOf(b).startsWith('批量设置容量'))
    expect(batchBtn().disabled).toBe(true)
    expect(rowByName(c, '待处理员工').querySelector('.el-checkbox.is-disabled')).toBeTruthy()
    rowByName(c, '正常员工').querySelector('.el-checkbox').click()
    await flushAll(4)
    expect(textOf(batchBtn())).toBe('批量设置容量（1）')
    expect(batchBtn().disabled).toBe(false)
  })

  it('弹窗展示将被调整的人数；新总量不高于已用的员工数用红字单独提示', async () => {
    const c = await mountPane()
    await openBatch(c, ['正常员工', '已满员工']) // 已用 2 GB 与 5 GB
    await typeNumber(3)
    const info = dialogBody().querySelector('.sq-dlg-info')
    expect(textOf(info)).toContain('将统一设置 2 名员工的容量')
    expect(textOf(info.querySelector('.sq-danger'))).toBe('，其中 1 名的已用不低于新总量')
  })

  it('提交时有 2 名员工新总量不高于已用 → 先二次确认（「其中 N 名员工」）；取消不提交，继续后提交并提示实际人数', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('ok')
    const c = await mountPane()
    await openBatch(c, ['已满员工', '预警员工']) // 已用 5 GB 与 4.6 GB，新总量 3 都不高于已用
    await typeNumber(3)
    btn(dialogBody(), '确定').click()
    await flushAll(6)
    expect(String(confirm.mock.calls[0][0])).toBe('调整后其中 2 名员工的总量不高于已用，将处于已满状态，任务会被拦截，是否继续？')
    expect(api.batchAdjustStorageQuota).not.toHaveBeenCalled()
    btn(dialogBody(), '确定').click()
    await flushAll(10)
    expect(api.batchAdjustStorageQuota).toHaveBeenCalledWith([3, 2], 3)
    expect(successSpy).toHaveBeenCalledWith('已将 2 名员工的容量设置为 3 GB')
  })

  // 前提单独成条：it.fails 遇任何异常都算通过，前提若写在里面会「为错误的原因通过」
  it('前提：批量里只有 1 名员工新总量不高于已用时，弹出了二次确认', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const c = await mountPane()
    await openBatch(c, ['正常员工', '已满员工'])
    await typeNumber(3)
    btn(dialogBody(), '确定').click()
    await flushAll(6)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('批量里只有 1 名员工不高于已用时，确认文案也是「其中 1 名员工的」而不是员工姓名（md §三·4：批量时 X 为「其中 N 名员工」）', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const c = await mountPane()
    await openBatch(c, ['正常员工', '已满员工'])
    await typeNumber(3)
    btn(dialogBody(), '确定').click()
    await flushAll(6)
    expect(String(confirm.mock.calls[0][0])).toBe('调整后其中 1 名员工的总量不高于已用，将处于已满状态，任务会被拦截，是否继续？')
  })

  it('没有员工新总量不高于已用 → 不弹确认，直接提交；批量弹窗里小数同样提示「容量只能填整数」', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const c = await mountPane()
    await openBatch(c, ['正常员工', '预警员工'])
    await typeNumber(6.5)
    btn(dialogBody(), '确定').click()
    await flushAll(4)
    expect(textOf(dialogBody())).toContain('容量只能填整数')
    expect(api.batchAdjustStorageQuota).not.toHaveBeenCalled()
    await typeNumber(8)
    btn(dialogBody(), '确定').click()
    await flushAll(10)
    expect(confirm).not.toHaveBeenCalled()
    expect(api.batchAdjustStorageQuota).toHaveBeenCalledWith([1, 2], 8)
  })
})

describe('StorageQuotaPane · 加载失败（md §三·6）', () => {
  it('取数失败展示「加载失败」，点【重试】后重新取数', async () => {
    api.listStorageMembers.mockRejectedValueOnce(new Error('boom'))
    const c = await mountPane()
    expect(textOf(c)).toContain('加载失败')
    btn(c, '重试').click()
    await flushAll(8)
    expect(rowsOf(c)).toHaveLength(5)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
