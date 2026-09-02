// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

/**
 * 双模块报表页（FdeReports / SysConfigReports）单测（设计 §6 / P2）：
 * - stub EChart：单测不在 jsdom 真渲染 canvas，只断言图表组件被挂载（接到非空数据）。
 * - mock @/api/report：分别注入「有数据」「空数据」两种响应，断言指标卡渲染 + 空态。
 * - 断言：指标卡数值正确落地；有分布数据 → 渲染 EChart-stub；分布全空 → 渲染空态、不渲染图表。
 *
 * 不引 @vue/test-utils：createApp 挂 jsdom 容器，存根 EP 容器/结果/空态/图表组件。
 * loading 用 v-loading 指令（vEl 用 noop 指令存根，避免缺失指令告警）。
 */

const fdeApi = { getFdeOverview: vi.fn(), getSysConfigOverview: vi.fn() }
vi.mock('@/api/report', () => fdeApi)
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))

// EChart 替身：渲染一个可识别节点 + 标记是否拿到 build-option（断言"接到数据并尝试渲染图表"）
const EChartStub = {
  name: 'EChart',
  props: ['buildOption', 'colorKeys', 'height'],
  template: '<div class="echart-stub" />'
}
vi.mock('@/components/common/EChart.vue', () => ({ default: EChartStub }))

const stubs = {
  PageHeader: { props: ['title', 'subtitle'], template: '<header><slot /></header>' },
  'el-result': {
    props: ['icon', 'title', 'subTitle'],
    template: '<div class="el-result"><slot name="extra" /></div>'
  },
  'el-button': { template: '<button class="el-button"><slot /></button>' },
  'el-empty': {
    props: ['description', 'imageSize'],
    template: '<div class="el-empty">{{ description }}</div>'
  }
}
// v-loading 指令存根（noop）
const vLoading = { mounted() {}, updated() {} }

let container
let app

async function mountView(Comp) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(Comp) })
  app.directive('loading', vLoading)
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  // 等 onMounted 内 async load() resolve（两个 microtask：await + finally）
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  return container
}

function metricValues(el) {
  return [...el.querySelectorAll('.rp-metric-value')].map((n) => n.textContent.trim())
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  if (!('localStorage' in globalThis) || typeof globalThis.localStorage?.getItem !== 'function') {
    const mem = new Map()
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear()
    }
  }
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('FdeReports 工作台报表', () => {
  it('有数据：指标卡落地真实数字 + 渲染图表（EChart 替身）', async () => {
    fdeApi.getFdeOverview.mockResolvedValue({
      summary: {
        positionTotal: 10,
        positionPublished: 6,
        positionDraft: 4,
        agentTotal: 12,
        skillTotal: 20,
        skillPublished: 15,
        skillDraft: 5,
        dataTableTotal: 8,
        bindingTotal: 30
      },
      distributions: {
        skillByCategory: [
          { label: 'OPERATION', value: 12 },
          { label: 'QUERY', value: 8 }
        ],
        positionClaimTop: [
          { label: '财务报销', value: 20 },
          { label: 'HR 助理', value: 10 }
        ]
      },
      generatedAt: '2026-06-23T10:00:00Z'
    })
    const FdeReports = (await import('@/views/admin/FdeReports.vue')).default
    const el = await mountView(FdeReports)

    // 指标卡：已发布岗位6/草稿4/Agent12/已发布技能15/草稿技能5/数据表8/领用30
    expect(metricValues(el)).toEqual(['6', '4', '12', '15', '5', '8', '30'])
    // 两组分布 → 两个 EChart 替身
    expect(el.querySelectorAll('.echart-stub').length).toBe(2)
    expect(el.querySelector('.el-empty')).toBeNull()
  })

  it('空态：分布全空 → 渲染空态、不渲染图表（指标卡仍在，数值兜底 0）', async () => {
    fdeApi.getFdeOverview.mockResolvedValue({
      summary: {},
      distributions: { skillByCategory: [], positionClaimTop: [] },
      generatedAt: '2026-06-23T10:00:00Z'
    })
    const FdeReports = (await import('@/views/admin/FdeReports.vue')).default
    const el = await mountView(FdeReports)

    expect(el.querySelector('.el-empty')).toBeTruthy()
    expect(el.querySelectorAll('.echart-stub').length).toBe(0)
    // 指标卡仍渲染，缺省值兜底 0
    expect(metricValues(el)).toEqual(['0', '0', '0', '0', '0', '0', '0'])
  })

  it('错误态：接口失败 → 渲染 el-result（重试按钮）', async () => {
    fdeApi.getFdeOverview.mockRejectedValue(new Error('boom'))
    const FdeReports = (await import('@/views/admin/FdeReports.vue')).default
    const el = await mountView(FdeReports)
    expect(el.querySelector('.el-result')).toBeTruthy()
    expect(el.querySelector('.el-button')).toBeTruthy()
  })
})

describe('SysConfigReports 配置报表', () => {
  it('有数据：指标卡落地真实数字 + 三图表（EChart 替身）', async () => {
    fdeApi.getSysConfigOverview.mockResolvedValue({
      summary: {
        connectorTotal: 9,
        mcpTotal: 3,
        apiTotal: 4,
        bizSystemTotal: 2,
        marketTotal: 7,
        marketPendingReview: 2,
        favoriteTotal: 25
      },
      distributions: {
        healthDistribution: [
          { label: 'HEALTHY', value: 5 },
          { label: 'UNHEALTHY', value: 1 },
          { label: 'UNKNOWN', value: 3 }
        ],
        marketByStatus: [
          { label: 'PUBLISHED', value: 4 },
          { label: 'PENDING_REVIEW', value: 2 }
        ],
        favoriteTop: [{ label: 'tool.a', value: 12 }]
      },
      generatedAt: '2026-06-23T10:00:00Z'
    })
    const SysConfigReports = (await import('@/views/admin/SysConfigReports.vue')).default
    const el = await mountView(SysConfigReports)

    // MCP3/API4/业务系统2/市场总数7/待审核2/收藏25
    expect(metricValues(el)).toEqual(['3', '4', '2', '7', '2', '25'])
    // 三组分布 → 三个 EChart 替身
    expect(el.querySelectorAll('.echart-stub').length).toBe(3)
    expect(el.querySelector('.el-empty')).toBeNull()
  })

  it('空态：分布全空 → 渲染空态、不渲染图表', async () => {
    fdeApi.getSysConfigOverview.mockResolvedValue({
      summary: {},
      distributions: { healthDistribution: [], marketByStatus: [], favoriteTop: [] },
      generatedAt: '2026-06-23T10:00:00Z'
    })
    const SysConfigReports = (await import('@/views/admin/SysConfigReports.vue')).default
    const el = await mountView(SysConfigReports)
    expect(el.querySelector('.el-empty')).toBeTruthy()
    expect(el.querySelectorAll('.echart-stub').length).toBe(0)
  })
})
