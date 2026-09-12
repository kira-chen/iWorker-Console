// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * 连接器三编辑器（MCP / API / 业务系统）抽屉静态骨架与控件文案（原 connectorEditorsPrototypeLayout.test.js，
 * 2026-09-12 测试审计 T31 改名；原型已退场，对齐基准改为各模块 md）：
 *  - MCP：docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md §三.3（示例问题在基本信息卡内）/
 *    §三.4.2（stdio Environment 四列）/ §三.5（测试连接结果）；
 *  - API：…/API/prd-API.md §三.2（图标 / 示例问题 / 操作性质）/ §三.3（鉴权三选一、API KEY 五列、Bearer 前缀）/
 *    §三.4 L153（启用 / 停用状态，默认启用）/ §三.5（请求参数子字段）；
 *  - 业务系统：…/业务系统/prd-业务系统.md §三.2（示例问题 / 连接方式）/ §三.3 L105（【展开业务页】↔【收起业务页】）/ §三.6。
 *
 * 只盯静态布局与控件名称 / 文案；逻辑与校验各自的单测已覆盖（mcpEditor.test.js / ApiEditor.test.js / BizSystemEditorSkills.test.js）。
 * 纯原型视觉断言（is-card / caret ▶ / .pr-add 位置 / 「同行」包装类）已于 T6/T7 删除，jsdom 不验布局。
 * 已知代码缺陷不在此反转：K35（ApiEditor 抽屉顶部提示行 md §三.1 L102 要求存在，代码无）——A6 用例原样保留待修。
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

