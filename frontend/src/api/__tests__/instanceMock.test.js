// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../mockPersist', () => ({ attachPersist: () => vi.fn() }))

import { __resetInstanceMock, getInstance, listInstances, operateInstance } from '../instanceMock'

describe('instanceMock —— 只管理实例，不引入任务/会话对象', () => {
  beforeEach(() => __resetInstanceMock())

  it('返回5个当前实例，并支持状态、岗位、规格和待生效筛选', async () => {
    expect((await listInstances()).total).toBe(5)
    expect((await listInstances({ status: 'ERROR' })).list.map((row) => row.id)).toEqual(['ins-240903'])
    expect((await listInstances({ position: '经营分析岗' })).total).toBe(2)
    expect((await listInstances({ spec: '重' })).total).toBe(2)
    expect((await listInstances({ pending: true })).list.map((row) => row.id)).toEqual(['ins-240904'])
  })

  it('繁忙或启动中的实例由 operable 规则阻止操作', async () => {
    await expect(operateInstance('ins-240901', 'restart')).rejects.toThrow('实例当前繁忙')
    await expect(operateInstance('ins-240905', 'recycle')).rejects.toThrow('实例正在启动')
  })

  it('按最新规格重建后实际规格更新并写入操作记录', async () => {
    const changed = await operateInstance('ins-240904', 'rebuild')
    expect(changed.actualSpec).toBe('重')
    expect(changed.status).toBe('STARTING')
    expect(changed.records[0]).toMatchObject({ type: '按最新规格重建', result: '已受理' })
    expect((await getInstance('ins-240904')).operable).toBe(false)
  })

  it('实际规格已是最新时禁止重建，但允许回收进入回收中', async () => {
    await expect(operateInstance('ins-240902', 'rebuild')).rejects.toThrow('当前实际规格已是最新生效规格')
    expect((await operateInstance('ins-240902', 'recycle')).status).toBe('RECYCLING')
  })
})
