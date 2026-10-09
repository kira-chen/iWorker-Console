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
 *
 * 2026-10-08 对齐同一 md 补缺口（/test-audit 连接器组）：
 *  - §二.1「引用情况」引用清单按类型分流（「岗位私有为"被岗位引用"（列岗位名）」「通用连接器显示"—"」；yuepu#17、负责人 5618381 拍板）；
 *  - §一.2「点击【查询】后按当前条件刷新；清空搜索框内容时列表自动刷新」「切换连接器类型或状态后列表立即刷新」：
 *    切类型或状态下拉不点查询即刷新、清空搜索框即刷新。
 *  el-select 桩改为同时 emit change（页面靠 @change 即刷新）。
 * 2026-10-09 对齐 prd-业务系统.md「强制回收」小节（/test-audit 补缺口 A4/A5）：【强制回收】点击流程（askForceRevoke 桩，
 *  真弹窗交互另见 utils/__tests__/forceRevoke.test.js）与未发布行「已回收」标签。
 * 注：用例名 / 注释里残留的「Lxx」为 2026-09-12 版 md 行号，md 已改版漂移，以 § 节号与引用原句为准。
 */

const admin = {
  listBizSystems: vi.fn(),
  deleteBizSystem: vi.fn(),
  submitBizSystemPublish: vi.fn(),
  withdrawBizSystem: vi.fn(),
  delistBizSystem: vi.fn(),
  forceRevokeBizSystem: vi.fn()
}
vi.mock('@/api/admin', () => admin)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
const msgBox = { confirm: vi.fn(), prompt: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

// 强制回收的两步确认弹窗交给 forceRevoke.test.js；本页只验「拿到原因后」的流程。其余导出（revokedTip 等）保持真实
const askForceRevoke = vi.hoisted(() => vi.fn())
vi.mock('@/utils/forceRevoke', async (importOriginal) => ({ ...(await importOriginal()), askForceRevoke }))

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
  // 与真 el-select 一致：选值后先 update:modelValue 再 change（页面 @change 即刷新，md §一.2「切换连接器类型或状态后列表立即刷新」）
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
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
  admin.forceRevokeBizSystem.mockResolvedValue({})
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
    // 防恒真：fixture 扩 2 条同样命中「资源 + 审核中」的旧行（共 5 行），每页 2 条 → 3 页；
    // 先翻到第 2 页，查询后命中 3 行仍有 2 页——不回第 1 页就会停在第 2 页（不会被越界钳位掩盖）
    const extra = [
      mkBiz({ id: 'biz_4', name: '资源档案系统', status: 'PENDING_REVIEW', updatedAt: '2026-08-20T10:00:00+08:00' }),
      mkBiz({ id: 'biz_5', name: '资源调度平台', status: 'PENDING_REVIEW', updatedAt: '2026-08-19T10:00:00+08:00' })
    ]
    admin.listBizSystems.mockImplementation(async (params = {}) => {
      let list = [...LIST, ...extra]
      const kw = (params.keyword || '').toLowerCase()
      if (kw) list = list.filter((b) => b.name.toLowerCase().includes(kw) || b.description.toLowerCase().includes(kw))
      if (params.state) list = list.filter((b) => b.status === params.state)
      return { list: list.map((b) => ({ ...b })), total: list.length }
    })
    pageSizeState.size = 2
    await mount()
    pager().querySelector('[aria-label="下一页"]').click()
    await flush()
    expect(pager().querySelector('.page-btn.active').textContent.trim()).toBe('2')
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
    expect(pager().textContent).toContain('共 3 条数据')
    expect(pager().querySelector('.page-btn.active').textContent.trim()).toBe('1')
    // 第 1 页按最近更新倒序：人力资源系统（08-24）+ 资源档案系统（08-20）
    expect(rows().map((r) => r.querySelector('.biz-cell-name').textContent.trim())).toEqual([
      '人力资源系统',
      '资源档案系统'
    ])
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

  it('引用情况：「2 个技能引用」点开弹窗「被技能引用」列技能名；无引用显示「暂无引用」（md §二.1「引用情况：…市场连接器有引用时展示"N 个技能引用"…无引用展示"暂无引用"」）', async () => {
    await mount()
    expect(rowByName('合同管理平台').textContent).toContain('暂无引用')
    btn(rowByName('客户管理系统'), '2 个技能引用').click()
    await nextTick()
    const dlg = container.querySelector('.el-dialog')
    expect(dlg.dataset.title).toBe('被技能引用')
    expect(dlg.textContent).toContain('客户拜访准备')
    expect(dlg.textContent).toContain('销售方案生成')
  })

  it('最近更新时间排序跨页：5 行乱序、每页 2 → 首页是最新两条；点列头切升序 → 首页是最旧两条（md §二.1「最近更新时间：…支持点击排序」；09-09 P1 aa7d251）', async () => {
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

describe('AdminBizSystems · 操作按钮按状态组合（md §二.2「各状态按钮组合」）', () => {
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

  it('已发布：【查看】【编辑】【停用】【强制回收】共 4 个', async () => {
    await mount()
    expect(btnTexts(rowByName('客户管理系统'))).toEqual(['查看', '编辑', '停用', '强制回收'])
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

  it('深链 ?keyword= 同名参数重复（数组）不崩页：取第一个作关键字并生效（2026-09-23 待办 yuepu#22）', async () => {
    routeState.query = { keyword: ['资源', '合同'] }
    await mount()
    expect(admin.listBizSystems).toHaveBeenCalledWith(expect.objectContaining({ keyword: '资源' }))
    expect(rows().length).toBe(1)
    expect(rowByName('人力资源系统')).toBeTruthy()
  })
})

describe('AdminBizSystems · 发布 / 撤回 / 停用 / 删除（md §二.3）', () => {
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

  it('删除：被 3 个技能引用 → 正文带引用数「该业务系统被 3 个技能引用，停用或删除后技能仍可执行……」，确认后仍可删（待办 yuepu#37③ 负责人拍板补齐，与 MCP 页签一致）', async () => {
    admin.listBizSystems.mockResolvedValue({ list: LIST.map((b) => (b.id === 'biz_3' ? { ...b, referencedBySkillCount: 3 } : b)), total: LIST.length })
    await mount()
    btn(rowByName('合同管理平台'), '删除').click()
    await flush()
    expect(msgBox.confirm).toHaveBeenCalledWith(
      '该业务系统被 3 个技能引用，停用或删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「合同管理平台」？',
      '删除业务系统',
      expect.objectContaining({ confirmButtonText: '继续删除' })
    )
    expect(admin.deleteBizSystem).toHaveBeenCalledWith('biz_3')
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

/* ---------------- 2026-10-08 补缺口（/test-audit 连接器组） ---------------- */
describe('AdminBizSystems · 引用情况按类型分流（md §二.1「引用情况」）', () => {
  const refCell = (name) => rowByName(name).querySelector('.t-cell[data-label="引用情况"]')

  it('岗位私有被 2 个岗位引用：显「2个岗位引用」，点开弹窗标题「被岗位引用」并列出岗位名', async () => {
    admin.listBizSystems.mockResolvedValue({
      list: [
        mkBiz({
          id: 'biz_pos',
          name: '岗位私有系统',
          type: 'POSITION',
          positionCount: 2,
          referencedByPositions: [{ positionId: 'p_1', positionName: '财务专员' }, { positionId: 'p_2', positionName: '采购助理' }],
          // 同时带技能引用：弹窗必须取岗位名而不是技能名
          referencedBySkills: [{ skillId: 'sk_x', skillName: '不该出现的技能' }]
        })
      ],
      total: 1
    })
    await mount()
    btn(rowByName('岗位私有系统'), '2个岗位引用').click()
    await nextTick()
    const dlg = container.querySelector('.el-dialog')
    expect(dlg.dataset.title).toBe('被岗位引用')
    expect([...dlg.querySelectorAll('.refs-item')].map((e) => e.textContent.trim())).toEqual(['财务专员', '采购助理'])
  })

  it('通用连接器：引用情况显「—」，没有可点的引用入口（即使数据里带技能引用数）', async () => {
    admin.listBizSystems.mockResolvedValue({
      list: [mkBiz({ id: 'biz_sys', name: '通用系统', type: 'SYSTEM_DEFAULT', referencedBySkillCount: 3 })],
      total: 1
    })
    await mount()
    expect(refCell('通用系统').textContent.trim()).toBe('—')
    expect(refCell('通用系统').querySelector('.el-button')).toBeNull()
  })
})

describe('AdminBizSystems · 切筛选与清空即刷新（md §一.2「点击【查询】后按当前条件刷新；清空搜索框内容时列表自动刷新」「切换连接器类型或状态后列表立即刷新」）', () => {
  it('改「连接器类型」下拉、不点【查询】→ 立即重拉，listBizSystems 收到 type', async () => {
    await mount()
    const before = admin.listBizSystems.mock.calls.length
    const sel = container.querySelectorAll('.lt-filter')[0]
    sel.value = 'POSITION'
    sel.dispatchEvent(new Event('change'))
    await flush(6)
    expect(admin.listBizSystems.mock.calls.length).toBe(before + 1)
    expect(admin.listBizSystems).toHaveBeenLastCalledWith({ type: 'POSITION' })
  })

  it('改「状态」下拉、不点【查询】→ 立即重拉，listBizSystems 收到 state，列表只剩命中行', async () => {
    await mount()
    const before = admin.listBizSystems.mock.calls.length
    const sel = container.querySelectorAll('.lt-filter')[1]
    sel.value = 'PUBLISHED'
    sel.dispatchEvent(new Event('change'))
    await flush(6)
    expect(admin.listBizSystems.mock.calls.length).toBe(before + 1)
    expect(admin.listBizSystems).toHaveBeenLastCalledWith({ state: 'PUBLISHED' })
    expect(rows().map((r) => r.querySelector('.biz-cell-name').textContent.trim())).toEqual(['客户管理系统'])
  })

  it('已按关键词查过，再点搜索框 × 清空 → 立即重拉、不再带 keyword，列表恢复全部 3 行', async () => {
    await mount()
    const input = container.querySelector('.lt-search')
    input.value = '合同'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    toolbarBtn('查询').click()
    await flush(6)
    expect(rows().length).toBe(1)
    // el-input 点 × ：先把值清成空串，再派发 clear 事件
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const before = admin.listBizSystems.mock.calls.length
    input.dispatchEvent(new Event('clear'))
    await flush(6)
    expect(admin.listBizSystems.mock.calls.length).toBe(before + 1)
    expect(admin.listBizSystems).toHaveBeenLastCalledWith({})
    expect(rows().length).toBe(3)
  })
})

describe('AdminBizSystems · 强制回收（prd-业务系统.md「强制回收」小节：立即生效、不进审核、原因必填、两步确认）', () => {
  it('已发布行点【强制回收】、拿到原因 → forceRevokeBizSystem(id, 原因) + 「已强制回收」+ 重新取数', async () => {
    askForceRevoke.mockResolvedValue('系统凭据已泄露')
    await mount()
    const before = admin.listBizSystems.mock.calls.length
    btn(rowByName('客户管理系统'), '强制回收').click()
    await flush()
    expect(admin.forceRevokeBizSystem).toHaveBeenCalledWith('biz_1', '系统凭据已泄露')
    expect(msg.success).toHaveBeenCalledWith('已强制回收')
    expect(admin.listBizSystems.mock.calls.length).toBe(before + 1)
  })

  it('弹窗入参：类型「业务系统」、对象名、引用数（被 2 个技能引用）、引用方描述「岗位 / 技能」', async () => {
    askForceRevoke.mockResolvedValue(null)
    await mount()
    btn(rowByName('客户管理系统'), '强制回收').click()
    await flush()
    expect(askForceRevoke).toHaveBeenCalledWith({ typeLabel: '业务系统', name: '客户管理系统', refCount: 2, refText: '岗位 / 技能', refNames: ['客户拜访准备', '销售方案生成'] })
  })

  it('取消（askForceRevoke 返回 null）→ 不调接口、不弹成功提示、不重新取数', async () => {
    askForceRevoke.mockResolvedValue(null)
    await mount()
    const before = admin.listBizSystems.mock.calls.length
    btn(rowByName('客户管理系统'), '强制回收').click()
    await flush()
    expect(admin.forceRevokeBizSystem).not.toHaveBeenCalled()
    expect(msg.success).not.toHaveBeenCalled()
    expect(admin.listBizSystems.mock.calls.length).toBe(before)
  })

  it('接口失败 → 错误提示取 message 原文；无 message → 「操作失败」，不弹成功提示', async () => {
    askForceRevoke.mockResolvedValue('原因')
    admin.forceRevokeBizSystem.mockRejectedValueOnce({ message: '仅已发布且无在审操作可强制回收' })
    await mount()
    btn(rowByName('客户管理系统'), '强制回收').click()
    await flush()
    expect(msg.error).toHaveBeenCalledWith('仅已发布且无在审操作可强制回收')
    admin.forceRevokeBizSystem.mockRejectedValueOnce(new Error(''))
    btn(rowByName('客户管理系统'), '强制回收').click()
    await flush()
    expect(msg.error).toHaveBeenLastCalledWith('操作失败')
    expect(msg.success).not.toHaveBeenCalled()
  })

  it('未发布且带回收信息的行：状态列「未发布」旁出现「已回收」标签，悬停写明原因 / 操作人 / 时间；已发布行没有', async () => {
    const revoked = { reason: '系统凭据已泄露', at: '2026-10-09 09:30', operator: 'admin' }
    admin.listBizSystems.mockImplementation(async () => ({
      list: LIST.map((b) => (b.id === 'biz_3' ? { ...b, revoked } : b)),
      total: LIST.length
    }))
    await mount()
    const tag = rowByName('合同管理平台').querySelector('.revoked-tag')
    expect(tag?.textContent).toBe('已回收')
    expect(tag.parentElement.getAttribute('data-tip')).toBe('回收原因：系统凭据已泄露（admin · 2026-10-09 09:30）')
    expect(rowByName('客户管理系统').querySelector('.revoked-tag')).toBeNull()
    expect(rowByName('人力资源系统').querySelector('.revoked-tag')).toBeNull()
  })

  it('未发布但从未被回收（无回收信息）→ 不出现「已回收」标签', async () => {
    await mount()
    expect(rowByName('合同管理平台').querySelector('.revoked-tag')).toBeNull()
  })
})
