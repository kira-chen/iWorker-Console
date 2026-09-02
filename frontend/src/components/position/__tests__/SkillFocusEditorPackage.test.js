// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

// 子组件 mock：隔离 Milkdown（重依赖）+ 暴露 resetSession spy（验证 F2 切文件护栏）。
const resetSessionSpy = vi.fn()
vi.mock('@/components/position/SkillMilkdownEditor.vue', () => ({
  default: {
    name: 'SkillMilkdownEditor',
    props: ['modelValue', 'toolNames', 'height', 'placeholder'],
    setup(_, { expose, slots }) {
      expose({
        insertTool: vi.fn(),
        focus: vi.fn(),
        resetSession: resetSessionSpy,
        scrollToTool: vi.fn()
      })
      // 渲染 modelValue 文本（含 data-md 属性）供断言「喂给 Milkdown 的是 body（已剥 frontmatter）」。
      return (ctx) =>
        h('div', { class: 'stub-milkdown', 'data-md': ctx.$props?.modelValue ?? '' }, [
          ctx.$props?.modelValue ?? '',
          slots['bar-right']?.()
        ])
    }
  }
}))
// 捕获 txt（frontmatter raw）编辑器的 emit，供测试模拟「用户在 raw 改 YAML」。
let lastFmEmit = null
vi.mock('@/components/position/CodeTextEditor.vue', () => ({
  default: {
    name: 'CodeTextEditor',
    props: ['modelValue', 'fileType', 'placeholder', 'readonly'],
    emits: ['update:modelValue', 'json-error'],
    // 渲染 modelValue 供断言 frontmatter 折叠区内容（class 区分文件类型）；frontmatter 实例暴露 emit 句柄。
    // frontmatter 编辑器现为 file-type="yaml"（组④加 YAML 校验）；保留 txt 兼容。
    setup: (props, { emit }) => {
      if (props.fileType === 'yaml' || props.fileType === 'txt') lastFmEmit = (v) => emit('update:modelValue', v)
      return () =>
        h('div', { class: `stub-code stub-code-${props.fileType}`, 'data-content': props.modelValue ?? '' }, props.modelValue ?? '')
    }
  }
}))
vi.mock('@/components/position/SkillFileTree.vue', () => ({
  default: { name: 'SkillFileTree', setup: () => () => h('div', { class: 'stub-tree' }) }
}))
vi.mock('@/components/position/ToolDock.vue', () => ({
  default: { name: 'ToolDock', setup: () => () => h('div', { class: 'stub-dock' }) }
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { prompt: vi.fn(), confirm: vi.fn() }
}))

const SkillFocusEditor = (await import('@/components/position/SkillFocusEditor.vue')).default

const stubs = {
  'el-input': {
    props: {
      type: { type: String, default: 'text' },
      autosize: { default: null },
      rows: { default: null },
      maxlength: { default: null }
    },
    template:
      '<div class="el-input-stub" :data-type="type" :data-autosize="autosize ? JSON.stringify(autosize) : \'\'" :data-rows="rows" :data-maxlength="maxlength"><input /></div>'
  },
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<div><slot /></div>' },
  'el-skeleton': { template: '<div />' },
  'el-button': { template: '<button><slot /></button>' },
  'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': { template: '<div><slot /></div>' },
  'el-drawer': { template: '<div><slot /></div>' },
  StatusTag: { template: '<span><slot /></span>' }
}

const FILES = [
  { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true, size: 1, sortOrder: -1 },
  { path: '_meta.json', name: '_meta.json', fileType: 'json', isEntry: false, size: 1, sortOrder: 0 }
]

let app, container
function mount(setupState) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return setupState
    },
    render() {
      return h(SkillFocusEditor, {
        skill: this.skill,
        files: this.files,
        activeFilePath: this.activeFilePath,
        activeFileType: this.activeFileType,
        activeFileContent: this.activeFileContent,
        // 透传可选 props（positionId/agents/currentAgentId/showClose/skillSource 等收口测试用）
        ...(this.extra || {})
      })
    }
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
  resetSessionSpy.mockClear()
})

const baseSkill = { skillId: 1, name: 't', triggers: [], skillMd: '# md', referencedTools: [], category: null }

