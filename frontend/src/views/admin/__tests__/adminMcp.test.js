// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { fmtTime } from '@/utils/docMeta'

/**
 * AdminMcp.vue（MCP 列表页）单测。
 *
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md：
 * - §一（导航栏：搜索手动【查询】回第 1 页 L25 / 状态筛选切换即刷新回第 1 页 L26 / 空态文案 L33-34）；
 * - §二.1（列表字段：状态列 09-11 拍板拆独立列，2026-09-12 审计 J1 闭环——拍板覆盖 md、md L45 由文档组回写；
 *   工具数为 0 悬浮 L47；引用情况 L48；最近更新时间排序 L49）；
 * - §二.2（验证列：三态文案 L57 / 未验证悬浮 L58 / 异常三段式 L61 / 验证中 L63 / 四种 toast L65-68）；
 * - §二.3（操作：三态按钮集合逐字 §二.3.1 L83-86；审核中【编辑】置灰提示 §二.3.3 L103；
 *   发布 / 撤回 / 停用 / 删除的确认窗标题·正文·按钮·toast §二.3.4-§二.3.7；状态变化即时替换按钮 L87-92）；
 * - §二.4（状态规则：DELISTED / REJECTED / PARTIAL 归「未发布」）。
 *
 * 切断 api/admin、api/market 与 element-plus；el-* 用轻量桩（el-table 桩按行渲染 default 插槽）。
 * StatusTag / HealthTag / ListToolbar / ListStates / ListPagination 为组件局部 import 的**真组件**
 * （全局同名桩对其无效），断言直接读它们渲染出的文案 / 类名。
 * 已知不写的用例（审计 K34 待代码修）：mock 层停用直落 DELISTED——本文件 market api 全桩，与之无关。
 */

const adminApi = {
  listMcp: vi.fn(),
  deleteMcp: vi.fn(),
  healthCheckTool: vi.fn()
}
vi.mock('@/api/admin', () => adminApi)
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({}) }))

const marketApi = {
  getMcpServicePublishStatus: vi.fn(),
  publishMcpService: vi.fn(),
  delistMcpService: vi.fn(),
  withdrawMcpService: vi.fn()
}
vi.mock('@/api/market', () => marketApi)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

vi.mock('@/components/admin/McpEditor.vue', () => ({
  default: {
    name: 'McpEditor',
    props: ['visible', 'mcpId', 'readonly'],
    template:
      '<div class="stub-mcp-editor" :data-visible="visible" :data-id="mcpId" :data-readonly="readonly ? 1 : 0" />'
  }
}))

