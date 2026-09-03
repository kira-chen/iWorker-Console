// @vitest-environment jsdom
// （runtimeSpecMock → request.js → router 链路触达 window，故用 jsdom）
// vitest 全局随机序：用例各自自洽（新建自清理；护栏用例不落改动）。
// 2026-09-02 修正口径：规格绑定对象为用户（每用户一档，13 人全量分配）；不设默认规格。
import { describe, it, expect } from 'vitest'
import {
  listRuntimeSpecs, getRuntimeSpec, createRuntimeSpec, updateRuntimeSpec, deleteRuntimeSpec
} from '../runtimeSpecMock'

describe('runtimeSpecMock —— 运行规格（用户绑定口径，截图 5 档种子）', () => {
  it('种子：5 档规格、截图行序（轻在前）、无默认规格概念、汇总口径（N 规格 · M 用户已配置）', async () => {
    const { list, total, summary } = await listRuntimeSpecs()
    expect(total).toBeGreaterThanOrEqual(5)
    expect(list.slice(0, 5).map((s) => s.name)).toEqual(['轻', '标准', '重', '高敏', '专属 · 生产计划员'])
    expect(list.every((s) => !('isDefault' in s))).toBe(true)
    expect(summary.specCount).toBe(total)
    expect(summary.userCount).toBe(list.reduce((n, s) => n + s.usedCount, 0))
  })

  it('用户全量分配：13 个用户种子每人一档、不重复（与 adminUserMock 同源口径）', async () => {
    const { list } = await listRuntimeSpecs()
    const names = list.flatMap((s) => s.usedUsers.map((u) => u.username))
    expect(names).toHaveLength(13)
    expect(new Set(names).size).toBe(13)
    expect(names).toContain('zhangwei')
    expect(names).toContain('ma.chao')
  })

  it('在用审批汇总：需审批规格有待审绑定 → PENDING；全过 → APPROVED；无审批/无绑定 → null', async () => {
    const { list } = await listRuntimeSpecs()
    const byName = Object.fromEntries(list.map((s) => [s.name, s]))
    expect(byName['重'].approvalSummary).toBe('PENDING') // 何静待审
    expect(byName['专属 · 生产计划员'].approvalSummary).toBe('APPROVED')
    expect(byName['轻'].approvalSummary).toBeNull() // 无需审批
    expect(byName['高敏'].approvalSummary).toBeNull() // 无绑定
  })

  it('新建/编辑/删除全链：名称唯一护栏、字段校验、删除放行', async () => {
    await expect(createRuntimeSpec({ name: '标准', boundaryDesc: 'x', cpu: 1, memoryGi: 1, diskGi: 1, timeoutMin: 1, idleRecycleMin: 1, concurrency: 1 }))
      .rejects.toThrow('规格名称已存在')
    await expect(createRuntimeSpec({ name: '临时档', boundaryDesc: '', cpu: 1, memoryGi: 1, diskGi: 1, timeoutMin: 1, idleRecycleMin: 1, concurrency: 1 }))
      .rejects.toThrow('能力边界说明必填')
    const created = await createRuntimeSpec({
      name: `临时档-${Date.now()}`, boundaryDesc: '测试档', cpu: 1, memoryGi: 2, diskGi: 5,
      timeoutMin: 5, idleRecycleMin: 5, concurrency: 10
    })
    expect(created.usedCount).toBe(0)
    const updated = await updateRuntimeSpec(created.id, { ...created, concurrency: 12 })
    expect(updated.concurrency).toBe(12)
    expect((await getRuntimeSpec(created.id)).concurrency).toBe(12)
    await expect(deleteRuntimeSpec(created.id)).resolves.toBe(true)
  })

  it('删除护栏：被用户使用拦截且携用户名单', async () => {
    const { list } = await listRuntimeSpecs()
    const used = list.find((s) => s.usedCount > 0)
    await expect(deleteRuntimeSpec(used.id)).rejects.toThrow(new RegExp(`${used.usedCount} 个用户使用`))
    await expect(deleteRuntimeSpec(used.id)).rejects.toThrow(used.usedUsers[0].name)
  })
})
