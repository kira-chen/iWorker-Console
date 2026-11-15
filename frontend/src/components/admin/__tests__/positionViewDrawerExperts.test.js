// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * 岗位查看抽屉 · 「专家与专家团」区（产品优化需求-202611 R13 §2 / §5）。
 * 引用关系随岗位发布生效：读快照时展示快照里提交审核那一刻的引用，不随之后的增减变化；
 * 快照里没有这一块（模块初始化时补播的种子在审行）或不是读快照时，才实时取当前引用。
 */
const getPositionExperts = vi.fn()
vi.mock('@/api/position', () => ({
  getPositionExperts: (...a) => getPositionExperts(...a),
  getPosition: vi.fn(() => Promise.resolve({ positionId: 401, name: '经营分析岗', skills: [] }))
}))
vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: { props: ['visible'], template: '<div class="drawer-stub"><slot /><slot name="footer" /></div>' }
}))
vi.mock('@/components/common/IconField.vue', () => ({ default: { template: '<i class="icon-stub" />' } }))

const PositionViewDrawer = (await import('@/components/admin/PositionViewDrawer.vue')).default

let app, container
async function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionViewDrawer, { visible: true, positionId: 401, ...props }) })
  app.component('el-tag', { template: '<span class="el-tag"><slot /></span>' })
  app.mount(container)
  // 组件里 await import('@/api/position') 后才取数，按宏任务多刷几轮
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}
const section = () => container.querySelector('[data-testid="pvd-experts"]')
const tags = () => [...section().querySelectorAll('.el-tag')].map((t) => t.textContent.trim())

beforeEach(() => {
  getPositionExperts.mockReset()
  getPositionExperts.mockResolvedValue({ experts: [{ expertId: 201, name: '当前引用的专家' }], teams: [] })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('PositionViewDrawer · 专家与专家团', () => {
  it('快照带了提交时的引用 → 展示快照里的专家与专家团，标「提交审核时引用」，不取当前引用', async () => {
    const snapshot = {
      kind: 'POSITION',
      refId: 401,
      detail: {
        name: '经营分析岗',
        skills: [],
        expertRefs: { experts: [{ expertId: 205, name: '经营数据核查专家' }], teams: [{ teamId: 304, name: '经营复盘团' }] }
      }
    }
    await mount({ snapshot })
    expect(tags()).toEqual(['经营数据核查专家', '经营复盘团'])
    expect(section().querySelector('.section-sub').textContent.trim()).toBe('提交审核时引用的岗位私有专家与专家团')
    expect(getPositionExperts).not.toHaveBeenCalled()
  })

  it('快照里没有这一块（种子在审行）→ 回落到当前引用，并标「当前引用」', async () => {
    await mount({ snapshot: { kind: 'POSITION', refId: 401, detail: { name: '经营分析岗', skills: [] } } })
    expect(getPositionExperts).toHaveBeenCalledWith(401)
    expect(tags()).toEqual(['当前引用的专家'])
    expect(section().querySelector('.section-sub').textContent.trim()).toBe('当前引用的岗位私有专家与专家团')
  })

  it('不是读快照（无 snapshot）→ 取当前引用', async () => {
    await mount({})
    expect(getPositionExperts).toHaveBeenCalledWith(401)
    expect(tags()).toEqual(['当前引用的专家'])
  })
})

describe('PositionViewDrawer · SOP 简版（产品优化需求-202611 修改点 18）', () => {
  it('快照里有 SOP 简版 → 「SOP 简版」一栏展示；没有 → 「—」', async () => {
    await mount({ snapshot: { kind: 'POSITION', refId: 401, detail: { name: '经营分析岗', skills: [], positionSopBrief: '1. 确认目标\n2. 输出结论' } } })
    expect(container.querySelector('[data-testid="pvd-sop-brief"]').textContent).toContain('1. 确认目标')
    app.unmount()
    container.remove()
    await mount({ snapshot: { kind: 'POSITION', refId: 401, detail: { name: '经营分析岗', skills: [] } } })
    expect(container.querySelector('[data-testid="pvd-sop-brief"] .pvd-readonly').textContent.trim()).toBe('—')
  })
})
