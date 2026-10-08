// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminToolCallAudit.vue 真实挂载冒烟（2026-09-28 PRD 首次落地，对齐
 * docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md）。
 *
 * 参照 adminRolesSmoke.test.js 的真实挂载写法（只 mock 静态数据源在真实
 * 模块里没有网络层，本页数据本身就是常量数组，无需 mock @/api/toolCallAuditMock）：
 * 断言页头/统计卡片/列表字段/筛选联动/详情抽屉/CSV 导出五块 PRD 行为齐全。
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

  it('导出 CSV：生成 objectURL 并成功提示（PRD §三）', async () => {
    mountReal()
    await flush()
    const exportBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '导出筛选结果 CSV')
    expect(exportBtn).toBeTruthy()
    exportBtn.click()
    await flush()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
})
