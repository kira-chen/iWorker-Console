// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * ApiEditor.vue 单测（原 ApiEditorReadWriteError.test.js，2026-09-12 测试审计 T58 改名扩写）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md：
 *   §三.1 页面三态（新建 / 编辑 / 查看：查看全只读、底部仅【关闭】）
 *   §三.2 基本信息（示例问题 3 条 + 【AI 生成】一次 3 条）
 *   §三.3 鉴权（默认不鉴权；Bearer Token 不能为空）
 *   §三.4 请求配置（请求方式默认 GET；启用 / 停用默认启用）
 *   §三.7 保存校验（一次性标红 / 「请先修正标红项」/ URL 合法 / 成功「API 已创建」「API 已保存」并关抽屉 / 失败保留输入）
 *   + 数据层 field 级错误回显（readWrite 等）、watcher immediate 防回归（5303c7c）。
 *   2026-09-12 闭环：K36（§三.2 L120 API ID 编辑 / 查看态只读展示、新建不展示；名称上限 64 · 一览表 §6.2）、
 *   K38（§三.5 L170 查看态 SchemaFieldEditor 隐藏新增 / 删除 / 子字段入口，经 readonly 透传）。
 *
 * 桩：api/apiConnector、element-plus（ElMessage）、IconField（露【选图标】按钮 emit pick）、EP 控件最小桩
 *（el-radio 点击即回写 v-model，el-select 走原生 select）。SchemaFieldEditor / ParamRowsEditor / DrawerEditor 为真组件。
 */

const conn = {
  createApi: vi.fn(),
  updateApi: vi.fn(),
  getApi: vi.fn(),
  listProviderSystems: vi.fn(() => Promise.resolve({ list: [{ id: 'pv_1', name: '财务系统' }] }))
}
vi.mock('@/api/apiConnector', () => conn)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg }))

// 图标行：桩 IconField，露一个【选图标】按钮回吐 pick，免把图标库 / 上传裁剪链路拖进来
vi.mock('@/components/common/IconField.vue', () => ({
  default: {
    name: 'IconField',
    props: ['icon', 'name', 'readonly', 'placeholder', 'size'],
    emits: ['pick'],
    template:
      '<div class="icon-field-stub" :data-icon="icon" :data-readonly="readonly ? 1 : 0">' +
      '<button class="icon-pick" :disabled="readonly" @click="$emit(\'pick\', { icon: \'📄\', iconSource: \'library\' })">选图标</button></div>'
  }
}))

// 详情满足全部校验（名称/图标/系统/描述/示例问题×3/URL），保证保存能走到 updateApi
const DETAIL = {
  code: 'api_1',
  name: '报销查询',
  icon: '📄',
  description: '按报销单号查询审批状态',
  providerSystemId: 'pv_1',
  url: 'https://api.x.com/q',
  method: 'GET',
  enabled: true,
  readWrite: 'read',
  exampleQuestions: ['问题一', '问题二', '问题三'],
  authType: 'NONE',
  authConfig: null,
  requestSchema: null,
  responseSchema: null,
  referencedBySkills: [],
  createdAt: '2026-08-20T09:30:00+08:00',
  updatedAt: '2026-08-24T16:10:00+08:00',
  publishedAt: null
}

