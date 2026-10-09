// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import RevokedTag from '@/components/admin/RevokedTag.vue'
import RevokedBanner from '@/components/admin/RevokedBanner.vue'

/**
 * RevokedTag / RevokedBanner（2026-10-09 /test-audit 补缺口，E 视角：新增展示组件此前零直接测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/ 各模块「强制回收」小节：
 * - 列表状态列 / 岗位引用行：「未发布」旁红色小标签「已回收」，悬停展示回收原因、操作人和时间；未回收不出；
 * - 编辑 / 查看页顶部红色提示条「该{对象}已于 {时间} 被强制回收：{原因}」；未回收不出。
 *
 * el-tooltip 桩成把 content 暴露成 data 属性的 span（真 tooltip 的内容挂在 body 上，悬停才出），
 * 以便直接断言悬停文案；el-alert 桩成把 title 与 type 暴露出来的 div。
 */
const INFO = { reason: '接口下线', at: '2026-10-09 10:00', operator: 'xiaomei' }
const stubs = {
  'el-tooltip': { props: ['content', 'placement'], template: '<span class="tip" :data-content="content"><slot /></span>' },
  'el-alert': { props: ['title', 'type', 'showIcon', 'closable'], template: '<div class="alert" :data-type="type">{{ title }}</div>' }
}

// 项目未装 @vue/test-utils，照同目录 UserSkillAuditTag.test.js 用 createApp 挂载；返回 { find(selector) -> { exists, text, attributes } }
const apps = []
function mount(Component, { props = {} } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp({ render: () => h(Component, props) })
  for (const [name, def] of Object.entries(stubs)) app.component(name, def)
  app.mount(container)
  apps.push({ app, container })
  return {
    find: (sel) => {
      const el = container.querySelector(sel)
      return { exists: () => !!el, text: () => el?.textContent.trim(), attributes: (k) => el?.getAttribute(k) }
    }
  }
}
afterEach(() => {
  while (apps.length) {
    const { app, container } = apps.pop()
    app.unmount()
    container.remove()
  }
})

describe('RevokedTag · 「已回收」红标签', () => {
  it('有回收信息 → 渲染文案「已回收」，悬停内容为「回收原因：…（操作人 · 时间）」', () => {
    const w = mount(RevokedTag, { props: { info: INFO } })
    expect(w.find('.revoked-tag').text()).toBe('已回收')
    expect(w.find('.tip').attributes('data-content')).toBe('回收原因：接口下线（xiaomei · 2026-10-09 10:00）')
  })

  it('没有回收信息（null / 不传）→ 什么都不渲染', () => {
    expect(mount(RevokedTag, { props: { info: null } }).find('.revoked-tag').exists()).toBe(false)
    expect(mount(RevokedTag).find('.revoked-tag').exists()).toBe(false)
  })
})

describe('RevokedBanner · 编辑 / 查看页顶部提示条', () => {
  it('有回收信息 → 红色错误提示条，文案「该{对象}已于 {时间} 被强制回收：{原因}」', () => {
    const w = mount(RevokedBanner, { props: { label: 'MCP', info: INFO } })
    expect(w.find('.alert').text()).toBe('该MCP已于 2026-10-09 10:00 被强制回收：接口下线')
    expect(w.find('.alert').attributes('data-type')).toBe('error')
  })

  it('对象名随 label 变化（技能 / 专家 / API / 业务系统）', () => {
    for (const label of ['技能', '专家', 'API', '业务系统']) {
      const w = mount(RevokedBanner, { props: { label, info: INFO } })
      expect(w.find('.alert').text()).toContain(`该${label}已于`)
    }
  })

  it('没有回收信息 → 不渲染提示条', () => {
    expect(mount(RevokedBanner, { props: { label: '技能', info: null } }).find('.alert').exists()).toBe(false)
  })
})
