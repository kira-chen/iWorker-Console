// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * 连接器三编辑器（MCP / API / 业务系统）的原型骨架 —— 2026-09-09 原型复刻批次 3A。
 *
 * 只盯**静态布局与控件名称/文案**（负责人 2026-09-08 口径），逻辑与校验各自的既有单测已覆盖：
 *  - S1 分区卡片化：各分区是 `.section-card`；「被技能引用」保持非卡片 `.reference-section`；
 *    时间行走 `.page-time`（原型 L47 / L69 / L70）。
 *  - S3 图标行：预览块 + 并排【从图标库选择】【上传图标】（IconField，原型 `.compact-icon-row`）。
 *  - M4 / B1 / A3 示例问题并入「基本信息」卡作卡内子分区 `.connector-basic-subsection`
 *    （原型 L1137-1147 的 MutationObserver 最终态）。
 *  - M5 stdio Env：标题行右侧【＋ 添加变量】、表头「变量名 / 描述（客户端可见）/ 填写方式 / 平台值」、
 *    空态「暂无环境变量」（原型 connFields L180 / envRowsHtml L178）。
 *  - M6 测试连接结果：原型 `.result` 单行提示框（成功绿 / 失败红），文案逐字。
 *  - A3 基本信息：名称 ｜ 所属服务提供系统 同行；「状态」启用/停用 radio 已删（md 与原型均无）；
 *    图标与示例问题按 md 保留（Q101 / Q102 负责人已确认以 md 为准，原型最终层的删除属原型缺陷）。
 *  - A4 鉴权：客户端填写说明常显、参数值密码态、Bearer placeholder 照原型 L3892。
 *  - A5 请求参数 / 响应字段：一张表一份表头，子字段是同表缩进行，父行带【＋子字段】。
 *  - B2 连接方式 ｜ 登录地址 同行；B3 业务页展开按钮带折叠箭头 caret。
 *
 * 跳过并记录（本批不动，理由见分路明细 D-连接器与模型）：
 *  - M3 / D1 分页形态：全站已统一（批次 1 · A7），代码 = 现行口径；
 *  - A6 抽屉顶部提示行：md §三.1 要求、原型删除 —— 按 md 保留现状（差异 Q114 待裁）；
 *  - D4 验证按钮三态：md §5.2「仅编辑态展示」、原型三态可见 —— 按 md。
 */

/* ---------------- 共用桩 ---------------- */

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const box = { confirm: vi.fn(), prompt: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: box }))

vi.mock('vue-router', () => ({ useRouter: () => ({ resolve: () => ({ href: '/x' }) }) }))

// 图标行：桩 IconField，露出两个按钮文案与 readonly，免把图标库/上传/裁剪链路拖进来
vi.mock('@/components/common/IconField.vue', () => ({
  default: {
    name: 'IconField',
    props: ['icon', 'name', 'readonly', 'placeholder', 'size'],
    emits: ['pick'],
    template:
      '<div class="icon-field-stub" :data-icon="icon" :data-readonly="readonly ? \'1\' : \'0\'">' +
      '<button class="icon-lib">从图标库选择</button><button class="icon-upload">上传图标</button></div>'
  }
}))

const adminApi = {
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  getMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn(),
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
  listBizSystemSkills: vi.fn(() => Promise.resolve([])),
  createBizSystemOwnedSkill: vi.fn(),
  deleteBizSystemOwnedSkill: vi.fn()
}
vi.mock('@/api/admin', () => adminApi)

const apiConnector = {
  createApi: vi.fn(),
  updateApi: vi.fn(),
  getApi: vi.fn(),
  listProviderSystems: vi.fn(() => Promise.resolve({ list: [{ id: 1, name: '财务系统' }] }))
}
vi.mock('@/api/apiConnector', () => apiConnector)

