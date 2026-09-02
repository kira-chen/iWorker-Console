// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import ReferencedToolsPanel from '@/components/position/ReferencedToolsPanel.vue'

/**
 * §12.7：已引用分区从 .ed-meta 迁入 ToolDock 顶部。本组件纯展示 + emit（定位/移除由父级执行）。
 * 验证：渲染白名单(bizName/code + 健康点 + 写类⚠ + 未知?)、点击行 emit locate、点 × emit remove-ref、空态。
 */
const stubs = {
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  // 断链/失效说明改为角标悬浮提示（2026-07-08）：stub 透传 content 为 title 供断言
  'el-tooltip': {
    props: { content: { type: String, default: '' } },
    template: '<span class="el-tooltip-stub" :title="content"><slot /></span>'
  }
}

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const events = { locate: [], remove: [] }
  app = createApp({
    render: () =>
      h(ReferencedToolsPanel, {
        ...props,
        onLocate: (r) => events.locate.push(r),
        'onRemove-ref': (r) => events.remove.push(r)
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return { container, events }
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

const VIEW = [
  { code: 'biz__a', count: 2, checkStatus: 'HEALTHY', requiresConfirmation: true, bizName: '工具A', known: true },
  { code: 'mcp__b', count: 1, checkStatus: 'UNKNOWN', requiresConfirmation: false, bizName: '', known: false }
]

describe('ReferencedToolsPanel（§12.7）', () => {
  it('渲染已引用白名单：bizName 优先、未知项回落 code + 「用不了」醒目提示 + 写类 ⚠ + 次数', () => {
    const { container } = mount({ referencedView: VIEW })
    const rows = container.querySelectorAll('.ref-row')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('工具A') // bizName 优先
    expect(rows[0].textContent).toContain('⚠') // 写类
    expect(rows[0].textContent).toContain('×2') // 次数
    expect(rows[1].textContent).toContain('mcp__b') // 无 bizName 回落 code
    // 组④：known=false → 「用不了」角标 + 行级强调；具体说明收敛为角标悬浮提示（无独立说明行）
    expect(rows[1].classList.contains('ref-row--error')).toBe(true)
    expect(rows[1].textContent).toContain('用不了')
    expect(container.querySelector('.ref-alert')).toBeNull()
    expect(
      rows[1].querySelector('.el-tooltip-stub[title]')?.getAttribute('title')
    ).toContain('它不会被算进')
  })

  it('组④：DISABLED/UNHEALTHY → 降级提示（黄）；HEALTHY → 无告警', () => {
    const { container } = mount({
      referencedView: [
        { code: 'a', count: 1, checkStatus: 'DISABLED', known: true, bizName: '已停用工具' },
        { code: 'b', count: 1, checkStatus: 'UNHEALTHY', known: true, bizName: '异常工具' },
        { code: 'c', count: 1, checkStatus: 'HEALTHY', known: true, bizName: '正常工具' }
      ]
    })
    const rows = container.querySelectorAll('.ref-row')
    expect(rows[0].classList.contains('ref-row--warn')).toBe(true) // DISABLED
    expect(rows[1].classList.contains('ref-row--warn')).toBe(true) // UNHEALTHY
    expect(rows[2].classList.contains('ref-row--warn')).toBe(false) // HEALTHY 无告警
    expect(rows[2].classList.contains('ref-row--error')).toBe(false)
    // 说明行已收敛为角标悬浮提示：两个降级行各有一个带 title 的角标，无独立说明行
    expect(container.querySelectorAll('.ref-badge--warn').length).toBe(2)
    expect(container.querySelector('.ref-alert')).toBeNull()
  })

  it('点击行 → emit locate(ref)（定位交父级 scrollToTool）', () => {
    const { container, events } = mount({ referencedView: VIEW })
    container.querySelector('.ref-row').click()
    expect(events.locate.length).toBe(1)
    expect(events.locate[0].code).toBe('biz__a')
  })

  it('点 × → emit remove-ref(ref)（移除交父级改 skillMd），不触发行 locate', () => {
    const { container, events } = mount({ referencedView: VIEW })
    container.querySelector('.ref-row .ref-x').click()
    expect(events.remove.length).toBe(1)
    expect(events.remove[0].code).toBe('biz__a')
    expect(events.locate.length).toBe(0) // @click.stop 阻止冒泡
  })

  it('空态：无引用 → 显空提示、无行', () => {
    const { container } = mount({ referencedView: [] })
    expect(container.querySelector('.ref-empty')).toBeTruthy()
    expect(container.querySelectorAll('.ref-row').length).toBe(0)
  })
})
