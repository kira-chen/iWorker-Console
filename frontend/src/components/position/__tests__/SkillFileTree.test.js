// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createApp, h, provide, inject } from 'vue'
import { setSkillPackageLimits } from '@/utils/skillFileTree'

// 深度上限 2026-08-04 起由后端树响应动态下发（默认 15）；本文件深度护栏夹具按 6 层写就，显式钉 6。
setSkillPackageLimits({ maxPathDepth: 6 })

// mock api 层（避免真实请求）。
vi.mock('@/api/skillFiles', () => ({
  saveSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  deleteSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  renameSkillFile: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  exportSkillZip: vi.fn(() => Promise.resolve('skill-1.zip')),
  // 目录结构能力端点 9~12（is_dir 持久化 + 原子文件夹/移动）。
  createSkillFolder: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  renameSkillFolder: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  deleteSkillFolder: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  moveSkillNode: vi.fn(() => Promise.resolve({ tree: { files: [] } })),
  // 组③：跨文件查找（默认返回一个命中文件 + 一行命中）。
  searchSkillFiles: vi.fn(() =>
    Promise.resolve({
      q: 'foo',
      items: [
        { path: 'references/a.md', name: 'a.md', fileType: 'md', isDir: false, nameHit: false, lines: [{ lineNo: 3, snippet: 'hello foo world' }] }
      ]
    })
  )
}))
// mock ElMessage / ElMessageBox（捕获 prompt 的 inputValidator 验证 P0-1 硬拦）。
const promptSpy = vi.fn()
const confirmSpy = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }),
  ElMessageBox: {
    prompt: (...args) => promptSpy(...args),
    confirm: (...args) => confirmSpy(...args)
  }
}))

const SkillFileTree = (await import('@/components/position/SkillFileTree.vue')).default
const {
  saveSkillFile,
  renameSkillFile,
  deleteSkillFile,
  exportSkillZip,
  createSkillFolder,
  renameSkillFolder,
  deleteSkillFolder,
  moveSkillNode,
  searchSkillFiles
} = await import('@/api/skillFiles')
const { ElMessage } = await import('element-plus')

const FILES = [
  { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true, size: 1, sortOrder: -1 },
  { path: 'references/a.md', name: 'a.md', fileType: 'md', isEntry: false, size: 1, sortOrder: 0 },
  { path: '_meta.json', name: '_meta.json', fileType: 'json', isEntry: false, size: 1, sortOrder: 1 }
]

// EP 组件存根：el-tree 用 default slot 渲染每个节点（递归扁平渲染叶子，便于断言节点视觉）。
function flattenLeaves(nodes) {
  const out = []
  for (const n of nodes) {
    out.push(n)
    if (n.children) out.push(...flattenLeaves(n.children))
  }
  return out
}
const stubs = {
  'el-tree': {
    props: ['data'],
    setup(props, { slots }) {
      return () =>
        h(
          'div',
          { class: 'el-tree-stub' },
          flattenLeaves(props.data).map((d) =>
            h('div', { class: 'tree-row', key: d.path }, [
              slots.default ? slots.default({ node: { expanded: false }, data: d }) : null
            ])
          )
        )
    }
  },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  'el-dropdown': {
    emits: ['command'],
    setup(_, { slots, emit }) {
      // 提供 command 派发：dd-item 点击时调用，模拟 EP el-dropdown @command。
      provide('elDropdownCommand', (cmd) => emit('command', cmd))
      return () => h('div', { class: 'el-dropdown' }, [slots.default?.(), slots.dropdown?.()])
    }
  },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': {
    // disabled 声明为 Boolean，模拟 EP：bare `disabled` 属性 → true（数组声明会得到 ''，false）。
    props: { disabled: { type: Boolean, default: false }, command: { type: [String, Number], default: '' } },
    setup(props, { slots }) {
      const fire = inject('elDropdownCommand', null)
      return () =>
        h(
          'div',
          {
            class: 'dd-item',
            'data-disabled': props.disabled ? 'true' : 'false',
            'data-command': props.command,
            onClick: () => {
              if (!props.disabled && fire) fire(props.command)
            }
          },
          slots.default?.()
        )
    }
  },
  'el-tooltip': { template: '<div class="el-tooltip"><slot /></div>' },
  'el-skeleton': { template: '<div class="el-skeleton" />' },
  'el-button': { template: '<button><slot /></button>' },
  // 「移动到…」对话框：v-model 受控，默认隐藏；仅 modelValue=true 时渲染内容 + footer。
  'el-dialog': {
    props: { modelValue: { type: Boolean, default: false } },
    setup(props, { slots }) {
      return () =>
        props.modelValue
          ? h('div', { class: 'el-dialog' }, [slots.default?.(), slots.footer?.()])
          : null
    }
  }
}

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SkillFileTree, props) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})
beforeEach(() => vi.clearAllMocks())

