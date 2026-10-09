// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminPositionAssignments.vue 真实挂载冒烟（2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md §一 / §二 / §3.1）。
 *
 * adminPositionAssignments.test.js 把 el-table / el-dialog / 编辑弹窗全桩，拦不住组件 setup 期错误。
 * 本文件用 helpers/smokeMount 的 mountReal（真 Element Plus + 真 ListStates / ListPagination / UserPositionEditDialog），
 * 只 mock api 层，断言：挂载不抛、console.error 零调用；页头「岗位管理」+ 说明；工具栏搜索占位与【批量绑定】；
 * 行内种子用户 +「待分配」标签；分页条「共 N 条数据」。
 */
const listPositionAssignments = vi.fn()
vi.mock('@/api/positionAssignment', () => ({
  listPositionAssignments: (...a) => listPositionAssignments(...a),
  countPendingApplications: vi.fn(() => Promise.resolve({ count: 1 })),
  markApplicationAssigned: vi.fn(() => Promise.resolve({})),
  setUserPosition: vi.fn(() => Promise.resolve({}))
}))
vi.mock('@/api/position', () => ({
  listPositions: vi.fn(() => Promise.resolve({ list: [{ positionId: 401, name: '经营分析岗', status: 'published' }], total: 1 }))
}))

const AdminPositionAssignments = (await import('@/views/admin/AdminPositionAssignments.vue')).default

const ROWS = [
  { userId: 201, username: 'zhangwei', displayName: '张伟', status: 'active', positionId: 401, positionName: '经营分析岗', hasPendingRequest: false, pendingRequestId: null },
  { userId: 203, username: 'chenyu', displayName: '陈宇', status: 'active', positionId: null, positionName: null, hasPendingRequest: true, pendingRequestId: 801 }
]

let mounted, errorSpy, router
beforeEach(() => {
  // 页面读 route.query.keyword（访问审计「查看」跳转带入），冒烟需要一个真路由
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  listPositionAssignments.mockReset().mockResolvedValue({ list: ROWS, total: 13 })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  errorSpy.mockRestore()
})

describe('AdminPositionAssignments · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头「岗位管理」、行文案、分页条「共 13 条数据」齐全（md §一 / §二 / §3.1）', async () => {
    expect(() => { mounted = mountReal(AdminPositionAssignments, {}, { plugins: [router] }) }).not.toThrow()
    await flushAll(10)
    expect(errorSpy).not.toHaveBeenCalled()

    const { container } = mounted
    expect(container.querySelector('.page-header-title').textContent.trim()).toBe('岗位管理')
    expect(container.textContent).toContain('管理用户岗位绑定，分配岗位或处理待分配申请。')
    expect(container.querySelector('input[placeholder="搜索用户名 / 显示名"]')).toBeTruthy()
    expect(container.textContent).toContain('批量绑定')

    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(container.textContent).toContain('zhangwei')
    expect(container.textContent).toContain('未绑定')
    expect(container.textContent).toContain('待分配')

    const pager = container.querySelector('.list-pager')
    expect(pager).toBeTruthy()
    expect(pager.textContent).toContain('共 13 条数据')
  })

  // 2026-10-09 /test-audit 补缺口：访问审计「岗位分配」记录的【查看】会带 ?keyword=用户名 过来（访问审计 §6.3），
  // 此前只测了发送端（adminLoginLogsOps.test.js），接收端的注入无守护。
  it('带 ?keyword=chenyu 进入 → 搜索框预填 chenyu，并以该关键词取数（访问审计 §6.3）', async () => {
    await router.push('/?keyword=chenyu')
    mounted = mountReal(AdminPositionAssignments, {}, { plugins: [router] })
    await flushAll(10)
    expect(mounted.container.querySelector('input[placeholder="搜索用户名 / 显示名"]').value).toBe('chenyu')
    expect(listPositionAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'chenyu' }))
  })
})
