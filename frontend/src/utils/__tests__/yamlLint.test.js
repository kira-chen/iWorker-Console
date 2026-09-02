import { describe, it, expect } from 'vitest'
import { lintYaml, analyzeFrontmatter, MAX_FRONTMATTER_BYTES } from '@/utils/yamlLint'

/**
 * 组④ frontmatter 轻量 YAML 校验（零依赖，最小结构校验）。
 * 保守口径：拦明显坏法，合法/拿不准的不误报。
 */
describe('lintYaml', () => {
  it('空 / 纯空白 → 合法（null）', () => {
    expect(lintYaml('')).toBeNull()
    expect(lintYaml('   \n  ')).toBeNull()
  })

  it('正常 frontmatter → 合法', () => {
    expect(lintYaml('name: 我的技能\ndescription: 办事用')).toBeNull()
    expect(lintYaml('name: x\ntags:\n  - a\n  - b')).toBeNull()
    expect(lintYaml('# 注释\nname: x')).toBeNull()
  })

  it('tab 缩进 → 报错（指出行号）', () => {
    const err = lintYaml('name: x\n\ttag: y')
    expect(err).not.toBeNull()
    expect(err.line).toBe(2)
    expect(err.message).toMatch(/Tab/)
  })

  it('顶层重复键 → 报错（大白话，含键名）', () => {
    const err = lintYaml('name: a\ndescription: b\nname: c')
    expect(err).not.toBeNull()
    expect(err.line).toBe(3)
    expect(err.message).toMatch(/出现了两次|name/)
  })

  it('键后缺冒号（key value）→ 报错', () => {
    const err = lintYaml('name 我的技能')
    expect(err).not.toBeNull()
    expect(err.message).toMatch(/冒号/)
  })

  it('未闭合双引号 → 报错', () => {
    const err = lintYaml('name: "未闭合')
    expect(err).not.toBeNull()
    expect(err.message).toMatch(/双引号/)
  })

  it('未闭合单引号 → 报错', () => {
    const err = lintYaml("name: '未闭合")
    expect(err).not.toBeNull()
    expect(err.message).toMatch(/单引号/)
  })

  it('引号内的冒号 / # 不误判', () => {
    expect(lintYaml('url: "http://example.com"')).toBeNull()
    expect(lintYaml('note: "a # 不是注释"')).toBeNull()
  })

  it('块标量（|）后的缩进正文不逐行误报', () => {
    expect(lintYaml('body: |\n  这是多行文本\n  第二行没有冒号也合法')).toBeNull()
  })

  it('列表项不要求冒号', () => {
    expect(lintYaml('tags:\n  - 纯文本项\n  - 另一项')).toBeNull()
  })
})

/* ============================ analyzeFrontmatter：真解析 + 字段级校验（2026-07-15 需求定案） ============================ */