describe('SkillFileTree 渲染', () => {
  it('SKILL.md 渲染入口徽标「入口」', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const pills = [...el.querySelectorAll('.ft-entry-pill')].map((e) => e.textContent.trim())
    expect(pills).toContain('入口')
  })

  it('脏标记：dirtyMap 命中的文件渲染脏点 ●', () => {
    const el = mount({
      skillId: 1,
      files: FILES,
      source: 'fde',
      activePath: 'SKILL.md',
      dirtyMap: { 'references/a.md': true }
    })
    expect(el.querySelectorAll('.ft-dirty').length).toBe(1)
  })

  it('.json 语法错：jsonErrorMap 命中渲染红色 △', () => {
    const el = mount({
      skillId: 1,
      files: FILES,
      source: 'fde',
      activePath: 'SKILL.md',
      jsonErrorMap: { '_meta.json': true }
    })
    expect(el.querySelectorAll('.ft-json-err').length).toBe(1)
  })

  it('SKILL.md ⋯ 菜单：有「新建文件/新建文件夹」（根级），且无重命名/删除（入口受保护）', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    // SKILL.md 行 = 第一行（入口置顶）。取该行所有菜单命令。
    const skillRow = [...el.querySelectorAll('.tree-row')].find((r) =>
      r.querySelector('.ft-entry-pill')
    )
    const cmds = [...skillRow.querySelectorAll('.dd-item')].map((e) => e.getAttribute('data-command'))
    expect(cmds).toContain('new-root-file')
    expect(cmds).toContain('new-root-folder')
    // 入口受保护：无重命名/删除项
    expect(cmds).not.toContain('rename')
    expect(cmds).not.toContain('delete')
  })

  it('普通文件 ⋯ 菜单：有「新建同级文件/文件夹」+ 重命名 + 删除', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    // references/a.md 行（非入口、非目录）
    const fileRow = [...el.querySelectorAll('.tree-row')].find(
      (r) => r.querySelector('.ft-name')?.textContent.trim() === 'a.md'
    )
    const cmds = [...fileRow.querySelectorAll('.dd-item')].map((e) => e.getAttribute('data-command'))
    expect(cmds).toContain('new-sibling-file')
    expect(cmds).toContain('new-sibling-folder')
    expect(cmds).toContain('rename')
    expect(cmds).toContain('delete')
  })

  it('文件夹 ⋯ 菜单：有「在此新建文件/子文件夹」+ 重命名文件夹 + 删除文件夹', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const dirRow = [...el.querySelectorAll('.tree-row')].find(
      (r) => r.querySelector('.ft-name')?.textContent.trim() === 'references'
    )
    const cmds = [...dirRow.querySelectorAll('.dd-item')].map((e) => e.getAttribute('data-command'))
    expect(cmds).toContain('new-in-dir')
    expect(cmds).toContain('new-subfolder')
    expect(cmds).toContain('rename-folder')
    expect(cmds).toContain('delete-folder')
  })

  it('#1 头部无「＋▾」全局新建入口；底部仅「导出压缩包」、无新建/上传', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    // 头部不再有全局新建下拉
    expect(el.querySelector('.ft-head-create')).toBeNull()
    // 底部：仅「导出压缩包」，无「新建」「上传压缩包」
    const footTexts = [...el.querySelectorAll('.ft-foot-btn')].map((e) => e.textContent.trim())
    expect(footTexts.some((t) => t.includes('导出压缩包'))).toBe(true)
    expect(footTexts.some((t) => t.includes('新建'))).toBe(false)
    expect(footTexts.some((t) => t.includes('上传压缩包'))).toBe(false)
  })

  it('导出按钮不置灰；点击 → 调 exportSkillZip(fde) + success toast', async () => {
    const el = mount({ skillId: 5, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const exportBtn = [...el.querySelectorAll('.ft-foot-btn')].find((e) =>
      e.textContent.includes('导出压缩包')
    )
    expect(exportBtn.disabled).toBe(false)
    exportBtn.click()
    // 等导出 promise + toast
    await Promise.resolve()
    await Promise.resolve()
    expect(exportSkillZip).toHaveBeenCalledWith(5, 'fde')
    expect(ElMessage.success).toHaveBeenCalled()
  })

  it('平台技能导出 → source=platform', async () => {
    const el = mount({ skillId: 8, files: FILES, source: 'platform', activePath: 'SKILL.md' })
    const exportBtn = [...el.querySelectorAll('.ft-foot-btn')].find((e) =>
      e.textContent.includes('导出压缩包')
    )
    exportBtn.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(exportSkillZip).toHaveBeenCalledWith(8, 'platform')
  })

  it('导出失败 → error toast', async () => {
    exportSkillZip.mockRejectedValueOnce(new Error('技能不存在'))
    const el = mount({ skillId: 5, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const exportBtn = [...el.querySelectorAll('.ft-foot-btn')].find((e) =>
      e.textContent.includes('导出压缩包')
    )
    exportBtn.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(ElMessage.error).toHaveBeenCalled()
  })

  it('loading 态渲染骨架，不渲染树', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', loading: true })
    expect(el.querySelector('.el-skeleton')).toBeTruthy()
    expect(el.querySelector('.el-tree-stub')).toBeNull()
  })

  it('loadError 态渲染错误条 + 重试', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', loadError: true })
    expect(el.querySelector('.ft-error')).toBeTruthy()
  })
})

