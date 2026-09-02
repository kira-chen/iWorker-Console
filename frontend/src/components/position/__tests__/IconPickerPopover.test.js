// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * IconPickerPopover（全站图标配置统一入口）行为契约（PRD 图标统一规则，2026-09-02 拍板）：
 * 1. 入口结构：【从图标库选择】【上传图标】两枚规则入口 + 既有「AI 生成」保留；
 * 2. 【从图标库选择】打开图标库弹窗（网格），选中回吐 { icon, iconSource:'library' }；
 * 3. 上传类型/大小校验，逐字文案「请选择图片文件」「图片不能超过 5 MB」，校验失败不进裁剪；
 * 4. 合法图片进入方形裁剪弹窗，【使用该区域】输出 256×256 PNG dataURL 并回吐 iconSource:'upload'；
 * 5. readonly 只读态：入口置灰不可点（新增 prop，默认 false，旧消费方零改动兼容）。
 */

vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))

vi.mock('@/api/position', () => ({
  getIconLibrary: vi.fn(() => Promise.resolve([{ id: 'ic_0', url: '📊', name: '图表' }, { id: 'ic_1', url: '🤖', name: '机器人' }])),
  aiGenerateIcon: vi.fn(() => Promise.resolve({ url: 'https://x/ai.png' })),
  probeAiIconAvailability: vi.fn(() => Promise.resolve({ available: true }))
}))

import { ElMessage } from 'element-plus'
import { getIconLibrary } from '@/api/position'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'

const stubs = {
  'el-popover': { props: ['visible', 'disabled'], template: '<div><slot name="reference" /><slot /></div>' },
  'el-dialog': {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog" :data-title="title"><slot /><slot name="footer" /></div>'
  },
  'el-slider': {
    props: ['modelValue', 'min', 'max'],
    emits: ['update:modelValue'],
    template: '<input class="stub-slider" type="range" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />'
  },
  'el-button': { emits: ['click'], template: '<button class="stub-btn" @click="$emit(\'click\')"><slot /></button>' },
  'el-tooltip': { template: '<div><slot /></div>' }
}

// 在任何 spy 之前捕获真实 createElement，避免二次 stub 时把上一轮 mock 绑成“原函数”造成自递归。
const realCreateElement = document.createElement.bind(document)

let app, container, picked, createElSpy

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  picked = []
  app = createApp({
    render: () => h(IconPickerPopover, { icon: '', positionName: '测试岗位', onPick: (p) => picked.push(p), ...props })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  createElSpy?.mockRestore()
  createElSpy = null
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const cardByText = (el, text) =>
  [...el.querySelectorAll('.ip-card')].find((b) => b.textContent.includes(text))
const btnByText = (el, text) =>
  [...el.querySelectorAll('.stub-btn')].find((b) => b.textContent.includes(text))

/** 伪造文件（type/name/size 可控，无需真实 5MB 内容）。 */
function fakeFile({ type = 'image/png', name = 'a.png', size = 1024 } = {}) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}
function dispatchFile(el, file) {
  const input = el.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
}

/** 稳定的 Image / FileReader / canvas 桩（jsdom 不加载图片、canvas 无 2d 实现）。 */
function stubImagePipeline({ natW = 512, natH = 384 } = {}) {
  class FakeImage {
    constructor() {
      this.naturalWidth = natW
      this.naturalHeight = natH
    }
    set src(v) {
      this._src = v
      queueMicrotask(() => this.onload && this.onload())
    }
  }
  class FakeFileReader {
    readAsDataURL() {
      queueMicrotask(() => {
        this.result = 'data:image/png;base64,ORIG'
        this.onload && this.onload()
      })
    }
  }
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('FileReader', FakeFileReader)
  const ctx = { drawImage: vi.fn() }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx), toDataURL: vi.fn(() => 'data:image/png;base64,CROPPED') }
  createElSpy = vi
    .spyOn(document, 'createElement')
    .mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreateElement(tag)))
  return { canvas, ctx }
}

