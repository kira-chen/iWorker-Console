// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref, reactive, nextTick } from 'vue'

/**
 * SkillFocusEditor · 审核锁定 × 通道 穷举矩阵（技能编辑器加固批，2026-08-08）。
 *
 * 锁定语义（R1 发布模型）：平台族技能有在审提交（USER_END 行 PENDING_REVIEW / reviewPending）
 * 时编辑器整体只读锁定（锁定条常驻 + 全部写入口 v-if 不渲染）；干净 PUBLISHED 不锁（编辑不下线，
 * 为下一版本准备）。V89 后 'system'（系统默认技能）与 'platform' 同为平台族——本矩阵直接守
 * isPlatformSkill 的通道归类（2026-08-08 修复中扩展），漏归类会导致系统技能在审仍可改（数据漂移）。
 *
 * 市场字段门独立于锁定：默认安装开关仅「平台族 + 非只读 + !hideMarketFields」渲染
 * （系统默认技能通过 hideMarketFields 隐藏市场用户面字段）。
 */

vi.mock('@/components/position/SkillMilkdownEditor.vue', () => ({
  // expose resetSession：换技能（skillId 变）时编辑器会调它重置会话（2026-10-08【AI 生成】换对象用例需要）
  default: {
    name: 'SkillMilkdownEditor',
    setup: (_, { expose }) => {
      expose({ resetSession: () => {} })
      return () => h('div', { class: 'stub-milkdown' })
    }
  }
}))
vi.mock('@/components/position/CodeTextEditor.vue', () => ({
  default: { name: 'CodeTextEditor', setup: () => () => h('div', { class: 'stub-code' }) }
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
  'el-input': { template: '<div class="el-input-stub"><input /></div>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<div><slot /></div>' },
  'el-skeleton': { template: '<div />' },
  'el-button': { template: '<button><slot /></button>' },
  'el-switch': { template: '<span class="el-switch-stub" />' },
  'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': { template: '<div><slot /></div>' },
  'el-drawer': { template: '<div><slot /></div>' },
  StatusTag: { template: '<span><slot /></span>' }
}

/** USER_END 在审行（REVIEWING 态）。 */
const REVIEWING = [{ target: 'USER_END', status: 'PENDING_REVIEW' }]
/** USER_END 干净已发布行（不锁——编辑不下线语义）。 */
const PUBLISHED_CLEAN = [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: false }]

let app, container
function mount(extra = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return {
        skill: ref({ skillId: 1, name: 't', triggers: [], skillMd: '# md', referencedTools: [], category: null })
      }
    },
    render() {
      return h(SkillFocusEditor, {
        skill: this.skill,
        files: [],
        activeFilePath: 'SKILL.md',
        activeFileType: 'md',
        activeFileContent: '# md',
        ...extra
      })
    }
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}
afterEach(() => {
  vi.useRealTimers() // 2026-10-08：【AI 生成】组用 fake timers，中途失败也在此还原
  app?.unmount()
  container?.remove()
})

const lockNotice = (el) => el.querySelector('.ed-lock-notice')
const saveCfgBtn = (el) => el.querySelector('.topline-savecfg')

describe('审核锁定 × 通道矩阵（穷举：漏归类通道 = 在审仍可改）', () => {
  it('platform + 在审 → 锁定条常驻，写入口（保存配置等）不渲染', () => {
    const el = mount({ skillSource: 'platform', publications: REVIEWING })
    expect(lockNotice(el)).toBeTruthy()
    expect(lockNotice(el).textContent).toContain('技能审核中，已锁定不可修改')
    expect(saveCfgBtn(el)).toBeNull()
  })

  it('system（V89 平台族）+ 在审 → 同样锁定（守 isPlatformSkill 通道归类）', () => {
    const el = mount({ skillSource: 'system', publications: REVIEWING, hideMarketFields: true })
    expect(lockNotice(el)).toBeTruthy()
    expect(lockNotice(el).textContent).toContain('技能审核中，已锁定不可修改')
    expect(saveCfgBtn(el)).toBeNull()
  })

  // 2026-09-09 发布前收口：原断言「fde 在审不锁」是旧口径。md §三.1 L73「审核中的技能只能
  // 查看，不可编辑」无类型限定，§二.3.2 L66「三类技能的按钮组合和流程规则完全一致」——
  // 岗位私有技能在审时同样必须锁定，否则可绕过列表的置灰按钮改掉在审对象。
  it('fde + 在审 → 同样锁定（三类技能规则一致，md §二.3.2 L66）', () => {
    const el = mount({ skillSource: 'fde', publications: REVIEWING })
    expect(lockNotice(el)).toBeTruthy()
    expect(lockNotice(el).textContent).toContain('技能审核中，已锁定不可修改')
    expect(saveCfgBtn(el)).toBeNull()
  })

  it('fde + 干净 PUBLISHED → 不锁（无在途提交即可编辑）', () => {
    const el = mount({ skillSource: 'fde', publications: PUBLISHED_CLEAN })
    expect(lockNotice(el)).toBeNull()
    expect(saveCfgBtn(el)).toBeTruthy()
  })

  it('platform + 干净 PUBLISHED → 不锁（编辑不下线，为下一版本准备）', () => {
    const el = mount({ skillSource: 'platform', publications: PUBLISHED_CLEAN })
    expect(lockNotice(el)).toBeNull()
    expect(saveCfgBtn(el)).toBeTruthy()
  })

  it('市场字段门：platform 渲染默认安装开关；system（hideMarketFields）不渲染', () => {
    const elP = mount({ skillSource: 'platform', publications: [] })
    expect(elP.querySelector('.eh-di')).toBeTruthy()
    app.unmount()
    container.remove()
    const elS = mount({ skillSource: 'system', publications: [], hideMarketFields: true })
    expect(elS.querySelector('.eh-di')).toBeNull()
  })
})

