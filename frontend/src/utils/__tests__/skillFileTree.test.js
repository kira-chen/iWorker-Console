import { describe, it, expect, afterEach } from 'vitest'
import { reactive, isReactive } from 'vue'
import {
  ENTRY_PATH,
  ALLOWED_EXTENSIONS,
  extOf,
  fileIconName,
  isMonoType,
  buildFileTree,
  collectFilePaths,
  validateNewFilePath,
  validateRenamePath,
  diffRemovedTools,
  isPublished,
  didRequeueForReview,
  isMdPath,
  parseContentDispositionFilename,
  splitFrontmatter,
  detectFrontmatterBareSeparator,
  joinFrontmatter,
  balanceCodeFences,
  joinPath,
  dirDepth,
  canCreateSubfolder,
  validateLeafFileName,
  validateFolderName,
  collectDirFiles,
  renameDirInPath,
  parentDirOf,
  collectAllDirs,
  lastSegOf,
  pathDepth,
  maxDepthInSubtree,
  validateMoveTarget,
  buildMoveContext,
  normalizeInputPath,
  setSkillPackageLimits
} from '@/utils/skillFileTree'

/**
 * 技能包目录树纯逻辑单测（切片3）。覆盖交互稿 P0-1/P1/Q2/Q3 关键护栏 + 构树/排序/图标。
 *
 * 深度上限 2026-08-04 起由后端树响应动态下发（默认 15）；本文件深度边界夹具按 6 层写就，
 * 故显式钉 6——验证的是边界机制与文案，而非默认值本身。
 */
setSkillPackageLimits({ maxPathDepth: 6 })

const files = [
  { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true, size: 10, sortOrder: -1 },
  { path: 'references/b.md', name: 'b.md', fileType: 'md', isEntry: false, size: 5, sortOrder: 1 },
  { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false, size: 5, sortOrder: 0 },
  { path: '_meta.json', name: '_meta.json', fileType: 'json', isEntry: false, size: 3, sortOrder: 2 },
  { path: 'notes.txt', name: 'notes.txt', fileType: 'txt', isEntry: false, size: 2, sortOrder: 3 }
]

describe('extOf / 图标 / 等宽', () => {
  it('extOf 取末段扩展名小写', () => {
    expect(extOf('references/policy.MD')).toBe('md')
    expect(extOf('a.json')).toBe('json')
    expect(extOf('noext')).toBe('')
  })
  it('fileIconName 映射 md→Document / json→DataLine / txt·yaml→Memo / 图片→Picture / 二进制→Files', () => {
    expect(fileIconName('md')).toBe('Document')
    expect(fileIconName('markdown')).toBe('Document')
    expect(fileIconName('json')).toBe('DataLine')
    expect(fileIconName('txt')).toBe('Memo')
    expect(fileIconName('yaml')).toBe('Memo')
    expect(fileIconName('png')).toBe('Picture')
    // 完整保真：非可编辑/未知类型（脚本/数据/二进制）→ Files（与可编辑文本 Document 区分）。
    expect(fileIconName('py')).toBe('Files')
    expect(fileIconName('xxx')).toBe('Files')
  })
  it('isMonoType 仅 json/txt 用等宽', () => {
    expect(isMonoType('json')).toBe(true)
    expect(isMonoType('txt')).toBe(true)
    expect(isMonoType('md')).toBe(false)
  })
})

