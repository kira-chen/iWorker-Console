// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeBaseEditor.vue 底栏按钮 / 关键变更确认 / 数据源候选 / 上下文锁 / 发布与保存失败 ——
 * 2026-10-08 测试审计补缺口（真挂载 Element Plus，只 mock api 层；同目录 knowledgeBaseEditorScope.test.js 管必填）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 * - §三.4.1 编辑抽屉底部按钮（新建 / 未发布 / 审核中 / 已发布）与 §三.4.2 查看抽屉底部按钮（审核中 / 未发布 / 已发布）；
 *   §三.3「审核中配置锁定，仅允许查看或撤回」；
 * - §三.5 已发布库新增 / 移除 / 替换数据源保存前必须二次确认；只改名称或描述按现有规则保存；
 * - §三.3.2 候选项仅含启用数据源（已被本库引用的停用源作存量兜底保留）；无解析成功文档 / 验证失败显示风险提示；
 * - §三.3.1 + 《各模块必填选填字段一览表》§十：名称最多 64、描述最多 2000；专家类型可见范围创建后不可更改；
 *   §三.8 岗位上下文新建锁定类型与可见范围；
 * - §三.6 发布完整校验「至少引用 1 个已启用数据源」，失败不进入审核中（展示形态见 J9，当前为 toast）；
 *   §八.2 保存失败保留表单内容、不关闭抽屉。
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

/* ---------- 数据 ---------- */
const src = (id, sourceType, name, over = {}) => ({
  id,
  sourceType,
  name,
  status: 'ENABLED',
  verifyStatus: sourceType === 'UPLOAD' ? undefined : 'SUCCESS',
  docCount: sourceType === 'UPLOAD' ? 3 : undefined,
  parsedDocCount: sourceType === 'UPLOAD' ? 3 : undefined,
  ...over
})
const UP_A = src('s_up_a', 'UPLOAD', '产品资料源')
const UP_B = src('s_up_b', 'UPLOAD', '案例资料源')
const detailOf = (over = {}) => ({
  id: 'kb_t',
  name: '测试知识库',
  icon: '📦',
  kbType: 'ENTERPRISE',
  scopeRefId: null,
  description: '原描述',
  status: 'DRAFT',
  pendingAction: null,
  sources: [UP_A],
  ...over
})

