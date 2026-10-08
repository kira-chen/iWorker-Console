// @vitest-environment jsdom
/**
 * PositionSampleTaskStage —— 岗位详情「自动化任务」页签主从容器的缺口补测（2026-10-08）。
 *
 * 对齐 md：docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md
 *   - §7.1 页签布局：副行摘要（周期人话 + 引用工具数 + 引用技能数）/ 拖拽排序即时保存 / 列表为空占位
 *     「还没有自动化任务」/ 未选中占位「从左侧选一条任务」/ 切换未保存确认；
 *   - §7.2 启用 / 停用：默认启用，切换成功提示「任务已启用」「任务已停用」；
 *   - §7.9 保存与创建：创建后「左侧列表刷新并自动选中新建任务」；保存失败提示具体错误原因；
 *   - §7.10 删除任务：确认后删除、列表刷新；删除当前选中任务后右侧回空态占位；
 *   - §12 异常场景：加载失败给出【重试】。
 * 只读态（§10 审核中全部页签只读）由父级 PositionDetailTabs 的 .pd-ro-freeze 指针冻结兜底，本组件无 readonly 入参，
 *   不在本文件覆盖（见 PositionDetailTabs 注释「工作档案 / 自动化任务两个内嵌 Stage 暂无 readonly prop」）。
 *
 * 覆盖点（默认选中第一条 / 有脏切换条目确认 / 卡头开关启停 toast 三条需真编辑器，见 SampleTaskEditor.test.js「Stage × 真编辑器集成」组，此处不重复）：
 *   ① 未保存岗位（positionId=null）：不拉列表、计数 0、点新增提示「请先保存岗位」；
 *   ② 加载：上报 update:sampleCount；加载失败「样例加载失败」+【重试】可恢复；
 *   ③ 副行摘要文案（含无周期 / 无技能兜底）；
 *   ④ 删除：删当前选中 → 右侧回「从左侧选一条任务」占位；删非选中 → 选中不变；删除失败提示具体原因；
 *   ⑤ 启停：缺 status 视为启用；失败提示原因且状态不变；进行中重复点击不重复下发；
 *   ⑥ 编辑器回调：saved 逐条透出 warnings 并刷新列表；created 自动选中新条目 / 无 id 回占位；
 *   ⑦ 新建态：已在新建态再点不重复确认；脏态下点新增走「切换将丢弃」确认，取消则留在原条目；
 *   ⑧ 拖拽排序：drop 后即时 reorderSampleTasks(新 id 序)；失败回滚 + 「调序保存失败」；同位 drop 不下发；
 *   ⑨ 试跑面板（EFFECT_TEST_ENABLED 构建期开关，当前关闭；md §7 未规定试跑，按代码现状只做开关两态与结果面板基本态）。
 *
 *   ⑩ 左侧列表规则（2026-10-08 T12 自原 SampleTaskPrototype4B 迁入）：缺指令红标 / 软上限 20 / 19 条可新增 / 无脏直接切换 / 删除确认取消。
 *
 * SampleTaskEditor 以桩替换（其自身行为由 SampleTaskEditor.test.js 覆盖），桩暴露 emit 句柄驱动回调。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import {
  listSampleTasks,
  deleteSampleTask,
  setSampleTaskStatus,
  reorderSampleTasks,
  testRunSampleTask
} from '@/api/sampleTask'
import { ElMessage, ElMessageBox } from 'element-plus'

async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/* ============================ mock ============================ */
const flags = vi.hoisted(() => ({ effect: false }))
vi.mock('@/utils/featureFlags', () => ({
  get EFFECT_TEST_ENABLED() {
    return flags.effect
  },
  MCP_AUTH_CONFIG_ENABLED: true
}))

vi.mock('@/api/sampleTask', () => ({
  listSampleTasks: vi.fn(),
  reorderSampleTasks: vi.fn(() => Promise.resolve()),
  deleteSampleTask: vi.fn(() => Promise.resolve()),
  setSampleTaskStatus: vi.fn(() => Promise.resolve()),
  testRunSampleTask: vi.fn(() => Promise.resolve({ success: true }))
}))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))

