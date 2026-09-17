// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, render } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * RuntimeSpecEditor.vue 用例（2026-09-12 测试审计 T55·F31 新建；此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/运行规格/prd.运行规格.md
 *   §四.1 三态标题 / §四.3 适用范围（默认规格提示、允许用户申请）/ §四.4 资源配置默认值与上限提示 /
 *   §四.5 运行策略默认值 / §四.7 保存与关闭 / §四.10 编辑页异常（规格名称重复、平台上限读取失败）。
 *
 * 真实挂载（真 Element Plus + 真 DrawerEditor / el-form / el-input-number / el-switch），只 mock api 层。
 * DrawerEditor 开了 append-to-body，抽屉 teleport 到 document.body，故从 body 取节点。
 * 组件的 visible watcher 非 immediate（列表页里抽屉常驻、总是 false→true 打开，现状无问题），
 * 故用一个持 ref 的宿主组件驱动 false→true，而不是静态 visible:true 挂载。
 * 2026-09-12 审计 K28 / K29 闭环后补：§四.10 校验文案逐字、§四.1 放弃确认、§四.3 岗位切换提示、
 *   §四.8.2「运行配置变更」确认、§四.8.3 待审批阻断（末尾两个 describe）。确认窗经 useConfirm → ElMessageBox.confirm，用 spy 拦。
 * 岗位占用关系取自 listRuntimeSpecs（编辑器打开时随上限一并加载），故 api 桩含 listRuntimeSpecs。
 */

const api = { getRuntimeSpec: vi.fn(), getRuntimeSpecLimits: vi.fn(), createRuntimeSpec: vi.fn(), updateRuntimeSpec: vi.fn(), listRuntimeSpecs: vi.fn() }
vi.mock('@/api/runtimeSpec', () => api)
const listPositions = vi.fn()
vi.mock('@/api/position', () => ({ listPositions: (...a) => listPositions(...a) }))

const Editor = (await import('@/components/admin/RuntimeSpecEditor.vue')).default

const LIMITS = { cpu: 32, memoryGi: 128, diskGi: 500 }
const DEFAULT_SPEC = {
  id: 2, name: '标准', boundaryDesc: '大多数用户的常用配置，可处理 100MB 以内文件', cpu: 2, memoryGi: 4, diskGi: 20,
  readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0, isDefault: true, positionIds: [], allowUserApply: false,
  effectiveUsers: [{ username: 'chenyu', name: '陈宇', source: 'DEFAULT', positionName: '' }], pendingUsers: [],
  createdAt: '2026-08-15 10:22', updatedAt: '2026-08-30 14:12'
}
const HEAVY_SPEC = {
  ...DEFAULT_SPEC, id: 3, name: '重', boundaryDesc: '文档处理、数据分析', cpu: 4, memoryGi: 16, diskGi: 100, maxLifetimeHours: 24,
  isDefault: false, positionIds: [401], allowUserApply: true,
  effectiveUsers: [{ username: 'zhangwei', name: '张伟', source: 'POSITION', positionName: '财务审核岗' }, { username: 'zhaomin', name: '赵敏', source: 'USER', positionName: '' }],
  pendingUsers: [{ username: 'hejing', name: '何静', approval: 'PENDING' }]
}

