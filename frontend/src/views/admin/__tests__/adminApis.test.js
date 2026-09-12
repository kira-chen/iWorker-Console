// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * AdminApis.vue 页面级单测（2026-09-12 测试审计 T51/T58 新建；对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md §一.1 / §二.1 ~ §二.5 / §四）。
 *
 * 前身 adminApisPaging.test.js 只测自己复刻的 useGroupPaging，从不 import 页面——「改动那边时这里应同步失败」
 * 是假的；本文件真挂载 AdminApis.vue，分页、三态按钮、发布/撤回/停用/删除确认、删除系统、空态、验证列一并覆盖。
 *
 * 桩：api/apiConnector（9 个服务提供系统 + 各态 API）、element-plus（ElMessage/ElMessageBox）、
 *     ApiEditor / ProviderSystemEditor（露 props）、useDynPageSize → ref(3)（每页 3 个系统）、
 *     el-table 走 RowScope 行渲染桩（同 adminMcp.test.js）。
 * 真：ListToolbar / ListPagination / ListStates / StatusTag / HealthTag（页面局部 import，全局桩无效）。
 */

const conn = {
  listApis: vi.fn(),
  deleteApi: vi.fn(),
  healthCheckApi: vi.fn(),
  publishApi: vi.fn(),
  withdrawApi: vi.fn(),
  deactivateApi: vi.fn(),
  listProviderSystems: vi.fn(),
  deleteProviderSystem: vi.fn()
}
vi.mock('@/api/apiConnector', () => conn)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn(), prompt: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

// 每页个数钉 3（真实是按窗口高度算且最小 5，9 个系统分不出页）
vi.mock('@/composables/useDynPageSize', () => ({ useDynPageSize: () => ref(3) }))

vi.mock('@/components/admin/ApiEditor.vue', () => ({
  default: {
    name: 'ApiEditor',
    props: ['visible', 'apiId', 'readonly', 'defaultProviderSystemId'],
    template:
      '<div class="stub-api-editor" :data-visible="visible ? 1 : 0" :data-id="apiId" :data-readonly="readonly ? 1 : 0" :data-ps="defaultProviderSystemId" />'
  }
}))
vi.mock('@/components/admin/ProviderSystemEditor.vue', () => ({
  default: {
    name: 'ProviderSystemEditor',
    props: ['visible', 'systemId'],
    template: '<div class="stub-ps-editor" :data-visible="visible ? 1 : 0" :data-id="systemId" />'
  }
}))

const stubs = {
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  'el-empty': { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  'el-option': { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': {
    props: ['content', 'disabled'],
    template: '<span class="el-tooltip" :data-tip="disabled ? null : content"><slot /></span>'
  },
  'el-dialog': {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="el-dialog" :data-title="title"><slot /><slot name="footer" /></div>'
  },
  'el-button': {
    props: ['disabled', 'loading', 'type', 'link'],
    emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
  }
}
const vLoading = { mounted() {}, updated() {} }

const AdminApis = (await import('@/views/admin/AdminApis.vue')).default

let app, container
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await nextTick()
    await Promise.resolve()
  }
}
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(AdminApis) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  const RowScope = {
    props: ['row'],
    provide() {
      return { tableRow: () => this.row }
    },
    template: '<div class="t-row"><slot /></div>'
  }
  app.component('el-table', {
    components: { RowScope },
    props: ['data'],
    template: `
      <div class="el-table">
        <RowScope v-for="(row, i) in (data || [])" :key="i" :row="row">
          <slot :row="row" />
        </RowScope>
      </div>`
  })
  app.component('el-table-column', {
    props: ['label'],
    inject: { tableRow: { default: null } },
    computed: {
      row() {
        return this.tableRow ? this.tableRow() : null
      }
    },
    template: '<div class="t-cell" :data-label="label"><slot name="header" /><slot v-if="row" :row="row" /></div>'
  })
  for (const n of ['Search', 'Plus', 'Refresh', 'ArrowRight', 'ArrowDown']) app.component(n, { template: '<span/>' })
  app.directive('loading', vLoading)
  app.mount(container)
  await flush(5)
  return container
}

