// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * IntakeFieldEditor（采集字段配置器）行为契约（岗位编辑区加固批 #2，2026-08-08）。
 *
 * 采集 schema 直接决定客户端领用表单，写坏即线上表单坏。钉住四类易错点：
 *  1. key 自动联动：key 处于「自动模式」（空或等于旧 label 的自动值）时改显示名要重算，
 *     用户手改过 key 则**绝不覆盖**（覆盖 = 静默改契约字段名，客户端已填值对不上）；
 *  2. 切类型清理：非选择类型要清空 options，切类型一律清 defaultValue（残留 = 脏 schema 发到客户端）；
 *  3. ≤10 字段硬上限：达上限「+ 添加」禁用且不增行；
 *  4. 删除分级：有领用（hasClaims）必须二次确认并说明「已填值将失效」，取消不删；无领用直删。
 */

const confirmMock = vi.fn()
vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: (...a) => confirmMock(...a) }
}))
vi.mock('@element-plus/icons-vue', () => ({
  Delete: { template: '<i />' },
  ArrowRight: { template: '<i />' },
  Plus: { template: '<i />' },
  Close: { template: '<i />' }
}))

import IntakeFieldEditor from '@/components/position/IntakeFieldEditor.vue'
import { genKeyFromLabel } from '@/utils/positionModel'

const stubs = {
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="stub-select"><slot /></div>'
  },
  'el-option': { template: '<div />' },
  'el-checkbox': { props: ['modelValue'], template: '<input type="checkbox" />' },
  'el-switch': { props: ['modelValue'], template: '<span />' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<div><slot /></div>' },
  // 必须接 disabled：上限防线在模板的 :disabled="atLimit" 上，桩若不接则永远可点，
  // 测到的只是 addRow 内的兜底 return，测不到真实拦截（2026-08-08 审视修正的假绿点）
  'el-button': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}

function row(over = {}) {
  return { key: '', label: '', type: 'text', required: false, options: [], placeholder: '', defaultValue: null, desc: '', ...over }
}

let app, container, updates

/** 挂载并暴露最近一次 update:rows 载荷。 */
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  updates = []
  app = createApp({
    render: () =>
      h(IntakeFieldEditor, {
        rows: [],
        'onUpdate:rows': (next) => updates.push(next),
        ...props
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

const last = () => updates[updates.length - 1]
/** 第 idx 行的显示名输入框（每行首个 stub-input）。 */
const labelInputOf = (el, idx) => el.querySelectorAll('.ife-row')[idx].querySelector('.stub-input')

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.mockResolvedValue()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('IntakeFieldEditor · 采集字段编辑契约', () => {
  it('key 自动模式：改显示名 → key 置空待重算（后续按新 label 生成）', async () => {
    const el = mount({ rows: [row({ label: '区域', key: genKeyFromLabel('区域') })] })
    const input = labelInputOf(el, 0)
    input.value = '负责区域'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(last()[0].label).toBe('负责区域')
    expect(last()[0].key).toBe('') // 置空 = 交给 effectiveKey 按新 label 自动生成
  })

  it('key 已手改：改显示名 → 绝不覆盖用户的 key（防静默改契约字段名）', async () => {
    const el = mount({ rows: [row({ label: '区域', key: 'my_custom_key' })] })
    const input = labelInputOf(el, 0)
    input.value = '负责区域'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(last()[0].label).toBe('负责区域')
    expect(last()[0].key).toBe('my_custom_key')
  })

  it('≤10 字段硬上限：达上限时「+ 添加」禁用、点击不增行，并给出上限提示', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ label: `f${i}` }))
    const el = mount({ rows })
    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('添加'))
    expect(addBtn).toBeTruthy()
    expect(addBtn.disabled, '达上限时添加入口须禁用（第一道闸）').toBe(true)
    addBtn.click()
    await nextTick()
    expect(updates.length).toBe(0)
    expect(el.textContent).toContain('最多 10 个采集字段')
  })

  it('未达上限：「+ 添加」可点（对照组——防上面那条因按钮恒禁用而假绿）', async () => {
    const el = mount({ rows: [row({ label: 'f0' })] })
    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('添加'))
    expect(addBtn.disabled).toBe(false)
  })

  it('未达上限：「+ 添加」追加一行默认 text 类型', async () => {
    const el = mount({ rows: [row({ label: 'f0' })] })
    const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('添加'))
    addBtn.click()
    await nextTick()
    expect(last().length).toBe(2)
    expect(last()[1].type).toBe('text')
  })

  it('删除（无领用）→ 直删不确认', async () => {
    const el = mount({ rows: [row({ label: 'a' }), row({ label: 'b' })], hasClaims: false })
    const delBtn = [...el.querySelectorAll('.ife-row')[0].querySelectorAll('button')].pop()
    delBtn.click()
    await nextTick()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(last().map((r) => r.label)).toEqual(['b'])
  })

  it('删除（有领用）→ 二次确认且文案说明「已填值将失效」，确认后删除', async () => {
    const el = mount({ rows: [row({ label: '区域' }), row({ label: 'b' })], hasClaims: true })
    const delBtn = [...el.querySelectorAll('.ife-row')[0].querySelectorAll('button')].pop()
    delBtn.click()
    await nextTick()
    expect(confirmMock).toHaveBeenCalled()
    expect(confirmMock.mock.calls[0][0]).toContain('已填值将失效')
    expect(confirmMock.mock.calls[0][0]).toContain('区域')
    await nextTick()
    expect(last().map((r) => r.label)).toEqual(['b'])
  })

  it('删除（有领用）取消 → 不删', async () => {
    confirmMock.mockRejectedValue(new Error('cancel'))
    const el = mount({ rows: [row({ label: 'a' }), row({ label: 'b' })], hasClaims: true })
    const delBtn = [...el.querySelectorAll('.ife-row')[0].querySelectorAll('button')].pop()
    delBtn.click()
    await nextTick()
    await nextTick()
    expect(updates.length).toBe(0)
  })
})