let mounted, savedSpy, visibleSpy, successSpy, errorSpy, confirmSpy
beforeEach(() => {
  vi.clearAllMocks()
  api.getRuntimeSpecLimits.mockResolvedValue({ ...LIMITS })
  // 岗位占用：401 属「重」(id 3)、402 属「轻」(id 1)
  api.listRuntimeSpecs.mockResolvedValue({ list: [
    { id: 1, name: '轻', positionIds: [402] }, { id: 2, name: '标准', positionIds: [] }, { id: 3, name: '重', positionIds: [401] }
  ], total: 3 })
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
  listPositions.mockResolvedValue({ list: [{ positionId: 401, name: '财务审核岗' }, { positionId: 402, name: '客户成功岗' }], total: 2 })
  savedSpy = vi.fn()
  visibleSpy = vi.fn()
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// 抽屉 append-to-body：从 body 找。DrawerEditor 的 el-drawer 内容在首次打开后才渲染
async function open(props) {
  const visible = ref(false)
  const Host = defineComponent({
    setup() {
      return () => h(Editor, {
        ...props,
        visible: visible.value,
        'onUpdate:visible': (v) => { visible.value = v; visibleSpy(v) },
        onSaved: savedSpy
      })
    }
  })
  mounted = mountReal(Host)
  await flushAll(2)
  visible.value = true
  await flushAll(12)
  return document.body.querySelector('.el-drawer')
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const title = (d) => d.querySelector('.de-head-title').textContent.trim()
const footBtns = (d) => [...d.querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())
const footBtn = (d, text) => [...d.querySelectorAll('.el-drawer__footer .el-button')].find((b) => b.textContent.trim() === text)
const itemByLabel = (d, label) => [...d.querySelectorAll('.el-form-item')].find((fi) => fi.querySelector('.el-form-item__label')?.textContent.trim() === label)
const numberValue = (d, label) => itemByLabel(d, label).querySelector('.el-input-number input').value
const errorOf = (d, label) => itemByLabel(d, label)?.querySelector('.el-form-item__error')?.textContent.trim() || ''
/** 取 RuntimeSpecEditor 实例的 form（root → Host → Editor 逐层下钻；直接改组件态更贴近「手工输入 / 接口提交超限」md L302） */
function editorState() {
  let inst = mounted.app._instance
  while (inst && !inst.setupState?.form) inst = inst.subTree?.component
  return inst.setupState
}
const setForm = (patch) => Object.assign(editorState().form, patch)
async function typeInput(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await flushAll(3)
}

describe('RuntimeSpecEditor · 新建（md §四.1 / §四.4 / §四.5 / §四.7）', () => {
  it('标题「新建规格」+ 默认值 CPU 2 / 内存 4 / 临时存储 20 / 就绪超时 10 / 空闲回收 20 / 最大存活 0 + 上限提示 + footer【取消】【创建】', async () => {
    const d = await open({ specId: null })
    expect(title(d)).toBe('新建规格')
    expect(numberValue(d, 'CPU（核）')).toBe('2')
    expect(numberValue(d, '内存（Gi）')).toBe('4')
    expect(numberValue(d, '临时存储（Gi）')).toBe('20')
    expect(numberValue(d, 'Pod 就绪超时（分钟）')).toBe('10')
    expect(numberValue(d, '空闲回收（分钟）')).toBe('20')
    expect(numberValue(d, '最大存活时长（小时）')).toBe('0')
    // md §四.4 L300：资源配置区直接展示当前平台单实例上限 + 每个输入项下方同步展示最大值
    expect(d.querySelector('.rs-limit-alert').textContent).toContain('当前平台单实例上限：CPU 32 核、内存 128 Gi、临时存储 500 Gi')
    expect(itemByLabel(d, 'CPU（核）').textContent).toContain('最多 32 核')
    expect(itemByLabel(d, '内存（Gi）').textContent).toContain('最多 128 Gi')
    expect(itemByLabel(d, '临时存储（Gi）').textContent).toContain('最多 500 Gi')
    // 上限来自接口（不由前端固定）
    expect(api.getRuntimeSpecLimits).toHaveBeenCalled()
    // md §四.2 占位；§四.3 允许用户申请默认开
    expect(d.querySelector('input[placeholder="如：标准、高性能"]')).toBeTruthy()
    expect(d.querySelector('textarea[placeholder="如：适合常规文档处理，可处理 100MB 以内文件"]')).toBeTruthy()
    expect(d.querySelector('.el-switch').classList.contains('is-checked')).toBe(true)
    // md §四.7 L341 / §四.9 新建不展示时间信息与生效情况
    expect(footBtns(d)).toEqual(['取消', '创建'])
    expect(d.querySelector('.rs-times')).toBeNull()
    expect(d.textContent).not.toContain('生效情况')
  })

  it('填名称与能力边界后点【创建】→ createRuntimeSpec 收到默认值 payload →「规格已创建」+ emit saved + 关抽屉（md §四.7 L346）', async () => {
    api.createRuntimeSpec.mockResolvedValue({ id: 11 })
    const d = await open({ specId: null })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '  分析档  ')
    await typeInput(d.querySelector('textarea[placeholder="如：适合常规文档处理，可处理 100MB 以内文件"]'), '适合数据分析')
    footBtn(d, '创建').click()
    await flushAll(8)
    expect(api.createRuntimeSpec).toHaveBeenCalledWith({
      name: '分析档', boundaryDesc: '适合数据分析', cpu: 2, memoryGi: 4, diskGi: 20,
      readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0, positionIds: [], allowUserApply: true
    })
    expect(successSpy).toHaveBeenCalledWith('规格已创建')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('名称 / 能力边界为空点【创建】→ 就地「规格名称不能为空」「请填写能力边界说明」，不发 createRuntimeSpec（md §四.7 L345 / §四.10 L384,L387；K28）', async () => {
    const d = await open({ specId: null })
    footBtn(d, '创建').click()
    await flushAll(4)
    await wait(150) // el-form-item 的错误态展示有 100ms 防抖
    expect(api.createRuntimeSpec).not.toHaveBeenCalled()
    expect(errorOf(d, '规格名称')).toBe('规格名称不能为空')
    expect(errorOf(d, '能力边界说明')).toBe('请填写能力边界说明')
    expect(title(d)).toBe('新建规格') // 不关抽屉
  })

  it('CPU 0.7 / 内存 1.5 / 能力边界 201 字 → 字段下方文案逐字 md §四.10 L388-390，不发接口（K28）', async () => {
    const d = await open({ specId: null })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '校验档')
    await typeInput(d.querySelector('textarea[placeholder="如：适合常规文档处理，可处理 100MB 以内文件"]'), '边'.repeat(201))
    // el-input-number 会把非法值钉回 min/step，直接改组件态更贴近「手工输入 / 接口提交超限」（md L302）
    setForm({ cpu: 0.7, memoryGi: 1.5 })
    await flushAll(2)
    footBtn(d, '创建').click()
    await flushAll(4)
    await wait(150)
    expect(api.createRuntimeSpec).not.toHaveBeenCalled()
    expect(errorOf(d, '能力边界说明')).toBe('能力边界说明不超过 200 个字符')
    expect(errorOf(d, 'CPU（核）')).toBe('CPU须不小于 0.5 核，并按照 0.5 递增')
    expect(errorOf(d, '内存（Gi）')).toBe('内存须为不小于 1 的整数')
    // 超上限文案「不能超过平台单实例上限 {最大值}{单位}」（md §四.4 L302）：el-input-number 的 :max 会把超限值钉回上限
    // （含上限下调时），页面层触不到该分支；接口侧再校验由 runtimeSpecMock.test「拒绝超限资源」守住（md L303）。
  })

  it('接口回 {field:name}「规格名称已存在，请换一个」→ 定位到规格名称就地红字，不 toast、不关抽屉（md §四.10 L386）', async () => {
    api.createRuntimeSpec.mockRejectedValue({ field: 'name', message: '规格名称已存在，请换一个' })
    const d = await open({ specId: null })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '标准')
    await typeInput(d.querySelector('textarea[placeholder="如：适合常规文档处理，可处理 100MB 以内文件"]'), '重名测试')
    footBtn(d, '创建').click()
    await flushAll(8)
    await wait(150)
    expect(errorOf(d, '规格名称')).toBe('规格名称已存在，请换一个')
    expect(errorSpy).not.toHaveBeenCalled()
    expect(visibleSpy).not.toHaveBeenCalledWith(false)
    expect(savedSpy).not.toHaveBeenCalled()
  })

  it('平台上限读取失败 → 抽屉保留、展示「加载失败」+【重试】；重试成功后表单出现（md §四.10 L396 / §四.1 L267）', async () => {
    api.getRuntimeSpecLimits.mockRejectedValueOnce(new Error('limits down')).mockResolvedValue({ ...LIMITS })
    const d = await open({ specId: null })
    expect(d.textContent).toContain('加载失败')
    expect(d.querySelector('input[placeholder="如：标准、高性能"]')).toBeNull() // 不展示空白表单可提交
    const retry = [...d.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    retry.click()
    await flushAll(10)
    expect(d.textContent).not.toContain('加载失败')
    expect(d.querySelector('input[placeholder="如：标准、高性能"]')).toBeTruthy()
    expect(api.getRuntimeSpecLimits).toHaveBeenCalledTimes(2)
  })
})

describe('RuntimeSpecEditor · 编辑 / 查看（md §四.1 / §四.3 / §四.6 / §四.7 / §四.9）', () => {
  it('编辑非默认规格：标题「编辑规格」+ 回填 + 时间行 + 生效情况（个人配置 / 岗位 · 名 / 待审批数）+ footer【取消】【保存】', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    const d = await open({ specId: 3 })
    expect(api.getRuntimeSpec).toHaveBeenCalledWith(3)
    expect(title(d)).toBe('编辑规格')
    expect(d.querySelector('input[placeholder="如：标准、高性能"]').value).toBe('重')
    expect(numberValue(d, 'CPU（核）')).toBe('4')
    expect(numberValue(d, '最大存活时长（小时）')).toBe('24')
    expect(d.querySelector('.rs-times').textContent).toContain('创建时间：2026-08-15 10:22')
    expect(d.querySelector('.rs-times').textContent).toContain('最近更新：2026-08-30 14:12')
    // md §四.6 生效情况来源文案
    const used = d.querySelector('.rs-used').textContent
    expect(used).toContain('张伟')
    expect(used).toContain('岗位 · 财务审核岗')
    expect(used).toContain('赵敏')
    expect(used).toContain('个人配置')
    expect(d.querySelector('.rs-pending').textContent).toContain('另有 1 个个人申请待审批')
    expect(d.querySelector('.rs-default-alert')).toBeNull() // 非默认不出默认提示条
    expect(footBtns(d)).toEqual(['取消', '保存'])
  })

  it('编辑改最大存活后点【保存】→ updateRuntimeSpec(id, payload) →「规格已保存」+ emit saved + 关抽屉（md §四.7 L347）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    api.updateRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC, maxLifetimeHours: 12 })
    const d = await open({ specId: 3 })
    const life = itemByLabel(d, '最大存活时长（小时）').querySelector('.el-input-number input')
    life.value = '12'
    life.dispatchEvent(new Event('input', { bubbles: true }))
    life.dispatchEvent(new Event('change', { bubbles: true }))
    await flushAll(4)
    footBtn(d, '保存').click()
    await flushAll(8)
    expect(api.updateRuntimeSpec).toHaveBeenCalledWith(3, expect.objectContaining({ name: '重', maxLifetimeHours: 12, positionIds: [401], allowUserApply: true }))
    expect(successSpy).toHaveBeenCalledWith('规格已保存')
    expect(savedSpy).toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('查看默认规格：标题「查看规格」+ 默认规格提示条 + 允许用户申请开关禁用 + 输入禁用 + 生效情况「平台默认」+ footer 仅【关闭】（md §四.1 / §四.3 L284 / §四.7 L343）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...DEFAULT_SPEC })
    const d = await open({ specId: 2, readonly: true })
    expect(title(d)).toBe('查看规格')
    expect(d.querySelector('.rs-default-alert').textContent).toContain('未绑定岗位或岗位未配置专属规格的用户自动使用；默认规格不可删除')
    expect(d.querySelector('.el-switch').classList.contains('is-disabled')).toBe(true)
    expect(d.querySelector('input[placeholder="如：标准、高性能"]').disabled).toBe(true)
    expect(d.querySelector('.rs-used').textContent).toContain('陈宇')
    expect(d.querySelector('.rs-used').textContent).toContain('平台默认')
    expect(footBtns(d)).toEqual(['关闭'])
  })

  it('编辑默认规格：可改名称，但「允许用户申请」开关禁用（默认规格不开放申请；md §四.3 L284）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...DEFAULT_SPEC })
    const d = await open({ specId: 2 })
    expect(title(d)).toBe('编辑规格')
    expect(d.querySelector('input[placeholder="如：标准、高性能"]').disabled).toBe(false)
    expect(d.querySelector('.el-switch').classList.contains('is-disabled')).toBe(true)
    expect(footBtns(d)).toEqual(['取消', '保存'])
  })

  it('无生效用户的规格：生效情况展示「暂无用户生效」（md §四.6 L337）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC, effectiveUsers: [], pendingUsers: [] })
    const d = await open({ specId: 3 })
    expect(d.querySelector('.rs-used-empty').textContent).toBe('暂无用户生效')
    expect(d.querySelector('.rs-pending')).toBeNull()
  })
})