const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot /><div><slot name="footer" /></div></div>'
  },
  'el-dialog': {
    props: ['modelValue'],
    template: '<div class="el-dialog" v-if="modelValue"><slot /></div>'
  },
  'el-form': { props: ['disabled'], template: '<form class="el-form"><slot /></form>' },
  'el-form-item': {
    props: ['label', 'error', 'required'],
    template:
      '<div class="el-form-item" :data-label="label"><span class="fi-label"><slot name="label" />{{ label }}</span><slot /></div>'
  },
  'el-input': {
    props: ['modelValue', 'placeholder', 'type', 'showPassword', 'disabled'],
    emits: ['update:modelValue', 'input'],
    template:
      '<span class="el-input-wrap"><slot name="prepend" /><input class="el-input" :value="modelValue"' +
      ' :placeholder="placeholder" :type="type || \'text\'" :disabled="disabled"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value)" /></span>'
  },
  'el-input-number': { props: ['modelValue'], template: '<input class="el-input-number" />' },
  'el-select': { props: ['modelValue'], template: '<div class="el-select"><slot /></div>' },
  'el-option': { props: ['label', 'value'], template: '<div class="el-option" :data-value="value" />' },
  'el-radio-group': { props: ['modelValue'], template: '<div class="radio-group"><slot /></div>' },
  'el-radio': { props: ['value'], template: '<label class="el-radio" :data-value="value"><slot /></label>' },
  'el-checkbox': {
    props: ['modelValue'],
    template: '<label class="el-checkbox-wrap"><input type="checkbox" class="el-checkbox" /><slot /></label>'
  },
  'el-button': {
    props: ['type', 'link', 'loading', 'disabled', 'size', 'plain'],
    emits: ['click'],
    template:
      '<button class="el-button" :data-type="type" :disabled="disabled"' +
      ' @click="!disabled && $emit(\'click\')"><slot /></button>'
  },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-alert': { props: ['title', 'type'], template: '<div class="el-alert" :data-type="type">{{ title }}</div>' },
  'el-skeleton': { template: '<div class="el-skeleton" />' },
  'el-empty': { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' },
  'el-popconfirm': {
    emits: ['confirm'],
    template: '<span class="el-popconfirm" @click="$emit(\'confirm\')"><slot name="reference" /></span>'
  },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  Delete: { template: '<i />' },
  Connection: { template: '<i />' },
  Download: { template: '<i />' }
}

