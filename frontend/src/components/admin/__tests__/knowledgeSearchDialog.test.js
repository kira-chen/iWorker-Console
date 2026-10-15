// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { reactive } from 'vue'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeSearchDialog.vue（知识库检索测试弹窗）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §三.7「检索测试」：
 *   - 标题「检索测试 · [知识库名]」；
 *   - 检索问题默认示例值「公司的标准解决方案包括哪些内容？」；
 *   - Top K 下拉按数值升序 3 / 5 / 10 / 20，默认 5；
 *   - 数据源范围：默认「全部已启用数据源」；可改选本库引用的某一个已启用数据源（仅检索该源）；
 *     已停用的数据源同样列出但置灰不可选（三组选项：全部 / 已启用 / 已停用）；
 *   - 点【开始测试】展示结果总数、耗时、各数据源召回统计；结果卡片展示排名、相关度、数据源类型、
 *     来源名称、页码定位、命中内容，长内容默认收起可展开；
 *   - 某一数据源失败时展示该来源错误，仍展示其他数据源正常结果；
 *   - 未输入问题时【开始测试】置灰不可点（不再另设空状态页）；无可用数据源时提示先配置并启用数据源。
 * 另覆盖：检索请求进行中的 loading 态（骨架 + 按钮 loading，编码规范「关键交互需 loading 态」）、
 *   接口整体失败的错误态、重新打开弹窗时表单复位。
 *
 * 写法：真挂载 Element Plus（mountReal），searchKnowledgeBase 以 vi.mock 打桩；
 *   组件只在 visible 由 false→true 时复位，故用 reactive props 先关后开（与列表页打开弹窗同路径）。
 */

const api = { searchKnowledgeBase: vi.fn() }
vi.mock('@/api/knowledgeBase', () => api)

const Dialog = (await import('@/components/admin/KnowledgeSearchDialog.vue')).default

let mounted
let props
afterEach(() => {
  mounted?.unmount()
  mounted = null
  // el-select 下拉经 teleport 挂到 body，卸载后清掉残留
  document.querySelectorAll('.el-popper').forEach((n) => n.remove())
  vi.clearAllMocks()
})

const KB = () => ({
  id: 'kb_1',
  name: '产品知识库',
  sources: [
    { id: 's_mcp', name: '法规库', sourceType: 'MCP', status: 'ENABLED' },
    { id: 's_up', name: '产品资料', sourceType: 'UPLOAD', status: 'ENABLED' },
    { id: 's_api', name: '国标检索', sourceType: 'API', status: 'ENABLED' },
    { id: 's_old', name: '旧接口', sourceType: 'API', status: 'DISABLED' }
  ]
})