// 编辑器桩：暴露 props 与 emit 句柄，驱动 dirty-change / saved / created / toggle-status 回调
const editor = { emit: null, props: null }
vi.mock('@/components/position/SampleTaskEditor.vue', () => ({
  default: {
    name: 'SampleTaskEditor',
    props: ['positionId', 'sample', 'statusBusy'],
    emits: ['dirty-change', 'saved', 'created', 'toggle-status'],
    setup(p, { emit }) {
      editor.emit = emit
      editor.props = p
      return () =>
        h('div', {
          class: 'stub-editor',
          'data-sample-id': p.sample ? String(p.sample.id) : 'new',
          'data-busy': String(!!p.statusBusy)
        })
    }
  }
}))
const reactLast = { steps: null }
vi.mock('@/components/ReActSteps.vue', () => ({
  default: {
    name: 'ReActSteps',
    props: ['steps', 'defaultOpen'],
    setup(p) {
      return () => {
        reactLast.steps = p.steps
        return h('div', { class: 'stub-react' }, String(p.steps.length))
      }
    }
  }
}))

/* ============================ Element Plus stub ============================ */
const stubs = {
  'el-button': {
    props: ['loading', 'disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-drawer': {
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="stub-drawer" :data-title="title"><slot /></div>'
  },
  'el-empty': {
    props: ['description'],
    template: '<div class="stub-empty"><span class="stub-empty-desc">{{ description }}</span><slot /></div>'
  }
}

let app, container, emitted
async function mountStage(props = { positionId: 1 }) {
  const Stage = (await import('@/components/position/PositionSampleTaskStage.vue')).default
  emitted = { saved: 0, counts: [] }
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(Stage, {
        ...props,
        onSaved: () => emitted.saved++,
        'onUpdate:sampleCount': (n) => emitted.counts.push(n)
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}

const task = (id, over = {}) => ({
  id,
  name: `任务${id}`,
  prompt: `指令${id}`,
  status: 'ENABLED',
  scheduleSummary: '每天 09:00',
  toolRefs: [],
  skillRefs: [],
  ...over
})
const names = () => [...container.querySelectorAll('.st-item .st-name-text')].map((n) => n.textContent.trim())
const itemEls = () => [...container.querySelectorAll('.st-item:not(.st-creating)')]
const delBtn = (i) => itemEls()[i].querySelector('.st-op-del')
const phTitle = () => container.querySelector('.st-placeholder .ph-title')?.textContent.trim()
const phSub = () => container.querySelector('.st-placeholder .ph-sub')?.textContent.trim()

beforeEach(() => {
  vi.clearAllMocks()
  flags.effect = false
  editor.emit = null
  editor.props = null
  listSampleTasks.mockResolvedValue({ list: [task(1), task(2), task(3)] })
  ElMessageBox.confirm.mockImplementation(() => Promise.resolve())
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
})

/* ============================ ① 未保存岗位 / ② 加载 ============================ */
describe('自动化任务 · 加载与未保存岗位（md 岗位 §7.1 / §12）', () => {
  it('未保存岗位（positionId=null）→ 不拉列表、上报计数 0、右侧「还没有自动化任务」', async () => {
    await mountStage({ positionId: null })
    expect(listSampleTasks).not.toHaveBeenCalled()
    expect(emitted.counts).toEqual([0])
    expect(phTitle()).toBe('还没有自动化任务')
    expect(phSub()).toBe('加一条帮领用者快速上手（会随岗位发布，供客户端下载展示）')
  })

  it('未保存岗位点【＋ 新增自动化任务】→ 提示「请先保存岗位」，不进新建态', async () => {
    await mountStage({ positionId: null })
    container.querySelector('.st-new').click()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('请先保存岗位')
    expect(container.querySelector('.st-creating')).toBeNull()
    expect(container.querySelector('.stub-editor')).toBeNull()
  })

  it('加载成功 → listSampleTasks(岗位 id) 并上报 update:sampleCount = 条数', async () => {
    await mountStage({ positionId: 7 })
    expect(listSampleTasks).toHaveBeenCalledWith(7)
    expect(emitted.counts).toEqual([3])
    expect(names()).toEqual(['任务1', '任务2', '任务3'])
  })

  it('加载失败 → 左栏「样例加载失败」+【重试】，点重试重新拉取并恢复列表（md §12 加载失败给重试）', async () => {
    listSampleTasks.mockRejectedValueOnce(new Error('网络错误'))
    await mountStage()
    const err = container.querySelector('.list-error')
    expect(err?.textContent).toContain('样例加载失败')
    expect(itemEls()).toHaveLength(0)
    const retry = [...err.querySelectorAll('button')].find((b) => b.textContent.trim() === '重试')
    retry.click()
    await flush()
    expect(listSampleTasks).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.list-error')).toBeNull()
    expect(names()).toEqual(['任务1', '任务2', '任务3'])
  })

  it('接口返回无 list 字段 → 按空列表处理，计数 0、空态占位', async () => {
    listSampleTasks.mockResolvedValueOnce({})
    await mountStage()
    expect(emitted.counts).toEqual([0])
    expect(phTitle()).toBe('还没有自动化任务')
  })
})

/* ============================ ③ 副行摘要 ============================ */
describe('自动化任务 · 列表副行摘要（md §7.1：周期人话 + 引用工具数 + 引用技能数）', () => {
  it('有周期 / 工具 / 技能 → 「每周 09:00 · 2 个工具 · 1 个技能」', async () => {
    listSampleTasks.mockResolvedValueOnce({
      list: [
        task(1, {
          scheduleSummary: '每周 09:00',
          toolRefs: [{ code: 'a' }, { code: 'b' }],
          skillRefs: [{ platformSkillId: 9 }]
        })
      ]
    })
    await mountStage()
    expect(container.querySelector('.st-sub').textContent.trim()).toBe('每周 09:00 · 2 个工具 · 1 个技能')
  })

  it('无周期摘要、无工具无技能 → 「未设置触发 · 0 个工具」（技能数为 0 时不显示技能段）', async () => {
    listSampleTasks.mockResolvedValueOnce({
      list: [task(1, { scheduleSummary: '', toolRefs: undefined, skillRefs: undefined })]
    })
    await mountStage()
    expect(container.querySelector('.st-sub').textContent.trim()).toBe('未设置触发 · 0 个工具')
  })
})

/* ============================ ④ 删除 ============================ */
describe('自动化任务 · 删除（md §7.10）', () => {
  it('删除当前选中任务 → deleteSampleTask(岗位, 任务) + 列表刷新 + 右侧回占位「从左侧选一条任务」', async () => {
    await mountStage({ positionId: 1 })
    expect(container.querySelector('.stub-editor')?.dataset.sampleId).toBe('1') // 前提：默认选中第一条
    listSampleTasks.mockResolvedValueOnce({ list: [task(2), task(3)] })
    delBtn(0).click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除后该任务将不可恢复，确认删除？',
      '删除自动化任务',
      expect.objectContaining({ confirmButtonText: '删除', cancelButtonText: '取消' })
    )
    expect(deleteSampleTask).toHaveBeenCalledWith(1, 1)
    expect(ElMessage.success).toHaveBeenCalledWith('样例任务已删除')
    expect(names()).toEqual(['任务2', '任务3'])
    expect(container.querySelector('.stub-editor')).toBeNull()
    expect(phTitle()).toBe('从左侧选一条任务')
    expect(phSub()).toBe('或 ＋ 新增自动化任务')
    expect(emitted.saved).toBe(1)
    expect(emitted.counts.at(-1)).toBe(2)
  })

  it('删除非选中任务 → 当前选中保持不变，列表刷新', async () => {
    await mountStage()
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(3)] })
    delBtn(1).click()
    await flush()
    expect(deleteSampleTask).toHaveBeenCalledWith(1, 2)
    expect(names()).toEqual(['任务1', '任务3'])
    expect(container.querySelector('.stub-editor')?.dataset.sampleId).toBe('1')
    expect(itemEls()[0].classList.contains('on')).toBe(true)
  })

  it('点删除不触发行选中（行内按钮阻止冒泡）', async () => {
    await mountStage()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    delBtn(1).click()
    await flush()
    expect(itemEls()[1].classList.contains('on')).toBe(false)
    expect(container.querySelector('.stub-editor')?.dataset.sampleId).toBe('1')
  })

  it('删除失败 → 提示具体错误原因，列表不变；无原因时兜底「删除失败」', async () => {
    await mountStage()
    deleteSampleTask.mockRejectedValueOnce(new Error('任务正在运行，无法删除'))
    delBtn(0).click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('任务正在运行，无法删除')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(names()).toEqual(['任务1', '任务2', '任务3'])
    expect(emitted.saved).toBe(0)

    deleteSampleTask.mockRejectedValueOnce({})
    delBtn(0).click()
    await flush()
    expect(ElMessage.error).toHaveBeenLastCalledWith('删除失败')
  })
})

