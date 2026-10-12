// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushAll } from './helpers/smokeMount'
import { createLoginLogsHarness } from './helpers/loginLogsHarness'

/**
 * AdminLoginLogs.vue「管理端操作」页签单测（2026-09-20 新增，版本管理接入访问审计）。
 *
 * 【主题】管理端操作页签各块：版本管理 / 运行规格 / 岗位分配 / 强制回收 / 用户技能审核 / 存储空间记录，以及该页签的动态分页。
 * 【拆分】2026-10-10 测试审计 J45：原文件同时含「用户端文件下载」「30 天跨度」「页签条件独立」，名实不符，
 * 现拆出 adminLoginLogsDownload.test.js 专管那三块；两文件共用 helpers/loginLogsHarness.js 的夹具与挂载流程。
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
 * 2026-10-09 起列表都是 useAdminList 'client' 分页，每页条数按窗口高度算（useDynPageSize）：
 * 全局挂载把 window.innerHeight 调到 2000（每页 26 条，12 条夹具一页放得下，行数类用例不受分页影响），
 * 分页用例经 remountAtHeight(768) 以每页 7 条重新挂载，追加记录凑出多于一页。
 * 管理端操作页签分页由待办 yuepu#80 补齐（§六「列表根据页面高度动态分页」）。
 *
 * 2026-10-09 补存储空间记录（§6.1 模块 / 动作筛选、§6.2 存储空间记录块、§6.3 跳转带员工名、§6.4 灰色模块标签与绿色「调整容量」）：
 *   调整容量 / 同意扩容 / 拒绝扩容三类都展示（2026-10-10 起，同意 / 拒绝扩容不再隐藏）；夹具共 12 条，全部展示。【查看】：调整容量进容量分配页签，同意 / 拒绝扩容带 tab=request 进扩容申请页签。
 *
 * 2026-09-30 补岗位分配记录（§6.1 / §6.2 / §6.3 / §6.4）；2026-10-09 /test-audit 补：
 * - 强制回收（§6.1 动作筛选完整顺序、§6.4 红色动作标签、技能模块蓝标签与版本号小标签、变更内容 = 回收原因）；
 * - 用户技能审核（§6.4 橙色模块标签、审核通过绿 / 审核驳回红；变更内容驳回写原因、通过为空显示「—」）；
 *
 * 真实挂载（真 Element Plus 标签页 / 表格 / 下拉），只 mock 数据层。记录时间取「今天」，
 * 避免被页面默认的「近 90 天」时间范围滤掉。「登录访问」页签的用例见 adminLoginLogs.test.js，「用户端文件下载」页签见 adminLoginLogsDownload.test.js。
 */

vi.mock('@/api/loginLog', () => ({ listLoginLogs: () => Promise.resolve({ list: [], total: 0 }) }))
vi.mock('@/api/accessAuditMock', async () => (await import('./helpers/loginLogsHarness')).makeAccessAuditFixture())

const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default
const h = createLoginLogsHarness(AdminLoginLogs)

const pane = () => h.mounted.container.querySelector('#pane-admin-ops')
const rows = () => [...pane().querySelectorAll('.el-table__body tr')]
const rowOf = (target, action) => rows().find((tr) => tr.textContent.includes(target) && [...tr.querySelectorAll('.aa-tag')].some((t) => t.textContent.trim() === action))
const tags = (tr) => [...tr.querySelectorAll('.aa-tag')]
// 列序：时间 / 操作人 / 模块 / 动作 / 变更内容 / 操作对象 / 操作（变更内容 = 第 5 格）
const detailCell = (tr) => tr.querySelectorAll('td')[4]
const tagOf = (tr, text) => tags(tr).find((t) => t.textContent.trim() === text)

describe('访问审计 · 管理端操作 · 版本管理记录', () => {
  beforeEach(() => h.switchTab('管理端操作'))
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
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminVersions'))
    expect(h.router.currentRoute.value.query.keyword).toBe('Windows v1.2.0')
  })

  it('其它模块的【查看】跳转不受影响（岗位 → 岗位列表页，带对象名）', async () => {
    const position = rowOf('销售顾问', '发布')
    ;[...position.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminPositions'))
    expect(h.router.currentRoute.value.query.keyword).toBe('销售顾问')
  })
})

describe('访问审计 · 管理端操作 · 运行规格记录（2026-09-23）', () => {
  beforeEach(() => h.switchTab('管理端操作'))
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
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminRuntimeSpecs'))
    expect(h.router.currentRoute.value.query.keyword).toBe('标准')
  })
})

