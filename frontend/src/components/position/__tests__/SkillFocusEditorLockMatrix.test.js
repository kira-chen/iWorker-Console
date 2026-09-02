// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

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
  default: { name: 'SkillMilkdownEditor', setup: () => () => h('div', { class: 'stub-milkdown' }) }
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
  app?.unmount()
  container?.remove()
})

const lockNotice = (el) => el.querySelector('.ed-lock-notice')
const saveCfgBtn = (el) => el.querySelector('.topline-savecfg')

describe('审核锁定 × 通道矩阵（穷举：漏归类通道 = 在审仍可改）', () => {
  it('platform + 在审 → 锁定条常驻，写入口（保存配置等）不渲染', () => {
    const el = mount({ skillSource: 'platform', publications: REVIEWING })
    expect(lockNotice(el)).toBeTruthy()
    expect(saveCfgBtn(el)).toBeNull()
  })

  it('system（V89 平台族）+ 在审 → 同样锁定（守 isPlatformSkill 通道归类）', () => {
    const el = mount({ skillSource: 'system', publications: REVIEWING, hideMarketFields: true })
    expect(lockNotice(el)).toBeTruthy()
    expect(saveCfgBtn(el)).toBeNull()
  })

  it('fde + 同形 publications → 不锁（发布态仅对平台族有意义）', () => {
    const el = mount({ skillSource: 'fde', publications: REVIEWING })
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
