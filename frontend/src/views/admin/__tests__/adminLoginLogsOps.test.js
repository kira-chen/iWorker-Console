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
 * 真实挂载（真 Element Plus 标签页 / 表格 / 下拉），只 mock 数据层。记录时间取「今天」，
 * 避免被页面默认的「近 90 天」时间范围滤掉。「登录访问」页签的用例见 adminLoginLogs.test.js。
 */

vi.mock('@/api/loginLog', () => ({ listLoginLogs: () => Promise.resolve({ list: [], total: 0 }) }))
vi.mock('@/api/accessAuditMock', () => {
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return {
    dlRecords: [],
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
  // 切到「管理端操作」页签
  const tab = [...mounted.container.querySelectorAll('.el-tabs__item')].find((t) => t.textContent.trim() === '管理端操作')
  tab.click()
  await flushAll(6)
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('访问审计 · 管理端操作 · 版本管理记录', () => {
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
