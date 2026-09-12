// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

/**
 * AdminKnowledgeBase.vue（知识库容器页，双页签）契约 —— 2026-09-12 测试审计新建（F3，此前零用例）。
 * 文件名带 Shell 以区分子页用例 knowledgeBaseList.test.js / knowledgeSourceList.test.js。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §二：
 * - §二.1 L32-33 页面标题「知识库」/ 说明逐字；
 * - §二.2 L39-40 两个页签「知识库管理」(?tab=kb) /「数据源管理」(?tab=source)；
 *   L42 切换页签同步更新地址参数、刷新后保留当前页签；L43 页签内容缓存（keep-alive），返回时保留查询条件与分页位置。
 * - 容器与连接器容器同范式：tab 缺省 / 非法回落 kb。
 *
 * 两个子页以桩替代（各自有独立页面级用例），桩记录 setup 次数用于断言 keep-alive 不重建。
 */
const setupCount = { kb: 0, source: 0 }
const mkStub = (key, cls) => ({
  name: `Stub-${key}`,
  setup() {
    setupCount[key] += 1
    const state = reactive({ n: 0 })
    return () => h('div', { class: cls, 'data-n': state.n, onClick: () => { state.n += 1 } }, `${key} 子页`)
  }
})
vi.mock('@/views/admin/KnowledgeBaseList.vue', () => ({ default: mkStub('kb', 'stub-kb') }))
vi.mock('@/views/admin/KnowledgeSourceList.vue', () => ({ default: mkStub('source', 'stub-source') }))

const routeMock = reactive({ query: {} })
const routerMock = {
  replace: vi.fn((loc) => {
    if (loc && loc.query) routeMock.query = { ...loc.query }
  })
}
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))

const AdminKnowledgeBase = (await import('@/views/admin/AdminKnowledgeBase.vue')).default

const elTabs = {
  name: 'el-tabs',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="el-tabs" :data-active="modelValue"><slot /></div>'
}
const elTabPane = {
  name: 'el-tab-pane',
  props: ['label', 'name'],
  template: '<button type="button" class="el-tab-pane" :data-name="name" @click="$parent.$emit(\'update:modelValue\', name)">{{ label }}</button>'
}

let app, container
async function flush(n = 4) {
  for (let i = 0; i < n; i++) { await nextTick(); await Promise.resolve() }
}
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(AdminKnowledgeBase) })
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
  setupCount.kb = setupCount.source = 0
  routeMock.query = {}
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminKnowledgeBase 容器页（md 知识库 §二.1 / §二.2）', () => {
  it('页头标题「知识库」+ 说明逐字（md §二.1 L32-33）；页签「知识库管理」「数据源管理」（§二.2 L39-40）', async () => {
    routeMock.query = { tab: 'kb' }
    await mount()
    expect(container.querySelector('.page-header-title').textContent.trim()).toBe('知识库')
    expect(container.querySelector('.page-header-sub').textContent.trim()).toBe(
      '集中管理企业、专家和岗位知识来源，可将文件上传至平台 RAG，或通过 API、MCP 接入第三方知识服务。'
    )
    expect(tabLabels()).toEqual(['知识库管理', '数据源管理'])
    expect([...container.querySelectorAll('.el-tab-pane')].map((b) => b.dataset.name)).toEqual(['kb', 'source'])
  })

  it('query.tab 缺省 → 默认知识库管理，并 replace 补全 tab=kb', async () => {
    routeMock.query = {}
    await mount()
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'kb' } })
    expect(activeName()).toBe('kb')
    expect(container.querySelector('.stub-kb')).toBeTruthy()
    expect(container.querySelector('.stub-source')).toBeNull()
  })

  it('query.tab 非法（xxx）→ 回落 kb，其余 query（如岗位上下文 positionId）保留', async () => {
    routeMock.query = { tab: 'xxx', positionId: 'ps_1' }
    await mount()
    expect(routerMock.replace).toHaveBeenCalledWith({ query: { tab: 'kb', positionId: 'ps_1' } })
    expect(container.querySelector('.stub-kb')).toBeTruthy()
  })

  it('query.tab=source → 直接展示数据源管理，不 replace（刷新后保留当前页签，md §二.2 L42）', async () => {
    routeMock.query = { tab: 'source' }
    await mount()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(activeName()).toBe('source')
    expect(container.querySelector('.stub-source')).toBeTruthy()
    expect(container.querySelector('.stub-kb')).toBeNull()
    expect(setupCount).toEqual({ kb: 0, source: 1 })
  })

  it('点「数据源管理」→ replace 同步 tab=source 并保留其余 query（md §二.2 L42）', async () => {
    routeMock.query = { tab: 'kb', positionId: 'ps_1', kw: '产品' }
    await mount()
    await clickTab('source')
    expect(routerMock.replace).toHaveBeenLastCalledWith({ query: { tab: 'source', positionId: 'ps_1', kw: '产品' } })
    expect(activeName()).toBe('source')
    expect(container.querySelector('.stub-source')).toBeTruthy()
  })

  it('keep-alive：kb → source → kb 切走再切回，子页不重建且本地状态保留（md §二.2 L43）', async () => {
    routeMock.query = { tab: 'kb' }
    await mount()
    container.querySelector('.stub-kb').click()
    await flush()
    expect(container.querySelector('.stub-kb').getAttribute('data-n')).toBe('1')
    await clickTab('source')
    expect(setupCount.source).toBe(1)
    await clickTab('kb')
    expect(setupCount.kb).toBe(1)
    expect(container.querySelector('.stub-kb').getAttribute('data-n')).toBe('1')
    await clickTab('source')
    expect(setupCount.source).toBe(1)
  })
})
