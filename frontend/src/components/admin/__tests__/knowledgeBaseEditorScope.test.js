// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeBaseEditor.vue「可见范围」必填校验（待办 yuepu#7⑤）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §三.3.1（L86）：
 *   可见范围必填；企业类型固定为「全员」（无需选择）；专家 / 岗位类型必须选中一项。
 *
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

const drawer = () => mounted.container.querySelector('.el-drawer')
const formModel = () => drawer().querySelector('form.el-form').__vueParentComponent.props.model
const errorTexts = () => [...drawer().querySelectorAll('.el-form-item__error')].map((e) => e.textContent.trim())
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

describe('KnowledgeBaseEditor · 可见范围必填（md §三.3.1 L86）', () => {
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
