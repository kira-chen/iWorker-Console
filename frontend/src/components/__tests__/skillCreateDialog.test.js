// @vitest-environment jsdom
/**
 * SkillCreateDialog —— 两窗合一（2026-08-24）后的类型选择行为。
 *
 * 背景：原交互是「点新建 → 选类型窗 → 下一步 → 二次确认『建后不可更改』→ 上传窗」；
 * 现改为类型单选内置于上传窗顶部，一步到位。本文件锁住合一后的关键不变式：
 *   1) 传 typeOptions 才启用内置类型选择；不传时行为与改造前一致（既有调用方不受影响）。
 *   2) 类型不预选，未选前提交被兜底拦截（类型决定 dist_channel，建后不可改，绝不能落空）。
 *   3) source / createFn / hint 全部随所选类型切换。
 *   4) 换类型要清掉分类选项与已选 categoryId（分类只有平台共享才有）。
 *   5) created 回传 skillType，父级据此解析编辑器路由。
 *
 * 挂载范式沿用本仓既有约定（createApp + 局部 stub + 取 _instance.setupState），
 * 不引入 @vue/test-utils（本仓未装该依赖）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

const importSkillZip = vi.fn()
const listSkillCategories = vi.fn()
// 2026-09-01 PRD 对齐改造取代旧口径：分类选项改走 fieldDict 同源字典（固定 8 类）
const listFieldDict = vi.fn()

vi.mock('@/api/skillFiles', () => ({ importSkillZip: (...a) => importSkillZip(...a) }))
vi.mock('@/api/skillCategory', () => ({ listSkillCategories: (...a) => listSkillCategories(...a) }))
vi.mock('@/api/fieldDict', () => ({ listFieldDict: (...a) => listFieldDict(...a) }))

import Dialog from '@/components/skill/SkillCreateDialog.vue'

const platformCreate = vi.fn(async () => ({ skillId: 'sk_platform' }))
const systemCreate = vi.fn(async () => ({ skillId: 'sk_system' }))
const positionCreate = vi.fn(async () => ({ skillId: 'sk_position' }))

const TYPE_OPTIONS = [
  { value: 'SYSTEM_DEFAULT', label: '系统内置', source: 'system', createFn: systemCreate, hint: '系统内置提示' },
  { value: 'POSITION', label: '岗位私有', source: 'fde', createFn: positionCreate, hint: '岗位私有提示' },
  { value: 'PLATFORM', label: '平台共享', source: 'platform', createFn: platformCreate, hint: '平台共享提示' }
]

const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const stubs = {
  'el-dialog': { name: 'el-dialog', template: '<div><slot /><slot name="footer" /></div>' },
  'el-upload': { name: 'el-upload', template: '<div><slot /><slot name="tip" /></div>' },
  'el-icon': passthrough('el-icon'),
  'el-radio-group': { name: 'el-radio-group', props: ['modelValue', 'disabled'], template: '<div><slot /></div>' },
  'el-radio': passthrough('el-radio'),
  'el-select': { name: 'el-select', props: ['modelValue', 'disabled'], template: '<div><slot /></div>' },
  'el-option': passthrough('el-option'),
  'el-form': { name: 'el-form', template: '<form><slot /></form>' },
  'el-form-item': passthrough('el-form-item'),
  'el-input': { name: 'el-input', props: ['modelValue'], template: '<div />' },
  'el-button': { name: 'el-button', template: '<button><slot /></button>' },
  UploadFilled: passthrough('UploadFilled')
}

let mountedApp = null
let mountedHost = null

/** 挂载弹窗，返回 { state, host, app }（setupState 承载 `<script setup>` 内部绑定）。 */
function mountDialog(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(Dialog, { modelValue: true, typeOptions: TYPE_OPTIONS, ...props })
  Object.entries(stubs).forEach(([k, v]) => app.component(k, v))
  app.mount(host)
  mountedApp = app
  mountedHost = host
  return { state: app._instance.setupState, host, app }
}

/** 一个待导入 zip 项（结构对齐组件内部 zipItems 元素）。 */
function zipItem(over = {}) {
  return { key: 1, name: 'a.zip', raw: {}, categoryId: null, status: 'pending', error: '', skillId: null, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  listSkillCategories.mockResolvedValue([{ id: 'cat_1', name: '办公' }])
  listFieldDict.mockResolvedValue({ skillCategory: [{ name: '办公效率' }] })
  importSkillZip.mockResolvedValue({ skillId: 'sk_zip' })
})

afterEach(() => {
  mountedApp?.unmount()
  mountedHost?.remove()
  mountedApp = null
  mountedHost = null
})

