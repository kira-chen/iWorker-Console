// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * SkillCreateDialog（技能页新建对话框）行为测试。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §三.2 新建技能弹窗：
 * 技能类型必选单选（§三.2「技能类型：必选单选」）、每包独立选分类（§三.2「每个包必须独立选择分类」）、未选类型/分类/内容不可提交（§三.2「未选择类型、分类或未填写创建内容时不可提交」）、
 * 每次打开弹窗清空上次选择（§三.2「每次打开弹窗清空上次选择」）、zip 导入返回列表 / 手动创建进编辑页（§三.2「导入完成后统一返回技能列表，不自动进入编辑页」/「点击【创建】后直接跳转至编辑页」）。
 * 原 AdminSkills #4 对话框断言（zip 主 + 手动次入口、F5c 就地回显）随本体迁到这里。
 * 2026-09-12 审计 T33：原 components/__tests__/skillCreateDialog.test.js（类型选择两窗合一，9 条）并入本文件末尾 describe。
 * 2026-10-10 J10：组件退役「不传 typeOptions」旧分支（旧调用形态已无调用方），本文件删去守旧分支的 6 条用例
 * （source 透传、createFn(name) 旧签名、旧空名 warning、platform 未选分类、fde 不拉分类、不传 typeOptions 旧形态），
 * 其余用例统一经 typeOptions + 选定类型 + 每包选分类的新口径运行。
 */

vi.mock('@/api/skillFiles', () => ({ importSkillZip: vi.fn() }))
// 2026-09-01 PRD 对齐改造取代旧口径：分类选项改走 fieldDict 同源字典（固定 11 类）
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

const baseCreateFn = vi.fn(() => Promise.resolve({ skillId: 1 }))
const BASE_TYPES = [{ value: 'PLATFORM', label: '市场技能', source: 'platform', createFn: baseCreateFn }]

let app, container, emitted
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = { created: [], createdBatch: [], visible: [] }
  app = createApp(SkillCreateDialog, {
    modelValue: true,
    typeOptions: BASE_TYPES,
    'onUpdate:modelValue': (v) => emitted.visible.push(v),
    onCreated: (p) => emitted.created.push(p),
    onCreatedBatch: (p) => emitted.createdBatch.push(p),
    ...props
  })
  for (const t of EP_TAGS) app.component(t, passthrough(t))
  app.mount(container)
  return container
}
/** 已选定第一个类型的挂载（多数用例不关心类型选择本身）。 */
function mountPicked(props = {}) {
  const el = mount(props)
  const ss = app._instance.setupState
  ss.pickedType = (props.typeOptions || BASE_TYPES)[0].value
  return el
}
/** 加一个待导入 zip，并给它选好分类（每包必选分类）。 */
function addZip(ss, name, raw = new Blob(['z']), categoryId = '效率') {
  ss.onZipChange({ name, raw })
  ss.zipItems.at(-1).categoryId = categoryId
  return raw
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
    mountPicked()
    const ss = app._instance.setupState
    addZip(ss, '客户回访.zip')
    await ss.confirmImportZip()
    await Promise.resolve()
    // 2026-08-17 多包批量后失败红字挂在各自行内（item.error），批级 zipError 仅作汇总
    expect(ss.zipItems[0].error).toContain('缺少 SKILL.md')
    expect(ss.zipItems[0].status).toBe('error')
    expect(emitted.visible).not.toContain(false) // 不关弹窗
    expect(emitted.created.length).toBe(0)
    expect(ss.zipItems.length).toBe(1) // 不清已选包，可修正后重试
  })

  it('手动创建空名（类型、分类已选）→ 拦截红字、不调 createFn、不关弹窗', async () => {
    const createFn = vi.fn()
    mountPicked({ typeOptions: [{ value: 'PLATFORM', label: '市场技能', source: 'platform', createFn }] })
    const ss = app._instance.setupState
    ss.createMode = 'manual'
    ss.createCategory = '效率'
    ss.createName = '   '
    await ss.confirmCreate()
    expect(ss.manualError).toBe('请选择技能类型、技能分类并填写创建内容')
    expect(createFn).not.toHaveBeenCalled()
    expect(emitted.visible).not.toContain(false)
  })

  it('createFn 失败 → 错误提示、不关弹窗、不 emit created', async () => {
    const createFn = vi.fn(() => Promise.reject(new Error('同名技能已存在')))
    mountPicked({ typeOptions: [{ value: 'PLATFORM', label: '市场技能', source: 'platform', createFn }] })
    const ss = app._instance.setupState
    ss.createMode = 'manual'
    ss.createCategory = '效率'
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
            typeOptions: BASE_TYPES,
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

describe('SkillCreateDialog · 技能分类下拉（三类技能均显示，选项走 fieldDict）', () => {
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
    const raw = new Blob(['z'])
    ss.onZipChange({ name: 'p.zip', raw })
    await nextTick()
    expect(el.querySelector('.zip-item-cat')).toBeTruthy() // 每包一行内各自的分类下拉
    ss.zipItems[0].categoryId = '效率'
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenCalledWith(raw, {
      source: 'platform',
      displayCategoryId: '效率'
    })
  })

})