/* ============================ ⑤ 启停 ============================ */
describe('自动化任务 · 单任务启停（md §7.2）', () => {
  it('缺 status 的存量任务视为「启用」→ 切换下发 DISABLED 并提示「任务已停用」', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: [task(1, { status: undefined })] })
    await mountStage({ positionId: 5 })
    editor.emit('toggle-status')
    await flush()
    expect(setSampleTaskStatus).toHaveBeenCalledWith(5, 1, 'DISABLED')
    expect(ElMessage.success).toHaveBeenCalledWith('任务已停用')
  })

  it('切换失败 → 提示具体原因、状态不变（再切仍下发 DISABLED）；无原因兜底「操作失败」', async () => {
    await mountStage()
    setSampleTaskStatus.mockRejectedValueOnce(new Error('调度服务不可用'))
    editor.emit('toggle-status')
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('调度服务不可用')
    expect(ElMessage.success).not.toHaveBeenCalled()

    setSampleTaskStatus.mockRejectedValueOnce(null)
    editor.emit('toggle-status')
    await flush()
    expect(ElMessage.error).toHaveBeenLastCalledWith('操作失败')
    expect(setSampleTaskStatus.mock.calls.map((c) => c[2])).toEqual(['DISABLED', 'DISABLED'])
  })

  it('切换进行中 → 编辑器收到 status-busy=true；重复点击不重复下发，完成后复位', async () => {
    let resolve
    setSampleTaskStatus.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    await mountStage()
    editor.emit('toggle-status')
    await flush()
    expect(container.querySelector('.stub-editor').dataset.busy).toBe('true')
    editor.emit('toggle-status')
    await flush()
    expect(setSampleTaskStatus).toHaveBeenCalledTimes(1)
    resolve()
    await flush()
    expect(container.querySelector('.stub-editor').dataset.busy).toBe('false')
    expect(ElMessage.success).toHaveBeenCalledWith('任务已停用')
  })
})

