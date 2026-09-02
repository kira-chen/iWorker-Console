// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

/**
 * Markdown 输入语法（input rules）保障测试 —— 针对全平台共用的 Markdown 编辑器
 * （SkillMilkdownCore → commonmark/gfm 预设）。
 *
 * 【为什么是这种写法】「# 空格 → 一级标题」这类能力由 Milkdown 的 commonmark 预设内建，
 * 不是本仓自己实现的；真正的风险是**被我们自己关掉或覆盖**——比如误删 .use(commonmark)、
 * 自定义 $inputRule 抢占了同一前缀、或 keymap 拦了空格键。故本测试不去 mock 编辑器，
 * 而是直接对**真实预设**断言输入规则确实存在，并对 Core 的插件注册做静态守卫。
 *
 * 覆盖的语法（commonmark/gfm 预设内建）：
 *   # 空格      → 一~六级标题
 *   - / * / +   → 无序列表
 *   1. 空格     → 有序列表
 *   > 空格      → 引用块
 *   ``` 语言    → 代码块
 *   ---         → 分割线
 *   **粗** *斜* → 行内标记
 */

describe('Markdown 输入规则 · commonmark 预设内建能力', () => {
  it('预设导出了标题输入规则（# + 空格）', async () => {
    const mod = await import('@milkdown/kit/preset/commonmark')
    expect(mod.wrapInHeadingInputRule).toBeTruthy()
    expect(mod.commonmark).toBeTruthy()
  })

  it('预设导出了列表 / 引用 / 代码块 / 分割线的输入规则', async () => {
    const mod = await import('@milkdown/kit/preset/commonmark')
    // 这些是预设公开导出的 $inputRule 实例；缺任一项说明依赖被降级或换实现了
    for (const key of [
      'wrapInBulletListInputRule',
      'wrapInOrderedListInputRule',
      'wrapInBlockquoteInputRule',
      'createCodeBlockInputRule',
      'insertHrInputRule'
    ]) {
      expect(mod[key], `缺少 ${key}`).toBeTruthy()
    }
  })

  it('预设导出了行内标记输入规则（**粗体** / *斜体* / `代码`）', async () => {
    const mod = await import('@milkdown/kit/preset/commonmark')
    for (const key of ['strongInputRule', 'emphasisStarInputRule', 'emphasisUnderscoreInputRule', 'inlineCodeInputRule']) {
      expect(mod[key], `缺少 ${key}`).toBeTruthy()
    }
  })

  it('gfm 预设可用（表格 / 删除线等扩展语法）', async () => {
    const mod = await import('@milkdown/kit/preset/gfm')
    expect(mod.gfm).toBeTruthy()
  })
})

describe('Markdown 输入规则 · 本仓接线守卫', () => {
  it('Core 注册了 commonmark 与 gfm 预设（删掉任一项，全平台 Markdown 输入语法即失效）', async () => {
    const src = (await import('../SkillMilkdownCore.vue?raw')).default
    // 逐行剔除注释再断言——否则「// .use(commonmark)」这种注释掉的写法也会被 toContain 命中，
    // 断言就成了摆设（初版即如此，注释掉预设后测试仍全绿，故改成这样）。
    const active = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
      .join('\n')
    expect(active).toContain('.use(commonmark)')
    expect(active).toContain('.use(gfm)')
  })

  it('自定义输入规则只认 @tool[...]，不与 Markdown 前缀（#、-、>、数字.）冲突', async () => {
    const src = (await import('../SkillMilkdownCore.vue?raw')).default
    // 本仓仅此一条自定义 InputRule；其正则以 @tool[ 开头，与 Markdown 行首前缀无交集。
    const rules = src.match(/new InputRule\(([^,]+),/g) || []
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('@tool')
  })

  it('未通过 keymap/handleKeyDown 拦截空格键（输入规则靠空格触发）', async () => {
    const src = (await import('../SkillMilkdownCore.vue?raw')).default
    expect(src).not.toContain('handleKeyDown')
    expect(src).not.toMatch(/['"]Space['"]\s*:/)
  })
})
