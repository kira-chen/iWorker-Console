// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { h, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from '@/views/admin/__tests__/helpers/smokeMount'
import { getUsageSummary as mockSummary } from '@/api/usageMock'

/**
 * CockpitUsageTab（驾驶舱「使用情况」页签，PRD prd.驾驶舱.md 第五～九节）区块级单测。
 *
 * 不 mock 数据层：直接用 usageMock（固定种子、口径单测见 api/__tests__/usageMock.test.js），
 * 期望值取自同一份 mock 的聚合结果，所以这里守的是「页面把数据按规则摆对」——
 * 筛选联动、概览卡、趋势图、点踩统计、四张明细表的列 / 默认排序 / 排序 / 翻页 / 开关。
 * 驾驶舱页面级的页签权限、刷新、点踩明细弹窗见 views/admin/__tests__/adminCockpit.test.js。
 */

let mounted
let router
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim()
const root = () => mounted.container
const kpi = (key) => root().querySelector(`.kpi-card[data-kpi="${key}"]`)

async function mount(props = {}, { wait = true } = {}) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/admin/models', name: 'AdminModels', component: { template: '<div />' } }
    ]
  })
  await router.push('/')
  await router.isReady()
  const { default: CockpitUsageTab } = await import('@/components/admin/cockpit/CockpitUsageTab.vue')
  mounted = mountReal(CockpitUsageTab, props, { plugins: [router] })
  if (wait) await loaded()
}
/** 等首次 / 重新取数落到 DOM（mock 有 300ms 延迟）。 */
async function loaded() {
  await vi.waitFor(() => expect(root().querySelector('.usage-tab.is-busy')).toBeNull(), { timeout: 3000 })
  await flushAll(6)
}

async function chooseOption(nth, text) {
  root().querySelectorAll('.usage-filters .el-select')[nth].querySelector('.el-select__wrapper').click()
  await flushAll(4)
  ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => textOf(i) === text).click()
  await flushAll(4) // 先让 watch 把 loading 置上，否则下面的等待会在取数开始前就放行
  await loaded()
}
const radio = (label) => [...root().querySelectorAll('.el-radio-button')].find((l) => textOf(l) === label)
async function pickDim(label) {
  radio(label).click()
  await flushAll(6)
}
const detail = () => root().querySelector('[aria-label="使用明细"]')
const headers = () => [...detail().querySelectorAll('thead th')].map((th) => textOf(th).replace(/ [↓↑]$/, ''))
const rowsOf = () => [...detail().querySelectorAll('tbody tr')]
const firstCol = (rows = rowsOf()) => rows.map((r) => r.querySelector('td .dash-name-main').firstChild.textContent.trim())
const searchInput = () => detail().querySelector('.ux-search input')
/** 在当前维度的搜索框输入并回车。 */
async function search(text) {
  const input = searchInput()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  await flushAll(4)
}
const footText = () => textOf(detail().querySelector('.ux-foot'))
const footBtn = (label) => [...detail().querySelectorAll('.ux-foot button')].find((b) => textOf(b) === label)
const th = (label) => [...detail().querySelectorAll('thead th')].find((t) => textOf(t).replace(/ [↓↑]$/, '') === label)

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('CockpitUsageTab · 筛选条与取数（PRD §五.1）', () => {
  it('筛选条三项：时间范围（默认近 30 天）/ 终端（默认全部终端）/ 岗位（默认全部岗位）', async () => {
    await mount()
    const selects = [...root().querySelectorAll('.usage-filters .el-select')].map((s) => textOf(s))
    expect(selects).toEqual(['近 30 天', '全部终端', '全部岗位'])
  })

  it('选终端 Mac → 重新取数，活跃用户卡的活跃率分母变成 Mac 用户数；岗位下拉选项仍是全部岗位', async () => {
    await mount()
    const all = await mockSummary({ range: 30 })
    const mac = await mockSummary({ range: 30, terminal: 'MAC' })
    expect(textOf(kpi('active'))).toContain(`${all.kpis.activeUsers.value}人`)
    await chooseOption(1, 'Mac')
    expect(textOf(kpi('active'))).toContain(`${mac.kpis.activeUsers.value}人`)
    expect(textOf(kpi('active'))).toContain(`活跃率 ${mac.kpis.activeUsers.rate}%`)
    // 岗位下拉没有因为筛选而缩水
    root().querySelectorAll('.usage-filters .el-select')[2].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const options = [...document.body.querySelectorAll('.el-select-dropdown__item')].map(textOf)
    expect(options).toContain('销售顾问')
    expect(options).toContain('客服专员')
  })

  it('选时间范围近 7 天 → 趋势图变 7 根柱，概览卡随之变化', async () => {
    await mount()
    expect(root().querySelectorAll('[data-testid="trend-col"]')).toHaveLength(30)
    await chooseOption(0, '近 7 天')
    expect(root().querySelectorAll('[data-testid="trend-col"]')).toHaveLength(7)
    const d7 = await mockSummary({ range: 7 })
    expect(textOf(kpi('sessions'))).toContain(d7.kpis.sessions.value.toLocaleString('en-US'))
  })

  it('取数中区块呈骨架屏（.is-busy）、取回后恢复；取数失败展示「加载失败」+【重试】，筛选条保留，点【重试】后恢复', async () => {
    vi.resetModules()
    const usage = await import('@/api/usage')
    const spy = vi.spyOn(usage, 'getUsageSummary').mockRejectedValueOnce(new Error('boom'))
    const { default: Tab } = await import('@/components/admin/cockpit/CockpitUsageTab.vue')
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/')
    mounted = mountReal(Tab, {}, { plugins: [router] })
    expect(root().querySelector('.usage-tab.is-busy')).not.toBeNull()
    await vi.waitFor(() => expect(root().querySelector('.usage-error')).not.toBeNull())
    expect(textOf(root().querySelector('.usage-error'))).toContain('加载失败')
    expect(root().querySelector('.usage-filters')).not.toBeNull()
    expect(root().querySelector('.kpi-card')).toBeNull()

    spy.mockRestore()
    ;[...root().querySelectorAll('.usage-error button')].find((b) => textOf(b) === '重试').click()
    await loaded()
    expect(root().querySelector('.usage-error')).toBeNull()
    expect(root().querySelectorAll('.kpi-card')).toHaveLength(4)
  })
})