describe('入口结构', () => {
  it('展示【从图标库选择】【上传图标】两枚入口，且保留「AI 生成」', () => {
    const el = mount()
    expect(cardByText(el, '从图标库选择')).toBeTruthy()
    expect(cardByText(el, '上传图标')).toBeTruthy()
    expect(cardByText(el, 'AI 生成')).toBeTruthy()
  })

  it('点【从图标库选择】打开图标库弹窗并拉取清单，选中回吐 library 来源', async () => {
    const el = mount()
    cardByText(el, '从图标库选择').click()
    await flush()
    expect(getIconLibrary).toHaveBeenCalledTimes(1)
    const dialog = el.querySelector('.stub-dialog[data-title="从图标库选择"]')
    expect(dialog).toBeTruthy()
    const cells = dialog.querySelectorAll('.ip-cell')
    expect(cells.length).toBe(2)
    cells[1].click()
    await flush()
    expect(picked).toEqual([{ icon: '🤖', iconSource: 'library' }])
    // 选中后弹窗关闭
    expect(el.querySelector('.stub-dialog[data-title="从图标库选择"]')).toBeFalsy()
  })
})

describe('上传校验（逐字文案）', () => {
  it('非图片文件 → 「请选择图片文件」，不进裁剪', async () => {
    const el = mount()
    dispatchFile(el, fakeFile({ type: 'text/plain', name: 'a.txt' }))
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('请选择图片文件')
    expect(el.querySelector('.stub-dialog[data-title="裁剪图标"]')).toBeFalsy()
    expect(picked).toEqual([])
  })

  it('超过 5MB → 「图片不能超过 5 MB」，不进裁剪', async () => {
    const el = mount()
    dispatchFile(el, fakeFile({ size: 5 * 1024 * 1024 + 1 }))
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('图片不能超过 5 MB')
    expect(el.querySelector('.stub-dialog[data-title="裁剪图标"]')).toBeFalsy()
    expect(picked).toEqual([])
  })
})

describe('裁剪弹窗', () => {
  it('合法图片打开裁剪弹窗（含缩放滑杆与三枚操作钮）', async () => {
    stubImagePipeline()
    const el = mount()
    dispatchFile(el, fakeFile())
    await flush()
    const dialog = el.querySelector('.stub-dialog[data-title="裁剪图标"]')
    expect(dialog).toBeTruthy()
    expect(dialog.querySelector('.stub-slider')).toBeTruthy()
    expect(btnByText(dialog, '使用该区域')).toBeTruthy()
    expect(btnByText(dialog, '取消')).toBeTruthy()
    expect(btnByText(dialog, '重新选择图片')).toBeTruthy()
  })

  it('【使用该区域】输出 256×256 PNG dataURL，回吐 iconSource=upload 并关闭弹窗', async () => {
    const { canvas, ctx } = stubImagePipeline({ natW: 512, natH: 384 })
    const el = mount()
    dispatchFile(el, fakeFile())
    await flush()
    btnByText(el, '使用该区域').click()
    await flush()
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(256)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
    // 初始 cover 居中：512×384 → scale=280/384，源区为居中 384×384 正方形
    const call = ctx.drawImage.mock.calls[0]
    expect(call[3]).toBeCloseTo(384) // sw
    expect(call[4]).toBeCloseTo(384) // sh
    expect(call[1]).toBeCloseTo(64) // sx = (512-384)/2
    expect(call[2]).toBeCloseTo(0) // sy
    expect(call.slice(5)).toEqual([0, 0, 256, 256])
    expect(picked).toEqual([{ icon: 'data:image/png;base64,CROPPED', iconSource: 'upload' }])
    expect(el.querySelector('.stub-dialog[data-title="裁剪图标"]')).toBeFalsy()
  })

  it('【取消】关闭弹窗且不回吐（保留原图标）', async () => {
    stubImagePipeline()
    const el = mount()
    dispatchFile(el, fakeFile())
    await flush()
    btnByText(el, '取消').click()
    await flush()
    expect(el.querySelector('.stub-dialog[data-title="裁剪图标"]')).toBeFalsy()
    expect(picked).toEqual([])
  })
})

describe('只读态', () => {
  it('readonly=true：触发头像与入口置灰，点击入口无效', async () => {
    const el = mount({ readonly: true })
    expect(el.querySelector('.ip-avatar.is-readonly')).toBeTruthy()
    expect(cardByText(el, '从图标库选择').classList.contains('disabled')).toBe(true)
    expect(cardByText(el, '上传图标').classList.contains('disabled')).toBe(true)
    cardByText(el, '从图标库选择').click()
    await flush()
    expect(getIconLibrary).not.toHaveBeenCalled()
    expect(el.querySelector('.stub-dialog[data-title="从图标库选择"]')).toBeFalsy()
  })

  it('readonly 默认 false：旧消费方（不传该 prop）行为不变', () => {
    const el = mount()
    expect(el.querySelector('.ip-avatar.is-readonly')).toBeFalsy()
    expect(cardByText(el, '从图标库选择').classList.contains('disabled')).toBe(false)
  })
})