describe('McpEditor · 抽屉骨架（md MCP §三.3 / §三.4.2 / §三.5）', () => {
  const MCP = '@/components/admin/McpEditor.vue'

  it('分区卡：基本信息 / 连接与鉴权 / 工具清单 三块都在（md §三.3 / §三.4 / §三.6）', async () => {
    const el = await mountEditor(MCP)
    const titles = titlesOf(el)
    expect(titles.some((t) => t.startsWith('基本信息'))).toBe(true)
    expect(titles.some((t) => t.startsWith('连接与鉴权'))).toBe(true)
    expect(titles.some((t) => t.startsWith('工具清单'))).toBe(true)
  })

  it('图标行：预览 + 并排【从图标库选择】【上传图标】（md §三.3 图标统一规则）', async () => {
    const el = await mountEditor(MCP)
    const field = el.querySelector('.icon-field-stub')
    expect(field).not.toBeNull()
    expect(field.querySelector('.icon-lib').textContent).toBe('从图标库选择')
    expect(field.querySelector('.icon-upload').textContent).toBe('上传图标')
  })

  it('查看态：图标两入口置灰（readonly 透传给 IconField；md 图标统一规则「只读状态」）', async () => {
    const el = await mountEditor(MCP, { readonly: true })
    expect(el.querySelector('.icon-field-stub').dataset.readonly).toBe('1')
  })

  it('示例问题位于「基本信息」卡内作子分区，不是独立分区（md §三.3 L242「位于基本信息卡片内」）', async () => {
    const el = await mountEditor(MCP)
    const sub = el.querySelector('.connector-basic-subsection')
    expect(sub).not.toBeNull()
    expect(sub.textContent).toContain('示例问题')
    expect(sub.textContent).toContain('必填，固定 3 条')
    expect(cardOfTitle(el, '基本信息').contains(sub)).toBe(true)
    expect(titlesOf(el).some((t) => t.startsWith('示例问题'))).toBe(false)
  })

  it('编辑态底部：「被技能引用」区 + 创建时间行（md §三.7 引用与时间信息）', async () => {
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
    const refSec = el.querySelector('.reference-section')
    expect(refSec).not.toBeNull()
    expect(refSec.textContent).toContain('被技能引用')
    expect(el.textContent).toContain('创建时间')
  })

  it('stdio Environment：表格四列「变量名 / 描述 / 填写方式 / 平台值」（md §三.4.2 L278）', async () => {
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
    const head = el.querySelector('.pr-row-head')
    expect(head).not.toBeNull()
    const cols = [...head.children].map((c) => c.textContent.trim()).filter(Boolean)
    expect(cols).toHaveLength(4)
    expect(cols[0]).toBe('变量名')
    expect(cols[1]).toContain('描述')
    expect(cols[2]).toBe('填写方式')
    expect(cols[3]).toBe('平台值')
  })

  it('stdio Environment：【添加变量】点一下就多一行（md §三.4.2 L278 表格配置）', async () => {
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
    expect(el.querySelectorAll('.pr-row:not(.pr-row-head)').length).toBe(1)
  })

  it('测试连接成功：绿色结果「握手成功」+ 协议版本 / Server 版本 / 延迟（md §三.5 L294）', async () => {
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
  })

  it('测试连接失败：红色结果「连接失败 · 请检查接入方式、地址或鉴权配置」，后端 failReason 附在其后（代码现状；md §三.5 L295 两段式见审计 J17）', async () => {
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

describe('ApiEditor · 抽屉骨架（md API §三.2 ~ §三.5）', () => {
  const API = '@/components/admin/ApiEditor.vue'

  it('分区卡：基本信息 / 请求配置 / 鉴权配置 / 请求参数 / 响应字段（md §三.2 ~ §三.5 五段）', async () => {
    const el = await mountEditor(API)
    const titles = titlesOf(el)
    for (const t of ['基本信息', '请求配置', '鉴权配置', '请求参数', '响应字段']) {
      expect(titles.some((x) => x.startsWith(t))).toBe(true)
    }
  })

  it('基本信息卡有「状态」启用 / 停用 radio，附「停用后技能不再可引用该 API」提示（md §三.4 L153 必填、默认启用）', async () => {
    const el = await mountEditor(API)
    const basic = cardOfTitle(el, '基本信息')
    const item = [...basic.querySelectorAll('.el-form-item')].find((f) => f.dataset.label === '状态')
    expect(item).toBeTruthy()
    const radios = [...item.querySelectorAll('.el-radio')]
    expect(radios.map((r) => r.textContent.trim())).toEqual(['启用', '停用'])
    expect(radios.map((r) => r.dataset.value)).toEqual(['true', 'false'])
    expect(item.textContent).toContain('停用后技能不再可引用该 API')
  })

  it('图标行与示例问题都在基本信息卡内，示例问题不是独立分区（md §三.2 L108 / L120）', async () => {
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

  it('鉴权类型三选一：不鉴权 / API KEY / Bearer Token（md §三.3 L124）', async () => {
    const el = await mountEditor(API)
    const auth = cardOfTitle(el, '鉴权配置')
    const labels = [...auth.querySelectorAll('.el-radio')].map((r) => r.textContent.trim())
    expect(labels).toEqual(['不鉴权', 'API KEY', 'Bearer Token'])
  })

  it('API KEY：五列表头「参数名 / 描述（客户端可见）/ 客户端填写 / 位置 / 参数值」、参数值密码态、客户端填写说明常显、【＋ 添加参数】（md §三.3 L128-138）', async () => {
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
    // 说明常显：没有任何客户端填写行也在
    expect(auth.querySelector('.pr-cf-hint').textContent.trim()).toBe(
      '客户端填写参数由客户端收集，平台不存值'
    )
    const cols = [...auth.querySelector('.pr-row-head').children]
      .map((c) => c.textContent.trim())
      .filter(Boolean)
    expect(cols).toEqual(['参数名', '描述（客户端可见）', '客户端填写', '位置', '参数值'])
    // 参数值以密码形式输入（md L136）
    const valueInput = auth.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')[2]
    expect(valueInput.getAttribute('type')).toBe('password')
    expect([...auth.querySelectorAll('.el-button')].some((b) => b.textContent.trim() === '＋ 添加参数')).toBe(true)
  })

  it('Bearer Token：展示「Authorization: Bearer」前缀 + 密码输入框，占位「粘贴Bearer Token（不含Bearer前缀）」（md §三.3 L141/L145）', async () => {
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
    // 固定前置段展示完整请求头格式，避免误把 Bearer 前缀填进 Token
    expect(input.closest('.el-input-wrap').textContent).toContain('Authorization: Bearer')
  })

  it('请求参数：对象字段反解析出父行 + 子行两行，对象行带【＋子字段】（md §三.5 L163）', async () => {
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
    const rows = req.querySelectorAll('.sfe-row')
    expect(rows.length).toBe(2)
    expect(rows[0].querySelector('.sfe-child-add').textContent.trim()).toBe('＋子字段')
  })
})

/* ---------------- 业务系统 ---------------- */

describe('BizSystemEditor · 抽屉骨架（md 业务系统 §三.2 / §三.3 / §三.6）', () => {
  const BIZ = '@/components/admin/BizSystemEditor.vue'

  it('分区卡：基本信息 / 业务页；编辑态底部有「被技能引用」与时间行（md §三.6）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const titles = titlesOf(el)
    expect(titles.some((t) => t.startsWith('基本信息'))).toBe(true)
    expect(titles.some((t) => t.startsWith('业务页'))).toBe(true)
    const refSec = el.querySelector('.reference-section')
    expect(refSec).not.toBeNull()
    expect(refSec.textContent).toContain('被技能引用')
    expect(refSec.textContent).toContain('暂无技能引用')
    expect(el.textContent).toContain('创建时间')
    expect(el.textContent).toContain('最近更新时间')
    expect(el.textContent).toContain('最近发布时间')
  })

  it('示例问题在「基本信息」卡内作子分区，副注「必填，固定 3 条，用于帮助用户理解如何使用该连接器」（md §三.2 L98）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const sub = cardOfTitle(el, '基本信息').querySelector('.connector-basic-subsection')
    expect(sub).not.toBeNull()
    expect(sub.textContent).toContain('必填，固定 3 条，用于帮助用户理解如何使用该连接器')
    expect(titlesOf(el).some((t) => t.startsWith('示例问题'))).toBe(false)
  })

  it('连接方式固定只读展示「登录态托管」，登录地址项在（md §三.2 L96-97）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const conn = [...el.querySelectorAll('.el-form-item')].find((f) => f.dataset.label === '连接方式')
    expect(conn.querySelector('.ad-readonly-value').textContent.trim()).toBe('登录态托管')
    expect(conn.querySelector('input, select')).toBeNull()
    expect([...el.querySelectorAll('.el-form-item')].some((f) => f.dataset.label === '登录地址')).toBe(true)
  })

  it('业务页区默认收起：按钮【展开业务页】，点一下变【收起业务页】并露出内容，再点收起（md §三.3 L105）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const toggle = () => el.querySelector('.ad-pages-toggle')
    expect(toggle().textContent.replace(/\s+/g, '').replace('▶', '')).toBe('展开业务页')
    expect(el.querySelector('.bpe')).toBeNull()
    toggle().click()
    await nextTick()
    expect(toggle().textContent.replace(/\s+/g, '').replace('▶', '')).toBe('收起业务页')
    expect(el.querySelector('.bpe')).not.toBeNull()
    toggle().click()
    await nextTick()
    expect(toggle().textContent.replace(/\s+/g, '').replace('▶', '')).toBe('展开业务页')
    expect(el.querySelector('.bpe')).toBeNull()
  })

  it('图标行：预览 + 并排【从图标库选择】【上传图标】（md §三.2 图标统一规则）', async () => {
    const el = await mountEditor(BIZ, { bizId: 'biz_1' })
    const field = el.querySelector('.icon-field-stub')
    expect(field.querySelector('.icon-lib').textContent).toBe('从图标库选择')
    expect(field.querySelector('.icon-upload').textContent).toBe('上传图标')
  })
})
