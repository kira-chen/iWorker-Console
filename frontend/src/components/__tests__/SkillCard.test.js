// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import SkillCard from '@/components/position/SkillCard.vue'

/**
 * SkillCard 派生类别徽标回归保护：
 * - skill.category=OPERATION → 渲染「操作类」徽标，StatusTag type=warning（警示色）。
 * - skill.category=QUERY → 渲染「查询类」徽标，StatusTag type=info（中性色）。
 * - 无 category（null/未知）→ 不渲染类别徽标（hasCategory=false）。
 *
 * 文案/tagType 均来自 utils/skillCategory.js（前端单一真相）。此测试防「后端透传了 category
 * 但卡片不渲染」或「徽标文案/语义色与 skillCategory.js 口径偏离」的静默回归。
 *
 * 不引 @vue/test-utils：createApp 挂 jsdom 容器，仅存根 el-tooltip（透传插槽）。
 * StatusTag 用真实组件（SkillCard 内 import，无法被全局存根覆盖）——其语义色以 st--{type}
 * 类落地，故 type=warning → class 含 st--warning、type=info → st--info。
 */

// el-tooltip：透传默认插槽内容即可（包裹徽标）。
const stubs = {
  'el-tooltip': { template: '<div class="el-tooltip"><slot /></div>' }
}

let container
let app

function mount(skill) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SkillCard, { skill }) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return container
}

describe('SkillCard 类别徽标', () => {
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('OPERATION → 渲染「操作类」徽标，语义色 warning(st--warning)', () => {
    const el = mount({ skillId: 1, name: '操作技能', category: 'OPERATION' })
    const tag = el.querySelector('.skill-category')
    expect(tag).toBeTruthy()
    expect(tag.textContent.trim()).toBe('操作类')
    expect(tag.classList.contains('st--warning')).toBe(true)
  })

  it('QUERY → 渲染「查询类」徽标，语义色 info(st--info)', () => {
    const el = mount({ skillId: 2, name: '查询技能', category: 'QUERY' })
    const tag = el.querySelector('.skill-category')
    expect(tag).toBeTruthy()
    expect(tag.textContent.trim()).toBe('查询类')
    expect(tag.classList.contains('st--info')).toBe(true)
  })

  it('无 category → 不渲染类别徽标', () => {
    const el = mount({ skillId: 3, name: '无类别技能', category: null })
    expect(el.querySelector('.skill-category')).toBeNull()
  })
})
