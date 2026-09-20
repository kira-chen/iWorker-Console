// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import ElementPlus from 'element-plus'

/**
 * GovObjectDetail.vue（治理页共享「业务原生详情」分发器，审核中心 / 我的申请共用）单测
 * （2026-09-12 测试审计 T56 新建，此前零测试）。
 *
 * 对齐 md `prd.审核中心.md` §四 L46-48（按业务类型分发到各模块原生只读视图；岗位 / 专家 / 技能读版本快照，
 * 其余读当前配置）、§4.1 抽屉宽 780px / 模型 820px、§七 L102「业务快照缺失（岗位 / 专家 / 技能）→ 阻止审核并提示
 * 联系提交人重新提交」；`prd.我的申请.md` §4.2-4.4（提交人回看不设快照闸门，snapshotGate=false）。
 *
 * 桩法：六个业务编辑器桩成「把收到的 props 落到 DOM」；McpEditor 保留真实组件（api/admin 打桩）以验 5303c7c 回归
 * ——GovObjectDetail 是「按 kind 条件挂载 + 同一 tick 置 visible」，编辑器 watcher 必须 immediate 才会首次 load。
 * DrawerEditor 桩成渲染插槽的容器；吸底操作栏 teleport 到 body，从 document 上取。
 */

vi.mock('@/components/admin/DrawerEditor.vue', () => ({
  default: {
    name: 'DrawerEditor',
    props: { visible: Boolean, title: String, readonly: Boolean, entity: String, isEdit: Boolean, loading: Boolean, error: [Boolean, String], size: String },
    emits: ['update:visible', 'retry', 'save'],
    template: '<div v-if="visible" class="drawer" :data-title="title"><slot /><slot name="footer" /></div>'
  }
}))
const editorStub = (cls, idProp, extraProps = {}) => ({
  default: {
    name: cls,
    props: { visible: Boolean, [idProp]: [Number, String], readonly: { type: Boolean, default: true }, ...extraProps },
    emits: ['update:visible'],
    template: `<div class="ed ed-${cls}" :data-visible="String(visible)" :data-id="String(${idProp})" :data-readonly="String(readonly)" :data-extra="JSON.stringify($props)" />`
  }
})
vi.mock('@/components/admin/ExpertEditor.vue', () => editorStub('ExpertEditor', 'expertId', { snapshotDetail: Object }))
vi.mock('@/components/admin/ApiEditor.vue', () => editorStub('ApiEditor', 'apiId'))
vi.mock('@/components/admin/BizSystemEditor.vue', () => editorStub('BizSystemEditor', 'bizId'))
vi.mock('@/components/admin/ModelConfigEditDialog.vue', () => editorStub('ModelConfigEditDialog', 'model', { model: Object }))
vi.mock('@/components/admin/PositionViewDrawer.vue', () => editorStub('PositionViewDrawer', 'positionId', { item: Object, snapshot: Object }))
vi.mock('@/components/admin/KnowledgeBaseEditor.vue', () => editorStub('KnowledgeBaseEditor', 'kbId', { mode: String }))
// 版本管理（2026-09-20）：VersionEditor 以版本行（version 对象）为入参，不自取数
vi.mock('@/components/admin/VersionEditor.vue', () => editorStub('VersionEditor', 'versionId', { version: Object }))

// McpEditor 真实组件：只打桩它的 api 层
const getMcp = vi.fn()
vi.mock('@/api/admin', () => ({
  getMcp: (...a) => getMcp(...a),
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn()
}))
const getModel = vi.fn()
vi.mock('@/api/adminModel', () => ({ getModel: (...a) => getModel(...a) }))
const getVersion = vi.fn()
vi.mock('@/api/version', () => ({ getVersion: (...a) => getVersion(...a) }))

const loadReviewSnapshot = vi.fn()
vi.mock('@/utils/reviewSnapshot', async (importOriginal) => ({
  ...(await importOriginal()),
  loadReviewSnapshot: (...a) => loadReviewSnapshot(...a)
}))

const GovObjectDetail = (await import('@/components/admin/GovObjectDetail.vue')).default
const { SNAPSHOT_MISSING_HINT } = await import('@/utils/reviewSnapshot')

// jsdom 缺的浏览器 API（Element Plus 真组件需要）
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}

const REVIEW_BUTTONS = [
  { key: 'close', label: '关闭' },
  { key: 'reject', label: '驳回', type: 'danger' },
  { key: 'approve', label: '通过', type: 'primary' }
]