/* ============================ ⑥ 编辑器回调 ============================ */
describe('自动化任务 · 保存 / 创建回调（md §7.9）', () => {
  it('编辑器 saved（带 warnings）→ 逐条 warning 透出（对象取 message、字符串原样、空项跳过），刷新列表并上抛 saved', async () => {
    await mountStage()
    listSampleTasks.mockResolvedValueOnce({ list: [task(1, { name: '任务1-新名' }), task(2), task(3)] })
    editor.emit('saved', { id: 1, warnings: [{ message: '引用工具连接异常' }, '已超过 20 条软上限', {}] })
    await flush()
    expect(ElMessage.warning.mock.calls).toEqual([['引用工具连接异常'], ['已超过 20 条软上限']])
    expect(listSampleTasks).toHaveBeenCalledTimes(2)
    expect(names()[0]).toBe('任务1-新名')
    expect(emitted.saved).toBe(1)
  })

  it('新建态 created（带 id）→ 列表刷新并自动选中新建任务（md §7.9「左侧列表刷新并自动选中新建任务」）', async () => {
    await mountStage()
    container.querySelector('.st-new').click()
    await flush()
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('new') // 前提：进入新建态
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(2), task(3), task(4)] })
    editor.emit('created', { id: 4 })
    await flush()
    expect(container.querySelector('.st-creating')).toBeNull()
    expect(itemEls()[3].classList.contains('on')).toBe(true)
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('4')
    expect(emitted.saved).toBe(1)
    expect(emitted.counts.at(-1)).toBe(4)
  })

  it('created 未回 id → 退出新建态回到占位', async () => {
    await mountStage()
    container.querySelector('.st-new').click()
    await flush()
    editor.emit('created', null)
    await flush()
    expect(container.querySelector('.st-creating')).toBeNull()
    expect(container.querySelector('.stub-editor')).toBeNull()
    expect(phTitle()).toBe('从左侧选一条任务')
  })
})