describe('RuntimeSpecEditor · 关闭放弃确认（md §四.1 L266，审计 K29）', () => {
  it('新建态未改动点【取消】→ 直接关闭、不弹确认；改了名称再点【取消】→ 弹放弃确认，取消确认则抽屉保持、确认则关闭', async () => {
    const d = await open({ specId: null })
    footBtn(d, '取消').click()
    await flushAll(4)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
    visibleSpy.mockClear()
    mounted.unmount(); mounted = null; document.body.innerHTML = ''

    const d2 = await open({ specId: null })
    await typeInput(d2.querySelector('input[placeholder="如：标准、高性能"]'), '草稿')
    confirmSpy.mockRejectedValueOnce('cancel')
    footBtn(d2, '取消').click()
    await flushAll(4)
    expect(confirmSpy).toHaveBeenCalledWith(
      '有未保存的修改，关闭后将丢失。确认放弃本次修改？', '放弃修改',
      expect.objectContaining({ confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' })
    )
    expect(visibleSpy).not.toHaveBeenCalledWith(false)
    confirmSpy.mockResolvedValueOnce('confirm')
    footBtn(d2, '取消').click()
    await flushAll(4)
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('抽屉 X / ESC 走 el-drawer before-close 钩子：有改动且取消确认 → done(true) 保持打开；确认 → done() 关闭且随后回报不再二次询问', async () => {
    const d = await open({ specId: null })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '草稿')
    const { onBeforeClose } = editorState()
    // 钩子已透传到真 el-drawer（DrawerEditor 单根）：X 按钮存在且点击后触发确认
    confirmSpy.mockRejectedValueOnce('cancel')
    d.querySelector('.el-drawer__close-btn').click()
    await flushAll(4)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(visibleSpy).not.toHaveBeenCalledWith(false)
    expect(document.body.querySelector('.el-drawer')).toBeTruthy()
    // 直接调钩子：取消 → done(true)；确认 → done()，且回报一次 update:visible=false 不再询问
    let done = vi.fn()
    confirmSpy.mockRejectedValueOnce('cancel')
    await onBeforeClose(done)
    expect(done).toHaveBeenCalledWith(true)
    done = vi.fn()
    confirmSpy.mockResolvedValueOnce('confirm')
    await onBeforeClose(done)
    expect(done).toHaveBeenCalledWith()
    confirmSpy.mockClear()
    await editorState().onVisibleChange(false)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })

  it('查看态 / 编辑态无改动 → 关闭不弹确认', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    const d = await open({ specId: 3, readonly: true })
    footBtn(d, '关闭').click()
    await flushAll(4)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
    mounted.unmount(); mounted = null; document.body.innerHTML = ''; visibleSpy.mockClear()
    const d2 = await open({ specId: 3 })
    footBtn(d2, '取消').click()
    await flushAll(4)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(visibleSpy).toHaveBeenCalledWith(false)
  })
})

describe('RuntimeSpecEditor · 保存前配置影响（md §四.3 L286 / §四.8.2 / §四.8.3，审计 K29）', () => {
  /** 把 confirmDialog 收到的正文（字符串或 VNode）渲染成纯文本，断言用户可见文案 */
  const confirmText = (call) => {
    const msg = call[0]
    if (typeof msg === 'string') return msg
    const host = document.createElement('div')
    render(msg, host)
    return host.textContent
  }

  it('新建时选中被「重」占用的岗位 401 → 保存前确认「岗位规格切换」列出「财务审核岗：重 → 新档」并提示切换；取消不发接口、确认后发 createRuntimeSpec（md §四.3 L286 / §四.10 L397）', async () => {
    api.createRuntimeSpec.mockResolvedValue({ id: 11 })
    const d = await open({ specId: null })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '新档')
    await typeInput(d.querySelector('textarea[placeholder="如：适合常规文档处理，可处理 100MB 以内文件"]'), '说明')
    setForm({ positionIds: [401] })
    await flushAll(2)
    confirmSpy.mockRejectedValueOnce('cancel')
    footBtn(d, '创建').click()
    await flushAll(8)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][1]).toBe('岗位规格切换')
    const text = confirmText(confirmSpy.mock.calls[0])
    expect(text).toContain('保存后该岗位将从原规格切换到当前规格')
    expect(text).toContain('财务审核岗：重 → 新档')
    expect(api.createRuntimeSpec).not.toHaveBeenCalled()
    confirmSpy.mockResolvedValueOnce('confirm')
    footBtn(d, '创建').click()
    await flushAll(8)
    expect(api.createRuntimeSpec).toHaveBeenCalledWith(expect.objectContaining({ positionIds: [401] }))
    expect(successSpy).toHaveBeenCalledWith('规格已创建')
  })

  it('编辑「重」（有 2 个生效用户）改 CPU 4→8 点【保存】→ 「运行配置变更」确认列变更前后与三条影响说明；取消不保存、确认后 updateRuntimeSpec（md §四.8.2 L361-366）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    api.updateRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC, cpu: 8 })
    const d = await open({ specId: 3 })
    setForm({ cpu: 8 })
    await flushAll(2)
    confirmSpy.mockRejectedValueOnce('cancel')
    footBtn(d, '保存').click()
    await flushAll(8)
    expect(confirmSpy).toHaveBeenCalledTimes(1) // 本规格自身占用的 401 不算「被其他规格占用」，不弹岗位切换
    expect(confirmSpy.mock.calls[0][1]).toBe('运行配置变更')
    const text = confirmText(confirmSpy.mock.calls[0])
    expect(text).toContain('2 个生效用户')
    expect(text).toContain('CPU：4 核 → 8 核')
    expect(text).toContain('已运行 Pod 不会被立即修改或重启')
    expect(text).toContain('新配置在用户 Pod 下一次创建或管理员主动重建时生效')
    expect(text).toContain('规格待生效')
    expect(api.updateRuntimeSpec).not.toHaveBeenCalled()
    expect(title(d)).toBe('编辑规格')
    confirmSpy.mockResolvedValueOnce('confirm')
    footBtn(d, '保存').click()
    await flushAll(8)
    expect(api.updateRuntimeSpec).toHaveBeenCalledWith(3, expect.objectContaining({ cpu: 8 }))
    expect(successSpy).toHaveBeenCalledWith('规格已保存')
  })

  it('只改名称 / 无生效用户时改资源 → 不弹「运行配置变更」，直接保存（md §四.8.1 L355 / §四.8.2 L361「存在生效用户」前提）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    api.updateRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    const d = await open({ specId: 3 })
    await typeInput(d.querySelector('input[placeholder="如：标准、高性能"]'), '重·改名')
    footBtn(d, '保存').click()
    await flushAll(8)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.updateRuntimeSpec).toHaveBeenCalledTimes(1)
    mounted.unmount(); mounted = null; document.body.innerHTML = ''
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC, effectiveUsers: [], pendingUsers: [] })
    const d2 = await open({ specId: 3 })
    setForm({ memoryGi: 32 })
    await flushAll(2)
    footBtn(d2, '保存').click()
    await flushAll(8)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.updateRuntimeSpec).toHaveBeenCalledTimes(2)
  })

  it('「重」有 1 个待审批申请：关闭「允许用户申请」点【保存】→ 阻止保存，开关下方提示先处理或撤回；开关重新打开后提示消失并可保存（md §四.8.3 L372 / §四.10 L398）', async () => {
    api.getRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    api.updateRuntimeSpec.mockResolvedValue({ ...HEAVY_SPEC })
    const d = await open({ specId: 3 })
    const sw = d.querySelector('.el-switch')
    sw.click()
    await flushAll(3)
    expect(sw.classList.contains('is-checked')).toBe(false)
    footBtn(d, '保存').click()
    await flushAll(6)
    await wait(150)
    expect(api.updateRuntimeSpec).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(errorOf(d, '允许用户申请')).toBe('存在 1 个待审批申请，请先处理或撤回相关申请后再关闭申请入口')
    expect(title(d)).toBe('编辑规格')
    sw.click()
    await flushAll(3)
    await wait(150)
    expect(errorOf(d, '允许用户申请')).toBe('')
    footBtn(d, '保存').click()
    await flushAll(8)
    expect(api.updateRuntimeSpec).toHaveBeenCalledWith(3, expect.objectContaining({ allowUserApply: true }))
  })
})
