// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * AdminBizSystems.vue 页面级单测（2026-09-12 测试审计 T51/T58 新建；对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/业务系统/prd-业务系统.md §一.1 / §二.1 ~ §二.4 / §四）。
 *
 * 该页此前零测试（62545c6「补充 computed 导入」白屏即实例）。真实 Element Plus 挂载冒烟另见 adminBizSystemsSmoke.test.js。
 *
 * 桩：api/admin（列表 / 发布 / 撤回 / 停用 / 删除）、element-plus（ElMessage/ElMessageBox）、vue-router（useRoute 可配 query）、
 *     BizSystemEditor（露 props）、useDynPageSize（可配每页条数，排序跨页用例钉 2）、el-table 走 RowScope 行渲染桩。
 * 真：ListToolbar / ListPagination / ListStates / StatusTag（页面局部 import）。
 */

const admin = {
  listBizSystems: vi.fn(),
  deleteBizSystem: vi.fn(),
  submitBizSystemPublish: vi.fn(),
  withdrawBizSystem: vi.fn(),
  delistBizSystem: vi.fn()
}
vi.mock('@/api/admin', () => admin)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn(), prompt: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

// 路由 query 由各用例改写（深链 ?view=<id>）
const routeState = vi.hoisted(() => ({ query: {} }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeState.query }),
  useRouter: () => ({ resolve: () => ({ href: '/x' }), push: vi.fn(), replace: vi.fn() })
}))

// 每页条数可配：默认 5（与真实算法最小档一致），排序跨页用例改 2
const pageSizeState = vi.hoisted(() => ({ size: 5 }))
vi.mock('@/composables/useDynPageSize', () => ({ useDynPageSize: () => ref(pageSizeState.size) }))