/* ============================ ⑦ 新建态 ============================ */
describe('自动化任务 · 新建态切换（md §7.1）', () => {
  it('已在新建态再点【＋ 新增】→ 按钮置灰、无重复确认，仍是新建态', async () => {
    await mountStage()
    const btn = container.querySelector('.st-new')
    btn.click()
    await flush()
    expect(btn.classList.contains('disabled')).toBe(true)
    editor.emit('dirty-change', true)
    btn.click()
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('.st-creating')?.textContent).toContain('填写右侧信息后创建')
  })

  it('编辑中有未保存修改点【＋ 新增】→ 弹「有未保存的修改，切换将丢弃。继续？」；取消留在原条目，确认进新建态', async () => {
    await mountStage()
    editor.emit('dirty-change', true)
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    container.querySelector('.st-new').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith('有未保存的修改，切换将丢弃。继续？', '切换样例', expect.any(Object))
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('1')

    container.querySelector('.st-new').click()
    await flush()
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('new')
    // 切换后脏态清零：再点其它条目不再确认
    ElMessageBox.confirm.mockClear()
    itemEls()[1].click()
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('2')
  })

  it('点击已选中的条目 → 无变化、不弹确认', async () => {
    await mountStage()
    editor.emit('dirty-change', true)
    itemEls()[0].click()
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('1')
  })
})

