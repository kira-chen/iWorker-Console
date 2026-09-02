// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * 回归（线上误报修复）：Q2「已移出工具」diff 必须遵守 refsChanged 铁律——
 * 只有后端确实发来新的 referencedTools（refsChanged !== false 且 != null）才 diff；
 * 否则（纯目录操作 / 删 .json·.txt → refsChanged=false、referencedTools=null）视为「引用集未变」、不弹移出提示。
 *
 * 复现 bug：已引用数据表工具的技能新建文件夹 → 后端回吐 treeChanged=true/refsChanged=false/referencedTools=null
 *  → 旧代码 `saveVO.referencedTools || []` 把 null 当空集 → 已有工具全被误判「已移出」→ 误报 toast。
 */

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' }, meta: { skillSource: undefined } }),
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: () => {}
}))

// 技能详情：已引用 3 个数据表工具（模拟线上场景）。
const REFERENCED = [
  { code: 'table__crm_visit__query', bizName: '客户交互记录表-查询', checkStatus: 'HEALTHY', known: true },
  { code: 'table__case__query', bizName: '案例主表-查询', checkStatus: 'HEALTHY', known: true },
  { code: 'table__product__query', bizName: '产品目录-查询', checkStatus: 'HEALTHY', known: true }
]
const fetchSkillDetailSpy = vi.fn(() =>
  Promise.resolve({
    skillId: 7,
    name: '客户技能',
    description: '',
    triggers: [],
    skillMd: '# 正文',
    referencedTools: REFERENCED,
    agentId: null,
    positionId: null,
    category: 'OPERATION'
  })
)
vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({
    agents: [],
    basic: null,
    fetchSkillDetail: fetchSkillDetailSpy,
    patchSkill: vi.fn(() => Promise.resolve({ skill: { referencedTools: REFERENCED, category: 'OPERATION' } })),
    load: vi.fn(() => Promise.resolve()),
    reset: vi.fn()
  })
}))

vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: vi.fn(() =>
    Promise.resolve({
      skillId: 7,
      entryPath: 'SKILL.md',
      files: [
        { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
        { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false },
        { path: 'data.json', name: 'data.json', fileType: 'json', isEntry: false }
      ]
    })
  ),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '' })),
  saveSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } }))
}))
vi.mock('@/api/position', () => ({ deleteSkill: vi.fn() }))
vi.mock('@/api/skillCategory', () => ({ listSkillCategories: vi.fn(() => Promise.resolve([])), setSkillCategory: vi.fn(() => Promise.resolve()) }))

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
// V89 通道前缀分段隔离后编辑页改用命名空间 API（channelApi.get/update）。
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: vi.fn(), update: vi.fn() },
  systemSkillApi: { get: vi.fn(), update: vi.fn() }
}))
// N8：AdminSkillEditPage 现额外引 @/api/admin（业务系统技能数据源）→ 必须存根，否则会拉真实 @/api/request→@/router 触发 createRouter。
vi.mock('@/api/admin', () => ({ getBizSystemOwnedSkillDetail: vi.fn(), updateBizSystemOwnedSkill: vi.fn() }))

// ElMessage：可调用 + 各级方法均为 spy（断言是否弹「已移出」warning）。
const elMessageFn = vi.fn()
const elMessage = Object.assign(elMessageFn, { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
vi.mock('element-plus', () => ({
  ElMessage: elMessage,
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), prompt: vi.fn() }
}))

// 子组件存根：暴露 tree-changed / file-deleted 触发器。
let emitTreeChanged = null
let emitFileDeleted = null
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill'],
    emits: ['tree-changed', 'file-deleted'],
    setup(_, { emit }) {
      emitTreeChanged = (saveVO, meta) => emit('tree-changed', saveVO, meta)
      emitFileDeleted = (path, saveVO) => emit('file-deleted', path, saveVO)
      return () => h('div', { class: 'stub-focus' })
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default

let app, container
function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminSkillEditPage)
  app.mount(container)
  return container
}
async function ready() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
// 断言是否弹了「已移出」warning（callable ElMessage({type:'warning',message:含「已移出」}））。
function movedOutToastFired() {
  return elMessageFn.mock.calls.some(
    ([arg]) => arg && /已移出本技能运行时白名单/.test(arg.message || '')
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  emitTreeChanged = emitFileDeleted = null
})

describe('AdminSkillEditPage · Q2 移出工具 diff 遵守 refsChanged 铁律（线上误报修复）', () => {
  it('纯目录操作（新建文件夹）refsChanged=false、referencedTools=null → 不弹「已移出」', async () => {
    mount()
    await ready()
    expect(typeof emitTreeChanged).toBe('function')
    // 后端纯目录回吐：树变、引用集未变、referencedTools=null。
    emitTreeChanged(
      { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null },
      { kind: 'folder-create', dir: 'newdir' }
    )
    await ready()
    expect(movedOutToastFired(), '纯目录操作不应弹「已移出」').toBe(false)
  })

  it('删 .json（refsChanged=false）→ 不弹「已移出」', async () => {
    mount()
    await ready()
    emitFileDeleted('data.json', { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null })
    await ready()
    expect(movedOutToastFired(), '删 .json 不应弹「已移出」').toBe(false)
    // 仍给普通「已删除」成功提示。
    expect(elMessage.success).toHaveBeenCalledWith('已删除')
  })

  it('删 .md 真移出工具（refsChanged=true，referencedTools 少了若干）→ 正确弹「已移出」', async () => {
    mount()
    await ready()
    // 移出后只剩前 1 个工具（少了案例主表 / 产品目录）。
    emitFileDeleted('references/a.md', {
      tree: { files: [] },
      treeChanged: true,
      refsChanged: true,
      referencedTools: [REFERENCED[0]]
    })
    await ready()
    expect(movedOutToastFired(), '真移出应弹「已移出」').toBe(true)
    const moved = elMessageFn.mock.calls.find(([a]) => /已移出/.test(a?.message || ''))[0]
    expect(moved.message).toContain('案例主表-查询')
    expect(moved.message).toContain('产品目录-查询')
  })

  it('老后端缺省（无 refsChanged）但带全量 referencedTools → 仍走 diff（兼容不变）', async () => {
    mount()
    await ready()
    // 无 refsChanged 字段（undefined），带全量但少了 1 个工具。
    emitFileDeleted('references/a.md', { tree: { files: [] }, treeChanged: true, referencedTools: [REFERENCED[0], REFERENCED[1]] })
    await ready()
    expect(movedOutToastFired(), '老后端带全量 referencedTools 仍 diff').toBe(true)
  })

  it('删文件夹 refsChanged=false、referencedTools=null → 不弹「已移出」（误报根因路径）', async () => {
    mount()
    await ready()
    emitTreeChanged(
      { tree: { files: [] }, treeChanged: true, refsChanged: false, referencedTools: null },
      { kind: 'folder-delete', removedPrefix: 'references' }
    )
    await ready()
    expect(movedOutToastFired(), '删纯目录不应误报').toBe(false)
  })
})
