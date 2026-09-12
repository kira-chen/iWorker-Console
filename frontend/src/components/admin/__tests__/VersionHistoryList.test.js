// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import VersionHistoryList from '@/components/admin/VersionHistoryList.vue'

/**
 * 版本历史只读列表。2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §四.3 版本历史 L249-257：
 * - loading / error / empty / 数据行 四态渲染（空态文案 L249 逐字；加载失败展示原因和【重试】L257）；
 * - 每条版本展示版本号、状态、文件大小、发布人、发布时间；存在禁用时间或升级说明时一并展示（L250）；
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

  it('尚无版本 → 空态文案「暂无版本 · 发布后将在此生成不可变版本快照」逐字（md L249）', () => {
    const { container } = mount({ rows: [] })
    const empty = container.querySelector('.vhl-empty')
    expect(empty).toBeTruthy()
    expect(empty.textContent.trim()).toBe('暂无版本 · 发布后将在此生成不可变版本快照')
  })

  it('数据行：ACTIVE 给下线、DELISTED 给恢复；含大小/发布人/发布时间/下线于/升级说明（md L250）', () => {
    const rows2 = [
      { ...ROWS[0], releaseNotes: '新增周报模板' },
      ROWS[1]
    ]
    const { container } = mount({ rows: rows2, showHash: true })
    const rows = container.querySelectorAll('.vhl-row')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('v3')
    expect(rows[0].textContent).toContain('可下载')
    expect(rows[0].querySelector('.el-button').textContent).toContain('下线')
    expect(rows[1].textContent).toContain('已下线')
    expect(rows[1].querySelector('.el-button').textContent).toContain('恢复')
    // 元信息：大小 / 指纹 / 发布人 / 发布于
    expect(rows[0].textContent).toContain('大小')
    expect(rows[0].textContent).toContain('指纹')
    expect(rows[0].textContent).toContain('发布人 sys')
    expect(rows[0].textContent).toContain('发布于')
    // 存在升级说明时一并展示；无则不渲染
    expect(rows[0].querySelector('.vhl-notes').textContent).toBe('升级说明：新增周报模板')
    expect(rows[1].querySelector('.vhl-notes')).toBeNull()
    // 存在禁用时间时展示「<delistTerm>于」；ACTIVE 行无 delistedAt 不渲染
    expect(rows[1].querySelector('.vhl-meta-del').textContent).toMatch(/^下线于 /)
    expect(rows[0].querySelector('.vhl-meta-del')).toBeNull()
    // 无发布人的行不渲染「发布人」段
    expect(rows[1].textContent).not.toContain('发布人')
  })

  it('平台技能用词：delistTerm=禁用 / relistTerm=启用 / activeLabel=已启用 → 状态标签、按钮、禁用于 文案随之（md L250/L253）', () => {
    const { container } = mount({ rows: ROWS, delistTerm: '禁用', relistTerm: '启用', activeLabel: '已启用' })
    const rows = container.querySelectorAll('.vhl-row')
    expect(rows[0].querySelector('.status-tag').textContent.trim()).toBe('已启用')
    expect(rows[0].querySelector('.el-button').textContent.trim()).toBe('禁用')
    expect(rows[1].querySelector('.status-tag').textContent.trim()).toBe('已禁用')
    expect(rows[1].querySelector('.el-button').textContent.trim()).toBe('启用')
    expect(rows[1].querySelector('.vhl-meta-del').textContent).toMatch(/^禁用于 /)
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