describe('CockpitUsageTab · 使用概览卡（PRD §五.2）', () => {
  it('四张卡：活跃用户 / 会话数 / Token 消耗 / 模型调用失败率，主值与副标题按口径展示', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const k = r.kpis
    expect([...root().querySelectorAll('.kpi-card .kpi-label')].map(textOf)).toEqual(['活跃用户', '会话数', 'Token 消耗', '模型调用失败率'])
    expect(textOf(kpi('active'))).toContain(`${k.activeUsers.value}人`)
    expect(textOf(kpi('active'))).toContain(`活跃率 ${k.activeUsers.rate}%`)
    expect(textOf(kpi('sessions'))).toContain(`${k.sessions.value.toLocaleString('en-US')}次`)
    expect(textOf(kpi('sessions'))).toContain(`人均 ${k.sessions.perUser} 次`)
    expect(textOf(kpi('tokens'))).toMatch(/^Token 消耗\d+\.\dM/)
    expect(textOf(kpi('tokens'))).toMatch(/输入 \d+\.\dM \/ 输出 \d+\.\dM/)
    expect(textOf(kpi('fail'))).toContain(`${k.failRate.value}%`)
    expect(textOf(kpi('fail'))).toContain(`失败 ${k.failRate.failed} 次 / 共 ${k.failRate.calls.toLocaleString('en-US')} 次调用`)
  })

  it('每张卡都有「较上一周期」；用量类指标升降都是中性灰，失败率下降绿色、上升红色', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    for (const key of ['active', 'sessions', 'tokens', 'fail']) {
      expect(textOf(kpi(key).querySelector('.kpi-change'))).toContain('较上一周期')
    }
    expect(r.kpis.sessions.change).not.toBe(0)
    expect(kpi('sessions').querySelector('.kpi-change').className).not.toMatch(/is-good|is-bad/)
    expect(textOf(kpi('fail').querySelector('.kpi-change'))).toContain('个百分点') // 比率类用百分点差值
    const failChange = r.kpis.failRate.change
    const cls = kpi('fail').querySelector('.kpi-change').className
    if (failChange < 0) expect(cls).toContain('is-good')
    else if (failChange > 0) expect(cls).toContain('is-bad')
  })

  it('卡片只读：没有按钮，不可点击', async () => {
    await mount()
    for (const c of root().querySelectorAll('.kpi-card')) {
      expect(c.querySelector('button')).toBeNull()
      expect(c.tagName).toBe('DIV')
    }
  })

  it('【统计口径】默认收起，点开说明「活跃 = 产生对话而不是登录」，再点收起', async () => {
    await mount()
    expect(root().querySelector('.help-body')).toBeNull()
    const entry = root().querySelector('.help-entry button')
    expect(textOf(entry)).toBe('统计口径')
    entry.click()
    await flushAll(2)
    expect(textOf(root().querySelector('.help-body'))).toContain('不是登录')
    entry.click()
    await flushAll(2)
    expect(root().querySelector('.help-body')).toBeNull()
  })
})

