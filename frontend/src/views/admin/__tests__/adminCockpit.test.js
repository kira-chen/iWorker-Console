// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminCockpit.vue（01 总览 / 驾驶舱）单测。对齐 docs/PRD/数字员工管理端PRD/01总览/驾驶舱/prd.驾驶舱.md：
 * - §五 用户端当前下发版本：Windows / Mac 两张只读卡片，展示版本号、发布时间、更新说明（保留换行）；
 *   该终端没有下发中版本显示「暂无下发版本」；数据取自版本管理概览（getVersionOverview），不可点击；
 * - §一.2 / §九 【刷新】重新拉取该面板并进入骨架屏；该面板取数失败单独展示「加载失败」+【重试】，不影响其余区块。
 *
 * 真实挂载（真 Element Plus），只 mock 版本 api 与 ElMessage；版本业务规则本身见 versionMock.test.js。
 * 驾驶舱其余区块是静态 mock，这里只留「页面仍在」的探针，不逐个断言。
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

async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
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

describe('AdminCockpit · 用户端当前下发版本（PRD §五）', () => {
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

describe('AdminCockpit · 刷新与失败态（PRD §一.2 / §九）', () => {
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