/* ============================ ⑧ 拖拽排序 ============================ */
function dragEvent(type) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  e.dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
  return e
}
describe('自动化任务 · 拖拽排序即时保存（md §7.1「排序后即时保存」）', () => {
  it('把第 1 条拖到第 3 条上 → 列表即时变序，reorderSampleTasks(岗位, [2,3,1])', async () => {
    await mountStage({ positionId: 9 })
    const start = dragEvent('dragstart')
    itemEls()[0].dispatchEvent(start)
    await flush()
    expect(start.dataTransfer.effectAllowed).toBe('move')
    expect(start.dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0')
    expect(itemEls()[0].classList.contains('st-dragging')).toBe(true)
    const over = dragEvent('dragover')
    itemEls()[2].dispatchEvent(over)
    await flush()
    expect(over.defaultPrevented).toBe(true)
    expect(itemEls()[2].classList.contains('st-drag-over')).toBe(true)
    expect(itemEls()[2].classList.contains('st-drag-over-below')).toBe(true)
    itemEls()[2].dispatchEvent(dragEvent('drop'))
    await flush()
    expect(reorderSampleTasks).toHaveBeenCalledWith(9, [2, 3, 1])
    expect(names()).toEqual(['任务2', '任务3', '任务1'])
    expect(container.querySelector('.st-dragging, .st-drag-over')).toBeNull()
  })

  it('保存失败 → 回滚原顺序并提示「调序保存失败」', async () => {
    reorderSampleTasks.mockRejectedValueOnce(new Error('x'))
    await mountStage()
    itemEls()[2].dispatchEvent(dragEvent('dragstart'))
    itemEls()[0].dispatchEvent(dragEvent('dragover'))
    itemEls()[0].dispatchEvent(dragEvent('drop'))
    await flush()
    expect(reorderSampleTasks).toHaveBeenCalledWith(1, [3, 1, 2])
    expect(ElMessage.error).toHaveBeenCalledWith('调序保存失败')
    expect(names()).toEqual(['任务1', '任务2', '任务3'])
  })

  it('落回原位 / 未起拖直接 drop / 未起拖的 dragover → 都不下发排序', async () => {
    await mountStage()
    // 未起拖的 dragover 不接管（不 preventDefault）
    const stray = dragEvent('dragover')
    itemEls()[1].dispatchEvent(stray)
    expect(stray.defaultPrevented).toBe(false)
    itemEls()[1].dispatchEvent(dragEvent('drop'))
    // 起拖后落回原位
    itemEls()[1].dispatchEvent(dragEvent('dragstart'))
    itemEls()[1].dispatchEvent(dragEvent('drop'))
    // 起拖后直接 dragend 取消
    itemEls()[0].dispatchEvent(dragEvent('dragstart'))
    await flush()
    itemEls()[0].dispatchEvent(dragEvent('dragend'))
    await flush()
    expect(reorderSampleTasks).not.toHaveBeenCalled()
    expect(container.querySelector('.st-dragging')).toBeNull()
    expect(names()).toEqual(['任务1', '任务2', '任务3'])
  })
})

/* ============================ ⑨ 试跑面板（构建期开关） ============================ */
describe('自动化任务 · 试跑入口（EFFECT_TEST_ENABLED 开关；md §7 未规定，按开关两态与面板基本态）', () => {
  const testBtn = (i) => itemEls()[i].querySelector('.st-op-test')
  const drawer = () => container.querySelector('.stub-drawer')

  it('开关关闭（现状）→ 列表行无「测试」入口', async () => {
    await mountStage()
    expect(container.querySelector('.st-op-test')).toBeNull()
  })

  it('开关打开 → 点「测试」调 testRunSampleTask(岗位, 任务)，抽屉展示成功结论 / 摘要 / 归一后的步骤', async () => {
    flags.effect = true
    testRunSampleTask.mockResolvedValueOnce({
      success: true,
      resultSummary: '已生成周报',
      steps: [{ type: 'ACTION', bizName: '查数', observation: '10 条' }, { no: 9, status: 'failed' }]
    })
    await mountStage({ positionId: 3 })
    testBtn(1).click()
    await flush()
    expect(testRunSampleTask).toHaveBeenCalledWith(3, 2)
    expect(drawer().dataset.title).toBe('测试样例「任务2」')
    expect(drawer().querySelector('.tr-verdict').textContent.trim()).toBe('✓ 试跑成功')
    expect(drawer().querySelector('.tr-summary').textContent.trim()).toBe('已生成周报')
    expect(reactLast.steps).toEqual([
      expect.objectContaining({ no: 1, type: 'ACTION', bizName: '查数', status: 'success', observationBrief: '10 条', latencyMs: null }),
      expect.objectContaining({ no: 9, type: 'OBSERVATION', bizName: '', status: 'failed', observationBrief: '' })
    ])
    // 选中不受影响（测试按钮阻止冒泡）
    expect(container.querySelector('.stub-editor').dataset.sampleId).toBe('1')
    // 关闭
    const close = [...drawer().querySelectorAll('button')].find((b) => b.textContent.trim() === '关闭')
    close.click()
    await flush()
    expect(drawer()).toBeNull()
  })

  it('试跑未成功 → 「✕ 试跑未成功」+ 失败原因 + 无步骤空态；「再跑一次」重新下发', async () => {
    flags.effect = true
    testRunSampleTask.mockResolvedValueOnce({ success: false, summary: '中途失败', failureReason: '工具超时' })
    await mountStage()
    testBtn(0).click()
    await flush()
    expect(drawer().querySelector('.tr-verdict').textContent.trim()).toBe('✕ 试跑未成功')
    expect(drawer().querySelector('.tr-fail').textContent.trim()).toBe('工具超时')
    expect(drawer().querySelector('.stub-empty-desc').textContent).toBe('本次试跑无步骤记录')
    const again = [...drawer().querySelectorAll('button')].find((b) => b.textContent.trim() === '再跑一次')
    again.click()
    await flush()
    expect(testRunSampleTask).toHaveBeenCalledTimes(2)
  })

  it('试跑请求失败 → 抽屉展示错误原因（无原因兜底）+【重试】可再跑', async () => {
    flags.effect = true
    testRunSampleTask.mockRejectedValueOnce(new Error('额度不足'))
    await mountStage()
    testBtn(0).click()
    await flush()
    expect(drawer().querySelector('.tr-error .stub-empty-desc').textContent).toBe('额度不足')
    testRunSampleTask.mockRejectedValueOnce({})
    drawer().querySelector('.tr-error button').click()
    await flush()
    expect(testRunSampleTask).toHaveBeenCalledTimes(2)
    expect(drawer().querySelector('.tr-error .stub-empty-desc').textContent).toBe('测试失败，请稍后重试')
  })

  it('当前条目有未保存修改时点测试 → 先提示「测试用的是已保存的版本」，取消则不下发', async () => {
    flags.effect = true
    await mountStage()
    editor.emit('dirty-change', true)
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    testBtn(0).click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '当前样例有未保存的修改，测试用的是已保存的版本。要先关闭提示继续测试吗？',
      '测试提示',
      expect.objectContaining({ confirmButtonText: '继续测试' })
    )
    expect(testRunSampleTask).not.toHaveBeenCalled()
    expect(drawer()).toBeNull()
  })
})

