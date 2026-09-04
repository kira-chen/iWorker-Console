// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ExpertEditor.vue 单测。
 * 2026-09-01 PRD 对齐改造取代旧口径（原断言基于：先建后挂的 add/removeExpertSkill 弹窗选择器 /
 * 无分类无示例问题 / 编辑态才校验技能），本文件按新契约重写：
 * - 基本信息补「分类」必选；「专家帮你做」固定 3 条 + 【AI 生成】；
 * - 市场技能引用内嵌卡片勾选（默认收起前 2 + 展开更多；搜索；新建态即可勾选，选择随 create/update 落库）；
 * - footer：新建=取消/创建专家，编辑=取消/发布/保存；【发布】静默保存后 emit publish 并收抽屉；
 * - toast：创建「专家已创建」、保存「专家配置已保存」；
 * - 只读查看态（原型 openExpertViewer）：状态/分类/编号示例问题/技能引用 N 个技能/底部时间条/仅【关闭】。
 *
 * 2026-09-04 PRD-20260903 对齐（基准=新交互原型最终覆写态）按新口径更新：
 * - 【AI 生成】改统一 AI 实况生成机制（源=简介：空禁用+title、生成中… 420ms、本地模板 3 条、
 *   toast「AI 内容已生成，请确认后保存」）；
 * - 基本信息新增「背景色」必填（7 色板单选，默认 #DCF5E4，字段顺序 图标→背景色→简介）；
 * - 示例问题校验收紧（专用 toast + 空框标红 + focus 首个空输入框 + 区标题红星）；
 * - 技能引用区后只读「知识库」区块（既有 listKnowledgeBases 只读接口 + 可见范围过滤 +
 *   默认露 2 行/展开更多（N）/搜索；查看/检索测试跳知识库路由带参）。
 */

const getExpert = vi.fn()
const createExpert = vi.fn()
const updateExpert = vi.fn()
const listExpertSkillCandidates = vi.fn()
const getExpertKbScopeRefId = vi.fn()
vi.mock('@/api/domainExpert', () => ({
  getExpert: (...a) => getExpert(...a),
  createExpert: (...a) => createExpert(...a),
  updateExpert: (...a) => updateExpert(...a),
  listExpertSkillCandidates: (...a) => listExpertSkillCandidates(...a),
  getExpertKbScopeRefId: (...a) => getExpertKbScopeRefId(...a)
}))

// 只读「知识库」区块数据源（既有只读接口，签名不动）
const listKnowledgeBases = vi.fn()
vi.mock('@/api/knowledgeBase', () => ({
  listKnowledgeBases: (...a) => listKnowledgeBases(...a)
}))

// 「查看/检索测试」跳知识库模块路由。
// createRouter/createWebHistory 补最小桩：ExpertEditor 的间接依赖链会加载真实 src/router/index.js
//（request.js → router），整模块 mock 后需喂它能跑通的工厂函数。
const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  createWebHistory: () => ({})
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
  // focus 供「示例问题校验失败 focus 首个空输入框」断言（真 el-input 同名公开方法）
  methods: {
    focus() {
      this.$el?.focus?.()
    }
  },
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

// 可见范围过滤用知识库行（vo 形状；kb_pos 为 POSITION 型 → 专家不可见，任何态都不该出现）
const KBS = [
  { id: 'kb_1', name: '产品与解决方案库', description: '公司全线产品的规格书与典型案例', kbType: 'ENTERPRISE', scopeRefId: null, status: 'PUBLISHED', pendingAction: null, docCount: 128, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }, { sourceType: 'UPLOAD', status: 'ENABLED' }, { sourceType: 'API', status: 'ENABLED' }] },
  { id: 'kb_2', name: '报价政策与折扣权限', description: '', kbType: 'ENTERPRISE', scopeRefId: null, status: 'PUBLISHED', pendingAction: null, docCount: 46, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }] },
  { id: 'kb_6', name: '2026 产品白皮书库', description: '', kbType: 'EXPERT', scopeRefId: 'ex_1', status: 'DRAFT', pendingAction: null, docCount: 52, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }] },
  { id: 'kb_pos', name: '销售话术与异议处理', description: '', kbType: 'POSITION', scopeRefId: 'ps_1', status: 'PUBLISHED', pendingAction: null, docCount: 312, sources: [{ sourceType: 'UPLOAD', status: 'ENABLED' }] }
]

