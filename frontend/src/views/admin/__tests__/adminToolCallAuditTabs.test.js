// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * 工具调用审计 · 三页签（2026-09-28 加「岗位自动化任务」「知识库检索」页签，
 * 对齐 docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md §一 / §八 / §九）。
 *
 * 真实挂载整页，断言五件事：页签结构与懒挂载、页签间筛选互不影响、
 * 岗位自动化任务页签（无人值守口径）、知识库检索页签（命中口径）、两页签各自的详情与导出。
 * 「会话调用」页签自身行为由 adminToolCallAudit.test.js 覆盖，这里不重复。
 *
 * 2026-10-09 记录单元改版（与研发梅竹讨论后）：「岗位自动化任务」一节整段重写——记录单元
 * 从「一次工具调用」改为「一次任务运行」，且全部操作免授权、不经确认，原「写操作预授权」
 * （已预授权 / 未授权）整套断言随之移除；「任务运行编号」字段废弃，记录本身已是运行级。
 * 「知识库检索」一节不受本次改版影响，原样保留。
 *
 * 种子日期相对「今天」生成（toolCallAuditMock.js 用 dateDaysAgo，J27），默认「近 90 天」窗口永远框得住，不再固定系统时间。
 * 「文案逐字对 md」一节借请求编号（C-/T-/K-）搜索定位目标行——靠搜索框的编号匹配，随产品裁决
 * （搜索框是否收口为不搜编号）调整定位方式。
 */
const MOCK = await import('@/api/toolCallAuditMock')
const AdminToolCallAudit = (await import('@/views/admin/AdminToolCallAudit.vue')).default

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let app, container, errorSpy, createObjectURL
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  createObjectURL = vi.fn(() => 'blob:mock/1')
  globalThis.URL.createObjectURL = createObjectURL
  globalThis.URL.revokeObjectURL = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  errorSpy.mockRestore()
  delete globalThis.URL.createObjectURL
  delete globalThis.URL.revokeObjectURL
})