/* ---------------- fixture：9 个系统（ps_1~ps_9），各态 API 落在 ps_1/ps_2 ---------------- */
const PS = Array.from({ length: 9 }, (_, i) => ({
  id: `ps_${i + 1}`,
  name: `系统${i + 1}号`,
  description: `第 ${i + 1} 个系统`,
  apiCount: 0
}))
const mkApi = (over) => ({
  id: over.id,
  name: over.name,
  description: over.description || '',
  providerSystemId: over.ps,
  method: 'GET',
  readWrite: 'read',
  status: 'NOT_PUBLISHED',
  pendingAction: null,
  displayStatus: 'HEALTHY',
  lastCheckedAt: '2026-08-24T16:10:00+08:00',
  referencedBySkillCount: 0,
  referencedBySkills: [],
  updatedAt: '2026-08-24T16:10:00+08:00',
  ...over
})
// 名字互不为子串
const APIS = [
  mkApi({ id: 'a_np', name: '未发布接口', ps: 'ps_1', updatedAt: '2026-08-20T10:00:00+08:00' }),
  mkApi({
    id: 'a_pending',
    name: '在审接口',
    ps: 'ps_1',
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    updatedAt: '2026-08-22T10:00:00+08:00'
  }),
  mkApi({
    id: 'a_pub',
    name: '已上线接口',
    ps: 'ps_2',
    status: 'PUBLISHED',
    referencedBySkillCount: 2,
    referencedBySkills: [
      { skillId: 'sk_1', skillName: '报销查询技能' },
      { skillId: 'sk_2', skillName: '财务单据助手' }
    ]
  }),
  mkApi({
    id: 'a_deact',
    name: '停用中接口',
    ps: 'ps_2',
    status: 'PENDING_REVIEW',
    pendingAction: 'DEACTIVATE'
  }),
  mkApi({ id: 'a_bad', name: '异常接口', ps: 'ps_2', displayStatus: 'UNHEALTHY', lastCheckError: '连接超时' }),
  mkApi({ id: 'a_last', name: '末组接口', description: '尾巴描述', ps: 'ps_9' })
]
function psWithCounts() {
  return PS.map((p) => ({ ...p, apiCount: APIS.filter((a) => a.providerSystemId === p.id).length }))
}

