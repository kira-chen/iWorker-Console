// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * AdminMcp.vue 单测（2026-08-20 改造：表格形态 + 服务级三态发布）。
 *
 * 覆盖：
 * - 三态状态列：未发布 / 审核中 / 已发布（六态聚合归三态，PARTIAL 兜底归「未发布」）；
 * - 操作区按状态显隐：未发布→发布+删除并存；审核中→撤回、编辑锁定、不可删；
 *   已发布→停用、不可删；已停用→重新走发布过审；
 * - 发布/停用/撤回走服务级端点（不传 targets——单目标端，后端归一 USER_END）；
 * - 无工具的服务不允许发布（拦在前端，避免必然失败的请求）。
 *
 * 切断 api/admin、api/market 与 element-plus；EP 组件用轻量存根（el-table 存根按行渲染 default 插槽）。
 */

const adminApi = {
  listMcp: vi.fn(),
  deleteMcp: vi.fn(),
  healthCheckTool: vi.fn()
}
vi.mock('@/api/admin', () => adminApi)

const marketApi = {
  getMcpServicePublishStatus: vi.fn(),
  publishMcpService: vi.fn(),
  delistMcpService: vi.fn(),
  relistMcpService: vi.fn(),
  withdrawMcpService: vi.fn()
}
vi.mock('@/api/market', () => marketApi)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn(), prompt: vi.fn() }
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
  StatusTag: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' },
  HealthTag: { props: ['status'], template: '<span class="health-tag" :data-status="status" />' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-empty': { template: '<div class="el-empty"><slot /></div>' },
  'el-card': { template: '<div class="el-card"><slot /></div>' },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': { props: ['modelValue'], template: '<select><slot /></select>' },
  'el-option': { template: '<option />' },
  'el-tag': { template: '<span class="el-tag"><slot /></span>' },
  'el-tooltip': { props: ['content'], template: '<span class="el-tooltip" :data-tip="content"><slot /></span>' },
  'el-pagination': { props: ['total'], template: '<div class="el-pagination" />' },
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
    template: '<div class="t-cell" :data-label="label"><slot v-if="row" :row="row" /></div>'
  })
  app.component('Search', { template: '<span/>' })
  app.component('Plus', { template: '<span/>' })
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
function btn(rowEl, text) {
  return [...rowEl.querySelectorAll('.el-button')].find((b) => b.textContent.trim().startsWith(text))
}
function texts(rowEl) {
  return [...rowEl.querySelectorAll('.el-button')].map((b) => b.textContent.trim())
}
function stateOf(rowEl) {
  return rowEl.querySelector('.status-tag')?.textContent.trim()
}

// fixture 名互不为子串，避免 rowByName 误命中
const LIST = [
  { id: 'mc_none', name: '未发布服务', transport: 'stdio', toolCount: 2, referencedBySkillCount: 0, status: 'active', icon: '🗺️', displayStatus: 'HEALTHY', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'mc_pending', name: '在审服务', transport: 'streamable-http', toolCount: 3, referencedBySkillCount: 1, status: 'active', displayStatus: 'HEALTHY' },
  { id: 'mc_pub', name: '已上线服务', transport: 'stdio', toolCount: 4, referencedBySkillCount: 2, status: 'active', icon: '/api/public/icons/abc.png', timeoutMs: 30000, displayStatus: 'HEALTHY' },
  { id: 'mc_delisted', name: '已下架服务', transport: 'stdio', toolCount: 1, referencedBySkillCount: 0, status: 'active', displayStatus: 'HEALTHY' },
  { id: 'mc_empty', name: '空工具服务', transport: 'stdio', toolCount: 0, referencedBySkillCount: 0, status: 'active', displayStatus: 'HEALTHY' }
]

const AGG = {
  mc_none: 'NOT_PUBLISHED',
  mc_pending: 'PENDING_REVIEW',
  mc_pub: 'PUBLISHED',
  mc_delisted: 'DELISTED',
  mc_empty: 'NOT_PUBLISHED'
}