describe('访问审计 · 管理端操作 · 列表列头（§6.2，/prd-import Q13）', () => {
  beforeEach(() => h.switchTab('管理端操作'))

  it('列头：第一列为「操作时间」（带排序箭头 ↓），其后依次操作人 / 模块 / 动作 / 变更内容 / 操作对象 / 操作', () => {
    const heads = [...pane().querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim())
    expect(heads[0]).toBe('操作时间 ↓')
    expect(heads.slice(1)).toEqual(['操作人', '模块', '动作', '变更内容', '操作对象', '操作'])
  })
})

describe('访问审计 · 管理端操作 · 强制回收与用户技能审核记录（2026-10-09 /test-audit 补，§6.1 / §6.2 / §6.4）', () => {
  beforeEach(() => h.switchTab('管理端操作'))
  const openDropdown = async (idx) => {
    pane().querySelectorAll('.lt-filter')[idx].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    return [...document.body.querySelectorAll('.el-select-dropdown__item')].map((i) => i.textContent.trim())
  }

  it('动作筛选完整顺序：发布 / 个人配置 / 分配 / 变更 / 停用 / 强制回收 / 撤回 / 删除 / 审核通过 / 审核驳回 / 同意扩容 / 拒绝扩容 / 调整容量（§6.1，共 13 项）', async () => {
    // 下拉项挂在 body 上，其它页签的下拉也在，故从动作列表的第一项「发布」起取 13 项
    const labels = await openDropdown(1)
    expect(labels.slice(labels.indexOf('发布'), labels.indexOf('发布') + 13)).toEqual(['发布', '个人配置', '分配', '变更', '停用', '强制回收', '撤回', '删除', '审核通过', '审核驳回', '同意扩容', '拒绝扩容', '调整容量'])
  })

  it('模块筛选完整顺序里「存储空间」在「运行规格」之后、「审核中心」之前（§6.1 第 3 条）', async () => {
    const labels = await openDropdown(0)
    const i = labels.indexOf('岗位')
    expect(labels.slice(i, i + 14)).toEqual(['岗位', '岗位分配', '专家', '技能', '知识库', 'MCP', 'API', '业务系统', '模型', '运行规格', '存储空间', '审核中心', '用户技能审核', '版本管理'])
  })

  it('模块筛选含「用户技能审核」', async () => {
    expect(await openDropdown(0)).toContain('用户技能审核')
  })

  it('强制回收：动作标签红色、模块「技能」蓝色；变更内容 = 回收原因；操作对象附版本号小标签 v1.0.0（§6.2 / §6.4）', () => {
    const r = rowOf('财税合规助手', '强制回收')
    expect(tagOf(r, '强制回收').className).toContain('tag-red')
    expect(tagOf(r, '技能').className).toContain('tag-blue')
    expect(detailCell(r).textContent).toContain('存在数据泄露风险')
    expect(r.querySelector('.ops-version').textContent).toBe('v1.0.0')
  })

  it('用户技能审核：模块标签橙色；审核驳回红、审核通过绿（§6.4）', () => {
    const rejected = rowOf('sun.hao / 合同管理助手', '审核驳回')
    const approved = rowOf('wang.fang / 报销助手', '审核通过')
    expect(tagOf(rejected, '用户技能审核').className).toContain('tag-orange')
    expect(tagOf(rejected, '审核驳回').className).toContain('tag-red')
    expect(tagOf(approved, '审核通过').className).toContain('tag-green')
  })

  it('用户技能审核的变更内容：驳回展示驳回原因，通过为空显示「—」；操作对象为「提交人 / 技能名」且不附版本号（§6.2）', () => {
    const rejected = rowOf('sun.hao / 合同管理助手', '审核驳回')
    const approved = rowOf('wang.fang / 报销助手', '审核通过')
    expect(detailCell(rejected).textContent).toContain('岗位与技能权限范围不匹配')
    expect(detailCell(approved).textContent.trim()).toBe('—')
    expect(rejected.querySelector('.ops-target-name').textContent).toBe('sun.hao / 合同管理助手')
    expect(rejected.querySelector('.ops-version')).toBeNull()
  })

  it('动作筛选选「强制回收」→ 只剩强制回收记录', async () => {
    pane().querySelectorAll('.lt-filter')[1].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    ;[...document.body.querySelectorAll('.el-select-dropdown__item')].find((i) => i.textContent.trim() === '强制回收').click()
    await flushAll(4)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('财税合规助手')
  })
})