/* ============================ 左侧列表规则（2026-10-08 T12 由 SampleTaskPrototype4B 迁入） ============================ */
// 迁入 5 条纯列表行为用例：断言原样，挂载由 mountComp(PositionSampleTaskStage) + flush 换为本文件的 mountStage（内含 flush）；
// 原组另 2 条与本文件重复已删（列表为空占位 ↔「接口返回无 list 字段…」；删除确认 ↔「删除当前选中任务…」），
// 3 条依赖真编辑器 DOM 的留在 SampleTaskEditor.test.js「Stage × 真编辑器集成」组。
describe('自动化任务 · 左侧列表规则（md 岗位 §7.1）', () => {
  const task = (id, over = {}) => ({
    id,
    name: `任务${id}`,
    prompt: `指令${id}`,
    status: 'ENABLED',
    scheduleSummary: '每天 09:00',
    schedule: { scheduleType: 'DAILY', times: ['09:00'] },
    sopDoc: 'sop',
    toolRefs: [],
    skillRefs: [],
    ...over
  })

  it('缺「一句话指令」的条目 → 名称旁出红色「缺指令」标签；已填的不出（md §7.1「缺少"一句话指令"时展示红色"缺指令"标签」）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: [task(1, { prompt: '' }), task(2)] })
    await mountStage({ positionId: 1 })
    const items = [...container.querySelectorAll('.st-item')]
    expect(items[0].querySelector('.st-flag')?.textContent.trim()).toBe('缺指令')
    expect(items[1].querySelector('.st-flag')).toBeNull()
  })

  it('已有 20 条 → 新增按钮置灰、文案「已达 20 条任务上限」，点击不进新建态（md §7.1「软上限 20 条，达到上限后新增按钮置灰并提示"已达 20 条任务上限"」）', async () => {
    const { ElMessage } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: Array.from({ length: 20 }, (_, i) => task(i + 1)) })
    await mountStage({ positionId: 1 })
    const btn = container.querySelector('.st-new')
    expect(btn.classList.contains('disabled')).toBe(true)
    expect(btn.textContent.trim()).toBe('已达 20 条任务上限')
    btn.click()
    await flush()
    expect(container.querySelector('.st-creating')).toBeNull()
    expect(ElMessage.warning).toHaveBeenCalledWith('自动化任务建议不超过 20 条，把最推荐的放前面')
  })

  it('19 条 → 新增按钮可点、文案「＋ 新增自动化任务」，点击后左栏出「新增中…」行（md §7.1「底部【＋ 新增自动化任务】按钮，点击后右侧进入新建态」）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: Array.from({ length: 19 }, (_, i) => task(i + 1)) })
    await mountStage({ positionId: 1 })
    const btn = container.querySelector('.st-new')
    expect(btn.classList.contains('disabled')).toBe(false)
    expect(btn.textContent.trim()).toBe('＋ 新增自动化任务')
    btn.click()
    await flush()
    expect(container.querySelector('.st-creating')?.textContent).toContain('新增中…')
  })

  it('无未保存修改时切换条目 → 不弹确认直接切换', async () => {
    const { ElMessageBox } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(2)] })
    await mountStage({ positionId: 1 })
    ;[...container.querySelectorAll('.st-item')][1].click()
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('.st-item.on .st-name-text').textContent.trim()).toBe('任务2')
  })

  it('K6 删除确认取消 → 不调 deleteSampleTask、无 toast', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    const { deleteSampleTask } = await import('@/api/sampleTask')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1)] })
    await mountStage({ positionId: 1 })
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    ;[...container.querySelectorAll('.st-item .st-name button')].find((b) => b.textContent.trim() === '删除').click()
    await flush()
    expect(deleteSampleTask).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