let app, container
async function mountEditor(path, props = {}) {
  const { default: Editor } = await import(path)
  container = document.createElement('div')
  document.body.appendChild(container)
  const visible = ref(false)
  app = createApp({ render: () => h(Editor, { visible: visible.value, ...props }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  visible.value = true
  // 详情加载是异步的，多刷几轮微任务
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await Promise.resolve()
  }
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

const titlesOf = (el) => [...el.querySelectorAll('.section-card > .section-title, .section-card > .section-head > .section-title')].map((t) => t.textContent.replace(/\s+/g, ' ').trim())
const cardOfTitle = (el, text) =>
  [...el.querySelectorAll('.section-card')].find((c) => c.textContent.includes(text))

/* ---------------- MCP ---------------- */

describe('McpEditor · 原型骨架（S1 / S3 / M4 / M5 / M6）', () => {
  const MCP = '@/components/admin/McpEditor.vue'

  it('S1 分区卡：基本信息 / 连接与鉴权 / 工具清单 都是 .section-card', async () => {
    const el = await mountEditor(MCP)
    const titles = titlesOf(el)
    expect(titles.some((t) => t.startsWith('基本信息'))).toBe(true)
    expect(titles.some((t) => t.startsWith('连接与鉴权'))).toBe(true)
    expect(titles.some((t) => t.startsWith('工具清单'))).toBe(true)
  })

  it('S3 图标行：预览 + 并排【从图标库选择】【上传图标】，不再是 popover 头像块', async () => {
    const el = await mountEditor(MCP)
    const field = el.querySelector('.icon-field-stub')
    expect(field).not.toBeNull()
    expect(field.querySelector('.icon-lib').textContent).toBe('从图标库选择')
    expect(field.querySelector('.icon-upload').textContent).toBe('上传图标')
  })

  it('S3 查看态：图标两按钮置灰（readonly 透传给 IconField）', async () => {
    const el = await mountEditor(MCP, { readonly: true })
    expect(el.querySelector('.icon-field-stub').dataset.readonly).toBe('1')
  })

  it('M4 示例问题在「基本信息」卡内作子分区，不再是抽屉末尾独立分区', async () => {
    const el = await mountEditor(MCP)
    const sub = el.querySelector('.connector-basic-subsection')
    expect(sub).not.toBeNull()
    expect(sub.textContent).toContain('示例问题')
    expect(sub.textContent).toContain('必填，固定 3 条')
    // 子分区落在基本信息卡里
    expect(cardOfTitle(el, '基本信息').contains(sub)).toBe(true)
    // 不再有以「示例问题」开头的独立分区卡
    expect(titlesOf(el).some((t) => t.startsWith('示例问题'))).toBe(false)
  })

  it('S1 被技能引用保持非卡片 .reference-section（原型 L69），时间行走 .page-time', async () => {
    adminApi.getMcp.mockResolvedValue({
      name: 'CRM MCP',
      icon: '◎',
      description: '描述',
      transport: 'streamable-http',
      endpoint: 'https://x/mcp',
      exampleQuestions: ['', '', ''],
      tools: [],
      referencedBySkills: [],
      createdAt: '2026-08-18T09:30:00Z'
    })
    const el = await mountEditor(MCP, { mcpId: 'mcp_1' })
    const ref = el.querySelector('.reference-section')
    expect(ref).not.toBeNull()
    expect(ref.textContent).toContain('被技能引用')
    expect(ref.classList.contains('section-card')).toBe(false)
    expect(el.querySelector('.page-time')).not.toBeNull()
    expect(titlesOf(el).some((t) => t.startsWith('被技能引用'))).toBe(false)
  })

  it('M5 stdio Env：标题行右侧【＋ 添加变量】+ 四列表头 + 空态「暂无环境变量」', async () => {
    adminApi.getMcp.mockResolvedValue({
      name: 'stdio MCP',
      icon: '◎',
      description: '描述',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: [],
      exampleQuestions: ['', '', ''],
      tools: [],
      referencedBySkills: []
    })
    const el = await mountEditor(MCP, { mcpId: 'mcp_2' })
    // 标题行：左 Env label + hint / 右【＋ 添加变量】（原型 .mcp-env-title）
    const envTitle = el.querySelector('.md-env-title')
    expect(envTitle).not.toBeNull()
    expect(envTitle.querySelector('.md-env-label').textContent).toBe('Env')
    expect(envTitle.querySelector('.md-env-add').textContent.trim()).toBe('＋ 添加变量')
    // 表头四列（原型 .mcp-env-head），无行也在
    const head = el.querySelector('.pr-row-head')
    expect(head).not.toBeNull()
    const cols = [...head.children].map((c) => c.textContent.trim()).filter(Boolean)
    expect(cols).toEqual(['变量名', '描述（客户端可见）', '填写方式', '平台值'])
    // 空态
    expect(el.querySelector('.pr-empty').textContent).toBe('暂无环境变量')
    // 添加按钮不在表底
    expect(el.querySelector('.pr-add')).toBeNull()
  })

  it('M5【＋ 添加变量】点一下就多一行卡片（宿主直调组件 addRow）', async () => {
    adminApi.getMcp.mockResolvedValue({
      name: 'stdio MCP',
      icon: '◎',
      description: '描述',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: [],
      exampleQuestions: ['', '', ''],
      tools: [],
      referencedBySkills: []
    })
    const el = await mountEditor(MCP, { mcpId: 'mcp_2' })
    expect(el.querySelectorAll('.pr-row:not(.pr-row-head)').length).toBe(0)
    el.querySelector('.md-env-add').click()
    await nextTick()
    const rows = el.querySelectorAll('.pr-row:not(.pr-row-head)')
    expect(rows.length).toBe(1)
    expect(rows[0].classList.contains('is-card')).toBe(true) // 原型 .mcp-env-card
    expect(el.querySelector('.pr-empty')).toBeNull()
  })

  it('M6 测试连接结果：原型 .result 单行提示框，成功文案「握手成功 · 协议 … · Server … · 延迟 … ms」', async () => {
    adminApi.testMcpConn.mockResolvedValue({
      ok: true,
      protocolVersion: '2025-03-26',
      serverVersion: '1.4.2',
      latencyMs: 86
    })
    const el = await mountEditor(MCP)
    const btn = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.includes('测试连接'))
    btn.click()
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await Promise.resolve()
    }
    const result = el.querySelector('.md-conn-result')
    expect(result).not.toBeNull()
    expect(result.classList.contains('is-success')).toBe(true)
    expect(result.textContent.trim()).toBe('握手成功 · 协议 2025-03-26 · Server 1.4.2 · 延迟 86 ms')
    // 不再是双 el-alert 形态
    expect(result.querySelector('.el-alert')).toBeNull()
  })

  it('M6 失败：红框 + 原型文案「连接失败 · 请检查接入方式、地址或鉴权配置」，后端 failReason 附在其后', async () => {
    adminApi.testMcpConn.mockResolvedValue({ ok: false, failReason: '502 Bad Gateway' })
    const el = await mountEditor(MCP)
    const btn = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.includes('测试连接'))
    btn.click()
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await Promise.resolve()
    }
    const result = el.querySelector('.md-conn-result')
    expect(result.classList.contains('is-error')).toBe(true)
    expect(result.textContent.trim()).toBe(
      '连接失败 · 请检查接入方式、地址或鉴权配置（502 Bad Gateway）'
    )
  })
})