describe('CockpitUsageTab · 趋势图（PRD §五.3）', () => {
  const readout = () => textOf(root().querySelector('[data-testid="trend-readout"]'))
  const cols = () => [...root().querySelectorAll('[data-testid="trend-col"]')]
  const metricBtn = (label) => [...root().querySelectorAll('.trend-panel .el-radio-button')].find((l) => textOf(l) === label)

  it('默认指标「活跃用户」；悬停某根柱，读数行显示该日日期与数值；离开恢复提示', async () => {
    await mount()
    expect(textOf(root().querySelector('.trend-panel .el-radio-button.is-active'))).toBe('活跃用户')
    expect(readout()).toBe('悬停柱子查看当日数值')
    const r = await mockSummary({ range: 30 })
    cols()[29].dispatchEvent(new MouseEvent('mouseenter'))
    await flushAll(2)
    expect(readout()).toBe(`11-01 · 活跃用户 ${r.trend[29].activeUsers} 人`)
    root().querySelector('.trend-bars').dispatchEvent(new MouseEvent('mouseleave'))
    await flushAll(2)
    expect(readout()).toBe('悬停柱子查看当日数值')
  })

  it('切到「会话数」「Token」只换图不重新取数；Token 才有输入 / 输出图例，悬停读数含输入、输出、合计', async () => {
    await mount()
    expect(root().querySelector('.trend-legend')).toBeNull()
    metricBtn('会话数').click()
    await flushAll(4)
    cols()[0].dispatchEvent(new MouseEvent('mouseenter'))
    await flushAll(2)
    expect(readout()).toMatch(/· 会话数 \d+ 次$/)

    metricBtn('Token').click()
    await flushAll(4)
    expect(textOf(root().querySelector('.trend-legend'))).toBe('输入输出')
    cols()[0].dispatchEvent(new MouseEvent('mouseenter'))
    await flushAll(2)
    expect(readout()).toMatch(/输入 [\d.]+[KM]? \/ 输出 [\d.]+[KM]? \/ 合计 [\d.]+[KM]?/)
    expect(root().querySelector('.trend-col .seg.out')).not.toBeNull() // Token 是输入 + 输出堆叠柱
  })
})