let mounted
afterEach(() => {
  ElMessage.closeAll()
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mountEditor({ props = {}, detail = null, pool = [UP_A, UP_B] } = {}) {
  api.listKnowledgeSources.mockResolvedValue({ list: pool })
  api.listExpertOptions.mockResolvedValue([{ id: 'ex_1', name: '方案专家' }])
  api.listPositionOptions.mockResolvedValue([{ id: 'pos_1', name: '销售顾问' }])
  if (detail) api.getKnowledgeBase.mockResolvedValue(detail)
  const onClose = vi.fn()
  mounted = mountReal(Editor, { visible: true, kbId: detail ? detail.id : null, 'onUpdate:visible': onClose, ...props })
  await flushAll(12)
  return { onClose }
}
const drawer = () => mounted.container.ownerDocument.querySelector('.el-drawer')
const footLabels = () => [...drawer().querySelectorAll('.kb-foot .el-button')].map((b) => b.textContent.trim())
const footBtn = (label) => [...drawer().querySelectorAll('.kb-foot .el-button')].find((b) => b.textContent.trim() === label)
const itemByLabel = (label) =>
  [...drawer().querySelectorAll('.el-form-item')].find((i) => i.querySelector('.el-form-item__label')?.textContent.trim() === label)
const nameInput = () => itemByLabel('知识库名称').querySelector('input')
const descInput = () => itemByLabel('描述').querySelector('textarea')
const typeInput = (el, v) => {
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
/** 等异步校验（ElForm validate）与后续 await 链落定 */
const settle = async () => {
  await flushAll(10)
  await new Promise((r) => setTimeout(r, 250))
  await flushAll(6)
}
/** 某一类数据源下拉（上传 / API / MCP）当前可选的候选名称（下拉内容挂在 body 上，按 select 的 aria-controls 定位） */
function optionNames(typeLabel) {
  const wrapper = itemByLabel(typeLabel).querySelector('.el-select__wrapper')
  const input = itemByLabel(typeLabel).querySelector('input')
  const listId = input.getAttribute('aria-controls')
  const list = listId ? document.getElementById(listId) : null
  expect(list, `找不到「${typeLabel}」下拉列表`).toBeTruthy()
  expect(wrapper).toBeTruthy()
  return [...list.querySelectorAll('.el-select-dropdown__item .kb-opt-name')].map((n) => n.textContent.trim())
}
function clickOption(typeLabel, name) {
  const listId = itemByLabel(typeLabel).querySelector('input').getAttribute('aria-controls')
  const item = [...document.getElementById(listId).querySelectorAll('.el-select-dropdown__item')].find(
    (i) => i.querySelector('.kb-opt-name')?.textContent.trim() === name
  )
  item.click()
}

/* ================= §三.4.1 / §三.4.2 底栏按钮矩阵 ================= */
describe('KnowledgeBaseEditor · 底部按钮矩阵（md §三.4.1 / §三.4.2）', () => {
  const PUBLISHED = { status: 'PUBLISHED', pendingAction: null }
  const DRAFT = { status: 'DRAFT', pendingAction: null }
  const PENDING = { status: 'DRAFT', pendingAction: 'PUBLISH' }
  it.each([
    ['编辑 · 新建', 'edit', null, ['取消', '保存']],
    ['编辑 · 未发布', 'edit', DRAFT, ['删除', '取消', '保存', '提交发布']],
    ['编辑 · 审核中', 'edit', PENDING, ['关闭', '撤回']],
    ['编辑 · 已发布', 'edit', PUBLISHED, ['取消', '保存']],
    ['查看 · 审核中', 'view', PENDING, ['关闭', '撤回']],
    ['查看 · 未发布', 'view', DRAFT, ['关闭', '提交发布']],
    ['查看 · 已发布', 'view', PUBLISHED, ['关闭']]
  ])('%s → 底栏依次为 %j', async (_name, mode, state, expected) => {
    await mountEditor({ props: { mode }, detail: state ? detailOf(state) : null })
    expect(footLabels()).toEqual(expected)
  })

  it('编辑 · 审核中（待停用）→ 底栏同样是「关闭 · 撤回」', async () => {
    await mountEditor({ detail: detailOf({ status: 'PUBLISHED', pendingAction: 'DELIST' }) })
    expect(footLabels()).toEqual(['关闭', '撤回'])
  })

  it('编辑 · 审核中 → 表单整体只读：名称 / 描述输入框与各下拉全部禁用', async () => {
    await mountEditor({ detail: detailOf({ status: 'DRAFT', pendingAction: 'PUBLISH' }) })
    expect(nameInput().disabled).toBe(true)
    expect(descInput().disabled).toBe(true)
    const selects = [...drawer().querySelectorAll('form .el-select')]
    expect(selects.length).toBeGreaterThan(0)
    for (const s of selects) expect(s.querySelector('.el-select__wrapper').classList.contains('is-disabled')).toBe(true)
  })

  it('编辑 · 未发布（对照）→ 名称 / 描述可编辑', async () => {
    await mountEditor({ detail: detailOf() })
    expect(nameInput().disabled).toBe(false)
    expect(descInput().disabled).toBe(false)
  })
})

/* ================= §三.5 已发布关键变更二次确认 ================= */
describe('KnowledgeBaseEditor · 已发布库关键变更（md §三.5）', () => {
  it('已发布库新增一个上传数据源后点【保存】→ 弹「需要重新审核」确认；取消则不调保存接口', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await mountEditor({ detail: detailOf({ status: 'PUBLISHED' }) })
    clickOption('上传', '案例资料源')
    await flushAll(6)
    footBtn('保存').click()
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][1]).toBe('需要重新审核')
    expect(api.updateKnowledgeBase).not.toHaveBeenCalled()
  })

  it('已发布库改数据源后在确认框点确认 → 才调保存接口，带上新的数据源引用', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    await mountEditor({ detail: detailOf({ status: 'PUBLISHED' }) })
    api.updateKnowledgeBase.mockResolvedValue(detailOf({ status: 'DRAFT', sources: [UP_A, UP_B] }))
    clickOption('上传', '案例资料源')
    await flushAll(6)
    footBtn('保存').click()
    await settle()
    expect(api.updateKnowledgeBase).toHaveBeenCalledTimes(1)
    expect([...api.updateKnowledgeBase.mock.calls[0][1].sourceIds].sort()).toEqual(['s_up_a', 's_up_b'])
  })

  it('已发布库只改描述 → 不弹确认，直接调保存接口', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    await mountEditor({ detail: detailOf({ status: 'PUBLISHED' }) })
    api.updateKnowledgeBase.mockResolvedValue(detailOf({ status: 'PUBLISHED', description: '新描述' }))
    typeInput(descInput(), '新描述')
    await flushAll(4)
    footBtn('保存').click()
    await settle()
    expect(confirm).not.toHaveBeenCalled()
    expect(api.updateKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(api.updateKnowledgeBase.mock.calls[0][1]).toMatchObject({ description: '新描述', sourceIds: ['s_up_a'] })
  })
})

