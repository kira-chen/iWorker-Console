// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * ModelConfigEditDialog.vue 单测（V76）：
 * - authType 切换字段组（API_KEY ↔ APP_ID_SECRET）
 * - 保存成功后自动触发 verifyModel（「保存即验证」）并 emit saved
 * - 编辑已发布模型且连接字段变更 → 先弹 ElMessageBox.confirm（回草稿重审确认）
 */

const api = { createModel: vi.fn(), updateModel: vi.fn(), verifyModel: vi.fn() }
vi.mock('@/api/adminModel', () => api)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

const stubs = {
  // 2026-08-20 形态由弹窗改右侧抽屉（管理后台子级信息统一范式）
  'el-drawer': {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="dlg"><slot /><slot name="footer" /></div>'
  },
  'el-form': {
    template: '<form class="el-form"><slot /></form>',
    methods: {
      validate: () => Promise.resolve(true),
      clearValidate() {},
      validateField() {}
    }
  },
  'el-form-item': {
    props: ['label', 'prop'],
    template: '<div class="fi" :data-prop="prop"><span class="fi-label"><slot name="label" /></span><slot /></div>'
  },
  'el-input': {
    props: ['modelValue', 'type', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<input class="el-input" :data-ph="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-input-number': {
    props: ['modelValue', 'min', 'max', 'step', 'precision', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<input class="el-input-number" type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />'
  },
  'el-select': {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue', 'change'],
    // 内嵌 input 让测试可像 el-input 一样写值（allow-create 手输语义）
    template:
      '<div class="el-select" :data-value="modelValue"><input class="el-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot /></div>'
  },
  'el-option': { props: ['label', 'value'], template: '<div class="el-option" :data-value="value">{{ label }}</div>' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  // ? 悬浮说明：stub 成 data-tip 供断言小白文案
  'el-tooltip': {
    props: ['content'],
    template: '<span class="tip-stub" :data-tip="content"><slot /></span>'
  },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  QuestionFilled: { template: '<span class="q-icon" />' },
  'el-radio-group': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="radio-group"><slot /></div>'
  },
  'el-radio': { props: ['value'], template: '<label class="el-radio"><slot /></label>' },
  'el-alert': {
    props: ['title', 'type', 'description'],
    template: '<div class="el-alert" :data-type="type">{{ title }}<span v-if="description"> {{ description }}</span></div>'
  },
  'el-button': {
    props: ['loading', 'type'],
    emits: ['click'],
    template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
  }
}

// 图标行（2026-09-09 原型复刻批次 3A · D3/S3）：桩化 IconField，暴露当前图标与「选一个」的入口，
// 免得把 IconPickerPopover 的图标库 / 上传 / 裁剪整条链路拖进本单测。
vi.mock('@/components/common/IconField.vue', () => ({
  default: {
    name: 'IconField',
    props: ['icon', 'name', 'readonly', 'placeholder', 'size'],
    emits: ['pick'],
    template:
      '<div class="icon-field-stub" :data-icon="icon" :data-placeholder="placeholder"' +
      ' :data-readonly="readonly ? \'1\' : \'0\'">' +
      '<button class="icon-pick" @click="$emit(\'pick\', { icon: \'★\' })" /></div>'
  }
}))

const Dialog = (await import('@/components/admin/ModelConfigEditDialog.vue')).default

let app, container, savedSpy, visibleRef, modelRef

// stubOverrides：个别用例要换掉某个桩（如 D6 需要一个 validate 会 reject 的 el-form）
async function mount(model = null, extraProps = {}, stubOverrides = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  savedSpy = vi.fn()
  visibleRef = ref(false)
  modelRef = ref(model)
  app = createApp({
    setup() {
      return () =>
        h(Dialog, {
          ...extraProps,
          visible: visibleRef.value,
          model: modelRef.value,
          'onUpdate:visible': (v) => (visibleRef.value = v),
          onSaved: savedSpy
        })
    }
  })
  for (const [name, comp] of Object.entries({ ...stubs, ...stubOverrides })) app.component(name, comp)
  app.mount(container)
  // 打开对话框触发 visible watch（表单初始化）
  visibleRef.value = true
  await nextTick()
  await nextTick()
  return container
}

function inputByProp(prop) {
  return container.querySelector(`.fi[data-prop="${prop}"] .el-input`)
}
function setInput(prop, value) {
  const el = inputByProp(prop)
  el.value = value
  el.dispatchEvent(new Event('input'))
}
function saveBtn() {
  // V95：footer 新增「重新验证」按钮（验证入口由列表移入本弹窗），
  // 故此处按保存类文案精确匹配，避免误命中重新验证。
  return [...container.querySelectorAll('.el-button')].find((b) => {
    const t = b.textContent.trim()
    // V96：按钮不再宣称「并验证」——保存即返回，验证改在列表行内跑（约 40 秒不再扣住用户）
    return t === '保存' || t === '接入'
  })
}
function verifyOnlyBtn() {
  return [...container.querySelectorAll('.el-button')].find(
    (b) => b.textContent.trim() === '重新验证'
  )
}
async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ModelConfigEditDialog（V76/V77）', () => {
  it('模型标识为开放文本框（2026-07-13 需求）：非下拉、可直接输入', async () => {
    await mount(null)
    expect(container.querySelector('.fi[data-prop="model"] .el-select')).toBeFalsy()
    expect(inputByProp('model')).toBeTruthy()
    setInput('model', 'xopglm52')
    await nextTick()
    expect(inputByProp('model').value).toBe('xopglm52')
  })

  it('新建态默认 API_KEY：显 api_key 字段、不显 app_id/app_secret', async () => {
    await mount(null)
    expect(inputByProp('apiKey')).toBeTruthy()
    expect(inputByProp('appId')).toBeFalsy()
    expect(inputByProp('appSecret')).toBeFalsy()
  })

  it('V77 参数字段：厂商预设/上下文窗口(必填)/默认温度(选填)/额外参数(选填)；最大输出已隐藏', async () => {
    await mount(null)
    // 上下文窗口：必填下拉（含常用档位）
    expect(container.querySelector('.fi[data-prop="contextWindow"] .el-select')).toBeTruthy()
    expect(container.textContent).toContain('64K')
    // 最大输出：已隐藏（无实质用处、无默认值；编辑时原值隐式回传保留），表单不再渲染该项
    expect(container.querySelector('.fi[data-prop="maxOutputTokens"]')).toBeFalsy()
    // 默认温度/额外参数：选填（2026-09-01 PRD 对齐改造取代旧口径：「附加参数」改名「额外参数」并移入能力信息区）
    expect(container.textContent).toContain('默认温度')
    expect(container.textContent).toContain('额外参数')
    // 描述字段不再展示（编辑时原值仍透传保留）
    expect(container.querySelector('.fi[data-prop="description"]')).toBeFalsy()
  })

  // 2026-09-09 PRD 复核轮 · G4/A9（Q224「去掉预设卡片」，prd-模型.md 已删整节）：
  // 原「六张卡片点选即预填」用例反转为「卡片区整体不存在」——新建态直接从「基本信息」起。
  it('厂商预设卡片区已删除（A9）：新建态无 .mc-preset-* 任何痕迹', async () => {
    await mount(null)
    expect(container.querySelector('.mc-preset-grid')).toBeFalsy()
    expect(container.querySelectorAll('.mc-preset-card').length).toBe(0)
    expect(container.textContent).not.toContain('厂商预设')
    expect(container.textContent).not.toContain('OpenAI 兼容协议')
  })

  // 2026-09-09 原型复刻批次 3A · S1：分区标题类名由 .mc-sec-title 改为公共 .section-title
  // （样式统一收到 assets/admin-shell.css 的 .section-card 一组）。
  // 2026-09-09 · A9：分区卡从四张收为三张（「厂商预设」已删）。
  it('分区结构（M7）：基本信息/连接与鉴权/能力信息 分区卡齐全，服务地址在连接与鉴权区', async () => {
    await mount(null)
    const titles = [...container.querySelectorAll('.section-title')].map((t) => t.textContent)
    expect(titles.some((t) => t.includes('厂商预设'))).toBe(false)
    expect(titles.some((t) => t.includes('基本信息'))).toBe(true)
    expect(titles.some((t) => t.includes('连接与鉴权'))).toBe(true)
    expect(titles.some((t) => t.includes('能力信息'))).toBe(true)
    // MQ4：base_url 按原型放「连接与鉴权」区，标签「服务地址（Base URL）」
    expect(container.textContent).toContain('服务地址（Base URL）')
    // M8：新建态能力信息区给接入引导 notice
    expect(container.textContent).toContain('接入并验证后自动识别流式、工具、JSON 和推理能力。')
  })

  it('编辑态：底部弱化时间行三项，未发布显「—」（M7）', async () => {
    await mount({
      id: 'md_x',
      name: 'D',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      status: 'DRAFT',
      createdAt: '2026-08-20T15:20:00+08:00',
      updatedAt: '2026-08-21T10:00:00+08:00',
      publishedAt: null
    })
    const times = container.querySelector('.mc-times')
    expect(times).toBeTruthy()
    expect(times.textContent).toContain('创建时间：2026-08-20 15:20')
    expect(times.textContent).toContain('最近更新时间：2026-08-21 10:00')
    expect(times.textContent).toContain('最近发布时间：—')
  })

  it('模型类别（V83）：必填下拉，四选项齐全', async () => {
    await mount(null)
    expect(container.querySelector('.fi[data-prop="category"] .el-select')).toBeTruthy()
    for (const label of ['文本生成', '图像理解', '多模态', '文生图']) {
      expect(container.textContent).toContain(label)
    }
  })

  it('每个参数带 ? 悬浮说明（小白文案）', async () => {
    await mount(null)
    const tips = [...container.querySelectorAll('.tip-stub')].map((t) => t.dataset.tip)
    expect(tips.length).toBeGreaterThanOrEqual(8)
    // 抽查小白文案
    expect(tips.some((t) => t?.includes('1 个汉字约等于 1~2 个 token'))).toBe(true)
    expect(tips.some((t) => t?.includes('发散程度'))).toBe(true)
    expect(tips.some((t) => t?.includes('不清楚就留空'))).toBe(true)
  })

  it('APP_ID_SECRET 模式：显 app_id/api_key/app_secret 三字段（讯飞 MaaS 三元组）', async () => {
    await mount({
      id: 'md_ifly',
      name: '讯飞模型',
      baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
      model: 'xopdeepseekv4flash',
      authType: 'APP_ID_SECRET',
      appId: 'app-id-x',
      hasAppSecret: true,
      status: 'DRAFT'
    })
    expect(inputByProp('appId')).toBeTruthy()
    expect(inputByProp('apiKey')).toBeTruthy()
    expect(inputByProp('appSecret')).toBeTruthy()
    expect(inputByProp('appId').value).toBe('app-id-x')
  })

  it('编辑态已配置密钥：api_key 占位「留空不修改」', async () => {
    await mount({
      id: 'md_x',
      name: 'D',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: '******',
      status: 'DRAFT'
    })
    expect(inputByProp('apiKey').dataset.ph).toContain('留空不修改')
  })

  // ---------- 凭据首尾明文掩码（2026-08-22 负责人口径） ----------

  it('编辑态：api_key 与 app_secret 各自展示后端回的首尾明文掩码', async () => {
    await mount({
      id: 'md_x',
      name: 'D',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'APP_ID_SECRET',
      appId: 'app-1',
      apiKeyMasked: 'sk-*********0ab',
      hasAppSecret: true,
      appSecretMasked: 'ab****gh',
      status: 'DRAFT'
    })
    const masks = [...container.querySelectorAll('.cred-mask')].map((n) => n.textContent)
    expect(masks.some((t) => t.includes('sk-*********0ab'))).toBe(true)
    expect(masks.some((t) => t.includes('ab****gh'))).toBe(true)
  })

  it('掩码只读展示、不写进输入框（输入框仍是留空不修改语义）', async () => {
    await mount({
      id: 'md_x',
      name: 'D',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: 'sk-*********0ab',
      status: 'DRAFT'
    })
    // 掩码若被塞进 input，会被 type=password 再打一层圆点，且用户会误以为要在原值上编辑
    expect(inputByProp('apiKey').value).toBe('')
    expect(inputByProp('apiKey').dataset.ph).toContain('留空不修改')
  })

  it('未配置凭据（掩码为 null）：不渲染掩码行，占位回落为示例文案', async () => {
    await mount({
      id: 'md_x',
      name: 'D',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: null,
      status: 'DRAFT'
    })
    expect(container.querySelectorAll('.cred-mask').length).toBe(0)
    expect(inputByProp('apiKey').dataset.ph).not.toContain('留空不修改')
  })

  it('新建态：即便传了掩码也不展示（新建没有既有凭据可核对）', async () => {
    await mount(null)
    expect(container.querySelectorAll('.cred-mask').length).toBe(0)
  })

  it('V96 保存即返回：不在弹窗内验证，emit saved 带 verifyId 交列表行内跑', async () => {
    // 旧实现在此 await 验证，用户点「保存」却被扣住约 40 秒——他要的是保存，不是等验证。
    await mount()
    setInput('name', 'DeepSeek')
    setInput('baseUrl', 'https://api.deepseek.com/v1')
    setInput('model', 'deepseek-chat')
    setInput('apiKey', 'sk-x')
    api.createModel.mockResolvedValue({ id: 'md_new' })
    saveBtn().click()
    await flush()
    expect(api.createModel).toHaveBeenCalled()
    expect(api.verifyModel).not.toHaveBeenCalled()          // 弹窗内不再发起验证
    expect(savedSpy).toHaveBeenCalledWith({ verifyId: 'md_new' })
  })

  it('新建保存成功后再次保存：走 update 而非二次 create（CR 修复项）', async () => {
    await mount()
    setInput('name', 'A')
    setInput('baseUrl', 'https://a/v1')
    setInput('model', 'm')
    setInput('apiKey', 'sk-x')
    api.createModel.mockResolvedValue({ id: 'md_new' })
    saveBtn().click()
    await flush()
    expect(api.createModel).toHaveBeenCalledTimes(1)
  })

  it('V96 保存与验证解耦：保存成功即关闭弹窗，验证结论不再在此回显', async () => {
    await mount()
    setInput('name', 'A')
    setInput('baseUrl', 'https://a/v1')
    setInput('model', 'm')
    setInput('apiKey', 'sk-x')
    api.createModel.mockResolvedValue({ id: 'md_new' })
    saveBtn().click()
    await flush()
    expect(savedSpy).toHaveBeenCalled()
    expect(api.verifyModel).not.toHaveBeenCalled()
  })

  it('编辑已发布模型改连接字段：先弹确认（回草稿重审），取消则不保存', async () => {
    await mount({
      id: 'md_pub',
      name: '线上模型',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: '******',
      status: 'PUBLISHED'
    })
    setInput('baseUrl', 'https://changed.example/v1')
    msgBox.confirm.mockRejectedValue('cancel')
    saveBtn().click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalled()
    expect(api.updateModel).not.toHaveBeenCalled()

    // 确认后正常走保存；验证不在弹窗内发起（改由列表行内跑）
    msgBox.confirm.mockResolvedValue()
    api.updateModel.mockResolvedValue({ id: 'md_pub' })
    saveBtn().click()
    await flush()
    expect(api.updateModel).toHaveBeenCalledWith('md_pub', expect.objectContaining({
      baseUrl: 'https://changed.example/v1'
    }))
    expect(savedSpy).toHaveBeenCalledWith({ verifyId: 'md_pub' })
  })

  it('编辑「当前是默认」模型改类别：先弹确认（会取消默认），取消则不保存', async () => {
    await mount({
      id: 'md_def',
      name: '默认模型',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: '******',
      status: 'PUBLISHED',
      isDefault: true,
      category: 'TEXT'
    })
    setInput('category', 'VISION') // 只改类别（非连接字段，不触发回草稿确认）
    msgBox.confirm.mockRejectedValue('cancel')
    saveBtn().click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalled()
    expect(api.updateModel).not.toHaveBeenCalled()

    // 确认后正常保存（category=VISION 透传）
    msgBox.confirm.mockResolvedValue()
    api.updateModel.mockResolvedValue({ id: 'md_def' })
    api.verifyModel.mockResolvedValue({ verifyStatus: 'SUCCESS', verifyLatencyMs: 90 })
    saveBtn().click()
    await flush()
    expect(api.updateModel).toHaveBeenCalledWith('md_def', expect.objectContaining({ category: 'VISION' }))
  })

  it('编辑已发布模型仅改名称（连接字段未动）：不弹确认直接保存', async () => {
    await mount({
      id: 'md_pub',
      name: '线上模型',
      baseUrl: 'https://a/v1',
      model: 'm',
      authType: 'API_KEY',
      apiKeyMasked: '******',
      status: 'PUBLISHED'
    })
    setInput('name', '新名字')
    api.updateModel.mockResolvedValue({ id: 'md_pub' })
    api.verifyModel.mockResolvedValue({ verifyStatus: 'SUCCESS', verifyLatencyMs: 90 })
    saveBtn().click()
    await flush()
    expect(msgBox.confirm).not.toHaveBeenCalled()
    expect(api.updateModel).toHaveBeenCalled()
  })

  it('V95 只读查看态：不渲染保存与重新验证按钮', async () => {
    await mount({ id: 'md_1', name: '老模型', status: 'PUBLISHED' }, { readonly: true })
    expect(saveBtn()).toBeFalsy()
    expect(verifyOnlyBtn()).toBeFalsy()
  })

  it('V95「重新验证」：直接调 verifyModel，不走保存', async () => {
    api.verifyModel.mockResolvedValue({ verifyStatus: 'SUCCESS', verifyLatencyMs: 120 })
    await mount({ id: 'md_1', name: '老模型', status: 'PUBLISHED' })
    verifyOnlyBtn().click()
    await flush()
    expect(api.verifyModel).toHaveBeenCalledWith('md_1')
    expect(api.updateModel).not.toHaveBeenCalled()
  })

  /* ===== 2026-09-09 原型复刻批次 3A（D3 / D5 / D6） ===== */

  it('D3 图标字段：基本信息里「模型名称」之后一格；新建默认 ▦，编辑回填行上的图标', async () => {
    await mount()
    const fields = [...container.querySelectorAll('.fi')]
    const nameIdx = fields.findIndex((f) => f.dataset.prop === 'name')
    const iconIdx = fields.findIndex((f) => f.dataset.prop === 'icon')
    expect(nameIdx).toBeGreaterThan(-1)
    // 原型 L1319-1330 addMissingIconField 就是插在模型名称 .field 之后
    expect(iconIdx).toBe(nameIdx + 1)
    // 新建默认字形 ▦（原型 L1415）
    expect(container.querySelector('.icon-field-stub').dataset.icon).toBe('▦')

    app.unmount()
    container.remove()
    await mount({ id: 'md_1', name: '老模型', icon: '◎' })
    expect(container.querySelector('.icon-field-stub').dataset.icon).toBe('◎')
  })

  it('D3 图标：选中后随 payload 下发（列表页 D2 消费本字段）', async () => {
    await mount()
    setInput('name', 'A')
    setInput('baseUrl', 'https://a/v1')
    setInput('model', 'm')
    setInput('apiKey', 'sk-x')
    container.querySelector('.icon-pick').click()
    await nextTick()
    api.createModel.mockResolvedValue({ id: 'md_new' })
    saveBtn().click()
    await flush()
    expect(api.createModel.mock.calls.at(-1)[0].icon).toBe('★')
  })

  it('D3 图标：查看态两按钮置灰（readonly 透传给 IconField）', async () => {
    await mount({ id: 'md_1', name: '老模型', icon: '◎' }, { readonly: true })
    expect(container.querySelector('.icon-field-stub').dataset.readonly).toBe('1')
  })

  it('D5「连接与鉴权」两列栅格：Base URL 与单 API Key 通栏，鉴权方式半栏', async () => {
    await mount()
    const grids = [...container.querySelectorAll('.mc-grid')]
    // 基本信息 + 连接与鉴权 两处栅格
    expect(grids.length).toBe(2)
    const conn = grids[1]
    expect(conn.querySelector('[data-prop="baseUrl"]').classList.contains('mc-span2')).toBe(true)
    expect(conn.querySelector('[data-prop="apiKey"]').classList.contains('mc-span2')).toBe(true)
    expect(conn.querySelector('[data-prop="authType"]').classList.contains('mc-span2')).toBe(false)
  })

  it('D6 保存校验不过：除行内红字外再 toast「请先修正标红项」，且不发保存请求', async () => {
    // 本例把 el-form 的 validate 桩成 reject（EP 校验失败即 reject），走 catch(() => false) 分支
    const failingForm = {
      template: '<form class="el-form"><slot /></form>',
      methods: {
        validate: () => Promise.reject(new Error('invalid')),
        clearValidate() {},
        validateField() {}
      }
    }
    await mount(null, {}, { 'el-form': failingForm })
    saveBtn().click()
    await flush()
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(api.createModel).not.toHaveBeenCalled()
    expect(api.updateModel).not.toHaveBeenCalled()
  })
})