function mountReal() {
  app = createApp(AdminToolCallAudit).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

const pane = (name) => container.querySelector(`#pane-${name}`)
async function openTab(name) {
  container.querySelector(`#tab-${name}`).click()
  await flush()
}
const cards = (p) => [...p.querySelectorAll('.metric-card')]
const cardOf = (p, label) => cards(p).find((c) => c.textContent.includes(label))
const bodyRows = (p) => [...p.querySelectorAll('.el-table__body .el-table__row')]
const buttonOf = (p, text) => [...p.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

describe('页签结构（PRD §一）', () => {
  it('三个页签，默认进入「会话调用」；另两个页签首次点开才挂载', async () => {
    mountReal()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const labels = [...container.querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['会话调用', '岗位自动化任务', '知识库检索'])
    expect(container.querySelector('.el-tabs__item.is-active').textContent.trim()).toBe('会话调用')

    expect(pane('skill').textContent).toContain('涉及写操作的会话')
    // lazy：没点开之前，任务 / 知识库页签的内容根本不在 DOM 里
    expect(pane('task')).toBeNull()
    expect(pane('knowledge')).toBeNull()

    await openTab('task')
    expect(pane('task').querySelector('.metric-card')).toBeTruthy()
    expect(pane('knowledge')).toBeNull()
  })

  it('各页签查询条件互不影响：会话调用筛到「失败的会话」，切走再切回仍保持', async () => {
    mountReal()
    await flush()
    cardOf(pane('skill'), '失败的会话').click()
    await flush()
    const failedOnly = bodyRows(pane('skill'))
    expect(failedOnly.length).toBeGreaterThan(0)
    failedOnly.forEach((r) => expect(r.textContent).toContain('失败'))

    await openTab('task')
    // 任务页签自己的筛选是空的，不受会话调用页签影响：列表里仍有成功的记录
    expect(bodyRows(pane('task')).some((r) => r.textContent.includes('成功'))).toBe(true)
    await openTab('skill')
    bodyRows(pane('skill')).forEach((r) => expect(r.textContent).toContain('失败'))
  })
})

describe('岗位自动化任务页签（PRD §八）', () => {
  it('无人值守 + 免授权口径：卡片没有「进行中」，是成功 / 失败两态；列表展示任务、触发方式、涉及写操作，没有授权相关字段', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const text = p.textContent

    expect(cards(p).map((c) => c.querySelector('.metric-label').textContent)).toEqual([
      '运行总数', '涉及写操作的运行', '执行失败'
    ])
    expect(text).not.toContain('进行中')
    expect(text).not.toContain('已预授权')
    expect(text).not.toContain('未授权')
    expect(text).not.toContain('预授权')
    expect(text).toContain('每日经营晨报')
    expect(text).toContain('定时·每天 08:30')
    expect(text).toContain('涉及写操作')
    // 单次工具调用不记录耗时与具体执行时刻，列表不展示"执行耗时"
    expect(text).not.toContain('执行耗时')
    expect(p.querySelector('input[placeholder="搜索用户 / 岗位 / 任务 / 工具"]')).toBeTruthy()
    // 2026-10-09 第四轮改版：筛选项占位文案与另两页签统一
    expect(text).toContain('全部执行结果')
    expect(p.querySelectorAll('.lt-filter').length).toBe(2)
  })

  it('点「涉及写操作的运行」卡片 → 只剩涉及写操作的运行记录', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '涉及写操作的运行').click()
    await flush()
    const rows = bodyRows(p)
    const writes = MOCK.taskCallRecords.filter((r) => r.hasWrite)
    expect(rows.length).toBe(writes.length)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('点「执行失败」卡片 → 只剩失败的运行记录，原「执行前拦截」的运行（不在工具白名单）也并在其中，原因展示具体工具 + 原因（不是"未授权"）', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '执行失败').click()
    await flush()
    const rows = bodyRows(p)
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r) => {
      expect(r.textContent).toContain('失败')
      expect(r.textContent).not.toContain('未授权')
    })
    expect(rows.some((r) => r.textContent.includes('不在工具白名单'))).toBe(true)
  })

  it('详情：免授权的写操作直接展示执行结果，没有授权相关字段；原「执行前拦截」的运行（不在工具白名单）在该工具调用项上展示失败原因', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '执行失败').click()
    await flush()
    const row = bodyRows(p).find((r) => r.textContent.includes('不在工具白名单'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()

    const drawer = document.body.querySelector('.el-drawer__body')
    expect(drawer).toBeTruthy()
    const t = drawer.textContent
    expect(t).toContain('工具调用明细')
    expect(t).toContain('不在工具白名单')
    expect(t).not.toContain('执行前拦截')
    expect(t).not.toContain('授权')
    expect(t).not.toContain('任务运行编号')
  })

  it('涉及写操作且成功的运行（拜访前资料准备）：详情展示写操作但不展示任何确认 / 授权标签', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '涉及写操作的运行').click()
    await flush()
    const row = bodyRows(p).find((r) => r.textContent.includes('拜访前资料准备') && r.textContent.includes('成功'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()
    const drawer = document.body.querySelector('.el-drawer__body')
    const t = drawer.textContent
    expect(t).toContain('写')
    expect(t).not.toContain('已确认')
    expect(t).not.toContain('待确认')
    expect(t).not.toContain('已预授权')
    // 写操作即使成功也展示参数 / 响应入口（2026-10-09 收窄范围只排除"成功的只读调用"）
    expect(drawer.querySelector('.call-item-toggle')).toBeTruthy()
  })

  it('成功的只读运行（每周竞品动态汇总）：详情里不展示参数 / 响应入口', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const row = bodyRows(p).find((r) => r.textContent.includes('每周竞品动态汇总') && r.textContent.includes('成功'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()
    const drawer = document.body.querySelector('.el-drawer__body')
    expect(drawer.querySelector('.call-item-toggle')).toBeNull()
    expect(drawer.textContent).toContain('只读调用成功，不保留请求参数与响应内容')
  })
})