/* ======================================================================================
 * 2026-10-08 /test-audit 补缺口（对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.3 L182 只读态 /
 * §三.3 默认安装仅市场技能 / §三.3 L195 示例问题【AI 生成】；待办 yuepu#13·S1 / yuepu#26）。
 * 覆盖：只读态顶行（「只读查看」标记在，默认安装 / 【发布】/【保存】不渲染，分类下拉禁用不可改）；
 *       默认安装岗位私有分支；【AI 生成】500ms 回填与中途换技能不回填。
 * ====================================================================================== */

// 分类下拉桩：原生 select，disabled 透出，供只读断言「不可修改」
const selectStub = {
  props: { modelValue: { default: '' }, disabled: Boolean, placeholder: String },
  template: '<select class="eh-cat-select-stub" :disabled="disabled"><slot /></select>'
}

/** 带 adminContext 的挂载：props 放 reactive（个别用例挂载后要换 skill），onUpdate:skill 收进 spy。 */
let propsState, updateSkillSpy
function mountAdmin(extra = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  updateSkillSpy = vi.fn()
  propsState = reactive({
    skill: { skillId: 'sk_a', name: '客户回访', description: '回访客户并记录要点', exampleQuestion: '', triggers: [], skillMd: '# md', referencedTools: [], category: null },
    files: [],
    activeFilePath: 'SKILL.md',
    activeFileType: 'md',
    activeFileContent: '# md',
    adminContext: true,
    skillSource: 'platform',
    publications: [],
    categoryOptions: [{ id: '数据分析', name: '数据分析' }],
    ...extra
  })
  app = createApp({ render: () => h(SkillFocusEditor, { ...propsState, 'onUpdate:skill': updateSkillSpy }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.component('el-select', selectStub)
  app.component('el-option', { template: '<option />' })
  app.mount(container)
  return container
}

describe('只读态顶行（md 技能 §三.3 L182：只读展示「只读查看」，不展示分类修改 / 默认安装 / 【发布】/【保存】）', () => {
  it('readonly + adminContext → 「只读查看」标记在；默认安装、【发布】、【保存】不渲染；分类下拉禁用不可改', () => {
    const el = mountAdmin({ readonly: true })
    expect(el.querySelector('.topline-ro-mark')?.textContent.trim()).toBe('只读查看')
    expect(el.querySelector('.eh-di')).toBeNull()
    expect(el.querySelector('.topline-verpub')).toBeNull()
    expect(el.querySelector('.topline-savecfg')).toBeNull()
    // 分类：代码按「只读改禁用而非隐藏」（疑点8）渲染禁用下拉，与 md 同目录《技能编辑页-只读.png》一致——
    // 守的是「不能修改」这条用户可见结果
    const cat = el.querySelector('.eh-cat-select-stub')
    expect(cat === null || cat.disabled).toBe(true)
  })

  it('非只读 + adminContext（对照组）→ 无「只读查看」，默认安装 /【发布】/【保存】都在，分类下拉可改', () => {
    const el = mountAdmin({ readonly: false })
    expect(el.querySelector('.topline-ro-mark')).toBeNull()
    expect(el.querySelector('.eh-di')).toBeTruthy()
    expect(el.querySelector('.topline-verpub')?.textContent.trim()).toBe('发布')
    expect(el.querySelector('.topline-savecfg')).toBeTruthy()
    expect(el.querySelector('.eh-cat-select-stub').disabled).toBe(false)
  })
})

describe('默认安装仅市场技能（岗位私有分支，2026-10-08 补缺口）', () => {
  it('岗位私有（skillSource=fde）→ 不渲染默认安装开关 .eh-di', () => {
    const el = mount({ skillSource: 'fde', publications: [] })
    expect(el.querySelector('.eh-di')).toBeNull()
    // 前提：不是因为只读 / 锁定才藏——保存按钮在
    expect(saveCfgBtn(el)).toBeTruthy()
  })

  it('岗位私有 + 技能编辑器语境（adminContext）→ 同样不渲染默认安装', () => {
    const el = mountAdmin({ skillSource: 'fde' })
    expect(el.querySelector('.eh-di')).toBeNull()
    expect(el.querySelector('.topline-savecfg')).toBeTruthy()
  })
})

describe('示例问题【AI 生成】接线（md 技能 §三.3 L195；yuepu#13·S1 / yuepu#26）', () => {
  const aiBtn = () => container.querySelector('.ib-eq-ai')

  it('点【AI 生成】→ 500ms 后 emit update:skill，exampleQuestion 按技能名称生成', async () => {
    vi.useFakeTimers()
    mountAdmin()
    aiBtn().click()
    await nextTick()
    expect(aiBtn().textContent.trim()).toBe('生成中…')
    expect(updateSkillSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(updateSkillSpy).toHaveBeenCalledTimes(1)
    expect(updateSkillSpy.mock.calls[0][0]).toMatchObject({ skillId: 'sk_a', exampleQuestion: '请帮我使用这个技能完成"客户回访"' })
  })

  it('生成中途换成另一个技能（skillId 变）→ 到点不回填（不 emit update:skill）', async () => {
    vi.useFakeTimers()
    mountAdmin()
    aiBtn().click()
    await nextTick()
    propsState.skill = { ...propsState.skill, skillId: 'sk_b', name: '合同审阅' }
    await nextTick()
    vi.advanceTimersByTime(600)
    await nextTick()
    expect(updateSkillSpy).not.toHaveBeenCalled()
  })
})
