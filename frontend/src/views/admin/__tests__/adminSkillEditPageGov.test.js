// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * AdminSkillEditPage「治理借用态」单测（2026-10-08 /test-audit 补缺口新建）：
 * 技能整页被审核中心（?govReview=<审核行 id>）/ 我的申请（?myApp=<申请 id>）借来当 SKILL 详情页时的吸底操作栏。
 *
 * 2026-10-08 对齐：
 *  - docs/PRD/数字员工管理端PRD/05治理/审核中心/prd.审核中心.md
 *      §四 技能三类读提交时的版本快照；§4.2「技能保持完整只读页面，底部展示【关闭】【驳回】【通过】；点击关闭或返回后回到审核中心」；
 *      §5.1 驳回 →「已驳回审核」；§5.2 通过 → 发布类「已通过审核」/ 停用「已通过停用申请」；
 *      §七「业务快照缺失（岗位 / 专家 / 技能）→ 阻止审核并提示联系提交人重新提交」（d1dcc54 G-13：闸门只对 ?govReview 生效）。
 *  - docs/PRD/数字员工管理端PRD/05治理/我的申请/prd.我的申请.md
 *      §4.1 待审核【关闭】【撤回申请】→「申请已撤回」；§4.2 已通过只有【关闭】；§4.3 已驳回 / §4.4 已撤回【关闭】【前往修改】【重新提交】；
 *      §4.3【前往修改】进编辑态后【提交审核】；【重新提交】弹「提交成功」；§六 我的申请里快照缺失不拦（提交人自己回看当前配置）。
 *
 * 桩法同 adminSkillEditPage.test.js：vue-router 用 hoisted routeState；platformSkillApi.get 返回「当前配置」；
 * reviews / myApplications（页面内动态 import，vi.mock 同样生效）、reviewSnapshot.loadReviewSnapshot、govDialogs 均为 spy；
 * SkillFocusEditor / AdminRail / VersionDrawer / ReviewRejectDialog 桩；el-button / el-alert 轻量桩以读按钮文案。
 */

const routeState = vi.hoisted(() => ({ meta: {}, params: { id: 'sk_9' }, query: {} }))
const push = vi.fn()
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeState.params, meta: routeState.meta, query: routeState.query }),
  useRouter: () => ({ push, replace }),
  onBeforeRouteLeave: () => {}
}))

vi.mock('@/stores/position', () => ({
  usePositionStore: () => ({ agents: [], basic: null, fetchSkillDetail: vi.fn(), patchSkill: vi.fn(), load: vi.fn(() => Promise.resolve()), reset: vi.fn() })
}))
// 当前配置（技能模块现值）：名称「当前名」，用来和快照「快照名」区分
const platformGet = vi.fn()
vi.mock('@/api/platformSkill', () => ({
  platformSkillApi: { get: (...a) => platformGet(...a), update: vi.fn() },
  systemSkillApi: { get: vi.fn(), update: vi.fn() }
}))
vi.mock('@/api/admin', () => ({ getBizSystemOwnedSkillDetail: vi.fn(), updateBizSystemOwnedSkill: vi.fn() }))
vi.mock('@/api/skillCategory', () => ({ setSkillCategory: vi.fn() }))
vi.mock('@/api/fieldDict', () => ({ listFieldDict: vi.fn(() => Promise.resolve({ skillCategory: [] })) }))
vi.mock('@/api/unifiedSkill', () => ({
  apiFor: () => ({}),
  SKILL_TYPE: { POSITION: 'POSITION', PLATFORM: 'PLATFORM', SYSTEM_DEFAULT: 'SYSTEM_DEFAULT' },
  skillPublishReadiness: () => ({ ready: true, missing: [] }),
  deriveSkillDisplayView: () => ({})
}))
vi.mock('@/api/skillFiles', () => ({
  listSkillFiles: vi.fn((id) => Promise.resolve({ skillId: id, entryPath: 'SKILL.md', files: [] })),
  getSkillFile: vi.fn(() => Promise.resolve({ content: '' })),
  saveSkillFile: vi.fn(),
  downloadSkillFile: vi.fn()
}))