vi.mock('@/components/admin/BizSystemEditor.vue', () => ({
  default: {
    name: 'BizSystemEditor',
    props: ['visible', 'bizId', 'readonly'],
    template:
      '<div class="stub-biz-editor" :data-visible="visible ? 1 : 0" :data-id="bizId" :data-readonly="readonly ? 1 : 0" />'
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

const AdminBizSystems = (await import('@/views/admin/AdminBizSystems.vue')).default

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
  app = createApp({ render: () => h(AdminBizSystems) })
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
  for (const n of ['Search', 'Plus']) app.component(n, { template: '<span/>' })
  app.directive('loading', vLoading)
  app.mount(container)
  await flush(5)
  return container
}

// 三行覆盖三态；名字互不为子串
const mkBiz = (over) => ({
  id: over.id,
  name: over.name,
  icon: '◎',
  description: over.description || '',
  loginUrl: over.loginUrl || 'https://x.example.com/login',
  type: 'PLATFORM',
  status: 'NOT_PUBLISHED',
  pendingAction: null,
  referencedBySkillCount: 0,
  referencedBySkills: [],
  refs: [],
  updatedAt: '2026-08-22T16:18:00+08:00',
  ...over
})
const LIST = [
  mkBiz({
    id: 'biz_1',
    name: '客户管理系统',
    description: '管理客户资料',
    loginUrl: 'https://crm.example.com/login',
    status: 'PUBLISHED',
    referencedBySkillCount: 2,
    referencedBySkills: [
      { skillId: 'sk_b1', skillName: '客户拜访准备' },
      { skillId: 'sk_b2', skillName: '销售方案生成' }
    ],
    refs: ['客户拜访准备', '销售方案生成'],
    updatedAt: '2026-08-24T15:40:00+08:00'
  }),
  mkBiz({
    id: 'biz_2',
    name: '人力资源系统',
    description: '入转调离管理',
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    updatedAt: '2026-08-24T11:32:00+08:00'
  }),
  mkBiz({ id: 'biz_3', name: '合同管理平台', description: '合同起草', status: 'NOT_PUBLISHED' })
]

const rows = () => [...container.querySelectorAll('.t-row')]
const rowByName = (name) => rows().find((el) => el.textContent.includes(name))
const btn = (rowEl, text) => [...rowEl.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const btnTexts = (rowEl) => [...rowEl.querySelectorAll('.tbl-ops .el-button')].map((b) => b.textContent.trim())
const tipsOf = (el) => [...el.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip'))
const pager = () => container.querySelector('.list-pager')
const toolbarBtn = (text) =>
  [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  vi.clearAllMocks()
  routeState.query = {}
  pageSizeState.size = 5
  admin.listBizSystems.mockImplementation(async (params = {}) => {
    let list = LIST
    const kw = (params.keyword || '').toLowerCase()
    if (kw) list = list.filter((b) => b.name.toLowerCase().includes(kw) || b.description.toLowerCase().includes(kw))
    if (params.state) list = list.filter((b) => b.status === params.state)
    return { list: list.map((b) => ({ ...b })), total: list.length }
  })
  admin.submitBizSystemPublish.mockResolvedValue({})
  admin.withdrawBizSystem.mockResolvedValue({})
  admin.delistBizSystem.mockResolvedValue({})
  admin.deleteBizSystem.mockResolvedValue({})
  msgBox.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminBizSystems · 列表与查询（md §一.1 / §二.1）', () => {
  it('挂载不抛：3 行 .t-row + 分页条 .list-pager「共 3 条数据」；行内名称 / 描述 / 登录地址 / 状态标签', async () => {
    await mount()
    expect(rows().length).toBe(3)
    expect(pager()).toBeTruthy()
    expect(pager().textContent).toContain('共 3 条数据')
    const row = rowByName('客户管理系统')
    expect(row.querySelector('.biz-cell-desc').textContent.trim()).toBe('管理客户资料')
    expect(row.textContent).toContain('https://crm.example.com/login')
    expect(row.querySelector('.status-tag').textContent.trim()).toBe('已发布')
    expect(rowByName('人力资源系统').querySelector('.status-tag').textContent.trim()).toBe('审核中')
    expect(rowByName('合同管理平台').querySelector('.status-tag').textContent.trim()).toBe('未发布')
    expect(container.querySelector('input').getAttribute('placeholder')).toBe('搜索系统名称或描述')
  })

  it('关键词 + 状态筛选 + 【查询】 → listBizSystems 收到 keyword/state，并回第 1 页（md §一.2 L18）', async () => {
    await mount()
    const input = container.querySelector('.lt-search')
    input.value = '资源'
    input.dispatchEvent(new Event('input'))
    const sel = [...container.querySelectorAll('.lt-filter')][1]
    sel.value = 'PENDING_REVIEW'
    sel.dispatchEvent(new Event('change'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(admin.listBizSystems).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: '资源', state: 'PENDING_REVIEW' })
    )
    expect(rows().length).toBe(1)
    expect(rowByName('人力资源系统')).toBeTruthy()
    expect(pager().querySelector('.page-btn.active').textContent.trim()).toBe('1')
  })

  it('查询无结果 → 「没有匹配的业务系统」，输入框保留当前条件（md §一.1 L14 / §四）', async () => {
    await mount()
    const input = container.querySelector('.lt-search')
    input.value = '不存在'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(container.querySelector('[data-testid="list-empty"]').textContent).toContain('没有匹配的业务系统')
    expect(rows().length).toBe(0)
    expect(container.querySelector('.lt-search').value).toBe('不存在')
  })

  it('引用情况：「2 个技能引用」点开弹窗「被技能引用」列技能名；无引用显示「暂无引用」（md §二.1 L29）', async () => {
    await mount()
    expect(rowByName('合同管理平台').textContent).toContain('暂无引用')
    btn(rowByName('客户管理系统'), '2 个技能引用').click()
    await nextTick()
    const dlg = container.querySelector('.el-dialog')
    expect(dlg.dataset.title).toBe('被技能引用')
    expect(dlg.textContent).toContain('客户拜访准备')
    expect(dlg.textContent).toContain('销售方案生成')
  })

  it('最近更新时间排序跨页：5 行乱序、每页 2 → 首页是最新两条；点列头切升序 → 首页是最旧两条（md §二.1 L30；09-09 P1 aa7d251）', async () => {
    pageSizeState.size = 2
    const five = ['甲', '乙', '丙', '丁', '戊'].map((n, i) =>
      mkBiz({ id: `b_${i}`, name: `${n}系统`, updatedAt: `2026-08-2${[3, 1, 5, 2, 4][i]}T10:00:00+08:00` })
    )
    admin.listBizSystems.mockResolvedValue({ list: five, total: 5 })
    await mount()
    const names = () => rows().map((r) => r.querySelector('.biz-cell-name').textContent.trim())
    expect(names()).toEqual(['丙系统', '戊系统']) // 08-25、08-24 最新两条
    expect(pager().textContent).toContain('共 5 条数据')
    container.querySelector('.time-sort').click()
    await flush(6)
    expect(names()).toEqual(['乙系统', '丁系统']) // 08-21、08-22 最旧两条
    expect(container.querySelector('.time-sort-arrow').textContent).toBe('↑')
  })
})

describe('AdminBizSystems · 操作按钮按状态组合（md §二.2 L37-41）', () => {
  it('未发布：【查看】【编辑】【发布】【删除】共 4 个', async () => {
    await mount()
    expect(btnTexts(rowByName('合同管理平台'))).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('审核中：【查看】【编辑】（置灰，提示「审核中不可编辑，如需修改请先撤回」）【撤回】共 3 个', async () => {
    await mount()
    const row = rowByName('人力资源系统')
    expect(btnTexts(row)).toEqual(['查看', '编辑', '撤回'])
    expect(btn(row, '编辑').disabled).toBe(true)
    expect(tipsOf(row)).toContain('审核中不可编辑，如需修改请先撤回')
  })

  it('已发布：【查看】【编辑】【停用】共 3 个', async () => {
    await mount()
    expect(btnTexts(rowByName('客户管理系统'))).toEqual(['查看', '编辑', '停用'])
  })

  it('【查看】只读打开抽屉；【编辑】可写打开；【新建业务系统】无 id 可写打开（md §三.1）', async () => {
    await mount()
    btn(rowByName('人力资源系统'), '查看').click()
    await nextTick()
    let ed = container.querySelector('.stub-biz-editor')
    expect([ed.dataset.visible, ed.dataset.id, ed.dataset.readonly]).toEqual(['1', 'biz_2', '1'])
    btn(rowByName('合同管理平台'), '编辑').click()
    await nextTick()
    ed = container.querySelector('.stub-biz-editor')
    expect([ed.dataset.id, ed.dataset.readonly]).toEqual(['biz_3', '0'])
    ;[...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.includes('新建业务系统')).click()
    await nextTick()
    ed = container.querySelector('.stub-biz-editor')
    expect(ed.dataset.id).toBeUndefined()
    expect(ed.dataset.readonly).toBe('0')
  })

  it('深链 ?view=biz_2 → 进入即只读打开该业务系统抽屉（岗位详情「业务系统」页签点名称跳转）', async () => {
    routeState.query = { view: 'biz_2' }
    await mount()
    const ed = container.querySelector('.stub-biz-editor')
    expect([ed.dataset.visible, ed.dataset.id, ed.dataset.readonly]).toEqual(['1', 'biz_2', '1'])
  })
})

describe('AdminBizSystems · 发布 / 撤回 / 停用 / 删除（md §二.3 L45-52）', () => {
  it('发布：确认窗「将「合同管理平台」提交审核，审核通过后才对客户端开放。」/「发布业务系统」/【提交审核】 → submitBizSystemPublish + 「已提交发布审核」+ 重拉', async () => {
    await mount()
    const before = admin.listBizSystems.mock.calls.length
    btn(rowByName('合同管理平台'), '发布').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '将「合同管理平台」提交审核，审核通过后才对客户端开放。',
      '发布业务系统',
      expect.objectContaining({ confirmButtonText: '提交审核' })
    )
    expect(admin.submitBizSystemPublish).toHaveBeenCalledWith('biz_3', ['USER_END'])
    expect(msg.success).toHaveBeenCalledWith('已提交发布审核')
    expect(admin.listBizSystems.mock.calls.length).toBeGreaterThan(before)
  })

  it('发布：确认窗取消 → 不提交', async () => {
    msgBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    btn(rowByName('合同管理平台'), '发布').click()
    await flush()
    expect(admin.submitBizSystemPublish).not.toHaveBeenCalled()
  })

  it('撤回：待审发布正文含「未发布」；待审停用正文含「已发布」 → withdrawBizSystem + 「已撤回」（md §二.3 L48）', async () => {
    admin.listBizSystems.mockResolvedValue({
      list: [LIST[1], mkBiz({ id: 'biz_4', name: '停用中系统', status: 'PENDING_REVIEW', pendingAction: 'DEACTIVATE' })],
      total: 2
    })
    await mount()
    btn(rowByName('人力资源系统'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenLastCalledWith(
      '撤回后「人力资源系统」将回到未发布状态。',
      '撤回审核',
      expect.objectContaining({ confirmButtonText: '撤回' })
    )
    expect(admin.withdrawBizSystem).toHaveBeenCalledWith('biz_2', 'USER_END')
    expect(msg.success).toHaveBeenCalledWith('已撤回')
    btn(rowByName('停用中系统'), '撤回').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenLastCalledWith(
      '撤回后「停用中系统」将回到已发布状态。',
      '撤回审核',
      expect.anything()
    )
    expect(admin.withdrawBizSystem).toHaveBeenCalledWith('biz_4', 'USER_END')
  })

  it('停用：确认窗「停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「客户管理系统」？」/【继续停用】 → delistBizSystem + 「已提交停用审核」（md §二.3 L49）', async () => {
    await mount()
    btn(rowByName('客户管理系统'), '停用').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「客户管理系统」？',
      '停用业务系统',
      expect.objectContaining({ confirmButtonText: '继续停用' })
    )
    expect(admin.delistBizSystem).toHaveBeenCalledWith('biz_1', 'USER_END')
    expect(msg.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('删除：确认窗「删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「合同管理平台」？」/【继续删除】 → deleteBizSystem + 「已删除」（md §二.3 L52）', async () => {
    await mount()
    btn(rowByName('合同管理平台'), '删除').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「合同管理平台」？',
      '删除业务系统',
      expect.objectContaining({ confirmButtonText: '继续删除' })
    )
    expect(admin.deleteBizSystem).toHaveBeenCalledWith('biz_3')
    expect(msg.success).toHaveBeenCalledWith('已删除')
  })

  it('动作失败：数据层抛 message → error 原文；删除失败无 message → 「删除失败」', async () => {
    admin.submitBizSystemPublish.mockRejectedValueOnce({ message: '仅未发布状态可提交发布' })
    admin.deleteBizSystem.mockRejectedValueOnce(new Error(''))
    await mount()
    btn(rowByName('合同管理平台'), '发布').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('仅未发布状态可提交发布')
    btn(rowByName('合同管理平台'), '删除').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('删除失败')
  })
})
