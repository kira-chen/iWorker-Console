// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * ClaimDescEditor（领用页文案多条编辑器）行为契约（批量补测，2026-08-08）。
 *
 * 核心契约是「**只在单条保存时 emit**」——旧实现边打字边回吐，导致父级 debounce 自动保存
 * 把半成品写进岗位配置（反馈 2 修复项）。本文件把该语义与列表增删改钉死：
 *  1. 编辑草稿期间（输入/改 emoji）绝不 emit；点「保存」才整列回吐一次；
 *  2. 「取消」放弃草稿、不 emit；
 *  3. 新增追加到列表尾，编辑替换对应项（不串位）；
 *  4. 删除移除该项并 emit；
 *  5. 上限 CLAIM_ITEM_MAX：达上限「+ 新增」禁用；
 *  6. 编辑态互斥：正在编辑时其它条的「编辑/删除」禁用（防并发改同一列表）。
 */

vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))

import ClaimDescEditor from '@/components/position/ClaimDescEditor.vue'
import { CLAIM_ITEM_MAX } from '@/utils/positionModel'

const stubs = {
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="stub-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-button': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button class="stub-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-icon': { template: '<i><slot /></i>' },
  'el-tooltip': { template: '<div><slot /></div>' },
  'el-popover': { template: '<div><slot name="reference" /><slot /></div>' }
}

let app, container, emitted

function mount(modelValue = []) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = []
  app = createApp({
    render: () =>
      h(ClaimDescEditor, {
        modelValue,
        'onUpdate:modelValue': (next) => emitted.push(next)
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

const btnByText = (el, text) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
/** 富文本 contenteditable 区。 */
const editorEl = (el) => el.querySelector('[contenteditable]')

/** 在草稿编辑区输入内容（模拟 contenteditable 输入 → syncDraft）。 */
async function typeDraft(el, html) {
  const ed = editorEl(el)
  ed.innerHTML = html
  ed.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  // execCommand 在 jsdom 不存在（粘贴/加粗路径用），补空桩防报错
  document.execCommand = vi.fn()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ClaimDescEditor · 只在保存时回吐（防半成品写入）', () => {
  it('草稿输入期间不 emit；点「保存」才整列回吐一次', async () => {
    const el = mount([])
    btnByText(el, '新增').click()
    await nextTick()
    await typeDraft(el, '这是一条文案')
    expect(emitted.length, '草稿期间绝不 emit').toBe(0)

    btnByText(el, '保存').click()
    await nextTick()
    expect(emitted.length).toBe(1)
    expect(emitted[0]).toHaveLength(1)
    expect(emitted[0][0].content).toContain('这是一条文案')
  })

  it('「取消」放弃草稿 → 不 emit，列表不变', async () => {
    const el = mount([{ emoji: '📌', content: 'old' }])
    btnByText(el, '新增').click()
    await nextTick()
    await typeDraft(el, '临时输入')
    btnByText(el, '取消').click()
    await nextTick()
    expect(emitted.length).toBe(0)
  })

  it('空内容不入列（保存按钮禁用，双保险）', async () => {
    const el = mount([])
    btnByText(el, '新增').click()
    await nextTick()
    const saveBtn = btnByText(el, '保存')
    expect(saveBtn.disabled).toBe(true)
    saveBtn.click()
    await nextTick()
    expect(emitted.length).toBe(0)
  })

  it('编辑既有条：保存后替换该项、不串位', async () => {
    const el = mount([
      { emoji: '📌', content: 'a' },
      { emoji: '🚀', content: 'b' }
    ])
    // 第 2 条的「编辑」
    const rows = [...el.querySelectorAll('.ce-act')].filter((b) => b.textContent.includes('编辑'))
    rows[1].click()
    await nextTick()
    await typeDraft(el, 'b-edited')
    btnByText(el, '保存').click()
    await nextTick()
    expect(emitted[0].map((i) => i.content)).toEqual(['a', expect.stringContaining('b-edited')])
  })

  it('删除某条 → emit 去掉该项的新列表', async () => {
    const el = mount([
      { emoji: '📌', content: 'a' },
      { emoji: '🚀', content: 'b' }
    ])
    const delBtns = [...el.querySelectorAll('.ce-act')].filter((b) => b.textContent.includes('删除'))
    delBtns[0].click()
    await nextTick()
    expect(emitted[0].map((i) => i.content)).toEqual(['b'])
  })

  it(`达 ${CLAIM_ITEM_MAX} 条上限 → 「+ 新增」入口显示上限文案`, async () => {
    const rows = Array.from({ length: CLAIM_ITEM_MAX }, (_, i) => ({ emoji: '📌', content: `c${i}` }))
    const el = mount(rows)
    expect(el.textContent).toContain(`已达 ${CLAIM_ITEM_MAX} 条上限`)
  })

  it('编辑态互斥：正在编辑时其它条的编辑/删除按钮禁用', async () => {
    const el = mount([
      { emoji: '📌', content: 'a' },
      { emoji: '🚀', content: 'b' }
    ])
    const editBtns = [...el.querySelectorAll('.ce-act')].filter((b) => b.textContent.includes('编辑'))
    editBtns[0].click()
    await nextTick()
    const after = [...el.querySelectorAll('.ce-act')]
    expect(after.every((b) => b.disabled), '编辑态下列表项操作应全部禁用').toBe(true)
  })
})
