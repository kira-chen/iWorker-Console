// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeSourceEditor.vue（数据源新建 / 编辑 / 查看抽屉）· SSE 以外的主路径。
 * SSE 传输方式另见 knowledgeSourceEditorSse.test.js（不重复）。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 *   §四.3 公共字段（名称必填 ≤64、类型上传/API/MCP 创建后不可改、状态启停；修改连接配置后提示需重新测试）
 *   §五.1 上传配置（文档类型三枚举、预处理默认值与按类型动态展示、Embedding 必填、混合检索 / Top-K 5、更换模型前提示）
 *   §六.1 API 连接配置（地址必填 http(s)、方法默认 POST、鉴权默认 API KEY、超时 1000～60000 默认 8000、
 *         API KEY 至少一行参数、Bearer Token 必填、无鉴权不展示凭证字段）
 *   §六.2 新建默认三级示例组 filters→rules→field/value；§六.3 响应预设 content/source/score
 *   §六.4 / §七.7 连接测试（成功记录结果、失败展示原因、修改连接配置后重置为未验证）
 *   §七.2.1 / §七.2.2 MCP streamable-http（Endpoint + 鉴权默认无鉴权、Header 名规则）/ stdio（Command 五枚举、Arguments 每行一个）
 *   §七.2.3 切换到 stdio 按各自字段清空；§七.3 检索工具 ≥1、先测试再出工具清单；§七.6 超时默认 10000
 *   §八.2 保存失败保留表单不关抽屉；敏感信息保存后遮罩、编辑态留空=保留
 *   以及《各模块必填选填字段一览表.md》§10.1～§10.3 的必填项。
 *
 * 写法：真挂载 Element Plus（mountReal），api 层整体 vi.mock；表单标量经 el-form 的 model 写入，
 * 组件内部行状态（Token、工具勾选、Arguments、映射行）一律走 DOM 输入。
 */

const api = {
  getKnowledgeSource: vi.fn(),
  createKnowledgeSource: vi.fn(),
  updateKnowledgeSource: vi.fn(),
  testKnowledgeSource: vi.fn(),
  listEmbeddingModelOptions: vi.fn()
}
vi.mock('@/api/knowledgeBase', () => api)

const Editor = (await import('@/components/admin/KnowledgeSourceEditor.vue')).default

const EMB = [
  { id: 'emb_small', name: 'text-embedding-3-small' },
  { id: 'emb_bge', name: 'bge-m3' }
]