describe('知识库检索页签（PRD §九）', () => {
  it('卡片 / 列表口径：检索词、命中条数、无命中单列统计；无操作性质与确认列', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const text = p.textContent

    expect(cards(p).map((c) => c.querySelector('.metric-label').textContent)).toEqual([
      '检索请求总数', '无命中检索', '执行失败'
    ])
    expect(text).toContain('知识库 / 数据源')
    expect(text).toContain('检索词')
    expect(text).toContain('命中条数')
    expect(text).toContain('MCP·法规库检索')
    expect(text).toContain('API·情报平台接口')
    expect(text).not.toContain('操作性质')
    expect(text).not.toContain('用户确认')
    expect(text).not.toContain('当前待确认')
    // 2026-10-09 第四轮改版：筛选项收到跟另两页签一致的两项——执行结果 + 本页专属的数据源类型，
    // 去掉独立的「命中情况」下拉（无命中改为只能靠统计卡片筛选）
    expect(text).toContain('全部执行结果')
    expect(text).toContain('全部数据源类型')
    expect(text).not.toContain('全部命中情况')
    expect(p.querySelectorAll('.lt-filter').length).toBe(2)
  })

  it('点「无命中检索」卡片 → 只剩检索成功且命中 0 条的记录', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const noHit = MOCK.knowledgeCallRecords.filter((r) => r.result === 'SUCCESS' && r.hitCount === 0)
    expect(noHit.length).toBeGreaterThan(0)
    expect(cardOf(p, '无命中检索').querySelector('.metric-value').textContent).toBe(String(noHit.length))

    cardOf(p, '无命中检索').click()
    await flush()
    const rows = bodyRows(p)
    expect(rows.length).toBe(noHit.length)
    rows.forEach((r) => {
      expect(r.textContent).toContain('成功')
      expect(r.textContent).toContain(noHit[0].query.slice(0, 4))
    })
  })

  it('搜索框按检索词过滤；命中失败的检索时展示失败原因（结果文案与另两页签统一为"失败"）', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const input = p.querySelector('input[placeholder="搜索用户 / 岗位 / 知识库 / 检索词"]')
    input.value = '差旅报销'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    const rows = bodyRows(p)
    expect(rows.length).toBe(2)
    rows.forEach((r) => {
      expect(r.textContent).toContain('失败')
      expect(r.textContent).not.toContain('执行失败')
      expect(r.textContent).toContain('连接超时（8000 ms）')
    })
  })

  it('详情：展示检索词 / topK 请求参数；响应页签列出命中内容来源', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const row = bodyRows(p).find((r) => r.textContent.includes('智能排产系统的合规认证要求'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()

    const drawer = document.body.querySelector('.el-drawer__body')
    let t = drawer.textContent
    expect(t).toContain('发起检索')
    expect(t).toContain('search_documents')
    expect(t).toContain('topK')
    expect(t).toContain('脱敏口径【待补充】')

    ;[...drawer.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '实际响应结果').click()
    await flush()
    t = drawer.textContent
    expect(t).toContain('共命中 5 条，展示前 3 条')
    expect(t).toContain('标题')
    expect(t).toContain('来源名称')
    expect(t).toContain('法规库检索')
  })
})

describe('文案与颜色逐字对 md（#92 ②⑦⑧⑨④）', () => {
  const openDetail = async (p, text) => {
    // 先按关键词（请求编号 / 检索词）搜出唯一一行，免得目标行被分页挤到第二页
    const input = p.querySelector('input.el-input__inner')
    input.value = text
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    const row = bodyRows(p)[0]
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()
    return document.body.querySelector('.el-drawer__body')
  }

  it('自动化任务：是 = 绿色（§8.6 同 §六）；【统计口径】逐字（§8.2）', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const writeRow = bodyRows(p).find((r) => r.textContent.includes('拜访前资料准备') && r.textContent.includes('成功'))
    const yes = [...writeRow.querySelectorAll('.status-tag')].find((t) => t.textContent.trim() === '是')
    expect(yes.className).toContain('st--success')
    buttonOf(p, '统计口径').click()
    await flush()
    expect(p.textContent).toContain('任务无人值守，不存在进行中、用户取消和待确认；全部操作免授权，不区分读写处理')
  })

  it('自动化任务详情：操作摘要字段名为「任务」、失败说明为「对照工具调用明细，核对出问题的具体连接器状态或权限」（§8.5）', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const drawer = await openDetail(pane('task'), 'T-2002')
    const t = drawer.textContent
    expect(t).not.toContain('自动化任务')
    // 「自动化任务」含子串「任务」，不能用 toContain 判断：逐个 label 要求文本恰好等于「任务」
    const labels = [...drawer.querySelectorAll('.el-descriptions__label')].map((l) => l.textContent.trim())
    expect(labels).toContain('任务')
    expect(t).toContain('建议对照工具调用明细，核对出问题的具体连接器状态或权限')
  })

  it('零工具调用的任务运行（T-2012）：列表行结果「成功」、涉及写操作「否」；详情展示空态「本次运行未调用外部工具」（§8.5）', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const drawer = await openDetail(p, 'T-2012')
    // 抽屉已打开，列表行仍在背后：取列表行的标签
    const tags = [...bodyRows(p)[0].querySelectorAll('.status-tag')].map((t) => t.textContent.trim())
    expect(tags).toContain('成功')
    expect(tags).toContain('否')
    expect(tags).not.toContain('失败')
    expect(drawer.textContent).toContain('本次运行未调用外部工具')
    expect(drawer.querySelectorAll('.call-item').length).toBe(0)
  })

  it('任务先失败后重试成功（T-2011）：列表行结果「成功」且不展示失败原因，失败细节只在详情里（§一「记录单元」）', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const drawer = await openDetail(p, 'T-2011')
    const row = bodyRows(p)[0]
    expect(row.textContent).toContain('成功')
    expect(row.textContent).not.toContain('失败')
    expect(row.textContent).not.toContain('连接超时')
    const items = [...drawer.querySelectorAll('.call-item')]
    expect(items.length).toBe(2)
    expect(items[0].textContent).toContain('连接超时')
  })

  it('知识库详情：失败但请求已发出（耗时有值，K-3006）拼「检索耗时 X / 原因」（§9.5）', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const drawer = await openDetail(pane('knowledge'), 'K-3006')
    expect(drawer.textContent).toContain('检索耗时 8 秒 / 连接超时（8000 ms）')
  })

  it('知识库详情：第二步标题为「执行结果」；未发出请求（无访问权限）只展示原因，不拼「检索耗时 未执行」（§9.5）', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const drawer = await openDetail(pane('knowledge'), 'K-3004')
    const t = drawer.textContent
    expect(t).toContain('执行结果')
    expect(t).toContain('无该知识库访问权限')
    expect(t).not.toContain('检索耗时 未执行')
  })
})

