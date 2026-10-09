// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminToolCallAudit.vue 真实挂载冒烟（2026-09-28 PRD 首次落地，对齐
 * docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md）。
 *
 * 参照 adminRolesSmoke.test.js 的真实挂载写法：本页数据源 @/api/toolCallAuditMock 是前端常量数组、
 * 没有网络层，因此不 mock 它，直接读真种子；只替换浏览器侧的 URL.createObjectURL / revokeObjectURL。
 * 断言页头 / 统计卡片 / 列表字段 / 筛选联动 / 详情抽屉 / CSV 导出六块 PRD 行为齐全。
 *
 * 2026-10-08 /test-audit 补缺口（同对齐 prd.工具调用审计.md）：
 * - §二 四张卡片副标题计数与点击效果；【统计口径】默认收起、展开后三句说明；
 * - §三 日期跨度 30 天（同访问审计 §三）、操作性质筛选、查询无结果空态保留条件；
 * - §四 请求时间排序 ↓ / ↑；§六 标签色档；
 * - §5.2 时间线在拦截 / 取消 / 待确认节点停止；§5.3 四类结果说明；§5.4 未执行调用的响应页签文案、参数【待补充】。
 * - 疑似缺陷（it.fails 钉桩）：§二「调用请求总数」点击未清搜索词。
 *   （#64③⑤⑥ 已修转正：§二【统计口径】入口在卡片下方；§三 两个下拉「全部」项文案与【导出 CSV】；§5.2 无需确认的调用不出确认节点。）
 */
const ROWS = (await import('@/api/toolCallAuditMock')).toolCallRecords
const AdminToolCallAudit = (await import('@/views/admin/AdminToolCallAudit.vue')).default

// jsdom 没有 ResizeObserver（el-table 布局用），补一个空实现
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let app, container, errorSpy, createObjectURL, revokeObjectURL
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

// 固定「今天」（2026-10-08 /test-audit 治理组 T10）：种子是 2026-09-20～09-27 的固定日期，页面默认查近 90 天；
// 不固定的话约 2026-12-19 起首条掉出窗口、12-26 起全部掉出，用例到期自动变红。只假 Date，不假定时器。
const FIXED_NOW = new Date('2026-09-28T12:00:00+08:00')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let seq = 0
  createObjectURL = vi.fn(() => `blob:mock/${++seq}`)
  revokeObjectURL = vi.fn()
  globalThis.URL.createObjectURL = createObjectURL
  globalThis.URL.revokeObjectURL = revokeObjectURL
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  errorSpy.mockRestore()
  delete globalThis.URL.createObjectURL
  delete globalThis.URL.revokeObjectURL
  vi.useRealTimers()
})

