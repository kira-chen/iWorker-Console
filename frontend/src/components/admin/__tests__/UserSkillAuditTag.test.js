// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'

/**
 * UserSkillAuditTag（用户技能审核 · 彩色胶囊标签）—— 2026-10-08 补测（此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/05治理/用户技能审核/prd.用户技能审核.md：
 *   §四.4.1 审核列表「审核状态」：待审核（黄）/ 已通过（绿）/ 已驳回（红）；
 *           「审核尺度」：宽松（绿）/ 通用（蓝）/ 严格（红）；
 *   §二.2.2 检测结果等级：检测通过 绿 / 低风险 中性灰 / 中风险 橙黄 / 高风险 红 / 严重风险 深红。
 *   （状态词按负责人 2026-09-08 裁决全站统一「待审核」，md 4.1 亦为「待审核」。）
 * 覆盖点：三类 kind 的文案与色档 class（usa-tag--<tone>）、data-kind 标记、
 *         边界（空值 → 「—」+ 灰档；未知枚举 → 原样文字 + 灰档）、默认 kind=status。
 * 纯展示组件，无外部依赖，不需要打桩；色值本身由 scoped CSS 承载，jsdom 不算样式，故断言色档 class。
 */
import UserSkillAuditTag from '@/components/admin/UserSkillAuditTag.vue'

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(UserSkillAuditTag, props) })
  app.mount(container)
  return container.querySelector('.usa-tag')
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('审核状态标签（md §4.1）', () => {
  it.each([
    ['PENDING', '待审核', 'yellow'],
    ['APPROVED', '已通过', 'green'],
    ['REJECTED', '已驳回', 'red']
  ])('状态 %s → 文案「%s」、%s 色档', (value, label, tone) => {
    const el = mount({ kind: 'status', value })
    expect(el.textContent).toBe(label)
    expect(el.classList.contains(`usa-tag--${tone}`)).toBe(true)
    expect(el.getAttribute('data-kind')).toBe('status')
  })

  it('不传 kind 时默认按审核状态渲染', () => {
    const el = mount({ value: 'APPROVED' })
    expect(el.getAttribute('data-kind')).toBe('status')
    expect(el.textContent).toBe('已通过')
  })

  it('边界：状态为空 → 显示「—」、灰档兜底', () => {
    const el = mount({ kind: 'status', value: '' })
    expect(el.textContent).toBe('—')
    expect(el.className).toContain('usa-tag--grey')
  })

  it('异常：未知状态值 → 原样显示、灰档兜底（不误上色）', () => {
    const el = mount({ kind: 'status', value: 'WITHDRAWN' })
    expect(el.textContent).toBe('WITHDRAWN')
    expect(el.className).toContain('usa-tag--grey')
  })
})

describe('审核尺度标签（md §4.1）', () => {
  it.each([
    ['宽松', 'green'],
    ['通用', 'blue'],
    ['严格', 'red']
  ])('尺度「%s」→ %s 色档，文字原样', (value, tone) => {
    const el = mount({ kind: 'scale', value })
    expect(el.textContent).toBe(value)
    expect(el.classList.contains(`usa-tag--${tone}`)).toBe(true)
    expect(el.getAttribute('data-kind')).toBe('scale')
  })

  it('边界：尺度为空 → 「—」+ 灰档', () => {
    const el = mount({ kind: 'scale', value: '' })
    expect(el.textContent).toBe('—')
    expect(el.className).toContain('usa-tag--grey')
  })
})

describe('检测结果等级标签（md §2.2）', () => {
  it.each([
    ['检测通过', 'pass'],
    ['低风险', 'low'],
    ['中风险', 'medium'],
    ['高风险', 'high'],
    ['严重风险', 'fatal']
  ])('等级「%s」→ %s 色档（五档各不相同）', (value, tone) => {
    const el = mount({ kind: 'level', value })
    expect(el.textContent).toBe(value)
    expect(el.classList.contains(`usa-tag--${tone}`)).toBe(true)
    expect(el.getAttribute('data-kind')).toBe('level')
  })

  it('异常：旧命名「致命」不在 md 五档内 → 灰档兜底，不冒充严重风险', () => {
    const el = mount({ kind: 'level', value: '致命' })
    expect(el.textContent).toBe('致命')
    expect(el.className).toContain('usa-tag--grey')
    expect(el.className).not.toContain('usa-tag--fatal')
  })

  it('边界：等级为空 → 「—」+ 灰档', () => {
    const el = mount({ kind: 'level', value: '' })
    expect(el.textContent).toBe('—')
    expect(el.className).toContain('usa-tag--grey')
  })
})
