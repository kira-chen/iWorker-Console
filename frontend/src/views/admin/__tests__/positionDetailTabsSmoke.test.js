// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia } from 'pinia'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * PositionDetailTabs.vue 真实挂载冒烟（2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §1.2 / §1.3 / §2.1）。
 *
 * positionDetailTabs / positionCompletenessG1 两份页面级单测把七个页签子组件与 el-* 全桩，拦不住子组件 setup 期报错
 * （2026-09-11 分页条 TDZ 白屏同类）。本文件用 helpers/smokeMount 的 mountReal：真 Element Plus + 真 Pinia 岗位 store，
 * 不桩任何子组件，只 mock api 层与路由，断言：
 *  - 挂载不抛、console.error 零调用；
 *  - md §1.3 七个页签文案（人格 / 采集字段 / 工作档案 / 知识 / Agent 与技能 / 自动化任务 / 连接器）都在；
 *  - 默认人格页签探针：「岗位名称」卡在、名称输入框回显种子岗位名（md §2.1）。
 */
const routeMock = vi.hoisted(() => ({ params: { id: '5' }, query: {}, meta: {} }))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ href: '/x' }) }),
  onBeforeRouteLeave: () => {},
  // 部分子组件经 api/request → src/router 拖入真实 router 模块，需喂可跑通的工厂（同 positionCompletenessG1）
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  createWebHistory: () => ({}),
  RouterLink: { name: 'RouterLink', render: () => null }
}))

const DETAIL = {
  positionId: 5,
  name: '经营分析岗',
  icon: '▤',
  status: 'draft',
  pendingAction: null,
  description: '负责经营数据汇总与分析',
  claimDescriptions: ['自动汇总经营数据'],
  exampleQuestions: ['帮我分析本周经营数据', '本月异常指标有哪些', '生成经营周报'],
  positionSop: '1. 理解意图',
  persona: '',
  intakeSchema: [{ label: '负责区域', key: 'region', type: 'text', required: true, options: [] }],
  businessSystemIds: [],
  connectorMcpIds: [],
  connectorApiIds: [],
  agents: []
}
const getPosition = vi.fn()
const getNextVersionLabel = vi.fn()
const updatePosition = vi.fn()
const listSampleTasks = vi.fn()
vi.mock('@/api/position', () => ({
  getPosition: (...a) => getPosition(...a),
  updatePosition: (...a) => updatePosition(...a),
  createPosition: vi.fn(),
  publishPosition: vi.fn(() => Promise.resolve({})),
  getNextVersionLabel: (...a) => getNextVersionLabel(...a),
  listPositionPublications: vi.fn(() => Promise.resolve([])),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  updateSkill: vi.fn(),
  assignSkill: vi.fn(),
  getSkill: vi.fn(),
  detachSkill: vi.fn(),
  listSkills: vi.fn(() => Promise.resolve({ list: [], total: 0 })),
  listToolPicker: vi.fn(() => Promise.resolve({ list: [] })),
  listPlatformSkillCandidates: vi.fn(() => Promise.resolve([])),
  getIconLibrary: vi.fn(() => Promise.resolve([])),
  aiGenerateIcon: vi.fn(),
  probeAiIconAvailability: vi.fn(() => Promise.resolve(false)),
  uploadIcon: vi.fn()
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn(() => Promise.resolve({ list: [] })) }))
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: (...a) => listSampleTasks(...a) }))
vi.mock('@/api/knowledgeBase', () => ({
  listKnowledgeBases: vi.fn(() => Promise.resolve({ list: [], total: 0 })),
  searchKnowledgeBase: vi.fn(() => Promise.resolve({ list: [] }))
}))
vi.mock('@/api/admin', () => ({
  listMcp: vi.fn(() => Promise.resolve({ list: [] })),
  listBizSystems: vi.fn(() => Promise.resolve({ list: [] }))
}))
vi.mock('@/api/apiConnector', () => ({ listApis: vi.fn(() => Promise.resolve({ list: [] })) }))

const PositionDetailTabs = (await import('@/views/admin/PositionDetailTabs.vue')).default