function mountReal() {
  app = createApp(AdminToolCallAudit).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminToolCallAudit · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头 / 统计卡片 / 列表字段齐全（PRD §一 / §二 / §四）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(text).toContain('工具调用审计')
    expect(text).toContain('追溯每次工具调用的发起人、确认过程与执行结果')

    // 统计卡片：4 张，口径与种子数据吻合（全部 12 条落在默认 90 天窗口内）
    expect(text).toContain('调用请求总数')
    expect(text).toContain('写操作请求')
    expect(text).toContain('执行失败')
    expect(text).toContain('当前待确认')
    const total = ROWS.length
    expect(container.querySelector('.metric-card').textContent).toContain(String(total))

    // 列表：技能/工具、岗位（术语已从原型的「角色」改名，PRD 来源说明）、标签文案
    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(text).toContain('刘敏')
    expect(text).toContain('销售顾问')
    expect(text).toContain('MCP·文档生成服务')

    // 分页条恒显
    expect(container.querySelector('.list-pager')).toBeTruthy()
  })

  it('点击「执行失败」统计卡片 → 列表按执行结果=执行失败联动筛选（PRD §二）', async () => {
    mountReal()
    await flush()
    const failedCard = [...container.querySelectorAll('.metric-card')].find((c) => c.textContent.includes('执行失败'))
    failedCard.click()
    await flush()
    const rows = [...container.querySelectorAll('.el-table__row')]
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => expect(row.textContent).toContain('执行失败'))
  })

  it('搜索框回车按用户/岗位/技能/工具模糊过滤（PRD §三）；命中执行前拦截记录时展示拦截原因', async () => {
    mountReal()
    await flush()
    const input = container.querySelector('input[placeholder="搜索用户 / 岗位 / 技能 / 工具"]')
    expect(input).toBeTruthy()
    input.value = '张浩'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    const rows = [...container.querySelectorAll('.el-table__row')]
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => expect(row.textContent).toContain('张浩'))
    expect(container.textContent).toContain('执行前拦截')
    expect(container.textContent).toContain('不在工具白名单')
  })

  it('点击「查看详情」打开抽屉，展示执行过程时间线与请求参数页签（PRD §五）', async () => {
    mountReal()
    await flush()
    const detailBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情')
    detailBtn.click()
    await flush()
    const drawerText = container.querySelector('.el-drawer__body')?.textContent || container.textContent
    expect(drawerText).toContain('操作摘要')
    expect(drawerText).toContain('执行过程')
    expect(drawerText).toContain('实际请求参数')
  })

  it('导出 CSV 只导当前筛选结果：先点「执行失败」卡片再导出 → 提示「已导出 N 条筛选结果」，文件数据行正好 N 条（PRD §三）', async () => {
    mountReal()
    await flush()
    // N = 种子里落在默认 90 天窗口内的执行失败条数（C-1010、C-1001）
    const failedIds = ROWS.filter((r) => r.result === 'FAILED').map((r) => r.id)
    const N = failedIds.length
    expect(N).toBe(2)
    const failedCard = [...container.querySelectorAll('.metric-card')].find((c) => c.textContent.includes('执行失败'))
    failedCard.click()
    await flush()
    const exportBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '导出 CSV')
    expect(exportBtn).toBeTruthy()
    exportBtn.click()
    await flush()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain(`已导出 ${N} 条筛选结果`)
    // 解析导出的 Blob：去 BOM 后首行为表头，其余为数据行，且每行都是执行失败记录
    const csv = (await createObjectURL.mock.calls[0][0].text()).replace(/^\uFEFF/, '')
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('"请求编号"')
    const dataLines = lines.slice(1)
    expect(dataLines).toHaveLength(N)
    expect(dataLines.map((l) => l.split(',')[0].replace(/"/g, ''))).toEqual(failedIds)
    dataLines.forEach((l) => expect(l).toContain('"执行失败"'))
  })
})

/* ======================================================================================
 * 2026-10-08 /test-audit 补缺口
 * ====================================================================================== */
const cards = () => [...container.querySelectorAll('.metric-card')]
const cardOf = (label) => cards().find((c) => c.querySelector('.metric-label').textContent.trim() === label)
const tableRows = () => [...container.querySelectorAll('.el-table__body-wrapper .el-table__row')]
const pagerTotal = () => container.querySelector('.list-pager-info')?.textContent.trim()
const searchInput = () => container.querySelector('input[placeholder="搜索用户 / 岗位 / 技能 / 工具"]')
async function search(text) {
  const input = searchInput()
  input.value = text
  input.dispatchEvent(new Event('input'))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  await flush()
}
/** 打开第 idx 个下拉（0 = 执行结果，1 = 操作性质）并点选某项。 */
async function pick(idx, label) {
  container.querySelectorAll('.lt-filter')[idx].querySelector('.el-select__wrapper').click()
  await flush()
  const item = [...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => i.textContent.trim() === label)
  item.click()
  await flush()
}
/** 打开某条记录的详情抽屉：先按技能名搜索（列表按窗口高度分页，目标行未必在第 1 页），再按行内文字定位。 */
async function openDetail(skill, ...texts) {
  await search(skill)
  const row = tableRows().find((tr) => [skill, ...texts].every((t) => tr.textContent.includes(t)))
  ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
  await flush()
}
const drawer = () => document.body.querySelector('.el-drawer__body')
const timelineTitles = () => [...drawer().querySelectorAll('.el-timeline-item strong')].map((n) => n.textContent.trim())

