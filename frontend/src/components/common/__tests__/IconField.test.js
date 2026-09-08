// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * IconField（图标行：预览块 + 并排【从图标库选择】【上传图标】）契约——2026-09-08 原型复刻批次 1 · S3/S4 对齐。
 * 1. 结构照原型 .icon-row：预览块 + 两枚 plain 按钮，文案逐字；不出「AI 生成」；
 * 2. 【从图标库选择】直开图标库弹窗（不经 popover），选中回吐 { icon, iconSource:'library' }；
 * 3. 预览：URL/dataURL 按图片渲染，字符按文本，空值显占位；
 * 4. readonly：两按钮 disabled，点击不开弹窗；
 * 5. 无头模式：不渲染 popover 头像触发块（.ip-avatar）。
 */

vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))
vi.mock('@/api/position', () => ({
  getIconLibrary: vi.fn(() => Promise.resolve([{ id: 'ic_0', url: '📊', name: '图表' }])),
  aiGenerateIcon: vi.fn(),
  probeAiIconAvailability: vi.fn(() => Promise.resolve({ available: true }))
}))

import IconField from '@/components/common/IconField.vue'

const stubs = {
  'el-popover': { props: ['visible', 'disabled'], template: '<div class="stub-popover"><slot name="reference" /><slot /></div>' },
  'el-dialog': {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog" :data-title="title"><slot /><slot name="footer" /></div>'
  },
  'el-slider': { props: ['modelValue'], template: '<input class="stub-slider" />' },
  'el-button': {
    props: { disabled: Boolean, plain: Boolean },
    emits: ['click'],
    template: '<button class="stub-btn" :disabled="disabled" :data-plain="plain" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-tooltip': { template: '<div><slot /></div>' }
}

let app, container, picked
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  picked = []
  app = createApp({ render: () => h(IconField, { icon: '', name: '测试岗位', onPick: (p) => picked.push(p), ...props }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
const btns = () => [...container.querySelectorAll('.icon-row > .stub-btn')]

describe('IconField · 图标行（原型复刻批次 1）', () => {
  it('结构：预览块 + 【从图标库选择】【上传图标】两枚 plain 按钮，无 AI 生成、无 popover 头像块', () => {
    mount()
    expect(container.querySelector('.icon-preview')).toBeTruthy()
    expect(btns().map((b) => b.textContent.trim())).toEqual(['从图标库选择', '上传图标'])
    expect(btns().every((b) => b.dataset.plain === 'true')).toBe(true)
    expect(container.textContent).not.toContain('AI 生成')
    expect(container.querySelector('.ip-avatar')).toBeNull()
  })

  it('预览：空值显占位；字符按文本；URL / dataURL 按图片', async () => {
    mount({ placeholder: '▦' })
    expect(container.querySelector('.icon-preview').textContent.trim()).toBe('▦')
    app.unmount(); container.remove()
    mount({ icon: '🤖' })
    expect(container.querySelector('.icon-preview').textContent.trim()).toBe('🤖')
    app.unmount(); container.remove()
    mount({ icon: 'data:image/png;base64,AAAA' })
    expect(container.querySelector('.icon-preview img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('【从图标库选择】直开图标库弹窗，选中回吐 { icon, iconSource:"library" }', async () => {
    mount()
    btns()[0].click()
    await flush()
    const dlg = container.querySelector('.stub-dialog[data-title="从图标库选择"]')
    expect(dlg).toBeTruthy()
    dlg.querySelector('.ip-cell').click()
    await flush()
    expect(picked).toEqual([{ icon: '📊', iconSource: 'library' }])
  })

  it('readonly：两按钮 disabled，点击不开图标库', async () => {
    mount({ readonly: true })
    expect(btns().every((b) => b.disabled)).toBe(true)
    btns()[0].dispatchEvent(new Event('click'))
    await flush()
    expect(container.querySelector('.stub-dialog')).toBeNull()
  })
})
