import { describe, it, expect } from 'vitest'
import { splitFrontmatter, detectFrontmatterBareSeparator, joinFrontmatter, balanceCodeFences } from '@/utils/skillFileTree'

/**
 * 技能包 SKILL.md 正文处理纯逻辑单测 · frontmatter 拆分 / 拼回 + 未闭合代码围栏修复。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.5（SKILL.md 编辑器）；
 * 审计 T34 自 skillFileTree.test.js 拆出（frontmatter 拆分/拼回 P3 + balanceCodeFences #6），用例原样不减。
 */

describe('frontmatter 拆分 / 拼回（P3）', () => {
  const md = `---\nname: 客户回访\ndescription: 回访技能\nlicense: MIT\nmetadata:\n  triggers:\n    - 回访\n---\n# 正文标题\n\n办事流程…`

  it('splitFrontmatter：剥离首块 frontmatter，body 不含 frontmatter', () => {
    const r = splitFrontmatter(md)
    expect(r.hasFrontmatter).toBe(true)
    expect(r.frontmatter).toContain('name: 客户回访')
    expect(r.frontmatter).toContain('license: MIT')
    expect(r.body.startsWith('# 正文标题')).toBe(true)
    expect(r.body).not.toContain('name:')
  })

  it('无 frontmatter 的 SKILL.md → hasFrontmatter=false，body=原文（兼容）', () => {
    const plain = '# 直接正文\n没有 frontmatter'
    const r = splitFrontmatter(plain)
    expect(r.hasFrontmatter).toBe(false)
    expect(r.body).toBe(plain)
    expect(r.frontmatter).toBe('')
  })

  it('§12.8：前导空行 + --- → 识别为 frontmatter（容忍首个非空行为 ---）', () => {
    const r = splitFrontmatter('\n\n---\nname: x\n---\nbody')
    expect(r.hasFrontmatter).toBe(true)
    expect(r.frontmatter).toBe('name: x')
    expect(r.body).toBe('body')
  })

  it('§12.8 边界：正文中间的 --- 分隔线不误判（首个非空行不是 ---）', () => {
    const r = splitFrontmatter('# 标题\n正文\n\n---\n分隔线后续')
    expect(r.hasFrontmatter).toBe(false)
    expect(r.body).toContain('---')
  })

  it('首个非空行是普通文字 → 不视为 frontmatter', () => {
    const r = splitFrontmatter('\n\n前面有空行后是文字\n---\nname: x\n---\nbody')
    expect(r.hasFrontmatter).toBe(false)
  })

  it('#6 未闭合 frontmatter 兜底：开头 --- + 连续 YAML 行无闭合 → 剥离为 frontmatter，YAML 不漏进正文', () => {
    const r = splitFrontmatter('---\nname: x\ndescription: d\n# 没有闭合')
    expect(r.hasFrontmatter).toBe(true)
    expect(r.frontmatter).toContain('name: x')
    expect(r.frontmatter).toContain('description: d')
    // body 不含 YAML 键行（不会被当正文渲染），从首个非 YAML 行（# 标题）起
    expect(r.body).toBe('# 没有闭合')
    expect(r.body).not.toContain('name:')
  })

  it('#6 未闭合 + 空行分隔：YAML 区到空行止，空行后正文（含 ## 标题）作 body', () => {
    const r = splitFrontmatter('---\nname: x\nversion: 1.0\n\n# 标题\n## 子节\n正文')
    expect(r.hasFrontmatter).toBe(true)
    expect(r.frontmatter).toContain('version: 1.0')
    expect(r.body.startsWith('# 标题')).toBe(true)
    expect(r.body).not.toContain('name:')
  })

  it('#6 兜底拼回：未闭合 frontmatter split→join 后补回闭合 ---（顺带修复畸形内容）', () => {
    const r = splitFrontmatter('---\nname: x\n# 标题')
    const fixed = joinFrontmatter(r.frontmatter, r.body)
    // 拼回产物有完整闭合的 frontmatter 块（首字节 --- + 闭合 ---）
    expect(fixed.startsWith('---\n')).toBe(true)
    expect((fixed.match(/^---$/gm) || []).length).toBe(2) // 恰两条 --- 围栏
    expect(fixed).toContain('name: x')
    expect(fixed).toContain('# 标题')
  })

  it('开头 --- 后紧跟正文（无 YAML 行）→ 不误判为 frontmatter（lone --- 当 hr/正文）', () => {
    const r = splitFrontmatter('---\n# 直接标题\n正文')
    expect(r.hasFrontmatter).toBe(false)
    expect(r.body).toContain('# 直接标题')
  })

  describe('detectFrontmatterBareSeparator（组④补强：裸 --- 边界软提示）', () => {
    it('frontmatter 内裸 --- 提前闭合（其后 body 仍像 YAML 键值）→ 检出并给行号', () => {
      // 作者本意 name/sep/description 都是 frontmatter，但中间一行裸 --- 被当闭合 → description 漏到 body。
      const md = '---\nname: x\n---\ndescription: 会被当正文\n---\n# 真正文'
      const r = detectFrontmatterBareSeparator(md)
      expect(r).not.toBeNull()
      expect(r.line).toBe(3) // 裸 --- 在第 3 行
      expect(r.message).toMatch(/---/)
    })

    it('正常 frontmatter（闭合后是正文）→ 不误报', () => {
      expect(detectFrontmatterBareSeparator('---\nname: x\n---\n# 标题\n正文')).toBeNull()
      expect(detectFrontmatterBareSeparator('---\nname: x\ndescription: d\n---\n正文段落')).toBeNull()
    })

    it('无 frontmatter / 无闭合 → 不触发（非本场景）', () => {
      expect(detectFrontmatterBareSeparator('# 直接正文')).toBeNull()
      expect(detectFrontmatterBareSeparator('---\nname: x\n# 没闭合')).toBeNull()
    })

    it('闭合后是列表/标题等正常 markdown → 不误报', () => {
      expect(detectFrontmatterBareSeparator('---\nname: x\n---\n- 列表项')).toBeNull()
      expect(detectFrontmatterBareSeparator('---\nname: x\n---\n## 子标题')).toBeNull()
    })
  })

  it('joinFrontmatter：首字节恒 ---\\n（与后端 B5 一致），含 frontmatter+body', () => {
    const out = joinFrontmatter('name: x\nlicense: MIT', '# 正文')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('name: x')
    expect(out).toContain('license: MIT')
    expect(out).toContain('# 正文')
  })

  it('joinFrontmatter：frontmatter 为空也输出空块（保首字节契约 + 后端可回写受管键）', () => {
    const out = joinFrontmatter('', '# 正文')
    expect(out).toBe('---\n---\n# 正文')
    expect(out.startsWith('---\n')).toBe(true)
  })

  it('往返不丢非受管键：split→join 保留 license / metadata（拼回后再拆等价）', () => {
    const r = splitFrontmatter(md)
    const rejoined = joinFrontmatter(r.frontmatter, r.body)
    expect(rejoined.startsWith('---\n')).toBe(true)
    const r2 = splitFrontmatter(rejoined)
    expect(r2.frontmatter).toBe(r.frontmatter) // frontmatter 原样不变形
    expect(r2.body).toBe(r.body) // body 原样不变形
    expect(rejoined).toContain('license: MIT')
    expect(rejoined).toContain('triggers:')
  })

  // §12 解耦：撤销受管键双向同步——readFrontmatterName/writeFrontmatterName/read+writeFrontmatterScalar
  // 已删除，对应用例随之移除。frontmatter 折叠区改为纯 raw 编辑，仅依赖 split/joinFrontmatter。
})