const dlg = () => mounted.container.querySelector('.kb-search-dialog')
const btn = (label) => [...dlg().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === label)
const field = (label) => [...dlg().querySelectorAll('.ks-field')].find((f) => f.querySelector('.ks-label')?.textContent.trim() === label)
/** 取某个 el-select 的组件实例上挂的全部选项（下拉 teleport 到 body，按实例取不依赖弹层是否展开） */
const selectOptions = (label) => {
  const sel = field(label).querySelector('.el-select')
  const id = sel.querySelector('input')?.getAttribute('aria-controls')
  const list = id ? document.getElementById(id) : null
  return [...(list || document).querySelectorAll('.el-select-dropdown__item')].map((li) => ({
    label: li.textContent.trim(),
    disabled: li.classList.contains('is-disabled')
  }))
}
const selectModel = (label) => field(label).querySelector('.el-select').__vueParentComponent.props.modelValue
const setSelect = (label, v) => field(label).querySelector('.el-select').__vueParentComponent.emit('update:modelValue', v)
const queryInput = () => field('检索问题').querySelector('input')
function typeInto(el, v) {
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mountDialog(kb = KB()) {
  props = reactive({ visible: false, kb, 'onUpdate:visible': vi.fn() })
  mounted = mountReal(Dialog, props)
  await flushAll(4)
  props.visible = true
  await flushAll(10)
}
async function run() {
  btn('开始测试').click()
  await flushAll(10)
}

describe('KnowledgeSearchDialog · 默认态与表单字段（md §三.7）', () => {
  it('标题「检索测试 · 知识库名」，检索问题带默认示例值，Top K 选项 3/5/10/20 升序默认 5', async () => {
    await mountDialog()

    expect(dlg().querySelector('.ks-title').textContent.trim()).toBe('检索测试 · 产品知识库')
    expect(queryInput().value).toBe('公司的标准解决方案包括哪些内容？')
    expect(selectModel('Top K')).toBe(5)
    expect(selectOptions('Top K').map((o) => o.label)).toEqual(['3', '5', '10', '20'])
    expect(btn('开始测试').disabled).toBe(false)
    expect(btn('关闭')).toBeTruthy()
  })

  it('数据源范围三组选项：「全部已启用数据源」(默认) → 已启用源按 上传 / API / MCP 排序 → 已停用源置灰并标「（已停用）」', async () => {
    await mountDialog()

    expect(selectModel('数据源范围')).toBe('')
    expect(selectOptions('数据源范围')).toEqual([
      { label: '全部已启用数据源', disabled: false },
      { label: '上传 · 产品资料', disabled: false },
      { label: 'API · 国标检索', disabled: false },
      { label: 'MCP · 法规库', disabled: false },
      { label: 'API · 旧接口（已停用）', disabled: true }
    ])
  })

  it('知识库没有已启用数据源：提示「该知识库没有可用数据源，请先配置并启用数据源」，不出表单与【开始测试】', async () => {
    await mountDialog({ id: 'kb_2', name: '空库', sources: [{ id: 's1', name: '停了', sourceType: 'UPLOAD', status: 'DISABLED' }] })

    expect(dlg().textContent).toContain('该知识库没有可用数据源，请先配置并启用数据源')
    expect(dlg().querySelector('.ks-form')).toBeNull()
    expect(btn('开始测试')).toBeUndefined()
  })

  it('kb 为空（未传）：标题仅「检索测试 · 」且按无可用数据源处理', async () => {
    await mountDialog(null)
    expect(dlg().querySelector('.ks-title').textContent.trim()).toBe('检索测试 ·')
    expect(dlg().textContent).toContain('请先配置并启用数据源')
  })

  it('清空检索问题（含全空白）：【开始测试】置灰不可点，回车也不发请求', async () => {
    await mountDialog()
    typeInto(queryInput(), '   ')
    await flushAll(4)

    expect(btn('开始测试').disabled).toBe(true)
    queryInput().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(6)
    expect(api.searchKnowledgeBase).not.toHaveBeenCalled()
  })

  it('前提：问题为空时【开始测试】置灰（md §三.7）', async () => {
    await mountDialog()
    typeInto(queryInput(), '')
    await flushAll(4)
    expect(btn('开始测试').disabled).toBe(true)
  })

  it('yuepu#62⑤ 未输入问题时不再另设空状态页（md §三.7「未输入问题时【开始测试】置灰不可点（按钮禁用本身即为引导，不再另设空状态页）」）', async () => {
    await mountDialog()
    typeInto(queryInput(), '')
    await flushAll(4)
    expect(dlg().querySelector('.ks-body').textContent).not.toContain('输入问题后点击')
  })

  it('点【关闭】：抛 update:visible=false', async () => {
    await mountDialog()
    btn('关闭').click()
    await flushAll(4)
    expect(props['onUpdate:visible']).toHaveBeenCalledWith(false)
  })
})

describe('KnowledgeSearchDialog · 检索请求与结果（md §三.7）', () => {
  const longText = '命中内容'.repeat(40) // 160 字 > 收起阈值

  it('默认参数下发：trim 后的问题、Top K 5、不限定数据源（sourceId undefined）', async () => {
    api.searchKnowledgeBase.mockResolvedValue({ items: [], errors: [], elapsedMs: 10 })
    await mountDialog()
    typeInto(queryInput(), '  报价流程  ')
    await flushAll(4)

    await run()

    expect(api.searchKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(api.searchKnowledgeBase).toHaveBeenCalledWith('kb_1', { query: '报价流程', topK: 5, sourceId: undefined })
  })

  it('改选 Top K 10 与单个已启用数据源：请求带 topK 10 与该源 id（仅检索该数据源）；回车同样触发', async () => {
    api.searchKnowledgeBase.mockResolvedValue({ items: [], errors: [], elapsedMs: 10 })
    await mountDialog()
    setSelect('Top K', 10)
    setSelect('数据源范围', 's_api')
    await flushAll(4)

    queryInput().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(10)

    expect(api.searchKnowledgeBase).toHaveBeenCalledWith('kb_1', { query: '公司的标准解决方案包括哪些内容？', topK: 10, sourceId: 's_api' })
  })

  it('检索进行中：展示加载骨架、【开始测试】loading，重复点击不重复发请求；返回后骨架消失', async () => {
    let resolve
    api.searchKnowledgeBase.mockReturnValue(new Promise((r) => (resolve = r)))
    await mountDialog()

    btn('开始测试').click()
    await flushAll(4)
    expect(dlg().querySelector('.el-skeleton')).toBeTruthy()
    expect(btn('开始测试').classList.contains('is-loading')).toBe(true)
    queryInput().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(4)
    expect(api.searchKnowledgeBase).toHaveBeenCalledTimes(1)

    resolve({ items: [], errors: [], elapsedMs: 5 })
    await flushAll(10)
    expect(dlg().querySelector('.el-skeleton')).toBeNull()
    expect(btn('开始测试').classList.contains('is-loading')).toBe(false)
  })

  it('有结果：统计条「召回 N 条 · 耗时 X ms · 各类型召回数」，卡片展示排名+来源文档、两位小数相关度、类型标签、「数据源名 · 第 N 页」', async () => {
    api.searchKnowledgeBase.mockResolvedValue({
      elapsedMs: 286,
      errors: [],
      items: [
        { rank: 1, score: 0.9234, sourceType: 'UPLOAD', source: '解决方案白皮书.pdf', sourceName: '产品资料', page: 18, content: '标准方案包含实施与培训。' },
        { rank: 2, score: 0.8, sourceType: 'API', source: '', sourceName: '国标检索', content: '第二条' },
        { rank: 3, score: 0.71, sourceType: 'UPLOAD', source: '案例集.docx', sourceName: '', page: 2, content: '第三条' }
      ]
    })
    await mountDialog()

    await run()

    const stats = [...dlg().querySelectorAll('.ks-stats span')].map((s) => s.textContent.trim())
    expect(stats).toEqual(['召回 3 条', '耗时 286 ms', '上传 2 条 · API 1 条'])
    const cards = [...dlg().querySelectorAll('.ks-card:not(.err)')]
    expect(cards).toHaveLength(3)
    expect(cards[0].querySelector('.ks-rank').textContent.trim()).toBe('#1 解决方案白皮书.pdf')
    expect(cards[0].querySelector('.ks-score').textContent.trim()).toBe('0.92')
    expect(cards[0].querySelector('.el-tag').textContent.trim()).toBe('上传')
    expect(cards[0].querySelector('.ks-source').textContent.trim()).toBe('产品资料 · 第 18 页')
    expect(cards[0].querySelector('.ks-content').textContent.trim()).toBe('标准方案包含实施与培训。')
    expect(cards[1].querySelector('.ks-rank').textContent.trim()).toBe('#2 未知来源')
    expect(cards[1].querySelector('.ks-score').textContent.trim()).toBe('0.80')
    expect(cards[1].querySelector('.ks-source').textContent.trim()).toBe('国标检索')
    expect(cards[2].querySelector('.ks-source').textContent.trim()).toBe('第 2 页')
    expect(dlg().textContent).not.toContain('没有检索到相关内容')
  })

  it('长内容默认收起，点「展开查看」展开、再点「收起」；短内容无展开按钮', async () => {
    api.searchKnowledgeBase.mockResolvedValue({
      elapsedMs: 1,
      errors: [],
      items: [
        { rank: 1, score: 0.9, sourceType: 'UPLOAD', source: 'a', content: longText },
        { rank: 2, score: 0.5, sourceType: 'UPLOAD', source: 'b', content: '短' }
      ]
    })
    await mountDialog()
    await run()
    const [longCard, shortCard] = dlg().querySelectorAll('.ks-card')

    expect(longCard.querySelector('.ks-content').classList.contains('clamp')).toBe(true)
    expect(longCard.querySelector('.ks-toggle').textContent.trim()).toBe('展开查看')
    expect(shortCard.querySelector('.ks-toggle')).toBeNull()

    longCard.querySelector('.ks-toggle').click()
    await flushAll(4)
    expect(longCard.querySelector('.ks-content').classList.contains('clamp')).toBe(false)
    expect(longCard.querySelector('.ks-toggle').textContent.trim()).toBe('收起')

    longCard.querySelector('.ks-toggle').click()
    await flushAll(4)
    expect(longCard.querySelector('.ks-content').classList.contains('clamp')).toBe(true)
  })

  it('某一数据源失败：展示该来源错误「… · 不影响其它数据源结果」，其余结果照常展示', async () => {
    api.searchKnowledgeBase.mockResolvedValue({
      elapsedMs: 90,
      items: [{ rank: 1, score: 0.66, sourceType: 'UPLOAD', source: '白皮书', content: '正常结果' }],
      errors: [{ sourceType: 'MCP', message: '法规库 检索失败：TIMEOUT（8000 ms）' }]
    })
    await mountDialog()

    await run()

    expect(dlg().querySelectorAll('.ks-card:not(.err)')).toHaveLength(1)
    const err = dlg().querySelector('.ks-card.err')
    expect(err.querySelector('.ks-rank').textContent.trim()).toBe('MCP')
    expect(err.textContent).toContain('法规库 检索失败：TIMEOUT（8000 ms） · 不影响其它数据源结果')
    expect(dlg().querySelector('.ks-stats').textContent).toContain('召回 1 条')
  })

  it('全部数据源失败（无结果）：只展示错误，不追加「不影响其它数据源结果」，也不出「没有检索到」空态', async () => {
    api.searchKnowledgeBase.mockResolvedValue({ elapsedMs: 3, items: [], errors: [{ sourceType: 'API', message: '国标检索 检索失败：HTTP 502' }] })
    await mountDialog()

    await run()

    const err = dlg().querySelector('.ks-card.err')
    expect(err.textContent).toContain('国标检索 检索失败：HTTP 502')
    expect(err.textContent).not.toContain('不影响其它数据源结果')
    expect(dlg().textContent).not.toContain('没有检索到相关内容')
  })

  it('检索接口整体失败（抛错）：展示错误卡「错误 · <原因>」，召回 0 条，按钮恢复可点', async () => {
    api.searchKnowledgeBase.mockRejectedValue(new Error('服务不可用'))
    await mountDialog()

    await run()

    const err = dlg().querySelector('.ks-card.err')
    expect(err.querySelector('.ks-rank').textContent.trim()).toBe('错误')
    expect(err.textContent).toContain('服务不可用')
    expect(dlg().querySelector('.ks-stats').textContent).toContain('召回 0 条')
    expect(btn('开始测试').classList.contains('is-loading')).toBe(false)
  })

  it('接口抛错且无原因：兜底「检索失败」', async () => {
    api.searchKnowledgeBase.mockRejectedValue({})
    await mountDialog()
    await run()
    expect(dlg().querySelector('.ks-card.err').textContent).toContain('检索失败')
  })

  it('无结果也无错误：提示「没有检索到相关内容，试试换个问法」，统计「召回 0 条 / 耗时 0 ms」（返回缺字段按 0 兜底）', async () => {
    api.searchKnowledgeBase.mockResolvedValue(null)
    await mountDialog()

    await run()

    expect(dlg().textContent).toContain('没有检索到相关内容，试试换个问法')
    expect([...dlg().querySelectorAll('.ks-stats span')].map((s) => s.textContent.trim())).toEqual(['召回 0 条', '耗时 0 ms'])
  })

  it('关闭后重新打开：问题 / Top K / 数据源范围 / 结果全部复位为默认', async () => {
    api.searchKnowledgeBase.mockResolvedValue({ elapsedMs: 1, errors: [], items: [{ rank: 1, score: 1, sourceType: 'API', source: 'x', content: 'y' }] })
    await mountDialog()
    typeInto(queryInput(), '别的问题')
    setSelect('Top K', 20)
    setSelect('数据源范围', 's_up')
    await flushAll(4)
    await run()
    expect(dlg().querySelectorAll('.ks-card')).toHaveLength(1) // 前提：已有结果

    props.visible = false
    await flushAll(6)
    props.visible = true
    await flushAll(10)

    expect(queryInput().value).toBe('公司的标准解决方案包括哪些内容？')
    expect(selectModel('Top K')).toBe(5)
    expect(selectModel('数据源范围')).toBe('')
    expect(dlg().querySelectorAll('.ks-card')).toHaveLength(0)
    expect(dlg().querySelector('.ks-stats')).toBeNull()
  })
})
