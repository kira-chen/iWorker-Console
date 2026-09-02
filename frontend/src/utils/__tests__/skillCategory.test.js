import { describe, it, expect } from 'vitest'
import {
  SKILL_CATEGORY,
  categoryLabel,
  categoryTagType,
  hasCategory
} from '@/utils/skillCategory'

describe('skillCategory', () => {
  it('categoryLabel maps OPERATION/QUERY to 中文', () => {
    expect(categoryLabel(SKILL_CATEGORY.OPERATION)).toBe('操作类')
    expect(categoryLabel(SKILL_CATEGORY.QUERY)).toBe('查询类')
  })

  it('categoryLabel returns null for unknown/empty', () => {
    expect(categoryLabel(null)).toBeNull()
    expect(categoryLabel(undefined)).toBeNull()
    expect(categoryLabel('')).toBeNull()
    expect(categoryLabel('FOO')).toBeNull()
  })

  it('categoryTagType: 操作类=warning(警示), 查询类/其它=info(中性)', () => {
    expect(categoryTagType(SKILL_CATEGORY.OPERATION)).toBe('warning')
    expect(categoryTagType(SKILL_CATEGORY.QUERY)).toBe('info')
    expect(categoryTagType(null)).toBe('info')
  })

  it('hasCategory only true for known values', () => {
    expect(hasCategory(SKILL_CATEGORY.OPERATION)).toBe(true)
    expect(hasCategory(SKILL_CATEGORY.QUERY)).toBe(true)
    expect(hasCategory(null)).toBe(false)
    expect(hasCategory('FOO')).toBe(false)
  })
})
