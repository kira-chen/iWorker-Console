// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ExpertEditor.vue 单测。
 * 2026-09-01 PRD 对齐改造取代旧口径（原断言基于：先建后挂的 add/removeExpertSkill 弹窗选择器 /
 * 无分类无示例问题 / 编辑态才校验技能），本文件按新契约重写：
 * - 基本信息补「分类」必选；「专家帮你做」固定 3 条 + 【AI 生成】（本地模板）；
 * - 市场技能引用内嵌卡片勾选（默认收起前 2 + 展开更多；搜索；新建态即可勾选，选择随 create/update 落库）；
 * - footer：新建=取消/创建专家，编辑=取消/发布/保存；【发布】静默保存后 emit publish 并收抽屉；
 * - toast：创建「专家已创建」、保存「专家配置已保存」；
 * - 只读查看态（原型 openExpertViewer）：状态/分类/编号示例问题/技能引用 N 个技能/底部时间条/仅【关闭】。
 */

const getExpert = vi.fn()
const createExpert = vi.fn()
const updateExpert = vi.fn()
const listExpertSkillCandidates = vi.fn()
vi.mock('@/api/domainExpert', () => ({
  getExpert: (...a) => getExpert(...a),
  createExpert: (...a) => createExpert(...a),
  updateExpert: (...a) => updateExpert(...a),
  listExpertSkillCandidates: (...a) => listExpertSkillCandidates(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

vi.mock('@/components/position/IconPickerPopover.vue', () => ({
  default: {
    name: 'IconPickerPopover',
    props: ['icon', 'positionName'],
    emits: ['pick'],
    template: '<div class="icon-picker" @click="$emit(\'pick\', { icon: \'🧑\' })">{{ icon }}</div>'
  }
}))
vi.mock('@/components/position/SkillMilkdownEditor.vue', () => ({
  default: {
    name: 'SkillMilkdownEditor',
    props: ['modelValue', 'height', 'readonly', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<textarea class="soul-mde" :readonly="readonly" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  }
}))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', props: ['type'], template: '<span class="status-tag"><slot /></span>' }
}))

const ExpertEditor = (await import('@/components/admin/ExpertEditor.vue')).default

/* ---------- stubs ---------- */
const passthrough = (tag, cls = tag) => ({ name: tag, template: `<div class="${cls}"><slot /></div>` })
const elDrawer = {
  name: 'el-drawer',
  props: ['modelValue', 'title'],
  template: '<div class="el-drawer" v-if="modelValue"><div class="dr-title"><slot name="header">{{ title }}</slot></div><slot /><div class="dr-footer"><slot name="footer" /></div></div>'
}
const elInput = {
  name: 'el-input',
  props: { modelValue: { default: '' }, disabled: Boolean, placeholder: String },
  emits: ['update:modelValue', 'input'],
  template: '<input class="el-input" :disabled="disabled" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
}
const elSelect = {
  name: 'el-select',
  props: { modelValue: { default: '' }, disabled: Boolean },
  emits: ['update:modelValue', 'change'],
  template: '<select class="el-select" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
}
const elOption = {
  name: 'el-option',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>'
}
const elButton = {
  name: 'el-button',
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elFormItem = { name: 'el-form-item', props: ['label', 'error'], template: '<div class="el-form-item"><label>{{ label }}</label><slot /><span class="fi-err">{{ error }}</span></div>' }
const elAlert = { name: 'el-alert', props: ['title', 'description', 'type'], template: '<div class="el-alert">{{ title }}{{ description }}</div>' }

let app, container, visibleSpy, savedSpy, publishSpy
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  visibleSpy = vi.fn()
  savedSpy = vi.fn()
  publishSpy = vi.fn()
  app = createApp({
    setup() {
      return () =>
        h(ExpertEditor, {
          visible: true,
          expertId: null,
          'onUpdate:visible': visibleSpy,
          onSaved: savedSpy,
          onPublish: publishSpy,
          ...props
        })
    }
  })
  app.component('el-drawer', elDrawer)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-button', elButton)
  app.component('el-form', passthrough('el-form'))
  app.component('el-form-item', elFormItem)
  app.component('el-alert', elAlert)
  app.component('el-skeleton', passthrough('el-skeleton'))
  app.component('el-empty', passthrough('el-empty'))
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 6) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const btn = (text) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const inputs = () => [...container.querySelectorAll('.el-input')]
const errTexts = () => [...container.querySelectorAll('.fi-err, .ee-field-err')].map((e) => e.textContent).join('|')
const skillChecks = () => [...container.querySelectorAll('.ee-skill-check input[type="checkbox"]')]

async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flush(2)
}
async function selectCategory(value) {
  const sel = container.querySelector('select.el-select')
  sel.value = value
  sel.dispatchEvent(new Event('change'))
  await flush(2)
}
async function checkSkill(index, on = true) {
  const box = skillChecks()[index]
  box.checked = on
  box.dispatchEvent(new Event('change'))
  await flush(2)
}

/** 填满全部必填项（专家名/分类/图标/简介/职责描述/3 条示例问题/≥1 技能）。 */
async function fillRequired(name = '新专家') {
  await type(inputs()[0], name) // 专家名
  await selectCategory('通用')
  container.querySelector('.icon-picker').click()
  await flush(2)
  await type(inputs()[1], '一句话简介') // 简介
  const mde = container.querySelector('.soul-mde')
  mde.value = '我是新专家'
  mde.dispatchEvent(new Event('input'))
  await flush(2)
  await type(inputs()[2], '问题一')
  await type(inputs()[3], '问题二')
  await type(inputs()[4], '问题三')
  await checkSkill(0)
}

const CANDIDATES = [
  { id: 302, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', category: '数据分析' },
  { id: 304, name: '合同风险检查', description: '识别合同条款中的风险点并给出说明', category: '办公效率' },
  { id: 307, name: '竞品信息汇总', description: '汇总公开渠道的竞品动态', category: '内容创作' }
]

const DETAIL = {
  id: 201,
  name: '经营分析专家',
  category: '投资',
  avatar: '▤',
  intro: '汇总经营数据',
  roleDesc: '你是一名经营分析专家。',
  status: 'published',
  pendingAction: null,
  latestVersionLabel: 'v2.3.0',
  createdAt: '2026-08-12T09:20:00+08:00',
  updatedAt: '2026-08-24T14:12:00+08:00',
  publishedAt: '2026-08-20T16:30:00+08:00',
  exampleQuestions: ['帮我生成一份行业调研报告', '帮我分析本月经营数据中的异常', '帮我整理一份管理层决策建议'],
  skillIds: [302, 304],
  skills: [
    { skillId: 302, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', category: '数据分析' },
    { skillId: 304, name: '合同风险检查', description: '识别合同条款中的风险点并给出说明', category: '办公效率' }
  ]
}

beforeEach(() => {
  for (const fn of [getExpert, createExpert, updateExpert, listExpertSkillCandidates,
    ElMessage.success, ElMessage.error, ElMessage.warning]) fn.mockReset()
  getExpert.mockResolvedValue({ ...DETAIL })
  listExpertSkillCandidates.mockResolvedValue(CANDIDATES)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ExpertEditor — 新建', () => {
  it('标题「新建专家」+ 顶部说明条；footer =【取消】【创建专家】；新建态即可勾选技能', async () => {
    await mount({ expertId: null })
    expect(container.querySelector('.dr-title').textContent).toContain('新建专家')
    expect(container.querySelector('.ee-note').textContent)
      .toBe('专家由多个市场技能组成。技能保持引用关系，市场技能更新后专家会同步使用最新内容。')
    expect(btn('取消')).toBeTruthy()
    expect(btn('创建专家')).toBeTruthy()
    expect(btn('发布')).toBeUndefined() // 发布仅编辑态
    // 内嵌候选可勾（不再是「先保存再挂技能」）
    expect(skillChecks().length).toBeGreaterThan(0)
    expect(getExpert).not.toHaveBeenCalled()
  })

  it('必填项为空 → 各字段就地报错（含分类/图标/示例问题/技能），不打接口', async () => {
    await mount({ expertId: null })
    btn('创建专家').click()
    await flush()
    expect(createExpert).not.toHaveBeenCalled()
    const errs = errTexts()
    expect(errs).toContain('请填写专家名')
    expect(errs).toContain('请选择专家分类')
    expect(errs).toContain('请选择图标')
    expect(errs).toContain('请填写简介')
    expect(errs).toContain('请填写职责描述')
    expect(errs).toContain('请填写 3 条不超过 60 个字符的示例问题')
    expect(errs).toContain('请至少添加 1 个技能')
  })

  it('填满创建 → createExpert 带分类/示例问题/skillIds → 「专家已创建」+ emit saved + 收抽屉', async () => {
    createExpert.mockResolvedValueOnce({ ...DETAIL, id: 205, name: '新专家' })
    await mount({ expertId: null })
    await fillRequired('  新专家  ')
    btn('创建专家').click()
    await flush()
    expect(createExpert).toHaveBeenCalledWith({
      name: '新专家',
      category: '通用',
      avatar: '🧑',
      intro: '一句话简介',
      roleDesc: '我是新专家',
      exampleQuestions: ['问题一', '问题二', '问题三'],
      skillIds: [302]
    })
    expect(ElMessage.success).toHaveBeenCalledWith('专家已创建')
    expect(savedSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 205 }))
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('【AI 生成】一次填满 3 条示例问题（本地模板）+ toast', async () => {
    await mount({ expertId: null })
    btn('AI 生成').click()
    await flush(2)
    const qs = [inputs()[2], inputs()[3], inputs()[4]].map((i) => i.value)
    expect(qs.every((q) => q.trim().length > 0)).toBe(true)
    expect(ElMessage.success).toHaveBeenCalledWith('已生成示例问题')
  })
})

describe('ExpertEditor — 市场技能内嵌选择器', () => {
  it('默认收起前 2 个 + 【展开更多（1）】；展开后显 3 个 + 【收起】；汇总行实时', async () => {
    await mount({ expertId: null })
    expect(skillChecks()).toHaveLength(2)
    expect(container.querySelector('.ee-sk-summary').textContent).toBe('已选择 0 个 · 共 3 个市场技能')
    const more = btn('展开更多（1）')
    expect(more).toBeTruthy()
    more.click()
    await flush(2)
    expect(skillChecks()).toHaveLength(3)
    expect(btn('收起')).toBeTruthy()
    await checkSkill(2)
    expect(container.querySelector('.ee-sk-summary').textContent).toBe('已选择 1 个 · 共 3 个市场技能')
  })

  it('搜索按名称/描述/分类过滤；无匹配显「没有匹配的市场技能」', async () => {
    await mount({ expertId: null })
    const search = inputs()[5] // 技能搜索框
    await type(search, '数据分析')
    expect(skillChecks()).toHaveLength(1)
    await type(search, '不存在的技能')
    expect(skillChecks()).toHaveLength(0)
    expect(container.textContent).toContain('没有匹配的市场技能')
  })
})

describe('ExpertEditor — 编辑', () => {
  it('挂载拉详情回填（含分类/示例问题/技能勾选）；footer =【取消】【发布】【保存】', async () => {
    await mount({ expertId: 201 })
    expect(getExpert).toHaveBeenCalledWith(201)
    expect(container.querySelector('.dr-title').textContent).toContain('编辑专家')
    expect(inputs()[0].value).toBe('经营分析专家')
    expect(container.querySelector('select.el-select').value).toBe('投资')
    expect(inputs()[2].value).toBe('帮我生成一份行业调研报告')
    // 302 / 304 已勾选（默认收起态恰好展示前 2 个候选）
    expect(skillChecks()[0].checked).toBe(true)
    expect(skillChecks()[1].checked).toBe(true)
    expect(container.querySelector('.ee-sk-summary').textContent).toBe('已选择 2 个 · 共 3 个市场技能')
    expect(btn('取消')).toBeTruthy()
    expect(btn('发布')).toBeTruthy()
    expect(btn('保存')).toBeTruthy()
  })

  it('底部时间条：创建/最近更新/最近发布/最新版本', async () => {
    await mount({ expertId: 201 })
    const meta = container.querySelector('.ee-meta').textContent
    expect(meta).toContain('创建时间：')
    expect(meta).toContain('最近更新时间：')
    expect(meta).toContain('最近发布时间：')
    expect(meta).toContain('最新版本：v2.3.0')
  })

  it('保存 → updateExpert 全字段 → 「专家配置已保存」+ emit saved + 收抽屉', async () => {
    updateExpert.mockResolvedValueOnce({ ...DETAIL, name: '改名后' })
    await mount({ expertId: 201 })
    await type(inputs()[0], '改名后')
    btn('保存').click()
    await flush()
    expect(updateExpert).toHaveBeenCalledWith(201, {
      name: '改名后',
      category: '投资',
      avatar: '▤',
      intro: '汇总经营数据',
      roleDesc: '你是一名经营分析专家。',
      exampleQuestions: DETAIL.exampleQuestions,
      skillIds: [302, 304]
    })
    expect(ElMessage.success).toHaveBeenCalledWith('专家配置已保存')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('重名等字段级错误 → 就地红框，不弹 toast', async () => {
    updateExpert.mockRejectedValueOnce({ field: 'name', message: '专家名已存在' })
    await mount({ expertId: 201 })
    btn('保存').click()
    await flush()
    expect(errTexts()).toContain('专家名已存在')
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('【发布】：静默自动保存（不弹保存 toast）→ 收抽屉 → emit publish 带最新详情', async () => {
    updateExpert.mockResolvedValueOnce({ ...DETAIL })
    await mount({ expertId: 201 })
    btn('发布').click()
    await flush()
    expect(updateExpert).toHaveBeenCalledTimes(1)
    expect(ElMessage.success).not.toHaveBeenCalled() // 静默保存
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 201 }))
  })

  it('【发布】0 技能 → 「至少引用 1 个市场技能才能发布」拦下，不保存不转交', async () => {
    getExpert.mockResolvedValueOnce({ ...DETAIL, skillIds: [], skills: [] })
    await mount({ expertId: 201 })
    btn('发布').click()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('至少引用 1 个市场技能才能发布')
    expect(updateExpert).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('加载失败 → 空态 + 重试', async () => {
    getExpert.mockRejectedValueOnce(new Error('炸了'))
    await mount({ expertId: 201 })
    expect(container.querySelector('.el-empty')).toBeTruthy()
    expect(container.textContent).toContain('重试')
  })
})

describe('ExpertEditor — 只读查看（原型 openExpertViewer）', () => {
  it('标题「查看专家」：展示状态/分类、编号示例问题、技能引用（N 个技能）、时间条；footer 仅【关闭】', async () => {
    await mount({ expertId: 201, readonly: true })
    expect(container.querySelector('.dr-title').textContent).toContain('查看专家')
    expect(container.textContent).toContain('已发布')
    expect(container.textContent).toContain('投资')
    // 编号列表
    expect(container.textContent).toContain('1. 帮我生成一份行业调研报告')
    expect(container.textContent).toContain('2 个技能')
    expect(container.textContent).toContain('经营数据分析')
    expect(container.querySelector('.ee-meta').textContent).toContain('最新版本：v2.3.0')
    // 仅关闭：无保存/发布/勾选入口
    expect(btn('关闭')).toBeTruthy()
    expect(btn('保存')).toBeUndefined()
    expect(btn('发布')).toBeUndefined()
    expect(skillChecks()).toHaveLength(0)
  })

  it('无技能引用 → 「暂无技能引用」', async () => {
    getExpert.mockResolvedValueOnce({ ...DETAIL, skillIds: [], skills: [] })
    await mount({ expertId: 201, readonly: true })
    expect(container.textContent).toContain('0 个技能')
    expect(container.textContent).toContain('暂无技能引用')
  })
})

describe('ExpertEditor — 审核期锁定（兜底）', () => {
  it('审核中 → 锁定提示 + 表单禁用 + footer 无保存/发布', async () => {
    getExpert.mockResolvedValueOnce({ ...DETAIL, pendingAction: 'PUBLISH' })
    await mount({ expertId: 201 })
    expect(container.textContent).toContain('审核中，专家已锁定不可修改')
    expect(inputs()[0].disabled).toBe(true)
    expect(container.querySelector('.soul-mde').readOnly).toBe(true)
    expect(btn('保存')).toBeUndefined()
    expect(btn('发布')).toBeUndefined()
    expect(btn('取消')).toBeTruthy()
  })
})
