// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * SkillCreateDialog（技能页 / 岗位白板共用新建对话框）行为测试。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.2 新建技能弹窗 L150-165：
 * 技能类型必选单选（L152）、每包独立选分类（L152）、未选类型/分类/内容不可提交（L153）、
 * 每次打开弹窗清空上次选择（L152/L165）、zip 导入返回列表 / 手动创建进编辑页（L157/L161）。
 * 原 AdminSkills #4 对话框断言（zip 主 + 手动次入口、F5c 就地回显）随本体迁到这里，
 * 并补两侧差异点：agentId/source 透传 importSkillZip、手动创建走 createFn。
 * 2026-09-12 审计 T33：原 components/__tests__/skillCreateDialog.test.js（类型选择两窗合一，9 条）并入本文件末尾 describe。
 */

vi.mock('@/api/skillFiles', () => ({ importSkillZip: vi.fn() }))
// 技能分类（2026-08-17）：上传弹窗对平台技能拉分类选项；必须 mock，否则真实模块拉 @/api/request → @/router。
vi.mock('@/api/skillCategory', () => ({
  listSkillCategories: vi.fn(() => Promise.resolve([{ id: 'cat_1', name: '工作' }, { id: 'cat_2', name: '效率' }]))
}))
// 2026-09-01 PRD 对齐改造取代旧口径：分类选项改走 fieldDict 同源字典（固定 8 类）
vi.mock('@/api/fieldDict', () => ({
  listFieldDict: vi.fn(() => Promise.resolve({ skillCategory: [{ name: '工作' }, { name: '效率' }] }))
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))

const SkillCreateDialog = (await import('@/components/skill/SkillCreateDialog.vue')).default

// 通用 EP 存根：透传默认插槽（含 footer 一并透传，便于查按钮时可扩展）。
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /><slot name="footer" /></div>` })
const EP_TAGS = ['el-dialog', 'el-upload', 'el-icon', 'el-form', 'el-form-item', 'el-input', 'el-button', 'el-select', 'el-option', 'el-radio-group', 'el-radio']

let app, container, emitted
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = { created: [], createdBatch: [], visible: [] }
  app = createApp(SkillCreateDialog, {
    modelValue: true,
    createFn: vi.fn(() => Promise.resolve({ skillId: 1 })),
    'onUpdate:modelValue': (v) => emitted.visible.push(v),
    onCreated: (p) => emitted.created.push(p),
    onCreatedBatch: (p) => emitted.createdBatch.push(p),
    ...props
  })
  for (const t of EP_TAGS) app.component(t, passthrough(t))
  app.mount(container)
  return container
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('SkillCreateDialog · zip 主 + 手动次入口就地切换', () => {
  it('默认 zip 模式；点手动链接就地切换为 manual（不跳窗）', async () => {
    const el = mount()
    const ss = app._instance.setupState
    expect(ss.createMode).toBe('zip') // #4 默认 zip 为主
    const link = el.querySelector('.create-alt-link')
    expect(link).toBeTruthy()
    link.click()
    await Promise.resolve()
    expect(app._instance.setupState.createMode).toBe('manual')
  })

  it('zip 导入失败 → 行内红字回显后端 message、不关弹窗、保留该包', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockRejectedValueOnce(new Error('技能包缺少 SKILL.md'))
    mount()
    const ss = app._instance.setupState
    ss.onZipChange({ name: '客户回访.zip', raw: new Blob(['z']) })
    await ss.confirmImportZip()
    await Promise.resolve()
    // 2026-08-17 多包批量后失败红字挂在各自行内（item.error），批级 zipError 仅作汇总
    expect(ss.zipItems[0].error).toContain('缺少 SKILL.md')
    expect(ss.zipItems[0].status).toBe('error')
    expect(emitted.visible).not.toContain(false) // 不关弹窗
    expect(emitted.created.length).toBe(0)
    expect(ss.zipItems.length).toBe(1) // 不清已选包，可修正后重试
  })

  it('zip 导入成功 → emit created(skillId, mode=zip) + 关弹窗', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockResolvedValueOnce({ skillId: 555 })
    mount()
    const ss = app._instance.setupState
    ss.onZipChange({ name: 'p.zip', raw: new Blob(['z']) })
    await ss.confirmImportZip()
    await Promise.resolve()
    expect(emitted.created).toEqual([expect.objectContaining({ skillId: 555, mode: 'zip' })])
    expect(emitted.visible.at(-1)).toBe(false)
  })

  it('agentId / source 透传 importSkillZip（岗位白板：导入直接挂目标 Agent）', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockResolvedValueOnce({ skillId: 7 })
    mount({ agentId: 'agent-1', source: 'fde' })
    const ss = app._instance.setupState
    const raw = new Blob(['z'])
    ss.onZipChange({ name: 'p.zip', raw })
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenCalledWith(raw, { agentId: 'agent-1', source: 'fde' })
  })

  it('手动创建走 createFn(name) → emit created(skillId, mode=manual) + 关弹窗', async () => {
    const createFn = vi.fn(() => Promise.resolve({ skillId: 99 }))
    mount({ createFn })
    const ss = app._instance.setupState
    ss.createMode = 'manual'
    ss.createName = '  新技能A  '
    await ss.confirmCreate()
    expect(createFn).toHaveBeenCalledWith('新技能A') // trim 后传入
    expect(emitted.created).toEqual([expect.objectContaining({ skillId: 99, mode: 'manual' })])
    expect(emitted.visible.at(-1)).toBe(false)
  })

  it('手动创建空名 → 警告且不调 createFn、不关弹窗', async () => {
    const createFn = vi.fn()
    mount({ createFn })
    const ss = app._instance.setupState
    ss.createMode = 'manual'
    ss.createName = '   '
    await ss.confirmCreate()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.warning).toHaveBeenCalled()
    expect(createFn).not.toHaveBeenCalled()
    expect(emitted.visible).not.toContain(false)
  })

  it('createFn 失败 → 错误提示、不关弹窗、不 emit created', async () => {
    const createFn = vi.fn(() => Promise.reject(new Error('同名技能已存在')))
    mount({ createFn })
    const ss = app._instance.setupState
    ss.createMode = 'manual'
    ss.createName = '重名'
    await ss.confirmCreate()
    const { ElMessage } = await import('element-plus')
    expect(ElMessage.error).toHaveBeenCalledWith('同名技能已存在')
    expect(emitted.created.length).toBe(0)
    expect(emitted.visible).not.toContain(false)
  })

  // 2026-08-17：el-upload 自持文件列表与 zipFile 是两份状态；弹窗非 destroy-on-close，重开时只重置
  // zipFile 会残留旧包名 UI——表现为「回显上次的 .zip 名，点导入却报『请先选择 .zip 技能包』」。
  // 修复约定：打开弹窗时须调 el-upload 的 clearFiles() 清残留列表。
  it('重新打开弹窗 → 调 el-upload clearFiles 清残留文件列表（防旧包名回显误导）', async () => {
    const clearFiles = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    const visible = ref(false)
    app = createApp({
      setup() {
        return () =>
          h(SkillCreateDialog, {
            modelValue: visible.value,
            createFn: vi.fn(),
            'onUpdate:modelValue': (v) => (visible.value = v)
          })
      }
    })
    for (const t of EP_TAGS) {
      if (t === 'el-upload') {
        app.component(t, { name: t, methods: { clearFiles }, template: `<div class="${t}"><slot /><slot name="tip" /></div>` })
      } else {
        app.component(t, passthrough(t))
      }
    }
    app.mount(container)
    expect(clearFiles).not.toHaveBeenCalled()
    // 模拟「上次用过后重新打开」：modelValue false → true 触发打开重置链路。
    visible.value = true
    await nextTick()
    await nextTick()
    expect(clearFiles).toHaveBeenCalled()
  })
})

describe('SkillCreateDialog · 技能分类下拉（2026-08-17，仅市场通道平台技能）', () => {
  // 2026-09-01 PRD 对齐改造取代旧口径：分类下拉不再由 source 决定，而是技能页语境
  //（传 typeOptions）下三类均显示、每包独立必选；选项改走 fieldDict 同源字典。
  it('技能页语境（typeOptions）→ 拉 fieldDict 分类并按包渲染下拉；每包选中值随 importSkillZip 独立透传 displayCategoryId', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    const { listFieldDict } = await import('@/api/fieldDict')
    importSkillZip.mockResolvedValue({ skillId: 9 })
    const el = mount({
      typeOptions: [{ value: 'PLATFORM', label: '市场技能', source: 'platform', createFn: vi.fn() }]
    })
    const ss = app._instance.setupState
    ss.pickedType = 'PLATFORM'
    await ss.loadCategoryOptions() // 打开链路（watch modelValue）在直挂 true 的测试装置下不触发，直调等价入口
    await Promise.resolve()
    expect(listFieldDict).toHaveBeenCalled()
    expect(ss.showCategorySelect).toBe(true)
    const raw = new Blob(['z'])
    ss.onZipChange({ name: 'p.zip', raw })
    await nextTick()
    expect(el.querySelector('.zip-item-cat')).toBeTruthy() // 每包一行内各自的分类下拉
    ss.zipItems[0].categoryId = '效率'
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenCalledWith(raw, {
      agentId: null,
      source: 'platform',
      displayCategoryId: '效率'
    })
  })

  it('source=platform 未选分类 → displayCategoryId 不传（undefined，按未分类落库）', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockResolvedValueOnce({ skillId: 10 })
    mount({ source: 'platform' })
    const ss = app._instance.setupState
    const raw = new Blob(['z'])
    ss.onZipChange({ name: 'p.zip', raw })
    await ss.confirmImportZip()
    const [, opt] = importSkillZip.mock.calls.at(-1)
    expect(opt.displayCategoryId).toBeUndefined()
  })

  it('source=fde → 不拉分类、不渲染下拉（FDE 技能无分类概念）', async () => {
    const { listSkillCategories } = await import('@/api/skillCategory')
    const el = mount({ source: 'fde' })
    const ss = app._instance.setupState
    await ss.loadCategoryOptions()
    await Promise.resolve()
    ss.onZipChange({ name: 'p.zip', raw: new Blob(['z']) })
    await nextTick()
    expect(listSkillCategories).not.toHaveBeenCalled()
    expect(ss.showCategorySelect).toBe(false)
    expect(el.querySelector('.zip-item-cat')).toBeNull()
  })
})

describe('SkillCreateDialog · 多包批量上传（2026-08-17）', () => {
  it('多次选包 → 列表累积；同一批重名 → 就地提示并跳过、不覆盖已有项', async () => {
    mount({ source: 'platform' })
    const ss = app._instance.setupState
    ss.onZipChange({ name: 'a.zip', raw: new Blob(['a']) })
    ss.onZipChange({ name: 'b.zip', raw: new Blob(['b']) })
    expect(ss.zipItems.length).toBe(2)
    ss.zipItems[0].categoryId = 'cat_1' // 先选好分类，再传重名包，验证不被覆盖
    ss.onZipChange({ name: 'a.zip', raw: new Blob(['a2']) })
    expect(ss.zipItems.length).toBe(2) // 重名被跳过
    expect(ss.zipError).toContain('不能重名')
    expect(ss.zipItems[0].categoryId).toBe('cat_1') // 既有项及其分类选择原样保留
  })

  it('每个包可独立删除；导入中禁删', async () => {
    mount()
    const ss = app._instance.setupState
    ss.onZipChange({ name: 'a.zip', raw: new Blob(['a']) })
    ss.onZipChange({ name: 'b.zip', raw: new Blob(['b']) })
    const keyA = ss.zipItems[0].key
    ss.removeZipItem(keyA)
    expect(ss.zipItems.length).toBe(1)
    expect(ss.zipItems[0].name).toBe('b.zip')
    ss.zipImporting = true
    ss.removeZipItem(ss.zipItems[0].key) // 导入中调删除 → 防御不生效
    expect(ss.zipItems.length).toBe(1)
    ss.zipImporting = false
  })

  it('多包全部成功 → 每包按各自分类逐包导入，emit created-batch（不逐包 created）+ 关弹窗', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockResolvedValueOnce({ skillId: 's1' }).mockResolvedValueOnce({ skillId: 's2' })
    mount({ source: 'platform' })
    const ss = app._instance.setupState
    const rawA = new Blob(['a'])
    const rawB = new Blob(['b'])
    ss.onZipChange({ name: 'a.zip', raw: rawA })
    ss.onZipChange({ name: 'b.zip', raw: rawB })
    ss.zipItems[0].categoryId = 'cat_1'
    ss.zipItems[1].categoryId = 'cat_2'
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenNthCalledWith(1, rawA, { agentId: null, source: 'platform', displayCategoryId: 'cat_1' })
    expect(importSkillZip).toHaveBeenNthCalledWith(2, rawB, { agentId: null, source: 'platform', displayCategoryId: 'cat_2' })
    expect(emitted.createdBatch).toEqual([expect.objectContaining({ skillIds: ['s1', 's2'], mode: 'zip' })])
    expect(emitted.created.length).toBe(0) // 多包不走单包导航事件
    expect(emitted.visible.at(-1)).toBe(false) // 关弹窗
  })

  it('部分失败 → 成功项移出列表并即时 created-batch，失败项留列表行内红字、弹窗不关', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip
      .mockResolvedValueOnce({ skillId: 's1' })
      .mockRejectedValueOnce(new Error('技能包缺少 SKILL.md'))
    mount()
    const ss = app._instance.setupState
    ss.onZipChange({ name: 'ok.zip', raw: new Blob(['a']) })
    ss.onZipChange({ name: 'bad.zip', raw: new Blob(['b']) })
    await ss.confirmImportZip()
    expect(ss.zipItems.length).toBe(1) // 成功项已移出，防重复导入
    expect(ss.zipItems[0].name).toBe('bad.zip')
    expect(ss.zipItems[0].error).toContain('缺少 SKILL.md')
    expect(ss.zipError).toContain('已导入 1 个')
    expect(emitted.createdBatch).toEqual([expect.objectContaining({ skillIds: ['s1'], mode: 'zip' })]) // 已成功的先行通知父级刷列表
    expect(emitted.visible).not.toContain(false) // 弹窗不关，失败项可重试
  })
})

/**
 * 类型选择两窗合一（2026-08-24；自 components/__tests__/skillCreateDialog.test.js 并入，审计 T33）。
 * 背景：原交互是「点新建 → 选类型窗 → 下一步 → 二次确认『建后不可更改』→ 上传窗」；
 * 现改为类型单选内置于上传窗顶部，一步到位。锁住合一后的关键不变式：
 *   1) 传 typeOptions 才启用内置类型选择；不传时行为与改造前一致（岗位白板调用方不受影响）。
 *   2) 类型不预选，未选前提交被兜底拦截（类型建后不可改，绝不能落空；md L152）。
 *   3) source / createFn / hint 全部随所选类型切换。
 *   4) 分类选择器三类均出现、选项来自 fieldDict 固定 8 类（md L152）。
 *   5) created-batch 回传 skillType，父级据此刷新列表。
 */
describe('SkillCreateDialog · 技能类型内置单选（md §三.2 L152-153）', () => {
  const platformCreate = vi.fn(async () => ({ skillId: 'sk_platform' }))
  const systemCreate = vi.fn(async () => ({ skillId: 'sk_system' }))
  const positionCreate = vi.fn(async () => ({ skillId: 'sk_position' }))
  // 词表照 md L12/L152：岗位私有 / 市场技能 / 通用技能
  const TYPE_OPTIONS = [
    { value: 'SYSTEM_DEFAULT', label: '通用技能', source: 'system', createFn: systemCreate, hint: '通用技能提示' },
    { value: 'POSITION', label: '岗位私有', source: 'fde', createFn: positionCreate, hint: '岗位私有提示' },
    { value: 'PLATFORM', label: '市场技能', source: 'platform', createFn: platformCreate, hint: '市场技能提示' }
  ]
  /** 一个待导入 zip 项（结构对齐组件内部 zipItems 元素）。 */
  const zipItem = (over = {}) => ({ key: 1, name: 'a.zip', raw: {}, categoryId: null, status: 'pending', error: '', skillId: null, ...over })
  const mountTyped = (props = {}) => {
    mount({ typeOptions: TYPE_OPTIONS, ...props })
    return app._instance.setupState
  }
  beforeEach(async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip.mockResolvedValue({ skillId: 'sk_zip' })
  })

  it('传 typeOptions 才渲染类型区与「建成后不可更改」警示（md L152）', async () => {
    mountTyped()
    await nextTick()
    expect(container.textContent).toContain('技能类型')
    expect(container.textContent).toContain('建成后不可更改')
  })

  it('不传 typeOptions 时保持改造前形态（岗位白板调用方不受影响）', async () => {
    mount({ typeOptions: [], source: 'fde' })
    const ss = app._instance.setupState
    await nextTick()
    expect(container.textContent).not.toContain('技能类型')
    expect(ss.typeMissing).toBe(false) // 未启用内置选择 → 不拦截
    expect(ss.effectiveSource).toBe('fde')
  })

  it('类型不预选；未选时 zip 导入被兜底拦截、不发请求、红字提示补齐（md L153）', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    const ss = mountTyped()
    await nextTick()
    expect(ss.pickedType).toBe(null)
    expect(ss.typeMissing).toBe(true)
    // 绕过禁用按钮直接调提交函数也必须拦住（纵深防御）
    ss.zipItems = [zipItem()]
    await ss.confirmImportZip()
    expect(importSkillZip).not.toHaveBeenCalled()
    // 拦截红字（代码现状为 zip 场景组合文案；md L153 统一为「请选择技能类型、技能分类并填写创建内容」，差异见审计 K 清单）
    expect(ss.zipError).toContain('请选择技能类型、上传技能包，并为每个技能包选择分类')
  })

  it('未选类型时手动创建同样被拦截，三个 createFn 都不调', async () => {
    const ss = mountTyped()
    await nextTick()
    ss.createMode = 'manual'
    ss.createName = '技能X'
    await ss.confirmCreate()
    expect(positionCreate).not.toHaveBeenCalled()
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  it('source 随所选类型切换，并连同每包分类透传给 importSkillZip', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    const ss = mountTyped()
    ss.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    expect(ss.effectiveSource).toBe('system')
    // 每个技能包独立必选分类，未选分类会被拦截
    ss.zipItems = [zipItem({ categoryId: '效率' })]
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'system', displayCategoryId: '效率' })
    )
  })

  it('createFn 随所选类型切换（签名 createFn({ name, categoryName })），技能页语境 hint 恒空', async () => {
    const ss = mountTyped()
    ss.pickedType = 'POSITION'
    await nextTick()
    expect(ss.effectiveHint).toBe('')
    ss.createMode = 'manual'
    ss.createName = '技能X'
    ss.createCategory = '效率'
    await ss.confirmCreate()
    expect(positionCreate).toHaveBeenCalledWith({ name: '技能X', categoryName: '效率' })
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  it('分类选择器在技能页语境对三类均出现，选项来自 fieldDict 固定分类（md L152）', async () => {
    const ss = mountTyped()
    ss.pickedType = 'PLATFORM'
    await nextTick()
    expect(ss.showCategorySelect).toBe(true)
    ss.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    expect(ss.showCategorySelect).toBe(true)
    await ss.loadCategoryOptions()
    expect(ss.categoryOptions).toEqual([{ id: '工作', name: '工作' }, { id: '效率', name: '效率' }])
  })

  it('zip 导入完成 emit created-batch 并回传 skillType（父级据此刷新列表，不自动进编辑页；md L152/L157）', async () => {
    const ss = mountTyped()
    ss.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    ss.zipItems = [zipItem({ categoryId: '效率' })]
    await ss.confirmImportZip()
    expect(emitted.createdBatch.at(-1)).toMatchObject({ skillIds: ['sk_zip'], skillType: 'SYSTEM_DEFAULT' })
    expect(emitted.created.length).toBe(0)
    expect(emitted.visible.at(-1)).toBe(false)
  })

  it('重新打开弹窗 → 类型重选、技能包 / 分类 / 手动名清空、回到 zip 初始上传态（md L152/L165 每次打开清空上次选择）', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const visible = ref(true)
    app = createApp({
      setup() {
        return () => h(SkillCreateDialog, { modelValue: visible.value, typeOptions: TYPE_OPTIONS, 'onUpdate:modelValue': (v) => (visible.value = v) })
      }
    })
    for (const t of EP_TAGS) app.component(t, passthrough(t))
    app.mount(container)
    const ss = app._container._vnode.component.subTree.component.setupState
    // 模拟上次用到一半：选了类型、切到手动、填了名与分类、还挂着一个包
    ss.pickedType = 'PLATFORM'
    ss.createMode = 'manual'
    ss.createName = '上次没提交的名字'
    ss.createCategory = '效率'
    ss.zipItems = [zipItem({ categoryId: '效率' })]
    await nextTick()
    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    expect(ss.pickedType).toBe(null)
    expect(ss.zipItems).toEqual([])
    expect(ss.createCategory).toBe('')
    expect(ss.createName).toBe('')
    expect(ss.createMode).toBe('zip')
  })
})
