// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll, makeDrawerProbes } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeBaseEditor.vue 编辑 / 查看抽屉单测（2026-10-08 /test-audit T4 由 knowledgeBaseEditorScope.test.js 改名，
 * 名实对齐：本文件早已不只管可见范围）。底部按钮矩阵另见同目录 knowledgeBaseEditorFooter.test.js。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md，共四组：
 *   1. 图标必填——§三.3.1「图标 | 是 | 支持从图标库选择或上传」（2026-09-21 负责人拍板由「否」改「是」）：
 *      标签带星标；未选图标点【保存】红字「请选择或上传图标」且不调 createKnowledgeBase，选好后放行。
 *   2. 查看态【提交发布】的图标门（待办 yuepu#34）——§三.6 发布完整校验：无图标 toast「请选择知识库图标」、
 *      不弹确认框；有图标进入二次确认。
 *   3. 可见范围必填（待办 yuepu#7⑤）——§三.3.1「可见范围 | 是 | 企业类型固定为全员；专家类型选择专家…；岗位类型选择岗位」：
 *      企业类型免选可保存且不出 `scopeRefId is required`；专家类型未选红字「请选择可见范围」。
 *   4. 加载失败态（yuepu#49②）——编辑态详情加载失败表单不渲染；底部只留【关闭】。
 *
 * 第 3 组背景：
 * 真挂载 Element Plus（桩 el-form-item 拦不住这个 bug）：`<el-form-item required>` 会让 Element 额外塞一条
 * 内置 `{ required: true }` 规则，企业类型的 scopeRefId 恒为 '' → 报英文 `scopeRefId is required`，
 * 企业知识库永远存不下来。修法是把必填星标放进 rules 里（`required: true` + 自定义 validator），
 * 由 validator 统一裁决「企业类型免选」。
 */

const api = {
  getKnowledgeBase: vi.fn(),
  createKnowledgeBase: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  publishKnowledgeBase: vi.fn(),
  withdrawKnowledgeBase: vi.fn(),
  listKnowledgeSources: vi.fn(),
  listExpertOptions: vi.fn(),
  listPositionOptions: vi.fn()
}
vi.mock('@/api/knowledgeBase', () => api)

const Editor = (await import('@/components/admin/KnowledgeBaseEditor.vue')).default

let mounted
afterEach(() => {
  ElMessage.closeAll()
  mounted?.unmount()
  mounted = null
  vi.clearAllMocks()
})

const { drawer, formModel, errorTexts } = makeDrawerProbes(() => mounted.container)
const clickBtn = (label) => [...drawer().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === label).click()
/** 可见范围表单项（按标签文字定位，不依赖顺序） */
const scopeItem = () => [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.trim() === '可见范围')

