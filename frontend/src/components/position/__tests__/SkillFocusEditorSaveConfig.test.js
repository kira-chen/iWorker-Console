// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

/**
 * 「保存配置」点击的输入法组合态竞态修复（2026-07-15 用户反馈）：
 * 组合态文本要等 blur → compositionend 才回写 v-model，且部分浏览器/输入法把该提交异步派发。
 * 修复约定：点击按钮须先 blur 当前聚焦元素，并等一个宏任务后才 emit('save-config')，
 * 保证父级校验（触发词/示例问题必填门）读到的是已提交状态。
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
  'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': { template: '<div><slot /></div>' },
  'el-drawer': { template: '<div><slot /></div>' },
  StatusTag: { template: '<span><slot /></span>' }
}

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
        configDirty: true,
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

describe('SkillFocusEditor ·「保存配置」先失焦再通知父级（输入法组合态竞态修复）', () => {
  it('点击按钮 → 当前聚焦输入框被 blur，save-config 延后一个宏任务 emit', async () => {
    const order = []
    const el = mount({ onSaveConfig: () => order.push('save') })
    // 模拟示例问题输入框聚焦中、且其提交（组合态 compositionend → input）在 blur 后异步派发。
    const input = el.querySelector('.ib-eq input')
    expect(input).toBeTruthy()
    input.focus()
    expect(document.activeElement).toBe(input)
    input.addEventListener('blur', () => setTimeout(() => order.push('commit'), 0))

    const btn = el.querySelector('.topline-savecfg')
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)
    btn.click()
    // click 处理内已同步 blur；save-config 尚未 emit（等宏任务）。
    expect(document.activeElement).not.toBe(input)
    expect(order).toEqual([])

    await new Promise((resolve) => setTimeout(resolve, 10))
    // 异步提交先落地，save-config 后到 → 父级校验读到已提交状态。
    expect(order).toEqual(['commit', 'save'])
  })

  // 2026-08-17 规格变更：按钮不再随 configDirty 置灰——任何时刻可点，点击照常 emit（父级幂等提交）。
  it('configDirty=false → 按钮仍可点，点击照常 emit save-config', async () => {
    const onSaveConfig = vi.fn()
    const el = mount({ configDirty: false, onSaveConfig })
    const btn = el.querySelector('.topline-savecfg')
    expect(btn.disabled).toBe(false)
    btn.click()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })

  it('configSaving=true → 提交中禁用防连点', () => {
    const el = mount({ configSaving: true })
    const btn = el.querySelector('.topline-savecfg')
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('保存中')
  })
})
