import { describe, it, expect } from 'vitest'
import { removeRefs, renameRefs, syncRefs } from '../positionRefs'

/**
 * 连接器「被岗位引用」回写公共实现（待办 yuepu#98：原先在 MCP / API / 业务系统三个 mock 里逐字重复，现收成一份）。
 * 三个连接器 mock 的调用面（岗位删除 / 改名 / 绑定）见各自 mock 的用例与 positionMock 联动用例。
 */
const rows = () => [
  { id: 'a', type: 'PLATFORM', referencedByPositions: [{ positionId: 1, positionName: '甲岗' }, { positionId: 2, positionName: '乙岗' }] },
  { id: 'b', type: 'POSITION', referencedByPositions: [{ positionId: 1, positionName: '甲岗' }] },
  { id: 'c', type: 'POSITION', referencedByPositions: [] },
  { id: 'd', type: 'POSITION' } // 老数据可能没有该键
]

describe('removeRefs', () => {
  it('从所有行摘掉该岗位，别的岗位不动；返回是否有改动', () => {
    const r = rows()
    expect(removeRefs(r, 1)).toBe(true)
    expect(r[0].referencedByPositions).toEqual([{ positionId: 2, positionName: '乙岗' }])
    expect(r[1].referencedByPositions).toEqual([])
    expect(removeRefs(r, 99)).toBe(false)
  })
  it('岗位 id 数字 / 字符串口径不敏感', () => {
    const r = rows()
    expect(removeRefs(r, '2')).toBe(true)
    expect(r[0].referencedByPositions.map((p) => p.positionId)).toEqual([1])
  })
})

describe('renameRefs', () => {
  it('同步冻结的岗位名；名称没变返回 false', () => {
    const r = rows()
    expect(renameRefs(r, 1, '甲岗（新）')).toBe(true)
    expect(r[0].referencedByPositions[0].positionName).toBe('甲岗（新）')
    expect(r[1].referencedByPositions[0].positionName).toBe('甲岗（新）')
    expect(renameRefs(r, 1, '甲岗（新）')).toBe(false)
  })
})

describe('syncRefs', () => {
  it('只动 type=POSITION 的行：boundIds 内补上本岗位，之外摘掉；平台连接器行不碰', () => {
    const r = rows()
    expect(syncRefs(r, 1, '甲岗', ['c'])).toBe(true)
    expect(r[0].referencedByPositions).toHaveLength(2) // PLATFORM 行原样
    expect(r[1].referencedByPositions).toEqual([]) // b 不在 boundIds → 摘掉
    expect(r[2].referencedByPositions).toEqual([{ positionId: 1, positionName: '甲岗' }]) // c 在 → 补上
  })
  it('没有变化返回 false；已绑定的不重复追加', () => {
    const r = rows()
    expect(syncRefs(r, 1, '甲岗', ['b'])).toBe(false)
    expect(r[1].referencedByPositions).toHaveLength(1)
  })
})
