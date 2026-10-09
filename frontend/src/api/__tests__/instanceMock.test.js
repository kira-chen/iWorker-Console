// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../mockPersist', () => ({ attachPersist: () => vi.fn() }))

import { __resetInstanceMock, getInstance, listInstances, operateInstance } from '../instanceMock'

/**
 * instanceMock（实例管理 mock 层）单测。
 * 2026-10-08 对齐 04运行/实例管理/prd.实例管理.md §五 / §七 / §九：只维护实例对象与运行处置（重启 / 按最新规格重建 / 回收），
 * 不引入任务 / 会话对象；筛选与 operable 拦截规则见各用例。
 * 状态机覆盖启动中→空闲、回收中→移除，并回写操作记录结果。
 */

describe('instanceMock —— 只管理实例，不引入任务/会话对象', () => {
  beforeEach(() => __resetInstanceMock())

  it('返回5个当前实例，并支持状态、岗位、规格和待生效筛选', async () => {
    expect((await listInstances()).total).toBe(5)
    expect((await listInstances({ status: 'ERROR' })).list.map((row) => row.id)).toEqual(['ins-240903'])
    expect((await listInstances({ position: '经营分析岗' })).total).toBe(2)
    expect((await listInstances({ spec: '重' })).total).toBe(2)
    expect((await listInstances({ pending: true })).list.map((row) => row.id)).toEqual(['ins-240904'])
  })

  // 2026-10-08 对齐 md 实例 §五.3「搜索：支持规格名称、岗位、用户姓名、用户名和实例标识的部分匹配」
  it.each([
    ['实例标识 ins-240903', 'ins-240903', ['ins-240903']],
    ['用户姓名 周明', '周明', ['ins-240903']],
    ['岗位 经营分析岗', '经营分析岗', ['ins-240903', 'ins-240901']]
  ])('关键词按%s搜索 → 只命中对应实例', async (_label, keyword, ids) => {
    const { list, total } = await listInstances({ keyword })
    expect(list.map((row) => row.id)).toEqual(ids)
    expect(total).toBe(ids.length)
  })

  // 2026-10-08 对齐 md 实例 §七「排序规则」：异常 → 启动中 → 运行中 → 空闲 → 回收中；同状态按最近活跃由近到远。
  // 期望序列由种子推得：903 异常；905 启动中；901 运行中；902 空闲（14:56）先于 904 空闲（13:30）。
  it('默认顺序：异常 → 启动中 → 运行中 → 空闲（同为空闲时最近活跃 14:56 排在 13:30 前）', async () => {
    const { list } = await listInstances()
    expect(list.map((row) => row.id)).toEqual(['ins-240903', 'ins-240905', 'ins-240901', 'ins-240902', 'ins-240904'])
    expect(list.map((row) => row.status)).toEqual(['ERROR', 'STARTING', 'RUNNING', 'IDLE', 'IDLE'])
  })

  it('繁忙或启动中的实例由 operable 规则阻止操作', async () => {
    await expect(operateInstance('ins-240901', 'restart')).rejects.toThrow('实例当前繁忙')
    await expect(operateInstance('ins-240905', 'recycle')).rejects.toThrow('实例正在启动')
  })

  it('按最新规格重建先进入启动中，完成后才更新实际规格和操作记录', async () => {
    const changed = await operateInstance('ins-240904', 'rebuild')
    expect(changed.actualSpec).toBe('标准')
    expect(changed.status).toBe('STARTING')
    expect(changed.records[0]).toMatchObject({ type: '按最新规格重建', result: '已受理' })
    await listInstances()
    await listInstances()
    expect(await getInstance('ins-240904')).toMatchObject({ actualSpec: '重', status: 'IDLE', operable: true })
    expect((await getInstance('ins-240904')).records[0].result).toBe('成功')
  })

  it('实际规格已是最新时禁止重建，但允许回收进入回收中', async () => {
    await expect(operateInstance('ins-240902', 'rebuild')).rejects.toThrow('当前实际规格已是最新生效规格')
    expect((await operateInstance('ins-240902', 'recycle')).status).toBe('RECYCLING')
    await listInstances()
    expect((await listInstances()).list.some((row) => row.id === 'ins-240902')).toBe(false)
  })
})