describe('SkillCreateDialog · 多包批量上传（2026-08-17）', () => {
  it('多次选包 → 列表累积；同一批重名 → 就地提示并跳过、不覆盖已有项', async () => {
    mountPicked()
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
    mountPicked()
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
    mountPicked()
    const ss = app._instance.setupState
    const rawA = new Blob(['a'])
    const rawB = new Blob(['b'])
    ss.onZipChange({ name: 'a.zip', raw: rawA })
    ss.onZipChange({ name: 'b.zip', raw: rawB })
    ss.zipItems[0].categoryId = 'cat_1'
    ss.zipItems[1].categoryId = 'cat_2'
    await ss.confirmImportZip()
    expect(importSkillZip).toHaveBeenNthCalledWith(1, rawA, { source: 'platform', displayCategoryId: 'cat_1' })
    expect(importSkillZip).toHaveBeenNthCalledWith(2, rawB, { source: 'platform', displayCategoryId: 'cat_2' })
    expect(emitted.createdBatch).toEqual([expect.objectContaining({ skillIds: ['s1', 's2'], mode: 'zip' })])
    expect(emitted.created.length).toBe(0) // 多包不走单包导航事件
    expect(emitted.visible.at(-1)).toBe(false) // 关弹窗
  })

  it('部分失败 → 成功项移出列表并即时 created-batch，失败项留列表行内红字、弹窗不关', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    importSkillZip
      .mockResolvedValueOnce({ skillId: 's1' })
      .mockRejectedValueOnce(new Error('技能包缺少 SKILL.md'))
    mountPicked()
    const ss = app._instance.setupState
    addZip(ss, 'ok.zip', new Blob(['a']))
    addZip(ss, 'bad.zip', new Blob(['b']))
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
 *   1) 类型选择由 typeOptions 驱动（J10 起必传）。
 *   2) 类型不预选，未选前提交被兜底拦截（类型建后不可改，绝不能落空；md §三.2「技能类型建成后不可更改」）。
 *   3) source / createFn 随所选类型切换。
 *   4) 分类选择器三类均出现、选项来自 fieldDict 固定 11 类（md §三.2「技能分类：必选 11 个固定分类」）。
 *   5) created-batch 回传 skillType，父级据此刷新列表。
 */