let app, container, state
const onAction = vi.fn()
/**
 * 宿主：state 可变；open() 在同一 tick 同时置 kind + visible（与 UnifiedReview.openDetail 同序），
 * 复现「条件挂载的编辑器创建时 visible 已是 true」。
 */
async function mount(init) {
  state = reactive({ visible: false, kind: '', refId: null, item: null, readonly: true, buttons: REVIEW_BUTTONS, busyKey: '', snapshotGate: false, ...init })
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(GovObjectDetail, {
          visible: state.visible,
          kind: state.kind,
          refId: state.refId,
          item: state.item,
          readonly: state.readonly,
          buttons: state.buttons,
          busyKey: state.busyKey,
          snapshotGate: state.snapshotGate,
          'onUpdate:visible': (v) => (state.visible = v),
          onAction
        })
    }
  })
  app.use(ElementPlus)
  // McpEditor 树里按名解析的全局图标（main.js 全局注册），这里给空桩免告警
  for (const name of ['Connection', 'Download']) app.component(name, { render: () => h('i', { class: `icon-${name}` }) })
  app.mount(container)
  await flush()
}
async function open(patch) {
  Object.assign(state, patch, { visible: true })
  await flush()
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const bar = () => document.querySelector('.god-bar')
const barBtns = () => [...document.querySelectorAll('.god-bar .el-button')]
const barLabels = () => barBtns().map((b) => b.textContent.trim())
const editor = (cls) => container.querySelector(`.ed-${cls}`)
const extra = (cls) => JSON.parse(editor(cls).dataset.extra)

beforeEach(() => {
  onAction.mockReset()
  loadReviewSnapshot.mockReset().mockResolvedValue(null)
  getMcp.mockReset().mockResolvedValue({ id: 'knowledge_hub', name: '企业知识库 MCP', transport: 'streamable-http', endpoint: 'https://kb.example.com/mcp', tools: [] })
  getModel.mockReset().mockResolvedValue({ id: 'md_104', name: 'Kimi K2' })
  getVersion.mockReset().mockResolvedValue({ id: 7, name: 'Mac v1.2.0', version: 'v1.2.0', status: 'PENDING_REVIEW' })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  document.querySelectorAll('.god-bar').forEach((el) => el.remove())
})

describe('GovObjectDetail · 快照闸门（md 审核中心 §四 L48 / §七 L102）', () => {
  it('岗位 + snapshotGate=true + 快照缺失 → 不开岗位详情，改出「无法查看」提示卡（版本快照缺失 + 提示文 + 申请对象名），吸底栏只剩【关闭】', async () => {
    await mount({ snapshotGate: true })
    await open({ kind: 'POSITION', refId: 403, item: { name: '财务审核岗', requestAction: 'VERSION_PUBLISH' } })
    expect(loadReviewSnapshot).toHaveBeenCalledWith('POSITION', 403)
    const card = container.querySelector('.drawer[data-title="无法查看"]')
    expect(card).toBeTruthy()
    expect(card.querySelector('.section-title').textContent).toBe('版本快照缺失')
    expect(card.textContent).toContain(SNAPSHOT_MISSING_HINT)
    expect(card.querySelector('.god-missing-sub').textContent).toBe('申请对象：财务审核岗')
    expect(editor('PositionViewDrawer')).toBeNull()
    expect(barLabels()).toEqual(['关闭'])
    // 【关闭】仍可用：点击上抛 action('close')
    barBtns()[0].click()
    await flush()
    expect(onAction).toHaveBeenCalledWith('close')
  })

  it('岗位 + snapshotGate=false（我的申请回看）+ 快照缺失 → 照常开岗位只读抽屉（snapshot=null 由其兜底），吸底栏三键全出（md 我的申请 §4.2）', async () => {
    await mount({ snapshotGate: false })
    await open({ kind: 'POSITION', refId: 401, item: { objectName: '经营分析岗' } })
    expect(container.querySelector('.drawer[data-title="无法查看"]')).toBeNull()
    const ed = editor('PositionViewDrawer')
    expect(ed).toBeTruthy()
    expect(ed.dataset.visible).toBe('true')
    expect(ed.dataset.id).toBe('401')
    expect(extra('PositionViewDrawer').snapshot).toBeNull()
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
  })

  it('岗位 + snapshotGate=true + 快照在 → 开岗位抽屉并把快照传下去，三键全出', async () => {
    const snap = { kind: 'POSITION', refId: 403, version: 'v1.2.0', detail: { name: '财务审核岗（快照）' } }
    loadReviewSnapshot.mockResolvedValue(snap)
    await mount({ snapshotGate: true })
    await open({ kind: 'POSITION', refId: 403, item: { name: '财务审核岗' } })
    expect(container.querySelector('.drawer[data-title="无法查看"]')).toBeNull()
    expect(extra('PositionViewDrawer').snapshot).toEqual(snap)
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
  })

  it('专家：只读时把快照 detail 传给 ExpertEditor（snapshotDetail），编辑态（我的申请「前往修改」）不传、readonly=false', async () => {
    const snap = { kind: 'EXPERT', refId: 204, detail: { name: '研究报告专家（快照）' } }
    loadReviewSnapshot.mockResolvedValue(snap)
    await mount({ snapshotGate: true })
    await open({ kind: 'EXPERT', refId: 204, item: { name: '研究报告专家' } })
    expect(editor('ExpertEditor').dataset.id).toBe('204')
    expect(editor('ExpertEditor').dataset.readonly).toBe('true')
    expect(extra('ExpertEditor').snapshotDetail).toEqual(snap.detail)
    state.readonly = false
    await flush()
    expect(editor('ExpertEditor').dataset.readonly).toBe('false')
    expect(extra('ExpertEditor').snapshotDetail).toBeNull()
  })

  it('不需快照的类型（知识库 / MCP / API / 业务系统 / 模型）不查快照，直接按 refId 读当前配置（md §四 L48）', async () => {
    await mount({ snapshotGate: true })
    await open({ kind: 'KNOWLEDGE_BASE', refId: 'kb_3', item: { name: '法规与标准库' } })
    expect(loadReviewSnapshot).not.toHaveBeenCalled()
    expect(editor('KnowledgeBaseEditor').dataset.id).toBe('kb_3')
    expect(extra('KnowledgeBaseEditor').mode).toBe('view')
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
    state.readonly = false
    await flush()
    expect(extra('KnowledgeBaseEditor').mode).toBe('edit')
  })
})

describe('GovObjectDetail · 分发与吸底操作栏（md 审核中心 §四 / §4.1）', () => {
  it('MCP：kind 与 visible 同一 tick 置位 → 真实 McpEditor 创建时即 visible=true，仍能首次 load（getMcp 收到 refId；5303c7c immediate 回归）', async () => {
    await mount()
    expect(getMcp).not.toHaveBeenCalled()
    await open({ kind: 'MCP', refId: 'knowledge_hub', item: { name: '企业知识库 MCP' } })
    expect(getMcp).toHaveBeenCalledWith('knowledge_hub')
    // 只读抽屉已开且回填了名称（不是空抽屉）
    const drawer = container.querySelector('.drawer')
    expect(drawer).toBeTruthy()
    expect([...drawer.querySelectorAll('input')].some((i) => i.value === '企业知识库 MCP')).toBe(true)
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
  })

  it('API / 业务系统：按 refId 直透各自编辑器（readonly 默认 true）', async () => {
    await mount()
    await open({ kind: 'API', refId: 'api_1103', item: { name: '客户资料查询' } })
    expect(editor('ApiEditor').dataset.id).toBe('api_1103')
    expect(editor('ApiEditor').dataset.readonly).toBe('true')
    Object.assign(state, { kind: 'BIZ_SYSTEM', refId: 'biz_2102' })
    await flush()
    expect(editor('ApiEditor')).toBeNull()
    expect(editor('BizSystemEditor').dataset.id).toBe('biz_2102')
  })

  it('模型：先用行数据合成最小对象兜底、再按 refId 拉模型行传给 ModelConfigEditDialog（吸底栏 820px 宽 jsdom 不解析 min()，不在此断）', async () => {
    await mount()
    await open({ kind: 'MODEL', refId: 'md_104', item: { name: 'Kimi K2', description: '长上下文文本生成模型' } })
    await new Promise((r) => setTimeout(r, 0)) // 动态 import('@/api/adminModel') 需一个宏任务
    await flush()
    expect(getModel).toHaveBeenCalledWith('md_104')
    expect(extra('ModelConfigEditDialog').model).toEqual({ id: 'md_104', name: 'Kimi K2' })
    // 拉不到（demo 无对应实体）→ 保持合成对象兜底
    getModel.mockRejectedValueOnce(new Error('模型不存在'))
    Object.assign(state, { refId: 'md_999', item: { name: '未知模型', description: 'd' } })
    await new Promise((r) => setTimeout(r, 0))
    await flush()
    expect(extra('ModelConfigEditDialog').model).toEqual({ id: 'md_999', name: '未知模型', description: 'd' })
  })

  it('版本管理（VERSION）：按 refId 取到版本行再打开 VersionEditor（把版本行传下去）；不需快照，审核中心 / 我的申请查看态一律只读', async () => {
    await mount()
    await open({ kind: 'VERSION', refId: 7, item: { name: 'Mac v1.2.0' }, snapshotGate: true })
    await new Promise((r) => setTimeout(r, 0)) // 动态 import('@/api/version') 需一个宏任务
    await flush()
    expect(getVersion).toHaveBeenCalledWith(7)
    expect(loadReviewSnapshot).not.toHaveBeenCalled() // 版本管理不生成快照
    expect(editor('VersionEditor').dataset.visible).toBe('true')
    expect(extra('VersionEditor')).toMatchObject({ readonly: true, version: { id: 7, name: 'Mac v1.2.0' } })
    expect(barLabels()).toEqual(['关闭', '驳回', '通过']) // 吸底三键照常（快照闸门对 VERSION 不生效）
  })

  it('版本管理：编辑态（我的申请「前往修改」）只有「从未发布过的未发布版本」可改；发布过（含已回到未发布）/ 审核中 / 已发布一律只读', async () => {
    await mount()
    const cases = [
      ['未发布·从未发布过', { status: 'UNPUBLISHED', publishedAt: null }, false],
      ['未发布·曾发布过', { status: 'UNPUBLISHED', publishedAt: '2026-08-01T10:00:00+08:00' }, true],
      ['审核中', { status: 'PENDING_REVIEW', publishedAt: null }, true],
      ['已发布', { status: 'PUBLISHED', publishedAt: '2026-08-20T10:30:00+08:00' }, true]
    ]
    for (const [label, patch, readonly] of cases) {
      getVersion.mockResolvedValue({ id: 7, name: 'Mac v1.2.0', ...patch })
      state.visible = false
      await flush()
      await open({ kind: 'VERSION', refId: 7, readonly: false, buttons: [] })
      await new Promise((r) => setTimeout(r, 0))
      await flush()
      expect(extra('VersionEditor').readonly, label).toBe(readonly)
    }
  })

  it('版本管理：取不到版本（如 mock 数据被重置）→ 不打开抽屉（VersionEditor 保持 visible=false）', async () => {
    getVersion.mockRejectedValue(new Error('版本不存在'))
    await mount()
    await open({ kind: 'VERSION', refId: 9999, item: { name: 'Mac v9.9.9' } })
    await new Promise((r) => setTimeout(r, 0))
    await flush()
    expect(editor('VersionEditor').dataset.visible).toBe('false')
  })

  it('吸底栏：按钮组照 buttons 顺序渲染，点击上抛 action(key)；busyKey 命中的转圈、其余禁点；buttons 为空不出吸底栏', async () => {
    await mount()
    await open({ kind: 'API', refId: 'api_1103', item: { name: '客户资料查询' } })
    expect(barLabels()).toEqual(['关闭', '驳回', '通过'])
    expect(barBtns()[1].classList.contains('el-button--danger')).toBe(true)
    expect(barBtns()[2].classList.contains('el-button--primary')).toBe(true)
    barBtns()[2].click()
    await flush()
    expect(onAction).toHaveBeenCalledWith('approve')
    state.busyKey = 'approve'
    await flush()
    expect(barBtns()[2].classList.contains('is-loading')).toBe(true)
    expect(barBtns()[0].disabled).toBe(true)
    expect(barBtns()[1].disabled).toBe(true)
    state.busyKey = ''
    state.buttons = []
    await flush()
    expect(bar()).toBeNull()
  })

  it('visible=false → 不渲染吸底栏；编辑器上抛 update:visible=false 时宿主同步关闭', async () => {
    await mount()
    await open({ kind: 'API', refId: 'api_1103', item: { name: '客户资料查询' } })
    expect(bar()).toBeTruthy()
    state.visible = false
    await flush()
    expect(bar()).toBeNull()
    expect(editor('ApiEditor').dataset.visible).toBe('false')
  })
})
