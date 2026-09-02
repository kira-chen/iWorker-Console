import { describe, it, expect } from 'vitest'
import { parseAttachments } from '@/utils/attachments'

describe('parseAttachments · history 生成物 JSON 字符串解析（容错）', () => {
  it('合法 JSON 数组字符串 → 解析为数组', () => {
    const raw = '[{"name":"a.csv","type":"text/csv","size":12,"url":"/api/artifacts/sales/a.csv"}]'
    const arr = parseAttachments(raw)
    expect(arr).toHaveLength(1)
    expect(arr[0].name).toBe('a.csv')
  })

  it('null/undefined/空串 → []', () => {
    expect(parseAttachments(null)).toEqual([])
    expect(parseAttachments(undefined)).toEqual([])
    expect(parseAttachments('')).toEqual([])
    expect(parseAttachments('   ')).toEqual([])
  })

  it('非法 JSON → [] 不抛错', () => {
    expect(parseAttachments('{bad json')).toEqual([])
    expect(parseAttachments('not json at all')).toEqual([])
  })

  it('合法 JSON 但非数组（对象/数字）→ []', () => {
    expect(parseAttachments('{"name":"x"}')).toEqual([])
    expect(parseAttachments('42')).toEqual([])
  })

  it('已是数组 → 原样透传', () => {
    const arr = [{ name: 'a' }]
    expect(parseAttachments(arr)).toBe(arr)
  })
})
