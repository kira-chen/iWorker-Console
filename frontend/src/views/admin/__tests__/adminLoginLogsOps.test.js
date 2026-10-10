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
 * - 疑似缺陷（it.fails 钉桩）：§5.1 两个下拉的「全部」项文案（#64④）。§5.2 列头、动态分页与 §三 30 天跨度已由 #73 修复转正。
 *
 * 2026-10-09 起三个页签的列表都是 useAdminList 'client' 分页，每页条数按窗口高度算（useDynPageSize）：
 * 全局挂载把 window.innerHeight 调到 2000（每页 26 条，12 条夹具一页放得下，行数类用例不受分页影响），
 * 分页用例（下载 / 管理端操作两组）经 remountAtHeight(768) 以每页 7 条重新挂载，追加记录凑出多于一页。
 * 管理端操作页签分页由待办 yuepu#80 补齐（§六「列表根据页面高度动态分页」）。
 *
 * 2026-10-09 补存储空间记录（§6.1 模块 / 动作筛选、§6.2 存储空间记录块、§6.3 跳转带员工名、§6.4 灰色模块标签与绿色「调整容量」）：
 *   调整容量 / 同意扩容 / 拒绝扩容三类都展示（2026-10-10 起，同意 / 拒绝扩容不再隐藏）；夹具共 12 条，全部展示。【查看】：调整容量进容量分配页签，同意 / 拒绝扩容带 tab=request 进扩容申请页签。
 *
 * 2026-09-30 补岗位分配记录（§6.1 / §6.2 / §6.3 / §6.4）；2026-10-09 /test-audit 补：
 * - 强制回收（§6.1 动作筛选完整顺序、§6.4 红色动作标签、技能模块蓝标签与版本号小标签、变更内容 = 回收原因）；
 * - 用户技能审核（§6.4 橙色模块标签、审核通过绿 / 审核驳回红；变更内容驳回写原因、通过为空显示「—」）；
 * - 下载页签真分页（§5.2「列表根据页面高度动态分页」：多于一页时切片 + 总数 + 翻页 + 改筛选 / 排序回第 1 页），
 *   此前「出分页条」用例只有 3 行夹具，分页逻辑改坏也绿。
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
      { id: 4, time: `${day} 12:00`, operator: 'demo', module: '运行规格', action: '个人配置', target: '标准', detail: '为 2 个用户配置规格「标准」' },
      { id: 5, time: `${day} 13:00`, operator: 'admin', module: '岗位分配', action: '分配', target: 'chenyu', detail: '未绑定 → 经营分析岗' },
      { id: 6, time: `${day} 14:00`, operator: 'admin', module: '岗位分配', action: '变更', target: 'li.na', detail: '客户成功岗 → 财务审核岗' },
      { id: 7, time: `${day} 15:00`, operator: 'admin', module: '技能', action: '强制回收', target: '财税合规助手', version: 'v1.0.0', detail: '存在数据泄露风险' },
      { id: 8, time: `${day} 16:00`, operator: 'admin', module: '用户技能审核', action: '审核驳回', target: 'sun.hao / 合同管理助手', detail: '岗位与技能权限范围不匹配' },
      { id: 9, time: `${day} 17:00`, operator: 'admin', module: '用户技能审核', action: '审核通过', target: 'wang.fang / 报销助手', detail: '' },
      // 存储空间：调整容量、同意扩容、拒绝扩容三类都展示
      { id: 10, time: `${day} 18:00`, operator: 'demo', module: '存储空间', action: '调整容量', target: 'zhangwei', detail: '5 GB → 8 GB' },
      { id: 11, time: `${day} 18:10`, operator: 'demo', module: '存储空间', action: '同意扩容', target: 'chenyu', detail: '5 GB → 10 GB' },
      { id: 12, time: `${day} 18:20`, operator: 'demo', module: '存储空间', action: '拒绝扩容', target: 'wangfang', detail: '先清理历史产物' }
    ]
  }
})

const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default

let mounted
let router
const pane = () => mounted.container.querySelector('#pane-admin-ops')
const rows = () => [...pane().querySelectorAll('.el-table__body tr')]
const rowOf = (target, action) => rows().find((tr) => tr.textContent.includes(target) && [...tr.querySelectorAll('.aa-tag')].some((t) => t.textContent.trim() === action))
const tags = (tr) => [...tr.querySelectorAll('.aa-tag')]
// 列序：时间 / 操作人 / 模块 / 动作 / 变更内容 / 操作对象 / 操作（变更内容 = 第 5 格）
const detailCell = (tr) => tr.querySelectorAll('td')[4]
const tagOf = (tr, text) => tags(tr).find((t) => t.textContent.trim() === text)