/* ================= §三.3.2 候选与风险提示 ================= */
describe('KnowledgeBaseEditor · 数据源候选与风险提示（md §三.3.2）', () => {
  const UP_OFF = src('s_up_off', 'UPLOAD', '已停用资料源', { status: 'DISABLED' })
  const UP_OFF_REF = src('s_up_off_ref', 'UPLOAD', '已停用但在引用', { status: 'DISABLED' })

  it('停用的上传源不出现在「上传」候选里；启用的都在', async () => {
    await mountEditor({ detail: detailOf(), pool: [UP_A, UP_B, UP_OFF] })
    const names = optionNames('上传')
    expect(names).toEqual(expect.arrayContaining(['产品资料源', '案例资料源']))
    expect(names).not.toContain('已停用资料源')
  })

  it('本库已引用的停用源（存量）仍保留在候选里，方便手动移除', async () => {
    await mountEditor({ detail: detailOf({ sources: [UP_A, UP_OFF_REF] }), pool: [UP_A, UP_OFF, UP_OFF_REF] })
    const names = optionNames('上传')
    expect(names).toContain('已停用但在引用')
    expect(names).not.toContain('已停用资料源')
  })

  it('引用了没有解析成功文档的上传源 → 风险提示「「X」还没有解析成功的文档」', async () => {
    const empty = src('s_up_0', 'UPLOAD', '空资料源', { docCount: 2, parsedDocCount: 0 })
    await mountEditor({ detail: detailOf({ sources: [empty] }), pool: [empty] })
    const warns = [...drawer().querySelectorAll('.kb-ref-warn')].map((w) => w.textContent.trim())
    expect(warns).toContain('⚠ 「空资料源」还没有解析成功的文档')
  })

  it('引用了连接验证失败的 API 源 → 风险提示「「X」连接验证失败」', async () => {
    const bad = src('s_api_bad', 'API', '坏接口', { verifyStatus: 'FAILED' })
    await mountEditor({ detail: detailOf({ sources: [bad] }), pool: [bad] })
    const warns = [...drawer().querySelectorAll('.kb-ref-warn')].map((w) => w.textContent.trim())
    expect(warns).toContain('⚠ 「坏接口」连接验证失败')
  })

  it('引用的都是正常源（有解析成功文档）→ 无风险提示', async () => {
    await mountEditor({ detail: detailOf(), pool: [UP_A] })
    expect(drawer().querySelectorAll('.kb-ref-warn').length).toBe(0)
  })
})