let mounted
let onVisible
let onSaved
afterEach(async () => {
  ElMessage.closeAll()
  // 二次确认框（更换向量模型）若残留，点掉，别漏到下一个用例
  document.querySelectorAll('.el-message-box').forEach((b) => b.remove())
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const drawer = () => mounted.container.querySelector('.el-drawer')
const formModel = () => drawer().querySelector('form.el-form').__vueParentComponent.props.model
const itemByLabel = (label) =>
  [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.trim() === label)
const errorTexts = () => [...drawer().querySelectorAll('.el-form-item__error, .ksrc-err, .sme-err')].map((e) => e.textContent.trim())
const btn = (label) => [...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === label)
const clickBtn = (label) => btn(label).click()
const headerText = () => drawer().querySelector('.de-head-title').textContent.trim()
function typeInto(el, v) {
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 等表单异步校验与 ElFormItem 红字（100ms 防抖）落定 */
async function settle() {
  await flushAll(10)
  await new Promise((r) => setTimeout(r, 250))
  await flushAll(4)
}
async function save() {
  clickBtn('保存')
  await settle()
}

async function mountEditor(props = {}) {
  api.listEmbeddingModelOptions.mockResolvedValue(EMB)
  onVisible = vi.fn()
  onSaved = vi.fn()
  // 组件在 visible 由 false→true 时才重置表单并加载（与列表页打开抽屉同路径），故先关后开
  const p = reactive({ visible: false, sourceId: null, 'onUpdate:visible': onVisible, onSaved, ...props })
  mounted = mountReal(Editor, p)
  await flushAll(4)
  p.visible = true
  await flushAll(10)
}
async function pickType(t) {
  formModel().sourceType = t
  await flushAll(6)
}

/* ====================================================================== */
describe('KnowledgeSourceEditor · 新建默认态与公共字段（md §四.3 / §五.1）', () => {
  it('新建：标题「新建数据源」，类型三选一默认「上传」可切换，状态默认启用，名称限 64 字', async () => {
    await mountEditor()

    expect(headerText()).toBe('新建数据源')
    const typeRadios = [...itemByLabel('类型').querySelectorAll('.el-radio')]
    expect(typeRadios.map((r) => r.textContent.trim())).toEqual(['上传', 'API', 'MCP'])
    expect(typeRadios.every((r) => !r.classList.contains('is-disabled'))).toBe(true)
    expect(formModel().sourceType).toBe('UPLOAD')
    expect(formModel().status).toBe('ENABLED')
    expect(itemByLabel('数据源名称').querySelector('input').getAttribute('maxlength')).toBe('64')
    expect(itemByLabel('数据源名称').classList.contains('is-required')).toBe(true)
    expect(drawer().textContent).toContain('创建后不可修改')
    expect(drawer().textContent).toContain('文档上传到平台内置 RAG 库，由平台切片与向量化')
  })

  it('上传类默认值：文档类型三枚举默认「文档」、仅「提取 URL 和邮箱地址」默认开启、混合检索 Top K 5，阈值提示由客户端提供', async () => {
    await mountEditor()

    expect([...itemByLabel('文档类型').querySelectorAll('.el-radio')].map((r) => r.textContent.trim())).toEqual(['文档', '表格', 'FAQ'])
    expect(formModel().docKind).toBe('DOC')
    expect(formModel().extractContacts).toBe(true)
    expect(formModel().plainTable).toBe(false)
    expect(formModel().retrieval).toBe('HYBRID')
    expect(formModel().topK).toBe(5)
    expect(drawer().textContent).toContain('系统已默认删除目录、页眉页脚、水印')
    expect(drawer().textContent).toContain('检索阈值不在管理端设置，由客户端每次发起检索时提供。')
    expect(itemByLabel('向量模型').classList.contains('is-required')).toBe(true)
  })

  it('预处理项按文档类型动态展示：FAQ 不展示「纯文本化表格内容」，表格 / 文档展示', async () => {
    await mountEditor()
    const pre = () => itemByLabel('文本预处理').textContent
    expect(pre()).toContain('提取 URL 和邮箱地址')
    expect(pre()).toContain('纯文本化表格内容')

    formModel().docKind = 'FAQ'
    await flushAll(6)
    expect(pre()).toContain('提取 URL 和邮箱地址')
    expect(pre()).not.toContain('纯文本化表格内容')

    formModel().docKind = 'TABLE'
    await flushAll(6)
    expect(pre()).toContain('纯文本化表格内容')
  })

  it('切换类型时说明文案与名称占位同步切换（API / MCP）', async () => {
    await mountEditor()
    await pickType('API')
    expect(drawer().textContent).toContain('调用第三方 RAG 平台的检索接口，按需取回切片')
    expect(itemByLabel('数据源名称').querySelector('input').placeholder).toBe('如 国标检索接口')
    await pickType('MCP')
    expect(drawer().textContent).toContain('通过 MCP 协议从第三方 RAG 平台取回切片')
    expect(itemByLabel('数据源名称').querySelector('input').placeholder).toBe('如 法规库 MCP')
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · 上传数据源保存（md §五.1 / 一览表 §10.1A）', () => {
  it('名称与向量模型都没填点【保存】：红字「请输入数据源名称」「请选择向量模型」+ toast「请先修正标红项」，不调 createKnowledgeSource', async () => {
    const warn = vi.spyOn(ElMessage, 'warning')
    await mountEditor()

    await save()

    expect(errorTexts()).toContain('请输入数据源名称')
    expect(errorTexts()).toContain('请选择向量模型')
    expect(warn).toHaveBeenCalledWith('请先修正标红项')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })

  it('填齐后保存：载荷含 trim 后名称、上传配置全集、无 authValue；toast 提示去「文档管理」上传，抛 saved 并关抽屉', async () => {
    const ok = vi.spyOn(ElMessage, 'success')
    api.createKnowledgeSource.mockResolvedValue({ id: 'ks_new', sourceType: 'UPLOAD', name: '产品资料', status: 'ENABLED', config: {} })
    await mountEditor()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '  产品资料  ')
    formModel().embeddingModelId = 'emb_bge'
    formModel().docKind = 'TABLE'
    formModel().plainTable = true
    formModel().retrieval = 'VECTOR'
    formModel().topK = 8
    await flushAll(4)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    expect(api.createKnowledgeSource.mock.calls[0][0]).toEqual({
      sourceType: 'UPLOAD',
      name: '产品资料',
      status: 'ENABLED',
      config: { docKind: 'TABLE', extractContacts: true, plainTable: true, embeddingModelId: 'emb_bge', retrieval: 'VECTOR', topK: 8 },
      authValue: undefined
    })
    expect(ok).toHaveBeenCalledWith('已保存，文档在列表「文档管理」入口上传')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onVisible).toHaveBeenCalledWith(false)
  })

  it('保存失败：toast 后端原因，抽屉不关、表单内容保留（md §八.2）', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    api.createKnowledgeSource.mockRejectedValue(new Error('数据源名称已存在'))
    await mountEditor()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '产品资料')
    formModel().embeddingModelId = 'emb_small'
    await flushAll(4)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalledWith('数据源名称已存在')
    expect(onVisible).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(formModel().name).toBe('产品资料')
    expect(btn('保存').classList.contains('is-loading')).toBe(false)
  })

  it('点【取消】：只关抽屉，不调任何写接口', async () => {
    await mountEditor()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '写了一半')
    await flushAll(4)

    clickBtn('取消')
    await flushAll(4)

    expect(onVisible).toHaveBeenCalledWith(false)
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
    expect(api.updateKnowledgeSource).not.toHaveBeenCalled()
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · API 数据源（md §六）', () => {
  it('切到 API：方法默认 POST、鉴权默认 API KEY、超时默认 8000；请求映射预设 query / topK 且新建默认带 filters 三级示例组', async () => {
    await mountEditor()
    await pickType('API')

    expect(formModel().api.method).toBe('POST')
    expect(formModel().api.authType).toBe('API_KEY')
    expect(formModel().api.timeoutMs).toBe(8000)
    expect(drawer().textContent).toContain('单位毫秒，默认 8000，范围 1000～60000')
    for (const label of ['请求方式', '检索地址', '超时时间', '鉴权方式']) expect(itemByLabel(label).classList.contains('is-required')).toBe(true)
    expect([...itemByLabel('鉴权方式').querySelectorAll('.el-radio')].map((r) => r.textContent.trim())).toEqual(['无鉴权', 'API KEY', 'Bearer Token'])
    // 映射：预设 query / topK + 示例 filters；响应预设 content / source / score
    expect([...drawer().querySelectorAll('.smp-fixed-name')].map((c) => c.textContent.trim())).toEqual(['query', 'topK'])
    const names = [...drawer().querySelectorAll('input')].map((i) => i.value)
    expect(names).toEqual(expect.arrayContaining(['filters', 'rules', 'field', 'value', 'enabled']))
    expect([...drawer().querySelectorAll('.sme-fixed-name')].map((c) => c.textContent.trim())).toEqual(['content', 'source', 'score'])
  })

  it('检索地址必填且须 http(s)：空 → 「请填写请求地址」；ftp:// → 「需为合法 HTTP/HTTPS 地址」；API KEY 无参数 → 至少配置一条', async () => {
    await mountEditor()
    await pickType('API')
    typeInto(itemByLabel('数据源名称').querySelector('input'), '国标检索')
    await flushAll(4)

    await save()
    expect(errorTexts()).toContain('请填写请求地址')
    expect(errorTexts()).toContain('已选 API KEY 鉴权，至少配置一条参数')

    formModel().api.url = 'ftp://rag.example.com/search'
    await flushAll(4)
    await save()
    expect(errorTexts()).toContain('需为合法 HTTP/HTTPS 地址')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })

  it('超时被清空（null）→ 红字「请输入 1000～60000 之间的整数」', async () => {
    await mountEditor()
    await pickType('API')
    formModel().api.timeoutMs = null
    await flushAll(4)

    await save()

    expect(errorTexts()).toContain('请输入 1000～60000 之间的整数')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })

  it('无鉴权不展示任何凭证字段；Bearer 展示 `Authorization: Bearer` 前缀密码框，未填点保存 →「Bearer Token 必填」', async () => {
    await mountEditor()
    await pickType('API')
    formModel().api.authType = 'NONE'
    await flushAll(6)
    expect(itemByLabel('Bearer Token')).toBeUndefined()
    expect(drawer().querySelector('input[placeholder="如 X-Api-Key"]')).toBeNull()

    formModel().api.authType = 'BEARER'
    await flushAll(6)
    const bearer = itemByLabel('Bearer Token')
    expect(bearer.textContent).toContain('Authorization: Bearer')
    expect(bearer.querySelector('input').type).toBe('password')
    expect(bearer.querySelector('input').placeholder).toBe('只填 Token 本体，不含 Bearer 前缀')

    formModel().api.url = 'https://rag.example.com/search'
    typeInto(itemByLabel('数据源名称').querySelector('input'), '国标检索')
    await flushAll(4)
    await save()
    expect(errorTexts()).toContain('Bearer Token 必填')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })

  it('填齐保存：载荷 config 含 trim 后地址 / 方法 / 鉴权 / 映射 / 超时，Bearer 明文走 authValue；toast「已保存」', async () => {
    const ok = vi.spyOn(ElMessage, 'success')
    api.createKnowledgeSource.mockResolvedValue(undefined)
    await mountEditor()
    await pickType('API')
    typeInto(itemByLabel('数据源名称').querySelector('input'), '国标检索')
    formModel().api.url = '  https://rag.example.com/search  '
    formModel().api.method = 'GET'
    formModel().api.authType = 'BEARER'
    formModel().api.timeoutMs = 15000
    await flushAll(6)
    typeInto(itemByLabel('Bearer Token').querySelector('input'), ' tok-123 ')
    await flushAll(4)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    const payload = api.createKnowledgeSource.mock.calls[0][0]
    expect(payload).toMatchObject({ sourceType: 'API', name: '国标检索', status: 'ENABLED', authValue: 'tok-123' })
    expect(payload.config).toMatchObject({ url: 'https://rag.example.com/search', method: 'GET', authType: 'BEARER', authParams: [], timeoutMs: 15000 })
    expect(payload.config.requestMap.map((r) => r.name)).toEqual(['query', 'topK', 'filters'])
    expect(payload.config.requestMap[2].children.map((c) => c.name)).toEqual(['rules', 'enabled'])
    expect(payload.config.requestMap[2].children[0].children.map((c) => c.name)).toEqual(['field', 'value'])
    expect(payload.config.responseMap.map((r) => [r.name, r.sourceField])).toEqual([
      ['content', 'content'],
      ['source', 'source'],
      ['score', 'score']
    ])
    expect(ok).toHaveBeenCalledWith('已保存')
  })

  it('API KEY 参数行：填参数名与值后保存，authParams 带位置 HEADER 与明文值，authValue 为 null', async () => {
    api.createKnowledgeSource.mockResolvedValue(undefined)
    await mountEditor()
    await pickType('API')
    typeInto(itemByLabel('数据源名称').querySelector('input'), '国标检索')
    formModel().api.url = 'https://rag.example.com/search'
    await flushAll(4)
    if (!drawer().querySelector('input[placeholder="如 X-Api-Key"]')) clickBtn('+ 添加参数') // 预置行缺陷见下方 it.fails
    await flushAll(4)
    const row = drawer().querySelector('input[placeholder="如 X-Api-Key"]').closest('.pr-row')
    typeInto(row.querySelector('input[placeholder="如 X-Api-Key"]'), 'X-Api-Key')
    const valueInput = row.querySelector('input[placeholder="必填"]')
    typeInto(valueInput, 'k-999')
    await flushAll(4)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    const payload = api.createKnowledgeSource.mock.calls[0][0]
    expect(payload.authValue).toBeNull()
    expect(payload.config.authType).toBe('API_KEY')
    expect(payload.config.authParams).toEqual([{ key: 'X-Api-Key', description: '', clientFill: false, in: 'HEADER', value: 'k-999' }])
  })
})

describe('KnowledgeSourceEditor · API KEY 默认预置参数行（md §六.1 / §六.1.1）', () => {
  it.fails('新建切到 API（鉴权默认 API KEY）时参数表应已预置一行可填（疑似缺陷：预置行只挂在 authType 变化的 watch 上，默认即 API_KEY 时不触发，表格为空；md §六.1「鉴权方式默认 API KEY」+ §六.1.1「至少保留一行有效参数」）', async () => {
    await mountEditor()
    await pickType('API')
    expect(formModel().api.authType).toBe('API_KEY') // 前提：默认 API KEY
    expect(drawer().querySelectorAll('input[placeholder="如 X-Api-Key"]').length).toBe(1)
  })
  it.fails('API KEY 参数值输入框应为密码形式（疑似缺陷：未给 ParamRowsEditor 传 secret-value，参数值以明文 text 输入；md §六.1.1 参数值「按敏感信息处理，以密码形式输入，保存后遮罩」）', async () => {
    await mountEditor()
    await pickType('API')
    if (!drawer().querySelector('input[placeholder="如 X-Api-Key"]')) clickBtn('+ 添加参数')
    await flushAll(4)
    const valueInput = drawer().querySelector('.pr-row:not(.pr-row-head) input[placeholder="必填"]')
    expect(valueInput).toBeTruthy() // 前提：参数值输入框存在
    expect(valueInput.type).toBe('password')
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · 连接测试（md §六.4 / §七.7）', () => {
  async function mountApiReady() {
    await mountEditor()
    await pickType('API')
    formModel().api.url = 'https://rag.example.com/search'
    formModel().api.authType = 'NONE'
    await flushAll(6)
  }

  it('未测试：按钮「测试连接」+ 提示「修改连接配置后需要重新测试」；上传类无测试区', async () => {
    await mountEditor()
    expect(btn('测试连接')).toBeUndefined()
    await pickType('API')
    expect(btn('测试连接')).toBeTruthy()
    expect(drawer().querySelector('.ksrc-test').textContent).toContain('修改连接配置后需要重新测试')
  })

  it('API 测试成功：以当前表单配置调 testKnowledgeSource，展示「连接正常 · 168 ms」，按钮转「重新测试」，toast「连接测试成功」', async () => {
    const ok = vi.spyOn(ElMessage, 'success')
    api.testKnowledgeSource.mockResolvedValue({ verifyStatus: 'SUCCESS', verifiedAt: null, verifyError: null, latencyMs: 168 })
    await mountApiReady()

    clickBtn('测试连接')
    await flushAll(10)

    expect(api.testKnowledgeSource).toHaveBeenCalledTimes(1)
    const [type, body] = api.testKnowledgeSource.mock.calls[0]
    expect(type).toBe('API')
    expect(body.sourceId).toBeNull()
    expect(body.authValue).toBeNull()
    expect(body.config).toMatchObject({ url: 'https://rag.example.com/search', method: 'POST', authType: 'NONE', timeoutMs: 8000 })
    expect(drawer().querySelector('.ksrc-verify.ok').textContent).toContain('连接正常 · 168 ms')
    expect(btn('重新测试')).toBeTruthy()
    expect(ok).toHaveBeenCalledWith('连接测试成功')
  })

  it('API 测试失败：展示「连接失败：<原因含错误码>」红色状态并 toast 原因', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    api.testKnowledgeSource.mockResolvedValue({ verifyStatus: 'FAILED', verifiedAt: null, verifyError: 'HTTP 401 鉴权失败' })
    await mountApiReady()

    clickBtn('测试连接')
    await flushAll(10)

    expect(drawer().querySelector('.ksrc-verify.bad').textContent).toContain('连接失败：HTTP 401 鉴权失败')
    expect(err).toHaveBeenCalledWith('HTTP 401 鉴权失败')
    expect(btn('测试连接')).toBeTruthy()
  })

  it('测试请求本身异常：toast 异常原因，按钮回到可点（不卡 loading）', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    api.testKnowledgeSource.mockRejectedValue(new Error('网络不可达'))
    await mountApiReady()

    clickBtn('测试连接')
    await flushAll(10)

    expect(err).toHaveBeenCalledWith('网络不可达')
    expect(btn('测试连接').classList.contains('is-loading')).toBe(false)
  })

  it('测试成功后修改请求地址 → 验证状态重置为未验证（状态行消失、提示重新出现、按钮回「测试连接」）', async () => {
    api.testKnowledgeSource.mockResolvedValue({ verifyStatus: 'SUCCESS', verifiedAt: null, verifyError: null, latencyMs: 90 })
    await mountApiReady()
    clickBtn('测试连接')
    await flushAll(10)
    expect(drawer().querySelector('.ksrc-verify')).toBeTruthy() // 前提：已测试成功

    formModel().api.url = 'https://rag.example.com/v2/search'
    await flushAll(6)

    expect(drawer().querySelector('.ksrc-verify')).toBeNull()
    expect(drawer().querySelector('.ksrc-test').textContent).toContain('修改连接配置后需要重新测试')
    expect(btn('测试连接')).toBeTruthy()
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · MCP 数据源（md §七）', () => {
  async function mountMcp() {
    await mountEditor()
    await pickType('MCP')
  }
  const toolBoxes = () => [...drawer().querySelectorAll('.ksrc-card .el-checkbox')]

  it('切到 MCP：传输方式三选项（streamable-http / stdio / sse）默认 streamable-http，鉴权默认无鉴权且不展示凭证，超时默认 10000，结果数组路径带示例值', async () => {
    await mountMcp()

    expect(formModel().mcp.transport).toBe('streamable-http')
    expect(formModel().mcp.authType).toBe('none')
    expect(formModel().mcp.timeoutMs).toBe(10000)
    expect(formModel().mcp.resultArrayPath).toBe('$.content[0].items[*]')
    expect(itemByLabel('MCP 服务地址').querySelector('input').getAttribute('maxlength')).toBe('500')
    expect(itemByLabel('Bearer Token')).toBeUndefined()
    expect(itemByLabel('Header 名')).toBeUndefined()
    expect(drawer().textContent).toContain('单位毫秒，默认 10000，范围 1000～120000')
    expect(drawer().textContent).toContain('请先完成连接测试以获取工具列表')
    // 响应字段预设 title / content / sourceName，接口返回字段名默认留空
    expect([...drawer().querySelectorAll('.sme-fixed-name')].map((c) => c.textContent.trim())).toEqual(['title', 'content', 'sourceName'])
  })

  it('未填服务地址、未选工具点【保存】：红字「请填写 MCP 服务地址」「至少选择一个检索工具」「请填写…」类映射错误，不调 create', async () => {
    await mountMcp()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '法规库 MCP')
    await flushAll(4)

    await save()

    expect(errorTexts()).toContain('请填写 MCP 服务地址')
    expect(errorTexts()).toContain('至少选择一个检索工具')
    expect(errorTexts()).toContain('响应字段：title 需填写接口返回字段名')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()

    formModel().mcp.endpoint = 'ws://mcp.example.com'
    await flushAll(4)
    await save()
    expect(errorTexts()).toContain('需以 http:// 或 https:// 开头')
  })

  it('API Key 鉴权：Header 名必填且仅字母数字连字符，访问凭证必填', async () => {
    await mountMcp()
    formModel().mcp.endpoint = 'https://mcp.example.com/mcp'
    formModel().mcp.authType = 'header'
    await flushAll(6)
    expect(itemByLabel('访问凭证').querySelector('input').type).toBe('password')

    await save()
    expect(errorTexts()).toContain('Header 名必填')
    expect(errorTexts()).toContain('访问凭证必填')

    typeInto(itemByLabel('Header 名').querySelector('input'), 'X_Api Key')
    await flushAll(4)
    await save()
    expect(errorTexts()).toContain('仅允许字母、数字和连字符（最多 128 个字符）')
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
  })

  it('stdio：展示 Command（npx / uvx / node / python3 / docker，默认 npx）与 Arguments、环境变量，不展示服务地址', async () => {
    await mountMcp()
    formModel().mcp.transport = 'stdio'
    await flushAll(6)

    expect(itemByLabel('MCP 服务地址')).toBeUndefined()
    expect(itemByLabel('鉴权方式')).toBeUndefined()
    expect(formModel().mcp.command).toBe('npx')
    expect(itemByLabel('Command').classList.contains('is-required')).toBe(true)
    expect(itemByLabel('Arguments').textContent).toContain('选填，每行一个参数')
    expect(drawer().textContent).toContain('环境变量')
  })

  it('测试成功返回工具清单：以复选框列出、展示「连接正常 · 2 个工具」；勾选工具并补齐映射后保存，载荷 tools / 结果数组路径 / 凭证正确', async () => {
    api.testKnowledgeSource.mockResolvedValue({
      verifyStatus: 'SUCCESS',
      verifiedAt: null,
      verifyError: null,
      latencyMs: 120,
      tools: ['search_documents', 'search_chunks'],
      toolCount: 2
    })
    api.createKnowledgeSource.mockResolvedValue(undefined)
    await mountMcp()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '法规库 MCP')
    formModel().mcp.endpoint = 'https://mcp.example.com/mcp'
    formModel().mcp.authType = 'bearer'
    await flushAll(6)
    typeInto(itemByLabel('Bearer Token').querySelector('input'), 'mcp-tok')
    await flushAll(4)

    clickBtn('测试连接')
    await flushAll(10)

    expect(api.testKnowledgeSource.mock.calls[0][0]).toBe('MCP')
    expect(api.testKnowledgeSource.mock.calls[0][1]).toMatchObject({ authValue: 'mcp-tok', config: { transport: 'streamable-http', endpoint: 'https://mcp.example.com/mcp', authType: 'bearer' } })
    expect(toolBoxes().map((b) => b.textContent.trim())).toEqual(['search_documents', 'search_chunks'])
    expect(drawer().querySelector('.ksrc-verify.ok').textContent).toContain('连接正常 · 2 个工具')

    toolBoxes()[0].querySelector('input').click()
    const respRows = [...drawer().querySelectorAll('.sme-resp-row')]
    typeInto(respRows[0].querySelectorAll('input')[0], 'meta.title')
    typeInto(respRows[1].querySelectorAll('input')[0], 'text')
    await flushAll(6)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    const payload = api.createKnowledgeSource.mock.calls[0][0]
    expect(payload.authValue).toBe('mcp-tok')
    expect(payload.config).toMatchObject({
      transport: 'streamable-http',
      endpoint: 'https://mcp.example.com/mcp',
      authType: 'bearer',
      tools: ['search_documents'],
      resultArrayPath: '$.content[0].items[*]',
      timeoutMs: 10000,
      envVars: []
    })
    expect(payload.config.responseMap.map((r) => [r.name, r.sourceField])).toEqual([
      ['title', 'meta.title'],
      ['content', 'text'],
      ['sourceName', '']
    ])
    expect(payload.config.requestMap.map((r) => r.name)).toEqual(['query', 'topK']) // MCP 不注入 API 的示例组
  })

  it('重新测试返回的清单不再含已勾选工具 → 该工具被移出已选（以最新清单为准）', async () => {
    api.testKnowledgeSource.mockResolvedValueOnce({ verifyStatus: 'SUCCESS', tools: ['a_tool', 'b_tool'], toolCount: 2 })
    await mountMcp()
    formModel().mcp.endpoint = 'https://mcp.example.com/mcp'
    await flushAll(4)
    clickBtn('测试连接')
    await flushAll(10)
    toolBoxes()[0].querySelector('input').click()
    await flushAll(4)
    expect(toolBoxes()[0].classList.contains('is-checked')).toBe(true) // 前提：已勾 a_tool
    // 改了工具选择 = 改连接配置 → 验证状态回未验证（md §七.7）
    expect(drawer().querySelector('.ksrc-verify')).toBeNull()
    expect(btn('测试连接')).toBeTruthy()

    api.testKnowledgeSource.mockResolvedValueOnce({ verifyStatus: 'SUCCESS', tools: ['b_tool'], toolCount: 1 })
    clickBtn('测试连接')
    await flushAll(10)

    expect(toolBoxes().map((b) => b.textContent.trim())).toEqual(['b_tool'])
    expect(toolBoxes()[0].classList.contains('is-checked')).toBe(false)
  })

  it('stdio 保存：Arguments 按行拆分去空行、Command 随载荷下发', async () => {
    api.createKnowledgeSource.mockResolvedValue(undefined)
    api.testKnowledgeSource.mockResolvedValue({ verifyStatus: 'SUCCESS', tools: ['search_documents'], toolCount: 1 })
    await mountMcp()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '本地 MCP')
    formModel().mcp.transport = 'stdio'
    formModel().mcp.command = 'uvx'
    await flushAll(6)
    typeInto(itemByLabel('Arguments').querySelector('textarea'), '-y\n\n  @mcp/server-foo  \n')
    await flushAll(4)
    clickBtn('测试连接')
    await flushAll(10)
    toolBoxes()[0].querySelector('input').click()
    const respRows = [...drawer().querySelectorAll('.sme-resp-row')]
    typeInto(respRows[0].querySelectorAll('input')[0], 'title')
    typeInto(respRows[1].querySelectorAll('input')[0], 'content')
    await flushAll(6)

    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1)
    expect(api.createKnowledgeSource.mock.calls[0][0].config).toMatchObject({
      transport: 'stdio',
      command: 'uvx',
      args: ['-y', '@mcp/server-foo'],
      tools: ['search_documents']
    })
  })

  it.fails('切到 stdio 后保存，载荷不应再带 streamable-http 下填过的服务地址与 Bearer 凭证（疑似缺陷：切换传输方式不清空 http 侧字段，凭证仍经 authValue 下发；md §七.2.3「切换到 stdio 则按各自字段清空」）', async () => {
    api.createKnowledgeSource.mockResolvedValue(undefined)
    api.testKnowledgeSource.mockResolvedValue({ verifyStatus: 'SUCCESS', tools: ['search_documents'], toolCount: 1 })
    await mountMcp()
    typeInto(itemByLabel('数据源名称').querySelector('input'), '本地 MCP')
    formModel().mcp.endpoint = 'https://mcp.example.com/mcp'
    formModel().mcp.authType = 'bearer'
    await flushAll(6)
    typeInto(itemByLabel('Bearer Token').querySelector('input'), 'secret-tok')
    await flushAll(4)

    formModel().mcp.transport = 'stdio'
    await flushAll(6)
    clickBtn('测试连接')
    await flushAll(10)
    toolBoxes()[0].querySelector('input').click()
    const respRows = [...drawer().querySelectorAll('.sme-resp-row')]
    typeInto(respRows[0].querySelectorAll('input')[0], 'title')
    typeInto(respRows[1].querySelectorAll('input')[0], 'content')
    await flushAll(6)
    await save()

    expect(api.createKnowledgeSource).toHaveBeenCalledTimes(1) // 前提：stdio 保存放行
    const payload = api.createKnowledgeSource.mock.calls[0][0]
    expect(payload.authValue).toBeNull()
    expect(payload.config.endpoint).toBe('')
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · 编辑回填与敏感信息遮罩（md §四.3 / §八.2）', () => {
  const apiDetail = (over = {}) => ({
    id: 'ks_api',
    sourceType: 'API',
    name: '国标检索',
    status: 'ENABLED',
    verifyStatus: 'SUCCESS',
    verifiedAt: null,
    verifyError: null,
    referencedBy: [],
    config: {
      url: 'https://rag.example.com/search',
      method: 'PUT',
      authType: 'BEARER',
      bearerMasked: 'tok-****89',
      timeoutMs: 12000,
      requestMap: [
        { name: 'query', type: 'string', required: true, clientField: 'query', preset: true },
        { name: 'topK', type: 'integer', clientField: 'topK', preset: true },
        { name: 'lang', type: 'string', defaultValue: 'zh' }
      ],
      responseMap: [
        { name: 'content', sourceField: 'text', type: 'string', preset: true },
        { name: 'source', sourceField: 'doc', type: 'string', preset: true },
        { name: 'score', sourceField: 'sim', type: 'number', preset: true }
      ]
    },
    ...over
  })

  it('编辑 API 源：按 id 拉详情回填，标题「编辑数据源」、类型不可改；Bearer 只显示掩码，留空保存 = 保留原值（authValue 为 null），调 updateKnowledgeSource', async () => {
    const ok = vi.spyOn(ElMessage, 'success')
    api.getKnowledgeSource.mockResolvedValue(apiDetail())
    api.updateKnowledgeSource.mockResolvedValue(apiDetail())
    await mountEditor({ sourceId: 'ks_api' })

    expect(api.getKnowledgeSource).toHaveBeenCalledWith('ks_api')
    expect(headerText()).toBe('编辑数据源')
    expect([...itemByLabel('类型').querySelectorAll('.el-radio')].every((r) => r.classList.contains('is-disabled'))).toBe(true)
    expect(formModel().name).toBe('国标检索')
    expect(formModel().api).toMatchObject({ url: 'https://rag.example.com/search', method: 'PUT', authType: 'BEARER', timeoutMs: 12000 })
    const bearer = itemByLabel('Bearer Token')
    expect(bearer.textContent).toContain('当前：tok-****89（留空保持不变，重填覆盖）')
    expect(bearer.querySelector('input').value).toBe('')
    expect(bearer.querySelector('input').placeholder).toBe('已配置（留空保持不变）')
    // 编辑已有源不注入示例组，回填已存映射
    const inputs = [...drawer().querySelectorAll('input')].map((i) => i.value)
    expect(inputs).toContain('lang')
    expect(inputs).not.toContain('filters')

    await save()

    expect(api.updateKnowledgeSource).toHaveBeenCalledTimes(1)
    const [id, payload] = api.updateKnowledgeSource.mock.calls[0]
    expect(id).toBe('ks_api')
    expect(payload.authValue).toBeNull()
    expect(payload.config.responseMap.map((r) => r.sourceField)).toEqual(['text', 'doc', 'sim'])
    expect(api.createKnowledgeSource).not.toHaveBeenCalled()
    expect(ok).toHaveBeenCalledWith('已保存')
  })

  it('编辑态把鉴权从 Bearer 切到 API KEY 再切回 Bearer（类型一致）仍可留空保留；改为无鉴权后不再展示掩码', async () => {
    api.getKnowledgeSource.mockResolvedValue(apiDetail())
    await mountEditor({ sourceId: 'ks_api' })

    formModel().api.authType = 'NONE'
    await flushAll(6)
    expect(drawer().textContent).not.toContain('tok-****89')

    formModel().api.authType = 'BEARER'
    await flushAll(6)
    expect(itemByLabel('Bearer Token').textContent).toContain('当前：tok-****89')
  })

  it.fails('编辑打开一个最近测试成功的 API 源（未做任何修改）：应展示「连接正常」验证结果，而不是「修改连接配置后需要重新测试」（疑似缺陷：回填改变 connSig，watch 在 loading 已复位后才触发，把刚回填的 SUCCESS 重置为未验证；md §六.4「成功后记录最近验证结果与时间；修改请求地址、鉴权或映射后，验证状态重置为未验证」——未修改不应重置）', async () => {
    api.getKnowledgeSource.mockResolvedValue(apiDetail())
    await mountEditor({ sourceId: 'ks_api' })
    expect(formModel().api.url).toBe('https://rag.example.com/search') // 前提：已回填
    expect(drawer().querySelector('.ksrc-test').textContent).toContain('连接正常')
    expect(btn('重新测试')).toBeTruthy()
  })

  it('查看态打开最近测试成功的源：展示「连接正常」验证结果', async () => {
    api.getKnowledgeSource.mockResolvedValue(apiDetail())
    await mountEditor({ sourceId: 'ks_api', mode: 'view' })
    expect(drawer().querySelector('.ksrc-verify.ok').textContent).toContain('连接正常')
  })

  it('被知识库引用：「停用」置灰并提示引用的知识库名（md §三.3.2 / §四.3）', async () => {
    api.getKnowledgeSource.mockResolvedValue(apiDetail({ referencedBy: [{ id: 'kb1', name: '产品知识库' }, { id: 'kb2', name: '售后库' }] }))
    await mountEditor({ sourceId: 'ks_api' })

    const radios = [...itemByLabel('状态').querySelectorAll('.el-radio')]
    expect(radios.find((r) => r.textContent.trim() === '停用').classList.contains('is-disabled')).toBe(true)
    expect(radios.find((r) => r.textContent.trim() === '启用').classList.contains('is-disabled')).toBe(false)
    expect(itemByLabel('状态').textContent).toContain('正被知识库引用（产品知识库、售后库），需先解除引用才能停用')
  })

  it('编辑 MCP 源：回填传输方式 / 鉴权掩码 / 已选工具（勾选态）/ 结果数组路径；未验证源不展示状态行', async () => {
    api.getKnowledgeSource.mockResolvedValue({
      id: 'ks_mcp',
      sourceType: 'MCP',
      name: '法规库 MCP',
      status: 'DISABLED',
      verifyStatus: 'UNVERIFIED',
      config: {
        transport: 'streamable-http',
        endpoint: 'https://mcp.example.com/mcp',
        authType: 'header',
        authHeaderName: 'X-Api-Key',
        credentialMasked: 'ab****yz',
        tools: ['search_documents'],
        resultArrayPath: '$.data[*]',
        timeoutMs: 30000,
        responseMap: [
          { name: 'title', sourceField: 't', preset: true },
          { name: 'content', sourceField: 'c', preset: true },
          { name: 'sourceName', sourceField: '', preset: true }
        ]
      }
    })
    await mountEditor({ sourceId: 'ks_mcp' })

    expect(formModel().status).toBe('DISABLED')
    expect(formModel().mcp).toMatchObject({ transport: 'streamable-http', authType: 'header', authHeaderName: 'X-Api-Key', timeoutMs: 30000, resultArrayPath: '$.data[*]' })
    expect(itemByLabel('访问凭证').textContent).toContain('当前：ab****yz')
    const box = [...drawer().querySelectorAll('.ksrc-card .el-checkbox')].find((b) => b.textContent.trim() === 'search_documents')
    expect(box.classList.contains('is-checked')).toBe(true)
    expect(drawer().querySelector('.ksrc-verify')).toBeNull()
    expect(drawer().querySelector('.ksrc-test').textContent).toContain('修改连接配置后需要重新测试')
  })

  it('编辑上传源更换向量模型：保存前二次确认「更换后需全量重建索引…」，点取消不保存；确认后才调 update', async () => {
    api.getKnowledgeSource.mockResolvedValue({
      id: 'ks_up',
      sourceType: 'UPLOAD',
      name: '产品资料',
      status: 'ENABLED',
      config: { docKind: 'DOC', embeddingModelId: 'emb_small', retrieval: 'HYBRID', topK: 5 }
    })
    api.updateKnowledgeSource.mockResolvedValue(undefined)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    await mountEditor({ sourceId: 'ks_up' })
    expect(formModel().embeddingModelId).toBe('emb_small')
    expect(drawer().textContent).toContain('更换后需全量重建索引')
    formModel().embeddingModelId = 'emb_bge'
    await flushAll(4)

    confirm.mockRejectedValueOnce('cancel')
    await save()
    expect(confirm).toHaveBeenCalledWith('更换后需全量重建索引，已有文档将重新处理。确认更换向量模型？', '更换向量模型', expect.objectContaining({ confirmButtonText: '确认更换' }))
    expect(api.updateKnowledgeSource).not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce('confirm')
    await save()
    expect(api.updateKnowledgeSource).toHaveBeenCalledTimes(1)
    expect(api.updateKnowledgeSource.mock.calls[0][1].config.embeddingModelId).toBe('emb_bge')
  })

  it('编辑上传源未换向量模型：不弹二次确认直接保存', async () => {
    api.getKnowledgeSource.mockResolvedValue({ id: 'ks_up', sourceType: 'UPLOAD', name: '产品资料', status: 'ENABLED', config: { embeddingModelId: 'emb_small' } })
    api.updateKnowledgeSource.mockResolvedValue(undefined)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const ok = vi.spyOn(ElMessage, 'success')
    await mountEditor({ sourceId: 'ks_up' })

    await save()

    expect(confirm).not.toHaveBeenCalled()
    expect(api.updateKnowledgeSource).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledWith('已保存') // 编辑上传源不再提示去「文档管理」
  })

  it('详情加载失败：展示失败原因与【重试】，【保存】不可点；点【重试】重新拉详情', async () => {
    api.getKnowledgeSource.mockRejectedValueOnce(new Error('数据源不存在'))
    await mountEditor({ sourceId: 'ks_gone' })

    expect(drawer().querySelector('form.el-form')).toBeNull()
    expect(drawer().textContent).toContain('数据源不存在')
    expect(btn('保存').disabled).toBe(true)

    api.getKnowledgeSource.mockResolvedValueOnce(apiDetail())
    clickBtn('重试')
    await flushAll(10)
    expect(api.getKnowledgeSource).toHaveBeenCalledTimes(2)
    expect(formModel().name).toBe('国标检索')
  })
})

/* ====================================================================== */
describe('KnowledgeSourceEditor · 查看态只读', () => {
  it('mode=view：标题「查看数据源」，整表禁用，底部仅【关闭】，不展示「需要重新测试」提示', async () => {
    api.getKnowledgeSource.mockResolvedValue({
      id: 'ks_api',
      sourceType: 'API',
      name: '国标检索',
      status: 'ENABLED',
      verifyStatus: 'UNVERIFIED',
      config: { url: 'https://rag.example.com/search', method: 'POST', authType: 'NONE', timeoutMs: 8000 }
    })
    await mountEditor({ sourceId: 'ks_api', mode: 'view' })

    expect(headerText()).toBe('查看数据源')
    const footBtns = [...drawer().querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())
    expect(footBtns).toEqual(['关闭'])
    expect(itemByLabel('数据源名称').querySelector('input').disabled).toBe(true)
    expect(itemByLabel('检索地址').querySelector('input').disabled).toBe(true)
    expect(drawer().textContent).not.toContain('修改连接配置后需要重新测试')

    clickBtn('关闭')
    await flushAll(4)
    expect(onVisible).toHaveBeenCalledWith(false)
    expect(api.updateKnowledgeSource).not.toHaveBeenCalled()
  })

  it('mode=view 但无 sourceId（新建）：不进只读，仍是新建表单', async () => {
    await mountEditor({ mode: 'view' })
    expect(headerText()).toBe('新建数据源')
    expect(btn('保存')).toBeTruthy()
  })
})
