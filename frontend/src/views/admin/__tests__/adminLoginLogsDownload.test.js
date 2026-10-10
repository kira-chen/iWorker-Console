// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushAll } from './helpers/smokeMount'
import { createLoginLogsHarness } from './helpers/loginLogsHarness'

/**
 * AdminLoginLogs.vue「用户端文件下载」页签 + 时间范围 30 天跨度 + 页签条件独立 单测。
 *
 * 【主题】访问审计页里与管理端操作各块无关的三组：用户端文件下载（查询区 / 列表 / 分页）、
 * 时间范围跨度最多 30 天（§三）、切换页签各页签查询条件独立（§二 / §三）。
 * 【来源】2026-10-10 测试审计 J45 自 adminLoginLogsOps.test.js 拆出（原文件名只提 Ops，名实不符）；
 * 管理端操作各块留在 adminLoginLogsOps.test.js，「登录访问」页签见 adminLoginLogs.test.js。
 *
 * 对齐 prd.访问审计.md（2026-10-08 /test-audit 补缺口，此前零用例）：
 * - §5.1 占位「搜索文件名 / 用户名」；下载结果、产物来源下拉切换即刷新；【导出 CSV】提示「CSV 导出已开始，请稍候…」；两个下拉的「全部」项文案（#64④ 已修转正）；
 * - §5.2 成功绿标签 / 失败红标签带具体原因；产物来源灰标签；默认下载时间倒序，列头箭头 ↓ / ↑ 切换；列表根据页面高度动态分页
 *   （多于一页时切片 + 总数 + 翻页 + 改筛选 / 排序回第 1 页；列头、动态分页与 §三 30 天跨度已由 #73 修复转正）；
 * - §三 点选起始日后距其超 30 天的日期置灰、两端选定后解除；各页签时间范围独立；§二 切页签各页签查询条件独立。
 *   日期面板不真点（jsdom 下面板定位不稳），改读真 ElDatePicker 收到的 disabled-date 函数并经其 calendar-change 回调驱动。
 *
 * 真实挂载（真 Element Plus），只 mock 数据层，夹具与挂载流程见 helpers/loginLogsHarness.js。
 * 分页用例经 remountAtHeight(768) 以每页 7 条重新挂载，追加记录凑出多于一页。
 */

vi.mock('@/api/loginLog', () => ({ listLoginLogs: () => Promise.resolve({ list: [], total: 0 }) }))
vi.mock('@/api/accessAuditMock', async () => (await import('./helpers/loginLogsHarness')).makeAccessAuditFixture())

const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default
const h = createLoginLogsHarness(AdminLoginLogs)

// 页签独立用例里要读「管理端操作」页签的行
const pane = () => h.mounted.container.querySelector('#pane-admin-ops')
const rows = () => [...pane().querySelectorAll('.el-table__body tr')]

/* ======================================================================================
 * 用户端文件下载（2026-10-08 /test-audit 补缺口，prd.访问审计.md §五）
 * ====================================================================================== */
const dlPane = () => h.mounted.container.querySelector('#pane-download')
const dlRows = () => [...dlPane().querySelectorAll('.el-table__body tr')]
const dlRowOf = (filename) => dlRows().find((tr) => tr.textContent.includes(filename))
/** 打开某个下拉并点选某项（下拉项挂在 body 上，按文案找）。 */
async function pickOption(selectEl, label) {
  selectEl.querySelector('.el-select__wrapper').click()
  await flushAll(4)
  const item = [...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => i.textContent.trim() === label)
  item.click()
  await flushAll(4)
}