describe('SkillCreateDialog —— 类型选择两窗合一', () => {
  it('传 typeOptions 才渲染类型区与「不可更改」警示', async () => {
    const { host } = mountDialog()
    await nextTick()
    expect(host.textContent).toContain('技能类型')
    expect(host.textContent).toContain('建成后不可更改')
  })

  it('不传 typeOptions 时保持改造前形态（既有调用方不受影响）', async () => {
    const { host, state } = mountDialog({ typeOptions: [], source: 'fde', createFn: positionCreate })
    await nextTick()
    expect(host.textContent).not.toContain('技能类型')
    expect(state.typeMissing).toBe(false) // 未启用内置选择 → 不拦截
    expect(state.effectiveSource).toBe('fde')
  })

  it('类型不预选；未选时 zip 导入被兜底拦截、不发请求', async () => {
    const { state } = mountDialog()
    await nextTick()
    expect(state.pickedType).toBe(null)
    expect(state.typeMissing).toBe(true)

    // 绕过禁用按钮直接调提交函数也必须拦住（纵深防御）
    state.zipItems = [zipItem()]
    await state.confirmImportZip()
    expect(importSkillZip).not.toHaveBeenCalled()
    // 2026-09-01 PRD 对齐改造取代旧口径：拦截红字按疑点3 处置为组合文案
    expect(state.zipError).toContain('请选择技能类型、上传技能包，并为每个技能包选择分类')
  })

  it('未选类型时手动创建同样被拦截，三个 createFn 都不调', async () => {
    const { state } = mountDialog()
    await nextTick()
    state.createMode = 'manual'
    state.createName = '技能X'
    await state.confirmCreate()
    expect(positionCreate).not.toHaveBeenCalled()
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  it('source 随所选类型切换，并连同每包分类透传给 importSkillZip', async () => {
    const { state } = mountDialog()
    state.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    expect(state.effectiveSource).toBe('system')

    // 2026-09-01 PRD 对齐改造取代旧口径：每个技能包独立必选分类，未选分类会被拦截
    state.zipItems = [zipItem({ categoryId: '办公效率' })]
    await state.confirmImportZip()
    expect(importSkillZip).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'system', displayCategoryId: '办公效率' })
    )
  })

  // 2026-09-01 PRD 对齐改造取代旧口径：技能页语境 hint 恒空（提示文案随两窗合一收敛进弹窗结构），
  // 手动创建签名升级为 createFn({ name, categoryName })（分类必选）。
  it('createFn 随所选类型切换（新签名带分类），技能页语境 hint 恒空', async () => {
    const { state } = mountDialog()
    state.pickedType = 'POSITION'
    await nextTick()
    expect(state.effectiveHint).toBe('')

    state.createMode = 'manual'
    state.createName = '技能X'
    state.createCategory = '办公效率'
    await state.confirmCreate()
    expect(positionCreate).toHaveBeenCalledWith({ name: '技能X', categoryName: '办公效率' })
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  // 2026-09-01 PRD 对齐改造取代旧口径：分类选择器不再仅平台共享——技能页语境三类均显示、
  // 每包独立必选（固定 8 类 fieldDict 同源），换类型不清已选分类（分类词表跨类型通用）。
  it('分类选择器在技能页语境对三类均出现，选项来自 fieldDict', async () => {
    const { state } = mountDialog()
    state.pickedType = 'PLATFORM'
    await nextTick()
    expect(state.showCategorySelect).toBe(true)

    state.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    expect(state.showCategorySelect).toBe(true)

    await state.loadCategoryOptions()
    expect(state.categoryOptions).toEqual([{ id: '办公效率', name: '办公效率' }])
  })

  // 2026-09-01 PRD 对齐改造取代旧口径：技能页语境 zip 导入完成统一 emit created-batch
  //（单包也不自动进编辑页），skillType 仍回传供父级解析路由/刷新。
  it('zip 导入完成 emit created-batch 并回传 skillType（父级据此刷新列表）', async () => {
    const emitted = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(Dialog, {
      modelValue: true,
      typeOptions: TYPE_OPTIONS,
      onCreatedBatch: (p) => emitted.push(p)
    })
    Object.entries(stubs).forEach(([k, v]) => app.component(k, v))
    app.mount(host)
    mountedApp = app
    mountedHost = host

    const state = app._instance.setupState
    state.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    state.zipItems = [zipItem({ categoryId: '办公效率' })]
    await state.confirmImportZip()

    expect(emitted.at(-1)).toMatchObject({ skillIds: ['sk_zip'], skillType: 'SYSTEM_DEFAULT' })
  })

  it('重新打开弹窗强制重选类型，不沿用上次', async () => {
    const { state, app } = mountDialog({ modelValue: false })
    app._instance.props.modelValue = true
    await nextTick()
    state.pickedType = 'PLATFORM'
    await nextTick()

    app._instance.props.modelValue = false
    await nextTick()
    app._instance.props.modelValue = true
    await nextTick()
    expect(state.pickedType).toBe(null)
  })
})
