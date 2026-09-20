// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminVersions.vue（版本管理列表页）单测。对齐 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md：
 * - §一 页面标题与说明；§3.1 当前下发概览条（无已发布版本显示「暂无下发版本」）；
 * - §3.2 查询区（占位「搜索版本号 / 更新说明」、终端 / 状态筛选、【查询】、【＋ 新建版本】）；
 * - §3.3 列表八列与「状态 → 操作按钮」对照（未发布：编辑/发布/删除；已发布：查看/停用；已停用：查看/发布）；
 * - §五 发布确认文案（含「原已发布版本 vX 将自动变为已停用」）/ §六 停用确认 / §七 删除确认，取消不执行；
 * - §九 空状态 / 加载失败【重试】/ 概览加载失败【重试】。
 *
 * 真实挂载（真 Element Plus / 真 VersionEditor 抽屉），只 mock api 层与确认弹窗；业务规则本身见 versionMock.test.js。
 */

const api = {
  listVersions: vi.fn(),
  getVersionOverview: vi.fn(),
  publishVersion: vi.fn(),
  stopVersion: vi.fn(),
  deleteVersion: vi.fn(),
  createVersion: vi.fn(),
  updateVersion: vi.fn(),
  uploadVersionPackage: vi.fn()
}
vi.mock('@/api/version', () => api)
const confirmDialog = vi.fn()
vi.mock('@/composables/useConfirm', () => ({ confirmDialog: (...a) => confirmDialog(...a) }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }
})

const { ElMessage } = await import('element-plus')
const AdminVersions = (await import('@/views/admin/AdminVersions.vue')).default

const row = (over) => ({
  id: 1, terminal: 'WINDOWS', version: 'v1.0.0', packageName: 'iWorker-Setup-1.0.0.exe', packageSize: 90596966,
  sha256: 'a'.repeat(64), releaseNotes: '更新说明', status: 'UNPUBLISHED',
  publishedAt: null, publishedBy: null, stoppedAt: null, createdAt: '2026-09-18T14:20:00+08:00', updatedAt: '2026-09-18T14:20:00+08:00',
  ...over
})
const DRAFT = row({ id: 4, version: 'v1.3.0' })
const PUBLISHED = row({ id: 3, version: 'v1.2.0', status: 'PUBLISHED', publishedAt: '2026-08-20T10:30:00+08:00', publishedBy: 'li.na' })
const STOPPED = row({ id: 2, version: 'v1.1.0', status: 'STOPPED', publishedAt: '2026-07-18T10:00:00+08:00', publishedBy: 'zhang.wei', stoppedAt: '2026-08-20T10:30:00+08:00' })
const MAC_PUBLISHED = row({ id: 6, terminal: 'MAC', version: 'v1.1.0', packageName: 'iWorker-1.1.0.dmg', status: 'PUBLISHED', publishedAt: '2026-08-20T10:32:00+08:00', publishedBy: 'li.na' })
const ROWS = [DRAFT, PUBLISHED, STOPPED, MAC_PUBLISHED]

let mounted
const text = () => mounted.container.textContent.replace(/\s+/g, ' ')
const bodyRows = () => [...mounted.container.querySelectorAll('.el-table__body tr')]
const rowOf = (terminal, version) =>
  bodyRows().find((tr) => tr.querySelector('.vs-version')?.textContent === version && tr.textContent.includes(terminal))
const opsOf = (tr) => [...tr.querySelectorAll('.tbl-ops button')].map((b) => b.textContent.trim())
const clickOp = (tr, label) => [...tr.querySelectorAll('.tbl-ops button')].find((b) => b.textContent.trim() === label).click()

