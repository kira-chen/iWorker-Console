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
// 校验文案 2026-09-12 已按 md §四.10 / §三.3.6 逐字对齐（审计 K28 闭环），本文件断言 md 原文。
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
    await expect(deleteRuntimeSpec(2)).rejects.toThrow('默认运行规格用于平台兜底，不能删除')
    await expect(deleteRuntimeSpec(1)).rejects.toThrow('已配置给 1 个岗位')
    await expect(deleteRuntimeSpec(5)).rejects.toThrow('个人配置或待审批申请')
  })

  it('返回平台单实例上限，并在创建时拒绝超限资源', async () => {
    await expect(getRuntimeSpecLimits()).resolves.toEqual({ cpu: 32, memoryGi: 128, diskGi: 500 })
    await expect(createRuntimeSpec({
      name: '超限规格', boundaryDesc: '测试超限保护', cpu: 64, memoryGi: 256, diskGi: 1000,
      readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0,
      positionIds: [], allowUserApply: false
    })).rejects.toMatchObject({ field: 'cpu', message: '不能超过平台单实例上限 32核' })
  })

  /* ===== 2026-09-12 审计 K28：校验文案逐字 md §四.10 ===== */
  const VALID = {
    name: '校验档', boundaryDesc: '校验文案', cpu: 1, memoryGi: 2, diskGi: 5,
    readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0, positionIds: [], allowUserApply: false
  }
  it('CPU 0.7（非 0.5 递增）→ 拒绝「CPU须不小于 0.5 核，并按照 0.5 递增」，field=cpu；0.5 / 1.5 通过（md §四.10 L389 / §四.4 L296）', async () => {
    await expect(createRuntimeSpec({ ...VALID, cpu: 0.7 })).rejects.toMatchObject({ field: 'cpu', message: 'CPU须不小于 0.5 核，并按照 0.5 递增' })
    await expect(createRuntimeSpec({ ...VALID, cpu: 0.25 })).rejects.toMatchObject({ field: 'cpu' })
    await expect(createRuntimeSpec({ ...VALID, cpu: 0.5 })).resolves.toMatchObject({ cpu: 0.5 })
    await expect(createRuntimeSpec({ ...VALID, name: '校验档2', cpu: 1.5 })).resolves.toMatchObject({ cpu: 1.5 })
  })

  it('内存 1.5（非整数）→ 拒绝「内存须为不小于 1 的整数」；临时存储 / 就绪超时 / 空闲回收 / 最大存活各自文案逐字 md §四.10 L390-394', async () => {
    await expect(createRuntimeSpec({ ...VALID, memoryGi: 1.5 })).rejects.toMatchObject({ field: 'memoryGi', message: '内存须为不小于 1 的整数' })
    await expect(createRuntimeSpec({ ...VALID, diskGi: 0 })).rejects.toMatchObject({ field: 'diskGi', message: '临时存储须为不小于 1 的整数' })
    await expect(createRuntimeSpec({ ...VALID, readinessTimeoutMin: 0.5 })).rejects.toMatchObject({ field: 'readinessTimeoutMin', message: '就绪等待超时须为不小于 1 的整数分钟' })
    await expect(createRuntimeSpec({ ...VALID, idleRecycleMin: 0 })).rejects.toMatchObject({ field: 'idleRecycleMin', message: '空闲回收须为不小于 1 的整数分钟' })
    await expect(createRuntimeSpec({ ...VALID, maxLifetimeHours: -1 })).rejects.toMatchObject({ field: 'maxLifetimeHours', message: '最大存活时长须为非负整数小时，0 表示不限' })
    await expect(createRuntimeSpec({ ...VALID, maxLifetimeHours: 1.5 })).rejects.toMatchObject({ field: 'maxLifetimeHours' })
  })

  it('能力边界说明 201 字 → 拒绝「能力边界说明不超过 200 个字符」；为空 →「请填写能力边界说明」；名称 65 字 →「规格名称不超过 64 个字符」（md §四.10 L384-388）', async () => {
    await expect(createRuntimeSpec({ ...VALID, boundaryDesc: '边'.repeat(201) })).rejects.toMatchObject({ field: 'boundaryDesc', message: '能力边界说明不超过 200 个字符' })
    await expect(createRuntimeSpec({ ...VALID, boundaryDesc: '   ' })).rejects.toMatchObject({ field: 'boundaryDesc', message: '请填写能力边界说明' })
    await expect(createRuntimeSpec({ ...VALID, name: '名'.repeat(65) })).rejects.toMatchObject({ field: 'name', message: '规格名称不超过 64 个字符' })
    await expect(createRuntimeSpec({ ...VALID, name: '  ' })).rejects.toMatchObject({ field: 'name', message: '规格名称不能为空' })
    await expect(createRuntimeSpec({ ...VALID, boundaryDesc: '边'.repeat(200) })).resolves.toMatchObject({ boundaryDesc: '边'.repeat(200) })
  })

  it('规格「重」有 1 个待审批申请（何静）：关闭「允许用户申请」保存 → 拒绝并提示先处理或撤回，field=allowUserApply；不关申请入口可正常保存（md §四.8.3 L372 / §四.10 L398，审计 K29）', async () => {
    const heavy = await getRuntimeSpec(3)
    expect(heavy.pendingCount).toBe(1)
    await expect(updateRuntimeSpec(3, { ...heavy, allowUserApply: false }))
      .rejects.toMatchObject({ field: 'allowUserApply', message: '存在 1 个待审批申请，请先处理或撤回相关申请后再关闭申请入口' })
    expect((await getRuntimeSpec(3)).allowUserApply).toBe(true)
    await expect(updateRuntimeSpec(3, { ...heavy, maxLifetimeHours: 6 })).resolves.toMatchObject({ maxLifetimeHours: 6, allowUserApply: true })
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
