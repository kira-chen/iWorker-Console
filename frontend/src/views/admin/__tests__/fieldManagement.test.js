// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * FieldManagement.vue（字段字典）单测（2026-09-12 测试审计 T56 新建，此前 393 行零测试）。
 *
 * 对齐 md `prd.字段字典.md`：
 * - §一 L8 页面说明；L9 无搜索筛选，进入直接展示全部分组；
 * - §二 分组头（箭头 / 名称 / 说明 / 字段数量）+ 字段卡片（名称 / 选项数量 / 预览 / 无选项「暂无选项」/【编辑】）；
 * - §2.1 默认展开，点箭头只收起该分组、其他分组不受影响；§2.2 两字段（平台技能›技能分类、专家›专家分类）；
 * - §三 编辑弹窗「编辑字段名」：顶部字段说明、每行 序号+输入框+删除、【＋ 添加选项】新增并聚焦、
 *   选项 ≤30 字、【完成】统一保存 → 「字段选项已保存」、【取消】放弃未保存修改；
 * - §五 空值「选项值不能为空」/ 重复「选项值不能重复」阻止保存、保存失败弹窗保持打开并展示原因。
 * - §三 L48 点删除仅从当前编辑草稿中移除、不弹确认（2026-09-12 审计 J19/K32 闭环：原 ElMessageBox 删除确认已撤）。
 * ListStates / PageHeader 真挂载；EP 控件桩（el-dialog / el-input / el-button / el-icon）。
 */

