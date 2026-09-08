// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * UserSkillAuditDrawer.vue 单测（2026-09-08 PRD-20260908 对齐 · md §五「查看技能」抽屉）。
 *
 * 验：标题「查看技能」；基本信息 6 字段（状态 / 尺度彩色 tag）；SKILL.MD 原样只读、空值「（暂无内容）」；
 * 检测明细「共 4 项」固定顺序（内部名"敏感信息明文凭证"显示"敏感信息"）、每项序号 / 等级 tag / 位置 / 代码块 / 依据、
 * 检测通过依据「未检测到该项相关风险」、卡片按等级上色；底部【关闭】+ 待审核【通过】【驳回】（红底）；
 * 已完成记录只有【关闭】；加载失败可重试。
 */

const getReviewApplication = vi.fn()
vi.mock('@/api/skillReview', () => ({ getReviewApplication: (...a) => getReviewApplication(...a) }))

const Drawer = (await import('@/components/admin/UserSkillAuditDrawer.vue')).default

const elDrawer = {
  name: 'el-drawer',
  props: ['modelValue', 'size'],
  emits: ['update:modelValue'],
  template:
    '<div class="el-drawer" v-if="modelValue" :data-size="size">' +
    '<div class="dr-header"><slot name="header" /></div>' +
    '<div class="dr-body"><slot /></div>' +
    '<div class="dr-footer"><slot name="footer" /></div></div>'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" :data-loading="loading" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elSkeleton = { props: ['rows'], template: '<div class="el-skeleton" />' }

let app, container
const emitted = { approve: vi.fn(), reject: vi.fn(), visible: vi.fn() }
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(Drawer, {
          visible: true,
          reviewId: 'usr_1',
          'onUpdate:visible': emitted.visible,
          onApprove: emitted.approve,
          onReject: emitted.reject,
          ...props
        })
    }
  })
  app.component('el-drawer', elDrawer)
  app.component('el-button', elButton)
  app.component('el-empty', elEmpty)
  app.component('el-skeleton', elSkeleton)
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const footBtns = () => [...container.querySelectorAll('.dr-footer .el-button')]
const footBtn = (t) => footBtns().find((b) => b.textContent.trim() === t)

const PENDING = {
  id: 'usr_1',
  skillName: '自动发送邮件',
  description: '批量向外部邮箱发送邮件',
  submitter: 'zhangsan',
  submittedAt: '2026-09-01T10:23:00+08:00',
  status: 'PENDING',
  scale: '通用',
  skillMd: '## 功能\n\n批量发送。\n\n```yaml\nname: send-email\n```',
  risks: [
    { item: '敏感信息明文凭证', level: '高风险', location: 'send_email.py:7', code: 'SMTP_PASS = "x"', detail: '硬编码口令。' },
    { item: '危险操作', level: '严重风险', location: 'a.py:1', code: 'rm -rf /', detail: '不可逆删除。' }
  ]
}

