// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

const SaveStatusIndicator = (await import('@/components/position/SaveStatusIndicator.vue')).default

// el-icon 全局存根（组件用全局注册）。
const stubs = {
  'el-icon': { template: '<i class="el-icon"><slot /></i>' }
}

let app, container
function mount(props, listeners = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SaveStatusIndicator, { ...props, ...listeners }) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('SaveStatusIndicator 四态', () => {
  it('idle：不渲染（无空锚点）；非 idle 时同选择器有节点作对照', () => {
    const el = mount({ status: { phase: 'idle' } })
    expect(el.querySelector('.save-ind')).toBeNull()
    app?.unmount()
    container?.remove()
    // 正向锚点：换成 saving 态时 .save-ind 必须出现——否则「idle 下为 null」只是因为
    // 组件整体没渲染任何东西（空组件替换法实测命中的假绿点，2026-08-08 审视补强）
    const el2 = mount({ status: { phase: 'saving' } })
    expect(el2.querySelector('.save-ind')).toBeTruthy()
  })

  it('editing：灰点 + 「未保存」；多文件聚合「N 个文件未保存」', () => {
    const el = mount({ status: { phase: 'editing', dirtyCount: 1 } })
    expect(el.querySelector('.save-ind.is-editing')).toBeTruthy()
    expect(el.querySelector('.si-dot')).toBeTruthy()
    expect(el.textContent).toContain('未保存')

    app?.unmount()
    container?.remove()
    const el2 = mount({ status: { phase: 'editing', dirtyCount: 3 } })
    expect(el2.textContent).toContain('3 个文件未保存')
  })

  it('saving：转圈 + 「保存中…」', () => {
    const el = mount({ status: { phase: 'saving' } })
    expect(el.querySelector('.save-ind.is-saving')).toBeTruthy()
    expect(el.querySelector('.is-spin')).toBeTruthy()
    expect(el.textContent).toContain('保存中')
  })

  it('flushing 也显「保存中…」（返回/切文件 flush 期间）', () => {
    const el = mount({ status: { phase: 'editing', flushing: true } })
    expect(el.textContent).toContain('保存中')
    expect(el.querySelector('.is-spin')).toBeTruthy()
  })

  it('saved：绿勾 + 相对时间「刚刚」', () => {
    const el = mount({ status: { phase: 'saved', savedAt: Date.now() } })
    expect(el.querySelector('.save-ind.is-saved')).toBeTruthy()
    expect(el.textContent).toContain('已保存')
    expect(el.textContent).toContain('刚刚')
  })

  it('saved：相对时间随时间推移（2 分钟前）', () => {
    const el = mount({ status: { phase: 'saved', savedAt: Date.now() - 125000 } })
    expect(el.textContent).toContain('2 分钟前')
  })

  it('error：红 + 「保存失败」+ 「重试」按钮 → 点击 emit retry', () => {
    const onRetry = vi.fn()
    const el = mount({ status: { phase: 'error' } }, { onRetry })
    expect(el.querySelector('.save-ind.is-error')).toBeTruthy()
    expect(el.textContent).toContain('保存失败')
    const btn = el.querySelector('.si-retry')
    expect(btn).toBeTruthy()
    btn.click()
    expect(onRetry).toHaveBeenCalled()
  })
})
