// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * N8（第三类，V72）：业务系统「专属技能」从零新建 / 编辑 / 删除 —— 验证 BizSystemEditor 在编辑态：
 *  - 打开时拉取专属技能列表（listBizSystemSkills）并展示；
 *  - 点「新建专属技能」→ 弹 el-dialog 取名（对齐 AdminSkills 新建范式）→ 填「技能名」→ 点「创建」
 *    → 调 createBizSystemOwnedSkill(id, { name }) → 重拉列表 + 新标签打开编辑器；
 *  - 新建弹窗校验：技能名为空点「创建」→ warning 提示、不建；点「取消」→ 关窗、不建；
 *  - 点某行「删除」→ 调 deleteBizSystemOwnedSkill(id, skillId) 并重拉列表；
 *  - 点某行「编辑」→ router.resolve 到 BizSystemSkillEdit 后 window.open 新标签；
 *  - 读失败 → 显示「加载失败」错误态（与「暂无」空态区分），并可「点此重试」。
 */

const admin = {
  createBizSystem: vi.fn(),
  updateBizSystem: vi.fn(),
  getBizSystem: vi.fn(() =>
    Promise.resolve({
      name: 'CRM',
      icon: '◎',
      description: '客户管理',
      loginUrl: 'https://crm.example.com/login',
      connType: 'login_session',
      bizPages: [],
      exampleQuestions: ['', '', ''],
      referencedBySkills: []
    })
  ),
  listBizSystemSkills: vi.fn(() => Promise.resolve([{ skillId: 'sk_1', name: '客户记录' }])),
  createBizSystemOwnedSkill: vi.fn(() => Promise.resolve({ skillId: 'sk_new', name: '新技能' })),
  deleteBizSystemOwnedSkill: vi.fn(() => Promise.resolve()),
  // 2026-09-01 PRD 对齐改造：示例问题 AI 生成（编辑器新增依赖，桩返回固定 3 条）
  aiGenerateBizExampleQuestions: vi.fn(() =>
    Promise.resolve({ questions: ['问题一', '问题二', '问题三'] })
  )
}
vi.mock('@/api/admin', () => admin)

// 2026-09-01 PRD 对齐改造取代旧口径：编辑器改从 defValidate 取名称/描述/示例问题上限常量
vi.mock('@/utils/defValidate', () => ({
  validateBizSystemForm: () => ({ ok: true, errors: {} }),
  BIZ_NAME_MAX: 64,
  BIZ_DESC_MAX: 2000,
  BIZ_PAGES_MAX: 20,
  BIZ_QUESTION_MAX: 60
}))

// 图标选择 popover（BQ5 新增依赖）：桩掉，避免其内部 api/position 链路在 jsdom 里发真实请求
vi.mock('@/components/position/IconPickerPopover.vue', () => ({
  default: {
    name: 'IconPickerPopover',
    props: ['icon', 'positionName'],
    emits: ['pick'],
    template: '<button class="stub-icon-picker" @click="$emit(\'pick\', { icon: \'✓\' })">选图标</button>'
  }
}))

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
// 新建取名改为 el-dialog + el-form（不再用 ElMessageBox.prompt）；仍导出 ElMessageBox 桩以防未来引用。
const box = { prompt: vi.fn(), confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: box }))

// vue-router：桩 useRouter，resolve 返回可辨识 href、便于断言编辑跳转。
const routerMock = { resolve: vi.fn(() => ({ href: '/admin/biz-systems/biz_1/skills/sk_1/edit' })) }
vi.mock('vue-router', () => ({ useRouter: () => routerMock }))

