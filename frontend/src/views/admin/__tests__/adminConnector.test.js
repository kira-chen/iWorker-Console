// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

/**
 * AdminConnector.vue（连接器容器页）契约 —— 2026-09-12 测试审计新建（F3，此前零用例）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md §一：
 * - §一.1 L9-11 页面标题「连接器」/ 说明「为平台配置可用的连接器，同时服务于个人用户和 FDE 工程师」/ 三个页签 MCP、API、业务系统；
 * - §一.2 L20 默认打开 MCP；L21 点页签展示对应内容；L22 切走再切回列表 / 搜索 / 筛选状态保持（keep-alive）；
 *   L23 刷新后停留原页签（tab 落 query）；L24 无法识别当前页签时回到 MCP。
 *
 * 三个子页以桩替代（各自有独立页面级用例），桩记录 setup 次数用于断言 keep-alive 不重建；
 * vue-router 以响应式 routeMock 注入，router.replace 桩会真的改写 query（模拟路由生效）。
 */
const setupCount = { mcp: 0, api: 0, biz: 0 }
const mkStub = (key, cls) => ({
  name: `Stub-${key}`,
  setup() {
    setupCount[key] += 1
    // 每个桩带一个本地状态：切走再切回若被重建，这个数会归零
    const state = reactive({ n: 0 })
    return () => h('div', { class: cls, 'data-n': state.n, onClick: () => { state.n += 1 } }, `${key} 子页`)
  }
})
vi.mock('@/views/admin/AdminMcp.vue', () => ({ default: mkStub('mcp', 'stub-mcp') }))
vi.mock('@/views/admin/AdminApis.vue', () => ({ default: mkStub('api', 'stub-api') }))
vi.mock('@/views/admin/AdminBizSystems.vue', () => ({ default: mkStub('biz', 'stub-biz') }))

const routeMock = reactive({ query: {} })
const routerMock = {
  replace: vi.fn((loc) => {
    // 模拟路由生效：replace 后 route.query 变成新值（组件靠 watch(route.query.tab) 联动）
    if (loc && loc.query) routeMock.query = { ...loc.query }
  })
}
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))

const AdminConnector = (await import('@/views/admin/AdminConnector.vue')).default

// el-tabs / el-tab-pane 轻桩：渲染页签按钮，点击即 update:modelValue（对应真组件的 v-model 切换）
const elTabs = {
  name: 'el-tabs',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="el-tabs" :data-active="modelValue"><slot /></div>'
}
const elTabPane = {
  name: 'el-tab-pane',
  props: ['label', 'name'],
  inject: [],
  template: '<button type="button" class="el-tab-pane" :data-name="name" @click="$parent.$emit(\'update:modelValue\', name)">{{ label }}</button>'
}

let app, container
async function flush(n = 4) {
  for (let i = 0; i < n; i++) { await nextTick(); await Promise.resolve() }
}
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(AdminConnector) })
  app.component('el-tabs', elTabs)
  app.component('el-tab-pane', elTabPane)
  app.mount(container)
  await flush()
  return container
}
const tabLabels = () => [...container.querySelectorAll('.el-tab-pane')].map((b) => b.textContent.trim())
const clickTab = async (name) => {
  container.querySelector(`.el-tab-pane[data-name="${name}"]`).click()
  await flush()
}
const activeName = () => container.querySelector('.el-tabs').getAttribute('data-active')

beforeEach(() => {
  vi.clearAllMocks()
  setupCount.mcp = setupCount.api = setupCount.biz = 0
  routeMock.query = {}
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminConnector 容器页（md MCP §一.1 / §一.2）', () => {
  it('页头标题「连接器」+ 说明逐字（md §一.1 L9-10）；三个页签 MCP / API / 业务系统（L11）', async () => {
    routeMock.query = { tab: 'mcp' }
    await mount()
    expect(container.querySelector('.page-header-title').textContent.trim()).toBe('连接器')
    expect(container.querySelector('.page-header-sub').textContent.trim()).toBe('为平台配置可用的连接器，同时服务于个人用户和 FDE 工程师')
    expect(tabLabels()).toEqual(['MCP', 'API', '业务系统'])
  })

  it('query.tab 缺省 → 默认打开 MCP，并 replace 补全 tab=mcp（md §一.2 L20 / L23）', async () => {
    routeMock.query = {}
    await mount()
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'mcp' } })
    expect(activeName()).toBe('mcp')
    expect(container.querySelector('.stub-mcp')).toBeTruthy()
    expect(container.querySelector('.stub-api')).toBeNull()
  })

  it('query.tab 非法（xxx）→ 自动回到 MCP 页签（md §一.2 L24），其余 query 保留', async () => {
    routeMock.query = { tab: 'xxx', positionId: '5' }
    await mount()
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'mcp', positionId: '5' } })
    expect(activeName()).toBe('mcp')
    expect(container.querySelector('.stub-mcp')).toBeTruthy()
  })

  it('query.tab=bizsystem → 直接展示业务系统子页，不再 replace（刷新后停留原页签，md §一.2 L23）', async () => {
    routeMock.query = { tab: 'bizsystem' }
    await mount()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(activeName()).toBe('bizsystem')
    expect(container.querySelector('.stub-biz')).toBeTruthy()
    expect(container.querySelector('.stub-mcp')).toBeNull()
    // 只有当前页签的子页被创建
    expect(setupCount).toEqual({ mcp: 0, api: 0, biz: 1 })
  })

  it('点 API 页签 → replace 只替换 tab、保留其余 query；页面切到 API 子页（md §一.2 L21）', async () => {
    routeMock.query = { tab: 'mcp', positionId: '5' }
    await mount()
    await clickTab('api')
    expect(routerMock.replace).toHaveBeenLastCalledWith({ query: { tab: 'api', positionId: '5' } })
    expect(activeName()).toBe('api')
    expect(container.querySelector('.stub-api')).toBeTruthy()
    expect(container.querySelector('.stub-mcp')).toBeNull()
  })

  it('点当前已激活的页签 → 不 replace（避免无意义路由写入）', async () => {
    routeMock.query = { tab: 'mcp' }
    await mount()
    await clickTab('mcp')
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('keep-alive：MCP → API → MCP 切走再切回，MCP 子页不重建（setup 仍 1 次）且本地状态保留（md §一.2 L22）', async () => {
    routeMock.query = { tab: 'mcp' }
    await mount()
    expect(setupCount.mcp).toBe(1)
    // 在 MCP 子页里改一个本地状态（模拟用户输入了搜索 / 翻了页）
    container.querySelector('.stub-mcp').click()
    await flush()
    expect(container.querySelector('.stub-mcp').getAttribute('data-n')).toBe('1')
    await clickTab('api')
    expect(setupCount.api).toBe(1)
    await clickTab('mcp')
    expect(setupCount.mcp).toBe(1) // 没有被重新 setup
    expect(container.querySelector('.stub-mcp').getAttribute('data-n')).toBe('1') // 状态还在
    // 再切回 API 同样不重建
    await clickTab('api')
    expect(setupCount.api).toBe(1)
  })
})
