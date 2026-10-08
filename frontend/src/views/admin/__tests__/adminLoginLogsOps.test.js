// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminLoginLogs.vue「管理端操作」页签单测（2026-09-20 新增，版本管理接入访问审计）。
 * 对齐 docs/PRD/数字员工管理端PRD/05治理/访问审计/prd.访问审计.md：
 * - §6.1 模块筛选选项含「版本管理」；
 * - §6.2 变更内容（发布记录展示更新说明，停用为空显示「—」）、操作对象（版本管理为「终端 + 版本号」，
 *   不附灰色版本号小标签；岗位 / 专家 / 技能仍附）；
 * - §6.3 【查看】跳转「版本管理页」并注入操作对象名称作关键词；
 * - §6.4 模块标签「版本管理」灰色、动作「发布」绿 / 「停用」橙。
 *
 * 2026-09-23 补运行规格记录（见 prd.访问审计.md §6「运行规格记录」）：只记「个人配置」一类动作，
 * 规格删除不记（是否记审计留待与其余模块统一规则，本轮不单独收窄到运行规格）：
 * - §6.1 模块筛选选项含「运行规格」；
 * - §6.2 变更内容记录「为 N 个用户配置规格「规格名称」」，操作对象为规格名称，不附版本号小标签；
 * - §6.3 【查看】跳转「运行规格列表页」并注入规格名称作关键词；
 * - §6.4 模块标签「运行规格」灰色、动作「个人配置」绿。
 *
 * 2026-10-08 对齐 prd.访问审计.md §五（用户端文件下载页签，此前零用例）与 §二 / §三（页签条件独立、日期跨度 30 天）：
 * - §5.1 占位「搜索文件名 / 用户名」；下载结果、产物来源下拉切换即刷新；【导出 CSV】提示「CSV 导出已开始，请稍候…」；
 * - §5.2 成功绿标签 / 失败红标签带具体原因；产物来源灰标签；默认下载时间倒序，列头箭头 ↓ / ↑ 切换；
 * - §三 点选起始日后距其超 30 天的日期置灰、两端选定后解除；各页签时间范围独立；§二 切页签各页签查询条件独立。
 *   日期面板不真点（jsdom 下面板定位不稳），改读真 ElDatePicker 收到的 disabled-date 函数并经其 calendar-change 回调驱动。
 * - 疑似缺陷（it.fails 钉桩）：§5.1 两个下拉的「全部」项文案、§5.2 列头「下载时间」「用户」、§5.2 动态分页。
 *
 * 真实挂载（真 Element Plus 标签页 / 表格 / 下拉），只 mock 数据层。记录时间取「今天」，
 * 避免被页面默认的「近 90 天」时间范围滤掉。「登录访问」页签的用例见 adminLoginLogs.test.js。
 */

