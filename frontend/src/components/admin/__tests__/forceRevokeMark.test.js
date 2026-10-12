// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'

/**
 * ForceRevokeMark.vue 小单测：审核中心 / 我的申请「申请类型」旁的红色「强制回收」标记。
 * 对齐 PRD 审核中心 §5.2：停用申请勾选了强制回收才出标记；普通停用 / 发布申请（reason 为空）不渲染任何东西。
 * 悬停气泡的文案（「回收原因：…」）是 el-tooltip 的 content 属性，不在 DOM 里，这里用桩 tooltip 把它落到 data-tip 上验证。
 */
const ForceRevokeMark = (await import('@/components/admin/ForceRevokeMark.vue')).default
const tipStub = { props: ['content'], template: '<span class="tip" :data-tip="content"><slot /></span>' }

let app, host
async function mount(props) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(ForceRevokeMark, props) })
  app.use(ElementPlus)
  app.component('ElTooltip', tipStub)
  app.mount(host)
  await nextTick()
}
afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('ForceRevokeMark · 强制回收申请标记', () => {
  it('reason 为空（普通停用 / 发布申请）→ 什么都不渲染', async () => {
    await mount({ reason: '' })
    expect(host.querySelector('.status-tag')).toBeNull()
    expect(host.textContent.trim()).toBe('')
  })

  it('缺省 reason → 同样不渲染', async () => {
    await mount({})
    expect(host.querySelector('.status-tag')).toBeNull()
  })

  it('reason 非空 → 渲染红色「强制回收」标签，悬停内容为「回收原因：…」', async () => {
    await mount({ reason: '接口存在安全风险' })
    const tag = host.querySelector('.status-tag')
    expect(tag.textContent.trim()).toBe('强制回收')
    expect(tag.className).toContain('danger')
    expect(host.querySelector('.tip').dataset.tip).toBe('回收原因：接口存在安全风险')
  })
})