/** 挂载整页（路由 + 真 Element Plus）。每页条数由 window.innerHeight 动态算（useDynPageSize），挂载前先定好高度。 */
async function mountPage() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login-logs', name: 'AdminLoginLogs', component: { template: '<div />' } },
      { path: '/admin/versions', name: 'AdminVersions', component: { template: '<div />' } },
      { path: '/admin/positions', name: 'AdminPositions', component: { template: '<div />' } },
      { path: '/admin/position-assignments', name: 'AdminPositionAssignments', component: { template: '<div />' } },
      { path: '/admin/runtime-specs', name: 'AdminRuntimeSpecs', component: { template: '<div />' } },
      { path: '/admin/storage-space', name: 'AdminStorageSpace', component: { template: '<div />' } }
    ]
  })
  await router.push('/admin/login-logs')
  await router.isReady()
  mounted = mountReal(AdminLoginLogs, {}, { plugins: [router] })
  await flushAll(12)
}
const ORIGIN_HEIGHT = window.innerHeight
beforeEach(async () => {
  // 默认窗口调高 → 每页 26 条，夹具（12 条）一页放得下，行数类用例不受分页影响；分页用例自行 remountAtHeight 调小
  window.innerHeight = 2000
  await mountPage()
})
/** 卸载后以指定窗口高度重新挂载（分页用例用：768 高 → 每页 7 条）。 */
async function remountAtHeight(h) {
  mounted.unmount()
  document.body.innerHTML = ''
  window.innerHeight = h
  await mountPage()
}
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
  window.innerHeight = ORIGIN_HEIGHT
})

describe('访问审计 · 管理端操作 · 版本管理记录', () => {
  beforeEach(() => switchTab('管理端操作'))
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

describe('访问审计 · 管理端操作 · 列表列头（§6.2，/prd-import Q13）', () => {
  beforeEach(() => switchTab('管理端操作'))

  it('列头：第一列为「操作时间」（带排序箭头 ↓），其后依次操作人 / 模块 / 动作 / 变更内容 / 操作对象 / 操作', () => {
    const heads = [...pane().querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim())
    expect(heads[0]).toBe('操作时间 ↓')
    expect(heads.slice(1)).toEqual(['操作人', '模块', '动作', '变更内容', '操作对象', '操作'])
  })
})

describe('访问审计 · 管理端操作 · 强制回收与用户技能审核记录（2026-10-09 /test-audit 补，§6.1 / §6.2 / §6.4）', () => {
  beforeEach(() => switchTab('管理端操作'))
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
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminPositionAssignments'))
    expect(router.currentRoute.value.query.keyword).toBe('chenyu')
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
    await remountAtHeight(768) // 每页 7 条
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    const { dlRecords } = await import('@/api/accessAuditMock')
    for (let i = 1; i <= EXTRA; i++) {
      const rec = { id: 200 + i, time: `${day} 0${i}:00`, user: `用户${i}`, filename: `追加文件${i}.pdf`, channel: 'Windows', source: '会话产物', result: 'SUCCESS' }
      dlRecords.push(rec)
      added.push(rec)
    }
    await switchTab('用户端文件下载')
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
    await remountAtHeight(768) // 每页 7 条；挂载时 onMounted 取到含追加记录的全量
    await switchTab('管理端操作')
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
  /** 模拟在日期面板上点选（真 ElDatePicker 的 calendar-change 回调）；回调抛错会直接让用例失败。 */
  const pickDays = async (p, val) => {
    p.vnode.props.onCalendarChange(val)
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
    await switchTab('用户端文件下载')
    const input = dlPane().querySelector('.lt-search input')
    input.value = '吴强'
    input.dispatchEvent(new Event('input'))
    await flushAll(4)
    await switchTab('管理端操作')
    expect(pane().querySelector('.lt-search input').value).toBe('')
    expect(rows()).toHaveLength(12)
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
    expect(rows()).toHaveLength(12)
  })
})

describe('访问审计 · 管理端操作 · 存储空间记录（2026-10-09，§6.1 / §6.2 / §6.3 / §6.4）', () => {
  beforeEach(() => switchTab('管理端操作'))

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
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminStorageSpace'))
    expect(router.currentRoute.value.query.keyword).toBe('zhangwei')
    expect(router.currentRoute.value.query.tab).toBeUndefined()
  })

  it.each([['chenyu', '同意扩容'], ['wangfang', '拒绝扩容']])('%s 的「%s」【查看】跳转到存储空间页的扩容申请页签（tab=request），带员工用户名（§6.3）', async (name, action) => {
    ;[...rowOf(name, action).querySelectorAll('button')].find((b) => b.textContent.trim() === '查看').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AdminStorageSpace'))
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'request', keyword: name })
  })
})
