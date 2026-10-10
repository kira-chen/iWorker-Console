// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ListStates from '@/components/admin/ListStates.vue'
import { elEmpty } from '@/views/admin/__tests__/helpers/commonStubs'

/**
 * ListStates（列表页统一的失败 / 空态呈现）契约。
 *
 * 2026-10-09 待办 yuepu#74：md 多处要求「加载失败展示原因和重试」，ListStates 新增 errorMessage 入参——
 * 为空只显示「加载失败」+【重试】，非空在其下追加原因（.ls-error-reason）。
 * 另守：失败优先于空态（取数失败不得显示「还没有数据」）、重试点击回吐 retry、空态主 / 副文案、有数据时渲染默认插槽。
 */

let app, host
function mount(props = {}, emitted = []) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () =>
      h(ListStates, { ...props, onRetry: () => emitted.push('retry') }, { default: () => h('div', { class: 'real-table' }, '表格内容') })
  })
  app.component('el-empty', elEmpty)
  app.component('el-button', { emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' })
  app.mount(host)
  return nextTick()
}
afterEach(() => {
  app?.unmount()
  host?.remove()
})

const reason = () => host.querySelector('.ls-error-reason')

describe('ListStates · 失败态与失败原因（yuepu#74）', () => {
  it('error 且 errorMessage 为空 → 只有「加载失败」+【重试】，不渲染原因节点', async () => {
    await mount({ error: true, errorMessage: '' })
    expect(host.textContent).toContain('加载失败')
    expect(reason()).toBeNull()
    expect([...host.querySelectorAll('.el-button')].map((b) => b.textContent.trim())).toEqual(['重试'])
  })

  it('error 且 errorMessage 非空 → 「加载失败」下方展示该原因文案，【重试】仍在', async () => {
    await mount({ error: true, errorMessage: '服务暂不可用（503）' })
    expect(host.textContent).toContain('加载失败')
    expect(reason().textContent).toBe('服务暂不可用（503）')
    expect(host.querySelector('[data-testid="list-error-reason"]')).toBe(reason())
    expect(host.querySelector('.el-button').textContent.trim()).toBe('重试')
  })

  it('点【重试】→ 回吐 retry', async () => {
    const emitted = []
    await mount({ error: true, errorMessage: 'x' }, emitted)
    host.querySelector('.el-button').click()
    expect(emitted).toEqual(['retry'])
  })

  it('失败优先于空态：error 与 empty 同时为真，只出失败态，不出「还没有数据」', async () => {
    await mount({ error: true, empty: true, emptyText: '还没有角色' })
    expect(host.textContent).toContain('加载失败')
    expect(host.querySelector('.ls-empty')).toBeNull()
  })

  it('error=false 时即使传了 errorMessage 也不渲染原因', async () => {
    await mount({ error: false, errorMessage: '不该出现' })
    expect(reason()).toBeNull()
    expect(host.textContent).not.toContain('不该出现')
  })
})

describe('ListStates · 空态与默认插槽', () => {
  it('empty → 渲染主文案；带 emptySubText 时追加副文案；不渲染插槽内容', async () => {
    await mount({ empty: true, emptyText: '没有符合条件的角色', emptySubText: '换个关键词试试' })
    expect(host.querySelector('.ls-empty-text').textContent).toBe('没有符合条件的角色')
    expect(host.querySelector('.ls-subtext').textContent).toBe('换个关键词试试')
    expect(host.querySelector('.real-table')).toBeNull()
  })

  it('既不失败也不空 → 渲染默认插槽（表格）', async () => {
    await mount({})
    expect(host.querySelector('.real-table').textContent).toBe('表格内容')
    expect(host.querySelector('.ls-empty')).toBeNull()
  })
})