describe('SkillFocusEditor 包模式 · 按 fileType 切编辑器（F2）', () => {
  it('.md 文件 → 渲染 Milkdown，不渲染 CodeTextEditor', () => {
    const el = mount({
      skill: ref(baseSkill),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('# md')
    })
    expect(el.querySelector('.stub-milkdown')).toBeTruthy()
    expect(el.querySelector('.stub-code')).toBeNull()
  })

  it('.json 文件 → 卸载 Milkdown、挂载 CodeTextEditor', () => {
    const el = mount({
      skill: ref(baseSkill),
      files: ref(FILES),
      activeFilePath: ref('_meta.json'),
      activeFileType: ref('json'),
      activeFileContent: ref('{}')
    })
    expect(el.querySelector('.stub-code')).toBeTruthy()
    expect(el.querySelector('.stub-milkdown')).toBeNull()
  })

  it('包模式渲染目录树栏（四栏）', () => {
    const el = mount({
      skill: ref(baseSkill),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('# md')
    })
    expect(el.querySelector('.stub-tree')).toBeTruthy()
    expect(el.querySelector('.ed-body.pkg-mode')).toBeTruthy()
  })

  it('F2 护栏：activeFilePath 在 .md 之间切换 → 触发 Milkdown resetSession（清串扰）', async () => {
    const activeFilePath = ref('SKILL.md')
    mount({
      skill: ref(baseSkill),
      files: ref([
        { path: 'SKILL.md', name: 'SKILL.md', fileType: 'md', isEntry: true, size: 1, sortOrder: -1 },
        { path: 'references/b.md', name: 'b.md', fileType: 'md', isEntry: false, size: 1, sortOrder: 0 }
      ]),
      activeFilePath,
      activeFileType: ref('md'),
      activeFileContent: ref('# b')
    })
    resetSessionSpy.mockClear()
    activeFilePath.value = 'references/b.md'
    await nextTick()
    expect(resetSessionSpy).toHaveBeenCalled()
  })

  it('空 files（文件区常驻，与 files 是否为空解耦）→ 仍渲染目录树 + 文件标签条 + 三栏布局', () => {
    // bug 修复：文件区渲染改由 showFileArea（在编辑主体即为真）掌管，不再挂在 files 非空上。
    // 后端 listSkillFiles 保证 files[] 永不为空（虚拟 SKILL.md）；即便前端此刻 files 为空
    // （树请求失败/未返回），文件区仍须常驻，让 SkillFileTree 内部的骨架/错误重试可见，绝不静默消失。
    const el = mount({
      skill: ref(baseSkill),
      files: ref([]),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    expect(el.querySelector('.stub-tree')).toBeTruthy()
    expect(el.querySelector('.ed-body.pkg-mode')).toBeTruthy()
    expect(el.querySelector('.ed-filebar')).toBeTruthy()
    // 仍渲染 Milkdown（SKILL.md 单文件编辑）
    expect(el.querySelector('.stub-milkdown')).toBeTruthy()
  })

  it('文件区不常驻的边界：loadError / loading 时不渲染文件区（走 ed-state，避免半吊子挂载）', () => {
    const elErr = mount({
      skill: ref(baseSkill),
      files: ref([]),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { loadError: true }
    })
    // loadError → 走顶层 ed-state 错误态，文件区（树/标签条/编辑器主体）不渲染。
    expect(elErr.querySelector('.stub-tree')).toBeNull()
    expect(elErr.querySelector('.ed-filebar')).toBeNull()
    expect(elErr.querySelector('.ed-body')).toBeNull()
  })
})

describe('SkillFocusEditor · P3 frontmatter 拆分/折叠', () => {
  const FM_MD = `---\nname: 客户回访\nlicense: MIT\n---\n# 正文标题\n办事流程`

  it('entry SKILL.md 有 frontmatter → 喂给 Milkdown 的是 body（不含 --- / name 行）', () => {
    const el = mount({
      skill: ref({ ...baseSkill, skillMd: FM_MD }),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    const md = el.querySelector('.stub-milkdown').getAttribute('data-md')
    expect(md.startsWith('# 正文标题')).toBe(true)
    expect(md).not.toContain('---')
    expect(md).not.toContain('name:')
  })

  it('有 frontmatter → 渲染折叠区，默认展开（2026-08-18 需求反转）', () => {
    const el = mount({
      skill: ref({ ...baseSkill, skillMd: FM_MD }),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    expect(el.querySelector('.ed-fm')).toBeTruthy()
    expect(el.querySelector('.ed-fm.open')).toBeTruthy() // 默认展开
    // §12：折叠头右侧为静态小注（不再显示 name 摘要——解耦不联动技能级）
    expect(el.querySelector('.ed-fm-note')).toBeTruthy()
    expect(el.querySelector('.ed-fm-summary')).toBeNull()
    // 展开态 body 渲染且可见（v-show）
    const body = el.querySelector('.ed-fm-body')
    expect(body).toBeTruthy()
    expect(body.style.display).not.toBe('none')
  })

  it('无 frontmatter 的 SKILL.md → 不渲染折叠区，整文喂 Milkdown（兼容）', () => {
    const plain = '# 直接正文\n没有 frontmatter'
    const el = mount({
      skill: ref({ ...baseSkill, skillMd: plain }),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    expect(el.querySelector('.ed-fm')).toBeNull()
    expect(el.querySelector('.stub-milkdown').getAttribute('data-md')).toBe(plain)
  })

  it('非 entry .md 不显 frontmatter 折叠区（只对 entry 处理）', () => {
    const el = mount({
      skill: ref({ ...baseSkill, skillMd: FM_MD }),
      files: ref(FILES),
      activeFilePath: ref('references/b.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('# 子文档 正文')
    })
    expect(el.querySelector('.ed-fm')).toBeNull()
    // 非 entry .md 喂的是 activeFileContent（不剥 frontmatter）
    expect(el.querySelector('.stub-milkdown').getAttribute('data-md')).toBe('# 子文档 正文')
  })
})

describe('SkillFocusEditor · §12 解耦：头部区 + frontmatter 纯 raw 不联动', () => {
  // live 包装：把 update:skill 回写进 ref，模拟页面 onUpdateSkill（捕获 emit 的 patch）。
  let liveApp, liveContainer, skillRef, lastPatch
  function mountLive(skill) {
    skillRef = ref(skill)
    lastPatch = null
    liveContainer = document.createElement('div')
    document.body.appendChild(liveContainer)
    liveApp = createApp({
      setup: () => ({ skillRef }),
      render() {
        return h(SkillFocusEditor, {
          skill: this.skillRef,
          files: FILES,
          activeFilePath: 'SKILL.md',
          activeFileType: 'md',
          activeFileContent: '',
          'onUpdate:skill': (next) => {
            lastPatch = next
            skillRef.value = next
          }
        })
      }
    })
    for (const [n, c] of Object.entries(stubs)) liveApp.component(n, c)
    liveApp.mount(liveContainer)
    return liveContainer
  }
  afterEach(() => {
    liveApp?.unmount()
    liveContainer?.remove()
    lastFmEmit = null
  })

  const FM = `---\nname: 包名\ndescription: 包描述\nlicense: MIT\nmetadata:\n  triggers:\n    - 回访\n  owner: 张三\n---\n# 正文`

  it('极简顶行渲染技能名(input)、信息条渲染描述（触发词入口已整块移除 2026-08-13），且 .ed-meta 左栏已解散', () => {
    const el = mount({
      skill: ref({ skillId: 1, name: '搭子', description: '技能级简介', triggers: ['报销'], skillMd: FM, referencedTools: [] }),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    // 极简顶行：技能名 inline input
    const topline = el.querySelector('.ed-topline')
    expect(topline).toBeTruthy()
    expect(topline.querySelector('.eh-name')?.value).toBe('搭子')
    // 紧凑信息条：描述/示例问题；触发词无任何展示入口（已有 triggers 数据也不渲染，仅数据层只读透传）
    const infobar = el.querySelector('.ed-infobar')
    expect(infobar).toBeTruthy()
    expect(infobar.textContent).toContain('描述')
    expect(infobar.textContent).not.toContain('触发词')
    expect(infobar.textContent).not.toContain('报销')
    // .ed-meta 左栏已解散
    expect(el.querySelector('.ed-meta')).toBeNull()
  })

  it('头部改技能名 → emit update:skill 携带 name（走 PUT 链路），不触碰 frontmatter', async () => {
    mountLive({ skillId: 1, name: '搭子', description: 'd', triggers: [], skillMd: FM, referencedTools: [] })
    const input = liveContainer.querySelector('.eh-name')
    input.value = '新搭子'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(lastPatch?.name).toBe('新搭子')
    // §12 解耦：改技能名不动 frontmatter（skillMd 不变，包名仍是「包名」）
    expect(lastPatch?.skillMd ?? skillRef.value.skillMd).toContain('name: 包名')
  })

  it('frontmatter raw 纯编辑 → 仅拼回 skillMd、不联动技能级 name/description', async () => {
    mountLive({ skillId: 1, name: '搭子', description: '技能级简介', triggers: [], skillMd: FM, referencedTools: [] })
    await nextTick()
    expect(typeof lastFmEmit).toBe('function')
    // 在 raw 改 name/description（包元数据），不应回写技能级面板字段
    lastFmEmit('name: 改了包名\ndescription: 改了包描述\nlicense: MIT\nmetadata:\n  owner: 张三')
    await nextTick()
    // 技能级 name/description 保持原值不变（解耦：fmBound.set 只回吐 skillMd，emitPatch 透传旧 name/description）
    expect(lastPatch?.name).toBe('搭子')
    expect(lastPatch?.description).toBe('技能级简介')
    // skillMd 已拼回新 frontmatter，首字节 ---、license 保留
    expect(lastPatch?.skillMd).toContain('改了包名')
    expect(lastPatch?.skillMd).toContain('license: MIT')
    expect(lastPatch?.skillMd.startsWith('---\n')).toBe(true)
  })

  it('§12：撤左侧已引用块（.ed-meta 解散），已引用工具改由右侧 ToolDock 承载', () => {
    const el = mount({
      skill: ref({
        skillId: 1, name: 'x', description: '', triggers: [],
        skillMd: '---\nname: x\n---\n@tool[biz__a]',
        referencedTools: [{ code: 'biz__a', bizName: '工具A', checkStatus: 'HEALTHY' }]
      }),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref('')
    })
    // 左侧 .ed-meta 已引用块不存在（已迁入 ToolDock，本测 ToolDock 被存根）
    expect(el.querySelector('.ed-meta')).toBeNull()
  })
})

describe('SkillFocusEditor · 极简顶行收口（技能名唯一 + 顶行导航两模式）', () => {
  const skillRef = () => ref({ skillId: 1, name: '搭子', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: 'QUERY' })

  it('技能名全页只渲染一次：极简顶行 .eh-name input 有值，顶行文本无重复技能名', () => {
    const el = mount({
      skill: skillRef(),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { positionId: 9, positionName: '客服岗', agents: [], currentAgentId: null }
    })
    // 极简顶行唯一可编辑技能名（input.value）
    expect(el.querySelector('.eh-name')?.value).toBe('搭子')
    // 顶行无尾部技能名（导航/类别文本不含「搭子」纯文本）
    const topline = el.querySelector('.ed-topline')
    expect(topline?.textContent || '').not.toContain('搭子')
    // 旧的独立标题层/面包屑容器已不存在
    expect(el.querySelector('.ed-header')).toBeNull()
    expect(el.querySelector('.ed-crumb')).toBeNull()
  })

  it('类别只读标签只在顶行一处（eh-category），无面包屑类别标签', () => {
    const el = mount({
      skill: skillRef(),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { positionId: 9, positionName: '客服岗', agents: [], currentAgentId: null }
    })
    expect(el.querySelectorAll('.eh-category').length).toBe(1)
    expect(el.querySelector('.crumb-category')).toBeNull()
  })

  it('游离模式（无 positionId）：极简顶行无导航前缀，仅技能名', () => {
    const el = mount({
      skill: skillRef(),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { positionId: null, agents: [], currentAgentId: null }
    })
    const topline = el.querySelector('.ed-topline')
    expect(topline).toBeTruthy() // 顶行恒在（技能名落点）
    expect(topline.querySelector('.crumb-agent')).toBeNull() // 游离无导航
    expect(topline.textContent).not.toContain('客服岗')
    expect(el.querySelector('.eh-name')?.value).toBe('搭子')
  })

  it('整页（showClose=false）：顶行含「← 返回」+ 技能名称 label；保存灯移入文件标签条（文件名右侧）；#4 无删除⋯', () => {
    const onBack = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({
      render: () =>
        h(SkillFocusEditor, {
          skill: { skillId: 1, name: '搭子', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: 'QUERY' },
          files: FILES,
          activeFilePath: 'SKILL.md',
          activeFileType: 'md',
          activeFileContent: '',
          showClose: false,
          backLabel: '← 返回',
          // 组① 四态保存灯：传 saved 态（替代旧 autosaveText 字符串）。
          saveStatus: { phase: 'saved', savedAt: Date.now() },
          onBack
        })
    })
    for (const [n, c] of Object.entries(stubs)) app.component(n, c)
    app.mount(container)
    const topline = container.querySelector('.ed-topline')
    // ← 返回（下沉进顶行，#2 文案一律「← 返回」）
    const back = topline.querySelector('.topline-back')
    expect(back?.textContent.trim()).toBe('← 返回')
    back.click()
    expect(onBack).toHaveBeenCalled()
    // #3：技能名前固定 label「技能名称：」
    expect(topline.querySelector('.eh-name-label')?.textContent).toContain('技能名称')
    // 保存灯（2026-07-08 反馈 #3）：不在顶栏（避免与「保存配置」歧义），移入文件标签条文件名右侧
    expect(topline.querySelector('.save-ind')).toBeNull()
    const filebar = container.querySelector('.ed-filebar')
    expect(filebar.querySelector('.save-ind')).toBeTruthy()
    expect(filebar.querySelector('.save-ind')?.textContent).toContain('已保存')
    // #4：整页编辑器不要删除入口 → 无 ⋯
    expect(topline.querySelector('.crumb-more')).toBeNull()
  })

  it('布局调整：描述为固定 3 行 textarea + 1000 字上限（右下角计数器，2026-08-14 上下全宽布局）', () => {
    const el = mount({
      skill: skillRef(),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { positionId: null, agents: [], currentAgentId: null }
    })
    const descInput = el.querySelector('.ed-infobar .ib-desc .ib-input')
    expect(descInput).toBeTruthy()
    // 描述用 textarea：固定 3 行不长高（无 autosize，2026-08-14 布局）+ maxlength 1000（2026-07-13 需求，原 200）
    expect(descInput.getAttribute('data-type')).toBe('textarea')
    expect(descInput.getAttribute('data-autosize')).toBe('')
    expect(descInput.getAttribute('data-rows')).toBe('3')
    expect(descInput.getAttribute('data-maxlength')).toBe('1000')
  })

  it('布局调整 #2：信息条上下结构（2026-08-14）——描述 desc 区、示例问题 eq 区两区，触发词区已移除', () => {
    const el = mount({
      skill: skillRef(),
      files: ref(FILES),
      activeFilePath: ref('SKILL.md'),
      activeFileType: ref('md'),
      activeFileContent: ref(''),
      extra: { positionId: null, agents: [], currentAgentId: null }
    })
    const infobar = el.querySelector('.ed-infobar')
    // 两个字段区（上「描述」下「示例问题」全宽拉通）；触发词区已整块移除（2026-08-13）
    const fields = [...infobar.querySelectorAll('.ib-field')]
    expect(fields.length).toBe(2)
    expect(infobar.querySelector('.ib-desc')).toBeTruthy()
    expect(infobar.querySelector('.ib-eq')).toBeTruthy()
    expect(infobar.querySelector('.ib-trig')).toBeNull()
    // 两个 label 都是 .ib-l（固定宽 + 不换行）
    expect(infobar.querySelectorAll('.ib-l').length).toBe(2)
    // 仅描述必填带红星；示例问题选填无红星（2026-08-13 放开必填）
    expect(infobar.querySelectorAll('.ib-l .ib-req').length).toBe(1)
    // 反馈 #2：信息条不再渲染任何常驻提示文案
    expect(infobar.querySelector('.ib-route-hint')).toBeNull()
    expect(infobar.querySelector('.ib-trig-req')).toBeNull()
  })
})