describe('buildFileTree 构树 + 排序', () => {
  const tree = buildFileTree(files)

  it('SKILL.md 恒置顶（同级第一项）', () => {
    expect(tree[0].path).toBe('SKILL.md')
    expect(tree[0].isEntry).toBe(true)
  })
  it('目录节点前端合成（references），排在同级文件之前', () => {
    const refDir = tree.find((n) => n.isDir && n.name === 'references')
    expect(refDir).toBeTruthy()
    expect(refDir.children.length).toBe(2)
    // 目录在文件之前：references（dir）应排在 _meta.json / notes.txt（文件）之前
    const refIdx = tree.findIndex((n) => n.path === 'references')
    const metaIdx = tree.findIndex((n) => n.path === '_meta.json')
    expect(refIdx).toBeLessThan(metaIdx)
  })
  it('同级内按 name 字典序（a.md 在 b.md 之前）', () => {
    const refDir = tree.find((n) => n.isDir && n.name === 'references')
    expect(refDir.children[0].name).toBe('a.md')
    expect(refDir.children[1].name).toBe('b.md')
  })
  it('目录节点无后端 size/isEntry 语义、isDir=true', () => {
    const refDir = tree.find((n) => n.isDir)
    expect(refDir.isDir).toBe(true)
  })
  it('空 files → 空树（不崩）', () => {
    expect(buildFileTree([])).toEqual([])
    expect(buildFileTree(null)).toEqual([])
  })
  it('collectFilePaths 收集全部叶子 path（含 SKILL.md）', () => {
    expect(collectFilePaths(files)).toContain('SKILL.md')
    expect(collectFilePaths(files)).toContain('references/a.md')
    expect(collectFilePaths(files).length).toBe(5)
  })
})

describe('validateNewFilePath（P0-1 新建重名硬拦）', () => {
  const existing = collectFilePaths(files)

  it('空输入 → 拒', () => {
    expect(validateNewFilePath('', existing)).toMatch(/请输入/)
  })
  it('非白名单扩展名 → 拒', () => {
    expect(validateNewFilePath('a.exe', existing)).toMatch(/仅支持/)
  })
  it('大写扩展名 .MD → 提示扩展名需小写', () => {
    expect(validateNewFilePath('a.MD', existing)).toMatch(/小写/)
  })
  it('P0-1 重名硬拦：与现有 path 冲突（含 SKILL.md）必须阻止', () => {
    expect(validateNewFilePath('SKILL.md', existing)).toMatch(/已存在/)
    expect(validateNewFilePath('references/a.md', existing)).toMatch(/已存在/)
  })
  it('path 非法（前导 / / .. / 连续 //）→ 拒', () => {
    expect(validateNewFilePath('/a.md', existing)).toMatch(/不能以 \/ 开头/)
    expect(validateNewFilePath('../a.md', existing)).toMatch(/\.\./)
    expect(validateNewFilePath('a//b.md', existing)).toMatch(/连续/)
  })
  it('合法新文件 → 通过（返回 null）', () => {
    expect(validateNewFilePath('references/policy.md', existing)).toBeNull()
    expect(validateNewFilePath('new.json', existing)).toBeNull()
  })
})

describe('validateRenamePath（P1 改名冲突 / 改为 SKILL.md 拒）', () => {
  const existing = collectFilePaths(files)

  it('改为入口文件名 SKILL.md → 拒（P1）', () => {
    expect(validateRenamePath('SKILL.md', 'references/a.md', existing)).toMatch(/SKILL\.md/)
  })
  it('与他人 path 冲突（排除自身）→ 拒', () => {
    expect(validateRenamePath('references/b.md', 'references/a.md', existing)).toMatch(/已存在/)
  })
  it('名称未改变 → 提示（阻止空请求）', () => {
    expect(validateRenamePath('references/a.md', 'references/a.md', existing)).toMatch(/未改变/)
  })
  it('合法重命名/移动 → 通过', () => {
    expect(validateRenamePath('archive/a.md', 'references/a.md', existing)).toBeNull()
  })
  it('非白名单扩展名 → 拒', () => {
    expect(validateRenamePath('references/a.exe', 'references/a.md', existing)).toMatch(/仅支持/)
  })
})

