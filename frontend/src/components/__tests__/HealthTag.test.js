// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'

import HealthTag from '@/components/HealthTag.vue'
import { healthLabel, healthClass } from '@/utils/positionModel'

/**
 * HealthTag（工具检活四态徽标）展示口径守卫（批量补测，2026-08-08）。
 *
 * 该徽标在连接器/工具/岗位多处复用，四态文案与类名声明为「全站单一真相」——
 * 组件必须始终复用 positionModel.healthLabel/healthClass，不得就地硬编码另一套映射
 * （硬编码 = 改了工具函数但徽标不变，同一状态在不同页面显示不同文案）。
 *
 * 断言方式刻意与实现同源比对：只要组件私自另起映射，本守卫即翻红。
 */

const STATUSES = ['HEALTHY', 'UNHEALTHY', 'UNKNOWN', 'DISABLED']

let app, container

function mount(status) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(HealthTag, status === undefined ? {} : { status }) })
  app.mount(container)
  return container
}

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('HealthTag · 四态展示口径（单一真相）', () => {
  // 2026-09-12 审计 C3：原只与 healthLabel() 同源比对（工具函数改文案用例也跟着绿），
  // 现钉 md prd-连接器-MCP.md §二.2 L57「连接状态展示"连接正常、连接异常、未探测"」字面；
  // DISABLED「已停用」为公共件四态之一（API 页 / 岗位页仍消费），MCP 列表侧已折回 UNKNOWN（AdminMcp.mcpConnStatus）。
  it.each([
    ['HEALTHY', '连接正常', 'ok'],
    ['UNHEALTHY', '连接异常', 'bad'],
    ['UNKNOWN', '未探测', 'unknown'],
    ['DISABLED', '已停用', 'off']
  ])('%s → 渲染文案「%s」（md MCP §二.2 L57）+ 类名 ht--%s', (status, text, cls) => {
    const el = mount(status)
    const tag = el.querySelector('.health-tag')
    expect(tag).toBeTruthy()
    expect(tag.textContent.trim()).toBe(text)
    expect(tag.classList.contains(`ht--${cls}`)).toBe(true)
    // 仍与 positionModel 同源（组件不得私自另起映射）
    expect(text).toBe(healthLabel(status))
    expect(cls).toBe(healthClass(status))
  })

  it('四态在组件上渲染出两两不同的文案（同状态不可与他态混淆）', () => {
    // 经组件渲染取值（而非直接调工具函数）——后者不碰组件，掏空组件仍会通过，
    // 属归属错位的用例（空组件替换法实测命中，2026-08-08 审视改正）。
    const rendered = STATUSES.map((s) => {
      const el = mount(s)
      const text = el.querySelector('.health-tag').textContent.trim()
      app.unmount()
      container.remove()
      app = null
      return text
    })
    expect(new Set(rendered).size, `四态文案应互不相同，实际：${rendered.join('/')}`).toBe(STATUSES.length)
  })

  it('缺省 status → 按 UNKNOWN（未检测）渲染，不空白', () => {
    const el = mount(undefined)
    const tag = el.querySelector('.health-tag')
    expect(tag.textContent.trim()).toBe(healthLabel('UNKNOWN'))
    expect(tag.textContent.trim()).not.toBe('')
  })

  it('未知/脏状态值 → 仍渲染兜底文案，不抛错不空白', () => {
    const el = mount('SOMETHING_WEIRD')
    const tag = el.querySelector('.health-tag')
    expect(tag).toBeTruthy()
    expect(tag.textContent.trim()).toBe(healthLabel('SOMETHING_WEIRD'))
  })
})
