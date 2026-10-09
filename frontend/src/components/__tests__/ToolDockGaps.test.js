// @vitest-environment jsdom
/**
 * ToolDock 工具坞 —— 缺口补测（2026-10-08）。
 *
 * 对齐 md：docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §7 工具引用区（右栏）
 *   - 「可整体收起 / 展开；上半区"选择工具"，下半区"本技能已引用"」；
 *   - 「工具分类仅展示"MCP、API、业务系统"三个页签；支持按工具标识或名称搜索」（技能编辑器语境经 props.tabs 传入）；
 *   - 「工具卡展示名称、连接状态和描述；点击【＋ 插入】在当前文档光标处插入 @tool(工具名) 引用」
 *     （插入与「已插入工具引用」提示由父级 SkillFocusEditor 执行，本组件只上抛 insert(code, 业务名)）；
 *   - 「当前分类无可用工具时展示"该类暂无工具，去连接器接入"，点击后跳转连接器页面」；
 *   - 「已引用区展示引用名称；点击【×】移除引用」「只读态仅保留"本技能已引用"供查看，不提供插入和移除」。
 * 岗位工作台语境（不传 tabs 的默认四页签含「数据表」）：数据表按岗位隔离，未绑定岗位时禁用；表结构弹层。
 *
 * 已有用例：ToolDockPlatform（数据源分流 / 默认四页签 / 单根 class）、ToolDockBizSystem（业务系统 code 回归）。
 * 本文件补：收起 / 展开与按需拉取、搜索 debounce 与关键词 trim、加载失败重试、两种空态、工具卡名称 / 连接状态 / 写类⚠ / 描述、
 *   插入回传、页签覆写与回落、数据表禁用与降级说明、数据表 positionId 透传与表结构弹层（成功 / 找不到表 / 失败 / 缓存与切岗失效）、
 *   只读态、已引用区 locate / remove-ref 上抛、卸载清理 debounce 定时器。
 *
 * 已知缺陷 yuepu#50（工具坞会列出未发布 / 停用连接器）属数据层 toolPicker 过滤问题，已在 src/api/__tests__/knownDefects.test.js 钉桩；
 * 本文件只验证组件按数据层返回渲染，不把「列出已停用工具」写成正常断言（用例数据只用 HEALTHY / UNHEALTHY / 无状态）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref, provide, inject } from 'vue'

const listToolPickerMock = vi.fn()
const listDataTablesMock = vi.fn()
const getDataTableMock = vi.fn()
vi.mock('@/api/position', () => ({ listToolPicker: (...a) => listToolPickerMock(...a) }))
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { toolPicker: vi.fn(() => Promise.resolve([])) },
  systemSkillApi: { toolPicker: vi.fn(() => Promise.resolve([])) }
}))
vi.mock('@/api/dataTable', () => ({
  listDataTables: (...a) => listDataTablesMock(...a),
  getDataTable: (...a) => getDataTableMock(...a)
}))

import ToolDock from '@/components/position/ToolDock.vue'

async function flush(n = 6) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/* ---------- stubs：el-table 逐行渲染列（列 default 插槽拿到 row），dialog 按 v-model 显隐 ---------- */
const RowCtx = {
  props: ['row'],
  setup(p, { slots }) {
    provide('stubRow', p.row)
    return () => h('div', { class: 'stub-row' }, slots.default?.())
  }
}
const stubs = {
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-dialog': {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="stub-dialog" :data-title="title"><slot /></div>'
  },
  'el-table': {
    props: ['data'],
    setup(p, { slots }) {
      return () => h('div', { class: 'stub-table' }, (p.data || []).map((r) => h(RowCtx, { row: r }, () => slots.default?.())))
    }
  },
  'el-table-column': {
    props: ['prop', 'label'],
    setup(p, { slots }) {
      const row = inject('stubRow', null)
      return () =>
        row
          ? h('span', { class: 'stub-cell', 'data-label': p.label }, slots.default ? slots.default({ row }) : String(row[p.prop] ?? ''))
          : null
    }
  },
  'router-link': {
    props: ['to'],
    template: '<a class="stub-link" :data-to="JSON.stringify(to)"><slot /></a>'
  }
}

