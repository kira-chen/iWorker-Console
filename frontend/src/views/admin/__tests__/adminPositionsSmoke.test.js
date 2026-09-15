// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminPositions.vue 真实挂载冒烟（2026-09-12 测试审计 T48 / T53，对齐 md 岗位管理 prd.岗位管理.md §一.3 / §二.1）。
 *
 * adminPositionsOps.test.js 把 PageHeader / ListStates / ListPagination / el-table 全桩，拦不住组件 setup 期错误
 * （2026-09-11 分页条 TDZ 白屏教训；0f2087f/5585a2b 改分页条时本页零真挂载）。本文件只 mock api 层，
 * 其余用真 Element Plus + 真 ListStates / ListPagination 挂整页：
 *  - mount 不抛、console.error 零调用；页头「岗位」+ 行文案含种子岗位名；
 *  - 分页条（站内统一 .list-pager）「共 N 条数据」+ 跳页框回填当前页；
 *  - listPositions 拒绝 → 「加载失败」+【重试】优先于空态（md §一.3 L29），点【重试】重拉后表格回来。
 */
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const listPositions = vi.fn()
vi.mock('@/api/position', () => ({
  listPositions: (...a) => listPositions(...a),
  createPosition: vi.fn(),
  unpublishPosition: vi.fn(),
  deletePosition: vi.fn(),
  withdrawPosition: vi.fn(),
  getPosition: vi.fn(),
  publishPosition: vi.fn(),
  getNextVersionLabel: vi.fn(),
  listPositionPublications: vi.fn(),
  delistPositionPublication: vi.fn(),
  relistPositionPublication: vi.fn()
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn().mockResolvedValue([]) }))
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: vi.fn().mockResolvedValue({ list: [] }) }))

const AdminPositions = (await import('@/views/admin/AdminPositions.vue')).default

const ROWS = [
  { positionId: 401, name: '经营分析岗', description: '负责经营数据汇总', icon: '▤', agentCount: 3, skillCount: 1, claimedUserCount: 26, status: 'published', pendingAction: null, latestVersion: 'v2.1.0', updatedAt: '2026-08-25T16:20:00+08:00' },
  { positionId: 404, name: '市场研究岗', description: '负责行业资料整理', icon: '⌁', agentCount: 1, skillCount: 1, claimedUserCount: 0, status: 'draft', pendingAction: null, latestVersion: '', updatedAt: '2026-08-23T09:42:00+08:00' }
]

// jsdom 没有 ResizeObserver（el-table 布局用），补一个空实现
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let app, container, errorSpy
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub
  listPositions.mockReset().mockResolvedValue({ list: ROWS, total: 23 })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  errorSpy.mockRestore()
})

function mountReal() {
  app = createApp(AdminPositions).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminPositions · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头 / 行文案 / 分页条「共 23 条数据」+ 跳页框回填 1（md §一.1、§二.1）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(text).toContain('岗位')
    expect(text).toContain('＋ 新建岗位')
    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(text).toContain('经营分析岗')
    expect(text).toContain('市场研究岗')
    expect(text).toContain('v2.1.0')
    expect(listPositions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, sort: 'desc' }))

    // 真 ListPagination：三段式「共 N 条数据」+ 跳页框常显当前页
    const pager = container.querySelector('.list-pager')
    expect(pager).toBeTruthy()
    expect(pager.textContent).toContain('共 23 条数据')
    expect(pager.querySelector('.page-jump-input').value).toBe('1')
    // 未翻页也不会触发第二次取数
    expect(listPositions).toHaveBeenCalledTimes(1)
  })

  it('翻到第 2 页 → listPositions(page:2) 且跳页框回填「2」', async () => {
    mountReal()
    await flush()
    container.querySelector('.list-pager button[aria-label="下一页"]').click()
    await flush()
    expect(listPositions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    expect(container.querySelector('.page-jump-input').value).toBe('2')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('listPositions 拒绝 → 显「加载失败」+【重试】，不显空态；点【重试】重拉成功后表格回来（md §一.3 L29）', async () => {
    listPositions.mockRejectedValueOnce(new Error('网络错误'))
    mountReal()
    await flush()
    expect(container.textContent).toContain('加载失败')
    expect(container.querySelector('[data-testid="list-empty"]')).toBeNull()
    expect(container.textContent).not.toContain('没有符合条件的岗位')
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    retry.click()
    await flush()
    expect(listPositions).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('加载失败')
    expect(container.textContent).toContain('经营分析岗')
  })

  it('取数成功但 0 条 → 空态「没有符合条件的岗位」，无分页条', async () => {
    listPositions.mockResolvedValue({ list: [], total: 0 })
    mountReal()
    await flush()
    expect(container.querySelector('[data-testid="list-empty"]')?.textContent).toContain('没有符合条件的岗位')
    expect(container.querySelector('.list-pager')).toBeNull()
  })
})