describe('SkillFileTree 树操作 inputValidator（P0-1 / P1）', () => {
  it('#5 新建文件(只输叶子名)：含 / 拒 + 重名硬拦 + 合法通过（根级，不调 saveSkillFile 当取消）', async () => {
    let validator
    promptSpy.mockImplementation((msg, title, opts) => {
      validator = opts.inputValidator
      return Promise.reject('cancel')
    })
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    // 触发 SKILL.md ⋯ 的「新建文件」(command=new-root-file → 根级，SKILL.md 作根锚点)
    const fileItem = [...el.querySelectorAll('.dd-item[data-command="new-root-file"]')][0]
    fileItem.click()
    await Promise.resolve()
    expect(validator).toBeTypeOf('function')
    // 只输叶子名：含 / → 红字引导
    expect(validator('references/x.md')).toMatch(/不能含 \/|新建子文件夹/)
    // 根级重名（SKILL.md 已存在）→ 硬拦
    expect(validator('SKILL.md')).toMatch(/已存在/)
    // 合法新叶子名 → true
    expect(validator('new.md')).toBe(true)
    expect(saveSkillFile).not.toHaveBeenCalled()
  })

  it('工程-CR 新建文件夹查重：撞同级目录名 / 撞同级文件名 均本地拦（目录与文件同命名空间）', async () => {
    let validator
    promptSpy.mockImplementation((msg, title, opts) => {
      validator = opts.inputValidator
      return Promise.reject('cancel')
    })
    // 根级新建文件夹（SKILL.md ⋯ → new-root-folder）。根级已有：目录 references、文件 SKILL.md / _meta.json。
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const folderItem = [...el.querySelectorAll('.dd-item[data-command="new-root-folder"]')][0]
    folderItem.click()
    await Promise.resolve()
    expect(validator).toBeTypeOf('function')
    // 撞同级目录名 → 拒
    expect(validator('references')).toMatch(/同名/)
    // 撞同级文件名（_meta.json）→ 也拒（后端目录/文件同命名空间会 409，本地即时拦）
    expect(validator('_meta.json')).toMatch(/同名/)
    // 合法新夹名 → true
    expect(validator('newdir')).toBe(true)
    expect(createSkillFolder).not.toHaveBeenCalled()
  })

  it('#5 重命名文件(只输叶子名)：改为 SKILL.md 拒 + 同目录重名拒 + 合法叶子名通过', async () => {
    let validator
    promptSpy.mockImplementation((msg, title, opts) => {
      validator = opts.inputValidator
      return Promise.reject('cancel')
    })
    // references/a.md 重命名：dirPrefix=references，只输叶子名
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'references/a.md' })
    const renameItem = [...el.querySelectorAll('.dd-item[data-command="rename"]')].find(
      (e) => e.getAttribute('data-disabled') !== 'true'
    )
    renameItem.click()
    await Promise.resolve()
    expect(validator).toBeTypeOf('function')
    // 改为 SKILL.md（join 后 references/SKILL.md，非入口名；但若改根级才撞——这里测同目录合法名）
    expect(validator('b.md')).toBe(true) // references/b.md 合法
    expect(validator('a.md')).toMatch(/未改变/) // 同名未改
    // 含非法扩展名 → 拒
    expect(validator('a.exe')).toMatch(/仅支持/)
    expect(renameSkillFile).not.toHaveBeenCalled()
  })

  it('#5 新建成功(根级，叶子名)→ 调 saveSkillFile(空内容, path=叶子名) 并 emit file-created', async () => {
    promptSpy.mockResolvedValue({ value: 'new.md' })
    const created = []
    const el = mount({
      skillId: 1,
      files: FILES,
      source: 'fde',
      activePath: 'SKILL.md',
      'onFile-created': (p, vo) => created.push([p, vo])
    })
    const fileItem = [...el.querySelectorAll('.dd-item[data-command="new-root-file"]')][0]
    fileItem.click()
    await Promise.resolve()
    await Promise.resolve()
    // 根级（SKILL.md ⋯ 新建 → dirPrefix=''）→ path = 叶子名 'new.md'
    expect(saveSkillFile).toHaveBeenCalledWith(1, { path: 'new.md', content: '' }, 'fde')
  })

  it('#5 在文件夹下新建文件(叶子名)→ path = dirPrefix + 叶子名（前端拼，不手打路径）', async () => {
    promptSpy.mockResolvedValue({ value: 'note.md' })
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'references/a.md' })
    // references 目录节点的「在此新建文件」(activePath 父目录=references，但这里测目录 ⋯ 菜单)
    const newInDir = [...el.querySelectorAll('.dd-item[data-command="new-in-dir"]')][0]
    newInDir.click()
    await Promise.resolve()
    await Promise.resolve()
    // 触发节点 = references 目录 → path = 'references/note.md'
    expect(saveSkillFile).toHaveBeenCalledWith(1, { path: 'references/note.md', content: '' }, 'fde')
  })

  it('#5 普通文件「新建同级文件」→ dirPrefix=该文件父目录（references/a.md → references/）', async () => {
    promptSpy.mockResolvedValue({ value: 'sib.md' })
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'references/a.md' })
    const fileRow = [...el.querySelectorAll('.tree-row')].find(
      (r) => r.querySelector('.ft-name')?.textContent.trim() === 'a.md'
    )
    const sibItem = [...fileRow.querySelectorAll('.dd-item[data-command="new-sibling-file"]')][0]
    sibItem.click()
    await Promise.resolve()
    await Promise.resolve()
    // 同级 = a.md 父目录 references → path = 'references/sib.md'
    expect(saveSkillFile).toHaveBeenCalledWith(1, { path: 'references/sib.md', content: '' }, 'fde')
  })

  it('#5 根级文件「新建同级文件」→ dirPrefix=根（_meta.json 在根 → path=叶子名）', async () => {
    promptSpy.mockResolvedValue({ value: 'root2.md' })
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    const fileRow = [...el.querySelectorAll('.tree-row')].find(
      (r) => r.querySelector('.ft-name')?.textContent.trim() === '_meta.json'
    )
    const sibItem = [...fileRow.querySelectorAll('.dd-item[data-command="new-sibling-file"]')][0]
    sibItem.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(saveSkillFile).toHaveBeenCalledWith(1, { path: 'root2.md', content: '' }, 'fde')
  })

  it('#5 SKILL.md 入口保护：入口节点菜单无 rename/delete（仅根级新建）；根级无「删除文件夹」', () => {
    const el = mount({ skillId: 1, files: FILES, source: 'fde', activePath: 'SKILL.md' })
    // SKILL.md 行（入口）：无 rename/delete，仅根级新建
    const skillRow = [...el.querySelectorAll('.tree-row')].find((r) =>
      r.querySelector('.ft-entry-pill')
    )
    const skillCmds = [...skillRow.querySelectorAll('.dd-item')].map((e) => e.getAttribute('data-command'))
    expect(skillCmds).not.toContain('rename')
    expect(skillCmds).not.toContain('delete')
    expect(skillCmds).toContain('new-root-file')
    expect(skillCmds).toContain('new-root-folder')
    // 「删除文件夹」只在目录节点 ⋯ 出现（根目录本身不是树节点，无 ⋯，故无根级删文件夹入口）
    const allCmds = [...el.querySelectorAll('.dd-item')].map((e) => e.getAttribute('data-command'))
    expect(allCmds.filter((c) => c === 'delete-folder').length).toBeGreaterThan(0) // references 目录有
  })

  it('#5 深度护栏：深 5 层目录的「在此新建子文件夹」disabled（建子夹后放文件会到第 7 层）', () => {
    // a/b/c/d/e/f.md = 6 层；目录 a/b/c/d/e 在第 5 层 → canCreateSubfolder=false（5+2=7>6）
    const deepFiles = [
      { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
      { path: 'a/b/c/d/e/f.md', name: 'f.md', fileType: 'md', isEntry: false }
    ]
    const el = mount({ skillId: 1, files: deepFiles, source: 'fde', activePath: 'SKILL.md' })
    // 找 a/b/c/d 目录节点的 new-subfolder 项 → 应 disabled
    const subItems = [...el.querySelectorAll('.dd-item[data-command="new-subfolder"]')]
    const anyDisabled = subItems.some((e) => e.getAttribute('data-disabled') === 'true')
    expect(anyDisabled).toBe(true)
  })
})

