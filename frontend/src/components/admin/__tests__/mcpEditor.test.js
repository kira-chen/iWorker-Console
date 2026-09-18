// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * McpEditor.vue（MCP 编辑抽屉）编辑器级行为 —— 2026-09-12 测试审计新建（A20 / E6；D9 由 mcpMeta.test 迁入）。
 * 原型骨架 / 静态文案另见 connectorEditorsLayout.test.js，本文件只盯交互逻辑。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md §三：
 * - §三.2 从配置粘贴导入（L216-228）；
 * - §三.3.1 传输方式切换清空对侧（L248-250）；§三.4 超时默认 10000 / 1000～120000 / 步长 1000（L259）；
 * - §三.4.2 Command 纯下拉五项、不支持自由输入（L276）；
 * - §三.5 测试连接（L290-296）；§三.6 工具清单展开 / 收起 / 拉取（L303-311）；
 * - 保存：校验不过 toast「请先修正标红项」；登记「已登记」/ 编辑「已保存」（代码 McpEditor.vue:594-606，md §三.1 L199-200 按钮名）。
 * - E6 防回归（5303c7c）：visible/mcpId watcher 为 immediate——组件创建时 visible 已是 true 也要拉详情。
 *
 * 切断 api/admin、element-plus；el-* 轻桩（select / input / textarea 支持 v-model）；DrawerEditor / ParamRowsEditor 真组件。
 * 2026-09-12 闭环：J17（测试失败红卡「标题 + 正文」两段，md §三.5 L295）、K39（Command 占位「npx」/ Bearer 占位 /
 * 切「无鉴权」清空本次凭证，md §三.4.1-4.2 L266/L272/L276）、K44（登记态抽屉标题「登记 MCP」，md §三.1 L199）。
 */
const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: { confirm: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ resolve: () => ({ href: '/x' }) }) }))

// 图标行桩：露出一个「选图标」按钮 emit pick，免把图标库 / 上传 / 裁剪链路拖进来
vi.mock('@/components/common/IconField.vue', () => ({
  default: {
    name: 'IconField',
    props: ['icon', 'name', 'readonly', 'placeholder', 'size'],
    emits: ['pick'],
    template:
      '<div class="icon-field-stub" :data-icon="icon"><button type="button" class="icon-pick" @click="$emit(\'pick\', { icon: \'◎\', iconSource: \'library\' })">选图标</button></div>'
  }
}))

const adminApi = {
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  getMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn()
}
vi.mock('@/api/admin', () => adminApi)

const McpEditor = (await import('@/components/admin/McpEditor.vue')).default