describe('导出 CSV（PRD §三）', () => {
  it('两个新页签各自导出当前筛选结果', async () => {
    mountReal()
    await flush()
    for (const name of ['task', 'knowledge']) {
      await openTab(name)
      createObjectURL.mockClear()
      buttonOf(pane(name), '导出 CSV').click()
      await flush()
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    }
  })
})

/** 列表分页处的「共 N 条数据」 */
const listTotal = (p) => Number(/共\s*(\d+)/.exec(p.querySelector('.list-pager-info')?.textContent || '')?.[1])

describe('知识库列表：无命中的成功记录带「无命中」小标签（PRD §9.3，yuepu#92⑭）', () => {
  it('成功但命中 0 条的行有小标签，失败的行没有', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    cardOf(p, '无命中检索').click()
    await flush()
    const rows = [...p.querySelectorAll('.el-table__body tr')]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.textContent).toContain('无命中')
    cardOf(p, '检索请求总数').click()
    await flush()
    const all = [...p.querySelectorAll('.el-table__body tr')]
    const tagged = all.filter((r) => r.textContent.includes('无命中'))
    expect(tagged.length).toBeGreaterThan(0)
    expect(tagged.length).toBeLessThan(all.length)
  })
})

describe('统计卡片范围（PRD §二 / §8.2 / §9.2：时间范围 + 搜索词，不随执行结果 / 写操作 / 数据源类型筛选变化；yuepu#92⑯）', () => {
  it('会话调用：点「失败的会话」→ 列表只剩失败的，但「会话总数」「涉及写操作的会话」两张卡的数字不变', async () => {
    mountReal()
    await flush()
    const p = pane('skill')
    const num = (label) => Number(cardOf(p, label).querySelector('.metric-value').textContent)
    const [all, write] = [num('会话总数'), num('涉及写操作的会话')]
    cardOf(p, '失败的会话').click()
    await flush()
    expect(listTotal(p)).toBe(num('失败的会话'))
    expect(listTotal(p)).toBeLessThan(all)
    expect(num('会话总数')).toBe(all)
    expect(num('涉及写操作的会话')).toBe(write)
  })

  it('知识库检索：点「无命中检索」→ 列表只剩无命中的，「检索请求总数」卡的数字不变', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const all = Number(cardOf(p, '检索请求总数').querySelector('.metric-value').textContent)
    cardOf(p, '无命中检索').click()
    await flush()
    expect(listTotal(p)).toBeLessThan(all)
    expect(Number(cardOf(p, '检索请求总数').querySelector('.metric-value').textContent)).toBe(all)
  })

  it('卡片数字随搜索词变化（范围含搜索词）', async () => {
    mountReal()
    await flush()
    const p = pane('skill')
    const input = () => p.querySelector('input[placeholder="搜索用户 / 岗位 / 技能 / 工具"]')
    const all = Number(cardOf(p, '会话总数').querySelector('.metric-value').textContent)
    input().value = '张'
    input().dispatchEvent(new Event('input'))
    input().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    expect(Number(cardOf(p, '会话总数').querySelector('.metric-value').textContent)).toBeLessThan(all)
  })
})