let app, container, events
const state = { props: null }
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  events = { insert: [], collapsed: [], locate: [], remove: [] }
  state.props = ref({ collapsed: false, positionId: 5, ...props })
  app = createApp({
    render: () =>
      h(ToolDock, {
        ...state.props.value,
        onInsert: (code, name) => events.insert.push([code, name]),
        'onUpdate:collapsed': (v) => events.collapsed.push(v),
        onLocate: (r) => events.locate.push(r),
        onRemoveRef: (r) => events.remove.push(r)
      })
  })
  app.directive('loading', {})
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}
const setProps = async (patch) => {
  state.props.value = { ...state.props.value, ...patch }
  await flush()
}
const tabEl = (label) => [...container.querySelectorAll('.dock-tab')].find((t) => t.textContent.trim() === label)
const emptyText = () => container.querySelector('.dock-empty')?.textContent.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  listToolPickerMock.mockReset()
  listToolPickerMock.mockResolvedValue([])
  listDataTablesMock.mockReset()
  getDataTableMock.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  app?.unmount()
  container?.remove()
  app = null
})

/* ============================ 收起 / 展开 ============================ */
describe('ToolDock · 整体收起 / 展开（md 技能 §7「可整体收起 / 展开」）', () => {
  it('收起态 → 只渲染「展开」细条，不渲染选择工具 / 已引用区，也不拉工具清单', async () => {
    mount({ collapsed: true })
    await flush()
    const toggle = container.querySelector('.dock-rail-toggle')
    expect(toggle?.getAttribute('aria-label')).toBe('展开工具引用抽屉')
    expect(toggle.textContent).toContain('工具')
    expect(container.querySelector('.dock-pick-title')).toBeNull()
    expect(container.querySelector('.ref-panel')).toBeNull()
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('点展开细条 → 上抛 update:collapsed=false；父级改为展开后才拉当前页签清单', async () => {
    mount({ collapsed: true })
    await flush()
    container.querySelector('.dock-rail-toggle').click()
    expect(events.collapsed).toEqual([false])
    await setProps({ collapsed: false })
    expect(listToolPickerMock).toHaveBeenCalledTimes(1)
    expect(listToolPickerMock).toHaveBeenCalledWith({ type: 'MCP' })
  })

  it('展开态 → 标题「工具引用」，上「选择工具」下「本技能已引用」；点收起上抛 update:collapsed=true', async () => {
    mount()
    await flush()
    expect(container.querySelector('.dock-title').textContent.trim()).toBe('工具引用')
    const inner = container.querySelector('.dock-inner')
    const pick = inner.querySelector('.dock-pick-title')
    const refHead = inner.querySelector('.ref-panel-head')
    expect(pick.textContent.trim()).toBe('选择工具')
    expect(refHead.textContent.trim()).toBe('本技能已引用')
    // 上下顺序：选择工具在前
    expect(pick.compareDocumentPosition(refHead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    container.querySelector('.dock-collapse').click()
    expect(events.collapsed).toEqual([true])
  })
})

/* ============================ 搜索 ============================ */
describe('ToolDock · 搜索（md 技能 §7「支持按工具标识或名称搜索」）', () => {
  it('输入关键词 → 250ms 防抖后按当前页签带 trim 后的 keyword 重拉；连续输入只发最后一次', async () => {
    vi.useFakeTimers()
    mount()
    await flush()
    listToolPickerMock.mockClear()
    const input = container.querySelector('.dock-search')
    expect(input.getAttribute('placeholder')).toBe('搜 code / 名称…')
    input.value = 'cr'
    input.dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(100)
    input.value = '  crm  '
    input.dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(249)
    expect(listToolPickerMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flush()
    expect(listToolPickerMock).toHaveBeenCalledTimes(1)
    expect(listToolPickerMock).toHaveBeenCalledWith({ type: 'MCP', keyword: 'crm' })
  })

  it('关键词全为空白 → 不带 keyword 参数', async () => {
    vi.useFakeTimers()
    mount()
    await flush()
    listToolPickerMock.mockClear()
    const input = container.querySelector('.dock-search')
    input.value = '   '
    input.dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(250)
    await flush()
    expect(listToolPickerMock).toHaveBeenCalledWith({ type: 'MCP' })
  })

  it('防抖期间被收起 → 到点不再拉取', async () => {
    vi.useFakeTimers()
    mount()
    await flush()
    listToolPickerMock.mockClear()
    const input = container.querySelector('.dock-search')
    input.value = 'crm'
    input.dispatchEvent(new Event('input'))
    await setProps({ collapsed: true })
    vi.advanceTimersByTime(300)
    await flush()
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('卸载时清理防抖定时器 → 卸载后到点不再拉取', async () => {
    vi.useFakeTimers()
    mount()
    await flush()
    listToolPickerMock.mockClear()
    const input = container.querySelector('.dock-search')
    input.value = 'crm'
    input.dispatchEvent(new Event('input'))
    app.unmount()
    app = null
    vi.advanceTimersByTime(300)
    await flush()
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('平台数据源带关键词 → platformSkillApi.toolPicker({type, keyword})', async () => {
    vi.useFakeTimers()
    const { platformSkillApi } = await import('@/api/platformSkill')
    mount({ skillSource: 'platform', positionId: null })
    await flush()
    const input = container.querySelector('.dock-search')
    input.value = 'mail'
    input.dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(250)
    await flush()
    expect(platformSkillApi.toolPicker).toHaveBeenLastCalledWith({ type: 'MCP', keyword: 'mail' })
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })
})

/* ============================ 加载失败 / 空态 ============================ */
describe('ToolDock · 加载失败与空态（md 技能 §7「该类暂无工具，去连接器接入」）', () => {
  it('清单加载失败 → 「工具清单加载失败 · 重试」，点重试重拉并恢复', async () => {
    listToolPickerMock.mockRejectedValueOnce(new Error('500'))
    mount()
    await flush()
    expect(emptyText()).toBe('工具清单加载失败 · 重试')
    listToolPickerMock.mockResolvedValueOnce([{ code: 'mcp__crm', bizName: 'CRM 查询', checkStatus: 'HEALTHY' }])
    container.querySelector('.dock-retry').click()
    await flush()
    expect(listToolPickerMock).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.dock-empty')).toBeNull()
    expect(container.querySelector('.dtool-name').textContent.trim()).toBe('CRM 查询')
  })

  it('技能编辑器语境（connectorEmptyLink）无工具 → 「该类暂无工具，去连接器接入」，链接指向连接器页', async () => {
    mount({ connectorEmptyLink: true, tabs: ['MCP', 'API', 'BIZ_SYSTEM'] })
    await flush()
    expect(emptyText()).toBe('该类暂无工具，去连接器接入')
    const link = container.querySelector('.dock-empty .stub-link')
    expect(link.textContent.trim()).toBe('去连接器接入')
    expect(JSON.parse(link.dataset.to)).toEqual({ name: 'AdminConnector' })
  })

  it('岗位工作台语境（未开链接）无工具 → 旧文案「该类暂无工具 · 去工具管理接入」，无链接', async () => {
    mount()
    await flush()
    expect(emptyText()).toBe('该类暂无工具 · 去工具管理接入')
    expect(container.querySelector('.dock-empty .stub-link')).toBeNull()
  })

  it('接口返回 { items } 包装 → 同样渲染工具卡', async () => {
    listToolPickerMock.mockResolvedValueOnce({ items: [{ code: 'mcp__a', bizName: '工具A' }] })
    mount()
    await flush()
    expect(container.querySelectorAll('.dtool')).toHaveLength(1)
  })
})

/* ============================ 工具卡 / 插入 ============================ */
describe('ToolDock · 工具卡与插入（md 技能 §7「工具卡展示名称、连接状态和描述；点击【＋ 插入】」）', () => {
  const TOOLS = [
    { code: 'mcp__crm', bizName: 'CRM 查询', displayStatus: 'HEALTHY', checkStatus: 'UNHEALTHY', description: '查客户档案' },
    { code: 'mcp__erp', name: 'ERP 下单', checkStatus: 'UNHEALTHY', requiresConfirmation: true },
    { code: 'mcp__raw' }
  ]
  const cards = () => [...container.querySelectorAll('.dtool')]

  it('名称按 业务名 → name → code 兜底；连接状态 displayStatus 优先、无状态显示「未探测」；写类带⚠；有描述才出描述', async () => {
    listToolPickerMock.mockResolvedValueOnce(TOOLS)
    mount()
    await flush()
    const [a, b, c] = cards()
    expect(a.querySelector('.dtool-name').textContent.trim()).toBe('CRM 查询')
    expect(a.querySelector('.health').textContent.trim()).toBe('连接正常')
    expect(a.querySelector('.health').classList.contains('h-ok')).toBe(true)
    expect(a.querySelector('.dtool-desc').textContent.trim()).toBe('查客户档案')
    expect(a.querySelector('.wflag')).toBeNull()
    expect(a.getAttribute('title')).toBe('mcp__crm')

    expect(b.querySelector('.dtool-name').textContent.trim()).toBe('ERP 下单')
    expect(b.querySelector('.health').textContent.trim()).toBe('连接异常')
    expect(b.querySelector('.wflag').getAttribute('title')).toBe('写类工具，执行前需确认')
    expect(b.querySelector('.dtool-desc')).toBeNull()

    expect(c.querySelector('.dtool-name').textContent.trim()).toBe('mcp__raw')
    expect(c.querySelector('.health').textContent.trim()).toBe('未探测')
  })

  it('点【＋ 插入】→ 上抛 insert(工具 code, 业务名)；无业务名回传 name，再无回传空串', async () => {
    listToolPickerMock.mockResolvedValueOnce(TOOLS)
    mount()
    await flush()
    cards().forEach((c) => c.querySelector('.dtool-insert').click())
    expect(events.insert).toEqual([
      ['mcp__crm', 'CRM 查询'],
      ['mcp__erp', 'ERP 下单'],
      ['mcp__raw', '']
    ])
    expect(cards()[0].querySelector('.dtool-insert').textContent.trim()).toBe('＋ 插入')
  })
})

/* ============================ 页签 ============================ */
describe('ToolDock · 页签（md 技能 §7「仅展示 MCP、API、业务系统三个页签」）', () => {
  it('技能编辑器传 tabs=[MCP, API, BIZ_SYSTEM] → 恰好三个页签，未知类型码被忽略；悬浮为说人话提示', async () => {
    mount({ tabs: ['MCP', 'API', 'BIZ_SYSTEM', 'UNKNOWN'] })
    await flush()
    const labels = [...container.querySelectorAll('.dock-tab')].map((t) => t.textContent.trim())
    expect(labels).toEqual(['MCP', 'API', '业务系统'])
    expect(tabEl('MCP').classList.contains('on')).toBe(true)
    expect(tabEl('业务系统').getAttribute('title')).toBe('业务系统：可对接的内部业务系统。')
  })

  it('页签集合变化使当前页签不可见 → 回落第一个页签并重拉', async () => {
    mount({ tabs: ['MCP', 'API', 'BIZ_SYSTEM'] })
    await flush()
    tabEl('业务系统').click()
    await flush()
    expect(listToolPickerMock).toHaveBeenLastCalledWith({ type: 'BIZ_SYSTEM' })
    await setProps({ tabs: ['API', 'MCP'] })
    expect(tabEl('API').classList.contains('on')).toBe(true)
    expect(listToolPickerMock).toHaveBeenLastCalledWith({ type: 'API' })
  })

  it('空数组 tabs → 视同未传，回到默认四页签', async () => {
    mount({ tabs: [] })
    await flush()
    expect([...container.querySelectorAll('.dock-tab')].map((t) => t.textContent.trim())).toEqual([
      'MCP',
      'API',
      '数据表',
      '业务系统'
    ])
  })
})

/* ============================ 数据表（岗位工作台语境） ============================ */
describe('ToolDock · 数据表页签（按岗位隔离）', () => {
  const TABLE_TOOLS = [
    { code: 'table__orders', bizName: '订单表', description: '销售订单' },
    { code: 'table__users', name: '用户表' }
  ]

  it('未绑定岗位（positionId=null）→ 「数据表」页签置灰带说明，点击不切换、不发查询', async () => {
    mount({ positionId: null })
    await flush()
    const t = tabEl('数据表')
    expect(t.classList.contains('disabled')).toBe(true)
    expect(t.getAttribute('title')).toBe('该技能未绑定岗位，数据表按岗位隔离，暂不可引用')
    listToolPickerMock.mockClear()
    t.click()
    await flush()
    expect(tabEl('MCP').classList.contains('on')).toBe(true)
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('停在数据表时岗位被解绑 → 列表区改为降级说明；再拉清单也不发查询', async () => {
    listToolPickerMock.mockImplementation(async (p) => (p.type === 'TABLE' ? TABLE_TOOLS : []))
    mount({ positionId: 5 })
    await flush()
    tabEl('数据表').click()
    await flush()
    await setProps({ positionId: null })
    expect(emptyText()).toContain('该技能未绑定岗位 · 数据表按岗位隔离，暂不可引用')
    expect(emptyText()).toContain('可在岗位白板里将技能归入某岗位后再引用数据表')
    // 收起再展开会触发重拉：降级分支不发查询
    listToolPickerMock.mockClear()
    await setProps({ collapsed: true })
    await setProps({ collapsed: false })
    expect(listToolPickerMock).not.toHaveBeenCalled()
  })

  it('已绑定岗位切到数据表 → listToolPicker({type:TABLE, positionId})，一张表一张卡（表名 / 描述 / 插入回传表级 code）', async () => {
    listToolPickerMock.mockImplementation(async (p) => (p.type === 'TABLE' ? TABLE_TOOLS : []))
    mount({ positionId: 5 })
    await flush()
    tabEl('数据表').click()
    await flush()
    expect(listToolPickerMock).toHaveBeenLastCalledWith({ type: 'TABLE', positionId: 5 })
    const groups = [...container.querySelectorAll('.dgroup')]
    expect(groups.map((g) => g.querySelector('.dgroup-name').textContent.trim())).toEqual(['订单表', '用户表'])
    expect(groups[0].querySelector('.dgroup-desc').textContent.trim()).toBe('销售订单')
    expect(groups[1].querySelector('.dgroup-desc')).toBeNull()
    expect(container.querySelector('.dtool')).toBeNull()
    groups[0].querySelector('.dtool-insert').click()
    expect(events.insert).toEqual([['table__orders', '订单表']])
  })

  async function openTableTab() {
    listToolPickerMock.mockImplementation(async (p) => (p.type === 'TABLE' ? TABLE_TOOLS : []))
    mount({ positionId: 5 })
    await flush()
    tabEl('数据表').click()
    await flush()
  }
  const structBtn = (i) => [...container.querySelectorAll('.dgroup-struct')][i]
  const dialog = () => document.querySelector('.stub-dialog')

  it('点表结构 → 按 tableCode 定位表 id 拉详情，弹层标题 / 编码 / 描述 + 只列业务字段（过滤系统字段）', async () => {
    await openTableTab()
    listDataTablesMock.mockResolvedValueOnce({ list: [{ id: 11, tableCode: 'orders' }, { id: 12, tableCode: 'users' }] })
    getDataTableMock.mockResolvedValueOnce({
      label: '订单',
      tableCode: 'orders',
      description: '订单明细',
      fields: [
        { label: 'UID', fieldCode: 'uid', isSystem: true },
        { label: '金额', fieldCode: 'amount', fieldType: 'NUMBER', required: true, fieldDesc: '含税' },
        { label: '备注', fieldCode: 'memo', fieldType: 'TEXT', required: false }
      ]
    })
    structBtn(0).click()
    await flush()
    expect(listDataTablesMock).toHaveBeenCalledWith(5)
    expect(getDataTableMock).toHaveBeenCalledWith(5, 11)
    expect(dialog().dataset.title).toBe('表结构 · 订单')
    expect(dialog().querySelector('.struct-code').textContent.trim()).toBe('orders')
    expect(dialog().querySelector('.struct-desc').textContent.trim()).toBe('订单明细')
    const rows = [...dialog().querySelectorAll('.stub-row')]
    expect(rows).toHaveLength(2)
    const cell = (r, label) => r.querySelector(`.stub-cell[data-label="${label}"]`).textContent.trim()
    expect(cell(rows[0], '字段名')).toBe('金额')
    expect(cell(rows[0], '字段编码')).toBe('amount')
    expect(cell(rows[0], '必填')).toBe('是')
    expect(cell(rows[0], '描述')).toBe('含税')
    expect(cell(rows[1], '必填')).toBe('否')
    expect(cell(rows[1], '描述')).toBe('—')
    expect(cell(rows[1], '类型')).not.toBe('')
  })

  it('清单里找不到该表 id → 保留标题，展示「该表暂无业务字段」，不拉详情', async () => {
    await openTableTab()
    listDataTablesMock.mockResolvedValueOnce([{ id: 12, tableCode: 'users' }])
    structBtn(0).click()
    await flush()
    expect(getDataTableMock).not.toHaveBeenCalled()
    expect(dialog().dataset.title).toBe('表结构 · 订单表')
    expect(dialog().querySelector('.struct-empty').textContent.trim()).toBe('该表暂无业务字段')
  })

  it('读表详情失败 → 关闭弹层（错误由全局拦截器提示）', async () => {
    await openTableTab()
    listDataTablesMock.mockResolvedValueOnce({ list: [{ id: 11, tableCode: 'orders' }] })
    getDataTableMock.mockRejectedValueOnce(new Error('403'))
    structBtn(0).click()
    await flush()
    expect(dialog()).toBeNull()
  })

  it('同岗位内表 id 映射有缓存：连点两张表只拉一次清单；切岗位后缓存失效重新拉', async () => {
    await openTableTab()
    listDataTablesMock.mockResolvedValue({ list: [{ id: 11, tableCode: 'orders' }, { id: 12, tableCode: 'users' }] })
    getDataTableMock.mockResolvedValue({ fields: [] })
    structBtn(0).click()
    await flush()
    structBtn(1).click()
    await flush()
    expect(listDataTablesMock).toHaveBeenCalledTimes(1)
    expect(getDataTableMock.mock.calls.map((c) => c[1])).toEqual([11, 12])
    // 无 label 时标题回落表名
    expect(dialog().dataset.title).toBe('表结构 · 用户表')
    await setProps({ positionId: 6 })
    structBtn(0).click()
    await flush()
    expect(listDataTablesMock).toHaveBeenCalledTimes(2)
    expect(listDataTablesMock).toHaveBeenLastCalledWith(6)
  })
})

/* ============================ 只读 / 已引用区 ============================ */
describe('ToolDock · 只读态与已引用区（md 技能 §7「只读态仅保留"本技能已引用"供查看，不提供插入和移除」）', () => {
  const REFS = [{ code: 'mcp__crm', bizName: 'CRM 查询', count: 1, checkStatus: 'HEALTHY', known: true }]

  it('只读态 → 不渲染选择工具（搜索 / 页签 / 插入），不拉清单；已引用区仍展示引用名称且无移除入口', async () => {
    mount({ readonly: true, referencedView: REFS })
    await flush()
    expect(container.querySelector('.dock-pick-title')).toBeNull()
    expect(container.querySelector('.dock-search')).toBeNull()
    expect(container.querySelector('.dock-tab')).toBeNull()
    expect(container.querySelector('.dtool-insert')).toBeNull()
    expect(listToolPickerMock).not.toHaveBeenCalled()
    expect(container.querySelector('.ref-panel-head').textContent.trim()).toBe('本技能已引用')
    expect(container.querySelector('.ref-panel').textContent).toContain('CRM 查询')
    expect(container.querySelector('.ref-panel .ref-x')).toBeNull()
  })

  it('只读态无引用 → 已引用区只读空态文案', async () => {
    mount({ readonly: true })
    await flush()
    expect(container.querySelector('.ref-empty').textContent.trim()).toBe('该技能正文未引用任何工具')
  })

  it('编辑态已引用区：点行上抛 locate，点【×】上抛 remove-ref（由父级定位 / 移除正文引用）', async () => {
    mount({ referencedView: REFS })
    await flush()
    const row = container.querySelector('.ref-row')
    row.click()
    expect(events.locate).toEqual([expect.objectContaining({ code: 'mcp__crm' })])
    const x = row.querySelector('.ref-x')
    expect(x.getAttribute('title')).toBe('移除引用')
    x.click()
    expect(events.remove).toEqual([expect.objectContaining({ code: 'mcp__crm' })])
  })
})