/** query：模拟从别的页面（如访问审计【查看】）带参跳进来。 */
async function mount({ query = {} } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ path: '/', query })
  await router.isReady()
  mounted = mountReal(AdminVersions, {}, { plugins: [router] })
  await flushAll(12)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listVersions.mockResolvedValue({ list: ROWS, total: ROWS.length })
  api.getVersionOverview.mockResolvedValue({ WINDOWS: PUBLISHED, MAC: MAC_PUBLISHED })
  api.publishVersion.mockResolvedValue({})
  api.stopVersion.mockResolvedValue({})
  api.deleteVersion.mockResolvedValue(true)
  confirmDialog.mockReset().mockResolvedValue(true)
  for (const k of ['success', 'error', 'warning', 'info']) ElMessage[k].mockReset()
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('AdminVersions · 页面结构（PRD §一 / §3.1 / §3.2）', () => {
  it('页头标题与说明；挂载即拉列表（默认 sortDir=desc、page=1）与概览条；控制台零 error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    expect(mounted.container.querySelector('.page-header')?.textContent ?? text()).toContain('版本管理')
    expect(text()).toContain('管理用户端（Windows / Mac）的版本包与更新说明，发布后用户端检测更新时将提示升级')
    expect(api.listVersions).toHaveBeenCalledTimes(1)
    expect(api.listVersions.mock.calls[0][0]).toMatchObject({ sortDir: 'desc', page: 1 })
    expect(api.getVersionOverview).toHaveBeenCalledTimes(1)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('概览条：各终端当前下发版本 + 发布时间；无已发布版本显示「暂无下发版本」', async () => {
    api.getVersionOverview.mockResolvedValue({ WINDOWS: PUBLISHED, MAC: null })
    await mount()
    const cards = [...mounted.container.querySelectorAll('.vs-card')]
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Windows')
    expect(cards[0].textContent).toContain('v1.2.0')
    expect(cards[0].textContent).toContain('发布于 2026-08-20 10:30')
    expect(cards[1].textContent).toContain('Mac')
    expect(cards[1].textContent).toContain('暂无下发版本')
  })

  it('概览条加载失败：展示「概览加载失败」+【重试】，重试后恢复；列表不受影响', async () => {
    api.getVersionOverview.mockRejectedValueOnce(new Error('boom'))
    await mount()
    expect(mounted.container.querySelector('.vs-overview-error').textContent).toContain('概览加载失败')
    expect(bodyRows()).toHaveLength(ROWS.length)
    mounted.container.querySelector('.vs-overview-error button').click()
    await flushAll()
    expect(mounted.container.querySelector('.vs-overview-error')).toBeNull()
    expect(mounted.container.querySelectorAll('.vs-card')).toHaveLength(2)
  })

  it('查询区：搜索框占位、终端 / 状态筛选、【查询】与右侧【＋ 新建版本】', async () => {
    await mount()
    expect(mounted.container.querySelector('.lt-search input').placeholder).toBe('搜索版本号 / 更新说明')
    const filters = [...mounted.container.querySelectorAll('.lt-filter .el-select__placeholder')].map((s) => s.textContent.trim())
    expect(filters).toEqual(['全部终端', '全部状态'])
    const btns = [...mounted.container.querySelectorAll('.list-toolbar button')].map((b) => b.textContent.trim())
    expect(btns).toContain('查询')
    expect(btns).toContain('＋ 新建版本')
  })

  it('关键字回车 / 点【查询】按当前条件重查并回第 1 页', async () => {
    await mount()
    const input = mounted.container.querySelector('.lt-search input')
    input.value = 'v1.2'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await flushAll()
    expect(api.listVersions.mock.calls.at(-1)[0]).toMatchObject({ keyword: 'v1.2', page: 1 })
    api.listVersions.mockClear()
    ;[...mounted.container.querySelectorAll('.list-toolbar button')].find((b) => b.textContent.trim() === '查询').click()
    await flushAll()
    expect(api.listVersions).toHaveBeenCalledTimes(1)
  })
})

describe('AdminVersions · 从访问审计【查看】跳转进入（prd.访问审计.md §6.3）', () => {
  it('地址带 keyword（操作对象名称，如 Windows v1.2.0）→ 预填搜索框，并作为首次取数条件', async () => {
    await mount({ query: { keyword: 'Windows v1.2.0' } })
    expect(mounted.container.querySelector('.lt-search input').value).toBe('Windows v1.2.0')
    expect(api.listVersions).toHaveBeenCalledTimes(1)
    expect(api.listVersions.mock.calls[0][0]).toMatchObject({ keyword: 'Windows v1.2.0', page: 1 })
  })

  it('不带 keyword 时搜索框为空，取数不带 keyword', async () => {
    await mount()
    expect(mounted.container.querySelector('.lt-search input').value).toBe('')
    expect(api.listVersions.mock.calls[0][0]).not.toHaveProperty('keyword')
  })
})

describe('AdminVersions · 列表（PRD §3.3）', () => {
  it('八列：版本号 / 终端 / 版本包 / 更新说明 / 状态 / 发布时间 / 发布人 / 操作', async () => {
    await mount()
    const heads = [...mounted.container.querySelectorAll('.el-table__header th')].map((th) => th.textContent.replace(/\s+/g, ''))
    expect(heads).toEqual(['版本号', '终端', '版本包', '更新说明', '状态', '发布时间↓', '发布人', '操作'])
  })

  it('行内容：版本号 vX.Y.Z、终端标签、「文件名 · 大小」、状态标签、发布时间精确到分钟；未发布的发布时间 / 发布人显示「—」', async () => {
    await mount()
    const pub = rowOf('Windows', 'v1.2.0')
    expect(pub.textContent).toContain('iWorker-Setup-1.0.0.exe')
    expect(pub.textContent).toContain('86.4 MB')
    expect(pub.textContent).toContain('已发布')
    expect(pub.textContent).toContain('2026-08-20 10:30')
    expect(pub.textContent).toContain('li.na') // 发布人显示登录用户名（PRD §3.3）
    const draft = rowOf('Windows', 'v1.3.0')
    expect(draft.textContent).toContain('未发布')
    expect(draft.querySelectorAll('.cell-na')).toHaveLength(2)
    expect(rowOf('Windows', 'v1.1.0').textContent).toContain('已停用')
    expect(rowOf('Mac', 'v1.1.0').textContent).toContain('Mac')
  })

  it('状态与操作按钮对照：未发布=编辑/发布/删除；已发布=查看/停用；已停用=查看/发布', async () => {
    await mount()
    expect(opsOf(rowOf('Windows', 'v1.3.0'))).toEqual(['编辑', '发布', '删除'])
    expect(opsOf(rowOf('Windows', 'v1.2.0'))).toEqual(['查看', '停用'])
    expect(opsOf(rowOf('Windows', 'v1.1.0'))).toEqual(['查看', '发布'])
  })

  it('发布时间列头点击切换排序 ↓/↑ 并重查', async () => {
    await mount()
    const btn = mounted.container.querySelector('.time-sort')
    expect(btn.textContent.replace(/\s+/g, '')).toBe('发布时间↓')
    btn.click()
    await flushAll()
    expect(api.listVersions.mock.calls.at(-1)[0]).toMatchObject({ sortDir: 'asc', page: 1 })
    expect(mounted.container.querySelector('.time-sort').textContent.replace(/\s+/g, '')).toBe('发布时间↑')
  })
})

describe('AdminVersions · 空状态与失败（PRD §九）', () => {
  it('尚无任何版本：「暂无版本 · 点击「＋ 新建版本」配置首个版本包」', async () => {
    api.listVersions.mockResolvedValue({ list: [], total: 0 })
    await mount()
    expect(text()).toContain('暂无版本 · 点击「＋ 新建版本」配置首个版本包')
  })

  it('筛选无结果：「暂无符合条件的版本」，保留条件', async () => {
    await mount()
    api.listVersions.mockResolvedValue({ list: [], total: 0 })
    const input = mounted.container.querySelector('.lt-search input')
    input.value = 'zzz'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await flushAll()
    expect(text()).toContain('暂无符合条件的版本')
    expect(mounted.container.querySelector('.lt-search input').value).toBe('zzz')
  })

  it('列表加载失败：展示失败态与【重试】，重试后恢复', async () => {
    api.listVersions.mockRejectedValueOnce(new Error('boom'))
    await mount()
    expect(bodyRows()).toHaveLength(0)
    const retry = [...mounted.container.querySelectorAll('button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    retry.click()
    await flushAll()
    expect(bodyRows()).toHaveLength(ROWS.length)
  })
})

describe('AdminVersions · 发布 / 停用 / 删除（PRD §五 / §六 / §七）', () => {
  it('发布：确认文案含目标终端与版本号，且同终端已有已发布版本时追加「原已发布版本 vX 将自动变为已停用」；确认后调 publishVersion 并刷新列表与概览', async () => {
    await mount()
    api.listVersions.mockClear()
    api.getVersionOverview.mockClear()
    clickOp(rowOf('Windows', 'v1.3.0'), '发布')
    await flushAll()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    const [msg, title, opts] = confirmDialog.mock.calls[0]
    expect(title).toBe('发布版本')
    expect(msg).toBe('发布后，Windows 用户端检测更新时将提示升级到 v1.3.0。原已发布版本 v1.2.0 将自动变为已停用。')
    expect(opts).toMatchObject({ confirmText: '发布' })
    expect(api.publishVersion).toHaveBeenCalledWith(4)
    expect(ElMessage.success).toHaveBeenCalledWith('已发布 v1.3.0（Windows）')
    expect(api.listVersions).toHaveBeenCalledTimes(1)
    expect(api.getVersionOverview).toHaveBeenCalledTimes(1)
  })

  it('发布：该终端无已发布版本时不带「自动变为已停用」尾句', async () => {
    api.getVersionOverview.mockResolvedValue({ WINDOWS: null, MAC: MAC_PUBLISHED })
    await mount()
    clickOp(rowOf('Windows', 'v1.1.0'), '发布') // 已停用 → 重新发布
    await flushAll()
    expect(confirmDialog.mock.calls[0][0]).toBe('发布后，Windows 用户端检测更新时将提示升级到 v1.1.0。')
  })

  it('停用：确认文案说明影响面，确认键走警示档；成功提示「已停用 vX」', async () => {
    await mount()
    clickOp(rowOf('Windows', 'v1.2.0'), '停用')
    await flushAll()
    const [msg, title, opts] = confirmDialog.mock.calls[0]
    expect(title).toBe('停用版本')
    expect(msg).toBe('停用后，Windows 用户端将不再收到 v1.2.0 的更新提示，已升级的用户不受影响。停用后该终端暂无下发版本。确认停用？')
    expect(opts).toMatchObject({ confirmText: '停用', warning: true })
    expect(api.stopVersion).toHaveBeenCalledWith(3)
    expect(ElMessage.success).toHaveBeenCalledWith('已停用 v1.2.0')
  })

  it('删除：确认键走危险档；成功提示「版本已删除」', async () => {
    await mount()
    clickOp(rowOf('Windows', 'v1.3.0'), '删除')
    await flushAll()
    const [msg, title, opts] = confirmDialog.mock.calls[0]
    expect(title).toBe('删除版本')
    expect(msg).toBe('删除后版本 v1.3.0 及其版本包将不可恢复。确认删除？')
    expect(opts).toMatchObject({ confirmText: '删除', danger: true })
    expect(api.deleteVersion).toHaveBeenCalledWith(4)
    expect(ElMessage.success).toHaveBeenCalledWith('版本已删除')
  })

  it('取消 / 关闭确认窗：三个动作都不执行、不刷新', async () => {
    confirmDialog.mockResolvedValue(false)
    await mount()
    api.listVersions.mockClear()
    clickOp(rowOf('Windows', 'v1.3.0'), '发布')
    await flushAll()
    clickOp(rowOf('Windows', 'v1.2.0'), '停用')
    await flushAll()
    clickOp(rowOf('Windows', 'v1.3.0'), '删除')
    await flushAll()
    expect(confirmDialog).toHaveBeenCalledTimes(3)
    expect(api.publishVersion).not.toHaveBeenCalled()
    expect(api.stopVersion).not.toHaveBeenCalled()
    expect(api.deleteVersion).not.toHaveBeenCalled()
    expect(api.listVersions).not.toHaveBeenCalled()
  })

  it('规则报错原样提示，不刷新、不崩：发布失败显示接口给的原因；缺省文案「操作失败，请重试」', async () => {
    await mount()
    api.listVersions.mockClear()
    api.publishVersion.mockRejectedValueOnce(new Error('版本号须高于当前已发布版本 v1.2.0'))
    clickOp(rowOf('Windows', 'v1.3.0'), '发布')
    await flushAll()
    expect(ElMessage.error).toHaveBeenCalledWith('版本号须高于当前已发布版本 v1.2.0')
    api.stopVersion.mockRejectedValueOnce({})
    clickOp(rowOf('Windows', 'v1.2.0'), '停用')
    await flushAll()
    expect(ElMessage.error).toHaveBeenLastCalledWith('操作失败，请重试')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(api.listVersions).not.toHaveBeenCalled()
  })
})

describe('AdminVersions · 抽屉入口（PRD §四）', () => {
  it('【＋ 新建版本】打开「新建版本」抽屉；行内【查看】打开只读「查看版本」抽屉（底部仅【关闭】）', async () => {
    await mount()
    ;[...mounted.container.querySelectorAll('.list-toolbar button')].find((b) => b.textContent.includes('新建版本')).click()
    await flushAll()
    expect(document.body.querySelector('.el-drawer .de-head-title').textContent).toBe('新建版本')

    mounted.unmount()
    document.body.innerHTML = ''
    await mount()
    clickOp(rowOf('Windows', 'v1.2.0'), '查看')
    await flushAll()
    const drawer = document.body.querySelector('.el-drawer')
    expect(drawer.querySelector('.de-head-title').textContent).toBe('查看版本')
    expect([...drawer.querySelectorAll('.el-drawer__footer button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
  })

  it('行内【编辑】打开「编辑版本」抽屉并回填版本号', async () => {
    await mount()
    clickOp(rowOf('Windows', 'v1.3.0'), '编辑')
    await flushAll()
    const drawer = document.body.querySelector('.el-drawer')
    expect(drawer.querySelector('.de-head-title').textContent).toBe('编辑版本')
    expect(drawer.querySelector('input[placeholder="如 v1.2.0"]').value).toBe('v1.3.0')
  })
})
