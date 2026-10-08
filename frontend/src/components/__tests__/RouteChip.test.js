// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import ElementPlus from 'element-plus'

/**
 * RouteChip（效果测试台 AI 回复的「分流弱提示」标签）—— 2026-10-08 补测（此前零测试）。
 * 纯展示组件，无交互行为，只写最少量渲染断言。
 * md 依据：docs/PRD/数字员工管理端PRD/ 下各模块 md 均未描述该标签（检索「快速回答 / 知识问答 / 分流」无命中），
 * 仅在 components/test/EffectTestStage.vue 岗位版回合头使用；故以组件自身契约为准：
 *   route = simple / knowledge / task → 「快速回答 / 知识问答 / 办事」+ 图标 + title 同文案；
 *   空值 / 未知值不渲染（兜底不崩）。
 */
import RouteChip from '@/components/RouteChip.vue'

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(RouteChip, props) })
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.use(ElementPlus)
  app.mount(container)
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('RouteChip 渲染', () => {
  it.each([
    ['simple', '快速回答'],
    ['knowledge', '知识问答'],
    ['task', '办事']
  ])('route=%s → 显示「%s」，带图标与同文案 title', (route, label) => {
    const c = mount({ route })
    const chip = c.querySelector('.route-chip')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('title')).toBe(label)
    expect(chip.querySelector('.route-chip__text').textContent).toBe(label)
    expect(chip.querySelector('.route-chip__icon svg')).toBeTruthy()
  })

  it('边界：route 缺省（空串）→ 不渲染任何标签', () => {
    const c = mount({})
    expect(c.querySelector('.route-chip')).toBeNull()
  })

  it('异常：未知 route 值 → 不渲染、不报错', () => {
    const c = mount({ route: 'unknown' })
    expect(c.querySelector('.route-chip')).toBeNull()
  })
})