/* ---- 治理 api（页面内动态 import） ---- */
const getReview = vi.fn()
const approveReview = vi.fn()
const rejectReview = vi.fn()
vi.mock('@/api/reviews', () => ({
  getReview: (...a) => getReview(...a),
  approveReview: (...a) => approveReview(...a),
  rejectReview: (...a) => rejectReview(...a)
}))
const getMyApplication = vi.fn()
const withdrawMyApplication = vi.fn()
const resubmitMyApplication = vi.fn()
vi.mock('@/api/myApplications', () => ({
  getMyApplication: (...a) => getMyApplication(...a),
  withdrawMyApplication: (...a) => withdrawMyApplication(...a),
  resubmitMyApplication: (...a) => resubmitMyApplication(...a)
}))
// 快照读取口：SNAPSHOT_MISSING_HINT 用真值，只替换 loadReviewSnapshot（按用例给「有 / 无」）
const loadReviewSnapshot = vi.fn()
vi.mock('@/utils/reviewSnapshot', async (importOriginal) => ({
  ...(await importOriginal()),
  loadReviewSnapshot: (...a) => loadReviewSnapshot(...a)
}))
const confirmApproveReview = vi.fn()
const confirmWithdrawMyApp = vi.fn()
const alertResubmitSuccess = vi.fn()
vi.mock('@/utils/govDialogs', () => ({
  confirmApproveReview: (...a) => confirmApproveReview(...a),
  confirmWithdrawMyApp: (...a) => confirmWithdrawMyApp(...a),
  alertResubmitSuccess: (...a) => alertResubmitSuccess(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), alert: vi.fn() } }))

/* ---- 子组件桩 ---- */
const focus = vi.hoisted(() => ({ props: null, back: null }))
vi.mock('@/components/admin/AdminRail.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/admin/VersionDrawer.vue', () => ({ default: { setup: () => () => h('div') } }))
vi.mock('@/components/admin/ReviewRejectDialog.vue', () => ({
  default: {
    props: { modelValue: Boolean, submitting: Boolean },
    emits: ['update:modelValue', 'confirm'],
    setup(props, { emit }) {
      return () =>
        props.modelValue
          ? h('div', { class: 'reject-dialog' }, [h('button', { class: 'reject-confirm', onClick: () => emit('confirm', '配置不完整') }, '确认驳回')])
          : null
    }
  }
}))
vi.mock('@/components/position/SkillFocusEditor.vue', () => ({
  default: {
    name: 'SkillFocusEditor',
    props: ['skill', 'readonly', 'loading', 'publications'],
    emits: ['back'],
    setup(props, { emit }) {
      focus.back = () => emit('back')
      return () => {
        focus.props = props
        return h('div', { class: 'stub-focus', 'data-readonly': String(props.readonly) }, props.skill?.name || '')
      }
    }
  }
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default
const { SNAPSHOT_MISSING_HINT } = await import('@/utils/reviewSnapshot')

const elButton = {
  props: { type: String, loading: Boolean, disabled: Boolean, plain: Boolean },
  emits: ['click'],
  template: '<button class="el-button" :data-type="type" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
}
const elAlert = { props: ['title', 'type'], template: '<div class="el-alert" :data-type="type">{{ title }}</div>' }

let app, container
function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminSkillEditPage)
  app.component('el-button', elButton)
  app.component('el-alert', elAlert)
  app.mount(container)
  return container
}
async function settle() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
}
/** 吸底操作栏按钮文案（按显示顺序）。 */
const barLabels = () => [...container.querySelectorAll('.se-gov-bar .el-button')].map((b) => b.textContent.trim())
const barBtn = (label) => [...container.querySelectorAll('.se-gov-bar .el-button')].find((b) => b.textContent.trim() === label)

const CURRENT = () => ({ skillId: 'sk_9', name: '当前名', description: '', triggers: [], skillMd: '# md', referencedTools: [], category: null, publications: [] })
const SNAPSHOT = () => ({ kind: 'SKILL', refId: 'sk_9', detail: { ...CURRENT(), name: '快照名' } })
const REVIEW = (over = {}) => ({ id: 2, kind: 'SKILL', refId: 'sk_9', name: '合同审查', requestAction: 'PUBLISH', ...over })
const APP = (result, over = {}) => ({ id: 504, kind: 'SKILL', refId: 'sk_9', objectName: '合同审查', result, ...over })

