import { describe, it, expect } from 'vitest'
import { iconIsUrl } from '@/utils/iconDisplay'

/**
 * utils/iconDisplay.js iconIsUrl 单测（2026-09-12 测试审计 T54 补缺口）。
 * 全站图标字段三种取值：字符/emoji（直接文本渲染）、图标库路径或 http(s) URL、裁剪上传产物 data:image/… dataURL。
 * 9 个列表页 + IconField 都据此决定「<img> 还是文本」——判错一处就是整列图标裂图或裸 URL 字符串。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §二.1 L40「技能名：展示图标」/ §三.4 图标（上传或图标库）。
 */
describe('iconIsUrl：字符/emoji → 文本渲染；http(s) / 站内路径 / data:image → <img>', () => {
  it('emoji、单字符、普通文字、空值 → false（走文本渲染）', () => {
    expect(iconIsUrl('▤')).toBe(false)
    expect(iconIsUrl('🔧')).toBe(false)
    expect(iconIsUrl('技')).toBe(false)
    expect(iconIsUrl('')).toBe(false)
    expect(iconIsUrl(null)).toBe(false)
    expect(iconIsUrl(undefined)).toBe(false)
    expect(iconIsUrl(123)).toBe(false)
    // 形似但不是 URL：无协议域名 / 相对路径 / 非 image 的 data:
    expect(iconIsUrl('example.com/a.png')).toBe(false)
    expect(iconIsUrl('icons/a.png')).toBe(false)
    expect(iconIsUrl('data:text/plain;base64,QQ==')).toBe(false)
    expect(iconIsUrl('ftp://x/a.png')).toBe(false)
  })

  it('http(s) URL、以 / 开头的站内路径、data:image/ dataURL → true（走 <img>）', () => {
    expect(iconIsUrl('http://cdn.example.com/a.png')).toBe(true)
    expect(iconIsUrl('https://cdn.example.com/a.svg')).toBe(true)
    expect(iconIsUrl('/icons/skill/a.png')).toBe(true)
    expect(iconIsUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(iconIsUrl('data:image/svg+xml;utf8,<svg/>')).toBe(true)
  })
})