const stubs = {
  'el-icon': { template: '<i><slot /></i>' },
  // ListStates（真组件）的失败态用 el-empty；AdminMcp 模板本身已无 el-empty / el-card / el-pagination
  'el-empty': { props: ['description'], template: '<div class="el-empty" :data-desc="description"><slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
  },
  'el-option': { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': { props: ['content'], template: '<span class="el-tooltip" :data-tip="content"><slot /></span>' },
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

const AdminMcp = (await import('@/views/admin/AdminMcp.vue')).default

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(AdminMcp) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  // 每行一个 provide 容器，把 row 传给其下所有 el-table-column
  const RowScope = {
    props: ['row'],
    provide() {
      return { tableRow: () => this.row }
    },
    template: '<div class="t-row"><slot /></div>'
  }
  app.component('RowScope', RowScope)
  app.component('el-table', {
    components: { RowScope },
    props: ['data'],
    template: `
      <div class="el-table">
        <div class="t-head"><slot /></div>
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
    // 表头阶段（无行）渲染 header 插槽（最近更新时间列的排序按钮在此）；行内渲染 default 插槽
    template: '<div class="t-cell" :data-label="label"><slot v-if="row" :row="row" /><slot v-else name="header" /></div>'
  })
  app.component('Search', { template: '<span/>' })
  app.component('Plus', { template: '<span/>' })
  app.component('Refresh', { template: '<span/>' })
  app.directive('loading', vLoading)
  app.mount(container)
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return container
}

function rowEls() {
  return [...container.querySelectorAll('.t-row')]
}
/** 按 MCP 名取行——不依赖 fixture 顺序，后续新增 fixture 不会让既有用例连坐失败。 */
function rowByName(name) {
  return rowEls().find((el) => el.textContent.includes(name))
}
/** 操作列按钮（.tbl-ops 内；引用情况列的「N 个技能引用」也是 el-button，不算操作） */
function btn(rowEl, text) {
  return [...rowEl.querySelectorAll('.tbl-ops .el-button')].find((b) => b.textContent.trim().startsWith(text))
}
function texts(rowEl) {
  return [...rowEl.querySelectorAll('.tbl-ops .el-button')].map((b) => b.textContent.trim())
}
function stateOf(rowEl) {
  return rowEl.querySelector('.status-tag')?.textContent.trim()
}

// fixture 名互不为子串，避免 rowByName 误命中
const LIST = [
  { id: 'mc_none', name: '未发布服务', transport: 'stdio', toolCount: 2, referencedBySkillCount: 0, status: 'active', icon: '🗺️', type: 'PLATFORM', displayStatus: 'HEALTHY', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'mc_pending', name: '在审服务', transport: 'streamable-http', toolCount: 3, referencedBySkillCount: 1, status: 'active', type: 'PLATFORM', displayStatus: 'HEALTHY' },
  { id: 'mc_pub', name: '已上线服务', transport: 'stdio', toolCount: 4, referencedBySkillCount: 2, status: 'active', icon: '/api/public/icons/abc.png', timeoutMs: 30000, type: 'PLATFORM', displayStatus: 'HEALTHY' },
  { id: 'mc_delisted', name: '已下架服务', transport: 'stdio', toolCount: 1, referencedBySkillCount: 0, status: 'active', type: 'PLATFORM', displayStatus: 'HEALTHY' },
  { id: 'mc_empty', name: '空工具服务', transport: 'stdio', toolCount: 0, referencedBySkillCount: 0, status: 'active', type: 'PLATFORM', displayStatus: 'HEALTHY' }
]

const AGG_SEED = {
  mc_none: 'NOT_PUBLISHED',
  mc_pending: 'PENDING_REVIEW',
  mc_pub: 'PUBLISHED',
  mc_delisted: 'DELISTED',
  mc_empty: 'NOT_PUBLISHED'
}
// 每例复位的聚合态表：发布 / 撤回 / 停用桩会改写它，模拟 mock 层状态机（md §二.4），
// 让「动作成功后状态列与按钮即时替换」（md §二.3.1 L87-92）可断言。
let AGG = {}
// 审核中的待审类型（PUBLISH / DELIST），与真 mock 的 pendingAction 同源：撤回确认按它分文案（md §3.5）
const PENDING_SEED = { mc_pending: 'PUBLISH' }
let PENDING = {}

/** 冲刷若干轮微任务 + 渲染（列表取数 → 聚合态拉取 → 渲染 是三段异步） */
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await nextTick()
    await Promise.resolve()
  }
}

describe('AdminMcp · MCP 列表页（md §一 / §二）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    AGG = { ...AGG_SEED }
    PENDING = { ...PENDING_SEED }
    // 页面会就地改写行对象（检活回写 displayStatus / lastCheckedAt），故每次调用都给夹具的浅拷贝，用例间不串
    adminApi.listMcp.mockImplementation(async () => ({ list: LIST.map((r) => ({ ...r })), total: LIST.length }))
    marketApi.getMcpServicePublishStatus.mockImplementation((id) =>
      Promise.resolve({ mcpId: id, targets: [{ target: 'USER_END', aggregateStatus: AGG[id], pendingAction: PENDING[id] || null }] })
    )
    marketApi.publishMcpService.mockImplementation(async (id) => { AGG[id] = 'PENDING_REVIEW'; PENDING[id] = 'PUBLISH'; return { affected: 1, skipped: 0 } })
    // 停用：md §二.3.6 L135「提交成功后……页面状态变为"审核中"」——market 层桩按 md 给 PENDING_REVIEW + 待审停用
    marketApi.delistMcpService.mockImplementation(async (id) => { AGG[id] = 'PENDING_REVIEW'; PENDING[id] = 'DELIST'; return { affected: 1, skipped: 0 } })
    // 撤回按待审类型恢复（md §3.5，与 API / 模型同口径）：待审发布 → 未发布；待审停用 → 保持已发布
    marketApi.withdrawMcpService.mockImplementation(async (id) => {
      AGG[id] = PENDING[id] === 'DELIST' ? 'PUBLISHED' : 'NOT_PUBLISHED'
      PENDING[id] = null
      return { affected: 1, skipped: 0 }
    })
    msgBox.confirm.mockResolvedValue('confirm')
  })
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('状态列：六态聚合归三态展示', async () => {
    await mount()
    expect(stateOf(rowByName('未发布服务'))).toBe('未发布')
    expect(stateOf(rowByName('在审服务'))).toBe('审核中')
    expect(stateOf(rowByName('已上线服务'))).toBe('已发布')
    // 已停用归「未发布」——列表只回答「发布到哪一步」，停用即不可用
    expect(stateOf(rowByName('已下架服务'))).toBe('未发布')
  })

  // md §二.3.1 L83-86 各状态按钮组合（精确集合，顺序即操作列顺序）
  it('操作区 · 未发布：【查看】【编辑】【发布】【删除】共 4 个（md §二.3.1 L83）', async () => {
    await mount()
    expect(texts(rowByName('未发布服务'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('操作区 · 已发布：【查看】【编辑】【停用】共 3 个，无【删除】（md §二.3.1 L86 / L81）', async () => {
    await mount()
    expect(texts(rowByName('已上线服务'))).toEqual(['查看', '编辑', '停用'])
  })

  it('操作区 · 审核中：【查看】【编辑】【撤回】共 3 个，【编辑】置灰并提示「审核中不可编辑，如需修改请先撤回」（md §二.3.1 L85 / §二.3.3 L103）', async () => {
    await mount()
    const row = rowByName('在审服务')
    expect(texts(row)).toEqual(['查看', '编辑', '撤回'])
    expect(btn(row, '编辑').disabled).toBe(true)
    expect(btn(row, '查看').disabled).toBe(false)
    const tip = btn(row, '编辑').closest('[data-tip]')
    expect(tip?.getAttribute('data-tip')).toBe('审核中不可编辑，如需修改请先撤回')
  })

  it('操作区 · 已停用（DELISTED）归未发布，操作位出【发布】（md §二.3.4 L108）', async () => {
    await mount()
    expect(stateOf(rowByName('已下架服务'))).toBe('未发布')
    expect(texts(rowByName('已下架服务'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('操作区 · 未发布但连接未验证成功：4 个按钮仍在，仅【发布】不可点（md §二.3.1 L84）', async () => {
    adminApi.listMcp.mockResolvedValue({ list: [{ ...LIST[0], displayStatus: 'UNKNOWN' }], total: 1 })
    await mount()
    const row = rowByName('未发布服务')
    expect(texts(row)).toEqual(['查看', '编辑', '发布', '删除'])
    expect(btn(row, '发布').disabled).toBe(true)
    expect(btn(row, '删除').disabled).toBe(false)
  })

  // ---- 发布（md §二.3.4 L111-114） ----
  it('发布：确认窗标题「发布 MCP 服务」/ 正文说明整体提交审核 / 按钮【提交审核】→ 调服务级端点不传 targets → toast「已提交发布审核」→ 状态列即变「审核中」、按钮换成【撤回】', async () => {
    await mount()
    btn(rowByName('未发布服务'), '发布').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '将把「未发布服务」下全部 2 个工具作为一个整体提交审核，审核通过后才对平台各项服务开放。',
      '发布 MCP 服务',
      expect.objectContaining({ confirmButtonText: '提交审核' })
    )
    expect(marketApi.publishMcpService).toHaveBeenCalledWith('mc_none', {})
    expect(msg.success).toHaveBeenCalledWith('已提交发布审核')
    // md §二.3.1 L88「提交发布后，【发布】和【删除】替换为【撤回】」（能红验证：删 runAction 里的 loadPubSummary）
    expect(stateOf(rowByName('未发布服务'))).toBe('审核中')
    expect(texts(rowByName('未发布服务'))).toEqual(['查看', '编辑', '撤回'])
  })

  it('发布：取消确认则不提交、状态不变', async () => {
    msgBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    btn(rowByName('未发布服务'), '发布').click()
    await flush()
    expect(marketApi.publishMcpService).not.toHaveBeenCalled()
    expect(msg.success).not.toHaveBeenCalled()
    expect(stateOf(rowByName('未发布服务'))).toBe('未发布')
  })

  it('发布：连接正常但工具数为 0 → 提示「该 MCP 服务下暂无可发布的工具，请先在编辑器内「拉取工具」」，不弹确认不发请求（md §二.3.4 L110）', async () => {
    await mount()
    btn(rowByName('空工具服务'), '发布').click()
    await flush()
    expect(msg.warning).toHaveBeenCalledWith('该 MCP 服务下暂无可发布的工具，请先在编辑器内「拉取工具」')
    expect(msgBox.confirm).not.toHaveBeenCalled()
    expect(marketApi.publishMcpService).not.toHaveBeenCalled()
  })

  it('发布失败：端点抛错 → error(其 message)，状态与按钮不变', async () => {
    marketApi.publishMcpService.mockRejectedValueOnce(new Error('服务端拒绝'))
    await mount()
    btn(rowByName('未发布服务'), '发布').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('服务端拒绝')
    expect(stateOf(rowByName('未发布服务'))).toBe('未发布')
    expect(texts(rowByName('未发布服务'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  // ---- 撤回（md §二.3.5 L121-124） ----
  it('撤回：确认窗「撤回审核」/ 正文说明回到未发布需重新发布并再次审核 / 按钮【撤回】→ toast「已撤回」→ 状态变「未发布」，按钮换回【发布】【删除】', async () => {
    await mount()
    btn(rowByName('在审服务'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '撤回后「在审服务」将回到未发布状态，需重新发布并再次审核。确认撤回？',
      '撤回审核',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(marketApi.withdrawMcpService).toHaveBeenCalledWith('mc_pending', {})
    expect(msg.success).toHaveBeenCalledWith('已撤回')
    // md §二.3.1 L90「撤回审核后，【撤回】替换为【发布】和【删除】」
    expect(stateOf(rowByName('在审服务'))).toBe('未发布')
    expect(texts(rowByName('在审服务'))).toEqual(['查看', '编辑', '发布', '删除'])
    expect(btn(rowByName('在审服务'), '编辑').disabled).toBe(false)
  })

  it('撤回 · 待审停用：正文改说明「将保持已发布，继续对客户端提供服务」→ 撤回后状态回「已发布」，按钮换回【停用】（md §3.5 按待审类型恢复）', async () => {
    await mount()
    // 先把「已上线服务」提交停用，进入待审停用
    btn(rowByName('已上线服务'), '停用').click()
    await flush()
    expect(stateOf(rowByName('已上线服务'))).toBe('审核中')
    msgBox.confirm.mockClear()
    // 再撤回：文案与恢复结果都应走停用分支，而不是发布分支的「回到未发布」
    btn(rowByName('已上线服务'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '撤回后「已上线服务」将保持已发布，继续对客户端提供服务。确认撤回？',
      '撤回审核',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(stateOf(rowByName('已上线服务'))).toBe('已发布')
    expect(texts(rowByName('已上线服务'))).toEqual(['查看', '编辑', '停用'])
  })

  // ---- 停用（md §二.3.6 L131-135） ----
  it('停用：确认窗「停用 MCP 服务」/ 正文「停用后技能仍可执行，但运行效果可能受限或出现报错」/ 按钮【继续停用】→ toast「已提交停用审核」→ 状态「审核中」，【停用】替换为【撤回】', async () => {
    await mount()
    btn(rowByName('已上线服务'), '停用').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「已上线服务」？',
      '停用 MCP 服务',
      expect.objectContaining({ confirmButtonText: '继续停用' })
    )
    expect(marketApi.delistMcpService).toHaveBeenCalledWith('mc_pub', {})
    expect(msg.success).toHaveBeenCalledWith('已提交停用审核')
    // md §二.3.1 L91「提交停用后，【停用】替换为【撤回】」
    expect(stateOf(rowByName('已上线服务'))).toBe('审核中')
    expect(texts(rowByName('已上线服务'))).toEqual(['查看', '编辑', '撤回'])
  })

  it('已停用（DELISTED）行点【发布】→ 走发布确认与发布端点重新过审（md §二.3.4 L108，无免审「重新上架」通道）', async () => {
    await mount()
    btn(rowByName('已下架服务'), '发布').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenLastCalledWith(expect.any(String), '发布 MCP 服务', expect.objectContaining({ confirmButtonText: '提交审核' }))
    expect(marketApi.publishMcpService).toHaveBeenCalledWith('mc_delisted', {})
    expect(stateOf(rowByName('已下架服务'))).toBe('审核中')
  })

  // ---- 删除（md §二.3.7 L139-146；审计 A4 补：此前 deleteMcp 桩从未被断言） ----
  describe('删除（md §二.3.7）', () => {
    it('确认窗「删除 MCP」/ 正文「删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「X」？」/ 按钮【继续删除】→ deleteMcp → toast「已删除」→ 重拉列表', async () => {
      await mount()
      const calls = adminApi.listMcp.mock.calls.length
      btn(rowByName('未发布服务'), '删除').click()
      await flush()
      expect(msgBox.confirm).toHaveBeenCalledWith(
        '删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「未发布服务」？',
        '删除 MCP',
        expect.objectContaining({ confirmButtonText: '继续删除' })
      )
      expect(adminApi.deleteMcp).toHaveBeenCalledWith('mc_none')
      expect(msg.success).toHaveBeenCalledWith('已删除')
      expect(adminApi.listMcp.mock.calls.length).toBe(calls + 1)
    })

    it('被 2 个技能引用：正文改为「该 MCP 被 2 个技能引用，停用或删除后技能仍可执行……」，确认后仍可删（软引用，md L142）', async () => {
      adminApi.listMcp.mockResolvedValue({ list: [{ ...LIST[0], referencedBySkillCount: 2 }], total: 1 })
      await mount()
      btn(rowByName('未发布服务'), '删除').click()
      await flush()
      expect(msgBox.confirm).toHaveBeenCalledWith(
        '该 MCP 被 2 个技能引用，停用或删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「未发布服务」？',
        '删除 MCP',
        expect.objectContaining({ confirmButtonText: '继续删除' })
      )
      expect(adminApi.deleteMcp).toHaveBeenCalledWith('mc_none')
      expect(msg.success).toHaveBeenCalledWith('已删除')
    })

    it('取消确认 → 不调 deleteMcp、行仍在（md L143）', async () => {
      msgBox.confirm.mockRejectedValueOnce('cancel')
      await mount()
      btn(rowByName('未发布服务'), '删除').click()
      await flush()
      expect(adminApi.deleteMcp).not.toHaveBeenCalled()
      expect(rowByName('未发布服务')).toBeTruthy()
    })

    it('删掉第 2 页仅剩的 1 条且不在第 1 页 → 自动回到第 1 页重拉（md L145）', async () => {
      // 第 1 页按 size 铺满、第 2 页只剩「末页服务」一条
      adminApi.listMcp.mockImplementation(async ({ page, size }) => {
        if (page === 2) return { list: [{ ...LIST[0], id: 'mc_last', name: '末页服务' }], total: size + 1 }
        return {
          list: Array.from({ length: size }, (_, i) => ({ ...LIST[0], id: `mc_p1_${i}`, name: `首页服务${i}` })),
          total: size + 1
        }
      })
      await mount()
      container.querySelector('.list-pager [aria-label="下一页"]').click()
      await flush()
      expect(rowByName('末页服务')).toBeTruthy()
      expect(container.querySelector('.list-pager .page-btn.active').textContent.trim()).toBe('2')
      btn(rowByName('末页服务'), '删除').click()
      await flush(8)
      expect(adminApi.deleteMcp).toHaveBeenCalledWith('mc_last')
      expect(adminApi.listMcp.mock.calls.at(-1)[0].page).toBe(1)
      expect(container.querySelector('.list-pager .page-btn.active').textContent.trim()).toBe('1')
      expect(rowByName('首页服务0')).toBeTruthy()
    })

    it('删除失败：有 message 提示其原因；无 message 提示「删除失败」；行保留不重拉（md L146）', async () => {
      adminApi.deleteMcp.mockRejectedValueOnce(new Error('后端拒绝：仍在被调用'))
      await mount()
      const calls = adminApi.listMcp.mock.calls.length
      btn(rowByName('未发布服务'), '删除').click()
      await flush()
      expect(msg.error).toHaveBeenCalledWith('后端拒绝：仍在被调用')
      expect(rowByName('未发布服务')).toBeTruthy()
      expect(adminApi.listMcp.mock.calls.length).toBe(calls)

      adminApi.deleteMcp.mockRejectedValueOnce(new Error(''))
      btn(rowByName('未发布服务'), '删除').click()
      await flush()
      expect(msg.error).toHaveBeenLastCalledWith('删除失败')
      expect(msg.success).not.toHaveBeenCalled()
    })
  })

  it('验证列：结果标签 + 相对时间 + 刷新入口（外观对齐模型页）', async () => {
    await mount()
    const row = rowByName('已上线服务')
    // 结果标签（复用检活四态）与刷新图标入口都在
    expect(row.querySelector('.health-tag')).toBeTruthy()
    expect(row.querySelector('.mc-vc-refresh')).toBeTruthy()
  })

  it('验证悬浮 · 正常：只给「最近验证」一行', async () => {
    adminApi.listMcp.mockResolvedValue({
      list: [{ ...LIST[2], displayStatus: 'HEALTHY', lastCheckAt: '2026-08-21T09:00:00Z' }],
      total: 1
    })
    await mount()
    const tip = [...rowByName('已上线服务').querySelectorAll('[data-tip]')]
      .map((e) => e.getAttribute('data-tip') || '')
      .find((t) => t.includes('最近验证'))
    expect(tip).toBeTruthy()
    // 正常态不再赘述「连接正常」——标签已经表达过了
    expect(tip).not.toContain('连接正常')
    expect(tip.split('\n')).toHaveLength(1)
  })

  it('验证悬浮 · 异常：三段式（最近验证 / 错误原因 / 错误码）', async () => {
    adminApi.listMcp.mockResolvedValue({
      list: [
        {
          ...LIST[2],
          displayStatus: 'UNHEALTHY',
          lastCheckAt: '2026-08-21T09:00:00Z',
          lastCheckError: '连接超时'
        }
      ],
      total: 1
    })
    await mount()
    const tip = [...rowByName('已上线服务').querySelectorAll('[data-tip]')]
      .map((e) => e.getAttribute('data-tip') || '')
      .find((t) => t.includes('最近验证'))
    const lines = tip.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('最近验证：')
    // 中文简述反查出人话原因与技术错误码（后端只落中文简述，码靠 mcpVerify 目录反查）
    expect(lines[1]).toBe('错误原因：在超时时间内没有收到响应')
    expect(lines[2]).toBe('错误码：TIMEOUT')
  })

  it('验证悬浮 · 未登记的错误简述：原文透出、错误码显 UNKNOWN（不编造分类）', async () => {
    adminApi.listMcp.mockResolvedValue({
      list: [
        {
          ...LIST[2],
          displayStatus: 'UNHEALTHY',
          lastCheckAt: '2026-08-21T09:00:00Z',
          lastCheckError: '某个后端新增但前端尚未登记的原因'
        }
      ],
      total: 1
    })
    await mount()
    const tip = [...rowByName('已上线服务').querySelectorAll('[data-tip]')]
      .map((e) => e.getAttribute('data-tip') || '')
      .find((t) => t.includes('最近验证'))
    expect(tip).toContain('错误原因：某个后端新增但前端尚未登记的原因')
    expect(tip).toContain('错误码：UNKNOWN')
  })

  // ---- 验证列（md §二.2 L62-68；审计 A5 提升：此前只断端点被调） ----
  describe('验证列 · 点刷新发起验证（md §二.2）', () => {
    const clickRefresh = async (name) => {
      rowByName(name).querySelector('.mc-vc-refresh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await flush()
    }
    const tagOf = (name) => rowByName(name).querySelector('.health-tag').textContent.trim()
    const timeOf = (name) => rowByName(name).querySelector('.mc-vc-time')?.textContent.trim()

    it('连接正常：调 healthCheckTool("MCP", id) → toast「检活完成 · 连接正常」+ 行内标签「连接正常」+ 最近验证时间 MM-DD HH:mm 即时更新（L64-65）', async () => {
      adminApi.healthCheckTool.mockResolvedValue({ displayStatus: 'HEALTHY', checkedAt: '2026-08-21T10:00:00Z' })
      adminApi.listMcp.mockResolvedValue({ list: [{ ...LIST[0], displayStatus: 'UNKNOWN' }], total: 1 })
      await mount()
      expect(tagOf('未发布服务')).toBe('未探测')
      expect(timeOf('未发布服务')).toBeUndefined() // 从未验证不展示时间（L58）
      await clickRefresh('未发布服务')
      expect(adminApi.healthCheckTool).toHaveBeenCalledWith('MCP', 'mc_none')
      expect(msg.success).toHaveBeenCalledWith('检活完成 · 连接正常')
      expect(tagOf('未发布服务')).toBe('连接正常')
      // 格式 MM-DD HH:mm（L59）；具体时分随本地时区，故与 fmtTime 同源换算
      expect(timeOf('未发布服务')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
      expect(timeOf('未发布服务')).toBe(fmtTime('2026-08-21T10:00:00Z').slice(5))
    })

    it('连接异常：toast warning「检活完成 · 连接异常」+ 标签「连接异常」（L66）', async () => {
      adminApi.healthCheckTool.mockResolvedValue({ displayStatus: 'UNHEALTHY', checkedAt: '2026-08-21T10:00:00Z' })
      await mount()
      await clickRefresh('未发布服务')
      expect(msg.warning).toHaveBeenCalledWith('检活完成 · 连接异常')
      expect(tagOf('未发布服务')).toBe('连接异常')
    })

    it('未获得明确结果（UNKNOWN）：toast info「检活完成」+ 标签「未探测」（L67）', async () => {
      adminApi.healthCheckTool.mockResolvedValue({ displayStatus: 'UNKNOWN', checkedAt: '2026-08-21T10:00:00Z' })
      await mount()
      await clickRefresh('未发布服务')
      expect(msg.info).toHaveBeenCalledWith('检活完成')
      expect(tagOf('未发布服务')).toBe('未探测')
    })

    it('验证失败：有原因提示原因；无原因提示「检活失败，请稍后重试」；标签保留上一次结果（L68）', async () => {
      adminApi.healthCheckTool.mockRejectedValueOnce(new Error('网络不可达'))
      await mount()
      await clickRefresh('未发布服务')
      expect(msg.error).toHaveBeenCalledWith('网络不可达')
      expect(tagOf('未发布服务')).toBe('连接正常')
      adminApi.healthCheckTool.mockRejectedValueOnce(new Error(''))
      await clickRefresh('未发布服务')
      expect(msg.error).toHaveBeenLastCalledWith('检活失败，请稍后重试')
    })

    it('验证过程中：保留上一次标签，时间位显「正在验证…」，图标旋转且再点不重复发起（L63）', async () => {
      let resolve
      adminApi.healthCheckTool.mockReturnValue(new Promise((r) => { resolve = r }))
      await mount()
      await clickRefresh('未发布服务')
      expect(tagOf('未发布服务')).toBe('连接正常')
      expect(timeOf('未发布服务')).toBe('正在验证…')
      const icon = rowByName('未发布服务').querySelector('.mc-vc-refresh')
      expect(icon.classList.contains('is-spinning')).toBe(true)
      expect(icon.getAttribute('aria-label')).toBe('正在验证')
      await clickRefresh('未发布服务')
      expect(adminApi.healthCheckTool).toHaveBeenCalledTimes(1)
      resolve({ displayStatus: 'HEALTHY', checkedAt: '2026-08-21T10:00:00Z' })
      await flush()
      expect(icon.classList.contains('is-spinning')).toBe(false)
      expect(timeOf('未发布服务')).not.toBe('正在验证…')
    })

    it('从未验证过：悬浮提示「尚未验证过，点击发起验证」（L58）', async () => {
      adminApi.listMcp.mockResolvedValue({ list: [{ ...LIST[0], displayStatus: 'UNKNOWN', lastCheckAt: null, lastCheckedAt: null }], total: 1 })
      await mount()
      const tips = [...rowByName('未发布服务').querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip'))
      expect(tips).toContain('尚未验证过，点击发起验证')
    })
  })

  it('列结构：服务合并列 + 独立状态列 + 引用情况 + 最近更新时间', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.t-cell')].map((c) => c.getAttribute('data-label'))
    // 服务列仍合并名称/描述，但【状态】已拆回独立列
    // （2026-09-11 负责人指示「按照设计图拆出来」，依据《列表页UI.png》——
    //  稿面「状态」是独立一列且紧跟名称列之后；此前 2026-09-01 的「并入名称格」口径作废）。
    expect(labels).not.toContain('服务描述')
    expect(labels).not.toContain('创建时间')
    expect(labels).toContain('状态')
    // 状态列紧跟「服务」列之后
    expect(labels.indexOf('状态')).toBe(labels.indexOf('服务') + 1)
    expect(labels).toEqual(
      expect.arrayContaining(['服务', '状态', '传输方式', '工具数', '引用情况', '最近更新时间', '验证', '操作'])
    )
  })

  it('操作区：「查看」以只读态打开编辑器（审核中也能看）', async () => {
    await mount()
    btn(rowByName('在审服务'), '查看').click()
    await nextTick()
    const ed = container.querySelector('.stub-mcp-editor')
    expect(ed.getAttribute('data-id')).toBe('mc_pending')
    expect(ed.getAttribute('data-readonly')).toBe('1')
  })

  it('操作区：「编辑」以可写态打开编辑器', async () => {
    await mount()
    btn(rowByName('未发布服务'), '编辑').click()
    await nextTick()
    expect(container.querySelector('.stub-mcp-editor').getAttribute('data-readonly')).toBe('0')
  })

  it('发布前置：连通性未通过则「发布」禁用（与模型页同口径）', async () => {
    adminApi.listMcp.mockResolvedValue({
      list: [{ ...LIST[0], displayStatus: 'UNHEALTHY' }],
      total: 1
    })
    await mount()
    const b = btn(rowByName('未发布服务'), '发布')
    expect(b.disabled).toBe(true)
    // 禁用原因走悬浮说明（md §二.3.4 L109 逐字）
    expect(b.closest('[data-tip]')?.getAttribute('data-tip')).toBe('连通性验证通过后才可提交发布（改过连接配置需重新验证）')
  })

  it('聚合态拉取失败的行按「未发布」兜底展示，不阻断整表', async () => {
    marketApi.getMcpServicePublishStatus.mockImplementation((id) =>
      id === 'mc_pub' ? Promise.reject(new Error('boom')) : Promise.resolve({ targets: [{ target: 'USER_END', aggregateStatus: AGG[id] }] })
    )
    await mount()
    // 失败行兜底为未发布，其余行不受影响
    expect(stateOf(rowByName('已上线服务'))).toBe('未发布')
    expect(stateOf(rowByName('在审服务'))).toBe('审核中')
    expect(rowEls()).toHaveLength(LIST.length)
  })

  it('PARTIAL 兜底：存量脏数据不渲染裸枚举，归「未发布」', async () => {
    marketApi.getMcpServicePublishStatus.mockImplementation((id) =>
      Promise.resolve({ targets: [{ target: 'USER_END', aggregateStatus: id === 'mc_pub' ? 'PARTIAL' : AGG[id] }] })
    )
    await mount()
    expect(stateOf(rowByName('已上线服务'))).toBe('未发布')
  })

  /**
   * 2026-09-09 PRD 复核轮 · G4/A12（Q154「要统一，并且设计成选项B的手动触发」）。
   * md prd-连接器-MCP.md §一.3 L25「输入或清除搜索内容后，点击【查询】按钮刷新结果，并回到第 1 页」。
   * 改造前搜索框有 300ms 防抖自动刷新，与【查询】按钮两套并存。
   */
  describe('A12 搜索改手动【查询】', () => {
    /** 工具条上的【查询】按钮（行内按钮都在 .t-row 里，工具条按钮不在） */
    function queryBtn() {
      return [...container.querySelectorAll('.el-button')].find(
        (b) => !b.closest('.t-row') && b.textContent.trim() === '查询'
      )
    }
    const searchInput = () => container.querySelector('.lt-search')

    it('输入关键词不自动刷新（防抖 watch 已删）', async () => {
      await mount()
      const callsBefore = adminApi.listMcp.mock.calls.length
      // 假时钟推过原 300ms 防抖窗口（审计 D1：原来真等 400ms）
      vi.useFakeTimers()
      try {
        const input = searchInput()
        input.value = '报销'
        input.dispatchEvent(new Event('input'))
        await nextTick()
        await vi.advanceTimersByTimeAsync(400)
        expect(adminApi.listMcp.mock.calls.length).toBe(callsBefore)
      } finally {
        vi.useRealTimers()
      }
    })

    it('点【查询】才把关键词下发，并回到第 1 页', async () => {
      await mount()
      const input = searchInput()
      input.value = '报销'
      input.dispatchEvent(new Event('input'))
      await nextTick()
      queryBtn().click()
      await nextTick()
      await nextTick()
      const last = adminApi.listMcp.mock.calls.at(-1)[0]
      expect(last.keyword).toBe('报销')
      expect(last.page).toBe(1)
    })
  })

  /**
   * 2026-09-09 PRD 复核轮 · G4/A13（Q147「采纳选项B」）。
   * md §二.2 L57 只列「连接正常、连接异常、未探测」三态 → MCP 列表的验证列永不出「已停用」。
   * 实现方式是 MCP 消费侧映射（mcpConnStatus），公共件 HealthTag / mcpMeta 不动。
   */
  describe('A13 连接状态三态（删「已停用」）', () => {
    // 局部 import 的真 HealthTag 优先于全局 stub → 断言渲染出的中文标签
    // （HEALTHY=连接正常 / UNHEALTHY=连接异常 / UNKNOWN=未探测 / DISABLED=已停用，见 positionModel.HEALTH_MAP）
    const statusOf = (rowEl) => rowEl.querySelector('.health-tag')?.textContent.trim()

    it('后端下发 DISABLED 的行在列表里折回 UNKNOWN（未探测），不渲染「已停用」', async () => {
      adminApi.listMcp.mockResolvedValue({
        list: [{ ...LIST[0], displayStatus: 'DISABLED' }],
        total: 1
      })
      await mount()
      expect(statusOf(rowByName('未发布服务'))).toBe('未探测')
      expect(rowByName('未发布服务').textContent).not.toContain('已停用')
    })

    it('status=disabled 派生路径同样折回 UNKNOWN（mcpMeta 兜底会给 DISABLED）', async () => {
      adminApi.listMcp.mockResolvedValue({
        list: [{ id: 'mc_none', name: '未发布服务', transport: 'stdio', toolCount: 2, referencedBySkillCount: 0, status: 'disabled' }],
        total: 1
      })
      await mount()
      expect(statusOf(rowByName('未发布服务'))).toBe('未探测')
    })

    it('正常三态原样透出：连接正常 / 连接异常 / 未探测（md §二.2 L57 三态文案）', async () => {
      adminApi.listMcp.mockResolvedValue({
        list: [
          { ...LIST[0], displayStatus: 'HEALTHY' },
          { ...LIST[1], displayStatus: 'UNHEALTHY' },
          { ...LIST[2], displayStatus: 'UNKNOWN' }
        ],
        total: 3
      })
      await mount()
      expect(statusOf(rowByName('未发布服务'))).toBe('连接正常')
      expect(statusOf(rowByName('在审服务'))).toBe('连接异常')
      expect(statusOf(rowByName('已上线服务'))).toBe('未探测')
    })

    it('发布前置仍按「连接正常」判定：DISABLED 折回 UNKNOWN 后【发布】不可点', async () => {
      adminApi.listMcp.mockResolvedValue({
        list: [{ ...LIST[0], displayStatus: 'DISABLED' }],
        total: 1
      })
      await mount()
      expect(btn(rowByName('未发布服务'), '发布').disabled).toBe(true)
    })
  })

  /**
   * 2026-09-12 测试审计补缺口 A6：状态筛选 / 空态两种文案 / 空工具悬浮 / 引用情况弹窗 / 时间列排序。
   */
  describe('A6 导航栏与列字段（md §一.2 L26 / §一.3 L33-34 / §二.1 L47-49）', () => {
    const toolbarBtn = (text) => [...container.querySelectorAll('.el-button')].find((b) => !b.closest('.t-row') && b.textContent.trim() === text)

    it('切换状态筛选 → 立即按 state 刷新并回到第 1 页（md §一.2 L26）；清空 → 不再下发 state', async () => {
      await mount()
      const select = container.querySelectorAll('select')[1]
      select.value = 'PUBLISHED'
      select.dispatchEvent(new Event('change'))
      await flush()
      let last = adminApi.listMcp.mock.calls.at(-1)[0]
      expect(last).toEqual(expect.objectContaining({ state: 'PUBLISHED', page: 1 }))
      select.value = ''
      select.dispatchEvent(new Event('change'))
      await flush()
      last = adminApi.listMcp.mock.calls.at(-1)[0]
      expect(last).not.toHaveProperty('state')
      expect(last.page).toBe(1)
    })

    it('首次暂无数据：空态「还没有 MCP 服务 · 点「新建 MCP」登记第一个」（md §一.3 L33）', async () => {
      adminApi.listMcp.mockResolvedValue({ list: [], total: 0 })
      await mount()
      expect(container.querySelector('[data-testid="list-empty"]').textContent.trim()).toBe('还没有 MCP 服务 · 点「新建 MCP」登记第一个')
      expect(container.querySelector('.list-pager')).toBeNull() // 空态不出分页条
    })

    it('无查询结果：空态改显「没有符合条件的 MCP 服务」，搜索框保留关键词（md §一.3 L34；文案 md 无字面，照代码）', async () => {
      adminApi.listMcp.mockImplementation(async ({ keyword }) => (keyword ? { list: [], total: 0 } : { list: LIST, total: LIST.length }))
      await mount()
      const input = container.querySelector('.lt-search')
      input.value = '不存在'
      input.dispatchEvent(new Event('input'))
      await nextTick()
      toolbarBtn('查询').click()
      await flush()
      expect(container.querySelector('[data-testid="list-empty"]').textContent.trim()).toBe('没有符合条件的 MCP 服务')
      expect(container.querySelector('.lt-search').value).toBe('不存在')
    })

    it('工具数为 0：显「—」并悬浮「尚未拉取到工具，请在编辑器内「拉取工具」」（md §二.1 L47）', async () => {
      await mount()
      const cellEl = rowByName('空工具服务').querySelector('.t-cell[data-label="工具数"]')
      expect(cellEl.textContent.trim()).toBe('—')
      expect(cellEl.querySelector('[data-tip]').getAttribute('data-tip')).toBe('尚未拉取到工具，请在编辑器内「拉取工具」')
      expect(rowByName('已上线服务').querySelector('.t-cell[data-label="工具数"]').textContent.trim()).toBe('4')
    })

    it('引用情况：无引用显「暂无引用」；「2 个技能引用」点击弹「被技能引用」清单列出技能名（md §二.1 L48）', async () => {
      adminApi.listMcp.mockResolvedValue({
        list: [
          LIST[0],
          { ...LIST[2], referencedBySkills: [{ skillId: 'sk_1', skillName: '销售方案生成' }, { skillId: 'sk_2', skillName: '客户问题解答' }] }
        ],
        total: 2
      })
      await mount()
      expect(rowByName('未发布服务').querySelector('.t-cell[data-label="引用情况"]').textContent.trim()).toBe('暂无引用')
      const refBtn = rowByName('已上线服务').querySelector('.mc-refs')
      expect(refBtn.textContent.trim()).toBe('2 个技能引用')
      expect(refBtn.getAttribute('title')).toBe('销售方案生成、客户问题解答')
      expect(container.querySelector('.el-dialog')).toBeNull()
      refBtn.click()
      await flush()
      const dlg = container.querySelector('.el-dialog')
      expect(dlg.getAttribute('data-title')).toBe('被技能引用')
      expect([...dlg.querySelectorAll('.refs-item')].map((e) => e.textContent.trim())).toEqual(['销售方案生成', '客户问题解答'])
      ;[...dlg.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '关闭').click()
      await flush()
      expect(container.querySelector('.el-dialog')).toBeNull()
    })

    it('最近更新时间列头：默认由近到远（↓ / sort=desc）；点一下 → sort=asc 重拉、箭头 ↑（md §二.1 L49）', async () => {
      await mount()
      expect(adminApi.listMcp.mock.calls[0][0].sort).toBe('desc')
      const sortBtn = container.querySelector('.time-sort')
      expect(sortBtn.textContent).toContain('↓')
      sortBtn.click()
      await flush()
      expect(adminApi.listMcp.mock.calls.at(-1)[0].sort).toBe('asc')
      expect(container.querySelector('.time-sort').textContent).toContain('↑')
    })
  })
})
