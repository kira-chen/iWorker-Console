import { describe, it, expect } from 'vitest'
import { pinyinOf } from '@/utils/pinyinTable'

/**
 * 常用字拼音表（产品优化需求-202611 修改点 5（R10），采集字段 key 按完整拼音生成的数据底座）。
 * 1. 覆盖 GB2312 一级常用字全部 3755 个，每个字都能查到拼音；
 * 2. 查到的拼音只含小写字母（ü 写作 v），可直接拼进字段 key；
 * 3. 多音字取常用读音，表外字符返回空串。
 */

// GB2312 一级常用字：区位 16–55 区（0xB0A1–0xD7F9），用 Node 自带的 GB18030 解码器还原成汉字
function gb2312Level1() {
  const td = new TextDecoder('gb18030')
  const out = []
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      if (hi === 0xd7 && lo > 0xf9) continue
      out.push(td.decode(new Uint8Array([hi, lo])))
    }
  }
  return out
}

describe('pinyinTable · 常用字拼音表（R10）', () => {
  it('覆盖 GB2312 一级常用字 3755 个，逐字都能查到拼音', () => {
    const chars = gb2312Level1()
    expect(chars).toHaveLength(3755)
    expect(chars.filter((c) => !pinyinOf(c))).toEqual([])
  })

  it('拼音只含小写字母，ü 写作 v（绿→lv、女→nv）', () => {
    const bad = gb2312Level1().filter((c) => !/^[a-z]+$/.test(pinyinOf(c)))
    expect(bad).toEqual([])
    expect(pinyinOf('绿')).toBe('lv')
    expect(pinyinOf('女')).toBe('nv')
  })

  it('多音字取常用读音：行→xing、长→chang、重→zhong、了→le、仔→zi', () => {
    expect(['行', '长', '重', '了', '仔'].map(pinyinOf)).toEqual(['xing', 'chang', 'zhong', 'le', 'zi'])
  })

  it('非汉字、表外字符返回空串', () => {
    expect(pinyinOf('a')).toBe('')
    expect(pinyinOf('（')).toBe('')
    expect(pinyinOf('')).toBe('')
  })
})