const DETAIL = {
  id: 201,
  name: '经营分析专家',
  category: '投资',
  avatar: '▤',
  backgroundColor: '#DCF5E4',
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
    getExpertKbScopeRefId, listKnowledgeBases, routerPush,
    ElMessage.success, ElMessage.error, ElMessage.warning]) fn.mockReset()
  getExpert.mockResolvedValue({ ...DETAIL })
  listExpertSkillCandidates.mockResolvedValue(CANDIDATES)
  listKnowledgeBases.mockResolvedValue({ list: KBS.map((k) => ({ ...k })), total: KBS.length })
  getExpertKbScopeRefId.mockReturnValue('ex_1')
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
    expect(errs).toContain('请填写 3 条"专家帮你做"示例问题')
    expect(errs).toContain('请至少添加 1 个技能')
  })

  it('填满创建 → createExpert 带分类/背景色/示例问题/skillIds → 「专家已创建」+ emit saved + 收抽屉', async () => {
    createExpert.mockResolvedValueOnce({ ...DETAIL, id: 205, name: '新专家' })
    await mount({ expertId: null })
    await fillRequired('  新专家  ')
    btn('创建专家').click()
    await flush()
    expect(createExpert).toHaveBeenCalledWith({
      name: '新专家',
      category: '通用',
      avatar: '🧑',
      backgroundColor: '#DCF5E4', // 背景色默认色随建落库
      intro: '一句话简介',
      roleDesc: '我是新专家',
      exampleQuestions: ['问题一', '问题二', '问题三'],
      skillIds: [302]
    })
    expect(ElMessage.success).toHaveBeenCalledWith('专家已创建')
    expect(savedSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 205 }))
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  // 2026-09-04 PRD-20260903 对齐：统一 AI 实况生成机制（取代旧「固定文案即填」断言）
  it('【AI 生成】实况机制：简介空→禁用+title「请先填写专家简介」；填简介→点击「生成中…」420ms 后按简介模板填 3 条 + toast', async () => {
    vi.useFakeTimers()
    try {
      await mount({ expertId: null })
      let ai = btn('AI 生成')
      expect(ai.disabled).toBe(true)
      expect(ai.getAttribute('title')).toBe('请先填写专家简介')

      await type(inputs()[1], '汇总经营数据') // 简介 = 生成源
      ai = btn('AI 生成')
      expect(ai.disabled).toBe(false)
      expect(ai.getAttribute('title')).toBeFalsy()

      ai.click()
      await flush(2)
      expect(btn('生成中…')).toBeTruthy() // 生成中态按钮文案
      expect(ElMessage.success).not.toHaveBeenCalled()

      vi.advanceTimersByTime(420)
      await flush(2)
      expect([inputs()[2], inputs()[3], inputs()[4]].map((i) => i.value)).toEqual([
        '请围绕"汇总经营数据"给出专业分析',
        '请基于"汇总经营数据"识别关键问题并提出建议',
        '请针对"汇总经营数据"整理一份可执行方案'
      ])
      expect(ElMessage.success).toHaveBeenCalledWith('AI 内容已生成，请确认后保存')
      expect(btn('AI 生成')).toBeTruthy() // 完成后按钮复原
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ExpertEditor — 背景色（2026-09-04 新增必填字段）', () => {
  const swatches = () => [...container.querySelectorAll('input[name="expertBackgroundColor"]')]

  it('固定 7 色板单选，默认选中 #DCF5E4；hint 照原型；字段顺序 图标→背景色→简介', async () => {
    await mount({ expertId: null })
    const radios = swatches()
    expect(radios.map((r) => r.value)).toEqual([
      '#FAE9DF', '#DCECF7', '#DCF5E4', '#E7E4F7', '#F7E6F2', '#F7EFCD', '#DDF0EF'
    ])
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['#DCF5E4'])
    expect(container.textContent).toContain('用于专家图标和客户端卡片背景，固定提供 7 种颜色')
    // 字段顺序（原型 finalizeExpertLayout）：专家名 → 分类 → 图标 → 背景色 → 简介 → 职责描述
    const labels = [...container.querySelectorAll('.el-form-item > label')].map((l) => l.textContent)
    expect(labels).toEqual(['专家名', '分类', '图标', '背景色', '简介', '职责描述'])
  })

  it('选色落表单并随创建提交；图标预览容器 --ee-bg 实时同步', async () => {
    createExpert.mockResolvedValueOnce({ ...DETAIL, id: 205, name: '新专家' })
    await mount({ expertId: null })
    const target = swatches().find((r) => r.value === '#FAE9DF')
    target.checked = true
    target.dispatchEvent(new Event('change'))
    await flush(2)
    expect(swatches().filter((r) => r.checked).map((r) => r.value)).toEqual(['#FAE9DF'])
    expect(container.querySelector('.ee-icon-wrap').getAttribute('style')).toContain('#FAE9DF')
    await fillRequired('新专家')
    btn('创建专家').click()
    await flush()
    expect(createExpert).toHaveBeenCalledWith(expect.objectContaining({ backgroundColor: '#FAE9DF' }))
  })

  it('编辑态回填详情背景色', async () => {
    getExpert.mockResolvedValueOnce({ ...DETAIL, backgroundColor: '#E7E4F7' })
    await mount({ expertId: 201 })
    expect(swatches().filter((r) => r.checked).map((r) => r.value)).toEqual(['#E7E4F7'])
  })
})