vi.mock('@/api/loginLog', () => ({ listLoginLogs: () => Promise.resolve({ list: [], total: 0 }) }))
vi.mock('@/api/accessAuditMock', () => {
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return {
    // 2026-10-08：「用户端文件下载」页签用例的夹具（时间同取今天；三条时间互不相同，便于断排序）
    dlRecords: [
      { id: 11, time: `${day} 08:30`, user: '刘敏', filename: '岗位说明.docx', channel: 'Windows', source: '会话产物', result: 'SUCCESS' },
      { id: 12, time: `${day} 10:30`, user: '吴强', filename: '财税手册.pdf', channel: 'Mac', source: '知识库·我的资料', result: 'FAILED', failReason: '磁盘空间不足（CS端）' },
      { id: 13, time: `${day} 09:30`, user: '张浩', filename: '竞品资料.pdf', channel: 'Mac', source: '知识库·本地产物', result: 'SUCCESS' }
    ],
    opsRecords: [
      { id: 1, time: `${day} 09:00`, operator: 'zhang.wei', module: '岗位', action: '发布', target: '销售顾问', version: 'v1.4.2', detail: 'v1.4.2 正式发布上线' },
      { id: 2, time: `${day} 10:00`, operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.2.0', detail: '1. 新增记忆管理\n2. 修复若干问题' },
      { id: 3, time: `${day} 11:00`, operator: 'xiaomei', module: '版本管理', action: '停用', target: 'Windows v1.2.0', detail: '' },
      { id: 4, time: `${day} 12:00`, operator: 'demo', module: '运行规格', action: '个人配置', target: '标准', detail: '为 2 个用户配置规格「标准」' }
    ]
  }
})

const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default

let mounted
let router
const pane = () => mounted.container.querySelector('#pane-admin-ops')
const rows = () => [...pane().querySelectorAll('.el-table__body tr')]
const rowOf = (target, action) => rows().find((tr) => tr.textContent.includes(target) && tr.querySelector('.aa-tag:nth-of-type(1)') && [...tr.querySelectorAll('.aa-tag')].some((t) => t.textContent.trim() === action))
const tags = (tr) => [...tr.querySelectorAll('.aa-tag')]
// 列序：时间 / 操作人 / 模块 / 动作 / 变更内容 / 操作对象 / 操作（变更内容 = 第 5 格）
const detailCell = (tr) => tr.querySelectorAll('td')[4]
const tagOf = (tr, text) => tags(tr).find((t) => t.textContent.trim() === text)

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login-logs', name: 'AdminLoginLogs', component: { template: '<div />' } },
      { path: '/admin/versions', name: 'AdminVersions', component: { template: '<div />' } },
      { path: '/admin/positions', name: 'AdminPositions', component: { template: '<div />' } },
      { path: '/admin/runtime-specs', name: 'AdminRuntimeSpecs', component: { template: '<div />' } }
    ]
  })
  await router.push('/admin/login-logs')
  await router.isReady()
  mounted = mountReal(AdminLoginLogs, {}, { plugins: [router] })
  await flushAll(12)
})
/** 切页签（按页签文字）。 */
async function switchTab(label) {
  const tab = [...mounted.container.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.trim() === label)
  tab.click()
  await flushAll(6)
}
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('访问审计 · 管理端操作 · 版本管理记录', () => {
  beforeEach(() => switchTab('管理端操作'))
  it('四条记录都在默认时间范围内展示', () => {
    expect(rows()).toHaveLength(4)
  })

  it('模块标签：版本管理灰色（§6.4）；动作标签：发布绿、停用橙', () => {
    const publish = rowOf('Windows v1.2.0', '发布')
    const stop = rowOf('Windows v1.2.0', '停用')
    expect(tagOf(publish, '版本管理').className).toContain('tag-gray')
    expect(tagOf(publish, '发布').className).toContain('tag-green')
    expect(tagOf(stop, '版本管理').className).toContain('tag-gray')
    expect(tagOf(stop, '停用').className).toContain('tag-orange')
  })

  it('操作人显示登录用户名；操作对象为「终端 + 版本号」，不附灰色版本号小标签（岗位等仍附）（§6.2）', () => {
    const publish = rowOf('Windows v1.2.0', '发布')
    expect(publish.textContent).toContain('xiaomei')
    expect(publish.querySelector('.ops-target-name').textContent).toBe('Windows v1.2.0')
    expect(publish.querySelector('.ops-version')).toBeNull()
    const position = rowOf('销售顾问', '发布')
    expect(position.querySelector('.ops-version').textContent).toBe('v1.4.2')
  })

  it('变更内容：发布记录展示更新说明，停用记录为空显示「—」（§6.2）', () => {
    const publish = rowOf('Windows v1.2.0', '发布')
    const stop = rowOf('Windows v1.2.0', '停用')
    expect(publish.textContent).toContain('1. 新增记忆管理')
    expect(publish.textContent).toContain('2. 修复若干问题')
    expect(detailCell(stop).textContent.trim()).toBe('—')
  })

  it('模块筛选含「版本管理」，选中后只剩版本管理记录（§6.1）', async () => {
    const select = pane().querySelectorAll('.lt-filter')[0] // 第一个下拉 = 模块
    select.querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const items = [...document.body.querySelectorAll('.el-select-dropdown__item')]
    expect(items.map((i) => i.textContent.trim())).toContain('版本管理')
    items.find((i) => i.textContent.trim() === '版本管理').click()
    await flushAll(4)
    expect(rows()).toHaveLength(2)
    expect(rows().every((tr) => tr.textContent.includes('Windows v1.2.0'))).toBe(true)
  })

  it('搜索框按操作人用户名匹配（§6.1）', async () => {
    const input = pane().querySelector('.lt-search input')
    input.value = 'xiaomei'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    expect(rows()).toHaveLength(2)
  })

  it('【查看】跳转到版本管理页，并把操作对象名称作为关键词带过去（§6.3）', async () => {
    const publish = rowOf('Windows v1.2.0', '发布')
    ;[...publish.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminVersions'))
    expect(router.currentRoute.value.query.keyword).toBe('Windows v1.2.0')
  })

  it('其它模块的【查看】跳转不受影响（岗位 → 岗位列表页，带对象名）', async () => {
    const position = rowOf('销售顾问', '发布')
    ;[...position.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminPositions'))
    expect(router.currentRoute.value.query.keyword).toBe('销售顾问')
  })
})

describe('访问审计 · 管理端操作 · 运行规格记录（2026-09-23）', () => {
  beforeEach(() => switchTab('管理端操作'))
  it('模块标签：运行规格灰色（§6.4）；动作标签：个人配置绿', () => {
    const assign = rowOf('标准', '个人配置')
    expect(tagOf(assign, '运行规格').className).toContain('tag-gray')
    expect(tagOf(assign, '个人配置').className).toContain('tag-green')
  })

  it('操作对象为规格名称，不附版本号小标签（§6.2）', () => {
    const assign = rowOf('标准', '个人配置')
    expect(assign.querySelector('.ops-target-name').textContent).toBe('标准')
    expect(assign.querySelector('.ops-version')).toBeNull()
  })

  it('变更内容：个人配置记录「为 N 个用户配置规格「规格名称」」（§6.2）', () => {
    const assign = rowOf('标准', '个人配置')
    expect(assign.textContent).toContain('为 2 个用户配置规格「标准」')
  })

  it('模块筛选含「运行规格」，选中后只剩运行规格记录（§6.1）', async () => {
    const select = pane().querySelectorAll('.lt-filter')[0]
    select.querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const items = [...document.body.querySelectorAll('.el-select-dropdown__item')]
    expect(items.map((i) => i.textContent.trim())).toContain('运行规格')
    items.find((i) => i.textContent.trim() === '运行规格').click()
    await flushAll(4)
    expect(rows()).toHaveLength(1)
    expect(rows().every((tr) => tr.textContent.includes('demo'))).toBe(true)
  })

  it('【查看】跳转到运行规格列表页，并把规格名称作为关键词带过去（§6.3）', async () => {
    const assign = rowOf('标准', '个人配置')
    ;[...assign.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminRuntimeSpecs'))
    expect(router.currentRoute.value.query.keyword).toBe('标准')
  })
})

/* ======================================================================================
 * 用户端文件下载（2026-10-08 /test-audit 补缺口，prd.访问审计.md §五）
 * ====================================================================================== */
const dlPane = () => mounted.container.querySelector('#pane-download')
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
  beforeEach(() => switchTab('用户端文件下载'))

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

  it.fails('下载结果下拉的「全部」项文案为「全部结果」（疑似缺陷：页面占位为「全部下载结果」；md 访问审计 §5.1「下拉，全部结果 / 成功 / 失败」）', () => {
    expect(dlPane().querySelectorAll('.lt-filter')[0].textContent).toContain('全部结果')
  })

  it.fails('产物来源下拉的「全部」项文案为「全部来源」（疑似缺陷：页面占位为「全部产物来源」；md 访问审计 §5.1「下拉，全部来源 / 会话产物 / …」）', () => {
    expect(dlPane().querySelectorAll('.lt-filter')[1].textContent).toContain('全部来源')
  })
})

describe('访问审计 · 用户端文件下载 · 列表（§5.2）', () => {
  beforeEach(() => switchTab('用户端文件下载'))
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

  it.fails('列头为「下载时间」「用户」（疑似缺陷：页面列头为「时间」「用户名」；md 访问审计 §5.2 字段表「下载时间」「用户」）', () => {
    const heads = [...dlPane().querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim())
    expect(heads[0]).toContain('下载时间')
    expect(heads[1]).toBe('用户')
  })

  it.fails('有记录时出分页条（疑似缺陷：页签内无分页控件，全部记录一屏平铺；md 访问审计 §5.2「列表根据页面高度动态分页」、§5.1【查询】「回到第 1 页」）', () => {
    expect(dlPane().querySelector('.list-pager')).not.toBeNull()
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
const pickers = () => findComps(mounted.app._instance.subTree, 'ElDatePicker')
const day = (base, offset) => {
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d
}

describe('访问审计 · 时间范围跨度最多 30 天（§三）', () => {
  const BASE = new Date(2026, 8, 15) // 2026-09-15，作为「点选的起始日」
  /** 模拟在日期面板上点选（真 ElDatePicker 的 calendar-change 回调）。
   *  注意：当前页面里这个回调本身会抛 TypeError（模板把 ref 解包成 null 后又去写 .value，见下方 it.fails 说明），
   *  这里吞掉异常只为让失败落在「是否置灰」这条用户可见的断言上。 */
  const pickDays = async (p, val) => {
    try {
      p.vnode.props.onCalendarChange(val)
    } catch {
      /* 见上 */
    }
    await flushAll(2)
  }

  it('三个页签各有一个日期区间选择器，且都接了「禁选日期」规则', () => {
    expect(pickers()).toHaveLength(3)
    for (const p of pickers()) expect(typeof p.props.disabledDate).toBe('function')
  })

  it('还没点选起始日时 → 不置灰任何日期', () => {
    for (const p of pickers()) expect(p.props.disabledDate(day(BASE, 200))).toBe(false)
  })

  it('两端日期都选定后 → 不置灰（约束解除）', async () => {
    const p = () => pickers()[1]
    await pickDays(p(), [BASE, day(BASE, 10)])
    expect(p().props.disabledDate(day(BASE, 60))).toBe(false)
  })

  it.fails('点选起始日后 → 距其超过 30 天的日期置灰（疑似缺陷：三个页签的 @calendar-change 都写成 onCalendarChange(xxxPickFirst, v)，模板里 ref 已被解包成 null，回调写 null.value 直接抛 TypeError，起始日没记下，超 30 天的日期始终可点；md 访问审计 §三「点选起始日期后……超过 30 天的日期自动置灰、不可点击」）', async () => {
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
    await switchTab('用户端文件下载')
    const input = dlPane().querySelector('.lt-search input')
    input.value = '吴强'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    await switchTab('管理端操作')
    expect(pane().querySelector('.lt-search input').value).toBe('')
    expect(rows()).toHaveLength(4)
    await switchTab('用户端文件下载')
    expect(dlPane().querySelector('.lt-search input').value).toBe('吴强')
    expect(dlRows()).toHaveLength(1)
  })

  it('改了下载页签的时间范围 → 管理端操作页签的时间范围不变', async () => {
    const before = pickers()[2].props.modelValue
    pickers()[1].vnode.props['onUpdate:modelValue']([new Date(2026, 0, 1), new Date(2026, 0, 10)])
    await flushAll(4)
    expect(dlRows()).toHaveLength(0) // 下载页签按新范围立即过滤（夹具全是今天）
    expect(pickers()[2].props.modelValue).toBe(before)
    await switchTab('管理端操作')
    expect(rows()).toHaveLength(4)
  })
})