describe('总数卡片点击（PRD 各页签统计卡片表：仅保留时间范围；按 J23）', () => {
  const TABS = [
    { name: 'skill', total: '会话总数', failed: '失败的会话', ph: '搜索用户 / 岗位 / 技能 / 工具' },
    { name: 'task', total: '运行总数', failed: '执行失败', ph: '搜索用户 / 岗位 / 任务 / 工具' },
    { name: 'knowledge', total: '检索请求总数', failed: '执行失败', ph: '搜索用户 / 岗位 / 知识库 / 检索词' }
  ]
  for (const { name, total, failed, ph } of TABS) {
    it(`${name} 页签：搜索后点「${total}」→ 搜索框清空、列表恢复全量；点「${failed}」则保留搜索词`, async () => {
      mountReal()
      await flush()
      if (name !== 'skill') await openTab(name)
      const p = pane(name)
      const input = () => p.querySelector(`input[placeholder="${ph}"]`)
      const fullCount = Number(cardOf(p, total).querySelector('.metric-value').textContent)

      input().value = '张'
      input().dispatchEvent(new Event('input'))
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
      await flush()
      // 统计卡片随筛选联动：搜索后总数小于全量，证明搜索词确实生效
      expect(Number(cardOf(p, total).querySelector('.metric-value').textContent)).toBeLessThan(fullCount)

      cardOf(p, failed).click()
      await flush()
      expect(input().value).toBe('张')

      cardOf(p, total).click()
      await flush()
      expect(input().value).toBe('')
      expect(Number(cardOf(p, total).querySelector('.metric-value').textContent)).toBe(fullCount)
    })
  }

  // 知识检索页签另有两类筛选态：先选「数据源类型」下拉 / 先点「无命中检索」卡，再点总数卡——也要全部清回全量（总数卡 = 仅保留时间范围）
  it('knowledge 页签：先选数据源类型再点「检索请求总数」→ 下拉回到「全部数据源类型」、列表恢复全量', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const fullCount = Number(cardOf(p, '检索请求总数').querySelector('.metric-value').textContent)
    const typeSelect = () => p.querySelectorAll('.lt-filter')[1]

    typeSelect().querySelector('.el-select__wrapper').click()
    await flush()
    const mcp = [...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => i.textContent.trim() === 'MCP')
    expect(mcp).toBeTruthy() // 前提：数据源类型下拉里有「MCP」
    mcp.click()
    await flush()
    expect(typeSelect().textContent).toContain('MCP') // 前提：筛选已生效
    // 列表被筛小（证明下拉确实生效）；统计卡不随数据源类型筛选变化（PRD §9.2：卡片范围 = 时间范围 + 搜索词，yuepu#92⑯）
    expect(listTotal(p)).toBeLessThan(fullCount)
    expect(Number(cardOf(p, '检索请求总数').querySelector('.metric-value').textContent)).toBe(fullCount)

    cardOf(p, '检索请求总数').click()
    await flush()
    expect(typeSelect().querySelector('.el-select__placeholder').textContent.trim()).toBe('全部数据源类型')
    expect(typeSelect().textContent).not.toContain('MCP')
    expect(Number(cardOf(p, '检索请求总数').querySelector('.metric-value').textContent)).toBe(fullCount)
  })

  it('knowledge 页签：先点「无命中检索」卡（高亮 + 列表只剩无命中）再点「检索请求总数」→ 高亮取消、列表恢复全量', async () => {
    mountReal()
    await flush()
    await openTab('knowledge')
    const p = pane('knowledge')
    const rowTotal = () => Number(p.querySelector('.list-pager')?.textContent.match(/共s*(d+)s*条/)?.[1] ?? bodyRows(p).length)
    const fullRows = rowTotal()

    cardOf(p, '无命中检索').click()
    await flush()
    expect(cardOf(p, '无命中检索').classList.contains('is-active')).toBe(true)
    expect(rowTotal()).toBe(Number(cardOf(p, '无命中检索').querySelector('.metric-value').textContent))
    expect(rowTotal()).toBeLessThan(fullRows)

    cardOf(p, '检索请求总数').click()
    await flush()
    expect(cardOf(p, '无命中检索').classList.contains('is-active')).toBe(false)
    expect(rowTotal()).toBe(fullRows)
  })
})