async function mountCreate({ withIcon = true } = {}) {
  api.listKnowledgeSources.mockResolvedValue({ list: [] })
  api.listExpertOptions.mockResolvedValue([{ id: 'ex_1', name: '售前专家' }])
  api.listPositionOptions.mockResolvedValue([{ id: 'pos_1', name: '销售顾问' }])
  api.createKnowledgeBase.mockResolvedValue({ id: 'kb_new', name: '新库', kbType: 'ENTERPRISE', sources: [] })
  mounted = mountReal(Editor, { visible: true, kbId: null })
  await flushAll(10)
  // 名称 / 描述走 v-model 真输入
  const inputs = drawer().querySelectorAll('input.el-input__inner, textarea.el-textarea__inner')
  const [nameEl] = [...inputs].filter((el) => el.tagName === 'INPUT' && !el.closest('.el-select'))
  const descEl = drawer().querySelector('textarea.el-textarea__inner')
  for (const [el, v] of [[nameEl, '新库'], [descEl, '放产品资料，给全员用']]) {
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // 图标自 2026-09-21 负责人拍板起必填：默认选好，图标用例传 { withIcon: false }
  if (withIcon) formModel().icon = '📦'
  await flushAll(4)
}

describe('KnowledgeBaseEditor · 图标必填（2026-09-21 负责人拍板，原选填）', () => {
  const iconItem = () => [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.trim() === '图标')

  it('「图标」标签带必填星标（与名称 / 类型 / 可见范围 / 描述同为必填）', async () => {
    await mountCreate()
    expect(iconItem().classList.contains('is-required')).toBe(true)
  })

  it('未选图标点【保存】：红字「请选择或上传图标」、不调 createKnowledgeBase；选好图标后放行', async () => {
    await mountCreate({ withIcon: false })
    expect(formModel().icon).toBe('')

    clickBtn('保存')
    await flushAll(10)
    await new Promise((r) => setTimeout(r, 250)) // ElFormItem 红字过 100ms 防抖才渲染
    await flushAll(4)
    expect(errorTexts()).toContain('请选择或上传图标')
    expect(api.createKnowledgeBase).not.toHaveBeenCalled()

    formModel().icon = '📦'
    await flushAll(6)
    clickBtn('保存')
    await flushAll(10)
    await new Promise((r) => setTimeout(r, 250)) // 与其余用例同：等异步校验落定再断言，避免调用漏到下一个用例
    await flushAll(4)
    expect(api.createKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(api.createKnowledgeBase.mock.calls[0][0]).toMatchObject({ icon: '📦' })
  })
})

describe('KnowledgeBaseEditor · 查看态【提交发布】的图标门（待办 yuepu#34）', () => {
  // 查看抽屉不调 formRef.validate()，发布前只靠 publishBlockReason(detail)；此前它不查图标，
  // 无图标的库在查看态能一路点到提交发布（md §三.6 发布完整校验是独立条款）
  const viewDetail = (over = {}) => ({
    id: 'kb_v', name: '查看态库', icon: '📦', kbType: 'ENTERPRISE', scopeRefId: null, description: '有描述',
    status: 'DRAFT', pendingAction: null,
    sources: [{ id: 's1', name: '产品资料', sourceType: 'UPLOAD', status: 'ENABLED', docCount: 2, parsedDocCount: 2 }],
    ...over
  })
  // 确认框关闭有过渡动画，上一个用例的 .el-message-box 可能还挂在 document 上——只比「点击前后的数量」，不断言绝对为空（shuffle 下曾在 CI 假红）
  const boxCount = () => document.querySelectorAll('.el-message-box').length
  async function mountView(detail) {
    api.listKnowledgeSources.mockResolvedValue({ list: [] })
    api.listExpertOptions.mockResolvedValue([])
    api.listPositionOptions.mockResolvedValue([])
    api.getKnowledgeBase.mockResolvedValue(detail)
    mounted = mountReal(Editor, { visible: true, kbId: 'kb_v', mode: 'view' })
    await flushAll(10)
  }

  it('无图标：点【提交发布】→ toast「请选择知识库图标」，不弹确认框、不调 publishKnowledgeBase', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    await mountView(viewDetail({ icon: '' }))
    const before = boxCount()
    clickBtn('提交发布')
    await flushAll(10)
    expect(err).toHaveBeenCalledWith('请选择知识库图标')
    expect(boxCount()).toBe(before)
    expect(api.publishKnowledgeBase).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('有图标（其余条件齐备）：不被图标门拦，进入「确认提交发布」二次确认', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    await mountView(viewDetail())
    const before = boxCount()
    clickBtn('提交发布')
    await flushAll(10)
    expect(err).not.toHaveBeenCalled()
    expect(boxCount()).toBe(before + 1)
    err.mockRestore()
    ;[...document.querySelectorAll('.el-message-box .el-button')].find((b) => b.textContent.trim() === '取消')?.click() // 取消，别让确认框漏到下一个用例
    await flushAll(6)
  })
})

describe('KnowledgeBaseEditor · 可见范围必填（md §三.3.1）', () => {
  it('企业类型（默认）：可见范围固定「全员」不用选，点【保存】能调到 createKnowledgeBase，且无 `scopeRefId is required`', async () => {
    await mountCreate()
    expect(formModel().kbType).toBe('ENTERPRISE')
    expect(formModel().scopeRefId).toBe('')

    clickBtn('保存')
    await flushAll(10)
    await new Promise((r) => setTimeout(r, 250)) // ElFormItem 红字过 100ms 防抖才渲染
    await flushAll(4)

    expect(errorTexts().join('|')).not.toContain('scopeRefId is required')
    expect(api.createKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(api.createKnowledgeBase.mock.calls[0][0]).toMatchObject({ kbType: 'ENTERPRISE', scopeRefId: null })
  })

  it('企业类型：「可见范围」标签仍带必填星标（PRD 一览表「是」）', async () => {
    await mountCreate()
    expect(scopeItem().classList.contains('is-required')).toBe(true)
  })

  it('专家类型未选可见范围：红字「请选择可见范围」、不调 createKnowledgeBase', async () => {
    await mountCreate()
    formModel().kbType = 'EXPERT'
    await flushAll(6)

    clickBtn('保存')
    await flushAll(10)
    await new Promise((r) => setTimeout(r, 250))
    await flushAll(4)

    expect(errorTexts()).toContain('请选择可见范围')
    expect(errorTexts().join('|')).not.toContain('scopeRefId is required')
    expect(api.createKnowledgeBase).not.toHaveBeenCalled()
  })
})

// yuepu#49②：自写 #footer 绕开了 DrawerEditor 的 submitBlocked；加载失败时表单不渲染、formRef 为 null，
// 底部只留【关闭】，不出【保存】【删除】【提交发布】（isOffline(null) 为 true 的误判已被页脚分支挡住）。
describe('KnowledgeBaseEditor · 加载失败态（yuepu#49②）', () => {
  it('前提：编辑态详情加载失败 → 表单不渲染', async () => {
    api.getKnowledgeBase.mockRejectedValue(new Error('炸了'))
    api.listKnowledgeSources.mockResolvedValue({ list: [] })
    api.listExpertOptions.mockResolvedValue([])
    api.listPositionOptions.mockResolvedValue([])
    mounted = mountReal(Editor, { visible: true, kbId: 'kb_1' })
    await flushAll(10)
    expect(drawer().querySelector('form.el-form')).toBeNull()
  })

  /** 编辑态详情加载失败 / 加载中的共用装配（loadPending=true 让详情请求一直悬着 = 加载中） */
  async function mountEditFail({ loadPending = false } = {}) {
    if (loadPending) api.getKnowledgeBase.mockReturnValue(new Promise(() => {}))
    else api.getKnowledgeBase.mockRejectedValue(new Error('炸了'))
    api.listKnowledgeSources.mockResolvedValue({ list: [] })
    api.listExpertOptions.mockResolvedValue([])
    api.listPositionOptions.mockResolvedValue([])
    mounted = mountReal(Editor, { visible: true, kbId: 'kb_1' })
    await flushAll(10)
  }
  const clickableFooter = () =>
    [...drawer().querySelectorAll('.el-button')]
      .filter((b) => !b.disabled && !b.classList.contains('is-disabled'))
      .map((b) => b.textContent.trim())

  it('yuepu#49② 编辑态加载失败 → 底部只剩可点的【关闭】，不出现【保存】【删除】【提交发布】', async () => {
    await mountEditFail()
    const clickable = clickableFooter()
    // 前提：页脚真渲染了（否则「不含保存」会在页脚整个没渲染时也通过）
    expect(clickable).toContain('关闭')
    for (const text of ['保存', '删除', '提交发布']) expect(clickable).not.toContain(text)
  })

  it('yuepu#49② 编辑态加载中（详情请求在途）→ 底部同样只留【关闭】', async () => {
    await mountEditFail({ loadPending: true })
    expect(drawer().querySelector('form.el-form')).toBeNull() // 前提：表单未渲染 = 加载中
    const clickable = clickableFooter()
    expect(clickable).toContain('关闭')
    for (const text of ['保存', '删除', '提交发布']) expect(clickable).not.toContain(text)
  })

  it('yuepu#49② formRef 为 null（加载失败）时直接调 save() → 返回 false、不抛 TypeError、不写库', async () => {
    await mountEditFail()
    // 页脚已无【保存】入口，直接调组件内部 save() 验证守卫（setupState 为 Vue 开发态可读的内部入口）
    const { save } = mounted.app._instance.subTree.component.setupState
    await expect(save()).resolves.toBe(false)
    expect(api.updateKnowledgeBase).not.toHaveBeenCalled()
    expect(api.createKnowledgeBase).not.toHaveBeenCalled()
  })
})
