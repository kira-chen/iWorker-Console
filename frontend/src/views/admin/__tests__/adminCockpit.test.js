// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminCockpit.vue（01 总览 / 驾驶舱）单测。对齐 docs/PRD/数字员工管理端PRD/01总览/驾驶舱/prd.驾驶舱.md：
 * - §二 用户端当前下发版本：Windows / Mac 两张只读卡片，展示版本号、发布时间、更新说明（保留换行）；
 *   该终端没有下发中版本显示「暂无下发版本」；数据取自版本管理概览（getVersionOverview），不可点击；
 * - §一.2 / §八 【刷新】重新拉取该面板并进入骨架屏；该面板取数失败单独展示「加载失败」+【重试】，不影响其余区块。
 *
 * 真实挂载（真 Element Plus），只 mock 版本 api 与 ElMessage；版本业务规则本身见 versionMock.test.js。
 * 驾驶舱其余区块是静态 mock，这里只留「页面仍在」的探针，不逐个断言。
 *
 * 2026-10-08 /test-audit 补缺口（同对齐 prd.驾驶舱.md；静态示例数值不测，只测交互规则）：
 * - §三.2 异常待办【去审核】/【去处理】真实跳转 UnifiedReview / AdminConnector / SysConfigUserSkillReviews（memory router 断 currentRoute.name）；
 * - §四.2 岗位领用 Top 5 只列已发布岗位；
 * - §六.2 点踩明细每页 10 条、首 / 末页按钮置灰；§七.1 点踩明细与对话明细两个弹窗互斥；
 * - §一.1 页头「更新于 HH:MM」，刷新后为当前时刻。
 */

const api = { getVersionOverview: vi.fn() }
vi.mock('@/api/version', () => api)
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }
})

const AdminCockpit = (await import('@/views/admin/AdminCockpit.vue')).default

const versionRow = (over) => ({
  id: 3, terminal: 'WINDOWS', version: 'v1.2.0', status: 'PUBLISHED',
  publishedAt: '2026-08-20T10:30:00+08:00', publishedBy: 'li.na',
  releaseNotes: '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知',
  ...over
})
const WIN = versionRow()
const MAC = versionRow({
  id: 6, terminal: 'MAC', version: 'v1.1.0', publishedAt: '2026-08-20T10:32:00+08:00',
  releaseNotes: '与 Windows 端同步：引用来源一键复制、任务完成桌面通知。'
})

let mounted
const text = () => mounted.container.textContent.replace(/\s+/g, ' ')
const cards = () => [...mounted.container.querySelectorAll('.ver-card')]
const cardOf = (terminal) => cards().find((c) => c.dataset.terminal === terminal)

let router
async function mount() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/admin/reviews', name: 'UnifiedReview', component: { template: '<div />' } },
      { path: '/admin/connector', name: 'AdminConnector', component: { template: '<div />' } },
      { path: '/admin/user-skill-reviews', name: 'SysConfigUserSkillReviews', component: { template: '<div />' } },
      { path: '/admin/position-assignments', name: 'AdminPositionAssignments', component: { template: '<div />' } },
      { path: '/admin/storage-space', name: 'AdminStorageSpace', component: { template: '<div />' } }
    ]
  })
  await router.push('/')
  await router.isReady()
  mounted = mountReal(AdminCockpit, {}, { plugins: [router] })
  await flushAll(12)
}