describe('balanceCodeFences（#6 未闭合代码围栏修复：上半渲染/下半源码）', () => {
  it('【架构师 CR】≥2 级才补：块内含 `# shell 注释`(1级#) 不收尾、`## 真标题`(2级) 前才补闭栏', () => {
    // 未闭合 ``` 块内有 `# 注释`（高频代码注释），其后才是真章节 `## 真标题`
    const md = '# 文档\n说明:\n```\n# shell 注释行\necho hi\n## 真标题\n正文'
    const out = balanceCodeFences(md)
    const idxComment = out.indexOf('# shell 注释行')
    const idxHeading = out.indexOf('## 真标题')
    const idxOpen = out.indexOf('```\n# shell')
    const idxClose = out.indexOf('```', idxOpen + 3)
    // 闭合围栏在「## 真标题」之前、在「# shell 注释行」之后（不在 1 级 # 处提前收尾）
    expect(idxClose).toBeGreaterThan(idxComment) // 不在 # 注释处收尾
    expect(idxClose).toBeLessThan(idxHeading) // 在 ## 真标题前才补
    // # shell 注释行 仍在代码块内（没被当标题切走）
    expect(out.slice(idxOpen, idxClose)).toContain('# shell 注释行')
    expect(out.slice(idxOpen, idxClose)).toContain('echo hi')
  })

  it('未闭合 ``` + 后续 ATX 标题 → 在标题前补闭合围栏，标题恢复渲染（不再被吞进 code）', () => {
    const md = '# T\n## 核心\n示例:\n```\nsome code\n### 原则 2\n## 处理流程\n### Phase 1'
    const out = balanceCodeFences(md)
    // 在「### 原则 2」前补了一条闭合 ```，使其后标题脱离 code block
    const idxFence = out.indexOf('```\nsome code')
    const idxClose = out.indexOf('```', idxFence + 3)
    const idxHeading = out.indexOf('### 原则 2')
    expect(idxClose).toBeGreaterThan(0)
    expect(idxClose).toBeLessThan(idxHeading) // 闭合围栏在标题之前
    // some code 仍在围栏内（保留代码）
    expect(out).toContain('some code')
  })

  it('未闭合 ~~~ 同理修复', () => {
    const md = '# T\n~~~\ncode\n### 标题\n正文'
    const out = balanceCodeFences(md)
    expect(out.indexOf('~~~', out.indexOf('~~~') + 3)).toBeLessThan(out.indexOf('### 标题'))
  })

  it('已正确配对的围栏 → 原样不动（幂等）', () => {
    const md = '# T\n```\ncode\n```\n## 标题\n正文'
    expect(balanceCodeFences(md)).toBe(md)
    expect(balanceCodeFences(balanceCodeFences(md))).toBe(md)
  })

  it('未闭合围栏但后续无标题（纯代码到底）→ 不动（尊重整段代码意图）', () => {
    const md = '# T\n```\nline1\nline2\nline3'
    expect(balanceCodeFences(md)).toBe(md)
  })

  it('无围栏的普通长文 → 原样不动；行内反引号不误伤', () => {
    const md = '# T\n这是 `inline code` 和普通文字\n## 标题\n正文'
    expect(balanceCodeFences(md)).toBe(md)
  })

  it('修复后整篇重过 split：标题数恢复（长文/多标题/多 --- 不丢渲染回归）', () => {
    const md = '# H1\n---\n## H2a\n### H3a\n```\ncode\n### H3b\n## H2b\n### H3c'
    const out = balanceCodeFences(md)
    // 修复后 ### H3b / ## H2b / ### H3c 都在 code 围栏之外（其前有补的闭合 ```）
    const fenceOpen = out.indexOf('```\ncode')
    const fenceClose = out.indexOf('```', fenceOpen + 3)
    expect(out.indexOf('### H3b')).toBeGreaterThan(fenceClose) // H3b 在闭栏后
    expect(out).toContain('## H2b')
    expect(out).toContain('### H3c')
  })

  it('空/纯空白 → 原样', () => {
    expect(balanceCodeFences('')).toBe('')
    expect(balanceCodeFences('   ')).toBe('   ')
  })
})