const listFieldDict = vi.fn()
const saveFieldOptions = vi.fn()
vi.mock('@/api/fieldDict', () => ({
  listFieldDict: (...a) => listFieldDict(...a),
  saveFieldOptions: (...a) => saveFieldOptions(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))
vi.mock('@element-plus/icons-vue', () => ({ Edit: { render: () => h('i', { class: 'icon-edit' }) } }))

const FieldManagement = (await import('@/views/admin/FieldManagement.vue')).default

const elDialog = {
  props: ['modelValue', 'title', 'width'],
  emits: ['update:modelValue'],
  template:
    '<div v-if="modelValue" class="el-dialog" :data-title="title"><div class="dlg-body"><slot /></div><div class="dlg-footer"><slot name="footer" /></div></div>'
}
// 输入框桩：暴露 focus()（「添加选项」后页面调 optionInputs[i].focus()）
const elInput = {
  props: ['modelValue', 'maxlength', 'placeholder'],
  emits: ['update:modelValue', 'input'],
  methods: {
    focus() {
      this.$el.focus()
    }
  },
  template:
    '<input class="el-input" :value="modelValue" :maxlength="maxlength" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, link: Boolean, plain: Boolean },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(FieldManagement)
  app.component('el-dialog', elDialog)
  app.component('el-input', elInput)
  app.component('el-button', elButton)
  app.component('el-icon', passthrough('el-icon'))
  app.component('el-empty', elEmpty)
  app.component('ArrowRight', { render: () => h('i', { class: 'arrow arrow-right' }) })
  app.component('ArrowDown', { render: () => h('i', { class: 'arrow arrow-down' }) })
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const groups = () => [...container.querySelectorAll('.aps-group')]
const groupNamed = (name) => groups().find((g) => g.querySelector('.aps-group-name').textContent === name)
const cards = (group) => [...group.querySelectorAll('.conn-row')]
const dialog = () => container.querySelector('.el-dialog')
const draftInputs = () => [...container.querySelectorAll('.fm-opt-row .el-input')]
const dialogBtn = (text) => [...container.querySelectorAll('.el-dialog .el-button')].find((b) => b.textContent.trim() === text)
const setInput = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const mk = (names) => names.map((n, i) => ({ id: i + 1, name: n }))
const SKILL = ['办公效率', '智能创作', '数据分析', '开发编程', 'IT运维与安全', '行业专业', '知识与学习', '其他']
const EXPERT = ['通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权']

beforeEach(() => {
  listFieldDict.mockReset().mockResolvedValue({ skillCategory: mk(SKILL), expertCategory: mk(EXPERT) })
  saveFieldOptions.mockReset().mockImplementation((key, names) => Promise.resolve(mk(names)))
  ElMessageBox.confirm.mockReset().mockResolvedValue('confirm')
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('FieldManagement · 字段字典（md prd.字段字典.md）', () => {
  it('页面说明取 md §一 L8；无搜索筛选，进入直接展示两分组（平台技能 / 专家）与各自 1 个字段（md §一 L9 / §2.2）', async () => {
    await mount()
    expect(container.textContent).toContain('集中维护平台各类可配置字段字典。「编辑」进入后可增删改该字段下的选项值。')
    expect(container.querySelector('.list-toolbar')).toBeNull()
    expect(container.querySelector('input[placeholder]')).toBeNull()
    expect(groups().map((g) => g.querySelector('.aps-group-name').textContent)).toEqual(['平台技能', '专家'])
    for (const g of groups()) expect(g.querySelector('.aps-group-count').textContent).toBe('1 个字段')
    expect(cards(groupNamed('平台技能')).map((c) => c.querySelector('.conn-name').textContent)).toEqual(['技能分类'])
    expect(cards(groupNamed('专家')).map((c) => c.querySelector('.conn-name').textContent)).toEqual(['专家分类'])
  })

  it('字段卡片：名称、当前选项数量、选项值预览（顿号连接，md §2.2 顺序）、【编辑】（md §二）', async () => {
    await mount()
    const card = cards(groupNamed('平台技能'))[0]
    expect(card.querySelector('.fm-count').textContent).toBe('8 个选项')
    expect(card.querySelector('.fm-preview').textContent.trim()).toBe(SKILL.join('、'))
    expect([...card.querySelectorAll('.conn-ops .el-button')].map((b) => b.textContent.trim())).toEqual(['编辑'])
    const expertCard = cards(groupNamed('专家'))[0]
    expect(expertCard.querySelector('.fm-preview').textContent.trim()).toBe(EXPERT.join('、'))
  })

  it('字段无选项 → 卡片显示「暂无选项」与「0 个选项」（md §二 L19 / §五 L68）', async () => {
    listFieldDict.mockResolvedValueOnce({ skillCategory: mk(SKILL), expertCategory: [] })
    await mount()
    const expertCard = cards(groupNamed('专家'))[0]
    expect(expertCard.querySelector('.fm-na').textContent).toBe('暂无选项')
    expect(expertCard.querySelector('.fm-count').textContent).toBe('0 个选项')
    expect(cards(groupNamed('平台技能'))[0].querySelector('.fm-na')).toBeNull()
  })

  it('分组默认展开；点分组头箭头只收起该组（箭头 ↓→→），其他分组不受影响；再点恢复（md §2.1）', async () => {
    await mount()
    const skillGroup = groupNamed('平台技能')
    const expertGroup = groupNamed('专家')
    expect(skillGroup.querySelector('.aps-group-body')).toBeTruthy()
    expect(expertGroup.querySelector('.aps-group-body')).toBeTruthy()
    expect(skillGroup.querySelector('.arrow-down')).toBeTruthy()
    skillGroup.querySelector('.aps-collapse-btn').click()
    await flush()
    expect(groupNamed('平台技能').querySelector('.aps-group-body')).toBeNull()
    expect(groupNamed('平台技能').querySelector('.arrow-right')).toBeTruthy()
    expect(groupNamed('专家').querySelector('.aps-group-body')).toBeTruthy()
    expect(groupNamed('专家').querySelector('.arrow-down')).toBeTruthy()
    groupNamed('平台技能').querySelector('.aps-collapse-btn').click()
    await flush()
    expect(groupNamed('平台技能').querySelector('.aps-group-body')).toBeTruthy()
  })

  it('【编辑】→ 打开「编辑技能分类」弹窗：顶部字段说明、草稿行数 = 选项数、每行 序号+输入框（maxlength 30）+删除钮、末尾【＋ 添加选项】（md §三）', async () => {
    await mount()
    cards(groupNamed('平台技能'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    expect(dialog()).toBeTruthy()
    expect(dialog().dataset.title).toBe('编辑技能分类')
    expect(dialog().querySelector('.fm-dlg-hint').textContent).toBe('客户端市场技能的展示分类')
    const rows = [...dialog().querySelectorAll('.fm-opt-row')]
    expect(rows).toHaveLength(8)
    expect(rows.map((r) => r.querySelector('.fm-opt-idx').textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(draftInputs().map((i) => i.value)).toEqual(SKILL)
    for (const i of draftInputs()) expect(i.getAttribute('maxlength')).toBe('30')
    for (const r of rows) expect(r.querySelector('.fm-opt-del')).toBeTruthy()
    expect(dialog().querySelector('.fm-opt-add .el-button').textContent.trim()).toBe('＋ 添加选项')
    expect([...dialog().querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '完成'])
  })

  it('【＋ 添加选项】→ 末尾新增一空行并聚焦该输入框（md §三 L47）', async () => {
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    dialog().querySelector('.fm-opt-add .el-button').click()
    await flush()
    const inputs = draftInputs()
    expect(inputs).toHaveLength(9)
    expect(inputs[8].value).toBe('')
    expect(document.activeElement).toBe(inputs[8])
    expect([...dialog().querySelectorAll('.fm-opt-idx')].at(-1).textContent).toBe('9')
  })

  it('点某行删除钮 → 草稿行 −1、序号重排、不弹 confirm、不调保存（md §三 L48：仅从当前编辑草稿中移除；审计 J19/K32）', async () => {
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    expect(draftInputs()).toHaveLength(8)
    dialog().querySelectorAll('.fm-opt-row .fm-opt-del')[1].click() // 删第 2 行「法律」
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(draftInputs()).toHaveLength(7)
    expect(draftInputs().map((i) => i.value)).toEqual(EXPERT.filter((n) => n !== '法律'))
    expect([...dialog().querySelectorAll('.fm-opt-idx')].map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(saveFieldOptions).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
  })

  it('选项为空 → 【完成】被拦：弹窗内提示「选项值不能为空」、不调保存、弹窗不关（md §五 L66）；改输入后提示消失', async () => {
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    dialog().querySelector('.fm-opt-add .el-button').click()
    await flush()
    setInput(draftInputs()[8], '   ')
    dialogBtn('完成').click()
    await flush()
    expect(dialog().querySelector('.fm-dlg-error').textContent).toBe('选项值不能为空')
    expect(saveFieldOptions).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    setInput(draftInputs()[8], '合规')
    await flush()
    expect(dialog().querySelector('.fm-dlg-error').textContent).toBe('')
  })

  it('选项重复（同字段内） → 【完成】被拦：提示「选项值不能重复」、不调保存（md §三 L49 / §五 L67）', async () => {
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    setInput(draftInputs()[1], ' 通用 ') // 与第 1 行「通用」重复（trim 后比对）
    dialogBtn('完成').click()
    await flush()
    expect(dialog().querySelector('.fm-dlg-error').textContent).toBe('选项值不能重复')
    expect(saveFieldOptions).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
  })

  it('【完成】合法 → saveFieldOptions(字段 key, trim 后的草稿名) → toast「字段选项已保存」→ 弹窗关、卡片预览 / 数量取保存返回值（md §三 L50 / §四 L56）', async () => {
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    dialog().querySelector('.fm-opt-add .el-button').click()
    await flush()
    setInput(draftInputs()[8], ' 合规 ')
    dialogBtn('完成').click()
    await flush()
    expect(saveFieldOptions).toHaveBeenCalledWith('expertCategory', [...EXPERT, '合规'])
    expect(ElMessage.success).toHaveBeenCalledWith('字段选项已保存')
    expect(dialog()).toBeNull()
    const expertCard = cards(groupNamed('专家'))[0]
    expect(expertCard.querySelector('.fm-count').textContent).toBe('9 个选项')
    expect(expertCard.querySelector('.fm-preview').textContent.trim()).toBe([...EXPERT, '合规'].join('、'))
    // 另一字段不受影响
    expect(cards(groupNamed('平台技能'))[0].querySelector('.fm-preview').textContent.trim()).toBe(SKILL.join('、'))
  })

  it('保存失败 → 弹窗保持打开并展示失败原因，不 toast 成功、卡片不变（md §五 L69）', async () => {
    saveFieldOptions.mockRejectedValueOnce(new Error('服务暂不可用'))
    await mount()
    cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button').click()
    await flush()
    setInput(draftInputs()[0], '通用组')
    dialogBtn('完成').click()
    await flush()
    expect(dialog()).toBeTruthy()
    expect(dialog().querySelector('.fm-dlg-error').textContent).toBe('服务暂不可用')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(cards(groupNamed('专家'))[0].querySelector('.fm-preview').textContent.trim()).toBe(EXPERT.join('、'))
  })

  it('【取消】→ 放弃本次未保存修改：弹窗关、不调保存；重开草稿回到已保存态（md §三 L51）', async () => {
    await mount()
    const edit = () => cards(groupNamed('专家'))[0].querySelector('.conn-ops .el-button')
    edit().click()
    await flush()
    setInput(draftInputs()[0], '被改掉的值')
    dialog().querySelector('.fm-opt-add .el-button').click()
    await flush()
    dialogBtn('取消').click()
    await flush()
    expect(dialog()).toBeNull()
    expect(saveFieldOptions).not.toHaveBeenCalled()
    edit().click()
    await flush()
    expect(draftInputs().map((i) => i.value)).toEqual(EXPERT)
  })

  it('字典加载失败 → 「加载失败」+【重试】，重试成功后分组出现', async () => {
    listFieldDict.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    expect(groups()).toHaveLength(0)
    ;[...container.querySelectorAll('.el-empty .el-button')].find((b) => b.textContent.trim() === '重试').click()
    await flush()
    expect(container.querySelector('.el-empty')).toBeNull()
    expect(groups()).toHaveLength(2)
  })
})
