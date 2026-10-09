// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, provide, reactive, ref } from 'vue'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * PositionKnowledgeTab（岗位详情「知识」页签）—— 2026-10-08 补测（此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md：
 *   §三.1.3 页签结构（「知识」页签 knowledge）；
 *   §三.5.1 知识库列表：只展示当前岗位已关联的知识库；列「知识库名称 / 描述 / 数据源 / 文档数量 / 状态 / 操作」；
 *           空列表文案「暂无该岗位可见的知识库」；
 *   §三.5.2 行内【查看】【检索测试】：【查看】跳知识库模块并打开查看抽屉；【检索测试】仅已发布知识库可用、打开检索测试弹窗；
 *   §三.11  跨模块跳转：知识页签可跳知识库模块；
 *   §三.12  异常场景：加载失败提示 + 【重试】。
 *   《各模块必填选填字段一览表.md》岗位第 12 项：知识库（知识）选填、不参与发布阻断——本页签无新建 / 编辑入口，只读列表。
 * 覆盖点：懒加载（仅切到 knowledge 页签才取数）、按岗位 id 过滤、列渲染（数据源汇总 / 文档数 / 三态标签）、
 *         名称搜索 + 状态筛选（点【查询】才生效）、空态、接口失败 + 重试、【查看】路由参数、【检索测试】弹窗。
 *
 * 停用审核在途（显示「审核中」）的已发布知识库不出【检索测试】（yuepu#60⑦ 已修，按 isOnline 判定）。
 * 真实挂载（真 Element Plus 表格 / 输入框 / 下拉），只 vi.mock：api 层 listKnowledgeBases、vue-router、
 * position store、KnowledgeSearchDialog（替换为暴露 visible / kb 的探针）。activeTab 由宿主 provide('pdActiveTab')。
 */

const listKnowledgeBases = vi.fn()
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: (...a) => listKnowledgeBases(...a) }))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const store = reactive({ positionId: 7, basic: { name: '经营分析岗' } })
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))

vi.mock('@/components/admin/KnowledgeSearchDialog.vue', () => ({
  default: {
    name: 'KnowledgeSearchDialog',
    props: ['visible', 'kb'],
    setup: (p) => () => h('div', { class: 'stub-kb-search', 'data-visible': String(!!p.visible) }, p.kb?.name || '')
  }
}))

const PositionKnowledgeTab = (await import('@/components/position/PositionKnowledgeTab.vue')).default

const kb = (over) => ({ id: 0, name: '', description: '', status: 'DRAFT', scopeRefId: 7, sources: [], docCount: 0, ...over })
const ROWS = [
  kb({
    id: 1, name: '经营制度库', description: '公司经营制度汇编', status: 'PUBLISHED', docCount: 12345,
    sources: [{ sourceType: 'UPLOAD' }, { sourceType: 'UPLOAD' }, { sourceType: 'API' }, { sourceType: 'MCP', status: 'DISABLED' }]
  }),
  kb({ id: 2, name: '财务口径库', description: '', status: 'DRAFT', sources: [{ sourceType: 'API' }] }),
  kb({ id: 3, name: '审批中库', status: 'PUBLISHED', pendingAction: 'DELIST', sources: [] }),
  // 其它岗位的知识库：不应出现在本岗位页签
  kb({ id: 9, name: '别岗知识库', status: 'PUBLISHED', scopeRefId: 99 })
]