describe('访问审计 · 用户端文件下载 · 查询区（§5.1）', () => {
  beforeEach(() => h.switchTab('用户端文件下载'))

  it('搜索框占位为「搜索文件名 / 用户名」', () => {
    expect(dlPane().querySelector('.lt-search input').getAttribute('placeholder')).toBe('搜索文件名 / 用户名')
  })

  it('搜索框按用户名匹配 → 只剩该用户的下载记录', async () => {
    const input = dlPane().querySelector('.lt-search input')
    input.value = '吴强'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    expect(dlRows()).toHaveLength(1)
    expect(dlRows()[0].textContent).toContain('财税手册.pdf')
  })

  it('下载结果选「失败」→ 列表立即只剩失败记录，不用点【查询】', async () => {
    expect(dlRows()).toHaveLength(3)
    await pickOption(dlPane().querySelectorAll('.lt-filter')[0], '失败')
    expect(dlRows()).toHaveLength(1)
    expect(dlRows()[0].textContent).toContain('财税手册.pdf')
  })

  it('产物来源选「知识库·本地产物」→ 列表立即只剩该来源的记录', async () => {
    await pickOption(dlPane().querySelectorAll('.lt-filter')[1], '知识库·本地产物')
    expect(dlRows()).toHaveLength(1)
    expect(dlRows()[0].textContent).toContain('竞品资料.pdf')
  })

  it('点【导出 CSV】→ 提示「CSV 导出已开始，请稍候…」', async () => {
    const btn = [...dlPane().querySelectorAll('button')].find((b) => b.textContent.trim() === '导出 CSV')
    btn.click()
    await flushAll(4)
    await vi.waitFor(() => expect(document.body.querySelector('.el-message')?.textContent).toContain('CSV 导出已开始，请稍候…'))
  })

  it('下载结果下拉的「全部」项文案为「全部结果」（md 访问审计 §5.1「下拉，全部结果 / 成功 / 失败」）', () => {
    expect(dlPane().querySelectorAll('.lt-filter')[0].textContent).toContain('全部结果')
  })

  it('产物来源下拉的「全部」项文案为「全部来源」（md 访问审计 §5.1「下拉，全部来源 / 会话产物 / …」）', () => {
    expect(dlPane().querySelectorAll('.lt-filter')[1].textContent).toContain('全部来源')
  })
})

describe('访问审计 · 用户端文件下载 · 列表（§5.2）', () => {
  beforeEach(() => h.switchTab('用户端文件下载'))
  const times = () => dlRows().map((tr) => tr.querySelectorAll('td')[0].textContent.trim().slice(-5))
  const arrow = () => dlPane().querySelector('.ll-sort-arrow').textContent.trim()

  it('成功记录 → 绿色「成功」标签', () => {
    const tag = [...dlRowOf('岗位说明.docx').querySelectorAll('.aa-tag')].find((t) => t.textContent.trim() === '成功')
    expect(tag.className).toContain('tag-green')
  })

  it('失败记录 → 红色标签，并写明具体原因', () => {
    const tag = [...dlRowOf('财税手册.pdf').querySelectorAll('.aa-tag')].find((t) => t.textContent.includes('磁盘空间不足'))
    expect(tag.textContent.trim()).toBe('磁盘空间不足（CS端）')
    expect(tag.className).toContain('tag-red')
  })

  it('产物来源以灰色标签展示', () => {
    const tag = [...dlRowOf('岗位说明.docx').querySelectorAll('.aa-tag')].find((t) => t.textContent.trim() === '会话产物')
    expect(tag.className).toContain('tag-gray')
  })

  it('默认按下载时间倒序，列头箭头为 ↓', () => {
    expect(times()).toEqual(['10:30', '09:30', '08:30'])
    expect(arrow()).toBe('↓')
  })

  it('点时间列头 → 改为正序、箭头变 ↑；再点 → 回到倒序、箭头变 ↓', async () => {
    dlPane().querySelector('.ll-sort').click()
    await flushAll(4)
    expect(times()).toEqual(['08:30', '09:30', '10:30'])
    expect(arrow()).toBe('↑')
    dlPane().querySelector('.ll-sort').click()
    await flushAll(4)
    expect(times()).toEqual(['10:30', '09:30', '08:30'])
    expect(arrow()).toBe('↓')
  })

  it('列头为「下载时间」「用户」（md 访问审计 §5.2 字段表；待办 yuepu#73② 已修）', () => {
    const heads = [...dlPane().querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim())
    expect(heads[0]).toContain('下载时间')
    expect(heads[1]).toBe('用户')
  })

  it('有记录时出分页条（md 访问审计 §5.2「列表根据页面高度动态分页」；待办 yuepu#73③ 已修）', () => {
    expect(dlPane().querySelector('.list-pager')).not.toBeNull()
  })
})