describe('SkillFileTree 文件夹/移动操作（is_dir 持久化 + 原子端点 9~12）', () => {
  const FOLDER_FILES = [
    { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
    { path: 'references/policy.md', name: 'policy.md', fileType: 'md', isEntry: false },
    { path: 'references/faq.md', name: 'faq.md', fileType: 'md', isEntry: false },
    { path: 'references/sub/note.md', name: 'note.md', fileType: 'md', isEntry: false }
  ]

  it('新建文件夹 → 调后端端点9 createSkillFolder 落库（is_dir 持久化，不再客户端待定）', async () => {
    promptSpy.mockResolvedValue({ value: 'newdir' }) // 文件夹名
    const changed = []
    const el = mount({
      skillId: 1, files: FOLDER_FILES, source: 'fde', activePath: 'SKILL.md',
      'onTree-changed': (vo, meta) => changed.push(meta)
    })
    const folderItem = [...el.querySelectorAll('.dd-item[data-command="new-root-folder"]')][0]
    folderItem.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(createSkillFolder).toHaveBeenCalledWith(1, 'newdir', 'fde')
    expect(changed.some((m) => m.kind === 'folder-create')).toBe(true)
    // 不再有客户端待定夹标记。
    expect(el.querySelectorAll('.ft-pending').length).toBe(0)
  })

  it('重命名文件夹 → 单次原子 renameSkillFolder(端点10)（不再逐文件 rename）', async () => {
    promptSpy.mockResolvedValue({ value: 'docs' }) // 新夹名
    const changed = []
    const el = mount({
      skillId: 1, files: FOLDER_FILES, source: 'fde', activePath: 'SKILL.md',
      'onTree-changed': (vo, meta) => changed.push(meta)
    })
    const rf = [...el.querySelectorAll('.dd-item[data-command="rename-folder"]')][0]
    rf.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(renameSkillFolder).toHaveBeenCalledWith(1, { fromPath: 'references', toPath: 'docs' }, 'fde')
    expect(renameSkillFile).not.toHaveBeenCalled() // 不再逐个文件 rename
    // pathMap 含子项前缀替换，供页面迁移缓存键。
    const meta = changed.find((m) => m.kind === 'folder-rename')
    expect(meta.pathMap['references/policy.md']).toBe('docs/policy.md')
    expect(meta.pathMap['references/sub/note.md']).toBe('docs/sub/note.md')
  })

  it('删除非空文件夹 → confirm 列影响清单 + 单次原子 deleteSkillFolder(端点11)', async () => {
    let confirmMsg = ''
    confirmSpy.mockImplementation((msg) => {
      confirmMsg = msg
      return Promise.resolve()
    })
    const changed = []
    const el = mount({
      skillId: 1, files: FOLDER_FILES, source: 'fde', activePath: 'SKILL.md',
      'onTree-changed': (vo, meta) => changed.push(meta)
    })
    const df = [...el.querySelectorAll('.dd-item[data-command="delete-folder"]')][0]
    df.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(confirmMsg).toContain('references/policy.md')
    expect(confirmMsg).toContain('references/sub/note.md')
    expect(confirmMsg).toMatch(/3 个文件/)
    expect(deleteSkillFolder).toHaveBeenCalledWith(1, 'references', 'fde')
    expect(deleteSkillFile).not.toHaveBeenCalled() // 不再逐个文件 delete
    expect(changed.some((m) => m.kind === 'folder-delete' && m.removedPrefix === 'references')).toBe(true)
  })

  it('「移动到…」流：选目标目录确认 → moveSkillNode(fromPath/toParentDir/isDir) + emit tree-changed(kind=move, pathMap)', async () => {
    const changed = []
    const el = mount({
      skillId: 1, files: FOLDER_FILES, source: 'fde', activePath: 'SKILL.md',
      'onTree-changed': (vo, meta) => changed.push(meta)
    })
    // policy.md 行的 ⋯ →「移动到…」（command=move-to）
    const fileRow = [...el.querySelectorAll('.tree-row')].find(
      (r) => r.querySelector('.ft-name')?.textContent.trim() === 'policy.md'
    )
    fileRow.querySelector('.dd-item[data-command="move-to"]').click()
    await Promise.resolve(); await Promise.resolve()
    // 对话框已开（el-dialog stub 仅 visible=true 渲染），默认高亮当前目录 references（非法落点，仅基准）
    expect(el.querySelector('.ft-move-dialog, .el-dialog')).toBeTruthy()
    // 选合法目标目录 references/sub（mv-node 点击 → onMoveTreeClick）
    const target = [...el.querySelectorAll('.mv-node')].find(
      (n) => n.querySelector('.mv-name')?.textContent.trim() === 'sub'
    )
    expect(target).toBeTruthy()
    target.click()
    await Promise.resolve()
    // 确认移动
    const confirmBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('确认移动'))
    confirmBtn.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    // 端点12 原子移动：payload 为 { fromPath, toParentDir, isDir }（toPath 由后端按叶子名拼）
    expect(moveSkillNode).toHaveBeenCalledWith(
      1,
      { fromPath: 'references/policy.md', toParentDir: 'references/sub', isDir: false },
      'fde'
    )
    // emit tree-changed(kind='move')，pathMap 供页面迁移缓存键
    const meta = changed.find((m) => m.kind === 'move')
    expect(meta).toBeTruthy()
    expect(meta.pathMap['references/policy.md']).toBe('references/sub/policy.md')
    expect(ElMessage.success).toHaveBeenCalled()
  })

  it('删除非空文件夹取消 → 不调任何删除端点', async () => {
    confirmSpy.mockRejectedValue('cancel')
    const el = mount({ skillId: 1, files: FOLDER_FILES, source: 'fde', activePath: 'SKILL.md' })
    const df = [...el.querySelectorAll('.dd-item[data-command="delete-folder"]')][0]
    df.click()
    await Promise.resolve(); await Promise.resolve()
    expect(deleteSkillFolder).not.toHaveBeenCalled()
  })

  it('删除空文件夹（is_dir 占位行）→ 无二次确认，直接 deleteSkillFolder', async () => {
    const EMPTY = [
      { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
      { path: 'emptydir', name: 'emptydir', isDir: true }
    ]
    confirmSpy.mockClear()
    const el = mount({ skillId: 1, files: EMPTY, source: 'fde', activePath: 'SKILL.md' })
    const df = [...el.querySelectorAll('.dd-item[data-command="delete-folder"]')][0]
    df.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(confirmSpy).not.toHaveBeenCalled() // 空夹无影响清单 → 不弹确认
    expect(deleteSkillFolder).toHaveBeenCalledWith(1, 'emptydir', 'fde')
  })
})

describe('SkillFileTree 组③ 查找/过滤', () => {
  const FILES2 = [
    { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true },
    { path: 'references/policy.md', name: 'policy.md', fileType: 'md', isEntry: false },
    { path: 'references/faq.md', name: 'faq.md', fileType: 'md', isEntry: false }
  ]
  function typeSearch(el, val) {
    const input = el.querySelector('.ft-search-input')
    input.value = val
    input.dispatchEvent(new Event('input'))
    return input
  }

  it('按名过滤：只渲染名字命中的文件（policy → 仅 policy.md 行）', async () => {
    const el = mount({ skillId: 1, files: FILES2, source: 'fde', activePath: 'SKILL.md' })
    typeSearch(el, 'policy')
    await Promise.resolve(); await Promise.resolve()
    const names = [...el.querySelectorAll('.ft-name')].map((n) => n.textContent.trim())
    // 命中 policy.md + 其祖先目录 references；不含 faq.md / SKILL.md
    expect(names).toContain('policy.md')
    expect(names).not.toContain('faq.md')
    expect(names).not.toContain('SKILL.md')
  })

  it('按名过滤无命中 → 空态', async () => {
    const el = mount({ skillId: 1, files: FILES2, source: 'fde', activePath: 'SKILL.md' })
    typeSearch(el, 'zzz不存在')
    await Promise.resolve(); await Promise.resolve()
    expect(el.querySelector('.ft-empty-filter')).toBeTruthy()
  })

  it('按内容查找：切到「按内容」+ 输入 → debounce 后调 searchSkillFiles，列命中行', async () => {
    vi.useFakeTimers()
    const el = mount({ skillId: 1, files: FILES2, source: 'fde', activePath: 'SKILL.md' })
    // 切「按内容」模式
    const contentBtn = [...el.querySelectorAll('.ft-mode')].find((b) => b.textContent.includes('按内容'))
    contentBtn.click()
    await Promise.resolve()
    typeSearch(el, 'foo')
    await vi.advanceTimersByTimeAsync(400)
    expect(searchSkillFiles).toHaveBeenCalledWith(1, 'foo', 'all', 'fde')
    await Promise.resolve(); await Promise.resolve()
    // 命中文件 + 命中行片段（含高亮 mark）
    expect(el.querySelector('.sr-file-name')?.textContent).toContain('a.md')
    expect(el.querySelector('.sr-lineno')?.textContent).toBe('3')
    expect(el.querySelector('.sr-snippet .sr-hit')?.textContent).toBe('foo')
    vi.useRealTimers()
  })

  it('点击内容命中行 → emit search-jump(path, lineNo, keyword)', async () => {
    vi.useFakeTimers()
    const jumps = []
    const el = mount({
      skillId: 1, files: FILES2, source: 'fde', activePath: 'SKILL.md',
      'onSearch-jump': (p, ln, kw) => jumps.push([p, ln, kw])
    })
    ;[...el.querySelectorAll('.ft-mode')].find((b) => b.textContent.includes('按内容')).click()
    await Promise.resolve()
    typeSearch(el, 'foo')
    await vi.advanceTimersByTimeAsync(400)
    await Promise.resolve(); await Promise.resolve()
    el.querySelector('.sr-line').click()
    expect(jumps.length).toBe(1)
    expect(jumps[0][0]).toBe('references/a.md')
    expect(jumps[0][1]).toBe(3)
    expect(jumps[0][2]).toBe('foo') // 带查询词供 .md 跳转提示
    vi.useRealTimers()
  })

  it('P1：只读浏览（platform-candidate）隐藏「按内容」入口、按名过滤仍可用、绝不调 searchSkillFiles', async () => {
    const el = mount({ skillId: 1, files: FILES2, source: 'platform-candidate', activePath: 'SKILL.md', readonly: true })
    // 模式切换行整体不渲染（仅按名时无意义的单按钮）→ 无「按内容」入口
    expect([...el.querySelectorAll('.ft-mode')].some((b) => b.textContent.includes('按内容'))).toBe(false)
    // 按名过滤仍可用（纯前端）
    typeSearch(el, 'policy')
    await Promise.resolve(); await Promise.resolve()
    const names = [...el.querySelectorAll('.ft-name')].map((n) => n.textContent.trim())
    expect(names).toContain('policy.md')
    expect(names).not.toContain('faq.md')
    // 绝不触发后端内容查询（越权 404 收口）
    expect(searchSkillFiles).not.toHaveBeenCalled()
  })

  it('P1：readonly 只读态隐藏「按内容」入口（不触发后端查询），但搜索框仍在——纯前端按名过滤可用', () => {
    const el = mount({ skillId: 1, files: FILES2, source: 'platform', activePath: 'SKILL.md', readonly: true })
    // 只读态下 contentSearchable=false → 整个模式切换行不渲染（仅「按名」一项时无意义的单按钮）
    expect([...el.querySelectorAll('.ft-mode')].some((b) => b.textContent.includes('按内容'))).toBe(false)
    // 正向锚点：搜索输入框必须仍在——否则「没有按内容」只是因为组件整体没渲染
    // （空组件替换法实测命中的假绿点，2026-08-08 审视补强）
    expect(el.querySelector('.ft-search input, .ft-search'), '只读态仍应保留按名过滤入口').toBeTruthy()
  })
})