let mounted
const activeTab = ref('knowledge')
async function mount(props = {}) {
  const Host = defineComponent({
    setup() {
      provide('pdActiveTab', activeTab)
      return () => h(PositionKnowledgeTab, props)
    }
  })
  mounted = mountReal(Host)
  await flushAll(10)
  return mounted.container
}
const root = () => mounted.container
const rows = () => [...root().querySelectorAll('.el-table__body tr.el-table__row')]
const rowByName = (name) => rows().find((r) => r.textContent.includes(name))
const cellTexts = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())
const btnByText = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  vi.clearAllMocks()
  activeTab.value = 'knowledge'
  store.positionId = 7
  store.basic = { name: '经营分析岗' }
  listKnowledgeBases.mockResolvedValue({ list: ROWS.map((r) => ({ ...r })), total: ROWS.length })
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('知识页签 · 列表展示（md §三.5.1）', () => {
  it('落在知识页签 → 取岗位知识库（kbType=POSITION），只展示 scopeRefId = 当前岗位 id 的知识库', async () => {
    await mount()
    expect(listKnowledgeBases).toHaveBeenCalledTimes(1)
    expect(listKnowledgeBases.mock.calls[0][0]).toMatchObject({ kbType: 'POSITION' })
    expect(rows()).toHaveLength(3)
    expect(rowByName('别岗知识库')).toBeUndefined()
  })

  it('区块头「知识库 / 该岗位可见范围内的知识库」，表头为 知识库名称 / 知识库描述 / 数据源 / 文档数量 / 状态 / 操作；无新建入口', async () => {
    await mount()
    expect(root().querySelector('.pd-card-title').textContent.trim()).toBe('知识库')
    expect(root().querySelector('.pd-card-sub').textContent.trim()).toBe('该岗位可见范围内的知识库')
    const heads = [...root().querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim()).filter(Boolean)
    expect(heads).toEqual(['知识库名称', '知识库描述', '数据源', '文档数量', '状态', '操作'])
    expect(root().textContent).not.toMatch(/新建|新增/)
  })

  it('行内容：数据源按已启用类型汇总（停用的不计）、文档数千分位、无上传源文档数为 —、描述为空为 —', async () => {
    await mount()
    const r1 = cellTexts(rowByName('经营制度库'))
    expect(r1.slice(0, 5)).toEqual(['经营制度库', '公司经营制度汇编', '上传 ×2 / API ×1', '12,345', '已发布'])
    const r2 = cellTexts(rowByName('财务口径库'))
    expect(r2.slice(0, 5)).toEqual(['财务口径库', '—', 'API ×1', '—', '未发布'])
    const r3 = cellTexts(rowByName('审批中库'))
    expect(r3[2]).toBe('—')
    expect(r3[4]).toBe('审核中')
  })

  it('边界：本岗位无关联知识库 → 表格空态「暂无该岗位可见的知识库」', async () => {
    listKnowledgeBases.mockResolvedValue({ list: [kb({ id: 9, name: '别岗', scopeRefId: 99 })], total: 1 })
    await mount()
    expect(rows()).toHaveLength(0)
    expect(root().querySelector('.el-table__empty-text').textContent.trim()).toBe('暂无该岗位可见的知识库')
  })

  it('边界：接口直接返回数组（非分页对象）也能展示', async () => {
    listKnowledgeBases.mockResolvedValue([kb({ id: 5, name: '数组形态库' })])
    await mount()
    expect(rows()).toHaveLength(1)
    expect(rowByName('数组形态库')).toBeTruthy()
  })

  it('懒加载：未切到知识页签不取数；切到 knowledge 才加载，且再次切回不重复请求', async () => {
    activeTab.value = 'persona'
    await mount()
    expect(listKnowledgeBases).not.toHaveBeenCalled()
    activeTab.value = 'knowledge'
    await flushAll(10)
    expect(listKnowledgeBases).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(3)
    activeTab.value = 'agents'
    await flushAll(2)
    activeTab.value = 'knowledge'
    await flushAll(4)
    expect(listKnowledgeBases).toHaveBeenCalledTimes(1)
  })
})

describe('知识页签 · 工具栏筛选', () => {
  it('输入名称关键字不立即生效；点【查询】后按名称（忽略大小写、去首尾空格）过滤', async () => {
    listKnowledgeBases.mockResolvedValue({ list: [kb({ id: 1, name: 'HR Policy' }), kb({ id: 2, name: '财务口径库' })] })
    await mount()
    const input = root().querySelector('.pd-kb-search input')
    input.value = '  hr '
    input.dispatchEvent(new Event('input'))
    await flushAll(2)
    expect(rows()).toHaveLength(2)
    btnByText(root().querySelector('.pd-kb-toolbar'), '查询').click()
    await flushAll(4)
    expect(rows()).toHaveLength(1)
    expect(rowByName('HR Policy')).toBeTruthy()
  })

  it('名称框回车等同点【查询】；关键字无匹配 → 空态文案', async () => {
    await mount()
    const input = root().querySelector('.pd-kb-search input')
    input.value = '不存在的库'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter' }))
    await flushAll(4)
    expect(rows()).toHaveLength(0)
    expect(root().querySelector('.el-table__empty-text').textContent.trim()).toBe('暂无该岗位可见的知识库')
  })

  it('状态下拉提供 未发布 / 审核中 / 已发布；选「审核中」点【查询】→ 只剩审核中的行', async () => {
    await mount()
    root().querySelector('.pd-kb-status .el-select__wrapper').click()
    await flushAll(4)
    const items = [...document.body.querySelectorAll('.el-select-dropdown__item')]
    expect(items.map((i) => i.textContent.trim())).toEqual(['未发布', '审核中', '已发布'])
    items.find((i) => i.textContent.trim() === '审核中').click()
    await flushAll(4)
    expect(rows()).toHaveLength(3) // 未点查询前不生效
    btnByText(root().querySelector('.pd-kb-toolbar'), '查询').click()
    await flushAll(4)
    expect(rows().map((r) => cellTexts(r)[0])).toEqual(['审批中库'])
  })
})