describe('统计卡片（§二）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('「调用请求总数」副标题为「成功 6 / 拦截 2 / 取消 1」', () => {
    expect(cardOf('调用请求总数').querySelector('.metric-sub').textContent.trim()).toBe('成功 6 / 拦截 2 / 取消 1')
  })

  it('「写操作请求」数值 6，副标题为「需要确认 4 / 已确认 2」', () => {
    expect(cardOf('写操作请求').querySelector('.metric-value').textContent.trim()).toBe('6')
    expect(cardOf('写操作请求').querySelector('.metric-sub').textContent.trim()).toBe('需要确认 4 / 已确认 2')
  })

  it('「执行失败」2 条、「当前待确认」1 条', () => {
    expect(cardOf('执行失败').querySelector('.metric-value').textContent.trim()).toBe('2')
    expect(cardOf('当前待确认').querySelector('.metric-value').textContent.trim()).toBe('1')
  })

  it('点「写操作请求」→ 列表只剩写操作（共 6 条），卡片高亮', async () => {
    cardOf('写操作请求').click()
    await flush()
    expect(pagerTotal()).toBe('共 6 条数据')
    tableRows().forEach((tr) => expect(tr.querySelectorAll('td')[3].textContent.trim()).toBe('写'))
    expect(cardOf('写操作请求').className).toContain('is-active')
  })

  it('点「当前待确认」→ 列表只剩待确认那 1 条', async () => {
    cardOf('当前待确认').click()
    await flush()
    expect(pagerTotal()).toBe('共 1 条数据')
    expect(tableRows()[0].textContent).toContain('周敏')
    expect(tableRows()[0].textContent).toContain('待确认')
  })

  it('先点「执行失败」再点「调用请求总数」→ 执行结果筛选被清空，回到全部 12 条', async () => {
    cardOf('执行失败').click()
    await flush()
    expect(pagerTotal()).toBe('共 2 条数据')
    cardOf('调用请求总数').click()
    await flush()
    expect(pagerTotal()).toBe('共 12 条数据')
    expect(cards().some((c) => c.className.includes('is-active'))).toBe(false)
  })

  it('点「写操作请求」时已选的执行结果会被清空（§二「操作性质置为写，清空执行结果筛选」）', async () => {
    cardOf('执行失败').click()
    await flush()
    cardOf('写操作请求').click()
    await flush()
    // 写操作 6 条（含成功 / 待确认 / 取消 / 拦截 / 失败），不只剩写且失败的 1 条
    expect(pagerTotal()).toBe('共 6 条数据')
  })

  it('前提：搜「张浩」再点「执行失败」卡 → 两个条件叠加，只剩 1 条', async () => {
    await search('张浩')
    cardOf('执行失败').click()
    await flush()
    expect(pagerTotal()).toBe('共 1 条数据')
  })

  it.fails('搜了关键词后点「调用请求总数」→ 搜索词也被清掉，只保留时间范围（疑似缺陷：chooseMetric 只清执行结果 / 操作性质，搜索词仍生效，列表停在张浩的 3 条；md 工具调用审计 §二「清空执行结果、操作性质筛选，仅保留时间范围」）', async () => {
    await search('张浩')
    cardOf('执行失败').click()
    await flush()
    cardOf('调用请求总数').click()
    await flush()
    expect(pagerTotal()).toBe('共 12 条数据')
  })
})