const stubs = {
  'el-drawer': {
    props: ['modelValue'],
    template: '<div class="el-drawer" v-if="modelValue"><slot name="header" /><slot /><div class="drawer-footer"><slot name="footer" /></div></div>'
  },
  'el-form': { props: ['disabled'], template: '<form class="el-form" @submit.prevent><slot /></form>' },
  'el-form-item': {
    props: ['label', 'error', 'required'],
    template:
      '<div class="el-form-item" :data-label="label" :data-error="error || \'\'"><span class="fi-label"><slot name="label" />{{ label }}</span><slot /><span v-if="error" class="fi-error">{{ error }}</span></div>'
  },
  'el-input': {
    props: ['modelValue', 'placeholder', 'type', 'disabled', 'maxlength'],
    emits: ['update:modelValue', 'input'],
    template:
      '<span class="el-input-wrap"><slot name="prepend" />' +
      '<textarea v-if="type === \'textarea\'" class="el-input el-textarea" :value="modelValue" :placeholder="placeholder" :disabled="disabled"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />' +
      '<input v-else class="el-input" :value="modelValue" :placeholder="placeholder" :type="type || \'text\'" :disabled="disabled"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" /></span>'
  },
  'el-input-number': {
    props: ['modelValue', 'min', 'max', 'step'],
    emits: ['update:modelValue'],
    template: '<input class="el-input-number" type="number" :value="modelValue" :min="min" :max="max" :step="step" @input="$emit(\'update:modelValue\', Number($event.target.value))" />'
  },
  'el-select': {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<select class="el-select" :value="modelValue" :data-placeholder="placeholder" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  'el-option': { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-checkbox': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<label class="el-checkbox-wrap"><input type="checkbox" class="el-checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /><slot /></label>'
  },
  'el-button': {
    props: ['type', 'link', 'loading', 'disabled', 'size', 'plain'],
    emits: ['click'],
    template: '<button type="button" class="el-button" :data-type="type" :disabled="disabled || loading" @click="!disabled && $emit(\'click\')"><slot /></button>'
  },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-skeleton': { template: '<div class="el-skeleton" />' },
  'el-empty': { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  Connection: { template: '<i />' },
  Download: { template: '<i />' }
}

let app, container, emitted
async function flush(n = 5) {
  for (let i = 0; i < n; i++) {
    await nextTick()
    await Promise.resolve()
  }
}
/**
 * 挂载：visible 初值即 true（E6：走 immediate watcher 常驻路径；此前各用例都 false→true 绕开了它）。
 * 返回 container；emitted 记录 saved / update:visible / probed。
 */
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = { saved: [], visible: [], probed: [] }
  const visible = ref(true)
  app = createApp({
    render: () =>
      h(McpEditor, {
        visible: visible.value,
        ...props,
        'onUpdate:visible': (v) => { visible.value = v; emitted.visible.push(v) },
        onSaved: (p) => emitted.saved.push(p),
        onProbed: (p) => emitted.probed.push(p)
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await flush()
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})
beforeEach(() => {
  vi.clearAllMocks()
})

/* ---------------- DOM 取值助手 ---------------- */
const item = (label) => [...container.querySelectorAll('.el-form-item')].find((el) => el.querySelector('.fi-label')?.textContent.replace(/\s+/g, ' ').trim().startsWith(label))
const inputOf = (label) => item(label)?.querySelector('.el-input, .el-input-number')
const selectOf = (label) => item(label)?.querySelector('select')
const setInput = async (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flush(2)
}
const setSelect = async (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('change'))
  await flush(2)
}
/** stdio Env 行的变量名（ParamRowsEditor 把 key 放在输入框里，textContent 读不到） */
const envKeys = () => [...container.querySelectorAll('.md-env-item input[placeholder="变量名，如 API_KEY"]')].map((i) => i.value)
const btnByText = (text, root = container) => [...root.querySelectorAll('.el-button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === text)
const footerBtn = (text) => btnByText(text, container.querySelector('.drawer-footer'))

const HTTP_DETAIL = {
  id: 'mcp_1',
  name: '报销系统 MCP',
  icon: '¥',
  description: '查询和提交员工报销单',
  transport: 'streamable-http',
  endpoint: 'https://expense.intra/mcp',
  timeoutMs: 15000,
  authInfo: null,
  exampleQuestions: ['问一', '问二', '问三'],
  tools: [],
  referencedBySkills: [],
  connStatus: 'ok',
  createdAt: '2026-08-18T09:30:00Z',
  updatedAt: '2026-08-23T09:48:00Z'
}
const STDIO_DETAIL = {
  id: 'mcp_2',
  name: '本地文件 MCP',
  icon: '▱',
  description: '读取工作区文件',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-local-files'],
  env: [{ key: 'WORKSPACE_ROOT', description: '根目录', clientFill: false, valueMasked: '/sr***ace' }],
  timeoutMs: 10000,
  exampleQuestions: ['问一', '问二', '问三'],
  tools: [],
  referencedBySkills: []
}
const TOOLS = [
  { name: 'spark_agent_chat', title: '智能体对话', description: '调用智能体', writeClass: 'READ', inputSchema: { type: 'object', properties: { bodyId: { type: 'string', description: '智能体编码' }, message: { type: 'string' } }, required: ['bodyId'] } },
  { name: 'spark_scene_run', title: '', description: '', writeClass: 'WRITE', inputSchema: null },
  { name: 'spark_knowledge_qa', title: '知识库问答', description: '检索问答', writeClass: 'READ', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }
]

/* ================= E6 watcher immediate 防回归 ================= */
describe('E6 visible 初值 true 时也拉详情（watcher immediate，5303c7c 防回归）', () => {
  it('编辑态：组件创建时 visible=true + mcpId → getMcp 被调一次且名称 / 地址 / 超时回填', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    await mount({ mcpId: 'mcp_1' })
    expect(adminApi.getMcp).toHaveBeenCalledTimes(1)
    expect(adminApi.getMcp).toHaveBeenCalledWith('mcp_1')
    expect(inputOf('名称').value).toBe('报销系统 MCP')
    expect(inputOf('MCP 服务地址').value).toBe('https://expense.intra/mcp')
    expect(inputOf('超时时间').value).toBe('15000')
    // 抽屉标题动词「编辑」（DrawerEditor 拼「编辑」+ entity，无空格；md §三.1 L200 写「编辑 MCP」，仅空格差异不钉）
    expect(container.querySelector('.de-head-title').textContent.trim()).toMatch(/^编辑\s?MCP$/)
  })

  it('登记态：visible=true 无 mcpId → 不调 getMcp，表单为默认值（http / 无鉴权 / 超时 10000），标题「登记 MCP」，底部【取消】【登记】', async () => {
    await mount()
    expect(adminApi.getMcp).not.toHaveBeenCalled()
    expect(selectOf('传输方式').value).toBe('streamable-http')
    expect(selectOf('鉴权方式').value).toBe('none')
    expect(inputOf('超时时间').value).toBe('10000')
    // 抽屉标题「登记 MCP」（md §三.1 L199；K44 经 DrawerEditor create-title，2026-09-12）
    expect(container.querySelector('.de-head-title').textContent.trim()).toBe('登记 MCP')
    expect([...container.querySelectorAll('.drawer-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '登记'])
    // K39：stdio Command 下拉默认占位「npx」（md §三.4.2 L276）
    await setSelect(selectOf('传输方式'), 'stdio')
    expect(selectOf('Command').dataset.placeholder).toBe('npx')
  })

  it('查看态：标题「查看 MCP」，底部仅【关闭】，【测试连接】【拉取工具】不可点，无粘贴导入区（md §三.1 L201 / §三.2 L216 / §三.5 L291 / §三.6 L307）', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    await mount({ mcpId: 'mcp_1', readonly: true })
    expect(container.querySelector('.de-head-title').textContent.trim()).toMatch(/^查看\s?MCP$/)
    expect([...container.querySelectorAll('.drawer-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
    expect(btnByText('测试连接').disabled).toBe(true)
    expect(btnByText('拉取工具').disabled).toBe(true)
    expect(container.querySelector('.md-import')).toBeNull()
  })
})

/* ================= §三.3.1 传输方式切换 ================= */
describe('传输方式切换清空对侧内容（md §三.3.1 L248-250）', () => {
  it('stdio → streamable-http：Command / Arguments / Environment 清空且不再展示；切回 stdio 时为空', async () => {
    adminApi.getMcp.mockResolvedValue(STDIO_DETAIL)
    await mount({ mcpId: 'mcp_2' })
    expect(selectOf('Command').value).toBe('npx')
    expect(inputOf('args').value).toBe('-y\n@modelcontextprotocol/server-local-files')
    expect(envKeys()).toEqual(['WORKSPACE_ROOT'])
    await setSelect(selectOf('传输方式'), 'streamable-http')
    expect(item('Command')).toBeUndefined()
    expect(item('MCP 服务地址')).toBeTruthy()
    expect(item('鉴权方式')).toBeTruthy()
    await setSelect(selectOf('传输方式'), 'stdio')
    expect(selectOf('Command').value).toBe('')
    expect(inputOf('args').value).toBe('')
    expect(envKeys()).toEqual([])
    expect(container.textContent).toContain('暂无环境变量')
  })

  it('streamable-http → stdio：服务地址与鉴权清空且不展示；切回 http 时地址为空、鉴权回到无鉴权', async () => {
    adminApi.getMcp.mockResolvedValue({ ...HTTP_DETAIL, authInfo: { type: 'bearer', valueMasked: 'ab***yz' } })
    await mount({ mcpId: 'mcp_1' })
    expect(selectOf('鉴权方式').value).toBe('bearer')
    await setSelect(selectOf('传输方式'), 'stdio')
    expect(item('MCP 服务地址')).toBeUndefined()
    expect(item('鉴权方式')).toBeUndefined()
    expect(item('Command')).toBeTruthy()
    await setSelect(selectOf('传输方式'), 'streamable-http')
    expect(inputOf('MCP 服务地址').value).toBe('')
    expect(selectOf('鉴权方式').value).toBe('none')
  })
})

/* ================= §三.4.1 鉴权方式切换（K39，2026-09-12） ================= */
describe('鉴权方式切换（md §三.4.1 L266 / L272）', () => {
  it('Bearer Token 占位「粘贴 Bearer Token（不含 Bearer 前缀）」；填了 Token / Header 名后切「无鉴权」→ 本次填写的凭证清空，再切回为空', async () => {
    await mount()
    await setSelect(selectOf('鉴权方式'), 'bearer')
    const token = inputOf('Token')
    expect(token.placeholder).toBe('粘贴 Bearer Token（不含 Bearer 前缀）')
    await setInput(token, 'sk-live-abc')
    expect(inputOf('Token').value).toBe('sk-live-abc')
    await setSelect(selectOf('鉴权方式'), 'header')
    await setInput(inputOf('Header 名'), 'X-Api-Key')
    await setSelect(selectOf('鉴权方式'), 'none')
    expect(item('Token')).toBeUndefined()
    expect(item('Header 名')).toBeUndefined()
    await setSelect(selectOf('鉴权方式'), 'header')
    expect(inputOf('Header 名').value).toBe('')
    expect(inputOf('访问凭证').value).toBe('')
  })
})

/* ================= §三.2 从配置粘贴导入 ================= */
describe('从配置粘贴导入（md §三.2 L216-228）', () => {
  const STDIO_JSON = JSON.stringify({
    mcpServers: { 'amap-maps': { command: 'npx', args: ['-y', '@amap/amap-maps-mcp-server'], env: { AMAP_MAPS_API_KEY: 'k-123' } } }
  })
  const importSection = () => container.querySelector('.md-import')
  const importTextarea = () => importSection().querySelector('textarea')

  it('区块标题「从配置粘贴导入」+ 说明逐字；默认收起，点【粘贴配置导入】展开、按钮变【收起】；空内容时【解析并填充】【清空】不可点（L217-220 / L223）', async () => {
    await mount()
    const sec = importSection()
    expect(sec.querySelector('.md-sec-title').textContent.trim()).toBe('从配置粘贴导入')
    expect(sec.querySelector('.md-sec-sub').textContent.trim()).toBe('粘贴一段 MCP 服务配置 JSON，自动解析填充下方字段')
    expect(sec.querySelector('.md-import-body')).toBeNull()
    btnByText('粘贴配置导入', sec).click()
    await flush(2)
    expect(sec.querySelector('.md-import-body')).toBeTruthy()
    expect(btnByText('收起', sec)).toBeTruthy()
    expect(importTextarea().placeholder).toContain('"mcpServers"')
    expect(btnByText('解析并填充', sec).disabled).toBe(true)
    expect(btnByText('清空', sec).disabled).toBe(true)
  })

  it('stdio 配置 → 自动切 stdio 并填 Command / Arguments / Environment；名称为空时补 server key；填充后收起并清空粘贴区，toast「已解析并填充到下方表单」（L221 / L224-226）', async () => {
    await mount()
    btnByText('粘贴配置导入').click()
    await flush(2)
    await setInput(importTextarea(), STDIO_JSON)
    btnByText('解析并填充').click()
    await flush()
    expect(selectOf('传输方式').value).toBe('stdio')
    expect(selectOf('Command').value).toBe('npx')
    expect(inputOf('args').value).toBe('-y\n@amap/amap-maps-mcp-server')
    expect(envKeys()).toEqual(['AMAP_MAPS_API_KEY'])
    expect(inputOf('名称').value).toBe('amap-maps')
    expect(importSection().querySelector('.md-import-body')).toBeNull() // 自动收起
    btnByText('粘贴配置导入').click()
    await flush(2)
    expect(importTextarea().value).toBe('') // 粘贴内容已清空
    expect(msg.success).toHaveBeenCalledWith('已解析并填充到下方表单')
  })

  it('http 配置 → 切 streamable-http 并填服务地址；名称已填时不覆盖（L221 / L225）', async () => {
    await mount()
    await setInput(inputOf('名称'), '我的地图')
    btnByText('粘贴配置导入').click()
    await flush(2)
    await setInput(importTextarea(), JSON.stringify({ mcpServers: { 'remote-maps': { type: 'streamable-http', url: 'https://maps.example.com/mcp' } } }))
    btnByText('解析并填充').click()
    await flush()
    expect(selectOf('传输方式').value).toBe('streamable-http')
    expect(inputOf('MCP 服务地址').value).toBe('https://maps.example.com/mcp')
    expect(inputOf('名称').value).toBe('我的地图')
  })

  it('无法识别的配置 → 提示具体原因，表单内容保留、导入区不收起（L228）', async () => {
    await mount()
    await setInput(inputOf('名称'), '保留我')
    btnByText('粘贴配置导入').click()
    await flush(2)
    await setInput(importTextarea(), '{ not json')
    btnByText('解析并填充').click()
    await flush()
    expect(msg.error).toHaveBeenCalledTimes(1)
    expect(msg.error.mock.calls[0][0]).toMatch(/^JSON 解析失败：/)
    expect(inputOf('名称').value).toBe('保留我')
    expect(importSection().querySelector('.md-import-body')).toBeTruthy()
    expect(importTextarea().value).toBe('{ not json')
    // 找不到 mcpServers 也不像单服务对象
    await setInput(importTextarea(), '{"foo": 1}')
    btnByText('解析并填充').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('未找到 mcpServers 节点，也不像单个服务配置对象')
  })

  it('【清空】只清粘贴内容，不影响下方已填内容（L227）', async () => {
    await mount()
    await setInput(inputOf('名称'), '别动我')
    btnByText('粘贴配置导入').click()
    await flush(2)
    await setInput(importTextarea(), STDIO_JSON)
    expect(btnByText('清空').disabled).toBe(false)
    btnByText('清空').click()
    await flush(2)
    expect(importTextarea().value).toBe('')
    expect(inputOf('名称').value).toBe('别动我')
    expect(selectOf('传输方式').value).toBe('streamable-http')
  })

  it('Environment 带空值 → 填充并 warning 提示需手动补全（L222）', async () => {
    await mount()
    btnByText('粘贴配置导入').click()
    await flush(2)
    await setInput(importTextarea(), JSON.stringify({ mcpServers: { s: { command: 'npx', args: [], env: { API_KEY: '' } } } }))
    btnByText('解析并填充').click()
    await flush()
    expect(envKeys()).toEqual(['API_KEY'])
    expect(msg.warning).toHaveBeenCalledTimes(1)
    expect(msg.warning.mock.calls[0][0].message).toMatch(/^已填充，请注意：/)
    expect(msg.success).not.toHaveBeenCalled()
  })
})

/* ================= 保存：校验 / 登记 / 保存 ================= */
describe('保存（McpEditor.save；md §三.1 L199-200 按钮【登记】【保存】）', () => {
  async function fillValidNew() {
    await setInput(inputOf('名称'), '新 MCP')
    container.querySelector('.icon-pick').click()
    await flush(2)
    await setInput(inputOf('服务描述'), '做点什么')
    await setInput(inputOf('MCP 服务地址'), 'https://new.example.com/mcp')
    const qs = [...container.querySelectorAll('.md-eq-row .el-input')]
    for (let i = 0; i < 3; i++) await setInput(qs[i], `示例问题 ${i + 1}`)
  }

  it('空表单点【登记】→ toast warning「请先修正标红项」，名称 / 图标 / 服务描述 / 地址 / 示例问题标红，不调 createMcp', async () => {
    await mount()
    footerBtn('登记').click()
    await flush()
    expect(msg.warning).toHaveBeenCalledWith('请先修正标红项')
    expect(adminApi.createMcp).not.toHaveBeenCalled()
    expect(item('名称').dataset.error).toBe('名称必填')
    expect(item('图标').dataset.error).toBe('请选择或上传图标')
    expect(item('服务描述').dataset.error).toBe('服务描述必填')
    expect(item('MCP 服务地址').dataset.error).toBe('Endpoint 必填')
    expect(container.querySelector('.md-eq-err-msg').textContent.trim()).toBe('示例问题固定 3 条，须全部填写')
    expect(emitted.visible).toEqual([]) // 抽屉不关
  })

  it('登记态填齐后【登记】→ createMcp 收到 payload（http 只带 endpoint 不带 command/args/env）→ toast「已登记」→ emit saved → 抽屉关闭', async () => {
    adminApi.createMcp.mockResolvedValue({ id: 'mcp_new' })
    await mount()
    await fillValidNew()
    footerBtn('登记').click()
    await flush()
    expect(adminApi.createMcp).toHaveBeenCalledTimes(1)
    const payload = adminApi.createMcp.mock.calls[0][0]
    expect(payload).toMatchObject({
      name: '新 MCP',
      icon: '◎',
      description: '做点什么',
      transport: 'streamable-http',
      endpoint: 'https://new.example.com/mcp',
      timeoutMs: 10000,
      authConfig: { type: 'none' },
      exampleQuestions: ['示例问题 1', '示例问题 2', '示例问题 3'],
      tools: []
    })
    expect(payload).not.toHaveProperty('command')
    expect(payload).not.toHaveProperty('env')
    expect(payload).not.toHaveProperty('code') // md §三.3 L243：code 系统生成，前端不提交
    expect(msg.success).toHaveBeenCalledWith('已登记')
    expect(emitted.saved).toEqual([{ id: 'mcp_new' }])
    expect(emitted.visible).toEqual([false])
  })

  it('编辑态改描述后【保存】→ updateMcp(id, payload) → toast「已保存」→ emit saved({id}) → 关闭', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    adminApi.updateMcp.mockResolvedValue({})
    await mount({ mcpId: 'mcp_1' })
    await setInput(inputOf('服务描述'), '改过的描述')
    footerBtn('保存').click()
    await flush()
    expect(adminApi.updateMcp).toHaveBeenCalledWith('mcp_1', expect.objectContaining({ name: '报销系统 MCP', description: '改过的描述', timeoutMs: 15000 }))
    expect(msg.success).toHaveBeenCalledWith('已保存')
    expect(emitted.saved).toEqual([{ id: 'mcp_1' }])
    expect(emitted.visible).toEqual([false])
  })

  it('保存失败：接口回 field → 该字段标红 + error(message)，抽屉不关；无 field → error(message)', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    adminApi.updateMcp.mockRejectedValueOnce(Object.assign(new Error('地址不可达'), { field: 'endpoint' }))
    await mount({ mcpId: 'mcp_1' })
    footerBtn('保存').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('地址不可达')
    expect(item('MCP 服务地址').dataset.error).toBe('地址不可达')
    expect(emitted.visible).toEqual([])
    adminApi.updateMcp.mockRejectedValueOnce(new Error('后端 500'))
    footerBtn('保存').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('后端 500')
  })
})

/* ================= 连接器类型 / 所属岗位（2026-09-18 修坏链） ================= */
describe('连接器类型=岗位私有 → 所属岗位下拉（2026-09-18 修坏链：@/api/position 动态 import 解构错误 + status 大小写 + positionId 非 id）', () => {
  it('选「岗位私有」后展示真实已发布岗位', async () => {
    await mount()
    await setSelect(selectOf('连接器类型'), 'POSITION')
    // loadPublishedPositions() 挂载即调用，listPositions mock 走真实 200ms setTimeout，需真实等待；
    // 轮询而非固定 sleep——机器负载高（并发跑很多测试文件）时固定 500ms 也可能不够，轮询到 3s 上限更稳。
    const positionSelect = selectOf('所属岗位')
    expect(positionSelect).toBeTruthy()
    const deadline = Date.now() + 3000
    let optionLabels = []
    while (Date.now() < deadline) {
      optionLabels = [...positionSelect.querySelectorAll('option')].map((o) => o.textContent)
      if (optionLabels.includes('经营分析岗')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(optionLabels).toContain('经营分析岗')
  })
})

/* ================= §三.6 工具清单 ================= */
describe('工具清单：展开 / 收起 / 拉取（md §三.6 L303-311, §三.6.1-§三.6.2）', () => {
  it('说明文案逐字；默认收起只留【展开工具清单】【拉取工具】；展开后无工具显「暂无工具，点击「拉取工具」从 MCP server 同步」，按钮变【收起工具清单】', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    await mount({ mcpId: 'mcp_1' })
    const head = container.querySelector('.md-tools-head')
    expect(head.querySelector('.section-sub').textContent.trim()).toBe('由「拉取工具」从 MCP server 同步（只读）；无工具可保存，但不可发布')
    expect(btnByText('▶ 展开工具清单')).toBeTruthy()
    expect(btnByText('拉取工具')).toBeTruthy()
    expect(container.querySelector('.el-empty')).toBeNull()
    btnByText('▶ 展开工具清单').click()
    await flush(2)
    expect(container.querySelector('.el-empty').textContent.trim()).toBe('暂无工具，点击「拉取工具」从 MCP server 同步')
    expect(btnByText('▶ 收起工具清单')).toBeTruthy()
    btnByText('▶ 收起工具清单').click()
    await flush(2)
    expect(container.querySelector('.el-empty')).toBeNull()
    expect(btnByText('▶ 展开工具清单')).toBeTruthy()
  })

  it('已存 MCP 拉取：fetchMcpTools(id) → toast「已拉取 3 个工具」→ 清单自动展开渲染 3 张卡（有 title 主显名称辅显标识 / 无 title 仅标识 / 无描述显「（server 未提供描述）」）→ emit probed', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    adminApi.fetchMcpTools.mockResolvedValue({ tools: TOOLS, connStatus: 'ok', protocolVersion: '2025-06-18', serverVersion: '1.4.2' })
    await mount({ mcpId: 'mcp_1' })
    btnByText('拉取工具').click()
    await flush()
    expect(adminApi.fetchMcpTools).toHaveBeenCalledWith('mcp_1')
    expect(adminApi.fetchMcpToolsDraft).not.toHaveBeenCalled()
    expect(msg.success).toHaveBeenCalledWith('已拉取 3 个工具')
    expect(btnByText('▶ 收起工具清单')).toBeTruthy()
    const cards = [...container.querySelectorAll('.md-tool')]
    expect(cards).toHaveLength(3)
    expect(cards[0].querySelector('.md-tool-title').textContent.trim()).toBe('智能体对话')
    expect(cards[0].querySelector('.md-tool-name--sub').textContent.trim()).toBe('spark_agent_chat')
    expect(cards[1].querySelector('.md-tool-title')).toBeNull()
    expect(cards[1].querySelector('.md-tool-name').textContent.trim()).toBe('spark_scene_run')
    expect(cards[1].querySelector('.md-tool-desc-ro').textContent.trim()).toBe('（server 未提供描述）')
    // 连接信息就地刷新
    expect(container.querySelector('.md-conn-meta').textContent).toContain('协议版本：2025-06-18')
    expect(emitted.probed).toEqual([{ id: 'mcp_1', connStatus: 'ok', protocolVersion: '2025-06-18', serverVersion: '1.4.2' }])
  })

  it('入参：有入参的工具显【查看入参】、无入参不显入口；点开只读展示 名称 / 类型 / 必填 / 说明，文案变【收起入参】，各工具独立', async () => {
    adminApi.getMcp.mockResolvedValue({ ...HTTP_DETAIL, tools: TOOLS })
    await mount({ mcpId: 'mcp_1' })
    btnByText('▶ 展开工具清单').click()
    await flush(2)
    const cards = [...container.querySelectorAll('.md-tool')]
    expect(cards[1].querySelector('.md-schema-toggle')).toBeNull()
    expect(cards[0].querySelector('.md-schema-toggle').textContent.replace(/\s+/g, ' ').trim()).toBe('▶ 查看入参')
    expect(cards[0].querySelector('.md-schema-ro')).toBeNull()
    cards[0].querySelector('.md-schema-toggle').click()
    await flush(2)
    expect(cards[0].querySelector('.md-schema-toggle').textContent.replace(/\s+/g, ' ').trim()).toBe('▶ 收起入参')
    const rows = [...cards[0].querySelectorAll('.md-schema-row')]
    expect(rows.map((r) => r.querySelector('.md-schema-name').textContent)).toEqual(['bodyId', 'message'])
    expect(rows[0].querySelector('.md-schema-req').textContent).toBe('必填')
    expect(rows[0].querySelector('.md-schema-desc').textContent).toBe('智能体编码')
    expect(rows[1].querySelector('.md-schema-req')).toBeNull()
    expect(cards[2].querySelector('.md-schema-ro')).toBeNull() // 其他工具不受影响
  })

  it('登记态拉取走 fetchMcpToolsDraft(探测入参)；拉取失败 → error(原因)，已填内容保持不变', async () => {
    adminApi.fetchMcpToolsDraft.mockRejectedValue(new Error('拉取工具失败：CONN_REFUSED'))
    await mount()
    await setInput(inputOf('名称'), '草稿')
    await setInput(inputOf('MCP 服务地址'), 'https://draft.example.com/mcp')
    btnByText('拉取工具').click()
    await flush()
    expect(adminApi.fetchMcpToolsDraft).toHaveBeenCalledWith(expect.objectContaining({ transport: 'streamable-http', endpoint: 'https://draft.example.com/mcp' }))
    expect(msg.error).toHaveBeenCalledWith('拉取工具失败：CONN_REFUSED')
    expect(inputOf('名称').value).toBe('草稿')
    expect(inputOf('MCP 服务地址').value).toBe('https://draft.example.com/mcp')
  })
})

/* ================= §三.4 超时 / §三.4.2 Command / §三.5 测试连接 ================= */
describe('连接与鉴权：超时范围、Command 五项、测试连接', () => {
  it('超时时间：默认 10000，输入框 min 1000 / max 120000 / step 1000（md §三.4 L259）', async () => {
    await mount()
    const n = inputOf('超时时间')
    expect(n.value).toBe('10000')
    expect(n.getAttribute('min')).toBe('1000')
    expect(n.getAttribute('max')).toBe('120000')
    expect(n.getAttribute('step')).toBe('1000')
  })

  it('超时超出范围保存 → 标红「请输入 1000-120000 之间的整数」', async () => {
    adminApi.getMcp.mockResolvedValue(HTTP_DETAIL)
    await mount({ mcpId: 'mcp_1' })
    await setInput(inputOf('超时时间'), '999')
    footerBtn('保存').click()
    await flush()
    expect(item('超时时间').dataset.error).toBe('请输入 1000-120000 之间的整数')
    expect(adminApi.updateMcp).not.toHaveBeenCalled()
  })

  it('Command 纯下拉只有 npx / uvx / node / python3 / docker 五项；存量非枚举值不被追加成选项（md §三.4.2 L276）', async () => {
    adminApi.getMcp.mockResolvedValue({ ...STDIO_DETAIL, command: 'bash' })
    await mount({ mcpId: 'mcp_2' })
    const opts = [...selectOf('Command').querySelectorAll('option')].map((o) => o.value)
    expect(opts).toEqual(['npx', 'uvx', 'node', 'python3', 'docker'])
    expect(opts).not.toContain('bash')
  })

  it('测试连接：hint「仅验证「连得上、能握手」，数秒内返回」；成功 → 绿卡「握手成功 · 协议 … · Server … · 延迟 … ms」，不返回工具、不改工具清单（md §三.5 L290 / L294）', async () => {
    adminApi.testMcpConn.mockResolvedValue({ ok: true, protocolVersion: '2025-06-18', serverVersion: '1.4.2', latencyMs: 86 })
    await mount()
    expect(container.querySelector('.md-conn-hint').textContent.trim()).toBe('仅验证「连得上、能握手」，数秒内返回')
    await setInput(inputOf('MCP 服务地址'), 'https://t.example.com/mcp')
    btnByText('测试连接').click()
    await flush()
    expect(adminApi.testMcpConn).toHaveBeenCalledWith(expect.objectContaining({ transport: 'streamable-http', endpoint: 'https://t.example.com/mcp' }))
    const card = container.querySelector('.md-conn-result')
    expect(card.classList.contains('is-success')).toBe(true)
    expect(card.textContent.trim()).toBe('握手成功 · 协议 2025-06-18 · Server 1.4.2 · 延迟 86 ms')
    expect(container.querySelectorAll('.md-tool')).toHaveLength(0)
  })

  it('测试连接失败 → 红卡（is-error）两段：标题 = 具体失败原因、正文「握手未通过，请检查接入方式 / 地址 / 鉴权配置后重试」；再次点击先清上一次结果（md §三.5 L293 / L295，J17）', async () => {
    adminApi.testMcpConn.mockResolvedValueOnce({ ok: false, failReason: '连接超时' })
    await mount()
    await setInput(inputOf('MCP 服务地址'), 'https://t.example.com/mcp')
    btnByText('测试连接').click()
    await flush()
    const card = container.querySelector('.md-conn-result')
    expect(card.classList.contains('is-error')).toBe(true)
    expect(card.querySelector('.md-conn-result-title').textContent.trim()).toBe('连接超时')
    expect(card.querySelector('.md-conn-result-body').textContent.trim()).toBe('握手未通过，请检查接入方式 / 地址 / 鉴权配置后重试')
    // 第二次点击：进行中阶段上一次结果已清
    let resolve
    adminApi.testMcpConn.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    btnByText('测试连接').click()
    await flush(2)
    expect(container.querySelector('.md-conn-result')).toBeNull()
    expect(btnByText('测试连接').disabled).toBe(true) // 进行中不可重复点击（L292）
    expect(btnByText('拉取工具').disabled).toBe(true)
    resolve({ ok: true })
    await flush()
    expect(container.querySelector('.md-conn-result').textContent.trim()).toBe('握手成功')
  })

  it('测试连接失败且无 failReason → 标题回落「连接失败」，正文仍为固定提示（md §三.5 L295「具体失败原因或“连接失败”」）', async () => {
    adminApi.testMcpConn.mockResolvedValueOnce({ ok: false })
    await mount()
    await setInput(inputOf('MCP 服务地址'), 'https://t.example.com/mcp')
    btnByText('测试连接').click()
    await flush()
    const card = container.querySelector('.md-conn-result')
    expect(card.classList.contains('is-error')).toBe(true)
    expect(card.querySelector('.md-conn-result-title').textContent.trim()).toBe('连接失败')
    expect(card.querySelector('.md-conn-result-body').textContent.trim()).toBe('握手未通过，请检查接入方式 / 地址 / 鉴权配置后重试')
  })
})

/* ================= D9 迁入：失败回显不拼 endpoint（源码正则守卫） ================= */
describe('失败提示脱敏 — 渲染层不应拼出 endpoint（D9 自 mcpMeta.test 迁入）', () => {
  // McpEditor 直接展示后端已脱敏的 failReason/message，前端不再二次拼接 endpoint。
  // 此处以静态源码断言守住：失败回显中不得引用 form.endpoint。
  //
  // 2026-09-09 原型复刻批次 3A · M6：结果回显由双 el-alert 改为原型 `.result` 单行提示框。
  // 2026-09-12 J17：失败侧拆成 testFailTitle computed（标题 = failReason || '连接失败'）+ 固定正文常量，
  // 锚点随之改为盯 testFailTitle 的函数体（成功侧 testResultText 不再含 failReason）。
  it('McpEditor 失败回显不引用 form.endpoint', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../McpEditor.vue'), 'utf-8')
    // 失败标题 computed 不得插值 endpoint
    const start = src.indexOf('const testFailTitle = computed(')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n})', start))
    // 失败标题用的是 mock 已脱敏的 failReason（computed 里 r = testResult.value）
    expect(body).toContain('failReason')
    expect(body).not.toMatch(/form\.endpoint/)
    // 成功侧 computed 同样不拼 endpoint
    const okStart = src.indexOf('const testResultText = computed(')
    expect(okStart).toBeGreaterThan(-1)
    expect(src.slice(okStart, src.indexOf('\n})', okStart))).not.toMatch(/form\.endpoint/)
    // 模板侧的结果框也只吐 computed 结果，不拼 endpoint
    const resultBlock = src.slice(src.indexOf('class="md-conn-result"'))
    expect(resultBlock.slice(0, resultBlock.indexOf('</div>'))).not.toMatch(/form\.endpoint/)
  })
})