describe('知识页签 · 行内操作（md §三.5.2 / §三.11）', () => {
  it('每行都有【查看】；【检索测试】仅已发布知识库出现，未发布行没有', async () => {
    await mount()
    expect(btnByText(rowByName('经营制度库'), '查看')).toBeTruthy()
    expect(btnByText(rowByName('经营制度库'), '检索测试')).toBeTruthy()
    expect(btnByText(rowByName('财务口径库'), '查看')).toBeTruthy()
    expect(btnByText(rowByName('财务口径库'), '检索测试')).toBeUndefined()
  })

  it('前提：已发布且停用审核在途的「审批中库」状态列展示「审核中」（知识库 md §三.2）', async () => {
    await mount()
    expect(cellTexts(rowByName('审批中库'))[4]).toBe('审核中')
  })

  it('已发布但停用审核在途（列表显示「审核中」）的知识库不出【检索测试】，仍有【查看】（知识库 md §三.2：已发布追加【停用】【检索测试】，审核中追加【撤回】；yuepu#60⑦）', async () => {
    await mount()
    expect(btnByText(rowByName('审批中库'), '检索测试')).toBeUndefined()
    expect(btnByText(rowByName('审批中库'), '查看')).toBeTruthy()
    expect(btnByText(rowByName('经营制度库'), '检索测试')).toBeTruthy()
  })

  it('点【查看】→ 跳知识库模块，query 带 action=view、kbId、岗位上下文（positionId / positionName）', async () => {
    await mount()
    btnByText(rowByName('财务口径库'), '查看').click()
    await flushAll(2)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({
      name: 'AdminKnowledgeBase',
      query: { tab: 'kb', action: 'view', kbId: '2', positionId: '7', positionName: '经营分析岗' }
    })
  })

  it('边界：岗位基本信息缺失时【查看】不带 positionName，不报错', async () => {
    store.basic = null
    await mount()
    btnByText(rowByName('财务口径库'), '查看').click()
    await flushAll(2)
    expect(push.mock.calls[0][0].query).toEqual({ tab: 'kb', action: 'view', kbId: '2', positionId: '7' })
  })

  it('点【检索测试】→ 原地打开检索测试弹窗并带入该行知识库，不跳路由', async () => {
    await mount()
    const dlg = () => root().querySelector('.stub-kb-search')
    expect(dlg().getAttribute('data-visible')).toBe('false')
    btnByText(rowByName('经营制度库'), '检索测试').click()
    await flushAll(2)
    expect(dlg().getAttribute('data-visible')).toBe('true')
    expect(dlg().textContent).toBe('经营制度库')
    expect(push).not.toHaveBeenCalled()
  })
})

describe('知识页签 · 异常（md §三.12）', () => {
  it('接口失败 → 展示「知识库加载失败」与【重试】，不渲染表格', async () => {
    listKnowledgeBases.mockRejectedValue(new Error('boom'))
    await mount()
    const empty = root().querySelector('.pd-empty')
    expect(empty.textContent).toContain('知识库加载失败')
    expect(btnByText(empty, '重试')).toBeTruthy()
    expect(root().querySelector('.el-table')).toBeNull()
  })

  it('失败后点【重试】→ 重新取数，成功后恢复列表', async () => {
    listKnowledgeBases.mockRejectedValueOnce(new Error('boom'))
    await mount()
    btnByText(root().querySelector('.pd-empty'), '重试').click()
    await flushAll(10)
    expect(listKnowledgeBases).toHaveBeenCalledTimes(2)
    expect(root().querySelector('.pd-empty')).toBeNull()
    expect(rows()).toHaveLength(3)
  })
})
