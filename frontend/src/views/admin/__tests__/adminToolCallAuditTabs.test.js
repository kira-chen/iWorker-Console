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
 * 「技能调用」页签自身行为由 adminToolCallAudit.test.js 覆盖，这里不重复。
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
  it('三个页签，默认进入「技能调用」；另两个页签首次点开才挂载', async () => {
    mountReal()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const labels = [...container.querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['技能调用', '岗位自动化任务', '知识库检索'])
    expect(container.querySelector('.el-tabs__item.is-active').textContent.trim()).toBe('技能调用')

    expect(pane('skill').textContent).toContain('当前待确认')
    // lazy：没点开之前，任务 / 知识库页签的内容根本不在 DOM 里
    expect(pane('task')).toBeNull()
    expect(pane('knowledge')).toBeNull()

    await openTab('task')
    expect(pane('task').querySelector('.metric-card')).toBeTruthy()
    expect(pane('knowledge')).toBeNull()
  })

  it('各页签查询条件互不影响：技能调用筛到「执行失败」，切走再切回仍保持', async () => {
    mountReal()
    await flush()
    cardOf(pane('skill'), '执行失败').click()
    await flush()
    const failedOnly = bodyRows(pane('skill'))
    expect(failedOnly.length).toBeGreaterThan(0)
    failedOnly.forEach((r) => expect(r.textContent).toContain('执行失败'))

    await openTab('task')
    // 任务页签自己的筛选是空的，不受技能调用页签影响：列表里仍有成功的记录
    expect(bodyRows(pane('task')).some((r) => r.textContent.includes('成功'))).toBe(true)
    await openTab('skill')
    bodyRows(pane('skill')).forEach((r) => expect(r.textContent).toContain('执行失败'))
  })
})

describe('岗位自动化任务页签（PRD §八）', () => {
  it('无人值守口径：卡片没有「当前待确认」，换成「执行前拦截」；列表展示任务、触发方式、写操作授权', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    const text = p.textContent

    expect(cards(p).map((c) => c.querySelector('.metric-label').textContent)).toEqual([
      '调用请求总数', '写操作请求', '执行失败', '执行前拦截'
    ])
    expect(text).not.toContain('当前待确认')
    expect(text).toContain('已预授权')
    expect(text).toContain('未授权拦截')
    expect(text).toContain('每日经营晨报')
    expect(text).toContain('定时·每天 08:30')
    expect(text).toContain('任务 / 工具')
    expect(text).toContain('写操作授权')
    expect(p.querySelector('input[placeholder="搜索用户 / 岗位 / 任务 / 工具"]')).toBeTruthy()
  })

  it('点「写操作请求」卡片 → 只剩写操作；其中未授权的一条被执行前拦截', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '写操作请求').click()
    await flush()
    const rows = bodyRows(p)
    const writes = MOCK.taskCallRecords.filter((r) => r.nature === 'WRITE')
    expect(rows.length).toBe(writes.length)
    const blocked = rows.find((r) => r.textContent.includes('未授权'))
    expect(blocked.textContent).toContain('执行前拦截')
    expect(blocked.textContent).toContain('无人值守任务未授权写操作')
  })

  it('详情：时间线以「任务触发」开头并展示任务运行编号；未授权的写操作在调用检查处停止', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '写操作请求').click()
    await flush()
    const row = bodyRows(p).find((r) => r.textContent.includes('未授权'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()

    const drawer = document.body.querySelector('.el-drawer__body')
    expect(drawer).toBeTruthy()
    const t = drawer.textContent
    expect(t).toContain('任务触发')
    expect(t).toContain('任务运行编号')
    expect(t).toContain('RUN-20260925-7012')
    expect(t).toContain('检查未通过，已拦截')
    expect(t).not.toContain('写操作已预授权')
    expect(t).toContain('该任务未对写操作预授权')
  })

  it('已预授权的写操作详情展示授权人与授权时间', async () => {
    mountReal()
    await flush()
    await openTab('task')
    const p = pane('task')
    cardOf(p, '写操作请求').click()
    await flush()
    const row = bodyRows(p).find((r) => r.textContent.includes('已预授权') && r.textContent.includes('成功'))
    ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
    await flush()
    const t = document.body.querySelector('.el-drawer__body').textContent
    expect(t).toContain('写操作已预授权')
    expect(t).toContain('2026-09-10 14:20')
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
      '检索请求总数', '无命中检索', '执行失败', '执行前拦截'
    ])
    expect(text).toContain('知识库 / 数据源')
    expect(text).toContain('检索词')
    expect(text).toContain('命中条数')
    expect(text).toContain('MCP·法规库检索')
    expect(text).toContain('API·情报平台接口')
    expect(text).not.toContain('操作性质')
    expect(text).not.toContain('用户确认')
    expect(text).not.toContain('当前待确认')
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

  it('搜索框按检索词过滤；命中执行失败时展示失败原因', async () => {
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
      expect(r.textContent).toContain('执行失败')
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

describe('导出 CSV（PRD §三）', () => {
  it('两个新页签各自导出当前筛选结果', async () => {
    mountReal()
    await flush()
    for (const name of ['task', 'knowledge']) {
      await openTab(name)
      createObjectURL.mockClear()
      buttonOf(pane(name), '导出筛选结果 CSV').click()
      await flush()
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    }
  })
})