describe('访问审计 · 用户端文件下载 · 分页（§5.2「列表根据页面高度动态分页」）', () => {
  // 夹具 3 条 + 追加 6 条 = 9 条，必须多于 jsdom 窗口算出的每页条数（768 高 → 7 条），才能验证真切片
  const EXTRA = 6
  const added = []
  const pager = () => dlPane().querySelector('.list-pager')
  const pageBtns = () => [...dlPane().querySelectorAll('.list-pager .page-btn')]
  const activePage = () => dlPane().querySelector('.list-pager .page-btn.active').textContent.trim()
  const goPage = async (n) => {
    pageBtns().find((b) => b.textContent.trim() === String(n)).click()
    await flushAll(4)
  }
  const sortHead = () => dlPane().querySelector('.ll-sort')
  /** 追加的记录写进共享夹具后，点两次时间列头（正序再倒序）触发一次重新取数，回到第 1 页倒序。 */
  const reloadDl = async () => {
    sortHead().click()
    await flushAll(4)
    sortHead().click()
    await flushAll(4)
  }
  const pageSize = () => Number(dlPane().querySelector('.list-pager .page-size').value)

  beforeEach(async () => {
    await h.remountAtHeight(768) // 每页 7 条
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    const { dlRecords } = await import('@/api/accessAuditMock')
    for (let i = 1; i <= EXTRA; i++) {
      const rec = { id: 200 + i, time: `${day} 0${i}:00`, user: `用户${i}`, filename: `追加文件${i}.pdf`, channel: 'Windows', source: '会话产物', result: 'SUCCESS' }
      dlRecords.push(rec)
      added.push(rec)
    }
    await h.switchTab('用户端文件下载')
    await reloadDl()
  })
  afterEach(async () => {
    const { dlRecords } = await import('@/api/accessAuditMock')
    for (const rec of added.splice(0)) dlRecords.splice(dlRecords.indexOf(rec), 1)
  })

  it('记录多于一页 → 首页只出一页的行数，分页条写明「共 9 条数据」', () => {
    expect(pageSize()).toBeLessThan(9) // 前提：每页条数小于总数，否则下面的切片断言没意义
    expect(dlRows()).toHaveLength(pageSize())
    expect(pager().textContent).toContain('共 9 条数据')
  })

  it('点第 2 页 → 出剩余的记录，首页的最新一条不再出现', async () => {
    const firstPageFirst = dlRows()[0].textContent
    await goPage(2)
    expect(dlRows()).toHaveLength(9 - pageSize())
    expect(dlRows().some((tr) => tr.textContent === firstPageFirst)).toBe(false)
    expect(activePage()).toBe('2')
  })

  it('停在第 2 页时切换排序 → 回到第 1 页', async () => {
    await goPage(2)
    sortHead().click()
    await flushAll(4)
    expect(activePage()).toBe('1')
    expect(dlRows()).toHaveLength(pageSize())
  })

  it('停在第 2 页时点【查询】→ 回到第 1 页，列表仍是全部记录（md §5.1(5)；yuepu#84）', async () => {
    await goPage(2)
    expect(activePage()).toBe('2')
    const btn = [...dlPane().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查询')
    btn.click()
    await flushAll(4)
    expect(activePage()).toBe('1')
    expect(dlRows()).toHaveLength(pageSize())
  })

  it('停在第 2 页时输入搜索关键词 → 回到第 1 页，只剩命中记录', async () => {
    await goPage(2)
    const input = dlPane().querySelector('.lt-search input')
    input.value = '追加文件3'
    input.dispatchEvent(new Event('input'))
    await flushAll(6)
    expect(dlRows()).toHaveLength(1)
    expect(dlRows()[0].textContent).toContain('追加文件3.pdf')
    expect(pager().textContent).toContain('共 1 条数据')
  })
})

/* ======================================================================================
 * 时间范围跨度与页签条件独立（2026-10-08 /test-audit 补缺口，prd.访问审计.md §二 / §三）
 * ====================================================================================== */
/** 递归收集组件树里某名字的组件实例（按渲染顺序：登录访问 / 用户端文件下载 / 管理端操作）。 */
function findComps(vnode, name, out = []) {
  if (!vnode) return out
  if (vnode.component) {
    if (vnode.component.type?.name === name) out.push(vnode.component)
    findComps(vnode.component.subTree, name, out)
  } else if (Array.isArray(vnode.children)) {
    vnode.children.forEach((c) => findComps(c, name, out))
  }
  return out
}
const pickers = () => findComps(h.mounted.app._instance.subTree, 'ElDatePicker')
const day = (base, offset) => {
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d
}

describe('访问审计 · 时间范围跨度最多 30 天（§三）', () => {
  const BASE = new Date(2026, 8, 15) // 2026-09-15，作为「点选的起始日」
  /** 模拟在日期面板上点选（真 ElDatePicker 的 calendar-change 回调）；回调抛错会直接让用例失败。 */
  const pickDays = async (p, val) => {
    p.vnode.props.onCalendarChange(val)
    await flushAll(2)
  }

  it('三个页签各有一个日期区间选择器，且都接了「禁选日期」规则', () => {
    expect(pickers()).toHaveLength(3)
    for (const p of pickers()) expect(typeof p.props.disabledDate).toBe('function')
  })

  it('三个日期区间选择器都不可清空，避免清空后展示 90 天之外的记录（md §三「仅展示当前日期向前 90 天」；yuepu#85）', () => {
    expect(pickers()).toHaveLength(3)
    for (const p of pickers()) expect(p.props.clearable).toBe(false)
  })

  it('还没点选起始日时 → 不置灰任何日期', () => {
    for (const p of pickers()) expect(p.props.disabledDate(day(BASE, 200))).toBe(false)
  })

  it('两端日期都选定后 → 不置灰（约束解除）', async () => {
    const p = () => pickers()[1]
    await pickDays(p(), [BASE, day(BASE, 10)])
    expect(p().props.disabledDate(day(BASE, 60))).toBe(false)
  })

  it('点选起始日后 → 距其超过 30 天的日期置灰（md 访问审计 §三；待办 yuepu#73① 已修）', async () => {
    for (let i = 0; i < 3; i++) {
      await pickDays(pickers()[i], [BASE, null])
      const disabled = pickers()[i].props.disabledDate
      expect(disabled(day(BASE, 30))).toBe(false)
      expect(disabled(day(BASE, 31))).toBe(true)
      expect(disabled(day(BASE, -31))).toBe(true)
    }
  })
})

describe('访问审计 · 切换页签各页签条件独立（§二 / §三）', () => {
  it('下载页签输了关键词、切到管理端操作再切回 → 下载页签关键词仍在，管理端操作搜索框是空的', async () => {
    await h.switchTab('用户端文件下载')
    const input = dlPane().querySelector('.lt-search input')
    input.value = '吴强'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    await h.switchTab('管理端操作')
    expect(pane().querySelector('.lt-search input').value).toBe('')
    expect(rows()).toHaveLength(12)
    await h.switchTab('用户端文件下载')
    expect(dlPane().querySelector('.lt-search input').value).toBe('吴强')
    expect(dlRows()).toHaveLength(1)
  })

  it('改了下载页签的时间范围 → 管理端操作页签的时间范围不变', async () => {
    const before = pickers()[2].props.modelValue
    pickers()[1].vnode.props['onUpdate:modelValue']([new Date(2026, 0, 1), new Date(2026, 0, 10)])
    await flushAll(4)
    expect(dlRows()).toHaveLength(0) // 下载页签按新范围立即过滤（夹具全是今天）
    expect(pickers()[2].props.modelValue).toBe(before)
    await h.switchTab('管理端操作')
    expect(rows()).toHaveLength(12)
  })
})