// 本仓 jsdom 下 globalThis.localStorage 为 undefined，AdminRail 挂载期读侧栏折叠态 → 注入内存版存储（同 positionAssignmentMock.test）
const makeStorage = () => {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

let mounted, errorSpy, origStorageDesc
beforeEach(() => {
  origStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  routeMock.query = {}
  getPosition.mockReset().mockResolvedValue(JSON.parse(JSON.stringify(DETAIL)))
  getNextVersionLabel.mockReset().mockResolvedValue('v1.0.0')
  updatePosition.mockReset().mockResolvedValue({})
  listSampleTasks.mockReset().mockResolvedValue({ list: [] })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  errorSpy.mockRestore()
  if (origStorageDesc) Object.defineProperty(globalThis, 'localStorage', origStorageDesc)
  else delete globalThis.localStorage
})

describe('PositionDetailTabs · 真实 Element Plus + Pinia 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；七个页签文案齐全；默认人格页签「岗位名称」卡在且回显岗位名（md §1.3 / §2.1）', async () => {
    expect(() => { mounted = mountReal(PositionDetailTabs, {}, { plugins: [createPinia()] }) }).not.toThrow()
    await flushAll(12)
    expect(getPosition).toHaveBeenCalledWith('5')
    expect(errorSpy).not.toHaveBeenCalled()

    const { container } = mounted
    const tabLabels = [...container.querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
    expect(tabLabels).toEqual(['人格', '采集字段', '工作档案', '知识', 'Agent 与技能', '自动化任务', '连接器'])

    // 人格页签探针：岗位名称卡 + 输入框回显
    const nameCard = [...container.querySelectorAll('.pd-card')].find((c) => c.querySelector('.pd-card-title')?.textContent.startsWith('岗位名称'))
    expect(nameCard).toBeTruthy()
    expect(nameCard.querySelector('input').value).toBe('经营分析岗')
    // 顶栏静态名称
    expect(container.querySelector('.tb-name-display').textContent.trim()).toBe('经营分析岗')
  })
})

// 待决策 J36（md 岗位 §3.7）：建议版本号拉取失败 → 发布前检查弹窗提示「版本号获取失败」+【重试】，不支持手填；
// 页面须把 useVersionPublish 的 loadFailed / loadNextVersionLabel 接到 PublishCheckDialog 的 :load-failed / @retry（删掉任一接线本组变红）。
describe('PositionDetailTabs · 发布弹窗版本号获取失败可重试（J36）', () => {
  it('getNextVersionLabel 拒绝 → 弹窗显「版本号获取失败」；点【重试】再次取号并显示版本号', async () => {
    const full = { ...JSON.parse(JSON.stringify(DETAIL)), agents: [{ agentId: 1, name: 'A1', skills: [{ skillId: 1, name: 's' }] }] }
    getPosition.mockResolvedValue(full)
    updatePosition.mockResolvedValue(full) // 发布前先自动保存，store 以保存回包为准，回包须是完整详情
    listSampleTasks.mockResolvedValue({ list: [{ id: 1 }] }) // 九项完整性校验要 ≥1 条自动化任务
    getNextVersionLabel.mockReset().mockRejectedValueOnce(new Error('网络错误')).mockResolvedValue('v1.0.0')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mounted = mountReal(PositionDetailTabs, {}, { plugins: [createPinia()] })
    await flushAll(12)
    ;[...mounted.container.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '发布岗位').click()
    await flushAll(12)
    expect(getNextVersionLabel).toHaveBeenCalledTimes(1)
    const hint = () => document.body.querySelector('.load-failed')
    expect(hint().textContent).toContain('版本号获取失败')
    expect(document.body.textContent).not.toContain('v1.0.0')

    ;[...hint().querySelectorAll('button')].find((b) => b.textContent.trim() === '重试').click()
    await flushAll(12)
    expect(getNextVersionLabel).toHaveBeenCalledTimes(2)
    expect(hint()).toBeNull()
    expect(document.body.textContent).toContain('v1.0.0')
    warnSpy.mockRestore()
  })
})
