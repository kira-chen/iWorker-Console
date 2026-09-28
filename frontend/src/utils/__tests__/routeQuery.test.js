import { describe, it, expect } from 'vitest'
import { queryString } from '@/utils/routeQuery'

/**
 * queryString（2026-09-23 待办 yuepu#22）：vue-router 的 query 值是 string | string[] | null，
 * 同名参数重复（?keyword=a&keyword=b）即为数组，直接 .trim() 会抛 TypeError 白屏。
 */
describe('queryString · 路由 query 取值归一', () => {
  it('字符串原样返回', () => {
    expect(queryString('销售')).toBe('销售')
    expect(queryString('')).toBe('')
  })

  it('重复参数（数组）取第一个，其余忽略', () => {
    expect(queryString(['a', 'b'])).toBe('a')
    expect(queryString(['  x  ', 'y'])).toBe('  x  ') // 只归一类型，不 trim（trim 是各页自己的事）
  })

  it('缺省 / null / 空数组 → 空串，且返回值恒可 .trim()', () => {
    for (const v of [undefined, null, []]) {
      expect(queryString(v)).toBe('')
      expect(() => queryString(v).trim()).not.toThrow()
    }
  })

  it('数组里的 null（?keyword 无值）→ 空串', () => {
    expect(queryString([null])).toBe('')
  })
})