describe('【统计口径】说明（§二）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })
  const helpBtn = () => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '统计口径')

  it('默认收起，看不到说明', () => {
    expect(container.querySelector('.help-body')).toBeNull()
  })

  it('点【统计口径】→ 展开三句说明；再点 → 收起', async () => {
    helpBtn().click()
    await flush()
    const text = container.querySelector('.help-body').textContent
    expect(text).toContain('调用请求包含成功、执行失败、执行前拦截、用户取消和待确认五类结果；一次任务内的重试按新的调用请求单独记录。')
    expect(text).toContain('执行耗时只统计工具实际执行时间，不含等待用户确认的时间')
    expect(text).toContain('"待确认"反映当前尚未处理的请求，不是历史累计数量。')
    // 说明块紧随【统计口径】入口之后展开（不是飘在页面别处）
    expect(container.querySelector('.help-entry').nextElementSibling).toBe(container.querySelector('.help-body'))
    helpBtn().click()
    await flush()
    expect(container.querySelector('.help-body')).toBeNull()
  })

  // 2026-10-09 合并 origin/main 时由 it.fails 转正：拆页签改造把【统计口径】入口收进
  // AuditMetricGrid.vue，本就放在卡片区下方（md §二），与待办 yuepu#64 的其余 5 项无关，
  // 该待办仍由另一条未合并分支整体关闭。
  it('【统计口径】入口在统计卡片下方', () => {
    const grid = container.querySelector('.metric-grid')
    // 入口按钮在 DOM 顺序上应位于卡片区之后
    expect(grid.compareDocumentPosition(helpBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('查询区（§三）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('操作性质选「读」→ 列表立即只剩读操作（共 6 条）', async () => {
    await pick(1, '读')
    expect(pagerTotal()).toBe('共 6 条数据')
    tableRows().forEach((tr) => expect(tr.querySelectorAll('td')[3].textContent.trim()).toBe('读'))
  })

  it('执行结果下拉的选项为：成功 / 执行失败 / 执行前拦截 / 用户取消 / 待确认', async () => {
    container.querySelectorAll('.lt-filter')[0].querySelector('.el-select__wrapper').click()
    await flush()
    const dd = [...document.body.querySelectorAll('.el-select-dropdown')].find((d) => d.textContent.includes('执行前拦截'))
    const labels = [...dd.querySelectorAll('.el-select-dropdown__item')].map((i) => i.textContent.trim())
    expect(labels).toEqual(['成功', '执行失败', '执行前拦截', '用户取消', '待确认'])
  })

  it('查询无结果 → 展示空态，搜索词与已选筛选仍保留', async () => {
    await pick(1, '写')
    await search('查无此人')
    expect(container.querySelector('.ls-empty-text').textContent.trim()).toBe('暂无符合条件的调用记录')
    expect(searchInput().value).toBe('查无此人')
    expect(container.querySelectorAll('.lt-filter')[1].textContent).toContain('写')
  })

  it('执行结果下拉的「全部」项文案为「全部结果」（md 工具调用审计 §三.2「下拉，全部结果 / 成功 / …」）', () => {
    expect(container.querySelectorAll('.lt-filter')[0].textContent).toContain('全部结果')
  })

  it('操作性质下拉的「全部」项文案为「全部」（md 工具调用审计 §三.3「下拉，全部 / 读 / 写」）', () => {
    expect(container.querySelectorAll('.lt-filter')[1].querySelector('.el-select__placeholder').textContent.trim()).toBe('全部')
  })
})

describe('时间范围跨度最多 30 天（§三.1，同访问审计 §三）', () => {
  const BASE = new Date(2026, 8, 15)
  const dayOf = (offset) => {
    const d = new Date(BASE)
    d.setDate(d.getDate() + offset)
    return d
  }
  function picker() {
    const walk = (vnode) => {
      if (!vnode) return null
      if (vnode.component) {
        if (vnode.component.type?.name === 'ElDatePicker') return vnode.component
        return walk(vnode.component.subTree)
      }
      if (Array.isArray(vnode.children)) {
        for (const c of vnode.children) {
          const hit = walk(c)
          if (hit) return hit
        }
      }
      return null
    }
    return walk(app._instance.subTree)
  }
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('还没点选起始日 → 不置灰任何日期', () => {
    expect(picker().props.disabledDate(dayOf(200))).toBe(false)
  })

  it('点选起始日后 → 前后 30 天内可选，超过 30 天的日期置灰', async () => {
    picker().vnode.props.onCalendarChange([BASE, null])
    await flush()
    const disabled = picker().props.disabledDate
    expect(disabled(dayOf(30))).toBe(false)
    expect(disabled(dayOf(-30))).toBe(false)
    expect(disabled(dayOf(31))).toBe(true)
    expect(disabled(dayOf(-31))).toBe(true)
  })

  it('两端日期都选定后 → 置灰解除', async () => {
    picker().vnode.props.onCalendarChange([BASE, null])
    await flush()
    expect(picker().props.disabledDate(dayOf(60))).toBe(true)
    picker().vnode.props.onCalendarChange([BASE, dayOf(10)])
    await flush()
    expect(picker().props.disabledDate(dayOf(60))).toBe(false)
  })
})

describe('列表（§四 / §六）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })
  const arrow = () => container.querySelector('.tca-sort-arrow').textContent.trim()
  const tagIn = (tr, colIdx) => tr.querySelectorAll('td')[colIdx].querySelector('.status-tag')

  it('默认按请求时间倒序（最新 09-27 15:02:11 在最前），箭头 ↓', () => {
    expect(tableRows()[0].textContent).toContain('15:02:11')
    expect(arrow()).toBe('↓')
  })

  it('点「请求时间」列头 → 正序（最早 09-20 那条在最前），箭头 ↑；再点回到倒序 ↓', async () => {
    container.querySelector('.tca-sort').click()
    await flush()
    expect(tableRows()[0].textContent).toContain('2026-09-20')
    expect(arrow()).toBe('↑')
    container.querySelector('.tca-sort').click()
    await flush()
    expect(tableRows()[0].textContent).toContain('15:02:11')
    expect(arrow()).toBe('↓')
  })

  // 列表按窗口高度分页，逐类先用执行结果筛选把该类记录调到第 1 页再取标签
  const firstTag = async (resultLabel, colIdx) => {
    await pick(0, resultLabel)
    return tagIn(tableRows()[0], colIdx)
  }

  it('执行结果标签色：成功绿 / 执行失败红 / 执行前拦截橙 / 待确认蓝 / 用户取消灰', async () => {
    const expectTag = async (label, cls) => {
      const tag = await firstTag(label, 5)
      expect(tag.textContent.trim()).toBe(label)
      expect(tag.className).toContain(cls)
    }
    await expectTag('成功', 'st--success')
    await expectTag('执行失败', 'st--danger')
    await expectTag('执行前拦截', 'st--warning')
    await expectTag('待确认', 'st--accent')
    await expectTag('用户取消', 'st--info')
  })

  it('用户确认标签色：已确认绿 / 待确认蓝 / 已取消灰 / 不需要确认灰', async () => {
    expect((await firstTag('待确认', 4)).className).toContain('st--accent')
    expect((await firstTag('用户取消', 4)).textContent.trim()).toBe('已取消')
    expect((await firstTag('用户取消', 4)).className).toContain('st--info')
    expect((await firstTag('执行前拦截', 4)).textContent.trim()).toBe('不需要确认')
    expect((await firstTag('执行前拦截', 4)).className).toContain('st--info')
    await search('报价单生成')
    await pick(0, '成功')
    const confirmed = tableRows().map((tr) => tagIn(tr, 4)).find((t) => t.textContent.trim() === '已确认')
    expect(confirmed.className).toContain('st--success')
  })
})

