import { describe, it, expect } from 'vitest'
import { parseContentDispositionFilename } from '@/utils/skillFileTree'

/**
 * 技能包导出文件名解析（Content-Disposition → 中文文件名）纯逻辑单测。
 * 2026-09-12 审计 T34 自 skillFileTree.test.js 拆出（切片4，6 条原样不减）。
 * 注：消费方 api/skillFiles.js exportSkillZip 属历史后端契约路径（demo 走 mock 直出 zip），
 * 本 util 去留随审计 J3 一并裁决，此处只留档不增减。
 */

describe('parseContentDispositionFilename（导出文件名解析，切片4）', () => {
  it('优先 RFC5987 filename*=UTF-8\'\'<编码> → 解码中文', () => {
    // 「客户回访.zip」percent-encoded
    const encoded = encodeURIComponent('客户回访.zip')
    const header = `attachment; filename="skill.zip"; filename*=UTF-8''${encoded}`
    expect(parseContentDispositionFilename(header)).toBe('客户回访.zip')
  })
  it('filename* charset 大小写不敏感', () => {
    const encoded = encodeURIComponent('技能包.zip')
    expect(
      parseContentDispositionFilename(`attachment; filename*=utf-8''${encoded}`)
    ).toBe('技能包.zip')
  })
  it('无 filename* → 回落普通 filename="..."', () => {
    expect(parseContentDispositionFilename('attachment; filename="my-skill.zip"')).toBe(
      'my-skill.zip'
    )
  })
  it('filename 无引号也能取', () => {
    expect(parseContentDispositionFilename('attachment; filename=plain.zip')).toBe('plain.zip')
  })
  it('filename* 解码失败 → 回落 filename=', () => {
    // 非法 percent 序列 %ZZ → decodeURIComponent 抛 → 回落 filename
    const header = "attachment; filename=\"safe.zip\"; filename*=UTF-8''%ZZbad"
    expect(parseContentDispositionFilename(header)).toBe('safe.zip')
  })
  it('空头 / 无法解析 → 回落默认名', () => {
    expect(parseContentDispositionFilename('', 'fallback.zip')).toBe('fallback.zip')
    expect(parseContentDispositionFilename('attachment', 'fallback.zip')).toBe('fallback.zip')
  })
})