describe('ExpertEditor — 示例问题校验收紧（2026-09-04）', () => {
  it('区块标题带必填红星', async () => {
    await mount({ expertId: null })
    const heads = [...container.querySelectorAll('.ee-sec-head')]
    const qHead = heads.find((h) => h.textContent.includes('专家帮你做'))
    expect(qHead.querySelector('.ee-req')).toBeTruthy()
    expect(qHead.querySelector('.ee-req').textContent).toBe('*')
  })

  it('3 条未全填保存 → 专用 toast『请填写 3 条"专家帮你做"示例问题』+ 空框标红 + focus 首个空输入框', async () => {
    await mount({ expertId: null })
    await fillRequired('新专家')
    await type(inputs()[3], '') // 清空第 2 条
    btn('创建专家').click()
    await flush()
    expect(createExpert).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写 3 条"专家帮你做"示例问题')
    // 仅空的那条标红
    expect(inputs()[3].classList.contains('ee-q-invalid')).toBe(true)
    expect(inputs()[2].classList.contains('ee-q-invalid')).toBe(false)
    // focus 首个空输入框
    expect(document.activeElement).toBe(inputs()[3])
  })
})

describe('ExpertEditor — 只读「知识库」区块（2026-09-04）', () => {
  const kbSec = () => container.querySelector('.ee-kb-sec')
  const kbRows = () => [...container.querySelectorAll('.ee-kb-row')]
  const kbBtn = (text) => [...kbSec().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

  it('技能引用区后渲染；副标题/表头照原型；编辑态按可见范围过滤（企业级 + 本专家专属，岗位级不可见）；默认露 2 行 + 展开更多（N）', async () => {
    await mount({ expertId: 201 })
    const sec = kbSec()
    expect(sec).toBeTruthy()
    // 位置：紧随市场技能引用区之后
    expect(sec.previousElementSibling.textContent).toContain('市场技能引用')
    expect(sec.textContent).toContain('当前专家可见范围内的知识库')
    for (const th of ['知识库名称', '数据源', '文档数量', '状态', '操作']) {
      expect(sec.textContent).toContain(th)
    }
    expect(listKnowledgeBases).toHaveBeenCalled()
    // 可见 3 行（kb_1/kb_2 企业级 + kb_6 本专家专属），默认露 2 行
    expect(kbRows()).toHaveLength(2)
    expect(sec.textContent).not.toContain('销售话术与异议处理') // POSITION 型不可见
    const more = kbBtn('展开更多（1）')
    expect(more).toBeTruthy()
    more.click()
    await flush(2)
    expect(kbRows()).toHaveLength(3)
    expect(sec.textContent).toContain('2026 产品白皮书库')
    expect(kbBtn('收起')).toBeTruthy()
  })

  it('行内容：数据源连排 / 文档数量 / 状态；搜索过滤全量匹配并隐藏展开钮；无匹配显「未找到匹配的知识库」', async () => {
    await mount({ expertId: 201 })
    const firstRow = kbRows()[0]
    expect(firstRow.textContent).toContain('产品与解决方案库')
    // 数据源连排复用站内 sourcesText 标准件口径（「上传 ×2 / API ×1」；分隔符以该 util 为准，归知识库批次）
    expect(firstRow.textContent).toContain('上传 ×2 / API ×1')
    expect(firstRow.textContent).toContain('128')
    expect(firstRow.textContent).toContain('已发布')
    // 搜索：命中的全量展示（不受默认 2 行限制），展开钮隐藏
    const search = [...container.querySelectorAll('.ee-kb-search .el-input')][0]
    await type(search, '白皮书')
    expect(kbRows()).toHaveLength(1)
    expect(kbRows()[0].textContent).toContain('2026 产品白皮书库')
    expect(kbBtn('展开更多（1）')).toBeUndefined()
    await type(search, '不存在的库')
    expect(kbRows()).toHaveLength(0)
    expect(kbSec().textContent).toContain('未找到匹配的知识库')
  })

  it('「查看」/「检索测试」→ 收抽屉并跳知识库路由带参（kbId/kbAction 为知识库批次预留 deep-link）', async () => {
    await mount({ expertId: 201 })
    const firstRow = kbRows()[0]
    const [view, test] = [...firstRow.querySelectorAll('.el-button')]
    expect(view.textContent.trim()).toBe('查看')
    expect(test.textContent.trim()).toBe('检索测试')
    view.click()
    await flush(2)
    expect(visibleSpy).toHaveBeenCalledWith(false)
    expect(routerPush).toHaveBeenCalledWith({
      name: 'AdminKnowledgeBase',
      query: { tab: 'kb', kbId: 'kb_1', kbAction: 'view' }
    })
  })

  it('新建态：无专属映射 → 仅企业级可见（2 行、无展开钮）；只读查看态不渲染本区块', async () => {
    await mount({ expertId: null })
    expect(getExpertKbScopeRefId).not.toHaveBeenCalled()
    expect(kbRows()).toHaveLength(2)
    expect(kbSec().textContent).not.toContain('展开更多')
    app.unmount(); container.remove()

    await mount({ expertId: 201, readonly: true })
    expect(kbSec()).toBeNull()
    expect(listKnowledgeBases).toHaveBeenCalledTimes(1) // 仅前面新建态那次；只读态不拉取
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
      backgroundColor: '#DCF5E4',
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