describe('详情抽屉（§5.2 / §5.3 / §5.4）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('执行前拦截的调用 → 时间线停在「检查未通过」，并写明拦截原因，不出确认 / 执行节点', async () => {
    await openDetail('生产数据查询')
    expect(timelineTitles()).toEqual(['发起调用', '检查未通过，已拦截'])
    expect(drawer().textContent).toContain('不在工具白名单')
  })

  it('用户取消的写操作 → 时间线停在「已取消」，不出执行结果节点', async () => {
    await openDetail('报销单提交')
    expect(timelineTitles()).toEqual(['发起调用', '调用检查通过', '已取消'])
  })

  it('待确认的写操作 → 时间线停在「待确认」，不出执行结果节点', async () => {
    await openDetail('排产计划调整', '待确认')
    expect(timelineTitles()).toEqual(['发起调用', '调用检查通过', '待确认'])
  })

  it('已确认的写操作 → 依次展示 发起 / 检查 / 用户已确认（带等待时长）/ 执行结果', async () => {
    await openDetail('报价单生成', '已确认')
    expect(timelineTitles()).toEqual(['发起调用', '调用检查通过', '用户已确认', '成功'])
    expect(drawer().textContent).toContain('等待 8 秒')
  })

  it('无需确认的读操作 → 时间线不出「用户确认」节点（md 工具调用审计 §5.2「用户确认（仅『操作性质=写』且需要确认时展示）」）', async () => {
    await openDetail('方案要点生成')
    expect(timelineTitles()).toEqual(['发起调用', '调用检查通过', '成功'])
  })

  it('写操作但无需确认（C-1003「客户记录更新」，WRITE + NONE）→ 同样不出「用户确认」节点，直接 发起 / 检查 / 执行结果（md §5.2「仅『操作性质=写』且需要确认时展示」）', async () => {
    await openDetail('客户记录更新')
    expect(timelineTitles()).toEqual(['发起调用', '调用检查通过', '成功'])
    expect(drawer().textContent).not.toContain('用户已确认')
  })

  it('四类结果说明文案（§5.3）：失败 / 拦截 / 取消 / 待确认各一句建议动作', async () => {
    const explain = () => drawer().querySelector('.el-alert__title').textContent.trim()
    await openDetail('排产冲突检测', '执行失败')
    expect(explain()).toBe('建议检查连接器状态及工具服务日志，并核对是否已有后续重试记录。')
    await openDetail('生产数据查询')
    expect(explain()).toBe('请核对该岗位允许使用的工具和用户权限，再由发起人重新提交任务。')
    await openDetail('报销单提交')
    expect(explain()).toContain('本次操作已终止')
    expect(explain()).toContain('请由发起人重新发起')
    await openDetail('排产计划调整', '待确认')
    expect(explain()).toBe('等待发起人在客户端处理，此页不代替用户确认。')
  })

  it('未执行的调用：默认在「实际请求参数」页签，参数暂缺显示【待补充】；切到「实际响应结果」→「工具未执行，因此没有实际响应结果」', async () => {
    await openDetail('生产数据查询')
    expect(drawer().textContent).toContain('敏感字段已脱敏')
    expect(drawer().textContent).toContain('【待补充】本次调用的实际请求参数')
    ;[...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '实际响应结果').click()
    await flush()
    expect(drawer().textContent).toContain('工具未执行，因此没有实际响应结果。')
    expect(drawer().textContent).not.toContain('敏感字段已脱敏')
  })
})