const rows = () => [...container.querySelectorAll('.t-row')]
const rowByName = (name) => rows().find((el) => el.textContent.includes(name))
const btn = (rowEl, text) =>
  [...rowEl.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const btnTexts = (rowEl) =>
  [...rowEl.querySelectorAll('.tbl-ops .el-button')].map((b) => b.textContent.trim())
const tipsOf = (el) => [...el.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip'))
const groups = () => [...container.querySelectorAll('.aps-group')]
const groupNames = () => groups().map((g) => g.querySelector('.aps-group-name').textContent.trim())
const groupByName = (name) => groups().find((g) => g.querySelector('.aps-group-name').textContent.trim() === name)
const pager = () => container.querySelector('.list-pager')
const toolbarBtn = (text) =>
  [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  vi.clearAllMocks()
  conn.listProviderSystems.mockImplementation(async () => ({ list: psWithCounts() }))
  conn.listApis.mockImplementation(async (params = {}) => {
    let list = APIS
    const kw = (params.keyword || '').toLowerCase()
    if (kw) list = list.filter((a) => a.name.toLowerCase().includes(kw) || a.description.toLowerCase().includes(kw))
    if (params.state) list = list.filter((a) => a.status === params.state)
    return { list: list.map((a) => ({ ...a })) }
  })
  conn.publishApi.mockResolvedValue({})
  conn.withdrawApi.mockResolvedValue({})
  conn.deactivateApi.mockResolvedValue({})
  conn.deleteApi.mockResolvedValue({})
  conn.deleteProviderSystem.mockResolvedValue({})
  msgBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminApis · 按服务提供系统分页（md §二.1 L44「按服务提供系统分页，不按 API 分页」）', () => {
  it('9 个系统、每页 3 个 → 首屏只有 3 个分组，分页条计数单位是「个」：「共 9 个数据」', async () => {
    await mount()
    expect(groupNames()).toEqual(['系统1号', '系统2号', '系统3号'])
    // 首页两个分组下的 API 全部展示（5 条），远超「每页 3」——切片单位是系统不是 API
    expect(rows().length).toBe(5)
    expect(pager()).toBeTruthy()
    expect(pager().textContent).toContain('共 9 个数据')
  })

  it('点 › 翻到第 2 页 → 展示 ps_4 ~ ps_6 三个系统', async () => {
    await mount()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    expect(groupNames()).toEqual(['系统4号', '系统5号', '系统6号'])
  })

  it('停在第 3 页时关键词命中末组的 API 并点【查询】 → 只剩 1 个系统参与分页，回到第 1 页「共 1 个数据」（md §一.2 L19 / §二.1 L44）', async () => {
    await mount()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    expect(groupNames()).toEqual(['系统7号', '系统8号', '系统9号'])
    const input = container.querySelector('.lt-search')
    input.value = '尾巴'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(conn.listApis).toHaveBeenLastCalledWith({ keyword: '尾巴' })
    expect(groupNames()).toEqual(['系统9号'])
    expect(rowByName('末组接口')).toBeTruthy()
    expect(pager().textContent).toContain('共 1 个数据')
    expect(pager().querySelector('.page-btn.active').textContent.trim()).toBe('1')
  })

  it('停在第 3 页时把每页个数改成 10 → 只剩 1 页，页码钳回第 1 页并展示全部 9 个系统', async () => {
    await mount()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    expect(groupNames()).toEqual(['系统7号', '系统8号', '系统9号'])
    const sizeSel = pager().querySelector('select.page-size')
    sizeSel.value = '10'
    sizeSel.dispatchEvent(new Event('change'))
    await flush()
    expect(groups().length).toBe(9)
    expect(pager().querySelector('.page-btn.active').textContent.trim()).toBe('1')
  })

  it('状态筛选「审核中」+【查询】 → listApis 收到 state=PENDING_REVIEW，只展示有命中 API 的分组（md §一.1 L11 / §一.2 L19）', async () => {
    await mount()
    const sel = container.querySelector('.lt-filter')
    sel.value = 'PENDING_REVIEW'
    sel.dispatchEvent(new Event('change'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(conn.listApis).toHaveBeenLastCalledWith({ state: 'PENDING_REVIEW' })
    // ps_1（在审接口）与 ps_2（停用中接口）命中；其余空分组被过滤
    expect(groupNames()).toEqual(['系统1号', '系统2号'])
    expect(rows().map((r) => r.querySelector('.api-cell-name').textContent.trim())).toEqual(['在审接口', '停用中接口'])
  })

  it('无筛选条件时空分组也展示，且给「该系统下暂无 API · 点「在本系统下新建 API」添加」（md §二.1 L42）', async () => {
    await mount()
    const g3 = groupByName('系统3号')
    expect(g3.querySelector('.aps-group-empty').textContent.trim()).toBe('该系统下暂无 API · 点「在本系统下新建 API」添加')
  })
})

describe('AdminApis · 操作按钮按状态组合（md §二.2 L48-52）', () => {
  it('未发布：【查看】【编辑】【发布】【删除】', async () => {
    await mount()
    expect(btnTexts(rowByName('未发布接口'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('审核中：【查看】【编辑】（置灰，提示「审核中不可编辑，如需修改请先撤回」）【撤回】', async () => {
    await mount()
    const row = rowByName('在审接口')
    expect(btnTexts(row)).toEqual(['查看', '编辑', '撤回'])
    expect(btn(row, '编辑').disabled).toBe(true)
    expect(tipsOf(row)).toContain('审核中不可编辑，如需修改请先撤回')
  })

  it('已发布：【查看】【编辑】【停用】', async () => {
    await mount()
    expect(btnTexts(rowByName('已上线接口'))).toEqual(['查看', '编辑', '停用'])
  })

  it('连通性验证未通过：【发布】置灰并提示「连通性验证通过后才可提交发布」（md §二.2 L50 / §二.3 L59）', async () => {
    await mount()
    const row = rowByName('异常接口')
    expect(btn(row, '发布').disabled).toBe(true)
    expect(tipsOf(row)).toContain('连通性验证通过后才可提交发布')
    // 对照：验证通过的未发布行【发布】可点
    expect(btn(rowByName('未发布接口'), '发布').disabled).toBe(false)
  })

  it('状态标签三态文案：未发布 / 审核中 / 已发布（md §二.1 L32）', async () => {
    await mount()
    const tag = (name) => rowByName(name).querySelector('.status-tag').textContent.trim()
    expect(tag('未发布接口')).toBe('未发布')
    expect(tag('在审接口')).toBe('审核中')
    expect(tag('已上线接口')).toBe('已发布')
  })
})

describe('AdminApis · 发布 / 撤回 / 停用 / 删除（md §二.4 L64-72）', () => {
  it('发布：确认窗「将「未发布接口」提交审核，审核通过后才对客户端开放。」/ 标题「发布 API」/【提交审核】 → publishApi + 「已提交发布审核」+ 重拉', async () => {
    await mount()
    const before = conn.listApis.mock.calls.length
    btn(rowByName('未发布接口'), '发布').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '将「未发布接口」提交审核，审核通过后才对客户端开放。',
      '发布 API',
      expect.objectContaining({ confirmButtonText: '提交审核' })
    )
    expect(conn.publishApi).toHaveBeenCalledWith('a_np')
    expect(msg.success).toHaveBeenCalledWith('已提交发布审核')
    expect(conn.listApis.mock.calls.length).toBeGreaterThan(before)
  })

  it('发布：确认窗取消 → 不调 publishApi', async () => {
    msgBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    btn(rowByName('未发布接口'), '发布').click()
    await flush()
    expect(conn.publishApi).not.toHaveBeenCalled()
  })

  it('撤回：待审发布正文「撤回后「在审接口」将回到未发布状态。」；待审停用含「已发布」 → withdrawApi + 「已撤回」（md §二.4 L67）', async () => {
    await mount()
    btn(rowByName('在审接口'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenLastCalledWith(
      '撤回后「在审接口」将回到未发布状态。',
      '撤回审核',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(conn.withdrawApi).toHaveBeenCalledWith('a_pending')
    expect(msg.success).toHaveBeenCalledWith('已撤回')

    btn(rowByName('停用中接口'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenLastCalledWith(
      '撤回后「停用中接口」将回到已发布状态。',
      '撤回审核',
      expect.anything()
    )
    expect(conn.withdrawApi).toHaveBeenCalledWith('a_deact')
  })

  it('停用：确认窗「停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「已上线接口」？」/【继续停用】 → deactivateApi + 「已提交停用审核」（md §二.4 L69）', async () => {
    await mount()
    btn(rowByName('已上线接口'), '停用').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「已上线接口」？',
      '停用 API',
      expect.objectContaining({ confirmButtonText: '继续停用' })
    )
    expect(conn.deactivateApi).toHaveBeenCalledWith('a_pub')
    expect(msg.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('删除：确认窗「删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「未发布接口」？」/【继续删除】 → deleteApi + 「已删除」（md §二.4 L72）', async () => {
    await mount()
    btn(rowByName('未发布接口'), '删除').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「未发布接口」？',
      '删除 API',
      expect.objectContaining({ confirmButtonText: '继续删除' })
    )
    expect(conn.deleteApi).toHaveBeenCalledWith('a_np')
    expect(msg.success).toHaveBeenCalledWith('已删除')
  })

  it('动作失败：数据层抛 message → ElMessage.error 原文；无 message → 「操作失败」', async () => {
    conn.publishApi.mockRejectedValueOnce({ message: '连通性验证通过后才可提交发布' })
    await mount()
    btn(rowByName('未发布接口'), '发布').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('连通性验证通过后才可提交发布')
    conn.deactivateApi.mockRejectedValueOnce(new Error(''))
    btn(rowByName('已上线接口'), '停用').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('操作失败')
  })
})

describe('AdminApis · 服务提供系统分组头（md §二.1 L28 / §二.5 L81）', () => {
  it('分组头：名称 + 描述 + 「N 个 API」 + 三个操作【在本系统下新建 API】【编辑系统】【删除系统】', async () => {
    await mount()
    const g1 = groupByName('系统1号')
    expect(g1.querySelector('.aps-group-desc').textContent.trim()).toBe('第 1 个系统')
    expect(g1.querySelector('.aps-group-count').textContent.trim()).toBe('2 个 API')
    const acts = [...g1.querySelectorAll('.aps-group-actions .el-button')].map((b) => b.textContent.trim())
    expect(acts).toEqual(['在本系统下新建 API', '编辑系统', '删除系统'])
  })

  it('系统下有 API：【删除系统】置灰，提示「该系统下有 2 个 API，需先迁移或删除后才能删除系统」', async () => {
    await mount()
    const g1 = groupByName('系统1号')
    const del = [...g1.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除系统')
    expect(del.disabled).toBe(true)
    expect(tipsOf(g1)).toContain('该系统下有 2 个 API，需先迁移或删除后才能删除系统')
  })

  it('空系统删除：二次确认「删除后该 API 分组不可恢复，确认删除？」→ deleteProviderSystem + 「已删除」', async () => {
    await mount()
    const g3 = groupByName('系统3号')
    const del = [...g3.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除系统')
    expect(del.disabled).toBe(false)
    expect(tipsOf(g3).some((t) => (t || '').includes('需先迁移'))).toBe(false)
    del.click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后该 API 分组不可恢复，确认删除？',
      '删除服务提供系统',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(conn.deleteProviderSystem).toHaveBeenCalledWith('ps_3')
    expect(msg.success).toHaveBeenCalledWith('已删除')
  })

  it('【在本系统下新建 API】 → 编辑器以可写态打开并带入所属系统；【编辑系统】 → 系统弹窗带 id', async () => {
    await mount()
    const g2 = groupByName('系统2号')
    ;[...g2.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '在本系统下新建 API').click()
    await nextTick()
    const ed = container.querySelector('.stub-api-editor')
    expect(ed.dataset.visible).toBe('1')
    expect(ed.dataset.ps).toBe('ps_2')
    expect(ed.dataset.readonly).toBe('0')
    ;[...g2.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '编辑系统').click()
    await nextTick()
    const ps = container.querySelector('.stub-ps-editor')
    expect(ps.dataset.visible).toBe('1')
    expect(ps.dataset.id).toBe('ps_2')
  })

  it('折叠按钮：点一下收起组内表格（分组头仍在），再点展开', async () => {
    await mount()
    const g1 = groupByName('系统1号')
    expect(g1.querySelector('.aps-group-body')).toBeTruthy()
    g1.querySelector('.aps-collapse-btn').click()
    await nextTick()
    expect(groupByName('系统1号').querySelector('.aps-group-body')).toBeNull()
    groupByName('系统1号').querySelector('.aps-collapse-btn').click()
    await nextTick()
    expect(groupByName('系统1号').querySelector('.aps-group-body')).toBeTruthy()
  })
})

describe('AdminApis · 空态（md §一.1 L14 / §四）', () => {
  it('没有任何服务提供系统 → 「还没有服务提供系统 · 请先创建服务提供系统分组，再在其下新建 API」+【新建服务提供系统】', async () => {
    conn.listProviderSystems.mockResolvedValue({ list: [] })
    conn.listApis.mockResolvedValue({ list: [] })
    await mount()
    const empty = container.querySelector('.el-empty')
    expect(empty.textContent).toContain('还没有服务提供系统 · 请先创建服务提供系统分组，再在其下新建 API')
    expect(empty.querySelector('.el-button').textContent).toContain('新建服务提供系统')
    expect(pager()).toBeNull()
  })

  it('查询无结果 → 「没有匹配的 API」，输入框保留当前条件', async () => {
    await mount()
    const input = container.querySelector('.lt-search')
    input.value = '不存在的关键词'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(container.querySelector('.el-empty').textContent).toContain('没有匹配的 API')
    expect(groups().length).toBe(0)
    expect(container.querySelector('.lt-search').value).toBe('不存在的关键词')
  })
})

describe('AdminApis · 验证列与引用情况（md §二.1 L35-37 / §二.3 L58）', () => {
  it('点【↻】重新验证 → healthCheckApi(id)，成功「检活完成 · 连接正常」且行内标签「连接正常」', async () => {
    conn.healthCheckApi.mockResolvedValue({ displayStatus: 'HEALTHY', checkedAt: '2026-08-25T10:00:00+08:00' })
    await mount()
    const row = rowByName('异常接口')
    expect(row.querySelector('.health-tag').textContent.trim()).toBe('连接异常')
    row.querySelector('.mc-vc-refresh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flush()
    expect(conn.healthCheckApi).toHaveBeenCalledWith('a_bad')
    expect(msg.success).toHaveBeenCalledWith('检活完成 · 连接正常')
    expect(rowByName('异常接口').querySelector('.health-tag').textContent.trim()).toBe('连接正常')
    expect(rowByName('异常接口').querySelector('.mc-vc-time').textContent.trim()).toBe('08-25 10:00')
  })

  it('验证异常 → warning「检活完成 · 连接异常」；验证请求失败 → error「检活失败，请稍后重试」', async () => {
    conn.healthCheckApi.mockResolvedValueOnce({ displayStatus: 'UNHEALTHY', checkedAt: '2026-08-25T10:00:00+08:00', error: 'x' })
    await mount()
    rowByName('未发布接口').querySelector('.mc-vc-refresh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flush()
    expect(msg.warning).toHaveBeenCalledWith('检活完成 · 连接异常')
    conn.healthCheckApi.mockRejectedValueOnce(new Error(''))
    rowByName('已上线接口').querySelector('.mc-vc-refresh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flush()
    expect(msg.error).toHaveBeenCalledWith('检活失败，请稍后重试')
  })

  it('引用情况：「2 个技能引用」点开弹窗列出技能名；无引用显示「暂无引用」', async () => {
    await mount()
    expect(rowByName('未发布接口').textContent).toContain('暂无引用')
    btn(rowByName('已上线接口'), '2 个技能引用').click()
    await nextTick()
    const dlg = container.querySelector('.el-dialog')
    expect(dlg.dataset.title).toBe('被技能引用')
    expect(dlg.textContent).toContain('报销查询技能')
    expect(dlg.textContent).toContain('财务单据助手')
  })

  it('【查看】只读打开编辑器；【编辑】可写打开', async () => {
    await mount()
    btn(rowByName('在审接口'), '查看').click()
    await nextTick()
    let ed = container.querySelector('.stub-api-editor')
    expect(ed.dataset.id).toBe('a_pending')
    expect(ed.dataset.readonly).toBe('1')
    btn(rowByName('未发布接口'), '编辑').click()
    await nextTick()
    ed = container.querySelector('.stub-api-editor')
    expect(ed.dataset.id).toBe('a_np')
    expect(ed.dataset.readonly).toBe('0')
  })

  it('最近更新时间列头排序：默认由近到远，点一下变由远到近（md §二.1 L36）', async () => {
    await mount()
    const names = () =>
      [...groupByName('系统1号').querySelectorAll('.api-cell-name')].map((e) => e.textContent.trim())
    expect(names()).toEqual(['在审接口', '未发布接口'])
    groupByName('系统1号').querySelector('.time-sort').click()
    await nextTick()
    expect(names()).toEqual(['未发布接口', '在审接口'])
    expect(groupByName('系统1号').querySelector('.time-sort-arrow').textContent).toBe('↑')
  })
})
