// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * BizSystemEditor.vue 单测（2026-09-12 测试审计 T58 扩写；对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/业务系统/prd-业务系统.md）：
 *  - §三.4 业务系统专属技能：仅编辑态展示（查看态不拉列表，K45 2026-09-12）；打开时拉取列表；
 *    【＋ 新建专属技能】（全角＋ 逐字照 md L124，K41 2026-09-12）弹窗取名 → 创建 → 重拉 + 新标签开编辑器；
 *    技能名空 warning「请输入技能名」；【删除】二次确认后行消失 + 「已删除」；读失败「专属技能加载失败」+【点此重试】；
 *  - §三.3 业务页：【展开业务页（N）】计数、20 条上限置灰「已达上限 20 条」、删除确认「删除这条业务页？」、
 *    空态「暂无业务页，可不配置（留空表示不约束）」、整行空白行保存时丢弃；
 *  - §三.5 自动化操作配置：置灰占位「自动化操作配置 · 功能开发中，敬请期待」，payload 带 operationMeta:null；
 *  - §三.7 保存：「业务系统已创建」/「业务系统已保存」+ 关抽屉；失败 field 回显在对应字段附近；
 *  - §三.1 三态底部按钮：新建【取消】【保存】（3cc4591 起主按钮为「保存」）、查看态仅【关闭】；
 *  - watcher immediate 防回归（5303c7c）。
 * 桩：api/admin、element-plus（ElMessage/ElMessageBox）、vue-router、IconPickerPopover（IconField 真组件套它）、EP 最小桩；
 * defValidate 走 importOriginal（真校验 + 真 isBlankBizPage）。
 */