describe('CockpitUsageTab · 用户端点踩统计（PRD §六）', () => {
  it('区块标题「用户端点踩统计」，两格：点踩总数（副文案点踩率 + 进度条）/ 点踩率趋势', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const fb = root().querySelector('.fb-panel')
    expect(textOf(fb.querySelector('.dash-panel-title'))).toBe('用户端点踩统计')
    expect([...fb.querySelectorAll('.fb-stat-label')].map(textOf)).toEqual(['点踩总数', '点踩率趋势'])
    const dislikes = fb.querySelector('[data-testid="fb-dislikes"]')
    expect(textOf(dislikes.querySelector('.fb-stat-val'))).toBe(`${r.feedback.dislikes.toLocaleString('en-US')}次`)
    expect(textOf(dislikes)).toContain(`点踩率 ${r.feedback.rate.toFixed(1)}%`)
    expect(dislikes.querySelector('.like-bar i').style.width).toBe(`${r.feedback.rate}%`)
  })

  it('不展示点赞（2026-09-17 裁决，11-10 重申）：区块里没有点赞数，点赞只参与点踩率计算', async () => {
    await mount()
    expect(textOf(root().querySelector('.fb-panel'))).not.toContain('点赞')
  })

  it('点踩率趋势 = 当前点踩率 − 上一周期点踩率，单位是「个百分点」，下降是绿色、上升是红色', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const diff = Math.round((r.feedback.rate - r.feedback.prevRate) * 10) / 10
    const trend = root().querySelector('[data-testid="fb-trend"]')
    expect(textOf(trend)).toContain(`${diff < 0 ? '↓' : '↑'} ${Math.abs(diff)} 个百分点`)
    expect(textOf(trend)).toContain(`上一周期点踩率 ${r.feedback.prevRate.toFixed(1)}%`)
    expect(trend.querySelector('.fb-stat-val').classList.contains('up')).toBe(diff > 0)
  })

  it('区块头只有【查看点踩明细】一个按钮', async () => {
    await mount()
    const labels = [...root().querySelectorAll('.fb-panel .dash-panel-head button')].map(textOf)
    expect(labels).toEqual(['查看点踩明细'])
  })

  it('点踩明细弹窗的时间范围下拉初始值跟随页签顶部的时间范围（近 90 天 → 弹窗也是近 90 天）', async () => {
    await mount()
    await chooseOption(0, '近 90 天')
    ;[...root().querySelectorAll('.fb-panel button')].find((b) => textOf(b) === '查看点踩明细').click()
    await flushAll(8)
    const dialog = [...document.body.querySelectorAll('.el-dialog')].find((d) => d.querySelector('.dl-dialog-title'))
    expect(textOf(dialog.querySelector('.dl-filters .el-select'))).toBe('近 90 天')
  })
})

describe('CockpitUsageTab · 使用明细 · 按用户（PRD §七.2）', () => {
  it('四个维度按钮：按用户（默认）/ 按岗位 / 按模型 / 按能力', async () => {
    await mount()
    expect([...detail().querySelectorAll('.el-radio-button')].map(textOf)).toEqual(['按用户', '按岗位', '按模型', '按能力'])
    expect(textOf(detail().querySelector('.el-radio-button.is-active'))).toBe('按用户')
  })

  it('列：用户 / 终端 / 活跃天数 / 会话数 / 输入 Token / 输出 Token / 最近使用时间 / 点赞 / 点踩 / 点踩率', async () => {
    await mount()
    expect(headers()).toEqual(['用户', '终端', '活跃天数', '会话数', '输入 Token', '输出 Token', '最近使用时间', '点赞', '点踩', '点踩率'])
  })

  it('默认按 Token 合计（输入 + 输出）由高到低，每页 10 条，「第 1 / 25 页，共 241 条」', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const top = [...r.users].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || a.name.localeCompare(b.name, 'zh'))
    expect(rowsOf()).toHaveLength(10)
    expect(firstCol()).toEqual(top.slice(0, 10).map((u) => u.name))
    expect(footText()).toContain('第 1 / 25 页，共 241 条')
    expect(footBtn('上一页').disabled).toBe(true)
    expect(footBtn('下一页').disabled).toBe(false)
  })

  it('点数值列头排序：首次降序、再点升序，列头显示 ↓ / ↑，排序后回到第 1 页', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    footBtn('下一页').click()
    await flushAll(2)
    expect(footText()).toContain('第 2 / 25 页')

    th('会话数').click()
    await flushAll(2)
    expect(textOf(th('会话数'))).toBe('会话数 ↓')
    expect(footText()).toContain('第 1 / 25 页')
    const desc = [...r.users].map((u) => u.sessions).sort((a, b) => b - a)
    expect(rowsOf().map((tr) => Number(textOf(tr.children[3]).replace(/,/g, '')))).toEqual(desc.slice(0, 10))

    th('会话数').click()
    await flushAll(2)
    expect(textOf(th('会话数'))).toBe('会话数 ↑')
    const asc = [...desc].reverse()
    expect(rowsOf().map((tr) => Number(textOf(tr.children[3]).replace(/,/g, '')))).toEqual(asc.slice(0, 10))
  })

  it('翻到末页只剩 1 条，【下一页】置灰、【上一页】可点', async () => {
    await mount()
    for (let i = 0; i < 24; i++) {
      footBtn('下一页').click()
      await flushAll(1)
    }
    expect(footText()).toContain('第 25 / 25 页，共 241 条')
    expect(rowsOf()).toHaveLength(1)
    expect(footBtn('下一页').disabled).toBe(true)
    expect(footBtn('上一页').disabled).toBe(false)
  })

  it('搜索用户名：回车后只剩匹配的用户；清空搜索恢复', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const target = r.users[0].name
    const input = detail().querySelector('.ux-search input')
    input.value = target
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(4)
    expect(firstCol()).toContain(target)
    expect(footText()).toContain(`共 ${r.users.filter((u) => u.name.includes(target)).length} 条`)

    detail().querySelector('.ux-search .el-input__clear')?.click()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...detail().querySelectorAll('.ux-toolbar button')].find((b) => textOf(b) === '查询').click()
    await flushAll(4)
    expect(footText()).toContain('共 241 条')
  })

  it('「仅看沉默用户」：旁边标「沉默用户 N 人」，打开后只剩会话数为 0 的领用用户，从未使用的显示「从未使用」', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const silent = r.users.filter((u) => u.sessions === 0)
    expect(textOf(detail().querySelector('.ux-toolbar'))).toContain(`沉默用户 ${silent.length} 人`)
    detail().querySelector('.ux-toolbar .el-switch').click()
    await flushAll(4)
    expect(footText()).toContain(`共 ${silent.length} 条`)
    for (const tr of rowsOf()) expect(textOf(tr.children[3])).toBe('0')
    expect(detail().textContent).toContain('从未使用')
  })

  it('终端列用蓝色 accent 标签展示 Windows / Mac（同访问审计）', async () => {
    await mount()
    const tags = [...detail().querySelectorAll('tbody tr td:nth-child(2) .status-tag')]
    expect(tags.length).toBe(10)
    for (const t of tags) {
      expect(t.className).toContain('st--accent')
      expect(['Windows', 'Mac']).toContain(textOf(t))
    }
  })
})

