import { describe, it, expect } from 'vitest'
import {
  SKILL_CATEGORY,
  categoryLabel,
  categoryTagType,
  hasCategory
} from '@/utils/skillCategory'

/**
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.3 L172：
 * 技能类别标签只读展示「操作类 / 查询类」，由工具引用自动派生。
 * 本文件守 skillCategory 工具的中文映射 / 语义色 / 已知值判定。
 */
describe('skillCategory', () => {
  it('categoryLabel：OPERATION→操作类、QUERY→查询类（md L172）', () => {
    expect(categoryLabel(SKILL_CATEGORY.OPERATION)).toBe('操作类')
    expect(categoryLabel(SKILL_CATEGORY.QUERY)).toBe('查询类')
  })

  it('categoryLabel：未知 / 空值 → null（标签不渲染）', () => {
    expect(categoryLabel(null)).toBeNull()
    expect(categoryLabel(undefined)).toBeNull()
    expect(categoryLabel('')).toBeNull()
    expect(categoryLabel('FOO')).toBeNull()
  })

  it('categoryTagType：操作类=warning(警示)，查询类/其它=info(中性)', () => {
    expect(categoryTagType(SKILL_CATEGORY.OPERATION)).toBe('warning')
    expect(categoryTagType(SKILL_CATEGORY.QUERY)).toBe('info')
    expect(categoryTagType(null)).toBe('info')
  })

  it('hasCategory：仅已知值为 true，null / 未知为 false', () => {
    expect(hasCategory(SKILL_CATEGORY.OPERATION)).toBe(true)
    expect(hasCategory(SKILL_CATEGORY.QUERY)).toBe(true)
    expect(hasCategory(null)).toBe(false)
    expect(hasCategory('FOO')).toBe(false)
  })
})
