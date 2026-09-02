// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * SkillCreateDialog（技能页 / 岗位白板共用新建对话框）行为测试。
 * 原 AdminSkills #4 对话框断言（zip 主 + 手动次入口、F5c 就地回显）随本体迁到这里，
 * 并补两侧差异点：agentId/source 透传 importSkillZip、手动创建走 createFn。
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