describe('CockpitUsageTab · 使用明细 · 按岗位（PRD §七.3，取代岗位领用 Top 5）', () => {
  it('列与「领用岗位员工数量 241 人」副标题；列出全部已发布岗位（不再限前 5 名）', async () => {
    await mount()
    await pickDim('按岗位')
    expect(headers()).toEqual(['岗位', '领用人数', '活跃人数', '活跃率', '会话数', '人均 Token', '点赞', '点踩', '点踩率'])
    expect(textOf(detail().querySelector('.ux-toolbar'))).toContain('领用岗位员工数量 241 人')
    expect(rowsOf()).toHaveLength(9)
    expect(footText()).toContain('共 9 条')
  })

  it('默认按领用人数由高到低（延续原 Top 榜口径）：销售顾问 48 人排第一，进度条按最大值归一化', async () => {
    await mount()
    await pickDim('按岗位')
    expect(firstCol().slice(0, 5)).toEqual(['销售顾问', '经营分析师', '项目经理助手', '生产计划员', '产品经理助手'])
    const bars = rowsOf().map((tr) => tr.querySelector('.dash-bar-track i').style.width)
    expect(bars[0]).toBe('100%')
    expect(parseFloat(bars[1])).toBeLessThan(100)
    expect(textOf(rowsOf()[0].querySelector('.dash-bar-number'))).toBe('48')
  })

  it('活跃率 = 活跃人数 ÷ 领用人数，「领用了没用起来」一眼可见', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按岗位')
    const row = rowsOf().find((tr) => textOf(tr).startsWith('销售顾问'))
    const p = r.positions.find((x) => x.name === '销售顾问')
    expect(textOf(row.children[2])).toBe(String(p.active))
    expect(textOf(row.children[3])).toBe(`${p.activeRate.toFixed(1)}%`)
  })

  it('搜索岗位名称：回车后只剩名称匹配的岗位，「领用岗位员工数量」提示仍在', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按岗位')
    expect(searchInput().placeholder).toBe('搜索岗位名称')
    await search('经营')
    const hits = r.positions.filter((p) => p.name.includes('经营')).map((p) => p.name)
    expect(hits.length).toBeGreaterThan(0)
    expect(firstCol().sort()).toEqual(hits.sort())
    expect(textOf(detail().querySelector('.ux-toolbar'))).toContain('领用岗位员工数量 241 人')
  })

  it('每个维度各存各的搜索词：按用户搜过的词不带到按岗位，切回按用户还在', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    const target = r.users[0].name
    await search(target)
    const userHits = r.users.filter((u) => u.name.includes(target)).length
    expect(footText()).toContain(`共 ${userHits} 条`)
    await pickDim('按岗位')
    expect(searchInput().value).toBe('')
    expect(footText()).toContain('共 9 条')
    await pickDim('按用户')
    expect(searchInput().value).toBe(target)
    expect(footText()).toContain(`共 ${userHits} 条`)
  })

  it('每个维度各自保留排序与翻页：在按用户翻到第 3 页，切到按岗位再切回来仍是第 3 页', async () => {
    await mount()
    footBtn('下一页').click()
    await flushAll(1)
    footBtn('下一页').click()
    await flushAll(1)
    expect(footText()).toContain('第 3 / 25 页')
    await pickDim('按岗位')
    expect(footText()).toContain('第 1 / 1 页')
    await pickDim('按用户')
    expect(footText()).toContain('第 3 / 25 页')
  })
})