const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot name="header" /><slot /><div class="footer"><slot name="footer" /></div></div>'
  },
  'el-form': { props: ['disabled'], template: '<form class="el-form" :data-disabled="disabled ? 1 : 0"><slot /></form>' },
  // error prop 渲染成 data-error 供断言字段级红框回显
  'el-form-item': {
    props: ['error', 'label'],
    template: '<div class="el-form-item" :data-label="label" :data-error="error"><slot name="label" /><slot /></div>'
  },
  'el-input': {
    props: ['modelValue', 'placeholder', 'type', 'disabled'],
    emits: ['update:modelValue', 'input'],
    template:
      '<span class="el-input-wrap"><slot name="prepend" /><input class="el-input" :value="modelValue" :placeholder="placeholder"' +
      ' :type="type || \'text\'" :disabled="disabled"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" /></span>'
  },
  'el-radio-group': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    provide() {
      return { rg: this }
    },
    template: '<div class="el-radio-group"><slot /></div>'
  },
  'el-radio': {
    props: ['value'],
    inject: ['rg'],
    template:
      '<label class="el-radio" :data-value="value" :class="{ \'is-checked\': rg.modelValue === value }"' +
      ' @click="rg.$emit(\'update:modelValue\', value)"><slot /></label>'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  'el-option': { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-checkbox': {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<input type="checkbox" class="el-checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  'el-button': {
    props: ['type', 'loading', 'disabled', 'title'],
    emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" :title="title" @click="!disabled && $emit(\'click\')"><slot /></button>'
  },
  'el-popconfirm': {
    emits: ['confirm'],
    template: '<span class="el-popconfirm" @click="$emit(\'confirm\')"><slot name="reference" /></span>'
  },
  'el-skeleton': { template: '<div />' },
  'el-empty': { template: '<div><slot /></div>' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  Delete: { template: '<i />' }
}

let app, container, visible, saved
async function flush(n = 5) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
/** 常驻挂载：visible 由 false→true 触发 load()（列表页用法）。 */
async function mountEditor(apiId, extra = {}) {
  const { default: Editor } = await import('@/components/admin/ApiEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  visible = ref(false)
  saved = vi.fn()
  app = createApp({
    render: () =>
      h(Editor, {
        visible: visible.value,
        apiId,
        ...extra,
        'onUpdate:visible': (v) => (visible.value = v),
        onSaved: saved
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  visible.value = true
  await flush()
  return container
}
/** 治理侧用法：组件创建时 visible 已是 true（无 false→true 跃迁）。 */
async function mountEditorOpened(apiId, extra = {}) {
  const { default: Editor } = await import('@/components/admin/ApiEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  visible = ref(true)
  saved = vi.fn()
  app = createApp({
    render: () => h(Editor, { visible: visible.value, apiId, ...extra, 'onUpdate:visible': (v) => (visible.value = v), onSaved: saved })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await flush()
  return container
}
const findBtn = (el, text) => [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const itemByLabel = (el, label) => [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.label === label)
const inputOf = (el, label) => itemByLabel(el, label).querySelector('input.el-input, textarea')
const setInput = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
// 读/写 form-item：含「只是查看（读）」radio 的那个 el-form-item
const readWriteItem = (el) => [...el.querySelectorAll('.el-form-item')].find((it) => it.textContent.includes('只是查看'))
const clickRadio = (el, value) => el.querySelector(`.el-radio[data-value="${value}"]`).click()
const eqInputs = (el) => [...el.querySelectorAll('.ad-eq-row input.el-input')]

/** 把新建态表单填到能过校验（不含鉴权） */
async function fillValidNew(el) {
  setInput(inputOf(el, '名称'), '新接口')
  el.querySelector('.icon-pick').click()
  const ps = itemByLabel(el, '所属服务提供系统').querySelector('select')
  ps.value = 'pv_1'
  ps.dispatchEvent(new Event('change'))
  setInput(inputOf(el, 'API 描述'), '一句话描述')
  eqInputs(el).forEach((inp, i) => setInput(inp, `问题${i + 1}`))
  setInput(inputOf(el, 'API 地址'), 'https://x.example.com/api')
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  conn.getApi.mockResolvedValue({ ...DETAIL })
  conn.listProviderSystems.mockResolvedValue({ list: [{ id: 'pv_1', name: '财务系统' }] })
  conn.createApi.mockResolvedValue({ id: 'api_new' })
  conn.updateApi.mockResolvedValue({ id: 'api_1' })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ApiEditor · 保存校验（md §三.7 L183-189）', () => {
  it('新建全空点【保存】 → 名称/图标/所属系统/描述/地址 5 个表单项标红 + 示例问题区标红，warning「请先修正标红项」，不调 createApi', async () => {
    const el = await mountEditor(null)
    findBtn(el, '保存').click()
    await flush()
    const red = [...el.querySelectorAll('.el-form-item')].filter((it) => it.getAttribute('data-error'))
    expect(red.map((it) => it.dataset.label)).toEqual(['名称', '所属服务提供系统', '图标', 'API 描述', 'API 地址'])
    expect(itemByLabel(el, '名称').dataset.error).toBe('名称不能为空')
    expect(itemByLabel(el, '所属服务提供系统').dataset.error).toBe('必须选择所属服务提供系统')
    expect(itemByLabel(el, 'API 地址').dataset.error).toBe('API 地址必须为合法的 HTTP 或 HTTPS URL')
    expect(el.querySelector('.ad-eq-err-msg').textContent).toContain('示例问题必填，请填满 3 条')
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(conn.createApi).not.toHaveBeenCalled()
    expect(el.querySelector('.el-drawer')).toBeTruthy()
  })

  it('编辑合法详情但把地址改成 ftp:// → 只有「API 地址」标红，不调 updateApi', async () => {
    const el = await mountEditor('api_1')
    setInput(inputOf(el, 'API 地址'), 'ftp://x.example.com')
    findBtn(el, '保存').click()
    await flush()
    const red = [...el.querySelectorAll('.el-form-item')].filter((it) => it.getAttribute('data-error'))
    expect(red.map((it) => it.dataset.label)).toEqual(['API 地址'])
    expect(el.querySelector('.ad-eq-err-msg')).toBeNull()
    expect(conn.updateApi).not.toHaveBeenCalled()
  })

  it('选 Bearer Token 但 Token 留空 → 「Token 不能为空」标红，不调 createApi（md §三.7 L186）', async () => {
    const el = await mountEditor(null)
    await fillValidNew(el)
    clickRadio(el, 'BEARER')
    await nextTick()
    // Bearer 输入框带「Authorization: Bearer」前缀段 + 密码态（md §三.3 L141）
    const tokenItemBefore = [...el.querySelectorAll('.el-form-item')].find((it) => it.textContent.includes('只填 Token 本体'))
    expect(tokenItemBefore.textContent).toContain('Authorization: Bearer')
    expect(tokenItemBefore.querySelector('input.el-input').getAttribute('type')).toBe('password')
    findBtn(el, '保存').click()
    await flush()
    const tokenItem = [...el.querySelectorAll('.el-form-item')].find((it) => it.dataset.error === 'Token 不能为空')
    expect(tokenItem).toBeTruthy()
    expect(conn.createApi).not.toHaveBeenCalled()
  })

  it('编辑态合法保存 → updateApi(id, payload) + 「API 已保存」+ emit saved + 抽屉关闭（md §三.7 L188）', async () => {
    const el = await mountEditor('api_1')
    setInput(inputOf(el, '名称'), '报销查询（改）')
    findBtn(el, '保存').click()
    await flush()
    expect(conn.updateApi).toHaveBeenCalledWith(
      'api_1',
      expect.objectContaining({ name: '报销查询（改）', url: 'https://api.x.com/q', method: 'GET', enabled: true, authType: 'NONE', authConfig: null })
    )
    expect(msg.success).toHaveBeenCalledWith('API 已保存')
    expect(saved).toHaveBeenCalledWith({ id: 'api_1' })
    expect(visible.value).toBe(false)
    expect(el.querySelector('.el-drawer')).toBeNull()
  })

  it('新建合法保存 → createApi(payload) + 「API 已创建」+ saved 带新 id + 关抽屉', async () => {
    const el = await mountEditor(null, { defaultProviderSystemId: 'pv_1' })
    await fillValidNew(el)
    findBtn(el, '保存').click()
    await flush()
    expect(conn.createApi).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '新接口',
        icon: '📄',
        providerSystemId: 'pv_1',
        description: '一句话描述',
        url: 'https://x.example.com/api',
        exampleQuestions: ['问题1', '问题2', '问题3'],
        readWrite: 'read',
        enabled: true
      })
    )
    expect(msg.success).toHaveBeenCalledWith('API 已创建')
    expect(saved).toHaveBeenCalledWith({ id: 'api_new' })
    expect(visible.value).toBe(false)
  })

  it('保存失败（数据层抛 message）→ 抽屉不关、输入保留、ElMessage.error 原因（md §三.7 L189 / §四「保存失败」）', async () => {
    conn.updateApi.mockRejectedValueOnce({ message: '服务提供系统不存在' })
    const el = await mountEditor('api_1')
    setInput(inputOf(el, '名称'), '改过的名字')
    findBtn(el, '保存').click()
    await flush()
    expect(conn.updateApi).toHaveBeenCalled()
    expect(msg.error).toHaveBeenCalledWith('服务提供系统不存在')
    expect(msg.success).not.toHaveBeenCalled()
    expect(visible.value).toBe(true)
    expect(el.querySelector('.el-drawer')).toBeTruthy()
    expect(inputOf(el, '名称').value).toBe('改过的名字')
    expect(saved).not.toHaveBeenCalled()
  })

  it('数据层返回 field=readWrite 校验错误 → 读/写 form-item 的 :error 回显该消息（N7 原用例）', async () => {
    conn.updateApi.mockRejectedValueOnce({ field: 'readWrite', message: '读/写属性不合法' })
    const el = await mountEditor('api_1')
    expect(readWriteItem(el).getAttribute('data-error')).toBeFalsy()
    findBtn(el, '保存').click()
    await flush()
    expect(conn.updateApi).toHaveBeenCalled()
    expect(readWriteItem(el).getAttribute('data-error')).toBe('读/写属性不合法')
    expect(msg.error).toHaveBeenCalledWith('读/写属性不合法')
  })
})

describe('ApiEditor · 新建默认值与三态（md §三.1 / §三.3 L124 / §三.4 L149,L153）', () => {
  it('新建：鉴权默认「不鉴权」、请求方式默认 GET、状态默认「启用」、操作性质默认「读」；底部【取消】【保存】', async () => {
    const el = await mountEditor(null)
    expect(el.querySelector('.el-radio[data-value="NONE"]').classList.contains('is-checked')).toBe(true)
    expect(el.querySelector('.el-radio[data-value="BEARER"]').classList.contains('is-checked')).toBe(false)
    expect(itemByLabel(el, '请求方式').querySelector('select').value).toBe('GET')
    expect(el.querySelector('.ad-enabled-group .el-radio[data-value="true"]').classList.contains('is-checked')).toBe(true)
    expect(el.querySelector('.el-radio[data-value="read"]').classList.contains('is-checked')).toBe(true)
    // 不鉴权时不展示凭证字段（md §三.3 L126）
    expect(el.querySelector('.pr-rows')).toBeNull()
    expect(el.textContent).not.toContain('Authorization: Bearer')
    const footBtns = [...el.querySelectorAll('.footer .el-button')].map((b) => b.textContent.trim())
    expect(footBtns).toEqual(['取消', '保存'])
    // 新建不拉详情
    expect(conn.getApi).not.toHaveBeenCalled()
    // 新建从分组头进入时自动带入所属系统（md §三.1 L90）
    expect(itemByLabel(el, '所属服务提供系统').querySelector('select').value).toBe('')
  })

  it('新建从分组头带入 defaultProviderSystemId → 所属系统已预选', async () => {
    const el = await mountEditor(null, { defaultProviderSystemId: 'pv_1' })
    expect(itemByLabel(el, '所属服务提供系统').querySelector('select').value).toBe('pv_1')
  })

  it('查看态（readonly）：表单禁用、图标按钮置灰、鉴权参数行增删禁用、无【AI 生成】、底部仅【关闭】', async () => {
    conn.getApi.mockResolvedValue({
      ...DETAIL,
      authType: 'API_KEY',
      authConfig: { params: [{ in: 'HEADER', name: 'X-Api-Key', description: '', clientFill: false, valueMasked: 'fin***1d8' }] }
    })
    const el = await mountEditor('api_1', { readonly: true })
    expect([...el.querySelectorAll('form.el-form')].every((f) => f.dataset.disabled === '1')).toBe(true)
    expect(el.querySelector('.icon-field-stub').dataset.readonly).toBe('1')
    // ParamRowsEditor readonly 形态：添加 / 删除按钮置灰，已配置值只显掩码占位不回显明文
    const rows = el.querySelector('.pr-rows')
    expect(rows).toBeTruthy()
    expect(findBtn(rows, '＋ 添加参数').disabled).toBe(true)
    expect(findBtn(rows, '删除').disabled).toBe(true)
    const valueInput = rows.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')[2]
    expect(valueInput.value).toBe('')
    expect(valueInput.placeholder).toContain('fin***1d8')
    expect(el.querySelector('.ad-eq-ai')).toBeNull()
    expect([...el.querySelectorAll('.footer .el-button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
  })

  it('查看态：请求参数 / 响应字段完整展示层级，但无【＋ 添加字段】【＋子字段】与删除入口（md §三.5 L170，K38）', async () => {
    conn.getApi.mockResolvedValue({
      ...DETAIL,
      requestSchema: { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'string' } } } } },
      responseSchema: { type: 'object', properties: { code: { type: 'number' } } }
    })
    const el = await mountEditor('api_1', { readonly: true })
    const sfes = el.querySelectorAll('.sfe')
    expect(sfes.length).toBe(2)
    expect(sfes[0].querySelectorAll('.sfe-row').length).toBe(2) // user + 缩进子行 id
    expect(sfes[0].querySelector('.sfe-row.is-child')).toBeTruthy()
    for (const sfe of sfes) {
      expect(findBtn(sfe, '＋ 添加字段')).toBeUndefined()
      expect(findBtn(sfe, '＋子字段')).toBeUndefined()
      expect(sfe.querySelector('.el-popconfirm')).toBeNull()
    }
    // 编辑态对照：入口都在
    app.unmount(); container.remove()
    const rw = await mountEditor('api_1')
    expect(findBtn(rw.querySelectorAll('.sfe')[0], '＋ 添加字段')).toBeTruthy()
  })

  it('编辑 / 查看态只读展示 API ID（系统生成，如 api_1）；新建态不展示（md §三.2 L120，K36 / Q113）', async () => {
    let el = await mountEditor('api_1')
    expect(itemByLabel(el, 'API ID')).toBeTruthy()
    expect(el.querySelector('.ad-api-id').textContent.trim()).toBe('api_1')
    expect(itemByLabel(el, 'API ID').querySelector('input')).toBeNull() // 只读文本，非输入框
    app.unmount(); container.remove()
    el = await mountEditor('api_1', { readonly: true })
    expect(el.querySelector('.ad-api-id').textContent.trim()).toBe('api_1')
    app.unmount(); container.remove()
    el = await mountEditor(null)
    expect(itemByLabel(el, 'API ID')).toBeUndefined()
    expect(el.querySelector('.ad-api-id')).toBeNull()
  })

  it('名称超过 64 字 → 名称项标红「名称最多 64 个字符」、不调 createApi；恰 64 字通过（一览表 §6.2，K36）', async () => {
    const el = await mountEditor(null)
    await fillValidNew(el)
    setInput(inputOf(el, '名称'), 'A'.repeat(65))
    findBtn(el, '保存').click()
    await flush()
    expect(itemByLabel(el, '名称').dataset.error).toBe('名称最多 64 个字符')
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(conn.createApi).not.toHaveBeenCalled()
    setInput(inputOf(el, '名称'), 'A'.repeat(64))
    findBtn(el, '保存').click()
    await flush()
    expect(conn.createApi).toHaveBeenCalledTimes(1)
    expect(conn.createApi.mock.calls[0][0].name).toBe('A'.repeat(64))
  })

  it('编辑态：详情回填（名称 / 地址 / 示例问题）+ 时间行 + 被技能引用「暂无技能引用」（md §三.6）', async () => {
    const el = await mountEditor('api_1')
    expect(conn.getApi).toHaveBeenCalledWith('api_1')
    expect(inputOf(el, '名称').value).toBe('报销查询')
    expect(inputOf(el, 'API 地址').value).toBe('https://api.x.com/q')
    expect(eqInputs(el).map((i) => i.value)).toEqual(['问题一', '问题二', '问题三'])
    expect(el.querySelector('.page-time').textContent).toContain('创建时间：2026-08-20 09:30')
    expect(el.querySelector('.page-time').textContent).toContain('最近发布：—')
    expect(el.querySelector('.reference-section').textContent).toContain('暂无技能引用')
  })
})

describe('ApiEditor · 示例问题【AI 生成】（md §三.2 L120）', () => {
  it('API 描述为空 → 按钮禁用且 title「请先填写API 描述」', async () => {
    const el = await mountEditor(null)
    const ai = el.querySelector('.ad-eq-ai')
    expect(ai.textContent.trim()).toBe('AI 生成')
    expect(ai.disabled).toBe(true)
    expect(ai.getAttribute('title')).toBe('请先填写API 描述')
  })

  it('填了描述点【AI 生成】 → 「生成中…」→ 500ms 后 3 条回填、每条 ≤60 字、toast「AI 内容已生成，请确认后保存」；再点覆盖', async () => {
    vi.useFakeTimers()
    try {
      const el = await mountEditor(null)
      setInput(inputOf(el, '名称'), '报销查询')
      setInput(inputOf(el, 'API 描述'), '按单号查报销状态')
      await nextTick()
      const ai = el.querySelector('.ad-eq-ai')
      expect(ai.disabled).toBe(false)
      ai.click()
      await nextTick()
      expect(el.querySelector('.ad-eq-ai').textContent.trim()).toBe('生成中…')
      expect(el.querySelector('.ad-eq-ai').disabled).toBe(true)
      await vi.advanceTimersByTimeAsync(500)
      await nextTick()
      const qs = eqInputs(el).map((i) => i.value)
      expect(qs).toHaveLength(3)
      expect(qs.every((q) => q.trim() && q.length <= 60)).toBe(true)
      expect(qs[0]).toContain('报销查询')
      expect(msg.success).toHaveBeenCalledWith('AI 内容已生成，请确认后保存')
      expect(el.querySelector('.ad-eq-ai').textContent.trim()).toBe('AI 生成')
      // 重复点击可重新生成，覆盖当前内容
      setInput(eqInputs(el)[0], '手改的')
      el.querySelector('.ad-eq-ai').click()
      await vi.advanceTimersByTimeAsync(500)
      await nextTick()
      expect(eqInputs(el)[0].value).not.toBe('手改的')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ApiEditor · watcher immediate 防回归（5303c7c）', () => {
  it('组件创建时 visible 已是 true（治理侧条件挂载）→ 仍拉详情并回填名称，所属系统下拉有选项', async () => {
    const el = await mountEditorOpened('api_1')
    expect(conn.getApi).toHaveBeenCalledWith('api_1')
    expect(conn.listProviderSystems).toHaveBeenCalled()
    expect(inputOf(el, '名称').value).toBe('报销查询')
    expect(itemByLabel(el, '所属服务提供系统').querySelector('select').value).toBe('pv_1')
    expect(el.textContent).not.toContain('当前没有任何服务提供系统')
  })
})