describe('Q2 diffRemovedTools', () => {
  it('确有工具被移出 → 返回该工具', () => {
    const before = [{ code: 'biz__a', bizName: '工具A' }, { code: 'biz__b', bizName: '工具B' }]
    const after = [{ code: 'biz__a', bizName: '工具A' }]
    const removed = diffRemovedTools(before, after)
    expect(removed.length).toBe(1)
    expect(removed[0].code).toBe('biz__b')
  })
  it('无工具变动 → 空', () => {
    const same = [{ code: 'x' }]
    expect(diffRemovedTools(same, same)).toEqual([])
  })
  it('after 新增工具不算移出', () => {
    expect(diffRemovedTools([{ code: 'a' }], [{ code: 'a' }, { code: 'b' }])).toEqual([])
  })
})

describe('Q3 isPublished / didRequeueForReview', () => {
  it('isPublished：任一 target PUBLISHED 即已发布', () => {
    expect(isPublished([{ target: 'USER_END', status: 'PUBLISHED' }])).toBe(true)
    expect(isPublished([{ target: 'USER_END', status: 'PENDING_REVIEW' }])).toBe(false)
    expect(isPublished([])).toBe(false)
  })
  it('didRequeueForReview：PUBLISHED→PENDING_REVIEW 才判定退回', () => {
    const before = [{ target: 'USER_END', status: 'PUBLISHED' }]
    const after = [{ target: 'USER_END', status: 'PENDING_REVIEW' }]
    expect(didRequeueForReview(before, after)).toBe(true)
  })
  it('发布态未变（仍 PUBLISHED）→ 不判定退回', () => {
    const pub = [{ target: 'USER_END', status: 'PUBLISHED' }]
    expect(didRequeueForReview(pub, pub)).toBe(false)
  })
  it('操作前非 PUBLISHED（草稿/待审）→ 绝不判定退回', () => {
    const before = [{ target: 'USER_END', status: 'PENDING_REVIEW' }]
    const after = [{ target: 'USER_END', status: 'PENDING_REVIEW' }]
    expect(didRequeueForReview(before, after)).toBe(false)
  })
  it('R1 didRequeueForReview：干净→置脏（reviewPending false→true）判定触发', () => {
    const before = [{ target: 'USER_END', status: 'PUBLISHED' }]
    const after = [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: true, submitted: false }]
    expect(didRequeueForReview(before, after)).toBe(true)
  })
  it('R1 didRequeueForReview：在途提交被作废（submitted true→false）判定触发', () => {
    const before = [{ target: 'USER_END', status: 'PENDING_REVIEW', submitted: true }]
    const after = [{ target: 'USER_END', status: 'PENDING_REVIEW', submitted: false }]
    expect(didRequeueForReview(before, after)).toBe(true)
  })
  it('R1 didRequeueForReview：置脏态原样（已脏→仍脏）不重复判定', () => {
    const dirty = [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: true, submitted: false }]
    expect(didRequeueForReview(dirty, dirty)).toBe(false)
  })
  it('isMdPath：仅 .md 触发重审判定', () => {
    expect(isMdPath('references/a.md')).toBe(true)
    expect(isMdPath('SKILL.md')).toBe(true)
    expect(isMdPath('_meta.json')).toBe(false)
    expect(isMdPath('notes.txt')).toBe(false)
  })
})

describe('常量自检', () => {
  it('ENTRY_PATH = SKILL.md / 可编辑白名单 = md,markdown,txt,json,yaml,yml（与后端 editable-extensions 对齐）', () => {
    expect(ENTRY_PATH).toBe('SKILL.md')
    expect(ALLOWED_EXTENSIONS).toEqual(['md', 'markdown', 'txt', 'json', 'yaml', 'yml'])
  })
})

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

