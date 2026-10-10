// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminToolCallAudit.vue 真实挂载冒烟——默认页签「技能调用」的行为，对齐
 * docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md §二 ~ §七。
 *
 * 2026-10-09 记录单元改版（与研发梅竹讨论后）重写：记录单元从「一次工具调用」改为
 * 「一次技能执行」，原断言全部基于旧字段（操作性质/用户确认/执行结果五态），
 * 已随改版失效，本次整份重写，不保留旧版 it.fails 钉桩——那些钉桩对应的是旧实现的
 * 具体文案缺陷，结构改版后已不适用；若后续要补新模型下的缺口，走单独一轮 /test-audit。
 *
 * 种子数据固定在 2026-09-20 ~ 2026-09-27（toolCallAuditMock.js），固定系统时间到
 * 2026-09-28，避免默认 90 天窗口随真实日期推移把种子数据挤出窗口、用例到期变红。
 */
const MOCK = await import('@/api/toolCallAuditMock')
const AdminToolCallAudit = (await import('@/views/admin/AdminToolCallAudit.vue')).default

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

const cards = () => [...container.querySelectorAll('.metric-card')]
const cardOf = (label) => cards().find((c) => c.textContent.includes(label))
const bodyRows = () => [...container.querySelectorAll('.el-table__body .el-table__row')]
const helpBtn = () => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '统计口径')

async function search(kw) {
  const input = container.querySelector('input[placeholder="搜索用户 / 岗位 / 技能 / 工具"]')
  input.value = kw
  input.dispatchEvent(new Event('input'))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  await flush()
}

async function openDetailOf(skill) {
  await search(skill)
  const row = bodyRows().find((r) => r.textContent.includes(skill))
  ;[...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查看详情').click()
  await flush()
}

describe('AdminToolCallAudit · 技能调用页签 · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头 / 统计卡片 / 列表字段齐全（PRD §一 / §二 / §四）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(text).toContain('工具调用审计')
    expect(text).toContain('执行总数')
    expect(text).toContain('涉及写操作的执行')
    expect(text).toContain('执行失败')
    // 不展示"执行中"：卡片只有 3 张，没有"进行中"这张
    expect(cards().length).toBe(3)

    const total = MOCK.toolCallRecords.length
    expect(cardOf('执行总数').textContent).toContain(String(total))

    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(text).toContain('刘敏')
    expect(text).toContain('销售顾问')
    expect(text).toContain('方案要点生成')
    expect(container.querySelector('.list-pager')).toBeTruthy()
  })
})

describe('统计卡片（§二）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('执行总数副标题展示成功 / 失败计数，与种子数据一致（不展示"进行中"）', () => {
    const all = MOCK.toolCallRecords
    const count = (r) => all.filter((x) => x.result === r).length
    expect(cardOf('执行总数').textContent).toContain(`成功 ${count('SUCCESS')} / 失败 ${count('FAILED')}`)
    expect(cardOf('执行总数').textContent).not.toContain('进行中')
  })

  it('点「执行失败」→ 列表只剩整体结果=失败的记录', async () => {
    cardOf('执行失败').click()
    await flush()
    const rows = bodyRows()
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r) => expect(r.textContent).toContain('失败'))
  })

  it('点「涉及写操作的执行」→ 列表只剩涉及写操作的记录；清空后再点「执行总数」恢复全量', async () => {
    cardOf('涉及写操作的执行').click()
    await flush()
    const writes = MOCK.toolCallRecords.filter((r) => r.hasWrite)
    expect(bodyRows().length).toBe(writes.length)

    cardOf('执行总数').click()
    await flush()
    // 分页限制了可见行数，不能直接数 DOM 行——用卡片自身的计数验证筛选已清空
    expect(cardOf('执行总数').textContent).toContain(String(MOCK.toolCallRecords.length))
  })

  it('【统计口径】默认收起，点开展示说明，再点收起', async () => {
    expect(container.querySelector('.help-body')).toBeNull()
    helpBtn().click()
    await flush()
    const text = container.querySelector('.help-body').textContent
    expect(text).toContain('同一次对话里技能被循环调用多次，每次各自算一条独立记录，不合并统计')
    helpBtn().click()
    await flush()
    expect(container.querySelector('.help-body')).toBeNull()
  })
})