const admin = {
  createBizSystem: vi.fn(),
  updateBizSystem: vi.fn(),
  getBizSystem: vi.fn(() =>
    Promise.resolve({
      name: 'CRM',
      type: 'PLATFORM',
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
  deleteBizSystemOwnedSkill: vi.fn(() => Promise.resolve())
}
vi.mock('@/api/admin', () => admin)

// defValidate 用真实现（编辑器 import 了 validateBizSystemForm / isBlankBizPage / 四个上限常量；
// 原桩缺 isBlankBizPage，触碰保存即炸——2026-09-12 测试审计 T14 改 importOriginal 展开）
vi.mock('@/utils/defValidate', async (importOriginal) => ({ ...(await importOriginal()) }))

// 图标选择 popover（IconField 内部依赖）：桩掉，避免其内部 api/position 链路在 jsdom 里发真实请求；
// props 补齐 readonly / headless（IconField 透传），点【选图标】回吐 pick
vi.mock('@/components/position/IconPickerPopover.vue', () => ({
  default: {
    name: 'IconPickerPopover',
    props: ['icon', 'positionName', 'readonly', 'headless'],
    emits: ['pick'],
    template: '<button class="stub-icon-picker" :disabled="readonly" @click="$emit(\'pick\', { icon: \'✓\' })">选图标</button>'
  }
}))

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
// 新建取名走 el-dialog + el-form；ElMessageBox.confirm 用于删除单条业务页的二次确认（md §三.3 L109）
const box = { prompt: vi.fn(), confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: box }))

// vue-router：桩 useRouter，resolve 返回可辨识 href、便于断言编辑跳转。
const routerMock = { resolve: vi.fn(() => ({ href: '/admin/biz-systems/biz_1/skills/sk_1/edit' })) }
vi.mock('vue-router', () => ({ useRouter: () => routerMock }))

// EP 存根：受控组件把关键交互暴露成可点/可改的最小结构。
const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot /><div class="footer"><slot name="footer" /></div></div>'
  },
  // 新建取名弹窗：受控 v-model，仅在打开时渲染内容 + footer（便于点「创建」/「取消」）。
  'el-dialog': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="el-dialog" v-if="modelValue"><slot /><div class="el-dialog-footer"><slot name="footer" /></div></div>'
  },
  'el-form': { props: ['disabled'], template: '<form :data-disabled="disabled ? 1 : 0"><slot /></form>' },
  'el-form-item': {
    props: ['label', 'error'],
    template: '<div class="el-form-item" :data-label="label" :data-error="error"><slot name="label" /><slot /></div>'
  },
  'el-input': {
    props: ['modelValue', 'disabled', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<input class="el-input" :value="modelValue" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio': { props: ['value'], template: '<label :data-value="value"><slot /></label>' },
  'el-select': {
    props: ['modelValue', 'disabled', 'placeholder'],
    emits: ['update:modelValue', 'change', 'focus'],
    template:
      '<select class="el-select" :disabled="disabled" :data-placeholder="placeholder" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
  },
  'el-option': { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-button': {
    props: ['type', 'loading', 'disabled', 'link', 'title'],
    emits: ['click'],
    template: '<button class="el-button" :data-type="type" :disabled="disabled" :title="title" @click="!disabled && $emit(\'click\')"><slot /></button>'
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

let app, container, visible, saved
async function flush(n = 5) {
  for (let i = 0; i < n; i++) {
    await nextTick()
    await Promise.resolve()
  }
}
/** 列表页用法：visible 由 false→true 触发 load()。watcher 为 immediate（5303c7c），此处走 false→true 覆盖常驻路径。 */
async function mountEditor(bizId, extra = {}) {
  const { default: Editor } = await import('@/components/admin/BizSystemEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  visible = ref(false)
  saved = vi.fn()
  app = createApp({
    render: () => h(Editor, { visible: visible.value, bizId, ...extra, 'onUpdate:visible': (v) => (visible.value = v), onSaved: saved })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  visible.value = true
  await flush()
  return container
}
/** 治理侧用法：组件创建时 visible 已是 true（无 false→true 跃迁）。 */
async function mountEditorOpened(bizId, extra = {}) {
  const { default: Editor } = await import('@/components/admin/BizSystemEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  visible = ref(true)
  saved = vi.fn()
  app = createApp({
    render: () => h(Editor, { visible: visible.value, bizId, ...extra, 'onUpdate:visible': (v) => (visible.value = v), onSaved: saved })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await flush()
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

// 编辑态合法详情（过 validateBizSystemForm 真校验）
const DETAIL = {
  name: 'CRM',
  type: 'PLATFORM',
  icon: '◎',
  description: '客户管理',
  loginUrl: 'https://crm.example.com/login',
  connType: 'login_session',
  bizPages: [],
  exampleQuestions: ['问题一', '问题二', '问题三'],
  status: 'NOT_PUBLISHED',
  pendingAction: null,
  referencedBySkills: [],
  createdAt: '2026-08-18T10:20:00+08:00',
  updatedAt: '2026-08-24T15:40:00+08:00',
  publishedAt: null
}
const mkPage = (i) => ({ url: `https://crm.example.com/p${i}`, name: `页${i}`, description: '' })

// jsdom 没有 scrollIntoView（校验失败后滚动定位首个红框用），补空实现
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {}

let openSpy
beforeEach(() => {
  vi.clearAllMocks()
  // 恢复默认桩行为（clearAllMocks 会清实现）。
  admin.getBizSystem.mockResolvedValue({ ...DETAIL })
  admin.createBizSystem.mockResolvedValue({ id: 'biz_new' })
  admin.updateBizSystem.mockResolvedValue({ id: 'biz_1' })
  box.confirm.mockResolvedValue('confirm')
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

describe('连接器类型（只选类型，不绑定具体岗位；比照 ApiEditor/McpEditor）', () => {
  it('新建态默认无类型；选「岗位私有」后也不出现「所属岗位」——岗位私有连接器由岗位侧引用，不在此绑定', async () => {
    const el = await mountEditor(null)
    const typeSelect = itemByLabel(el, '连接器类型').querySelector('select')
    expect(typeSelect.value).toBe('')
    expect(itemByLabel(el, '所属岗位')).toBeUndefined()
    typeSelect.value = 'POSITION'
    typeSelect.dispatchEvent(new Event('change'))
    await flush()
    expect(itemByLabel(el, '所属岗位')).toBeUndefined()
    expect(el.textContent).not.toContain('所属岗位')
  })

  it('岗位私有 → 直接创建成功，payload 只带 type、不带 positionId', async () => {
    const el = await mountEditor(null)
    setInput(inputOf(el, '系统名称'), '新系统')
    const typeSelect = itemByLabel(el, '连接器类型').querySelector('select')
    typeSelect.value = 'POSITION'
    typeSelect.dispatchEvent(new Event('change'))
    el.querySelector('.stub-icon-picker').click()
    setInput(inputOf(el, '系统描述'), '一句话描述')
    setInput(inputOf(el, '登录地址'), 'https://new.example.com/login')
    eqInputs(el).forEach((inp, i) => setInput(inp, `问题${i + 1}`))
    await nextTick()
    findBtn(el, '保存').click()
    await flush()
    expect(admin.createBizSystem).toHaveBeenCalledWith(expect.objectContaining({ type: 'POSITION' }))
    expect(admin.createBizSystem.mock.calls[0][0]).not.toHaveProperty('positionId')
    expect(msg.warning).not.toHaveBeenCalled()
  })

  it('编辑态类型下拉禁用（创建后不可改），且不展示「所属岗位」/「未绑定岗位」', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, type: 'POSITION' })
    const el = await mountEditor('biz_1')
    const typeItem = itemByLabel(el, '连接器类型')
    expect(typeItem.querySelector('select').disabled).toBe(true)
    expect(typeItem.textContent).toContain('连接器类型创建后不可更改')
    expect(itemByLabel(el, '所属岗位')).toBeUndefined()
    expect(el.textContent).not.toContain('未绑定岗位')
  })
})

describe('业务系统专属技能 新建/编辑/删除（md §三.4）', () => {
  it('编辑态打开 → 拉取专属技能列表并展示（md §三.4 L124 列表）', async () => {
    const el = await mountEditor('biz_1')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1')
    expect(el.textContent).toContain('客户记录')
    expect(el.querySelector('.ad-bound-list')).toBeTruthy()
  })

  it('新建专属技能 → 弹窗取名 → 点「创建」→ 调 createBizSystemOwnedSkill、「已创建，已在新标签打开编辑器」、重拉列表、新标签开编辑器（md §三.4 L123）', async () => {
    const el = await mountEditor('biz_1')
    admin.listBizSystemSkills.mockClear()
    // 点【新建专属技能】打开取名弹窗
    findBtn(el, '＋ 新建专属技能').click()
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
    expect(msg.success).toHaveBeenCalledWith('已创建，已在新标签打开编辑器')
    expect(el.querySelector('.el-dialog')).toBeNull() // 关窗
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
    findBtn(el, '＋ 新建专属技能').click()
    await nextTick()
    expect(el.querySelector('.el-dialog')).toBeTruthy()
    findDialogBtn(el, '取消').click()
    await nextTick()
    expect(el.querySelector('.el-dialog')).toBeNull() // 关窗
    expect(admin.createBizSystemOwnedSkill).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('新建时技能名为空点「创建」→ warning「请输入技能名」、不建', async () => {
    const el = await mountEditor('biz_1')
    findBtn(el, '＋ 新建专属技能').click()
    await nextTick()
    // 不填名直接点「创建」
    findDialogBtn(el, '创建').click()
    await nextTick()
    expect(msg.warning).toHaveBeenCalledWith('请输入技能名')
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

  it('删除专属技能（二次确认）→ 调 deleteBizSystemOwnedSkill + 「已删除」，重拉后「客户记录」消失、显示空态（md §三.4 L124）', async () => {
    const el = await mountEditor('biz_1')
    expect(el.textContent).toContain('客户记录')
    admin.listBizSystemSkills.mockClear()
    admin.listBizSystemSkills.mockResolvedValueOnce([])
    // 存根把「点 reference」等价为 popconfirm 确认
    findBtn(el, '删除').click()
    await flush()
    expect(admin.deleteBizSystemOwnedSkill).toHaveBeenCalledWith('biz_1', 'sk_1')
    expect(msg.success).toHaveBeenCalledWith('已删除')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1') // 重拉
    expect(el.textContent).not.toContain('客户记录')
    expect(el.querySelector('.ad-bound-list')).toBeNull()
    expect(el.textContent).toContain('还没有专属技能')
  })

  it('专属技能区仅编辑态展示：新建态不出「业务系统专属技能」也不拉列表；查看态不出该区（md §三.4 L120）', async () => {
    let el = await mountEditor(null)
    expect(el.textContent).not.toContain('业务系统专属技能')
    expect(admin.listBizSystemSkills).not.toHaveBeenCalled()
    app.unmount()
    container.remove()
    el = await mountEditor('biz_1', { readonly: true })
    expect(el.textContent).not.toContain('业务系统专属技能')
    expect(el.textContent).not.toContain('客户记录')
    // K45（2026-09-12）：查看态区块不展示，也不再发 listBizSystemSkills 请求
    expect(admin.listBizSystemSkills).not.toHaveBeenCalled()
  })

  it('读失败 → 显示「专属技能加载失败」错误态（与「暂无」空态区分），不静默降级为空（md §三.4 L125）', async () => {
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

  it('空态 → 显示「还没有专属技能」引导文案（无内部黑话）（md §三.4 L125「与"暂无"空态区分」）', async () => {
    admin.listBizSystemSkills.mockResolvedValueOnce([])
    const el = await mountEditor('biz_1')
    expect(el.textContent).toContain('还没有专属技能')
    // 界面不出现内部黑话
    expect(el.textContent).not.toMatch(/origin|POSITION|BUSINESS_SYSTEM|MANUAL/)
  })
})

/* ===== 2026-09-12 测试审计 T58（A32 / E7 / E6）：业务页 / 保存 toast / 空白行 / 自动化占位 / 三态按钮 / immediate ===== */

const pagesToggle = (el) => el.querySelector('.ad-pages-toggle')
const toggleText = (el) => pagesToggle(el).textContent.replace(/\s+/g, '').replace('▶', '')
// 按钮名逐字照 md §三.3 L107【＋ 添加业务页】（全角＋，K41）
const addPageBtn = (el) => [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '＋ 添加业务页')
const itemByLabel = (el, label) => [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === label)
const inputOf = (el, label) => itemByLabel(el, label).querySelector('input.el-input')
const setInput = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const eqInputs = (el) => [...el.querySelectorAll('.ad-eq-row input.el-input')]
const footBtns = (el) => [...el.querySelectorAll('.footer .el-button')].map((b) => b.textContent.trim())

describe('业务页（md §三.3 L105-111）', () => {
  it('无业务页：按钮【展开业务页】不带计数；展开后空态「暂无业务页，可不配置（留空表示不约束）」，按钮变【收起业务页】', async () => {
    const el = await mountEditor('biz_1')
    expect(toggleText(el)).toBe('展开业务页')
    pagesToggle(el).click()
    await nextTick()
    expect(toggleText(el)).toBe('收起业务页')
    expect(el.querySelector('.bpe-empty').textContent.trim()).toBe('暂无业务页，可不配置（留空表示不约束）')
    expect(el.querySelector('.bpe-head')).toBeNull()
  })

  it('已配置 2 条：【展开业务页（2）】；点【＋ 添加业务页】（全角＋，md L107 逐字，K41）自动展开并多一行、计数变 3（L105-106）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: [mkPage(1), mkPage(2)] })
    const el = await mountEditor('biz_1')
    expect(toggleText(el)).toBe('展开业务页（2）')
    expect(el.querySelector('.bpe')).toBeNull()
    pagesToggle(el).click()
    await nextTick()
    expect(el.querySelectorAll('.bpe-row').length).toBe(2)
    pagesToggle(el).click()
    await nextTick()
    expect(el.querySelector('.bpe')).toBeNull()
    addPageBtn(el) // 收起时按钮不在 DOM 里
    expect(addPageBtn(el)).toBeUndefined()
    pagesToggle(el).click()
    await nextTick()
    addPageBtn(el).click()
    await nextTick()
    expect(el.querySelectorAll('.bpe-row').length).toBe(3)
    expect(toggleText(el)).toBe('收起业务页（3）')
  })

  it('已达 20 条：【添加业务页】置灰并提示「已达上限 20 条」（L106 / §四）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: Array.from({ length: 20 }, (_, i) => mkPage(i + 1)) })
    const el = await mountEditor('biz_1')
    expect(toggleText(el)).toBe('展开业务页（20）')
    pagesToggle(el).click()
    await nextTick()
    expect(addPageBtn(el).disabled).toBe(true)
    expect(el.querySelector('.bpe-hint').textContent.trim()).toBe('已达上限 20 条')
    addPageBtn(el).click()
    await nextTick()
    expect(el.querySelectorAll('.bpe-row').length).toBe(20)
  })

  it('删除单条：确认窗「删除这条业务页？」/「删除业务页」/【删除】；确认后该行消失、计数同步 2→1；取消则不删（L109）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: [mkPage(1), mkPage(2)] })
    const el = await mountEditor('biz_1')
    pagesToggle(el).click()
    await nextTick()
    box.confirm.mockRejectedValueOnce('cancel')
    el.querySelectorAll('.bpe-row')[0].querySelector('.col-op').click()
    await flush()
    expect(box.confirm).toHaveBeenCalledWith('删除这条业务页？', '删除业务页', expect.objectContaining({ confirmButtonText: '删除' }))
    expect(el.querySelectorAll('.bpe-row').length).toBe(2)
    el.querySelectorAll('.bpe-row')[0].querySelector('.col-op').click()
    await flush()
    expect(el.querySelectorAll('.bpe-row').length).toBe(1)
    expect(el.querySelector('.bpe-row input.el-input').value).toBe('https://crm.example.com/p2')
    expect(toggleText(el)).toBe('收起业务页（1）')
  })

  it('查看态：可展开 / 收起，但不出【添加业务页】与行删除按钮，输入框禁用（L111）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: [mkPage(1)] })
    const el = await mountEditor('biz_1', { readonly: true })
    pagesToggle(el).click()
    await nextTick()
    expect(el.querySelectorAll('.bpe-row').length).toBe(1)
    expect(addPageBtn(el)).toBeUndefined()
    expect(el.querySelector('.bpe-row .el-button')).toBeNull()
    expect([...el.querySelectorAll('.bpe-row input.el-input')].every((i) => i.disabled)).toBe(true)
  })

  it('整行空白的业务页行保存时自动丢弃，不进 payload、不拦保存（L108 / 一览表 §七）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: [mkPage(1)] })
    const el = await mountEditor('biz_1')
    pagesToggle(el).click()
    await nextTick()
    addPageBtn(el).click()
    await nextTick()
    expect(el.querySelectorAll('.bpe-row').length).toBe(2)
    findBtn(el, '保存').click()
    await flush()
    expect(msg.warning).not.toHaveBeenCalled()
    expect(admin.updateBizSystem).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ bizPages: [{ url: 'https://crm.example.com/p1', name: '页1', description: '' }] })
    )
  })

  it('半填行（只填名称）保存 → 该行 URL 标红「业务页 URL 必填」、区自动展开、warning「请先修正标红项」，不调 updateBizSystem（L112 / §三.7）', async () => {
    admin.getBizSystem.mockResolvedValue({ ...DETAIL, bizPages: [{ url: '', name: '工作台', description: '' }] })
    const el = await mountEditor('biz_1')
    expect(el.querySelector('.bpe')).toBeNull()
    findBtn(el, '保存').click()
    await flush()
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(admin.updateBizSystem).not.toHaveBeenCalled()
    expect(el.querySelector('.bpe')).not.toBeNull()
    expect(el.querySelector('.bpe-row .col-url .cell-err').textContent.trim()).toBe('业务页 URL 必填')
    expect(el.querySelector('.bpe-row .col-url .is-err')).toBeTruthy()
  })
})

describe('保存与三态（md §三.1 L68-76 / §三.5 / §三.7 L146-147）', () => {
  it('新建态：标题「新建业务系统」、底部【取消】【保存】；填齐后保存 → createBizSystem + 「业务系统已创建」+ saved + 关抽屉', async () => {
    const el = await mountEditor(null)
    expect(footBtns(el)).toEqual(['取消', '保存'])
    expect(admin.getBizSystem).not.toHaveBeenCalled()
    setInput(inputOf(el, '系统名称'), '新系统')
    const typeSelect = itemByLabel(el, '连接器类型').querySelector('select')
    typeSelect.value = 'PLATFORM'
    typeSelect.dispatchEvent(new Event('change'))
    el.querySelector('.stub-icon-picker').click()
    setInput(inputOf(el, '系统描述'), '一句话描述')
    setInput(inputOf(el, '登录地址'), 'https://new.example.com/login')
    eqInputs(el).forEach((inp, i) => setInput(inp, `问题${i + 1}`))
    await nextTick()
    findBtn(el, '保存').click()
    await flush()
    expect(admin.createBizSystem).toHaveBeenCalledWith({
      name: '新系统',
      type: 'PLATFORM',
      icon: '✓',
      description: '一句话描述',
      loginUrl: 'https://new.example.com/login',
      connType: 'login_session',
      bizPages: [],
      exampleQuestions: ['问题1', '问题2', '问题3'],
      operationMeta: null
    })
    expect(msg.success).toHaveBeenCalledWith('业务系统已创建')
    expect(saved).toHaveBeenCalledWith({ id: 'biz_new' })
    expect(visible.value).toBe(false)
  })

  it('编辑态保存 → updateBizSystem + 「业务系统已保存」+ 关抽屉', async () => {
    const el = await mountEditor('biz_1')
    setInput(inputOf(el, '系统名称'), 'CRM 改')
    findBtn(el, '保存').click()
    await flush()
    expect(admin.updateBizSystem).toHaveBeenCalledWith('biz_1', expect.objectContaining({ name: 'CRM 改' }))
    expect(msg.success).toHaveBeenCalledWith('业务系统已保存')
    expect(saved).toHaveBeenCalledWith({ id: 'biz_1' })
    expect(visible.value).toBe(false)
  })

  it('新建全空点【保存】 → 名称 / 连接器类型 / 图标 / 描述 / 登录地址标红 + 示例问题错误，warning「请先修正标红项」，不调 createBizSystem', async () => {
    const el = await mountEditor(null)
    findBtn(el, '保存').click()
    await flush()
    const red = [...el.querySelectorAll('.el-form-item')].filter((it) => it.getAttribute('data-error')).map((it) => it.dataset.label)
    expect(red).toEqual(['系统名称', '图标', '连接器类型', '系统描述', '登录地址'])
    expect(el.textContent).toContain('示例问题固定 3 条，须全部填写')
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(admin.createBizSystem).not.toHaveBeenCalled()
    expect(visible.value).toBe(true)
  })

  it('保存失败（数据层 field=name「系统名称平台内不可重复」）→ 名称字段标红回显、error 提示、抽屉不关、输入保留（§三.7 L147）', async () => {
    admin.updateBizSystem.mockRejectedValueOnce({ field: 'name', message: '系统名称平台内不可重复' })
    const el = await mountEditor('biz_1')
    setInput(inputOf(el, '系统名称'), '人力资源系统')
    findBtn(el, '保存').click()
    await flush()
    expect(admin.updateBizSystem).toHaveBeenCalled()
    expect([...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === '系统名称').dataset.error).toBe('系统名称平台内不可重复')
    expect(msg.error).toHaveBeenCalledWith('系统名称平台内不可重复')
    expect(visible.value).toBe(true)
    expect(inputOf(el, '系统名称').value).toBe('人力资源系统')
    expect(saved).not.toHaveBeenCalled()
  })

  it('查看态：底部仅【关闭】，表单禁用，图标入口置灰（md §三.1 L76）', async () => {
    const el = await mountEditor('biz_1', { readonly: true })
    expect(footBtns(el)).toEqual(['关闭'])
    expect([...el.querySelectorAll('form')].every((f) => f.dataset.disabled === '1')).toBe(true)
    expect(el.querySelector('.stub-icon-picker').disabled).toBe(true)
    expect(el.querySelector('.ad-eq-ai')).toBeNull()
  })

  it('自动化操作配置：置灰占位「自动化操作配置 · 功能开发中，敬请期待」，不参与校验、payload 只带 operationMeta:null（md §三.5）', async () => {
    const el = await mountEditor('biz_1')
    const item = [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === '自动化操作配置')
    const input = item.querySelector('input.el-input')
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('自动化操作配置 · 功能开发中，敬请期待')
    findBtn(el, '保存').click()
    await flush()
    const payload = admin.updateBizSystem.mock.calls[0][1]
    expect(payload.operationMeta).toBeNull()
    expect(Object.keys(payload)).not.toContain('automation')
  })

  it('自动化操作配置只在编辑态出现：新建态与查看态都不渲染该表单项（md §三.5「编辑态展示」，2026-09-17 负责人裁决按 md，销 09-12 Q2）', async () => {
    const findItem = (el) => [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === '自动化操作配置')
    expect(findItem(await mountEditor(null))).toBeUndefined()
    expect(findItem(await mountEditor('biz_1', { readonly: true }))).toBeUndefined()
    expect(findItem(await mountEditor('biz_1'))).toBeDefined()
  })

  it('抽屉顶部提示「业务系统通过登录态托管供技能执行办事操作，可配置最多 20 条业务页入口。」+ 连接方式只读「登录态托管」（md §三.1 L80 / §三.2 L96）', async () => {
    const el = await mountEditor(null)
    expect(el.querySelector('.ad-note').textContent.trim()).toBe('业务系统通过登录态托管供技能执行办事操作，可配置最多 20 条业务页入口。')
    expect(el.querySelector('.ad-readonly-value').textContent.trim()).toBe('登录态托管')
  })
})

describe('watcher immediate 防回归（5303c7c）', () => {
  it('组件创建时 visible 已是 true（治理侧条件挂载）→ 仍拉详情并回填名称 / 登录地址、拉专属技能', async () => {
    const el = await mountEditorOpened('biz_1')
    expect(admin.getBizSystem).toHaveBeenCalledWith('biz_1')
    expect(inputOf(el, '系统名称').value).toBe('CRM')
    expect(inputOf(el, '登录地址').value).toBe('https://crm.example.com/login')
    expect(admin.listBizSystemSkills).toHaveBeenCalledWith('biz_1')
    expect(el.textContent).toContain('客户记录')
  })
})
