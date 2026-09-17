// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminBizSystems.vue 真实 Element Plus 挂载冒烟（2026-09-12 测试审计 T51，对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/业务系统/prd-业务系统.md §一.1 / §二.1）。
 *
 * 该页此前零测试——62545c6「修复 AdminBizSystems 页面白屏：补充 computed 导入」就是 setup 期错误没人拦的实例。
 * 本文件只 mock api/admin，其余用真 Element Plus + 真 vue-router（memory history）挂载整页，断言：
 *  - mount 不抛、console.error 零调用；
 *  - 搜索占位「搜索系统名称或描述」+【新建业务系统】（md §一.1 L10/L13）；
 *  - 3 行 el-table 数据行 + 分页条（站内统一 .list-pager）「共 3 条数据」。
 */
const listBizSystems = vi.fn()
vi.mock('@/api/admin', () => ({
  listBizSystems: (...a) => listBizSystems(...a),
  deleteBizSystem: vi.fn(),
  submitBizSystemPublish: vi.fn(),
  withdrawBizSystem: vi.fn(),
  delistBizSystem: vi.fn(),
  getBizSystem: vi.fn(),
  createBizSystem: vi.fn(),
  updateBizSystem: vi.fn(),
  listBizSystemSkills: vi.fn(),
  createBizSystemOwnedSkill: vi.fn(),
  deleteBizSystemOwnedSkill: vi.fn()
}))

const AdminBizSystems = (await import('@/views/admin/AdminBizSystems.vue')).default

const ROWS = [
  { id: 'biz_2101', name: '客户管理系统 CRM', icon: '◎', description: '管理客户资料、商机与销售跟进', loginUrl: 'https://crm.example.com/login', type: 'PLATFORM', status: 'PUBLISHED', pendingAction: null, referencedBySkillCount: 2, referencedBySkills: [], refs: ['客户拜访准备', '销售方案生成'], updatedAt: '2026-08-24T15:40:00+08:00' },
  { id: 'biz_2102', name: '人力资源系统', icon: '▦', description: '员工、组织、请假和入转调离管理', loginUrl: 'https://hr.example.com/login', type: 'PLATFORM', status: 'PENDING_REVIEW', pendingAction: 'PUBLISH', referencedBySkillCount: 1, referencedBySkills: [], refs: ['员工信息查询'], updatedAt: '2026-08-24T11:32:00+08:00' },
  { id: 'biz_2103', name: '合同管理系统', icon: '↗', description: '合同起草、审批、归档与风险跟踪', loginUrl: 'https://contract.example.com/login', type: 'PLATFORM', status: 'NOT_PUBLISHED', pendingAction: null, referencedBySkillCount: 0, referencedBySkills: [], refs: [], updatedAt: '2026-08-22T16:18:00+08:00' }
]

// jsdom 没有 ResizeObserver（el-table 布局用），补一个空实现
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let app, container, errorSpy
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub
  listBizSystems.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  errorSpy.mockRestore()
})

async function mountReal() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }]
  })
  await router.push('/admin/connector?tab=bizsystem')
  await router.isReady()
  app = createApp(AdminBizSystems).use(ElementPlus).use(router)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminBizSystems · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；工具栏 / 3 行 / 分页条齐全（md §一.1、§二.1）', async () => {
    await expect(mountReal()).resolves.toBeUndefined()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(container.querySelector('input[placeholder="搜索系统名称或描述"]')).toBeTruthy()
    expect(text).toContain('新建业务系统')
    expect(listBizSystems).toHaveBeenCalled()

    // 行数据真的进了 el-table：3 行、名称 / 描述 / 登录地址 / 状态标签
    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(container.querySelectorAll('.el-table__row').length).toBe(3)
    expect(text).toContain('客户管理系统 CRM')
    expect(text).toContain('管理客户资料、商机与销售跟进')
    expect(text).toContain('https://hr.example.com/login')
    expect(text).toContain('已发布')
    expect(text).toContain('审核中')
    expect(text).toContain('未发布')
    expect(text).toContain('2 个技能引用')
    expect(text).toContain('暂无引用')

    // 分页条（站内统一 ListPagination → .list-pager；total>0 恒显）
    expect(container.querySelector('.list-pager')).toBeTruthy()
    expect(container.querySelector('.list-pager').textContent).toContain('共 3 条数据')
  })
})