describe('CockpitUsageTab · 使用明细 · 按模型（PRD §七.4）', () => {
  it('列含失败原因 Top、首响 P50 / P95、点赞 / 点踩 / 点踩率与操作', async () => {
    await mount()
    await pickDim('按模型')
    expect(headers()).toEqual(['模型', '调用次数', '输入 Token', '输出 Token', '活跃用户', '失败率', '失败原因 Top', '首响 P50 / P95', '点赞', '点踩', '点踩率', '操作'])
    expect(rowsOf()).toHaveLength(6)
  })

  it('默认按调用次数由高到低；默认模型附【默认】标签，类别在副标题', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按模型')
    const expected = [...r.models].sort((a, b) => b.calls - a.calls).map((m) => m.name)
    expect(firstCol()).toEqual(expected)
    const tags = [...detail().querySelectorAll('.ux-default')]
    expect(tags).toHaveLength(1)
    expect(textOf(tags[0].closest('td'))).toContain('DeepSeek V3')
    expect(textOf(tags[0].closest('td'))).toContain('文本生成')
  })

  it('失败率高于 5% 用警告色、高于 10% 用危险色；失败原因 Top 写成「原因 占比%」；首响耗时「1.1s / 3.5s」格式', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按模型')
    const rowOf = (name) => rowsOf().find((tr) => textOf(tr).startsWith(name))
    const vl = r.models.find((m) => m.name === 'Qwen3-VL')
    expect(vl.failRate).toBeGreaterThan(10)
    expect(rowOf('Qwen3-VL').children[5].className).toContain('is-danger')
    const kimi = r.models.find((m) => m.name === 'Kimi K2')
    expect(kimi.failRate).toBeGreaterThan(5)
    expect(rowOf('Kimi K2').children[5].className).toContain('is-warn')
    const ds = r.models.find((m) => m.name === 'DeepSeek V3')
    expect(rowOf('DeepSeek V3').children[5].className).not.toMatch(/is-warn|is-danger/)
    expect(textOf(rowOf('DeepSeek V3').children[6])).toBe(`${ds.topReason.label} ${ds.topReason.pct}%`)
    expect(textOf(rowOf('DeepSeek V3').children[7])).toBe(`${ds.p50.toFixed(1)}s / ${ds.p95.toFixed(1)}s`)
  })

  it('搜索模型名称，不区分大小写：输入「kimi」只剩 Kimi K2', async () => {
    await mount()
    await pickDim('按模型')
    expect(searchInput().placeholder).toBe('搜索模型名称')
    await search('kimi')
    expect(firstCol()).toEqual(['Kimi K2'])
    expect(footText()).toContain('共 1 条')
  })

  it('【查看】跳转模型页并注入该模型名称作为搜索关键词', async () => {
    await mount()
    await pickDim('按模型')
    const row = rowsOf().find((tr) => textOf(tr).startsWith('Kimi K2'))
    ;[...row.querySelectorAll('button')].find((b) => textOf(b) === '查看').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminModels'))
    expect(router.currentRoute.value.query.keyword).toBe('Kimi K2')
  })
})