// EP 存根：受控组件把关键交互暴露成可点/可改的最小结构。
const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot /><div><slot name="footer" /></div></div>'
  },
  // 新建取名弹窗：受控 v-model，仅在打开时渲染内容 + footer（便于点「创建」/「取消」）。
  'el-dialog': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="el-dialog" v-if="modelValue"><slot /><div class="el-dialog-footer"><slot name="footer" /></div></div>'
  },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div class="el-form-item"><slot name="label" /><slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="el-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio': { props: ['value'], template: '<label :data-value="value"><slot /></label>' },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'focus'],
    template: '<div class="el-select"><slot /></div>'
  },
  'el-option': { props: ['label', 'value'], template: '<div class="el-option" :data-value="value" :data-label="label"></div>' },
  'el-button': {
    props: ['type', 'loading', 'disabled', 'link'],
    emits: ['click'],
    template: '<button class="el-button" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-skeleton': { template: '<div />' },
  'el-empty': { template: '<div><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  // 存根把「点 reference」直接等价为确认（emit confirm），便于断言删除真实落地。
  'el-popconfirm': {
    emits: ['confirm'],
    template: '<span class="el-popconfirm" @click="$emit(\'confirm\')"><slot name="reference" /></span>'
  },
  'el-icon': { template: '<i><slot /></i>' },
  Delete: { template: '<i />' }
}

let app, container
async function mountEditor(bizId) {
  const { default: Editor } = await import('@/components/admin/BizSystemEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  // 真实用法：visible 由 false→true 触发 load()（watch 非 immediate）。
  const visible = ref(false)
  app = createApp({ render: () => h(Editor, { visible: visible.value, bizId }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  visible.value = true
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return container
}

function findBtn(el, text) {
  return [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
}
// 在新建弹窗内定位按钮（弹窗 footer 与抽屉 footer 都可能有「取消」，需按弹窗作用域取）。
function findDialogBtn(el, text) {
  const dlg = el.querySelector('.el-dialog')
  if (!dlg) return undefined
  return [...dlg.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
}
// 在新建弹窗内定位技能名输入框并键入（触发 el-input 的 update:modelValue）。
function typeName(el, value) {
  const input = el.querySelector('.el-dialog .el-input')
  input.value = value
  input.dispatchEvent(new Event('input'))
}

let openSpy
beforeEach(() => {
  vi.clearAllMocks()
  // 恢复默认桩行为（clearAllMocks 会清实现）。
  admin.getBizSystem.mockResolvedValue({
    name: 'CRM',
    description: '',
    loginUrl: '',
    connType: 'login_session',
    bizPages: [],
    status: 'active',
    referencedBySkills: []
  })
  admin.listBizSystemSkills.mockResolvedValue([{ skillId: 'sk_1', name: '客户记录' }])
  admin.createBizSystemOwnedSkill.mockResolvedValue({ skillId: 'sk_new', name: '新技能' })
  admin.deleteBizSystemOwnedSkill.mockResolvedValue()
  routerMock.resolve.mockReturnValue({ href: '/admin/biz-systems/biz_1/skills/sk_1/edit' })
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => ({}))
})
afterEach(() => {
  openSpy?.mockRestore()
  app?.unmount()
  container?.remove()
})

describe('N8 · 业务系统专属技能 新建/编辑/删除', () => {
  it('编辑态打开 → 拉取专属技能列表并展示', async () => {
    const el = await mountEditor('biz_1')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1')
    expect(el.textContent).toContain('客户记录')
    expect(el.querySelector('.ad-bound-list')).toBeTruthy()
  })

  it('新建专属技能 → 弹窗取名 → 点「创建」→ 调 createBizSystemOwnedSkill、重拉列表、新标签开编辑器', async () => {
    const el = await mountEditor('biz_1')
    admin.listBizSystemSkills.mockClear()
    // 点「+ 新建专属技能」打开取名弹窗
    findBtn(el, '+ 新建专属技能').click()
    await nextTick()
    expect(el.querySelector('.el-dialog')).toBeTruthy()
    // 填技能名 → 点「创建」
    typeName(el, '回访记录')
    await nextTick()
    findDialogBtn(el, '创建').click()
    await Promise.resolve() // create
    await nextTick()
    await Promise.resolve() // reload
    await nextTick()
    expect(admin.createBizSystemOwnedSkill).toHaveBeenCalledWith('biz_1', { name: '回访记录' })
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1') // 重拉
    // 新标签打开编辑器（拿到新 skillId sk_new）。
    expect(routerMock.resolve).toHaveBeenCalledWith({
      name: 'BizSystemSkillEdit',
      params: { bizId: 'biz_1', id: 'sk_new' }
    })
    expect(openSpy).toHaveBeenCalled()
  })

  it('新建时点「取消」→ 关窗、不建、不开编辑器', async () => {
    const el = await mountEditor('biz_1')
    findBtn(el, '+ 新建专属技能').click()
    await nextTick()
    expect(el.querySelector('.el-dialog')).toBeTruthy()
    findDialogBtn(el, '取消').click()
    await nextTick()
    expect(el.querySelector('.el-dialog')).toBeNull() // 关窗
    expect(admin.createBizSystemOwnedSkill).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('新建时技能名为空点「创建」→ warning 提示、不建', async () => {
    const el = await mountEditor('biz_1')
    findBtn(el, '+ 新建专属技能').click()
    await nextTick()
    // 不填名直接点「创建」
    findDialogBtn(el, '创建').click()
    await nextTick()
    expect(msg.warning).toHaveBeenCalled()
    expect(admin.createBizSystemOwnedSkill).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('点某行「编辑」→ router.resolve 到 BizSystemSkillEdit 并 window.open', async () => {
    const el = await mountEditor('biz_1')
    findBtn(el, '编辑').click()
    await nextTick()
    expect(routerMock.resolve).toHaveBeenCalledWith({
      name: 'BizSystemSkillEdit',
      params: { bizId: 'biz_1', id: 'sk_1' }
    })
    expect(openSpy).toHaveBeenCalled()
  })

  it('删除专属技能 → 调 deleteBizSystemOwnedSkill 并重拉列表', async () => {
    const el = await mountEditor('biz_1')
    admin.listBizSystemSkills.mockClear()
    findBtn(el, '删除').click()
    await Promise.resolve()
    await nextTick()
    await Promise.resolve()
    expect(admin.deleteBizSystemOwnedSkill).toHaveBeenCalledWith('biz_1', 'sk_1')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1') // 重拉
  })

  it('读失败 → 显示「加载失败」错误态（与「暂无」空态区分），不静默降级为空', async () => {
    admin.listBizSystemSkills.mockRejectedValueOnce(new Error('boom'))
    const el = await mountEditor('biz_1')
    expect(el.querySelector('.ad-bound-err')).toBeTruthy()
    expect(el.textContent).toContain('专属技能加载失败')
    expect(el.textContent).not.toContain('还没有专属技能')
    expect(el.querySelector('.ad-bound-list')).toBeNull()
  })

  it('读失败后点「点此重试」→ 重拉成功则显示列表、错误态消失', async () => {
    admin.listBizSystemSkills.mockRejectedValueOnce(new Error('boom'))
    const el = await mountEditor('biz_1')
    expect(el.querySelector('.ad-bound-err')).toBeTruthy()
    admin.listBizSystemSkills.mockResolvedValueOnce([{ skillId: 'sk_1', name: '客户记录' }])
    findBtn(el, '点此重试').click()
    await Promise.resolve()
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(el.querySelector('.ad-bound-err')).toBeNull()
    expect(el.querySelector('.ad-bound-list')).toBeTruthy()
    expect(el.textContent).toContain('客户记录')
  })

  it('空态 → 显示「还没有专属技能」引导文案（无内部黑话）', async () => {
    admin.listBizSystemSkills.mockResolvedValueOnce([])
    const el = await mountEditor('biz_1')
    expect(el.textContent).toContain('还没有专属技能')
    // 界面不出现内部黑话
    expect(el.textContent).not.toMatch(/origin|POSITION|BUSINESS_SYSTEM|MANUAL/)
  })
})