describe('SkillCreateDialog · 技能类型内置单选（md §三.2 技能类型必选单选 / 技能分类必选）', () => {
  const platformCreate = vi.fn(async () => ({ skillId: 'sk_platform' }))
  const systemCreate = vi.fn(async () => ({ skillId: 'sk_system' }))
  const positionCreate = vi.fn(async () => ({ skillId: 'sk_position' }))
  // 词表照 md §一.1 技能类型筛选、§三.2 技能类型单选：岗位私有 / 市场技能 / 通用技能
  const TYPE_OPTIONS = [
    { value: 'SYSTEM_DEFAULT', label: '通用技能', source: 'system', createFn: systemCreate },
    { value: 'POSITION', label: '岗位私有', source: 'fde', createFn: positionCreate },
    { value: 'PLATFORM', label: '市场技能', source: 'platform', createFn: platformCreate }
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

  it('渲染类型区与「建成后不可更改」警示（md §三.2「技能类型建成后不可更改，跨类型需导出后重新导入」）', async () => {
    mountTyped()
    await nextTick()
    expect(container.textContent).toContain('技能类型')
    expect(container.textContent).toContain('建成后不可更改')
  })

  it('类型不预选；未选时 zip 导入被兜底拦截、不发请求、红字提示补齐（md §三.2「请选择技能类型、技能分类并填写创建内容」）', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    const ss = mountTyped()
    await nextTick()
    expect(ss.pickedType).toBe(null)
    expect(ss.typeMissing).toBe(true)
    // 绕过禁用按钮直接调提交函数也必须拦住（纵深防御）
    ss.zipItems = [zipItem()]
    await ss.confirmImportZip()
    expect(importSkillZip).not.toHaveBeenCalled()
    // 拦截红字逐字 md §三.2「请选择技能类型、技能分类并填写创建内容」（2026-09-12 审计 K17 闭环：zip / 手动两场景同一句）
    expect(ss.zipError).toBe('请选择技能类型、技能分类并填写创建内容')
  })

  it('未选类型时手动创建同样被拦截、红字同 md §三.2 同一句，三个 createFn 都不调（审计 K17）', async () => {
    const ss = mountTyped()
    await nextTick()
    ss.createMode = 'manual'
    ss.createName = '技能X'
    await ss.confirmCreate()
    expect(positionCreate).not.toHaveBeenCalled()
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
    expect(ss.manualError).toBe('请选择技能类型、技能分类并填写创建内容')
  })

  it('类型已选、zip 包缺分类 → zipError 为 md 统一守卫文案，importSkillZip 未调用（md §三.2「每个包必须独立选择分类」）', async () => {
    const { importSkillZip } = await import('@/api/skillFiles')
    const ss = mountTyped()
    ss.pickedType = 'PLATFORM'
    await nextTick()
    ss.zipItems = [zipItem({ categoryId: null })]
    await ss.confirmImportZip()
    expect(importSkillZip).not.toHaveBeenCalled()
    expect(ss.zipError).toBe('请选择技能类型、技能分类并填写创建内容')
  })

  it('类型已选、手动创建缺分类 → manualError 为守卫文案，createFn 未调用', async () => {
    const ss = mountTyped()
    ss.pickedType = 'PLATFORM'
    await nextTick()
    ss.createMode = 'manual'
    ss.createName = '技能X'
    ss.createCategory = ''
    await ss.confirmCreate()
    expect(platformCreate).not.toHaveBeenCalled()
    expect(ss.manualError).toBe('请选择技能类型、技能分类并填写创建内容')
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

  it('createFn 随所选类型切换（签名 createFn({ name, categoryName })）', async () => {
    const ss = mountTyped()
    ss.pickedType = 'POSITION'
    await nextTick()
    ss.createMode = 'manual'
    ss.createName = '技能X'
    ss.createCategory = '效率'
    await ss.confirmCreate()
    expect(positionCreate).toHaveBeenCalledWith({ name: '技能X', categoryName: '效率' })
    expect(platformCreate).not.toHaveBeenCalled()
    expect(systemCreate).not.toHaveBeenCalled()
  })

  it('分类选择器在技能页语境对三类均出现，选项来自 fieldDict 固定分类（md §三.2「技能分类：必选 11 个固定分类」）', async () => {
    const ss = mountTyped()
    for (const type of ['PLATFORM', 'SYSTEM_DEFAULT', 'POSITION']) {
      ss.pickedType = type
      ss.onZipChange({ name: `${type}.zip`, raw: new Blob(['z']) })
      await nextTick()
    }
    // 三类技能的每个包行内都有各自的分类下拉
    expect(container.querySelectorAll('.zip-item-cat').length).toBe(3)
    await ss.loadCategoryOptions()
    expect(ss.categoryOptions).toEqual([{ id: '工作', name: '工作' }, { id: '效率', name: '效率' }])
  })

  it('zip 导入完成 emit created-batch 并回传 skillType（父级据此刷新列表，不自动进编辑页；md §三.2「导入完成后统一返回技能列表，不自动进入编辑页」）', async () => {
    const ss = mountTyped()
    ss.pickedType = 'SYSTEM_DEFAULT'
    await nextTick()
    ss.zipItems = [zipItem({ categoryId: '效率' })]
    await ss.confirmImportZip()
    expect(emitted.createdBatch.at(-1)).toMatchObject({ skillIds: ['sk_zip'], skillType: 'SYSTEM_DEFAULT' })
    expect(emitted.created.length).toBe(0)
    expect(emitted.visible.at(-1)).toBe(false)
  })

  it('重新打开弹窗 → 类型重选、技能包 / 分类 / 手动名清空、回到 zip 初始上传态（md §三.2「每次打开弹窗清空上次选择」）', async () => {
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