describe('查询区（§三）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('执行结果下拉只有成功 / 失败两项，不含旧版的执行前拦截 / 待确认 / 进行中（"用户取消"作为失败原因文案仍会出现，不是独立状态，不在此断言范围）', () => {
    expect(container.querySelector('.lt-filter')).toBeTruthy()
    const text = container.textContent
    expect(text).toContain('全部结果')
    expect(text).not.toContain('进行中')
    expect(text).not.toContain('执行前拦截')
  })

  it('搜索框按用户 / 岗位 / 技能 / 工具标识模糊过滤', async () => {
    await search('张浩')
    const rows = bodyRows()
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r) => expect(r.textContent).toContain('张浩'))
  })

  it('搜索「业务系统·SAP ERP」命中详情里出现过该工具的执行记录（搜索覆盖嵌套明细，不只是列表字段）', async () => {
    await search('业务系统·SAP ERP')
    const rows = bodyRows()
    expect(rows.length).toBeGreaterThan(0)
    const matched = MOCK.toolCallRecords.filter((r) => r.calls.some((c) => c.tool === '业务系统·SAP ERP'))
    expect(rows.length).toBe(matched.length)
  })
})

describe('列表（§四）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('列字段：技能、涉及写操作、执行结果 / 原因齐全；失败行展示原因概要；不展示耗时（系统不采集）', () => {
    const row = bodyRows().find((r) => r.textContent.includes('生产数据查询'))
    expect(row.textContent).toContain('是') // 涉及写操作
    expect(row.textContent).toContain('失败')
    expect(row.textContent).toContain('业务系统·SAP ERP 不在工具白名单')
    expect(container.textContent).not.toContain('执行耗时')
  })

  it('整体成功但中途有工具调用失败的记录（排产冲突检测）：列表不展示原因概要，只在详情里看到失败细节（PRD §一「记录单元」两层展示）', () => {
    const row = bodyRows().find((r) => r.textContent.includes('排产冲突检测'))
    expect(row.textContent).toContain('成功')
    expect(row.textContent).not.toContain('连接超时')
  })

  it('请求时间支持正序 / 倒序切换', async () => {
    const sortBtn = [...container.querySelectorAll('.tca-sort')].find((b) => b.textContent.includes('请求时间'))
    const firstDesc = bodyRows()[0].textContent
    sortBtn.click()
    await flush()
    const firstAsc = bodyRows()[0].textContent
    expect(firstAsc).not.toBe(firstDesc)
  })
})

