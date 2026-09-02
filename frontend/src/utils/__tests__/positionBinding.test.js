import { describe, it, expect } from 'vitest'
import { isCurrentBoundPosition, excludeBoundPosition } from '@/utils/positionBinding'

// 「目标专家是否为当前绑定专家」：个性化页未绑定拦截 + 选回当前拦截共用同一判定。

describe('isCurrentBoundPosition · 当前绑定判定', () => {
  it('目标 === 当前绑定 → true（可个性化 / 选回当前）', () => {
    expect(isCurrentBoundPosition(5, 5)).toBe(true)
  })

  it('目标 !== 当前绑定 → false（非当前专家：拦截个性化、触发换绑）', () => {
    expect(isCurrentBoundPosition(2, 5)).toBe(false)
  })

  it('路由参数为字符串时仍正确比较', () => {
    expect(isCurrentBoundPosition('5', 5)).toBe(true)
    expect(isCurrentBoundPosition('2', 5)).toBe(false)
  })

  it('无当前绑定（boundPositionId 为空）→ 任何专家都不是当前绑定，一律 false', () => {
    expect(isCurrentBoundPosition(5, null)).toBe(false)
    expect(isCurrentBoundPosition(5, undefined)).toBe(false)
  })

  it('目标为空 → false（防御）', () => {
    expect(isCurrentBoundPosition(null, 5)).toBe(false)
  })
})

describe('excludeBoundPosition · 其他岗位列表排除绑定岗位', () => {
  const positions = [{ id: 1 }, { id: 2 }, { id: 3 }]

  it('内存态 currentPosition.id 存在 → 用其排除绑定岗位', () => {
    expect(excludeBoundPosition(positions, 2, null)).toEqual([{ id: 1 }, { id: 3 }])
  })

  it('B1 回归：currentPosition 为 null 但 userInfo.boundPositionId 存在 → 用持久化 id 兜底排除绑定岗位', () => {
    // 用户登录后直接进本页 / 刷新停本页：currentPosition 为 null，必须靠 boundPositionId 兜底
    expect(excludeBoundPosition(positions, null, 2)).toEqual([{ id: 1 }, { id: 3 }])
    expect(excludeBoundPosition(positions, undefined, 3)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('内存态优先于持久化兜底（两者都有时取 currentPosition.id）', () => {
    // currentPosition.id=1 优先生效，排除 1 而非兜底的 3
    expect(excludeBoundPosition(positions, 1, 3)).toEqual([{ id: 2 }, { id: 3 }])
  })

  it('两者皆空（未绑定）→ 返回全部', () => {
    expect(excludeBoundPosition(positions, null, null)).toEqual(positions)
    expect(excludeBoundPosition(positions, undefined, undefined)).toEqual(positions)
  })

  it('类型对齐：boundPositionId 为字符串仍能与 number 型 e.id 正确排除', () => {
    expect(excludeBoundPosition(positions, null, '2')).toEqual([{ id: 1 }, { id: 3 }])
  })

  it('列表为空 / 缺省 → 返回空数组（防御）', () => {
    expect(excludeBoundPosition([], null, 1)).toEqual([])
    expect(excludeBoundPosition(undefined, null, 1)).toEqual([])
  })
})
