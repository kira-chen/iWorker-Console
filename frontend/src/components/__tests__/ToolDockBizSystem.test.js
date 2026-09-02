// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ToolDock「业务系统」Tab 回归保护（biz__undefined 修复）。
 *
 * 背景：列表 VO 去 code（契约 §4.5.3）后，ToolDock 原 BIZ_SYSTEM 分支特殊调 listBizSystems
 * + bizSystemsToTools(读 b.code) → 产生 biz__undefined。修复：四类 Tab 统一走 listToolPicker
 * （后端 ToolPickerService 返回带正确 biz__<code> 的工具项）。
 *
 * 本测试断言：
 * 1) 切到 BIZ_SYSTEM Tab 时，ToolDock 调用的是 listToolPicker({type:'BIZ_SYSTEM'})，
 *    且不再调用 listBizSystems（旧特殊分支已删）。
 * 2) 渲染出的工具 code 为后端真实 biz__<code>（biz__crm_probe），绝非 biz__undefined。
 * 3) 点击「插入」emit('insert', 'biz__crm_probe', ...)，回传真实 code。
 *
 * 不引 @vue/test-utils：createApp 挂 jsdom + 存根 el 图标 / v-loading 指令。
 */

// 模拟 tool-picker：BIZ_SYSTEM 返回后端真实形态（code=biz__crm_probe）
const listToolPickerMock = vi.fn()
const listBizSystemsMock = vi.fn()

vi.mock('@/api/position', () => ({
  listToolPicker: (...a) => listToolPickerMock(...a)
}))
vi.mock('@/api/admin', () => ({
  listBizSystems: (...a) => listBizSystemsMock(...a)
}))
vi.mock('@/api/dataTable', () => ({
  listDataTables: vi.fn(),
  getDataTable: vi.fn()
}))

import ToolDock from '@/components/position/ToolDock.vue'

const iconStub = { template: '<i><slot /></i>' }
const stubs = {
  'el-icon': iconStub,
  'el-dialog': { template: '<div><slot /></div>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div><slot /></div>' }
}

let container
let app
let lastInsert

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  lastInsert = null
  app = createApp({
    render: () =>
      h(ToolDock, {
        collapsed: false,
        positionId: 5,
        skillName: '测试技能',
        ...props,
        onInsert: (code, bizName) => {
          lastInsert = { code, bizName }
        }
      })
  })
  // v-loading 指令存根（无副作用）
  app.directive('loading', {})
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}

describe('ToolDock 业务系统 Tab —— biz__undefined 回归保护', () => {
  beforeEach(() => {
    listToolPickerMock.mockReset()
    listBizSystemsMock.mockReset()
    // 默认：MCP（初始 tab）返回空；BIZ_SYSTEM 返回真实形态
    listToolPickerMock.mockImplementation(async (params) => {
      if (params?.type === 'BIZ_SYSTEM') {
        return [
          {
            type: 'BIZ_SYSTEM',
            code: 'biz__crm_probe',
            bizName: 'CRM探针系统',
            description: null,
            displayStatus: 'UNKNOWN'
          }
        ]
      }
      return []
    })
  })
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('切到业务系统 Tab：走 listToolPicker(type=BIZ_SYSTEM)，不调 listBizSystems', async () => {
    const el = mount()
    await nextTick()
    // 找到「业务系统」Tab 并点击
    const tabs = [...el.querySelectorAll('.dock-tab')]
    const bizTab = tabs.find((t) => t.textContent.trim() === '业务系统')
    expect(bizTab).toBeTruthy()
    bizTab.click()
    await nextTick()
    await nextTick()

    // 断言：tool-picker 被以 BIZ_SYSTEM 调过；listBizSystems 从未被调
    const calledBiz = listToolPickerMock.mock.calls.some((c) => c[0]?.type === 'BIZ_SYSTEM')
    expect(calledBiz).toBe(true)
    expect(listBizSystemsMock).not.toHaveBeenCalled()
  })

  it('渲染真实 biz__<code>，不是 biz__undefined', async () => {
    const el = mount()
    await nextTick()
    const bizTab = [...el.querySelectorAll('.dock-tab')].find(
      (t) => t.textContent.trim() === '业务系统'
    )
    bizTab.click()
    await nextTick()
    await nextTick()

    const tool = el.querySelector('.dtool')
    expect(tool).toBeTruthy()
    // 工具卡 title 属性即 tool.code
    expect(tool.getAttribute('title')).toBe('biz__crm_probe')
    expect(tool.getAttribute('title')).not.toContain('undefined')
    // 业务名展示
    expect(el.querySelector('.dtool-name').textContent).toContain('CRM探针系统')
  })

  it('点击「插入」回传真实 code biz__crm_probe', async () => {
    const el = mount()
    await nextTick()
    const bizTab = [...el.querySelectorAll('.dock-tab')].find(
      (t) => t.textContent.trim() === '业务系统'
    )
    bizTab.click()
    await nextTick()
    await nextTick()

    el.querySelector('.dtool-insert').click()
    await nextTick()
    expect(lastInsert).toBeTruthy()
    expect(lastInsert.code).toBe('biz__crm_probe')
    expect(lastInsert.bizName).toBe('CRM探针系统')
  })
})
