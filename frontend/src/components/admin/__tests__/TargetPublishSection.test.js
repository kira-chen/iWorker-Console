// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * TargetPublishSection（发布目标行 + 提交区共享组件）行为契约（批量补测，2026-08-08）。
 *
 * 连接器发布抽屉复用本组件承载「两目标当前态 + 启停操作 + 提交发布多选」。钉住：
 *  1. 可提交目标筛选：只有 actions 含 'publish' 的目标进勾选区（已发布/审核中的目标不该出现在提交区）；
 *  2. 勾选区顺序按 TARGETS 固定序（避免两次打开顺序抖动）；
 *  3. 提交/启停动作原样上抛父级（本组件不持发布态、不调 API——职责边界）；
 *  4. busy 态全段禁用（防重复提交/并发写）；
 *  5. submitDisabled + 原因 tooltip：禁用时必须能复述原因，别让用户对着灰按钮猜；
 *  6. 驳回意见展示：带 rejectComment 的目标要显示原因（作者据此修改后重提）。
 */

vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', props: ['type'], setup: (p, { slots }) => () => h('span', { class: 'stub-status' }, slots.default?.()) }
}))

import TargetPublishSection from '@/components/admin/TargetPublishSection.vue'
import { TARGETS } from '@/utils/marketMeta'

const stubs = {
  'el-checkbox-group': {
    props: ['modelValue', 'disabled'],
    template: '<div class="stub-cbgroup" :data-disabled="disabled ? 1 : 0"><slot /></div>'
  },
  'el-checkbox': { props: ['value', 'label', 'disabled'], template: '<label class="stub-cb" :data-label="value ?? label"><slot /></label>' },
  'el-button': {
    props: ['disabled', 'loading', 'type'],
    emits: ['click'],
    template: '<button class="stub-btn" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-tooltip': { props: ['content'], template: '<div class="stub-tip" :data-content="content"><slot /></div>' },
  'el-alert': { props: ['title'], template: '<div class="stub-alert"><slot />{{ title }}</div>' },
  'el-icon': { template: '<i><slot /></i>' }
}

const statusTagType = () => 'info'
const statusLabel = (s) => `L:${s}`
const ACTION_META = {
  withdraw: { btn: '撤回', btnType: 'default' },
  delist: { btn: '下架', btnType: 'danger' },
  relist: { btn: '重新上架', btnType: 'primary' }
}

let app, container, emitted

function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  emitted = { submit: [], action: [] }
  app = createApp({
    render: () =>
      h(TargetPublishSection, {
        targetRows: [],
        statusTagType,
        statusLabel,
        actionMeta: ACTION_META,
        checked: [],
        onSubmit: (p) => emitted.submit.push(p),
        onAction: (p) => emitted.action.push(p),
        'onUpdate:checked': () => {},
        ...props
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.config.warnHandler = () => {}
  app.mount(container)
  return container
}

const row = (over) => ({ target: TARGETS[0], label: 'T', status: 'NONE', actions: [], rejectComment: '', ...over })
const submitBtn = (el) => [...el.querySelectorAll('.stub-btn')].find((b) => b.textContent.includes('提交'))

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('TargetPublishSection · 发布区共享组件契约', () => {
  it('只有 actions 含 publish 的目标进勾选区', async () => {
    const el = mount({
      targetRows: [
        row({ target: TARGETS[0], actions: ['publish'] }),
        row({ target: TARGETS[1], status: 'PUBLISHED', actions: ['delist'] })
      ]
    })
    await nextTick()
    const labels = [...el.querySelectorAll('.stub-cb')].map((c) => c.dataset.label)
    expect(labels).toEqual([TARGETS[0]])
  })

  it('勾选区按 TARGETS 固定顺序渲染（与 targetRows 传入序无关）', async () => {
    const el = mount({
      targetRows: [
        row({ target: TARGETS[1], actions: ['publish'] }),
        row({ target: TARGETS[0], actions: ['publish'] })
      ]
    })
    await nextTick()
    const labels = [...el.querySelectorAll('.stub-cb')].map((c) => c.dataset.label)
    expect(labels).toEqual([...TARGETS])
  })

  it('点「提交发布」→ 原样上抛当前勾选集合（本组件不调 API）', async () => {
    const el = mount({
      targetRows: [row({ target: TARGETS[0], actions: ['publish'] })],
      checked: [TARGETS[0]]
    })
    await nextTick()
    submitBtn(el).click()
    expect(emitted.submit).toEqual([[TARGETS[0]]])
  })

  it('启停动作 → 上抛 { action, row } 交父级分流端点', async () => {
    const r = row({ target: TARGETS[0], status: 'PUBLISHED', actions: ['delist'] })
    const el = mount({ targetRows: [r] })
    await nextTick()
    const btn = [...el.querySelectorAll('.stub-btn')].find((b) => b.textContent.includes('下架'))
    expect(btn).toBeTruthy()
    btn.click()
    expect(emitted.action).toHaveLength(1)
    expect(emitted.action[0].action).toBe('delist')
    expect(emitted.action[0].row.target).toBe(TARGETS[0])
  })

  it('busy 态：全部按钮禁用（防重复提交/并发写）', async () => {
    const el = mount({
      targetRows: [row({ target: TARGETS[0], status: 'PUBLISHED', actions: ['delist'] })],
      busy: true
    })
    await nextTick()
    const btns = [...el.querySelectorAll('.stub-btn')]
    expect(btns.length).toBeGreaterThan(0)
    expect(btns.every((b) => b.disabled)).toBe(true)
  })

  it('submitDisabled + 原因：提交按钮禁用且以 tooltip 复述原因', async () => {
    const el = mount({
      targetRows: [row({ target: TARGETS[0], actions: ['publish'] })],
      checked: [TARGETS[0]],
      submitDisabled: true,
      submitDisabledReason: '版本号已到 v999 上限'
    })
    await nextTick()
    expect(submitBtn(el).disabled).toBe(true)
    const tip = [...el.querySelectorAll('.stub-tip')].find((t) => t.dataset.content?.includes('v999'))
    expect(tip, '禁用原因须能被用户看到').toBeTruthy()
  })

  it('驳回意见：带 rejectComment 的目标展示原因', async () => {
    const el = mount({
      targetRows: [row({ target: TARGETS[0], status: 'REJECTED', actions: ['publish'], rejectComment: '描述不清' })]
    })
    await nextTick()
    expect(el.textContent).toContain('描述不清')
  })

  it('无可提交目标 → 不渲染勾选项，但目标行本身仍在（否定断言配正向锚点，防组件整体失效时假绿）', async () => {
    const el = mount({
      targetRows: [row({ target: TARGETS[0], status: 'PUBLISHED', actions: ['delist'] })]
    })
    await nextTick()
    expect(el.querySelectorAll('.stub-cb')).toHaveLength(0)
    // 正向锚点：组件确实渲染了该目标行与其启停操作——否则「勾选项为 0」只是因为组件没渲染任何东西
    expect(el.textContent).toContain(statusLabel('PUBLISHED'))
    expect([...el.querySelectorAll('.stub-btn')].some((b) => b.textContent.includes('下架'))).toBe(true)
  })
})