describe('深度预判 ≤6 含根（§13.1.2 / D，2026-07-15 放宽 5→6）', () => {
  it('6 层合法（含根，5 级文件夹）：a/b/c/d/e/f.md 通过', () => {
    expect(validateNewFilePath('a/b/c/d/e/f.md', [])).toBeNull()
  })
  it('7 层超限：a/b/c/d/e/f/g.md → 红字「最多 6 层」', () => {
    expect(validateNewFilePath('a/b/c/d/e/f/g.md', [])).toMatch(/最多 6 层/)
  })
  it('根文件 = 第 1 层：policy.md 通过', () => {
    expect(validateNewFilePath('policy.md', [])).toBeNull()
  })
  it('2 层：references/policy.md 通过', () => {
    expect(validateNewFilePath('references/policy.md', [])).toBeNull()
  })
  it('重命名同样深度预判：超 6 层 → 拒', () => {
    expect(validateRenamePath('a/b/c/d/e/f/g.md', 'x.md', [])).toMatch(/最多 6 层/)
    expect(validateRenamePath('a/b/c/d/e/f.md', 'x.md', [])).toBeNull()
  })
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

describe('#5 点击式层级：只输叶子名 + 文件夹操作', () => {
  const existing = ['SKILL.md', 'references/a.md', 'references/sub/note.md', '_meta.json']

  it('joinPath：根级=叶子名；目录下=dir/叶子', () => {
    expect(joinPath('', 'x.md')).toBe('x.md')
    expect(joinPath('references', 'x.md')).toBe('references/x.md')
    expect(joinPath('a/b', 'x.md')).toBe('a/b/x.md')
    expect(joinPath('references/', 'x.md')).toBe('references/x.md') // 容忍尾斜杠
  })

  it('dirDepth / canCreateSubfolder：深度 ≤6 含根；第 5 层目录不可再建子夹', () => {
    expect(dirDepth('')).toBe(0)
    expect(dirDepth('references')).toBe(1)
    expect(dirDepth('a/b/c/d/e')).toBe(5)
    // 根(0)+2=2≤6 可；a/b/c/d(4)+2=6 可；a/b/c/d/e(5)+2=7>6 不可
    expect(canCreateSubfolder('')).toBe(true)
    expect(canCreateSubfolder('a/b/c/d')).toBe(true)
    expect(canCreateSubfolder('a/b/c/d/e')).toBe(false)
  })

  it('validateLeafFileName：含 / 拒（引导新建子文件夹）', () => {
    expect(validateLeafFileName('sub/x.md', '', existing)).toMatch(/不能含 \/|新建子文件夹/)
  })
  it('validateLeafFileName：非白名单扩展名拒 / 大写拒', () => {
    expect(validateLeafFileName('x.exe', '', existing)).toMatch(/仅支持/)
    expect(validateLeafFileName('x.MD', '', existing)).toMatch(/小写/)
  })
  it('validateLeafFileName：P0-1 重名硬拦（join 后比对）', () => {
    expect(validateLeafFileName('a.md', 'references', existing)).toMatch(/已存在/) // references/a.md 已存在
    expect(validateLeafFileName('SKILL.md', '', existing)).toMatch(/已存在/) // 根级 SKILL.md 已存在
  })
  it('validateLeafFileName：合法叶子名通过；含 . 的正常文件名不被误拒', () => {
    expect(validateLeafFileName('new.md', 'references', existing)).toBeNull()
    expect(validateLeafFileName('policy.v2.md', '', existing)).toBeNull()
  })
  it('validateLeafFileName：深度超限（join 后 >6 层）拒', () => {
    expect(validateLeafFileName('f.md', 'a/b/c/d/x/y', existing)).toMatch(/最多 6 层/)
  })

  it('validateFolderName：单段合法；含 / / .. / 同级重名 / 未改名拒', () => {
    expect(validateFolderName('sub', ['refs'])).toBeNull()
    expect(validateFolderName('a/b', [])).toMatch(/不能含 \//)
    expect(validateFolderName('..', [])).toMatch(/不合法/)
    expect(validateFolderName('refs', ['refs', 'docs'])).toMatch(/已有同名/)
    expect(validateFolderName('refs', ['refs'], 'refs')).toMatch(/未改变/) // 重命名为自身
    expect(validateFolderName('newname', ['refs'], 'refs')).toBeNull() // 重命名排除自身
  })

  it('collectDirFiles：收集某目录下（含子孙）全部文件 path', () => {
    expect(collectDirFiles(existing, 'references').sort()).toEqual(
      ['references/a.md', 'references/sub/note.md'].sort()
    )
    expect(collectDirFiles(existing, 'references/sub')).toEqual(['references/sub/note.md'])
    expect(collectDirFiles(existing, '')).toEqual([]) // 根前缀为空 → 不收集
  })

  it('renameDirInPath：替换目录前缀段，得新 path', () => {
    expect(renameDirInPath('references/a.md', 'references', 'docs')).toBe('docs/a.md')
    expect(renameDirInPath('references/sub/note.md', 'references', 'docs')).toBe('docs/sub/note.md')
    expect(renameDirInPath('references/sub/note.md', 'references/sub', 'references/archive')).toBe(
      'references/archive/note.md'
    )
    // 不匹配前缀 → 原样
    expect(renameDirInPath('other/x.md', 'references', 'docs')).toBe('other/x.md')
    // CR-2：前缀须整段匹配（fromDir + '/'）——'ref' 不得误伤 'references'（防部分前缀回归）
    expect(renameDirInPath('references/a.md', 'ref', 'x')).toBe('references/a.md')
  })

  it('parentDirOf：取文件所在目录前缀（根级 → 空）', () => {
    expect(parentDirOf('SKILL.md')).toBe('')
    expect(parentDirOf('references/a.md')).toBe('references')
    expect(parentDirOf('a/b/c.md')).toBe('a/b')
  })
})

/* ============================ 目录结构能力：is_dir 占位 + 移动落点预判（F7/F8/F9） ============================ */

describe('buildFileTree 消费 is_dir 占位空目录', () => {
  it('注入持久化空目录占位行为目录节点', () => {
    const tree = buildFileTree([
      { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
      { path: 'emptydir', name: 'emptydir', isDir: true }
    ])
    const empty = tree.find((n) => n.name === 'emptydir')
    expect(empty).toBeTruthy()
    expect(empty.isDir).toBe(true)
    expect(empty.children).toEqual([])
  })

  it('同 path 去重：占位行与含文件合成目录不重复（含文件目录优先）', () => {
    const tree = buildFileTree([
      { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false },
      { path: 'references', name: 'references', isDir: true } // 占位行与合成目录同 path
    ])
    const refs = tree.filter((n) => n.name === 'references')
    expect(refs.length).toBe(1) // 不重复
    expect(refs[0].children.length).toBe(1) // 仍含 a.md（未被占位行覆盖清空）
  })

  it('多级空目录占位行：逐级合成目录节点', () => {
    const tree = buildFileTree([{ path: 'a/b/c', name: 'c', isDir: true }])
    const a = tree.find((n) => n.name === 'a')
    expect(a.isDir).toBe(true)
    const b = a.children.find((n) => n.name === 'b')
    expect(b.isDir).toBe(true)
    expect(b.children.find((n) => n.name === 'c')?.isDir).toBe(true)
  })
})

describe('collectAllDirs / lastSegOf / pathDepth / maxDepthInSubtree', () => {
  const FILES = [
    { path: 'SKILL.md', name: 'SKILL.md', isEntry: true },
    { path: 'references/a.md', name: 'a.md' },
    { path: 'references/sub/note.md', name: 'note.md' },
    { path: 'empty', name: 'empty', isDir: true }
  ]
  it('collectAllDirs：合成目录前缀 + 占位空目录', () => {
    const dirs = collectAllDirs(FILES).sort()
    expect(dirs).toEqual(['empty', 'references', 'references/sub'])
  })
  it('lastSegOf / pathDepth', () => {
    expect(lastSegOf('a/b/c.md')).toBe('c.md')
    expect(lastSegOf('x.md')).toBe('x.md')
    expect(pathDepth('SKILL.md')).toBe(1)
    expect(pathDepth('a/b/c.md')).toBe(3)
    expect(pathDepth('')).toBe(0)
  })
  it('maxDepthInSubtree：子树最深叶子层级', () => {
    expect(maxDepthInSubtree('references', FILES)).toBe(3) // references/sub/note.md
    expect(maxDepthInSubtree('empty', FILES)).toBe(1) // 空目录自身层级
  })
})

describe('validateMoveTarget 落点合法性预判（PRD §5.4 矩阵）', () => {
  const FILES = [
    { path: 'SKILL.md', name: 'SKILL.md', isEntry: true },
    { path: 'x.md', name: 'x.md' },
    { path: 'refs/a.md', name: 'a.md' },
    { path: 'refs/sub/note.md', name: 'note.md' },
    { path: 'dst', name: 'dst', isDir: true }
  ]

  it('合法：文件移入空目录', () => {
    expect(validateMoveTarget({ fromPath: 'x.md', isDir: false, toParentDir: 'dst', files: FILES })).toBeNull()
  })
  it('合法：文件从子目录移回根', () => {
    expect(validateMoveTarget({ fromPath: 'refs/a.md', isDir: false, toParentDir: '', files: FILES })).toBeNull()
  })
  it('SKILL.md 不可移动', () => {
    expect(validateMoveTarget({ fromPath: 'SKILL.md', isDir: false, toParentDir: 'refs', files: FILES })).toMatch(/入口文件/)
  })
  it('无意义移动（落点 = 当前所在目录）', () => {
    expect(validateMoveTarget({ fromPath: 'refs/a.md', isDir: false, toParentDir: 'refs', files: FILES })).toMatch(/已在该目录/)
  })
  it('循环移动：文件夹拖进自身', () => {
    expect(validateMoveTarget({ fromPath: 'refs', isDir: true, toParentDir: 'refs', files: FILES })).toMatch(/它自己/)
  })
  it('循环移动：文件夹拖进自身子孙', () => {
    expect(validateMoveTarget({ fromPath: 'refs', isDir: true, toParentDir: 'refs/sub', files: FILES })).toMatch(/它自己|子目录/)
  })
  it('目标同名文件冲突', () => {
    const f = [...FILES, { path: 'dst/a.md', name: 'a.md' }]
    expect(validateMoveTarget({ fromPath: 'refs/a.md', isDir: false, toParentDir: 'dst', files: f })).toMatch(/同名文件/)
  })
  it('目标同名子文件夹冲突', () => {
    const f = [...FILES, { path: 'dst/refs', name: 'refs', isDir: true }]
    expect(validateMoveTarget({ fromPath: 'refs', isDir: true, toParentDir: 'dst', files: f })).toMatch(/同名文件夹/)
  })
  it('超深度：移动文件夹后整子树最深叶子 > 6 层', () => {
    // a/b/c/leaf.md 子树（相对深度 3）移入 deep（第 3 层）→ 3 + 1 + 3 = 7 > 6
    const f = [
      { path: 'SKILL.md', name: 'SKILL.md', isEntry: true },
      { path: 'grp/a/b/c/leaf.md', name: 'leaf.md' }, // 子树相对深度 3（a→b→c→leaf）
      { path: 'p/q/deep', name: 'deep', isDir: true } // 目标父目录 第 3 层
    ]
    expect(validateMoveTarget({ fromPath: 'grp/a', isDir: true, toParentDir: 'p/q/deep', files: f })).toMatch(/最大目录深度/)
  })
  it('不能命名/移动为入口名 SKILL.md', () => {
    const f = [{ path: 'SKILL.md', name: 'SKILL.md', isEntry: true }, { path: 'sub/SKILL.md', name: 'SKILL.md' }]
    expect(validateMoveTarget({ fromPath: 'sub/SKILL.md', isDir: false, toParentDir: '', files: f })).toMatch(/入口文件名/)
  })
})

describe('H5 buildMoveContext + validateMoveTarget(ctx) 预算复用与等价性', () => {
  const FILES = [
    { path: 'SKILL.md', name: 'SKILL.md', isEntry: true },
    { path: 'x.md', name: 'x.md' },
    { path: 'refs/a.md', name: 'a.md' },
    { path: 'refs/sub/note.md', name: 'note.md' },
    { path: 'dst', name: 'dst', isDir: true },
    { path: 'dst/a.md', name: 'a.md' } // dst 下已有 a.md（重名落点）
  ]

  it('buildMoveContext 产出 allPaths/allDirs(Set) + 目录子树最深层级', () => {
    const ctx = buildMoveContext('refs', true, FILES)
    expect(ctx.allPaths instanceof Set).toBe(true)
    expect(ctx.allDirs instanceof Set).toBe(true)
    expect(ctx.allDirs.has('refs')).toBe(true)
    expect(ctx.allDirs.has('refs/sub')).toBe(true)
    expect(ctx.fromSubtreeMaxDepth).toBe(3) // refs/sub/note.md
    // 文件不需子树深度。
    expect(buildMoveContext('x.md', false, FILES).fromSubtreeMaxDepth).toBe(0)
  })

  it('传 ctx 与不传 ctx 结果完全一致（纯函数等价）：多种落点', () => {
    const cases = [
      { fromPath: 'x.md', isDir: false, toParentDir: 'dst' }, // 合法
      { fromPath: 'refs/a.md', isDir: false, toParentDir: 'dst' }, // 重名文件
      { fromPath: 'refs/a.md', isDir: false, toParentDir: '' }, // 回根合法
      { fromPath: 'refs', isDir: true, toParentDir: 'refs/sub' }, // 循环
      { fromPath: 'refs', isDir: true, toParentDir: 'dst' }, // 合法目录移动
      { fromPath: 'SKILL.md', isDir: false, toParentDir: 'refs' } // entry 不可移
    ]
    for (const c of cases) {
      const ctx = buildMoveContext(c.fromPath, c.isDir, FILES)
      const withCtx = validateMoveTarget({ ...c, files: FILES, ctx })
      const noCtx = validateMoveTarget({ ...c, files: FILES })
      expect(withCtx).toBe(noCtx)
    }
  })
})

describe('H2 性能：buildFileTree 产出节点 markRaw（免 Vue 深响应化、但仍可扩展）', () => {
  // BUG-P0-001 修复：节点改 markRaw（不再 Object.freeze）。
  // markRaw 语义 = 放进响应式上下文也不会被代理为 reactive；同时对象可扩展（el-tree 能写 $treeNodeId）。
  it('节点免响应式：放进 reactive 后仍非响应式代理（markRaw 生效）', () => {
    const tree = buildFileTree([
      { path: 'SKILL.md', name: 'SKILL.md', isEntry: true },
      { path: 'refs/a.md', name: 'a.md' },
      { path: 'empty', name: 'empty', isDir: true }
    ])
    const dir = tree.find((n) => n.isDir && n.name === 'refs')
    const file = tree.find((n) => !n.isDir)
    // 直接判定：markRaw 节点本身非 reactive 代理。
    expect(isReactive(file)).toBe(false)
    expect(isReactive(dir)).toBe(false)
    // 关键：放进 reactive 容器后，markRaw 节点不被深度代理化（这正是免响应化收益）。
    const state = reactive({ a: file, b: dir })
    expect(isReactive(state.a)).toBe(false)
    expect(isReactive(state.b)).toBe(false)
    expect(isReactive(state.b.children[0])).toBe(false)
  })

  it('节点仍可扩展（el-tree 可写私有属性 $treeNodeId，不抛 not extensible）', () => {
    const tree = buildFileTree([{ path: 'refs/a.md', name: 'a.md' }])
    const dir = tree.find((n) => n.isDir)
    const file = dir.children[0]
    expect(Object.isFrozen(file)).toBe(false)
    expect(Object.isFrozen(dir)).toBe(false)
    // 模拟 el-tree 写私有属性：不应抛错。
    expect(() => {
      file.$treeNodeId = 1
      dir.$treeNodeId = 2
    }).not.toThrow()
    expect(file.$treeNodeId).toBe(1)
  })
})

describe('normalizeInputPath 输入归一（trim + 反斜杠转正斜杠，闭集职责）', () => {
  it('首尾空白裁剪；空/null/undefined → 空串', () => {
    expect(normalizeInputPath('  references/a.md  ')).toBe('references/a.md')
    expect(normalizeInputPath('   ')).toBe('')
    expect(normalizeInputPath('')).toBe('')
    expect(normalizeInputPath(null)).toBe('')
    expect(normalizeInputPath(undefined)).toBe('')
  })

  it('反斜杠（Windows 手输/粘贴）统一转正斜杠', () => {
    expect(normalizeInputPath('references\\a.md')).toBe('references/a.md')
    expect(normalizeInputPath('a\\b\\c.md')).toBe('a/b/c.md')
  })

  it('职责边界：不折叠连续 //、不剥前导 /（交 validatePathShape 红字拒绝，非静默改写）', () => {
    // 归一层刻意不「猜」用户意图改写路径；连续 / 与前导 / 由 shape 校验显式拒绝。
    expect(normalizeInputPath('a//b.md')).toBe('a//b.md')
    expect(normalizeInputPath('/a.md')).toBe('/a.md')
    expect(validateNewFilePath('a//b.md', [])).toMatch(/连续/)
    expect(validateNewFilePath('/a.md', [])).toMatch(/开头/)
  })
})

describe('setSkillPackageLimits 动态上限（2026-08-04：后端树响应下发，前端免发版适配）', () => {
  afterEach(() => {
    // 恢复本文件深度夹具的钉 6 基线，避免影响其它用例。
    setSkillPackageLimits({ maxPathDepth: 6 })
  })

  it('调大：钉 15 后 7 段路径放行、16 段被拒且文案带新上限', () => {
    setSkillPackageLimits({ maxPathDepth: 15 })
    expect(validateNewFilePath('a/b/c/d/e/f/g.md', [])).toBeNull()
    const seg16 = Array.from({ length: 15 }, (_, i) => `d${i}`).join('/') + '/f.md' // 16 段
    expect(validateNewFilePath(seg16, [])).toMatch(/最多 15 层/)
    // canCreateSubfolder 同步放宽：第 5 层目录（钉 6 时到顶）可再建子夹。
    expect(canCreateSubfolder('a/b/c/d/e')).toBe(true)
  })

  it('调小：钉 3 后 4 段被拒（后端收紧前端即时跟随）', () => {
    setSkillPackageLimits({ maxPathDepth: 3 })
    expect(validateNewFilePath('a/b/c/d.md', [])).toMatch(/最多 3 层/)
    expect(validateNewFilePath('a/b/c.md', [])).toBeNull()
  })

  it('缺省/非法输入不破坏现值（老后端响应无 limits 兜底）', () => {
    setSkillPackageLimits(undefined)
    setSkillPackageLimits({})
    setSkillPackageLimits({ maxPathDepth: 0 })
    setSkillPackageLimits({ maxPathDepth: -2 })
    setSkillPackageLimits({ maxPathDepth: 'abc' })
    setSkillPackageLimits({ maxPathDepth: 4.5 })
    expect(validateLeafFileName('g.md', 'a/b/c/d/e/f', [])).toMatch(/最多 6 层/) // 7 段仍被拒 → 钉 6 基线未被非法输入破坏
  })
})