beforeEach(() => {
  getReviewApplication.mockReset().mockResolvedValue(PENDING)
  Object.values(emitted).forEach((f) => f.mockReset())
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserSkillAuditDrawer（2026-09-08 PRD-20260908 对齐）', () => {
  it('标题「查看技能」、780 宽；按 reviewId 拉详情', async () => {
    await mount()
    expect(container.querySelector('.de-head-title').textContent.trim()).toBe('查看技能')
    expect(container.querySelector('.el-drawer').dataset.size).toBe('780px')
    expect(getReviewApplication).toHaveBeenCalledWith('usr_1')
  })

  it('基本信息 6 字段顺序与值；审核状态 / 审核尺度为彩色 tag（待审核 / 通用）', async () => {
    await mount()
    const labels = [...container.querySelectorAll('.usa-label')].map((l) => l.textContent.trim())
    expect(labels).toEqual(['技能名称', '提交人', '提交时间', '审核状态', '审核尺度', '技能描述'])
    const values = [...container.querySelectorAll('.usa-readonly')].map((v) => v.textContent.trim())
    expect(values).toEqual(['自动发送邮件', 'zhangsan', '2026-09-01 10:23', '待审核', '通用', '批量向外部邮箱发送邮件'])
    const tags = [...container.querySelectorAll('.usa-readonly .usa-tag')]
    expect(tags.map((t) => t.textContent)).toEqual(['待审核', '通用'])
    expect(tags[0].className).toContain('usa-tag--yellow')
    expect(tags[1].className).toContain('usa-tag--blue')
  })

  it('SKILL.MD 原样只读（pre，不渲染 markdown）；空值显「（暂无内容）」', async () => {
    await mount()
    const pre = container.querySelector('pre.usa-skill-md')
    expect(pre.textContent).toBe(PENDING.skillMd)
    expect(container.querySelector('.usa-skill-md h2')).toBeNull()
    app.unmount(); container.remove()
    getReviewApplication.mockResolvedValueOnce({ ...PENDING, skillMd: '' })
    await mount()
    expect(container.querySelector('pre.usa-skill-md').textContent).toBe('（暂无内容）')
  })

  it('检测明细「共 4 项」固定顺序，未命中项为检测通过「未检测到该项相关风险」，命中项带位置 / 代码 / 依据，卡片按等级上色', async () => {
    await mount()
    const titles = [...container.querySelectorAll('.section-title')].map((t) => t.textContent.replace(/\s+/g, ' ').trim())
    expect(titles).toEqual(['基本信息', 'SKILL.MD', '检测明细 共 4 项'])
    const cards = [...container.querySelectorAll('.usa-risk-card')]
    expect(cards).toHaveLength(4)
    expect(cards.map((c) => c.querySelector('.usa-risk-index').textContent)).toEqual(['1', '2', '3', '4'])
    expect(cards.map((c) => c.querySelector('strong').textContent)).toEqual(['对外动作', '敏感信息', '权限范围', '危险操作'])
    expect(container.textContent).not.toContain('敏感信息明文凭证')
    expect(cards.map((c) => c.querySelector('.usa-tag').textContent)).toEqual(['检测通过', '高风险', '检测通过', '严重风险'])
    // 检测通过项：无位置 / 代码，依据固定文案
    expect(cards[0].querySelector('.usa-risk-location')).toBeNull()
    expect(cards[0].querySelector('.usa-risk-code')).toBeNull()
    expect(cards[0].querySelector('.usa-risk-reason').textContent).toBe('未检测到该项相关风险')
    expect(cards[0].className).toContain('is-pass')
    // 命中项
    expect(cards[1].querySelector('.usa-risk-location').textContent).toBe('位置：send_email.py:7')
    expect(cards[1].querySelector('.usa-risk-code').textContent).toBe('SMTP_PASS = "x"')
    expect(cards[1].querySelector('.usa-risk-reason').textContent).toBe('硬编码口令。')
    expect(cards[1].className).toContain('is-high')
    expect(cards[1].querySelector('.usa-tag').className).toContain('usa-tag--high')
    expect(cards[3].className).toContain('is-fatal')
    expect(cards[3].querySelector('.usa-tag').className).toContain('usa-tag--fatal')
  })

  it('待审核：底部 关闭 / 通过 / 驳回（红底主按钮）；通过 / 驳回 事件带行数据；关闭 emit visible=false', async () => {
    await mount()
    expect(footBtns().map((b) => b.textContent.trim())).toEqual(['关闭', '通过', '驳回'])
    expect(footBtn('驳回').dataset.type).toBe('danger')
    footBtn('通过').click()
    expect(emitted.approve).toHaveBeenCalledWith(expect.objectContaining({ id: 'usr_1', skillName: '自动发送邮件' }))
    footBtn('驳回').click()
    expect(emitted.reject).toHaveBeenCalledWith(expect.objectContaining({ id: 'usr_1' }))
    footBtn('关闭').click()
    expect(emitted.visible).toHaveBeenCalledWith(false)
  })

  it('已完成记录：只有【关闭】；busyKey 时对应按钮转圈', async () => {
    getReviewApplication.mockResolvedValueOnce({ ...PENDING, status: 'APPROVED' })
    await mount()
    expect(footBtns().map((b) => b.textContent.trim())).toEqual(['关闭'])
    app.unmount(); container.remove()
    await mount({ busyKey: 'reject' })
    expect(footBtn('驳回').dataset.loading).toBe('true')
    expect(footBtn('通过').disabled).toBe(true)
  })

  it('加载失败 → 失败态 + 重试重拉', async () => {
    getReviewApplication.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    getReviewApplication.mockResolvedValueOnce(PENDING)
    ;[...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('重试')).click()
    await flush()
    expect(container.querySelector('.usa-risk-card')).toBeTruthy()
  })
})