describe('访问审计 · 管理端操作 · 岗位分配记录（2026-09-30，§6.1 / §6.2 / §6.3 / §6.4）', () => {
  const openDropdown = async (idx) => {
    pane().querySelectorAll('.lt-filter')[idx].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    return [...document.body.querySelectorAll('.el-select-dropdown__item')]
  }

  it('模块筛选含「岗位分配」且紧跟「岗位」之后；选中后只剩岗位分配记录', async () => {
    const items = await openDropdown(0)
    const labels = items.map((i) => i.textContent.trim())
    expect(labels.indexOf('岗位分配')).toBe(labels.indexOf('岗位') + 1)
    items.find((i) => i.textContent.trim() === '岗位分配').click()
    await flushAll(4)
    expect(rows()).toHaveLength(2)
  })

  it('动作筛选含「分配」「变更」，位置在「个人配置」之后、「停用」之前；选「变更」只剩一条', async () => {
    const items = await openDropdown(1)
    const labels = items.map((i) => i.textContent.trim())
    expect(labels.slice(labels.indexOf('个人配置'), labels.indexOf('停用') + 1)).toEqual(['个人配置', '分配', '变更', '停用'])
    items.find((i) => i.textContent.trim() === '变更').click()
    await flushAll(4)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('li.na')
  })

  it('标签颜色：模块「岗位分配」绿；动作「分配」「变更」绿', () => {
    const a = rowOf('chenyu', '分配')
    const c = rowOf('li.na', '变更')
    expect(tagOf(a, '岗位分配').className).toContain('tag-green')
    expect(tagOf(a, '分配').className).toContain('tag-green')
    expect(tagOf(c, '变更').className).toContain('tag-green')
  })

  it('变更内容展示「原岗位 → 新岗位」；操作对象为用户名，不附版本号小标签', () => {
    const a = rowOf('chenyu', '分配')
    expect(detailCell(a).textContent).toContain('未绑定 → 经营分析岗')
    expect(a.querySelector('.ops-target-name').textContent).toBe('chenyu')
    expect(a.querySelector('.ops-version')).toBeNull()
  })

  it('【查看】跳转岗位管理页（岗位分配），并把用户名作为关键词带过去', async () => {
    const a = rowOf('chenyu', '分配')
    ;[...a.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminPositionAssignments'))
    expect(h.router.currentRoute.value.query.keyword).toBe('chenyu')
  })
})


describe('访问审计 · 管理端操作 · 分页（§六「列表根据页面高度动态分页」，待办 yuepu#80）', () => {
  // 总数 = 夹具条数 + 追加 6 条，多于 768 高窗口算出的每页 7 条；
  // TOTAL 在 beforeEach 里从夹具现算，不手写数字，夹具增删记录时断言不会无声地变义
  const EXTRA = 6
  let TOTAL
  const added = []
  const pager = () => pane().querySelector('.list-pager')
  const pageBtns = () => [...pane().querySelectorAll('.list-pager .page-btn')]
  const activePage = () => pane().querySelector('.list-pager .page-btn.active').textContent.trim()
  const goPage = async (n) => {
    pageBtns().find((b) => b.textContent.trim() === String(n)).click()
    await flushAll(4)
  }
  const sortHead = () => pane().querySelector('.ll-sort')
  const pageSize = () => Number(pane().querySelector('.list-pager .page-size').value)

  beforeEach(async () => {
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    const { opsRecords } = await import('@/api/accessAuditMock')
    TOTAL = opsRecords.length + EXTRA
    // 追加记录比夹具都早（01:00–06:00），倒序时排在后面几页
    for (let i = 1; i <= EXTRA; i++) {
      const rec = { id: 300 + i, time: `${day} 0${i}:00`, operator: 'admin', module: 'API', action: '发布', target: `追加对象${i}`, detail: '' }
      opsRecords.push(rec)
      added.push(rec)
    }
    await h.remountAtHeight(768) // 每页 7 条；挂载时 onMounted 取到含追加记录的全量
    await h.switchTab('管理端操作')
  })
  afterEach(async () => {
    const { opsRecords } = await import('@/api/accessAuditMock')
    for (const rec of added.splice(0)) opsRecords.splice(opsRecords.indexOf(rec), 1)
  })

  it('记录多于一页 → 首页只出一页的行数，分页条写明「共 N 条数据」（N = 可展示记录数）', () => {
    expect(pageSize()).toBeLessThan(TOTAL) // 前提：每页条数小于总数，否则切片断言没意义
    expect(rows()).toHaveLength(pageSize())
    expect(pager().textContent).toContain(`共 ${TOTAL} 条数据`)
  })

  it('点第 2 页 → 出下一批记录，首页的最新一条不再出现', async () => {
    const firstPageFirst = rows()[0].textContent
    await goPage(2)
    expect(rows()).toHaveLength(Math.min(pageSize(), TOTAL - pageSize()))
    expect(rows().some((tr) => tr.textContent === firstPageFirst)).toBe(false)
    expect(activePage()).toBe('2')
  })

  it('停在第 2 页时切换排序 → 回到第 1 页', async () => {
    await goPage(2)
    sortHead().click()
    await flushAll(4)
    expect(activePage()).toBe('1')
    expect(rows()).toHaveLength(pageSize())
  })

  it('停在第 2 页时点【查询】→ 回到第 1 页，列表仍是全部记录（md §6.1(5)；yuepu#84）', async () => {
    await goPage(2)
    expect(activePage()).toBe('2')
    const btn = [...pane().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查询')
    btn.click()
    await flushAll(4)
    expect(activePage()).toBe('1')
    expect(rows()).toHaveLength(pageSize())
  })

  it('停在第 2 页时输入搜索关键词 → 回到第 1 页，只剩命中记录', async () => {
    await goPage(2)
    const input = pane().querySelector('.lt-search input')
    input.value = '追加对象3'
    input.dispatchEvent(new Event('input'))
    await flushAll(6)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('追加对象3')
    expect(pager().textContent).toContain('共 1 条数据')
  })
})

describe('访问审计 · 管理端操作 · 存储空间记录（2026-10-09，§6.1 / §6.2 / §6.3 / §6.4）', () => {
  beforeEach(() => h.switchTab('管理端操作'))

  it('夹具 12 条（含同意 / 拒绝扩容）全部展示，都在默认时间范围内', () => {
    expect(rows()).toHaveLength(12)
  })

  it('搜索 wangfang（只出现在拒绝扩容记录里）→ 命中 1 行；模块下拉含「存储空间」，选它 → 3 行（调整容量 + 同意 + 拒绝）', async () => {
    const input = pane().querySelector('.lt-search input')
    input.value = 'wangfang'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('拒绝扩容')
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    pane().querySelectorAll('.lt-filter')[0].querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const items = [...document.body.querySelectorAll('.el-select-dropdown__item')]
    expect(items.map((i) => i.textContent.trim())).toContain('存储空间')
    items.find((i) => i.textContent.trim() === '存储空间').click()
    await flushAll(4)
    expect(rows()).toHaveLength(3)
  })

  it('同意扩容、拒绝扩容、调整容量三类记录都展示；拒绝扩容的变更内容是拒绝原因，同意扩容是「原总量 → 新总量」', () => {
    expect(detailCell(rowOf('chenyu', '同意扩容')).textContent.trim()).toBe('5 GB → 10 GB')
    expect(detailCell(rowOf('wangfang', '拒绝扩容')).textContent.trim()).toBe('先清理历史产物')
    expect(rowOf('zhangwei', '调整容量')).toBeTruthy()
  })

  it('模块标签灰色；动作「调整容量」「同意扩容」绿、「拒绝扩容」红；变更内容「原总量 → 新总量」，操作对象为员工用户名', () => {
    const tr = rowOf('zhangwei', '调整容量')
    expect(tagOf(tr, '存储空间').className).toContain('tag-gray')
    expect(tagOf(tr, '调整容量').className).toContain('tag-green')
    expect(tagOf(rowOf('chenyu', '同意扩容'), '同意扩容').className).toContain('tag-green')
    expect(tagOf(rowOf('wangfang', '拒绝扩容'), '拒绝扩容').className).toContain('tag-red')
    expect(detailCell(tr).textContent.trim()).toBe('5 GB → 8 GB')
  })

  it('动作筛选含「同意扩容」「拒绝扩容」「调整容量」，没有已删除的「修改默认容量」', async () => {
    const select = pane().querySelectorAll('.lt-filter')[1]
    select.querySelector('.el-select__wrapper').click()
    await flushAll(4)
    const items = [...document.body.querySelectorAll('.el-select-dropdown__item')].map((i) => i.textContent.trim())
    expect(items).toEqual(expect.arrayContaining(['同意扩容', '拒绝扩容', '调整容量']))
    expect(items).not.toContain('修改默认容量')
  })

  it('调整容量的【查看】跳转到存储空间页（默认容量分配页签），并把员工用户名作为关键词带过去（§6.3）', async () => {
    const tr = rowOf('zhangwei', '调整容量')
    ;[...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminStorageSpace'))
    expect(h.router.currentRoute.value.query.keyword).toBe('zhangwei')
    expect(h.router.currentRoute.value.query.tab).toBeUndefined()
  })

  it.each([['chenyu', '同意扩容'], ['wangfang', '拒绝扩容']])('%s 的「%s」【查看】跳转到存储空间页的扩容申请页签（tab=request），带员工用户名（§6.3）', async (name, action) => {
    ;[...rowOf(name, action).querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(h.router.currentRoute.value.name).toBe('AdminStorageSpace'))
    expect(h.router.currentRoute.value.query).toMatchObject({ tab: 'request', keyword: name })
  })
})

