// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import VersionHistoryList from '@/components/admin/VersionHistoryList.vue'

/**
 * 版本历史只读列表（管理侧 §6.6）：
 * - loading / error / empty / 数据行 四态渲染；
 * - ACTIVE 行给「下线」按钮 → emit delist(row)；DELISTED 行给「恢复」→ emit relist(row)；
 * - busyVersion 非空时其它行按钮禁用（防并发）。
 */
const stubs = {
  'el-skeleton': { template: '<div class="el-skeleton" />' },
  'el-button': {
    props: ['loading', 'disabled'],
    emits: ['click'],
    template:
      '<button class="el-button" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>'
  },
  StatusTag: { template: '<span class="status-tag"><slot /></span>' }
}

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const events = { delist: [], relist: [], retry: [] }
  app = createApp({
    render: () =>
      h(VersionHistoryList, {
        ...props,
        onDelist: (r) => events.delist.push(r),
        onRelist: (r) => events.relist.push(r),
        onRetry: () => events.retry.push(true)
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

const ROWS = [
  { version: 3, sizeBytes: 204831, contentHash: 'abcdef0123456789', status: 'ACTIVE', publishedBy: 'sys', publishedAt: '2026-07-05T14:20:00+08:00' },
  { version: 2, sizeBytes: 198002, contentHash: 'ffee', status: 'DELISTED', publishedAt: '2026-07-02T09:10:00+08:00', delistedAt: '2026-07-05T14:25:00+08:00' }
]

describe('VersionHistoryList（管理侧版本历史）', () => {
  it('loading 态渲染骨架，不渲染行', () => {
    const { container } = mount({ loading: true, rows: [] })
    expect(container.querySelector('.el-skeleton')).toBeTruthy()
    expect(container.querySelectorAll('.vhl-row').length).toBe(0)
  })

  it('error 态渲染错误文案 + 重试按钮 → emit retry', () => {
    const { container, events } = mount({ error: '加载失败', rows: [] })
    expect(container.textContent).toContain('加载失败')
    container.querySelector('.vhl-error .el-button').click()
    expect(events.retry.length).toBe(1)
  })

  it('空态渲染提示', () => {
    const { container } = mount({ rows: [] })
    expect(container.querySelector('.vhl-empty')).toBeTruthy()
  })

  it('数据行：ACTIVE 给下线、DELISTED 给恢复；含大小/时间元信息', () => {
    const { container } = mount({ rows: ROWS, showHash: true })
    const rows = container.querySelectorAll('.vhl-row')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('v3')
    expect(rows[0].textContent).toContain('可下载')
    expect(rows[0].querySelector('.el-button').textContent).toContain('下线')
    expect(rows[1].textContent).toContain('已下线')
    expect(rows[1].querySelector('.el-button').textContent).toContain('恢复')
    // 元信息
    expect(rows[0].textContent).toContain('大小')
    expect(rows[0].textContent).toContain('指纹')
  })

  it('点下线 → emit delist(row)；点恢复 → emit relist(row)', () => {
    const { container, events } = mount({ rows: ROWS })
    container.querySelectorAll('.vhl-row')[0].querySelector('.el-button').click()
    expect(events.delist.length).toBe(1)
    expect(events.delist[0].version).toBe(3)
    container.querySelectorAll('.vhl-row')[1].querySelector('.el-button').click()
    expect(events.relist.length).toBe(1)
    expect(events.relist[0].version).toBe(2)
  })

  it('busyVersion 非空：非当前行按钮禁用（防并发）', () => {
    const { container } = mount({ rows: ROWS, busyVersion: 3 })
    const btns = container.querySelectorAll('.vhl-row .el-button')
    // 第二行（v2，非 busy 行）应被禁用
    expect(btns[1].disabled).toBe(true)
  })

  // 2026-09-01 岗位 PRD 对齐新增：最后一个启用版本禁用置灰 + title 提示（默认关，不影响技能/专家）
  it('guardLastActive：仅剩 1 个 ACTIVE 行时其停用按钮置灰并带 title 提示；默认关不置灰', () => {
    const tip = '当前版本是该岗位最后一个启用版本。如需停止对外提供，请先整体下架岗位。'
    const rows = [
      { version: 3, status: 'ACTIVE', publishedAt: '2026-07-05T14:20:00+08:00' },
      { version: 2, status: 'DELISTED', publishedAt: '2026-07-02T09:10:00+08:00' }
    ]
    const guarded = mount({ rows, guardLastActive: true, lastActiveTip: tip })
    const guardBtn = guarded.container.querySelectorAll('.vhl-row')[0].querySelector('.el-button')
    expect(guardBtn.disabled).toBe(true)
    expect(guardBtn.getAttribute('title')).toBe(tip)
    guardBtn.click()
    expect(guarded.events.delist.length).toBe(0) // 置灰后不再上抛
    app.unmount(); container.remove()
    // 默认关（技能/专家现状）：同样只剩一个 ACTIVE 也不置灰
    const off = mount({ rows })
    expect(off.container.querySelectorAll('.vhl-row')[0].querySelector('.el-button').disabled).toBe(false)
  })

  it('guardLastActive：存在 2 个 ACTIVE 行时不置灰（还够互斥切换）', () => {
    const rows = [
      { version: 3, status: 'ACTIVE', publishedAt: '2026-07-05T14:20:00+08:00' },
      { version: 2, status: 'ACTIVE', publishedAt: '2026-07-02T09:10:00+08:00' }
    ]
    const { container } = mount({ rows, guardLastActive: true, lastActiveTip: 'tip' })
    const btns = container.querySelectorAll('.vhl-row .el-button')
    expect(btns[0].disabled).toBe(false)
    expect(btns[1].disabled).toBe(false)
  })
})
