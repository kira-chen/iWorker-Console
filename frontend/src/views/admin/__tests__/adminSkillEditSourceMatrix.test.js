// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * 接线守卫 · AdminSkillEditPage 路由 meta → 数据源分流 穷举矩阵（质量闸 #1，2026-08-08）。
 *
 * 背景：V89 上线时本页 :skill-source 写死二值表达式漏掉 'system'，编辑器内文件树全部操作打错
 * 通道前缀 404（docs/update/2026-08-08.md §2）。本守卫把「路由 meta → 编辑器 skill-source prop +
 * 文件树 API source + 详情 API 命名空间」这条接线链路按**全部合法视图模式**穷举钉死：
 * 新增视图模式（新通道/新数据源）必须同步扩本矩阵，漏接线在 CI 即红。
 */

const routeState = vi.hoisted(() => ({ meta: {}, params: { id: 'sk_1' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeState.params, meta: routeState.meta }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: () => {}
}))

const platformGet = vi.fn()
const systemGet = vi.fn()
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: (...a) => platformGet(...a), update: vi.fn() },
  systemSkillApi: { get: (...a) => systemGet(...a), update: vi.fn() }
}))
const bizGet = vi.fn()
vi.mock('@/api/admin', () => ({
  getBizSystemOwnedSkillDetail: (...a) => bizGet(...a),
  updateBizSystemOwnedSkill: vi.fn()
}))
const fetchSkillDetail = vi.fn()
vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({
    agents: [],
    basic: null,
    fetchSkillDetail: (...a) => fetchSkillDetail(...a),
    patchSkill: vi.fn(),
    load: vi.fn(() => Promise.resolve()),
    reset: vi.fn()
  })
}))
vi.mock('@/api/position', () => ({ deleteSkill: vi.fn() }))
vi.mock('@/api/skillCategory', () => ({
  listSkillCategories: vi.fn(() => Promise.resolve([])),
  setSkillCategory: vi.fn(() => Promise.resolve())
}))

// 2026-09-01 PRD 对齐改造取代旧口径：AdminSkillEditPage 新增引 @/api/fieldDict（技能分类同源字典）
// 与 @/api/unifiedSkill（apiFor 分流 / 发布态派生）→ 必须存根，
// 否则会拉真实 @/api/request → @/router 触发 createRouter（本文件 vue-router 为部分 mock）。
vi.mock('@/api/fieldDict', () => ({ listFieldDict: vi.fn(() => Promise.resolve({ skillCategory: [] })) }))
vi.mock('@/api/unifiedSkill', () => ({
  apiFor: () => ({}),
  SKILL_TYPE: { POSITION: 'POSITION', PLATFORM: 'PLATFORM', SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' },
  skillPublishReadiness: () => ({ ready: true, missing: [] }),
  deriveSkillDisplayView: () => ({})
}))
const listSkillFiles = vi.fn()
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: (...a) => listSkillFiles(...a),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '' })),
  saveSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  downloadSkillFile: vi.fn()
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(), prompt: vi.fn() }
}))
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))

// 编辑器存根：捕获页面实际传入的 skill-source（本矩阵的核心断言点）。
let capturedSkillSource = null
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill', 'skillSource', 'backLabel', 'publications', 'hideMarketFields'],
    setup(props) {
      return () => {
        capturedSkillSource = props.skillSource
        return h('div', { class: 'stub-focus' })
      }
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

const DETAIL = {
  skillId: 'sk_1',
  name: 'S',
  description: '',
  triggers: [],
  skillMd: '# md',
  referencedTools: [],
  category: null,
  publications: []
}

let app, container
async function mountWith(meta, params = { id: 'sk_1' }) {
  routeState.meta = meta
  routeState.params = params
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminSkillEditPage)
  app.mount(container)
  // 详情/树两路并发 promise 链 flush
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedSkillSource = null
  fetchSkillDetail.mockResolvedValue(DETAIL)
  platformGet.mockResolvedValue(DETAIL)
  systemGet.mockResolvedValue(DETAIL)
  bizGet.mockResolvedValue(DETAIL)
  listSkillFiles.mockResolvedValue({ skillId: 'sk_1', entryPath: 'SKILL.md', files: [] })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('接线守卫 · 路由 meta → 数据源分流矩阵（全部视图模式穷举）', () => {
  it('FDE（meta 无 skillSource）→ 编辑器 source=fde，树走 fde，详情走 position store', async () => {
    await mountWith({})
    expect(capturedSkillSource).toBe('fde')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'fde')
    expect(fetchSkillDetail).toHaveBeenCalledWith('sk_1')
    expect(platformGet).not.toHaveBeenCalled()
    expect(systemGet).not.toHaveBeenCalled()
  })

  it('平台市场（skillSource=platform）→ 编辑器 source=platform，树走 platform，详情走 platformSkillApi', async () => {
    await mountWith({ skillSource: 'platform' })
    expect(capturedSkillSource).toBe('platform')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'platform')
    expect(platformGet).toHaveBeenCalledWith('sk_1')
    expect(systemGet).not.toHaveBeenCalled()
  })

  it('系统默认（platform + skillChannel=system，V89）→ 编辑器 source=system，树走 system，详情走 systemSkillApi', async () => {
    await mountWith({ skillSource: 'platform', skillChannel: 'system' })
    expect(capturedSkillSource).toBe('system')
    expect(listSkillFiles).toHaveBeenCalledWith('sk_1', 'system')
    expect(systemGet).toHaveBeenCalledWith('sk_1')
    expect(platformGet).not.toHaveBeenCalled()
  })

  it('业务系统技能（skillSource=bizSystem）→ 无文件端点不拉树，详情走 biz-systems 端点', async () => {
    await mountWith({ skillSource: 'bizSystem' }, { id: 'sk_1', bizId: 'bs_1' })
    expect(listSkillFiles).not.toHaveBeenCalled()
    expect(bizGet).toHaveBeenCalledWith('bs_1', 'sk_1')
    expect(platformGet).not.toHaveBeenCalled()
    expect(systemGet).not.toHaveBeenCalled()
  })
})