describe('analyzeFrontmatter', () => {
  const OK_SAMPLE =
    'name: customer-insight\n' +
    'description: 深挖单个客户的公开动态，提炼值得跟进的变化和可聊话题\n' +
    'license: MIT\n' +
    'compatibility: claude-code\n' +
    'metadata:\n' +
    '  author: someone\n' +
    "allowed-tools: ['bash']"

  it('合规样例（6 个闭集字段齐全）→ 无错误', () => {
    expect(analyzeFrontmatter(OK_SAMPLE).errors).toEqual([])
  })

  it('最小合规样例（仅 name + description）→ 无错误', () => {
    expect(analyzeFrontmatter('name: a\ndescription: 办事').errors).toEqual([])
  })

  /* ---------- name 独立规则 ---------- */

  it('name 缺失 → 必填报错', () => {
    const r = analyzeFrontmatter('description: x')
    expect(r.errors.some((e) => e.message.includes('缺少 name'))).toBe(true)
  })

  it('name 含中文/大写/下划线 → 字符集报错（带行号）', () => {
    for (const bad of ['客户洞察', 'My-Skill', 'sk_abc', 'a b']) {
      const r = analyzeFrontmatter(`name: ${bad}\ndescription: x`)
      expect(r.errors.length).toBe(1)
      expect(r.errors[0].message).toMatch(/小写字母/)
      expect(r.errors[0].line).toBe(1)
    }
  })

  it('name 超 64 字符 → 长度报错', () => {
    const r = analyzeFrontmatter(`name: ${'a'.repeat(65)}\ndescription: x`)
    expect(r.errors[0].message).toMatch(/1-64/)
  })

  it('name 以连字符开头/结尾 → 报错', () => {
    for (const bad of ['-abc', 'abc-']) {
      const r = analyzeFrontmatter(`name: ${bad}\ndescription: x`)
      expect(r.errors[0].message).toMatch(/开头或结尾/)
    }
  })

  it('name 含连续连字符 → 报错', () => {
    const r = analyzeFrontmatter('name: a--b\ndescription: x')
    expect(r.errors[0].message).toMatch(/连续的连字符/)
  })

  it('name 为空/非文本 → 报错', () => {
    expect(analyzeFrontmatter('name:\ndescription: x').errors[0].message).toMatch(/name/)
    expect(analyzeFrontmatter('name: [a, b]\ndescription: x').errors[0].message).toMatch(/一行文本/)
  })

  it('name 合规边界：单字符、64 字符、中间单连字符 → 通过', () => {
    for (const good of ['a', 'a'.repeat(64), 'a-b-c', 'abc123']) {
      expect(analyzeFrontmatter(`name: ${good}\ndescription: x`).errors).toEqual([])
    }
  })

  /* ---------- description 必填 ---------- */

  it('description 缺失/为空 → 必填报错', () => {
    expect(analyzeFrontmatter('name: a').errors.some((e) => e.message.includes('缺少 description'))).toBe(true)
    expect(analyzeFrontmatter('name: a\ndescription:').errors[0].message).toMatch(/description 不能为空/)
  })

  it('空 frontmatter → name 与 description 双必填报错', () => {
    const r = analyzeFrontmatter('')
    expect(r.errors.length).toBe(2)
    expect(r.errors[0].message).toMatch(/缺少 name/)
    expect(r.errors[1].message).toMatch(/缺少 description/)
  })

  /* ---------- 顶层字段闭集 ---------- */

  it('闭集外字段（version/foo）→ 逐个提示（带行号），文案为「建议移入 metadata」而非「不支持」', () => {
    const r = analyzeFrontmatter('name: a\ndescription: x\nversion: 1.0.0\nfoo: bar')
    const msgs = r.errors.map((e) => e.message)
    expect(msgs.some((m) => m.includes('「version」') && m.includes('建议移入 metadata'))).toBe(true)
    expect(msgs.some((m) => m.includes('「foo」'))).toBe(true)
    expect(msgs.some((m) => m.includes('不支持'))).toBe(false)
    expect(r.errors.find((e) => e.message.includes('「version」')).line).toBe(3)
  })

  it('一级与 metadata 同名冲突 → 提示手动合并（区别于普通非官方字段文案）', () => {
    const r = analyzeFrontmatter(
      'name: a\ndescription: x\ndisplay_name: 甲\nversion: 1.0.0\nmetadata:\n  display_name: 乙'
    )
    const msgs = r.errors.map((e) => e.message)
    // display_name 冲突 → 合并提示；version 无冲突 → 建议移入 metadata。
    expect(msgs.some((m) => m.includes('「display_name」') && m.includes('同时存在') && m.includes('手动保留一处'))).toBe(true)
    expect(msgs.some((m) => m.includes('「version」') && m.includes('建议移入 metadata'))).toBe(true)
  })

  it('metadata 非映射时不按冲突判定：非官方字段仍走「建议移入」文案', () => {
    const r = analyzeFrontmatter('name: a\ndescription: x\ndisplay_name: 甲\nmetadata: 标量')
    const msgs = r.errors.map((e) => e.message)
    expect(msgs.some((m) => m.includes('「display_name」') && m.includes('建议移入 metadata'))).toBe(true)
  })

  it('metadata 下子键不受闭集限制', () => {
    expect(analyzeFrontmatter('name: a\ndescription: x\nmetadata:\n  foo: bar\n  triggers: [x]').errors).toEqual([])
  })

  /* ---------- 格式错误（真解析为准） ---------- */

  it('lintYaml 能抓的坏法 → 报错且沿用其中文文案（真解析也失败时才借用）', () => {
    const r = analyzeFrontmatter('name: a\nname: b')
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].message).toMatch(/出现了两次/)
    expect(r.errors[0].line).toBe(2)
  })

  it('仅真解析能抓的坏法（流集合缺闭合）→ 报错，且跳过字段级校验', () => {
    const r = analyzeFrontmatter('metadata:\n  triggers: ["记一下", "拜访记录"\nname: 大写不合规')
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].message).toMatch(/YAML 格式有误/)
  })

  it('多行中文 plain scalar 含引号（存量实锤样本）→ 不误报格式错', () => {
    // lintYaml 启发式会把中文正文里的引号按「不配对」误报——格式错误须以真解析为准（存量技能实测回归）。
    const legacy =
      'name: legacy-skill\n' +
      'description: 深挖单个客户的公开动态。当用户说"帮我看看 X 客户最近啥动态""X\n' +
      '  有 没有新的招投标"时使用。\n' +
      'metadata:\n' +
      '  triggers:\n' +
      '  - 帮我看看 X 客户最近啥动态'
    expect(analyzeFrontmatter(legacy).errors).toEqual([])
  })

  it('超长（>32KB，UTF-8 字节计）→ 报错且跳过解析', () => {
    expect(analyzeFrontmatter('x'.repeat(MAX_FRONTMATTER_BYTES + 1)).errors[0].message).toMatch(/过长/)
    // 12K 个中文 ≈ 36KB > 32KB，字符数只有 12K —— 须按字节判超长。
    expect(analyzeFrontmatter('注'.repeat(12 * 1024)).errors[0].message).toMatch(/过长/)
  })

  it('别名炸弹（引用展开超限）→ 报错，不卡死', () => {
    const bomb =
      'a: &a ["x","x","x","x","x","x","x","x","x"]\n' +
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\n' +
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\n' +
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]\n' +
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]'
    const r = analyzeFrontmatter(bomb)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].message).toMatch(/引用展开过多|结构过深/)
  })
})
