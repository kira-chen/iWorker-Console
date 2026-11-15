// @vitest-environment jsdom
/**
 * 岗位详情「技能」页签（PositionSkillTab）的移除与上限提示（产品优化需求-202611 修改点 1，2026-11-12 原型走查补齐）。
 *
 * 口径（docs/PRD/数字员工管理端PRD/产品优化需求-202611.md §1「技能」页签）：
 * - 移除：本岗位有自动化任务在「引用技能」里引用着这个技能时不能移除——点【移除】后直接提示
 *   「「技能名」正被自动化任务「任务名」引用，请先从任务里移除」，不弹确认；没被引用的照常弹确认；
 * - 上限：达到上限后未勾选的复选框置灰，抽屉内显示提示「每个岗位最多引用 100 个技能」；
 *   已引用满 100 个时【添加技能】置灰并显示「已达 100 个上限」，悬停提示同上。
 * - 抽屉候选取数据层 listPositionSkillCandidates（按岗位算好，「已发布」口径见 positionRefGuards.test.js）。
 *
 * 列表列、抽屉、编辑跳转、回收标签、只读态等页签基础行为见同目录 PositionSkillTab.test.js，本文件只守上面几条。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { passthrough } from '../../../views/admin/__tests__/helpers/commonStubs'

const store = reactive({ positionId: 401, skills: [], attachSkill: vi.fn(), detachSkill: vi.fn() })
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), alert: vi.fn(() => Promise.resolve()) }
}))
const listPositionSkillCandidates = vi.fn()
const checkDetachPositionSkill = vi.fn()
vi.mock('@/api/position', () => ({
  listPositionSkillCandidates: (...a) => listPositionSkillCandidates(...a),
  checkDetachPositionSkill: (...a) => checkDetachPositionSkill(...a)
}))
vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title'],
    setup: (props, { slots }) => () =>
      props.visible ? h('div', { class: 'drawer', 'data-title': props.title }, [slots.default?.(), h('div', { class: 'drawer-foot' }, slots.footer?.())]) : null
  }
}))

const { ElMessage, ElMessageBox } = await import('element-plus')
const PositionSkillTab = (await import('@/components/position/PositionSkillTab.vue')).default

const elButton = {
  props: ['disabled', 'type', 'link', 'size', 'loading'],
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
}
const elCheckbox = {
  props: ['modelValue', 'disabled'],
  emits: ['change'],
  template: '<label class="el-checkbox" :data-checked="String(!!modelValue)" :data-disabled="String(!!disabled)"><input type="checkbox" :disabled="disabled" @change="$emit(\'change\')" /><slot /></label>'
}
const elTable = {
  props: ['data', 'emptyText'],
  provide() { return { tableRows: () => this.data || [] } },
  template: '<div class="el-table"><slot /></div>'
}
const elTableColumn = {
  props: ['label'],
  inject: ['tableRows'],
  setup(props, { slots }) {
    return function () {
      return h('div', { class: 'col', 'data-label': props.label }, this.tableRows().map((row) => h('div', { class: 'cell' }, slots.default?.({ row }))))
    }
  }
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionSkillTab) })
  app.component('el-button', elButton)
  app.component('el-checkbox', elCheckbox)
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  app.component('el-input', { props: ['modelValue'], template: '<input class="el-input" :value="modelValue" />' })
  app.component('el-tag', passthrough('el-tag'))
  app.component('el-tooltip', passthrough('el-tooltip'))
  app.directive('loading', {})
  app.mount(container)
  await flush()
}
const flush = async () => {
  for (let i = 0; i < 6; i++) { await nextTick(); await Promise.resolve() }
}
const skillRows = (n) => Array.from({ length: n }, (_, i) => ({ skillId: 'sk_' + i, name: '技能' + i, toolCount: 0 }))
const buttons = (text) => [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === text)
const headAddBtn = () => container.querySelector('.pd-card-head .el-button')
const limitTip = () => document.querySelector('[data-testid="skill-limit-tip"]')

beforeEach(() => {
  vi.clearAllMocks()
  store.skills = [{ skillId: 'sk_301', name: '日报周报生成', toolCount: 1 }]
  listPositionSkillCandidates.mockResolvedValue([{ id: 'sk_305', name: '客户拜访准备', description: '' }, { id: 'sk_309', name: '行业研究', description: '' }])
  checkDetachPositionSkill.mockResolvedValue('')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('移除技能：被本岗位自动化任务引用时直接提示，不弹确认（修改点 1）', () => {
  it('预检回拦截文案 → 弹提示框原样展示，不弹移除确认、不调移除', async () => {
    const msg = '「日报周报生成」正被自动化任务「每日经营晨报」引用，请先从任务里移除'
    checkDetachPositionSkill.mockResolvedValue(msg)
    await mount()
    buttons('移除')[0].click()
    await flush()
    expect(checkDetachPositionSkill).toHaveBeenCalledWith(401, 'sk_301')
    expect(ElMessageBox.alert).toHaveBeenCalledWith(msg, '移除技能', expect.objectContaining({ confirmButtonText: '知道了' }))
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(store.detachSkill).not.toHaveBeenCalled()
  })

  it('没被引用 → 照常弹「仅解除技能与当前岗位的关联…」确认，确认后移除并提示「技能已移除」', async () => {
    await mount()
    buttons('移除')[0].click()
    await flush()
    expect(ElMessageBox.alert).not.toHaveBeenCalled()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith('仅解除技能与当前岗位的关联，不删除技能本身。确认移除？', '移除技能', expect.anything())
    expect(store.detachSkill).toHaveBeenCalledWith('sk_301')
    expect(ElMessage.success).toHaveBeenCalledWith('技能已移除')
  })
})

describe('上限提示「每个岗位最多引用 100 个技能」看得见（修改点 1）', () => {
  it('抽屉里已引用 + 本次勾选达到 100 → 内联出提示、未勾选项置灰；没到上限时不出', async () => {
    store.skills = skillRows(99)
    await mount()
    headAddBtn().click()
    await flush()
    expect(listPositionSkillCandidates).toHaveBeenCalledWith(401, undefined)
    expect(limitTip()).toBeNull()
    document.querySelector('.drawer .el-checkbox input').dispatchEvent(new Event('change'))
    await flush()
    expect(limitTip()?.textContent.trim()).toBe('每个岗位最多引用 100 个技能')
    const boxes = [...document.querySelectorAll('.drawer .el-checkbox')]
    expect(boxes.map((b) => b.dataset.disabled)).toEqual(['false', 'true'])
  })

  it('已引用满 100 个 →【添加技能】置灰、文案「已达 100 个上限」，悬停提示同一句；未满时没有悬停提示', async () => {
    store.skills = skillRows(100)
    await mount()
    expect(headAddBtn().disabled).toBe(true)
    expect(headAddBtn().textContent.trim()).toBe('已达 100 个上限')
    expect(headAddBtn().getAttribute('title')).toBe('每个岗位最多引用 100 个技能')

    app.unmount()
    container.remove()
    store.skills = skillRows(3)
    await mount()
    expect(headAddBtn().disabled).toBe(false)
    expect(headAddBtn().hasAttribute('title')).toBe(false)
  })
})

describe('技能分类列（修改点 15：删除分类后技能显示「未分类」）', () => {
  const categoryCells = () => [...container.querySelectorAll('.col[data-label="技能分类"] .cell')].map((c) => c.textContent.trim())

  it('有分类显示分类名；分类为空（没有分类或已在字段字典删掉）显示「未分类」，不回落成「查询类」', async () => {
    store.skills = [
      { skillId: 'sk_1', name: 'A', toolCount: 0, category: 'QUERY', displayCategoryName: '办公效率' },
      { skillId: 'sk_2', name: 'B', toolCount: 0, category: 'QUERY', displayCategoryName: '' }
    ]
    await mount()
    expect(categoryCells()).toEqual(['办公效率', '未分类'])
  })

  it('技能本体已删的悬空引用显示「—」', async () => {
    store.skills = [{ skillId: 'sk_x', name: '（技能已删除）', toolCount: 0, category: 'QUERY', displayCategoryName: '', deleted: true }]
    await mount()
    expect(categoryCells()).toEqual(['—'])
  })
})