/* ---------------- API ---------------- */

describe('ApiEditor · 原型骨架（S1 / S3 / A3 / A4）', () => {
  const API = '@/components/admin/ApiEditor.vue'

  it('S1 分区卡：基本信息 / 请求配置 / 鉴权配置 / 请求参数 / 响应字段', async () => {
    const el = await mountEditor(API)
    const titles = titlesOf(el)
    for (const t of ['基本信息', '请求配置', '鉴权配置', '请求参数', '响应字段']) {
      expect(titles.some((x) => x.startsWith(t))).toBe(true)
    }
  })

  it('A3 基本信息首行：名称 ｜ 所属服务提供系统 同行（原型最终态）', async () => {
    const el = await mountEditor(API)
    const firstRow = cardOfTitle(el, '基本信息').querySelector('.ad-row2')
    const labels = [...firstRow.querySelectorAll('.el-form-item')].map((f) => f.dataset.label)
    expect(labels).toEqual(['名称', '所属服务提供系统'])
  })

  // 2026-09-09 PRD 复核轮 · G4/A16 · Q338：本版 md（prd-API.md §三.4 L152）明确列出
  // 「启用 / 停用状态：必填，默认启用；停用后技能不再可引用该 API」，《各模块必填选填字段一览表》
  // 亦已补录 → 原 A3「删状态 radio」用例反转为「状态 radio 在基本信息卡内、默认启用」。
  it('A16 恢复「状态」启用/停用 radio（md §三.4 L152 必填、默认启用）', async () => {
    const el = await mountEditor(API)
    const basic = cardOfTitle(el, '基本信息')
    const item = [...basic.querySelectorAll('.el-form-item')].find((f) => f.dataset.label === '状态')
    expect(item).toBeTruthy()
    // 两项：启用 / 停用（stub 的 el-radio 把 value 落到 data-value）
    const radios = [...item.querySelectorAll('.el-radio')]
    expect(radios.map((r) => r.textContent.trim())).toEqual(['启用', '停用'])
    expect(radios.map((r) => r.dataset.value)).toEqual(['true', 'false'])
    // md L152 的「停用后技能不再可引用该 API」提示随控件一起给出
    expect(item.textContent).toContain('停用后技能不再可引用该 API')
  })

  it('A3 图标与示例问题按 md 保留（Q101/Q102 以 md 为准），示例问题在基本信息卡内', async () => {
    const el = await mountEditor(API)
    const basic = cardOfTitle(el, '基本信息')
    expect(basic.querySelector('.icon-field-stub')).not.toBeNull()
    const sub = basic.querySelector('.connector-basic-subsection')
    expect(sub).not.toBeNull()
    expect(sub.textContent).toContain('示例问题')
    expect(titlesOf(el).some((t) => t.startsWith('示例问题'))).toBe(false)
  })

  it('A6 核对：顶部提示行按 md 保留现状（原型无、代码亦无——差异 Q114 待裁）', async () => {
    const el = await mountEditor(API)
    expect(el.textContent).not.toContain('1 个 API 对应 1 个可被技能引用的工具')
  })

  it('A4 鉴权类型三选一，文案照原型 authMasterContent', async () => {
    const el = await mountEditor(API)
    const auth = cardOfTitle(el, '鉴权配置')
    const labels = [...auth.querySelectorAll('.el-radio')].map((r) => r.textContent.trim())
    expect(labels).toEqual(['不鉴权', 'API KEY', 'Bearer Token'])
  })

  it('A4 API KEY：客户端填写说明常显（不必先勾选）、参数值密码态、六列表头', async () => {
    apiConnector.getApi.mockResolvedValue({
      name: '报销查询',
      icon: '◎',
      description: '按单号查状态',
      providerSystemId: 1,
      url: 'https://x/api',
      method: 'GET',
      readWrite: 'read',
      authType: 'API_KEY',
      authConfig: { params: [{ in: 'HEADER', name: 'X-Api-Key', description: '', clientFill: false }] },
      exampleQuestions: ['', '', ''],
      referencedBySkills: []
    })
    const el = await mountEditor(API, { apiId: 'api_1' })
    const auth = cardOfTitle(el, '鉴权配置')
    // 常显说明（原型 .api-auth-add-note）：没有任何客户端填写行也在
    expect(auth.querySelector('.pr-cf-hint').textContent.trim()).toBe(
      '客户端填写参数由客户端收集，平台不存值'
    )
    // 六列表头（原型 .api-auth-grid-head）
    const cols = [...auth.querySelector('.pr-row-head').children]
      .map((c) => c.textContent.trim())
      .filter(Boolean)
    expect(cols).toEqual(['参数名', '描述（客户端可见）', '客户端填写', '位置', '参数值'])
    // 参数值密码态
    const valueInput = auth.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')[2]
    expect(valueInput.getAttribute('type')).toBe('password')
    // 添加按钮文案照原型
    expect([...auth.querySelectorAll('.el-button')].some((b) => b.textContent.trim() === '＋ 添加参数')).toBe(true)
  })

  it('A4 Bearer：placeholder 照原型 L3892「粘贴Bearer Token（不含Bearer前缀）」', async () => {
    apiConnector.getApi.mockResolvedValue({
      name: 'x',
      icon: '◎',
      description: 'd',
      providerSystemId: 1,
      url: 'https://x/api',
      method: 'GET',
      readWrite: 'read',
      authType: 'BEARER',
      authConfig: {},
      exampleQuestions: ['', '', ''],
      referencedBySkills: []
    })
    const el = await mountEditor(API, { apiId: 'api_2' })
    const auth = cardOfTitle(el, '鉴权配置')
    const input = auth.querySelector('input.el-input[type="password"]')
    expect(input.getAttribute('placeholder')).toBe('粘贴Bearer Token（不含Bearer前缀）')
  })

  it('A5 请求参数/响应字段：一张表一份表头，子字段是同表缩进行且父行带【＋子字段】', async () => {
    apiConnector.getApi.mockResolvedValue({
      name: 'x',
      icon: '◎',
      description: 'd',
      providerSystemId: 1,
      url: 'https://x/api',
      method: 'GET',
      readWrite: 'read',
      authType: 'NONE',
      requestSchema: {
        type: 'object',
        properties: {
          user: { type: 'object', properties: { id: { type: 'string' } } }
        }
      },
      exampleQuestions: ['', '', ''],
      referencedBySkills: []
    })
    const el = await mountEditor(API, { apiId: 'api_3' })
    const req = cardOfTitle(el, '请求参数')
    // 一份表头
    expect(req.querySelectorAll('.sfe-head').length).toBe(1)
    // 父行 + 缩进子行同在一张表里，不再有独立子字段块
    const rows = req.querySelectorAll('.sfe-row')
    expect(rows.length).toBe(2)
    expect(rows[0].classList.contains('is-child')).toBe(false)
    expect(rows[1].classList.contains('is-child')).toBe(true)
    expect(req.querySelector('.sfe-children')).toBeNull()
    // 对象行操作区带【＋子字段】（原型 L899）
    expect(rows[0].querySelector('.sfe-child-add').textContent.trim()).toBe('＋子字段')
    expect(rows[1].querySelector('.sfe-child-add')).toBeNull() // 子行是 string，不带
  })
})