beforeEach(() => {
  api.getVersionOverview.mockReset().mockResolvedValue({ WINDOWS: WIN, MAC })
})
afterEach(() => {
  vi.useRealTimers()
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('AdminCockpit · 用户端当前下发版本（PRD §二）', () => {
  it('区块头 + Windows / Mac 两张卡片：版本号、发布时间（精确到分钟）、更新说明；挂载即取一次概览；控制台零 error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    expect(api.getVersionOverview).toHaveBeenCalledTimes(1)
    expect(text()).toContain('用户端当前下发版本')
    expect(text()).toContain('用户端检测更新时将提示升级到该版本')

    expect(cards()).toHaveLength(2)
    const [win, mac] = cards()
    expect(win.dataset.terminal).toBe('WINDOWS')
    expect(win.textContent).toContain('Windows')
    expect(win.querySelector('.ver-version').textContent).toBe('v1.2.0')
    expect(win.textContent).toContain('发布于 2026-08-20 10:30')
    expect(win.textContent).toContain('更新说明')
    expect(win.querySelector('.ver-notes').textContent).toBe(WIN.releaseNotes)

    expect(mac.dataset.terminal).toBe('MAC')
    expect(mac.textContent).toContain('Mac')
    expect(mac.querySelector('.ver-version').textContent).toBe('v1.1.0')
    expect(mac.textContent).toContain('发布于 2026-08-20 10:32')
    expect(mac.querySelector('.ver-notes').textContent).toBe(MAC.releaseNotes)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('卡片只读：没有按钮、点击不触发任何提示', async () => {
    await mount()
    const { ElMessage } = await import('element-plus')
    ElMessage.mockClear()
    for (const c of cards()) {
      expect(c.querySelector('button')).toBeNull()
      c.click()
    }
    await flushAll(2)
    expect(ElMessage).not.toHaveBeenCalled()
  })

  it('某终端没有下发中版本：该卡片显示「暂无下发版本」，另一终端不受影响', async () => {
    api.getVersionOverview.mockResolvedValue({ WINDOWS: WIN, MAC: null })
    await mount()
    expect(cardOf('MAC').textContent).toContain('暂无下发版本')
    expect(cardOf('MAC').querySelector('.ver-version')).toBeNull()
    expect(cardOf('WINDOWS').querySelector('.ver-version').textContent).toBe('v1.2.0')
  })

  it('停用审核期间该版本仍在下发：概览仍带它，卡片照常显示版本号与更新说明', async () => {
    const stopping = { ...WIN, status: 'PENDING_REVIEW', pendingAction: 'STOP', prev: { status: 'PUBLISHED' } }
    api.getVersionOverview.mockResolvedValue({ WINDOWS: stopping, MAC })
    await mount()
    expect(cardOf('WINDOWS').querySelector('.ver-version').textContent).toBe('v1.2.0')
    expect(cardOf('WINDOWS').textContent).not.toContain('暂无下发版本')
  })

  it('概览取回前显示骨架屏（不闪「暂无下发版本」），取回后替换为内容', async () => {
    let resolve
    api.getVersionOverview.mockReturnValue(new Promise((r) => { resolve = r }))
    await mount()
    expect(mounted.container.querySelectorAll('.ver-skeleton')).toHaveLength(2)
    expect(text()).not.toContain('暂无下发版本')
    resolve({ WINDOWS: WIN, MAC })
    await flushAll(6)
    expect(mounted.container.querySelectorAll('.ver-skeleton')).toHaveLength(0)
    expect(cardOf('WINDOWS').querySelector('.ver-version').textContent).toBe('v1.2.0')
  })
})

describe('AdminCockpit · 刷新与失败态（PRD §一.2 / §八）', () => {
  it('【刷新】重新拉取概览：期间两张卡片回到骨架屏，约 650ms 后显示最新版本并 toast「驾驶舱数据已刷新」', async () => {
    await mount()
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    api.getVersionOverview.mockResolvedValue({ WINDOWS: versionRow({ version: 'v1.3.0', releaseNotes: '新增记忆管理' }), MAC })
    const refreshBtn = [...mounted.container.querySelectorAll('button')].find((b) => b.textContent.trim() === '刷新')
    refreshBtn.click()
    await flushAll(4)
    expect(api.getVersionOverview).toHaveBeenCalledTimes(2)
    expect(mounted.container.querySelectorAll('.ver-skeleton')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(700)
    await flushAll(4)
    expect(mounted.container.querySelectorAll('.ver-skeleton')).toHaveLength(0)
    expect(cardOf('WINDOWS').querySelector('.ver-version').textContent).toBe('v1.3.0')
    expect(cardOf('WINDOWS').querySelector('.ver-notes').textContent).toBe('新增记忆管理')
    expect(ElMessage).toHaveBeenCalledWith(expect.objectContaining({ message: '驾驶舱数据已刷新' }))
  })

  it('取数失败：该面板展示「加载失败」+【重试】，其余区块（异常与待办）照常；点【重试】成功后恢复卡片', async () => {
    api.getVersionOverview.mockRejectedValueOnce(new Error('boom'))
    await mount()
    const panel = mounted.container.querySelector('[aria-label="用户端当前下发版本"]')
    expect(panel.textContent).toContain('加载失败')
    expect(cards()).toHaveLength(0)
    expect(text()).toContain('异常与待办')

    const retry = [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    retry.click()
    await flushAll(6)
    expect(api.getVersionOverview).toHaveBeenCalledTimes(2)
    expect(panel.textContent).not.toContain('加载失败')
    expect(cards()).toHaveLength(2)
    expect(cardOf('MAC').querySelector('.ver-version').textContent).toBe('v1.1.0')
  })
})

/* ======================================================================================
 * 2026-10-08 /test-audit 补缺口
 * ====================================================================================== */
const todoCard = (source) => [...mounted.container.querySelectorAll('.dash-todo-card')].find((c) => c.querySelector('.dash-todo-source').textContent.trim() === source)

describe('AdminCockpit · 异常与待办真实跳转（PRD §三.2）', () => {
  it('「审核中心」卡【去审核】→ 跳到审核中心页面', async () => {
    await mount()
    const btn = todoCard('审核中心').querySelector('button')
    expect(btn.textContent.trim()).toBe('去审核')
    btn.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('UnifiedReview'))
  })

  it('「连接器」卡【去处理】→ 跳到连接器页面', async () => {
    await mount()
    const btn = todoCard('连接器').querySelector('button')
    expect(btn.textContent.trim()).toBe('去处理')
    btn.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminConnector'))
  })

  it('「用户技能审核」卡【去审核】→ 跳到用户技能审核页面', async () => {
    await mount()
    const btn = todoCard('用户技能审核').querySelector('button')
    expect(btn.textContent.trim()).toBe('去审核')
    btn.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('SysConfigUserSkillReviews'))
  })

  it('「岗位管理」卡【去分配】→ 跳到岗位管理页面', async () => {
    await mount()
    const btn = todoCard('岗位管理').querySelector('button')
    expect(btn.textContent.trim()).toBe('去分配')
    btn.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminPositionAssignments'))
  })

  it('「存储空间」卡【去处理】→ 跳到存储空间页面', async () => {
    await mount()
    const btn = todoCard('存储空间').querySelector('button')
    expect(btn.textContent.trim()).toBe('去处理')
    btn.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminStorageSpace'))
  })

  it('区块头「共 N 项」= 五张卡片数量之和', async () => {
    await mount()
    const panel = [...mounted.container.querySelectorAll('.dash-panel')].find((p) => p.querySelector('.dash-panel-title')?.textContent.trim() === '异常与待办')
    expect(panel.querySelector('.dash-panel-count').textContent).toContain('共 25 项')
  })

  it('点卡片本身（非行动按钮）→ 不跳转、也不弹提示', async () => {
    await mount()
    const { ElMessage } = await import('element-plus')
    ElMessage.mockClear()
    todoCard('审核中心').click()
    await flushAll(4)
    expect(router.currentRoute.value.path).toBe('/')
    expect(ElMessage).not.toHaveBeenCalled()
  })
})

describe('AdminCockpit · 页面区块顺序（PRD §二 / §四）', () => {
  it('核心指标卡区已删除：页面没有任何指标卡与圆环', async () => {
    await mount()
    expect(mounted.container.querySelector('.metrics')).toBeNull()
    expect(mounted.container.querySelector('.metric')).toBeNull()
    expect(mounted.container.querySelector('.dash-ring')).toBeNull()
  })

  it('「用户端当前下发版本」是页头下第一个区块，排在「异常与待办」之前', async () => {
    await mount()
    const titles = [...mounted.container.querySelectorAll('.dash-panel-title')].map((e) => e.textContent.trim())
    expect(titles.slice(0, 2)).toEqual(['用户端当前下发版本', '异常与待办'])
  })

  it('「岗位领用 Top 5」标题旁展示「领用岗位员工数量 241 人」', async () => {
    await mount()
    const panel = [...mounted.container.querySelectorAll('.dash-panel')].find((p) => p.querySelector('.dash-panel-title')?.textContent.trim() === '岗位领用 Top 5')
    expect(panel.querySelector('.dash-panel-count').textContent.trim()).toBe('领用岗位员工数量 241 人')
  })
})

describe('AdminCockpit · 岗位领用 Top 5（PRD §四.2）', () => {
  it('只列已发布岗位：5 行，每行状态都是「已发布」', async () => {
    await mount()
    const panel = [...mounted.container.querySelectorAll('.dash-panel')].find((p) => p.textContent.includes('岗位领用 Top 5'))
    const rows = [...panel.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(5)
    rows.forEach((tr) => expect(tr.querySelector('.dash-name-sub').textContent.trim()).toMatch(/ \/ 已发布$/))
  })
})

describe('AdminCockpit · 点踩明细 / 对话明细弹窗（PRD §六 / §七）', () => {
  const dlBody = () => [...document.body.querySelectorAll('.el-dialog')].find((d) => d.querySelector('.dl-dialog-title'))
  const cvBody = () => [...document.body.querySelectorAll('.el-dialog')].find((d) => d.querySelector('.cv-dialog-title'))
  /** 弹窗是否可见：el-dialog 关闭后外层遮罩 display:none（或尚未渲染）。 */
  const shown = (dialog) => {
    if (!dialog) return false
    for (let el = dialog; el; el = el.parentElement) if (el.style?.display === 'none') return false
    return true
  }
  const footBtn = (label) => [...dlBody().querySelectorAll('.dl-foot button')].find((b) => b.textContent.trim() === label)
  async function openDl() {
    await mount()
    ;[...mounted.container.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看点踩明细').click()
    await flushAll(6)
  }

  it('打开点踩明细 → 第 1 页 10 条，「第 1 / 6 页，共 52 条」，【上一页】置灰、【下一页】可点', async () => {
    await openDl()
    expect(shown(dlBody())).toBe(true)
    expect(dlBody().querySelectorAll('tbody tr')).toHaveLength(10)
    expect(dlBody().querySelector('.dl-foot').textContent).toContain('第 1 / 6 页，共 52 条')
    expect(footBtn('上一页').disabled).toBe(true)
    expect(footBtn('下一页').disabled).toBe(false)
  })

  it('翻到末页 → 只剩 2 条，【下一页】置灰、【上一页】可点', async () => {
    await openDl()
    for (let i = 0; i < 5; i++) {
      footBtn('下一页').click()
      await flushAll(2)
    }
    expect(dlBody().querySelector('.dl-foot').textContent).toContain('第 6 / 6 页，共 52 条')
    expect(dlBody().querySelectorAll('tbody tr')).toHaveLength(2)
    expect(footBtn('下一页').disabled).toBe(true)
    expect(footBtn('上一页').disabled).toBe(false)
  })

  it('点踩明细行内【查看】→ 点踩明细关闭、对话明细打开（两弹窗互斥），对话明细带该条记录编号', async () => {
    await openDl()
    const firstRow = dlBody().querySelector('tbody tr')
    firstRow.querySelector('button').click()
    await flushAll(8)
    await vi.waitFor(() => expect(shown(dlBody())).toBe(false))
    expect(shown(cvBody())).toBe(true)
    expect(cvBody().querySelector('.cv-dialog-id').textContent.trim()).toBe('D-1031')
  })
})

describe('AdminCockpit · 页头更新时间（PRD §一.1 / §一.2）', () => {
  it('页头展示「更新于 HH:MM」（24 小时制到分钟）', async () => {
    await mount()
    expect(mounted.container.querySelector('.ref-time').textContent.trim()).toMatch(/^更新于 ([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('点【刷新】完成后 → 「更新于」变为当前时刻', async () => {
    await mount()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 9, 8, 14, 5, 0))
    ;[...mounted.container.querySelectorAll('button')].find((b) => b.textContent.trim() === '刷新').click()
    await vi.advanceTimersByTimeAsync(700)
    await flushAll(4)
    expect(mounted.container.querySelector('.ref-time').textContent.trim()).toBe('更新于 14:05')
  })
})