describe('AdminMcp · 服务级三态发布（2026-08-20）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.listMcp.mockResolvedValue({ list: LIST, total: LIST.length })
    marketApi.getMcpServicePublishStatus.mockImplementation((id) =>
      Promise.resolve({ mcpId: id, targets: [{ target: 'USER_END', aggregateStatus: AGG[id] }] })
    )
    marketApi.publishMcpService.mockResolvedValue({ affected: 1, skipped: 0 })
    marketApi.delistMcpService.mockResolvedValue({ affected: 1, skipped: 0 })
    marketApi.relistMcpService.mockResolvedValue({ affected: 1, skipped: 0 })
    marketApi.withdrawMcpService.mockResolvedValue({ affected: 1, skipped: 0 })
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

  it('操作区：未发布态「发布」与「删除」并存', async () => {
    await mount()
    const t = texts(rowByName('未发布服务'))
    expect(t).toContain('发布')
    expect(t).toContain('删除')
    expect(t).not.toContain('停用')
    expect(t).not.toContain('撤回')
  })

  it('操作区：已发布态出「停用」，且不可删除', async () => {
    await mount()
    const t = texts(rowByName('已上线服务'))
    expect(t).toContain('停用')
    expect(t).not.toContain('删除')
    expect(t).not.toContain('发布')
  })

  it('操作区：审核中出「撤回」，编辑锁定且不可删除', async () => {
    await mount()
    const row = rowByName('在审服务')
    const t = texts(row)
    expect(t).toContain('撤回')
    expect(t).not.toContain('删除')
    // 编辑按钮存在但被禁用（审核中改了会让审核对象与提交内容不一致）
    expect(btn(row, '编辑').disabled).toBe(true)
  })

  it('操作区：已停用走「发布」重新过审（V99 起无「重新上架」免重审通道）', async () => {
    await mount()
    const t = texts(rowByName('已下架服务'))
    // 与模型页一致：已停用的要恢复必须重新提交过审，不再有免重审的快捷恢复
    expect(t).not.toContain('重新上架')
    expect(t).toContain('发布')
  })

  it('发布：确认后调服务级端点，且不传 targets（单目标端，后端归一 USER_END）', async () => {
    await mount()
    btn(rowByName('未发布服务'), '发布').click()
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(marketApi.publishMcpService).toHaveBeenCalledWith('mc_none', {})
  })

  it('发布：取消确认则不提交', async () => {
    msgBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    btn(rowByName('未发布服务'), '发布').click()
    await nextTick()
    await Promise.resolve()
    expect(marketApi.publishMcpService).not.toHaveBeenCalled()
  })

  it('发布：无工具的服务直接拦下，不发请求', async () => {
    await mount()
    btn(rowByName('空工具服务'), '发布').click()
    await nextTick()
    await Promise.resolve()
    expect(marketApi.publishMcpService).not.toHaveBeenCalled()
    expect(msg.warning).toHaveBeenCalled()
  })

  it('停用 / 撤回 / 发布：各自调对应服务级端点', async () => {
    await mount()
    btn(rowByName('已上线服务'), '停用').click()
    await nextTick()
    await Promise.resolve()
    expect(marketApi.delistMcpService).toHaveBeenCalledWith('mc_pub', {})

    btn(rowByName('在审服务'), '撤回').click()
    await nextTick()
    await Promise.resolve()
    expect(marketApi.withdrawMcpService).toHaveBeenCalledWith('mc_pending', {})

    // 已下架 → 走「发布」重新过审（不再有 relist 端点调用）
    btn(rowByName('已下架服务'), '发布').click()
    await nextTick()
    await Promise.resolve()
    expect(marketApi.publishMcpService).toHaveBeenCalledWith('mc_delisted', {})
    expect(marketApi.relistMcpService).not.toHaveBeenCalled()
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

  it('验证列：点刷新图标发起验证（复用既有检活端点）', async () => {
    adminApi.healthCheckTool.mockResolvedValue({ displayStatus: 'HEALTHY', checkedAt: '2026-08-21T10:00:00Z' })
    await mount()
    rowByName('未发布服务').querySelector('.mc-vc-refresh').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    )
    await nextTick()
    await Promise.resolve()
    expect(adminApi.healthCheckTool).toHaveBeenCalledWith('MCP', 'mc_none')
  })

  it('列结构对齐 PRD-20260828 §二.1（2026-09-01）：服务合并列 + 引用情况 + 最近更新时间', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.t-cell')].map((c) => c.getAttribute('data-label'))
    // 服务列合并名称/描述/状态标签，不再有独立的 服务描述/状态/创建时间 列
    expect(labels).not.toContain('服务描述')
    expect(labels).not.toContain('状态')
    expect(labels).not.toContain('创建时间')
    expect(labels).toEqual(
      expect.arrayContaining(['服务', '传输方式', '工具数', '引用情况', '最近更新时间', '验证', '操作'])
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
    // 禁用原因走悬浮说明，不让用户对着一个灰按钮猜
    expect(
      [...rowByName('未发布服务').querySelectorAll('[data-tip]')].some((e) =>
        (e.getAttribute('data-tip') || '').includes('验证通过')
      )
    ).toBe(true)
  })

  it('页头不再有「N 个已发布服务连通异常」角标；异常信息仍在行内可见', async () => {
    // 2026-08-22 负责人口径：顶部提示与每行「验证」列重复，去掉顶部、保留行内。
    adminApi.listMcp.mockResolvedValue({
      list: [
        { ...LIST[0], displayStatus: 'UNHEALTHY' },
        { ...LIST[2], displayStatus: 'UNHEALTHY' }
      ],
      total: 2
    })
    await mount()
    expect(container.querySelector('.ph-reddot')).toBeNull()
    expect(container.textContent).not.toContain('个已发布服务连通异常')
    // 信息没丢：行内仍显「异常」
    expect(container.textContent).toContain('异常')
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
})
