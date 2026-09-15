// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminApis.vue 真实 Element Plus 挂载冒烟（2026-09-12 测试审计 T51，对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md §一.1 / §二.1）。
 *
 * adminApis.test.js 把 el-table / el-tooltip 等桩掉，拦不住组件 setup 期错误（2026-09-11 分页条 TDZ 白屏教训）。
 * 本文件只 mock api 层，其余用真 Element Plus（同 main.js）挂载整页，断言：
 *  - mount 不抛、console.error 零调用；
 *  - 搜索占位「搜索 API 名称或描述」+【新建服务提供系统】（md §一.1 L10/L13）；
 *  - 分组头系统名 / 「N 个 API」+ 组内 el-table 行；分页条（站内统一 .list-pager）「共 N 个数据」（md §二.1 L44）。
 */
const listApis = vi.fn()
const listProviderSystems = vi.fn()
vi.mock('@/api/apiConnector', () => ({
  listApis: (...a) => listApis(...a),
  listProviderSystems: (...a) => listProviderSystems(...a),
  deleteApi: vi.fn(),
  healthCheckApi: vi.fn(),
  publishApi: vi.fn(),
  withdrawApi: vi.fn(),
  deactivateApi: vi.fn(),
  deleteProviderSystem: vi.fn(),
  getApi: vi.fn(),
  createApi: vi.fn(),
  updateApi: vi.fn(),
  getProviderSystem: vi.fn(),
  createProviderSystem: vi.fn(),
  updateProviderSystem: vi.fn(),
  aiGenerateExampleQuestion: vi.fn()
}))

const AdminApis = (await import('@/views/admin/AdminApis.vue')).default

const PS = [
  { id: 'pv_1', name: '财务服务系统', description: '聚合报销、付款与财务单据接口', apiCount: 2 },
  { id: 'pv_2', name: '客户数据平台', description: '客户资料接口', apiCount: 0 }
]
const APIS = [
  {
    id: 'api_1101', name: '报销单查询', icon: '📄', description: '按报销单号查询审批状态与金额', providerSystemId: 'pv_1',
    method: 'GET', readWrite: 'read', status: 'PUBLISHED', pendingAction: null, displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-24T16:10:00+08:00', referencedBySkillCount: 2, referencedBySkills: [], updatedAt: '2026-08-24T16:10:00+08:00'
  },
  {
    id: 'api_1102', name: '提交付款申请', icon: '💰', description: '创建付款申请', providerSystemId: 'pv_1',
    method: 'POST', readWrite: 'write', status: 'NOT_PUBLISHED', pendingAction: null, displayStatus: null,
    lastCheckedAt: null, referencedBySkillCount: 0, referencedBySkills: [], updatedAt: '2026-08-21T10:00:00+08:00'
  }
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
  listProviderSystems.mockReset().mockResolvedValue({ list: PS })
  listApis.mockReset().mockResolvedValue({ list: APIS })
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
  app = createApp(AdminApis).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminApis · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；工具栏 / 分组头 / 行 / 分页条齐全（md §一.1、§二.1）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(container.querySelector('input[placeholder="搜索 API 名称或描述"]')).toBeTruthy()
    expect(text).toContain('新建服务提供系统')
    expect(listApis).toHaveBeenCalledWith({})

    // 两个分组头：名称 + 描述 + 「N 个 API」
    const groups = [...container.querySelectorAll('.aps-group')]
    expect(groups.length).toBe(2)
    expect(groups[0].querySelector('.aps-group-name').textContent).toBe('财务服务系统')
    expect(groups[0].querySelector('.aps-group-count').textContent.trim()).toBe('2 个 API')
    expect(groups[1].textContent).toContain('该系统下暂无 API · 点「在本系统下新建 API」添加')

    // 行数据真的进了 el-table
    expect(groups[0].querySelectorAll('.el-table__row').length).toBe(2)
    expect(groups[0].textContent).toContain('报销单查询')
    expect(groups[0].textContent).toContain('连接正常')
    expect(groups[0].textContent).toContain('未探测')

    // 分页条（站内统一 ListPagination → .list-pager；按系统计数，单位「个」）
    expect(container.querySelector('.list-pager')).toBeTruthy()
    expect(container.querySelector('.list-pager').textContent).toContain('共 2 个数据')
  })
})