/* ---------------- 业务系统 ---------------- */

describe('BizSystemEditor · 原型骨架（S1 / S3 / B1 / B2 / B3）', () => {
  const BIZ = '@/components/admin/BizSystemEditor.vue'

  it('S1 分区卡：基本信息 / 业务页；被技能引用与时间行走非卡片形态', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const titles = titlesOf(el)
    expect(titles.some((t) => t.startsWith('基本信息'))).toBe(true)
    expect(titles.some((t) => t.startsWith('业务页'))).toBe(true)
    // 被技能引用：非卡片（原型 .reference-section）
    const ref = el.querySelector('.reference-section')
    expect(ref).not.toBeNull()
    expect(ref.textContent).toContain('被技能引用')
    expect(ref.classList.contains('section-card')).toBe(false)
    // 时间行走原型 .page-time
    expect(el.querySelector('.page-time')).not.toBeNull()
  })

  it('B1 示例问题在「基本信息」卡内作子分区，文案照原型逐字', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const sub = cardOfTitle(el, '基本信息').querySelector('.connector-basic-subsection')
    expect(sub).not.toBeNull()
    expect(sub.textContent).toContain('必填，固定 3 条，用于帮助用户理解如何使用该连接器')
    expect(titlesOf(el).some((t) => t.startsWith('示例问题'))).toBe(false)
  })

  it('B2 连接方式 ｜ 登录地址 同行（原型 form-grid 两列）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const connRow = el.querySelector('.ad-conn-row')
    expect(connRow).not.toBeNull()
    const labels = [...connRow.querySelectorAll('.el-form-item')].map((f) => f.dataset.label)
    expect(labels).toEqual(['连接方式', '登录地址'])
  })

  it('B3 业务页展开按钮带折叠箭头，展开时旋转（is-open）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const toggle = el.querySelector('.ad-pages-toggle')
    const caret = toggle.querySelector('.ad-caret')
    expect(caret).not.toBeNull()
    expect(caret.textContent).toBe('▶')
    expect(caret.classList.contains('is-open')).toBe(false)
    toggle.click()
    await nextTick()
    expect(el.querySelector('.ad-caret').classList.contains('is-open')).toBe(true)
  })

  it('S3 图标行：预览 + 并排两个按钮', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const field = el.querySelector('.icon-field-stub')
    expect(field.querySelector('.icon-lib').textContent).toBe('从图标库选择')
    expect(field.querySelector('.icon-upload').textContent).toBe('上传图标')
  })
})