/** 审核中心借用态：只读路由 SysConfigSkillView + ?govReview */
async function mountGov({ snapshot = SNAPSHOT(), review = REVIEW() } = {}) {
  routeState.meta = { skillSource: 'platform', readonly: true }
  routeState.query = { govReview: String(review.id) }
  loadReviewSnapshot.mockResolvedValue(snapshot)
  getReview.mockResolvedValue(review)
  mount()
  await settle()
}
/** 我的申请借用态：只读路由（readonly=true）或「前往修改」后的编辑路由（readonly=false）+ ?myApp */
async function mountMyApp(result, { readonly = true, snapshot = SNAPSHOT() } = {}) {
  routeState.meta = readonly ? { skillSource: 'platform', readonly: true } : { skillSource: 'platform' }
  routeState.query = { myApp: '504' }
  loadReviewSnapshot.mockResolvedValue(snapshot)
  getMyApplication.mockResolvedValue(APP(result))
  mount()
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  routeState.meta = {}
  routeState.params = { id: 'sk_9' }
  routeState.query = {}
  focus.props = null
  platformGet.mockImplementation(() => Promise.resolve(CURRENT()))
  confirmApproveReview.mockResolvedValue(true)
  confirmWithdrawMyApp.mockResolvedValue(true)
  approveReview.mockResolvedValue({})
  rejectReview.mockResolvedValue({})
  withdrawMyApplication.mockResolvedValue({})
  resubmitMyApplication.mockResolvedValue({})
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

/* ====================================================================================== */
describe('审核中心借用态（?govReview）· md 审核中心 §4.2 / §五 / §七', () => {
  it('从审核中心打开技能 → 整页只读，底部依次为【关闭】【驳回】【通过】（§4.2）', async () => {
    await mountGov()
    expect(container.querySelector('.stub-focus').dataset.readonly).toBe('true')
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
  })

  it('有版本快照 → 详情展示提交审核时的快照内容，不是技能当前配置（§四：审核详情读取该快照）', async () => {
    await mountGov()
    expect(loadReviewSnapshot).toHaveBeenCalledWith('SKILL', 'sk_9')
    expect(container.querySelector('.stub-focus').textContent).toBe('快照名')
    expect(container.querySelector('[data-testid="se-snapshot-missing"]')).toBeNull()
  })

  it('点【关闭】→ 回到审核中心（§4.2）', async () => {
    await mountGov()
    barBtn('关闭').click()
    await settle()
    expect(push).toHaveBeenCalledWith({ name: 'UnifiedReview' })
  })

  it('点顶行「← 返回」→ 同样回到审核中心（§4.2「点击关闭或返回后回到审核中心」）', async () => {
    await mountGov()
    focus.back()
    await settle()
    expect(push).toHaveBeenCalledWith({ name: 'UnifiedReview' })
  })

  it('点【通过】并确认（发布申请）→ 提交通过、提示「已通过审核」并回到审核中心（§5.2）', async () => {
    await mountGov()
    barBtn('通过').click()
    await settle()
    expect(approveReview).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(ElMessage.success).toHaveBeenCalledWith('已通过审核')
    expect(push).toHaveBeenCalledWith({ name: 'UnifiedReview' })
  })

  it('停用申请点【通过】并确认 → 提示「已通过停用申请」（§5.2）', async () => {
    await mountGov({ review: REVIEW({ requestAction: 'DELIST' }) })
    barBtn('通过').click()
    await settle()
    expect(ElMessage.success).toHaveBeenCalledWith('已通过停用申请')
  })

  it('点【通过】后在确认弹窗里取消 → 不提交、不离开页面', async () => {
    confirmApproveReview.mockResolvedValue(false)
    await mountGov()
    barBtn('通过').click()
    await settle()
    expect(approveReview).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('点【驳回】→ 打开驳回弹窗；确认后带原因提交，提示「已驳回审核」并回到审核中心（§5.1）', async () => {
    await mountGov()
    expect(container.querySelector('.reject-dialog')).toBeNull()
    barBtn('驳回').click()
    await settle()
    expect(container.querySelector('.reject-dialog')).not.toBeNull()
    container.querySelector('.reject-confirm').click()
    await settle()
    expect(rejectReview).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), '配置不完整')
    expect(ElMessage.success).toHaveBeenCalledWith('已驳回审核')
    expect(push).toHaveBeenCalledWith({ name: 'UnifiedReview' })
  })

  it('版本快照缺失 → 出「请联系提交人重新提交」提示条，底部只剩【关闭】，驳回 / 通过被拦下（§七）', async () => {
    await mountGov({ snapshot: null })
    expect(container.querySelector('[data-testid="se-snapshot-missing"]').textContent).toBe(SNAPSHOT_MISSING_HINT)
    expect(SNAPSHOT_MISSING_HINT).toContain('联系提交人重新提交')
    expect(barLabels()).toEqual(['关闭'])
  })
})

/* ====================================================================================== */
describe('我的申请借用态（?myApp）· md 我的申请 §4.1–§4.4', () => {
  it('待审核 → 底部【关闭】【撤回申请】（§4.1）', async () => {
    await mountMyApp('PENDING')
    expect(barLabels()).toEqual(['关闭', '撤回申请'])
  })

  it('待审核点【撤回申请】并确认 → 撤回该申请、提示「申请已撤回」并回到我的申请（§4.1）', async () => {
    await mountMyApp('PENDING')
    barBtn('撤回申请').click()
    await settle()
    expect(confirmWithdrawMyApp).toHaveBeenCalledWith('合同审查')
    expect(withdrawMyApplication).toHaveBeenCalledWith(504)
    expect(ElMessage.success).toHaveBeenCalledWith('申请已撤回')
    expect(push).toHaveBeenCalledWith({ name: 'AdminMyApplications' })
  })

  it('待审核点【撤回申请】后在二次确认里取消 → 不撤回（§4.1「撤回前二次确认」）', async () => {
    confirmWithdrawMyApp.mockResolvedValue(false)
    await mountMyApp('PENDING')
    barBtn('撤回申请').click()
    await settle()
    expect(withdrawMyApplication).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('已通过 → 底部只有【关闭】（§4.2）', async () => {
    await mountMyApp('APPROVED')
    expect(barLabels()).toEqual(['关闭'])
  })

  it('已驳回 → 底部【关闭】【前往修改】【重新提交】（§4.3）', async () => {
    await mountMyApp('REJECTED')
    expect(barLabels()).toEqual(['关闭', '前往修改', '重新提交'])
  })

  it('已撤回 → 底部【关闭】【前往修改】【重新提交】，仍是整页不转抽屉（§4.4）', async () => {
    await mountMyApp('WITHDRAWN')
    expect(barLabels()).toEqual(['关闭', '前往修改', '重新提交'])
    expect(container.querySelector('.stub-focus')).not.toBeNull()
  })

  it('已驳回 / 已撤回的快照已销毁 → 我的申请里不拦：无缺失提示条，【前往修改】【重新提交】仍在（G-13：闸门只对审核中心生效）', async () => {
    await mountMyApp('REJECTED', { snapshot: null })
    expect(container.querySelector('[data-testid="se-snapshot-missing"]')).toBeNull()
    expect(barLabels()).toEqual(['关闭', '前往修改', '重新提交'])
    // 没有快照就展示当前配置（提交人自己回看）
    expect(container.querySelector('.stub-focus').textContent).toBe('当前名')
  })

  it('点【前往修改】→ 切到技能编辑路由，保留 myApp 申请号（§4.3）', async () => {
    await mountMyApp('REJECTED')
    barBtn('前往修改').click()
    await settle()
    expect(replace).toHaveBeenCalledWith({ name: 'SysConfigSkillEdit', params: { id: 'sk_9' }, query: { myApp: '504' } })
  })

  it('「前往修改」后的编辑态 → 底部换成【关闭】【提交审核】，页面可编辑（§4.3）', async () => {
    await mountMyApp('REJECTED', { readonly: false })
    expect(container.querySelector('.stub-focus').dataset.readonly).toBe('false')
    expect(barLabels()).toEqual(['关闭', '提交审核'])
  })

  it('编辑态点【提交审核】→ 重新提交该申请、回到我的申请并弹「提交成功」（§4.3）', async () => {
    await mountMyApp('REJECTED', { readonly: false })
    barBtn('提交审核').click()
    await settle()
    expect(resubmitMyApplication).toHaveBeenCalledWith(504)
    expect(push).toHaveBeenCalledWith({ name: 'AdminMyApplications' })
    expect(alertResubmitSuccess).toHaveBeenCalledWith('合同审查')
  })

  it('点【重新提交】→ 重新提交该申请、回到我的申请并弹「提交成功」（§4.3 / §4.4）', async () => {
    await mountMyApp('WITHDRAWN')
    barBtn('重新提交').click()
    await settle()
    expect(resubmitMyApplication).toHaveBeenCalledWith(504)
    expect(push).toHaveBeenCalledWith({ name: 'AdminMyApplications' })
    expect(alertResubmitSuccess).toHaveBeenCalledWith('合同审查')
  })

  it('【重新提交】失败 → 提示具体原因、不弹「提交成功」、留在本页（§七「保留当前状态并提示具体原因」）', async () => {
    resubmitMyApplication.mockRejectedValue(new Error('该对象已有待审核申请'))
    await mountMyApp('REJECTED')
    barBtn('重新提交').click()
    await settle()
    expect(ElMessage.error).toHaveBeenCalledWith('该对象已有待审核申请')
    expect(alertResubmitSuccess).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('点【关闭】→ 回到我的申请', async () => {
    await mountMyApp('APPROVED')
    barBtn('关闭').click()
    await settle()
    expect(push).toHaveBeenCalledWith({ name: 'AdminMyApplications' })
  })
})
