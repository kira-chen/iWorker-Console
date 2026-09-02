// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * N5 岗位发布版本弹窗单测：打开自动带出建议号（语义化 vX.Y.Z）、格式校验（报错给样例）、升级说明必填、无法自动建议态、确认回吐 payload。
 */

const nextLabelSpy = vi.fn()
vi.mock('@/api/position', () => ({ getNextVersionLabel: (...a) => nextLabelSpy(...a) }))

// EP 存根：el-dialog 透传内容 + footer；el-input 渲染可交互 input/textarea；el-button 触发 click。
const stubs = {
  'el-dialog': {
    props: ['modelValue'],
    template: '<div class="dlg"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  },
  'el-input': {
    props: ['modelValue', 'type'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :data-type="type||\'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-button': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  // el-tooltip：把 content 暴露为 data-tip 供断言禁用原因复述。
  'el-tooltip': {
    props: ['content', 'placement'],
    template: '<span class="el-tooltip" :data-tip="content"><slot /></span>'
  }
}

const PositionPublishVersionDialog = (
  await import('@/components/position/PositionPublishVersionDialog.vue')
).default

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const events = { confirm: [] }
  app = createApp({
    render: () =>
      h(PositionPublishVersionDialog, {
        modelValue: true,
        positionId: 'pos_1',
        positionName: '销售',
        ...props,
        onConfirm: (p) => events.confirm.push(p)
      })
  })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return { container, events }
}
beforeEach(() => {
  nextLabelSpy.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

// 找发布按钮（footer 内最后一个 button）。
function publishBtn(container) {
  const btns = container.querySelectorAll('.dlg-footer button')
  return btns[btns.length - 1]
}

describe('PositionPublishVersionDialog · N5', () => {
  it('打开自动带出建议号；发布按钮可用（升级说明填后）', async () => {
    nextLabelSpy.mockResolvedValue('v1.2.1')
    const { container, events } = mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    const verInput = container.querySelector('.stub-input[data-type="text"]')
    expect(verInput.value).toBe('v1.2.1') // 自动带出下一号
    // 升级说明为空 → 发布禁用
    expect(publishBtn(container).disabled).toBe(true)
    // 填升级说明
    const notes = container.querySelector('.stub-input[data-type="textarea"]')
    notes.value = '本次更新了导出'
    notes.dispatchEvent(new Event('input'))
    await nextTick()
    expect(publishBtn(container).disabled).toBe(false)
    // 点发布 → 回吐 payload
    publishBtn(container).click()
    expect(events.confirm[0]).toEqual({ versionLabel: 'v1.2.1', releaseNotes: '本次更新了导出' })
  })

  it('版本号格式非法 → 发布禁用（硬拦）', async () => {
    nextLabelSpy.mockResolvedValue('v1.2.1')
    const { container } = mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    const verInput = container.querySelector('.stub-input[data-type="text"]')
    verInput.value = 'v1' // 非法
    verInput.dispatchEvent(new Event('input'))
    const notes = container.querySelector('.stub-input[data-type="textarea"]')
    notes.value = '说明'
    notes.dispatchEvent(new Event('input'))
    await nextTick()
    expect(publishBtn(container).disabled).toBe(true)
  })

  it('无法自动建议（后端返回 null）→ 提示 + 无版本输入框 + 发布禁用', async () => {
    nextLabelSpy.mockResolvedValue(null)
    const { container } = mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    expect(container.querySelector('.pv-max')).toBeTruthy()
    expect(container.querySelector('.stub-input')).toBeNull() // 无输入框
    expect(publishBtn(container).disabled).toBe(true)
  })

  it('N6：无法自动建议时发布按钮被 tooltip 包裹并复述原因（别让用户对着灰按钮猜）', async () => {
    nextLabelSpy.mockResolvedValue(null)
    const { container } = mount()
    await nextTick(); await Promise.resolve(); await nextTick()
    const tip = container.querySelector('.dlg-footer .el-tooltip')
    expect(tip).toBeTruthy()
    expect(tip.getAttribute('data-tip')).toContain('无法自动生成建议版本号')
    // tooltip 内仍是那颗禁用发布按钮
    expect(tip.querySelector('button').disabled).toBe(true)
  })
})