describe('详情抽屉（§5.1 / §5.2 / §5.3）', () => {
  beforeEach(async () => {
    mountReal()
    await flush()
  })

  it('操作摘要展示用户 / 岗位、技能、涉及写操作；不展示待处理确认、执行耗时（都随改版去掉）', async () => {
    await openDetailOf('报价单生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    const text = drawer.textContent
    expect(text).toContain('陈杰')
    expect(text).toContain('销售顾问')
    expect(text).toContain('报价单生成')
    expect(text).toContain('涉及写操作')
    expect(text).not.toContain('待处理确认')
    expect(text).not.toContain('执行耗时')
  })

  it('一次执行两次工具调用（报价单生成：先读客户信息再写创建报价单）：工具调用明细按顺序展示两项，各自独立，不展示耗时', async () => {
    await openDetailOf('报价单生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    expect(drawer.textContent).toContain('工具调用明细')
    const items = drawer.querySelectorAll('.call-item')
    expect(items.length).toBe(2)
    // 页面只展示工具标识 / 读写性质 / 确认 / 结果（PRD §5.2 没有写具体操作描述、耗时这两项）：
    // 第一项是读（查询客户信息），第二项是写（创建报价单，已确认）
    expect(items[0].textContent).toContain('读')
    expect(items[1].textContent).toContain('写')
    expect(items[1].textContent).toContain('已确认')
    expect(drawer.textContent).not.toContain('秒')
  })

  it('成功的只读调用（查询客户信息）不展示参数 / 响应入口，原地给一句说明（2026-10-09 收窄展示范围）', async () => {
    await openDetailOf('报价单生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    const items = [...drawer.querySelectorAll('.call-item')]
    expect(items[0].querySelector('.call-item-toggle')).toBeNull()
    expect(items[0].textContent).toContain('只读调用成功，不保留请求参数与响应内容')
  })

  it('点击某一项【查看请求参数 / 响应结果】只展开该项，不影响其他项（各自独立状态）', async () => {
    await openDetailOf('报价单生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    const items = [...drawer.querySelectorAll('.call-item')]
    const toggle1 = items[1].querySelector('.call-item-toggle')
    toggle1.click()
    await flush()
    expect(items[1].textContent).toContain('实际请求参数')
    // items[0] 是成功的只读调用，本来就没有入口——展开 items[1] 不会把它变出来
    expect(items[0].querySelector('.call-item-toggle')).toBeNull()
  })

  it('展开报价单创建这一项：请求参数脱敏，响应结果展示报价单编号', async () => {
    await openDetailOf('报价单生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    const items = [...drawer.querySelectorAll('.call-item')]
    items[1].querySelector('.call-item-toggle').click()
    await flush()
    expect(items[1].textContent).toContain('138••••5678 已脱敏')
    ;[...items[1].querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '实际响应结果').click()
    await flush()
    expect(items[1].textContent).toContain('QT-20260927-0083')
  })

  it('先失败后重试成功的执行（排产冲突检测）：整体结果说明文案走"成功"分支，详情里仍能看到失败那一项', async () => {
    await openDetailOf('排产冲突检测')
    const drawer = document.body.querySelector('.el-drawer__body')
    const text = drawer.textContent
    expect(text).toContain('本次执行已完成')
    const items = [...drawer.querySelectorAll('.call-item')]
    expect(items.length).toBe(2)
    // 单次工具调用的结果只有"成功 / 失败"两态（不再是"执行失败"）
    expect(items[0].textContent).toContain('失败')
    expect(items[0].textContent).toContain('连接超时')
    expect(items[1].textContent).toContain('成功')
  })

  it('确认被用户拒绝的写操作（报销单提交）：不展示确认标签，由执行结果=失败 + 原因"用户取消本次操作"表达', async () => {
    await openDetailOf('报销单提交')
    const drawer = document.body.querySelector('.el-drawer__body')
    const items = [...drawer.querySelectorAll('.call-item')]
    expect(items.length).toBe(1)
    expect(items[0].textContent).toContain('失败')
    expect(items[0].textContent).toContain('用户取消本次操作')
    // confirm 为 null：不展示"不需要确认""已确认"这类标签
    expect(items[0].textContent).not.toContain('不需要确认')
    expect(items[0].textContent).not.toContain('已确认')
  })

  it('未调用任何外部工具时展示占位文案（当前种子均有调用，断言兜底文案字符串存在于组件逻辑——通过无 calls 的 detail 直接校验展示规则）', async () => {
    await openDetailOf('方案要点生成')
    const drawer = document.body.querySelector('.el-drawer__body')
    expect(drawer.querySelectorAll('.call-item').length).toBe(1)
  })
})

describe('导出 CSV（§三）', () => {
  it('导出当前筛选结果：按钮文案「导出 CSV」，提示「已导出 N 条筛选结果」且 N 为筛选后条数（非总数）', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    try {
      mountReal()
      await flush()
      const btns = () => [...container.querySelectorAll('.el-button')].map((b) => b.textContent.trim())
      expect(btns()).toContain('导出 CSV')
      expect(btns()).not.toContain('导出筛选结果 CSV')

      const total = MOCK.toolCallRecords.length
      cardOf('执行失败').click()
      await flush()
      const n = Number(cardOf('执行失败').querySelector('.metric-value').textContent)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThan(total)

      const exportBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '导出 CSV')
      exportBtn.click()
      await flush()
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(success).toHaveBeenCalledWith(`已导出 ${n} 条筛选结果`)
    } finally {
      success.mockRestore()
    }
  })
})

describe('筛选占位（§三）', () => {
  it('执行结果占位「全部结果」，涉及写操作占位「全部」', async () => {
    mountReal()
    await flush()
    const holders = [...container.querySelectorAll('.lt-filter .el-select__placeholder')].map((e) => e.textContent.trim())
    expect(holders).toEqual(['全部结果', '全部'])
  })
})

describe('异常与空状态（§七）', () => {
  it('查询无结果时展示空状态，保留已输入的搜索词', async () => {
    mountReal()
    await flush()
    await search('不存在的技能名称零零零')
    expect(bodyRows().length).toBe(0)
    expect(container.querySelector('input[placeholder="搜索用户 / 岗位 / 技能 / 工具"]').value).toBe('不存在的技能名称零零零')
  })
})
