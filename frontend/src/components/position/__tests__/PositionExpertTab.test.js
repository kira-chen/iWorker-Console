// @vitest-environment jsdom
/**
 * 岗位详情「专家与专家团」页签（PositionExpertTab）—— 产品优化需求-202611 修改点 2（2026-11-12 原型走查补齐）。
 *
 * 口径（docs/PRD/数字员工管理端PRD/产品优化需求-202611.md §2）：
 * - 引用对象不可用：行内状态标「已停用」或红色「已回收」（二者之一，回收的不再叠灰色「未发布」）；
 * - 移除：正被本岗位自动化任务选为执行对象时不能移除——点【移除】后直接提示
 *   「「名称」正被自动化任务「任务名」使用，请先修改任务的执行动作」，不弹确认；
 * - 添加的专家团里有本岗位还没引用的岗位私有成员时，弹确认「专家团「团名」的成员「专家名」还没加入本岗位，是否一起添加？」，
 *   一次加多个团时逐个团点名。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { passthrough } from '../../../views/admin/__tests__/helpers/commonStubs'

const store = reactive({
  positionId: 401,
  experts: [],
  teams: [],
  bindExpert: vi.fn(),
  bindTeam: vi.fn(),
  unbindExpert: vi.fn(),
  unbindTeam: vi.fn()
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), alert: vi.fn(() => Promise.resolve()) }
}))
const listPositionExpertCandidates = vi.fn()
const checkUnbindPositionExpert = vi.fn()
const checkUnbindPositionTeam = vi.fn()
vi.mock('@/api/position', () => ({
  listPositionExpertCandidates: (...a) => listPositionExpertCandidates(...a),
  checkUnbindPositionExpert: (...a) => checkUnbindPositionExpert(...a),
  checkUnbindPositionTeam: (...a) => checkUnbindPositionTeam(...a)
}))
vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: ['visible', 'title'],
    setup: (props, { slots }) => () =>
      props.visible ? h('div', { class: 'drawer', 'data-title': props.title }, [slots.default?.(), h('div', { class: 'drawer-foot' }, slots.footer?.())]) : null
  }
}))
vi.mock('@/components/admin/ExpertEditor.vue', () => ({ default: { name: 'ExpertEditor', setup: () => () => null } }))
vi.mock('@/components/admin/ExpertTeamEditor.vue', () => ({ default: { name: 'ExpertTeamEditor', setup: () => () => null } }))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', props: ['type'], setup: (p, { slots }) => () => h('span', { class: 'status-tag', 'data-type': p.type }, slots.default?.()) }
}))

const { ElMessage, ElMessageBox } = await import('element-plus')
const PositionExpertTab = (await import('@/components/position/PositionExpertTab.vue')).default

const elTable = {
  props: ['data', 'emptyText'],
  provide() { return { tableRows: () => this.data || [] } },
  template: '<div class="el-table"><slot /></div>'
}
const elTableColumn = {
  props: ['label'],
  inject: ['tableRows'],
  setup(props, { slots }) {
    return function () {
      return h('div', { class: 'col', 'data-label': props.label }, this.tableRows().map((row, i) => h('div', { class: 'cell', 'data-row': i }, slots.default?.({ row }))))
    }
  }
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionExpertTab) })
  app.component('el-button', { props: ['type', 'link', 'size', 'loading'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' })
  app.component('el-checkbox', { props: ['modelValue'], emits: ['change'], template: '<label class="el-checkbox"><input type="checkbox" @change="$emit(\'change\')" /><slot /></label>' })
  app.component('el-table', elTable)
  app.component('el-table-column', elTableColumn)
  app.component('el-input', { props: ['modelValue'], template: '<input :value="modelValue" />' })
  app.component('el-tooltip', passthrough('el-tooltip'))
  app.directive('loading', {})
  app.mount(container)
  await flush()
}
const flush = async () => {
  for (let i = 0; i < 6; i++) { await nextTick(); await Promise.resolve() }
}
const expertRow = (over) => ({ expertId: 205, name: '经营数据核查专家', category: '审计', skillCount: 2, unavailable: '', revoked: null, ...over })
const teamRow = (over) => ({ teamId: 304, name: '经营复盘团', category: '审计', memberCount: 2, memberIds: [205], leaderName: '经营数据核查专家', missingCount: 0, missing: [], unboundMembers: [], unavailable: '', revoked: null, ...over })
const card = (title) => [...container.querySelectorAll('.pd-card')].find((c) => c.querySelector('.pd-card-title')?.textContent.trim() === title)
const statusCell = (title, i) => card(title).querySelector(`.col[data-label="状态"] .cell[data-row="${i}"]`)
const removeBtn = (title, i) => [...card(title).querySelectorAll(`.col[data-label="操作"] .cell[data-row="${i}"] button`)].find((b) => b.textContent.trim() === '移除')

beforeEach(() => {
  vi.clearAllMocks()
  store.experts = [expertRow()]
  store.teams = [teamRow()]
  checkUnbindPositionExpert.mockResolvedValue('')
  checkUnbindPositionTeam.mockResolvedValue('')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('引用对象不可用：行内只标「已停用」或红色「已回收」之一', () => {
  it('被强制回收的专家 / 专家团 → 只出红色「已回收」，不再叠「未发布」；普通停用 → 只出「已停用」', async () => {
    const revoked = { reason: '口径有误', at: '2026-11-12 10:00', operator: 'admin' }
    store.experts = [expertRow({ unavailable: '已回收', revoked }), expertRow({ expertId: 206, name: '停用专家', unavailable: '已停用' })]
    store.teams = [teamRow({ unavailable: '已回收', revoked })]
    await mount()
    expect(statusCell('专家', 0).textContent.replace(/\s+/g, '')).toBe('已回收')
    expect(statusCell('专家', 0).querySelector('.status-tag')).toBeNull()
    expect(statusCell('专家', 1).textContent.replace(/\s+/g, '')).toBe('已停用')
    expect(statusCell('专家团', 0).textContent.replace(/\s+/g, '')).toBe('已回收')
  })
})

describe('移除：是本岗位自动化任务的执行对象时直接提示，不弹确认（修改点 2）', () => {
  it('专家团被任务使用 → 弹提示框原样展示预检文案，不弹移除确认、不调移除', async () => {
    const msg = '「经营复盘团」正被自动化任务「周度经营复盘提醒」使用，请先修改任务的执行动作'
    checkUnbindPositionTeam.mockResolvedValue(msg)
    await mount()
    removeBtn('专家团', 0).click()
    await flush()
    expect(checkUnbindPositionTeam).toHaveBeenCalledWith(401, 304)
    expect(ElMessageBox.alert).toHaveBeenCalledWith(msg, '移除专家团', expect.objectContaining({ confirmButtonText: '知道了' }))
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(store.unbindTeam).not.toHaveBeenCalled()
  })

  it('专家被任务使用 → 同样直接提示；没被使用的专家照常弹确认后移除', async () => {
    const msg = '「经营数据核查专家」正被自动化任务「每日经营晨报」使用，请先修改任务的执行动作'
    checkUnbindPositionExpert.mockResolvedValueOnce(msg)
    await mount()
    removeBtn('专家', 0).click()
    await flush()
    expect(ElMessageBox.alert).toHaveBeenCalledWith(msg, '移除专家', expect.anything())
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(store.unbindExpert).not.toHaveBeenCalled()

    removeBtn('专家', 0).click() // 预检这回放行
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(store.unbindExpert).toHaveBeenCalledWith(205)
    expect(ElMessage.success).toHaveBeenCalledWith('已移除')
  })
})

describe('添加专家团时带上没加入本岗位的成员：确认文案逐个团点名（修改点 2）', () => {
  const candTeam = (teamId, name, members) => ({ teamId, name, memberCount: 2, leaderName: '主理人', unboundMembers: members, intro: '' })
  async function pickTeams(teams) {
    listPositionExpertCandidates.mockResolvedValue({ experts: [], teams })
    await mount()
    ;[...card('专家团').querySelectorAll('button')].find((b) => b.textContent.includes('添加专家团')).click()
    await flush()
    for (const box of document.querySelectorAll('.drawer .el-checkbox input')) box.dispatchEvent(new Event('change'))
    await flush()
    ;[...document.querySelectorAll('.drawer-foot button')].find((b) => b.textContent.trim() === '添加').click()
    await flush()
  }

  it('只加一个团 → 文案逐字照 PRD「专家团「团名」的成员「专家名」还没加入本岗位，是否一起添加？」', async () => {
    await pickTeams([candTeam(304, '经营复盘团', [{ expertId: 205, name: '经营数据核查专家' }])])
    expect(ElMessageBox.confirm.mock.calls[0][0]).toBe('专家团「经营复盘团」的成员「经营数据核查专家」还没加入本岗位，是否一起添加？')
  })

  it('一次加两个团 → 每个团都点名自己缺的成员，顿号相接；「一起添加」后成员去重各加一次', async () => {
    await pickTeams([
      candTeam(304, '经营复盘团', [{ expertId: 205, name: '经营数据核查专家' }]),
      candTeam(305, '财务分析团', [{ expertId: 207, name: '预算专家' }, { expertId: 205, name: '经营数据核查专家' }])
    ])
    expect(ElMessageBox.confirm.mock.calls[0][0]).toBe(
      '专家团「经营复盘团」的成员「经营数据核查专家」、专家团「财务分析团」的成员「预算专家」「经营数据核查专家」还没加入本岗位，是否一起添加？'
    )
    expect(store.bindExpert.mock.calls.map((c) => c[0])).toEqual([205, 207])
    expect(store.bindTeam.mock.calls.map((c) => c[0])).toEqual([304, 305])
  })
})
