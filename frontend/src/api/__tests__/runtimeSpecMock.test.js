// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

const persistHarness = vi.hoisted(() => ({ modules: new Map() }))
vi.mock('../mockPersist', () => ({
  attachPersist(moduleKey, options) {
    const persist = vi.fn()
    persistHarness.modules.set(moduleKey, { options, persist })
    return persist
  }
}))

import {
  listRuntimeSpecs, getRuntimeSpec, getRuntimeSpecLimits, createRuntimeSpec, updateRuntimeSpec, deleteRuntimeSpec,
  listRuntimeSpecUsers, assignRuntimeSpecUsers, applyRuntimeSpecForUser, unassignRuntimeSpecUser, __resetRuntimeSpecMock
} from '../runtimeSpecMock'

// 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/04运行/运行规格/prd.运行规格.md §一.4 核心规则 /
// §二.1 搜索 / §三.2 排序 / §三.3.4 配置范围 / §三.3.6 删除 / §四.3 适用范围 / §四.4 资源上限。
// 注：L89/L100 断言的是代码现有校验文案（与 md §四.10 不一致，记 K28），修后随改。
describe('runtimeSpecMock —— 默认兜底、岗位继承与个人例外', () => {
  beforeEach(() => __resetRuntimeSpecMock())

  it('始终有且仅有一个默认规格，全部用户都有生效规格', async () => {
    const { list, summary } = await listRuntimeSpecs()
    expect(list.filter((s) => s.isDefault)).toHaveLength(1)
    expect(list.find((s) => s.isDefault).name).toBe('标准')
    expect(summary.specCount).toBe(5)
    expect(summary.userCount).toBe(13)
  })

  it('生效优先级：个人配置 > 岗位规格 > 平台默认', async () => {
    const light = await listRuntimeSpecUsers(1)
    const heavy = await listRuntimeSpecUsers(3)
    const standard = await listRuntimeSpecUsers(2)
    const liNa = light.list.find((u) => u.username === 'li.na')
    const zhangWei = heavy.list.find((u) => u.username === 'zhangwei')
    const chenYu = standard.list.find((u) => u.username === 'chenyu')
    const zhaoMin = heavy.list.find((u) => u.username === 'zhaomin')
    expect([liNa.currentSpecName, liNa.source, liNa.positionName]).toEqual(['轻', 'POSITION', '客户成功岗'])
    expect([zhangWei.currentSpecName, zhangWei.source]).toEqual(['重', 'POSITION'])
    expect([chenYu.currentSpecName, chenYu.source]).toEqual(['标准', 'DEFAULT'])
    expect([zhaoMin.currentSpecName, zhaoMin.source]).toEqual(['重', 'USER'])
  })

  it('用户申请审批规格时保留原生效规格，撤回后仍回到原规格', async () => {
    await applyRuntimeSpecForUser(3, 'chenyu')
    const pending = await listRuntimeSpecUsers(3)
    const chenYu = pending.list.find((u) => u.username === 'chenyu')
    expect(chenYu.currentSpecName).toBe('标准')
    expect(chenYu.source).toBe('DEFAULT')
    expect(chenYu.isPending).toBe(true)
    await unassignRuntimeSpecUser(3, 'chenyu')
    const restored = await listRuntimeSpecUsers(2)
    expect(restored.list.find((u) => u.username === 'chenyu').currentSpecName).toBe('标准')
  })

  it('用户自主申请固定进入审批，管理员直接配置立即生效', async () => {
    const created = await createRuntimeSpec({
      name: '申请测试档', boundaryDesc: '测试', cpu: 1, memoryGi: 2, diskGi: 5,
      readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0,
      positionIds: [], allowUserApply: true, requireApproval: false
    })
    expect(created.requireApproval).toBe(true)
    await applyRuntimeSpecForUser(created.id, 'zhangwei')
    const pending = (await listRuntimeSpecUsers(created.id)).list.find((u) => u.username === 'zhangwei')
    expect(pending.currentSpecName).toBe('重')
    expect(pending.source).toBe('POSITION')
    expect(pending.isPending).toBe(true)
    await assignRuntimeSpecUsers(created.id, ['zhangwei'])
    const effective = (await listRuntimeSpecUsers(created.id)).list.find((u) => u.username === 'zhangwei')
    expect(effective.currentSpecName).toBe('申请测试档')
    expect(effective.source).toBe('USER')
    expect(effective.isPending).toBe(false)
  })

  it('新建与编辑支持适用岗位和申请规则；岗位被新规格接管后不再属于旧规格', async () => {
    const created = await createRuntimeSpec({
      name: '临时分析档', boundaryDesc: '测试', cpu: 1, memoryGi: 2, diskGi: 5,
      readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0,
      positionIds: [402], allowUserApply: true, requireApproval: true
    })
    expect(created.positionNames).toEqual(['客户成功岗'])
    expect((await getRuntimeSpec(1)).positionIds).toEqual([])
    const updated = await updateRuntimeSpec(created.id, { ...created, maxLifetimeHours: 12 })
    expect(updated.maxLifetimeHours).toBe(12)
    await updateRuntimeSpec(created.id, { ...updated, positionIds: [] })
    await expect(deleteRuntimeSpec(created.id)).resolves.toBe(true)
  })

  it('默认规格不可删除，岗位关联和个人关系均形成删除保护', async () => {
    await expect(deleteRuntimeSpec(2)).rejects.toThrow('默认运行规格用于兜底，不能删除')
    await expect(deleteRuntimeSpec(1)).rejects.toThrow('已配置给 1 个岗位')
    await expect(deleteRuntimeSpec(5)).rejects.toThrow('个人配置或待审批申请')
  })

  it('返回平台单实例上限，并在创建时拒绝超限资源', async () => {
    await expect(getRuntimeSpecLimits()).resolves.toEqual({ cpu: 32, memoryGi: 128, diskGi: 500 })
    await expect(createRuntimeSpec({
      name: '超限规格', boundaryDesc: '测试超限保护', cpu: 64, memoryGi: 256, diskGi: 1000,
      readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0,
      positionIds: [], allowUserApply: false
    })).rejects.toThrow('CPU超过当前平台单实例上限 32 核')
  })

  it('规格写操作调用共享持久化层并生成v2快照', async () => {
    const runtimePersist = persistHarness.modules.get('runtimeSpec')
    runtimePersist.persist.mockClear()
    await createRuntimeSpec({
      name: '持久化测试档', boundaryDesc: '验证刷新后仍保留', cpu: 1, memoryGi: 2, diskGi: 5,
      readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0,
      positionIds: [], allowUserApply: false
    })
    expect(runtimePersist.options.version).toBe(2)
    expect(runtimePersist.persist).toHaveBeenCalledTimes(1)
    expect(runtimePersist.options.snapshot().specs.some((spec) => spec.name === '持久化测试档')).toBe(true)
  })

  // 2026-09-12 测试审计 T43：持久化只验了 create；其余五个写点表驱动补齐（漏 persist = 刷新即丢）
  const BASE = {
    name: '写点档', boundaryDesc: '表驱动持久化', cpu: 1, memoryGi: 2, diskGi: 5,
    readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0, positionIds: [], allowUserApply: true
  }
  it.each([
    ['updateRuntimeSpec', async () => { const s = await createRuntimeSpec(BASE); return () => updateRuntimeSpec(s.id, { ...s, maxLifetimeHours: 3 }) }],
    ['deleteRuntimeSpec', async () => { const s = await createRuntimeSpec(BASE); return () => deleteRuntimeSpec(s.id) }],
    ['assignRuntimeSpecUsers', async () => { const s = await createRuntimeSpec(BASE); return () => assignRuntimeSpecUsers(s.id, ['chenyu']) }],
    ['applyRuntimeSpecForUser', async () => { const s = await createRuntimeSpec(BASE); return () => applyRuntimeSpecForUser(s.id, 'chenyu') }],
    ['unassignRuntimeSpecUser', async () => { const s = await createRuntimeSpec(BASE); await assignRuntimeSpecUsers(s.id, ['chenyu']); return () => unassignRuntimeSpecUser(s.id, 'chenyu') }]
  ])('%s 写点各自调用 persist ≥ 1 次（刷新后仍保留）', async (_name, prepare) => {
    const run = await prepare()
    const runtimePersist = persistHarness.modules.get('runtimeSpec')
    runtimePersist.persist.mockClear()
    await run()
    expect(runtimePersist.persist.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  /* ===== 2026-09-12 测试审计 T55 补缺口（md §一.4 / §三.3.4 / §四.3 / §二.1） ===== */

  it('同一岗位同一时刻恰属 1 个规格：新规格接管岗位 402 后，全表只有它含 402（md §一.4「一个岗位最多配置一个运行规格」）', async () => {
    const created = await createRuntimeSpec({ ...BASE, name: '接管岗位档', positionIds: [402] })
    const { list } = await listRuntimeSpecs()
    const owners = list.filter((s) => s.positionIds.includes(402)).map((s) => s.id)
    expect(owners).toEqual([created.id])
    // 不变量对全部岗位成立：任一岗位 id 出现次数 ≤ 1
    const seen = new Map()
    list.forEach((s) => s.positionIds.forEach((pid) => seen.set(pid, (seen.get(pid) || 0) + 1)))
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
  })

  it('停用用户不能被管理员配置个人例外：assign rejects「已停用，不能配置规格」（md §三.3.4「停用用户不可新增个人配置」）', async () => {
    await expect(assignRuntimeSpecUsers(3, ['wujie'])).rejects.toThrow('已停用，不能配置规格')
    // 整批不落库：同批的正常用户也未写入
    await expect(assignRuntimeSpecUsers(3, ['chenyu', 'wujie'])).rejects.toThrow('已停用，不能配置规格')
    const rows = await listRuntimeSpecUsers(3)
    expect(rows.list.find((u) => u.username === 'chenyu').isCurrent).toBe(false)
  })

  it('关闭申请入口的规格（标准，allowUserApply=false）：用户申请 rejects「该规格当前不开放用户申请」（md §四.3）', async () => {
    await expect(applyRuntimeSpecForUser(2, 'chenyu')).rejects.toThrow('该规格当前不开放用户申请')
    const rows = await listRuntimeSpecUsers(2)
    expect(rows.list.find((u) => u.username === 'chenyu').isPending).toBe(false)
  })

  it('搜索支持匹配适用岗位名：keyword「客户成功岗」命中规格「轻」（md §二.1 搜索框）', async () => {
    const { list } = await listRuntimeSpecs({ keyword: '客户成功岗' })
    expect(list.map((s) => s.name)).toEqual(['轻'])
    // 前后空格忽略（md §二.2）
    expect((await listRuntimeSpecs({ keyword: '  客户成功岗 ' })).list.map((s) => s.name)).toEqual(['轻'])
  })

  it('默认按最近更新时间倒序，新建规格置顶，并支持切换升序', async () => {
    const created = await createRuntimeSpec({
      name: '最新规格', boundaryDesc: '验证排序', cpu: 1, memoryGi: 2, diskGi: 5,
      readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0,
      positionIds: [], allowUserApply: false
    })
    expect((await listRuntimeSpecs()).list[0].id).toBe(created.id)
    expect((await listRuntimeSpecs({ sortOrder: 'ascending' })).list[0].updatedAt).toBe('2026-08-18 11:30')
  })
})