describe('CockpitUsageTab · 使用明细 · 按能力（PRD §七.5）', () => {
  it('列只有能力 / 调用次数 / 使用人数 / 成功率 / 最近调用时间，不带点赞点踩（反馈挂在对话轮次上，归不到技能）', async () => {
    await mount()
    await pickDim('按能力')
    expect(headers()).toEqual(['能力', '调用次数', '使用人数', '成功率', '最近调用时间'])
    expect(detail().textContent).not.toContain('点踩率')
  })

  it('范围是已发布的技能与专家（副标题标类型），默认按调用次数由高到低', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按能力')
    const names = r.abilities.map((a) => a.name)
    expect(footText()).toContain(`共 ${names.length} 条`)
    const first = rowsOf()[0]
    const top = [...r.abilities].sort((a, b) => b.calls - a.calls)[0]
    expect(textOf(first.querySelector('.dash-name-main'))).toBe(top.name)
    const subs = new Set([...detail().querySelectorAll('tbody .dash-name-sub')].map(textOf))
    expect([...subs].every((s) => ['技能', '专家'].includes(s))).toBe(true)
    expect(subs.has('专家')).toBe(true)
  })

  it('「仅看零使用」：旁边标「零使用 N 个」，打开后只剩时间范围内一次都没被调用的能力，从未使用的显示「从未使用」', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按能力')
    const zero = r.abilities.filter((a) => a.calls === 0)
    expect(zero.length).toBeGreaterThanOrEqual(3)
    expect(textOf(detail().querySelector('.ux-toolbar'))).toContain(`零使用 ${zero.length} 个`)
    detail().querySelector('.ux-toolbar .el-switch').click()
    await flushAll(4)
    expect(firstCol().sort()).toEqual(zero.map((a) => a.name).sort())
    for (const tr of rowsOf()) {
      expect(textOf(tr.children[1])).toBe('0')
      expect(tr.className).toContain('is-zero')
    }
    expect(detail().textContent).toContain('从未使用')
  })

  it('搜索能力名称，与「仅看零使用」同时生效', async () => {
    await mount()
    const r = await mockSummary({ range: 30 })
    await pickDim('按能力')
    expect(searchInput().placeholder).toBe('搜索能力名称')
    const kw = r.abilities.find((a) => a.calls === 0).name.slice(0, 2)
    await search(kw)
    const hits = r.abilities.filter((a) => a.name.includes(kw))
    expect(firstCol().sort()).toEqual(hits.map((a) => a.name).sort())
    detail().querySelector('.ux-toolbar .el-switch').click()
    await flushAll(4)
    expect(firstCol().sort()).toEqual(hits.filter((a) => a.calls === 0).map((a) => a.name).sort())
  })

  it('筛选结果为空展示「暂无数据」空状态（保留表头），翻页按钮都置灰', async () => {
    await mount()
    const input = detail().querySelector('.ux-search input')
    input.value = '不存在的名字'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushAll(4)
    expect(textOf(detail().querySelector('.ux-empty'))).toBe('暂无数据')
    expect(headers()).toHaveLength(10) // 表头还在
    expect(footText()).toContain('第 1 / 1 页，共 0 条')
    expect(footBtn('上一页').disabled).toBe(true)
    expect(footBtn('下一页').disabled).toBe(true)
  })
})

describe('CockpitUsageTab · 驾驶舱刷新（PRD §一.3）', () => {
  it('驾驶舱刷新中（refreshing）区块呈骨架屏、不可交互；刷新结束后恢复', async () => {
    await mount({ refreshing: true }, { wait: false })
    await flushAll(6)
    expect(root().querySelector('.usage-tab').className).toContain('is-busy')
    expect(root().querySelector('.kpi-card')).not.toBeNull() // 骨架屏只是视觉覆盖，区块结构还在
  })

  it('刷新计数 +1 → 按当前筛选重新取数（驾驶舱【刷新】每点一次计数 +1）', async () => {
    const usage = await import('@/api/usage')
    const spy = vi.spyOn(usage, 'getUsageSummary')
    const { default: Tab } = await import('@/components/admin/cockpit/CockpitUsageTab.vue')
    const token = ref(0)
    const Host = { render: () => h(Tab, { refreshToken: token.value }) }
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/')
    mounted = mountReal(Host, {}, { plugins: [router] })
    await loaded()
    expect(spy).toHaveBeenCalledTimes(1)

    token.value++
    await flushAll(4)
    await loaded()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith({ range: 30, terminal: '', position: '' })
  })
})