/* ================= §三.8 / §三.3.1 上下文锁与字数上限 ================= */
describe('KnowledgeBaseEditor · 岗位上下文锁 / 专家范围锁 / 字数上限（md §三.8 / §三.3.1）', () => {
  const selectOf = (label) => itemByLabel(label).querySelector('.el-select__wrapper')
  const selectedText = (label) => itemByLabel(label).querySelector('.el-select__selected-item:not(.is-hidden)')?.textContent.trim()

  it('从岗位上下文新建 → 类型锁「岗位」、可见范围锁当前岗位，两者都禁用', async () => {
    await mountEditor({ props: { positionLock: { id: 'pos_1', name: '销售顾问' } } })
    expect(selectedText('类型')).toBe('岗位')
    expect(selectOf('类型').classList.contains('is-disabled')).toBe(true)
    expect(selectedText('可见范围')).toBe('销售顾问')
    expect(selectOf('可见范围').classList.contains('is-disabled')).toBe(true)
  })

  it('从岗位上下文新建 → 帮助文案「岗位知识库不可更改」「可见范围锁定为当前岗位」', async () => {
    await mountEditor({ props: { positionLock: { id: 'pos_1', name: '销售顾问' } } })
    expect(itemByLabel('类型').textContent).toContain('岗位知识库不可更改')
    expect(itemByLabel('可见范围').textContent).toContain('可见范围锁定为当前岗位')
  })

  it('普通新建（对照）→ 类型可选、帮助文案「创建后不可更改」', async () => {
    await mountEditor()
    expect(selectOf('类型').classList.contains('is-disabled')).toBe(false)
    expect(itemByLabel('类型').textContent).toContain('创建后不可更改')
  })

  it('编辑专家知识库 → 可见范围（所属专家）禁用', async () => {
    await mountEditor({ detail: detailOf({ kbType: 'EXPERT', scopeRefId: 'ex_1' }) })
    expect(selectedText('可见范围')).toBe('方案专家')
    expect(selectOf('可见范围').classList.contains('is-disabled')).toBe(true)
  })

  it('编辑岗位知识库（对照）→ 可见范围仍可改', async () => {
    await mountEditor({ detail: detailOf({ kbType: 'POSITION', scopeRefId: 'pos_1' }) })
    expect(selectOf('可见范围').classList.contains('is-disabled')).toBe(false)
  })

  it('名称输入框最多 64 字、描述最多 2000 字（一览表 §十）', async () => {
    await mountEditor()
    expect(nameInput().getAttribute('maxlength')).toBe('64')
    expect(descInput().getAttribute('maxlength')).toBe('2000')
  })
})

/* ================= §三.6 / §八.2 发布校验与保存失败 ================= */
describe('KnowledgeBaseEditor · 提交发布校验与保存失败（md §三.6 / §八.2）', () => {
  it('未发布库无数据源点【提交发布】→ toast「至少引用 1 个已启用数据源才能提交发布」，不弹确认、不调发布接口', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    await mountEditor({ detail: detailOf({ sources: [] }) })
    footBtn('提交发布').click()
    await settle()
    expect(err).toHaveBeenCalledWith('至少引用 1 个已启用数据源才能提交发布')
    expect(confirm).not.toHaveBeenCalled()
    expect(api.publishKnowledgeBase).not.toHaveBeenCalled()
  })

  it('未发布库条件齐备点【提交发布】（对照）→ 进入「提交发布」确认', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await mountEditor({ detail: detailOf() })
    footBtn('提交发布').click()
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][1]).toBe('提交发布')
    expect(api.publishKnowledgeBase).not.toHaveBeenCalled()
  })

  it('保存接口失败 → toast 带失败原因、不关闭抽屉、刚改的名称仍在输入框里', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    const { onClose } = await mountEditor({ detail: detailOf() })
    api.updateKnowledgeBase.mockRejectedValue(Object.assign(new Error('同类型下已存在同名知识库'), { code: 409 }))
    typeInput(nameInput(), '改过的名字')
    await flushAll(4)
    footBtn('保存').click()
    await settle()
    expect(api.updateKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalledWith('同类型下已存在同名知识库')
    expect(onClose).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('改过的名字')
    expect(footLabels()).toEqual(['删除', '取消', '保存', '提交发布'])
  })

  it('保存成功（对照）→ 关闭抽屉', async () => {
    const { onClose } = await mountEditor({ detail: detailOf() })
    api.updateKnowledgeBase.mockResolvedValue(detailOf({ name: '改过的名字' }))
    typeInput(nameInput(), '改过的名字')
    await flushAll(4)
    footBtn('保存').click()
    await settle()
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
