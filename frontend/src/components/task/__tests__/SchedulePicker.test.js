// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createApp, h, ref } from 'vue'
import SchedulePicker from '@/components/task/SchedulePicker.vue'

/**
 * S6：定时任务周期选择器「每月」日期去掉「月末 LAST」选项——后端发布门已拒月末，前端只提供具体日期。
 * 断言：MONTHLY 型下渲染的日期选项恰为 1..31，无「月末」/无 value=LAST。
 */

// 轻量 EP 存根：只保留结构 + 把 el-option 的 label/value 落到 data 属性供断言。
const stubs = {
  'el-radio-group': { template: '<div class="el-radio-group"><slot /></div>' },
  'el-radio-button': { props: ['value'], template: '<button class="el-radio-button" :data-value="value"><slot /></button>' },
  'el-checkbox-group': { template: '<div><slot /></div>' },
  'el-checkbox-button': { props: ['value'], template: '<button :data-value="value"><slot /></button>' },
  'el-select': { template: '<div class="el-select"><slot /></div>' },
  'el-option': {
    props: ['label', 'value'],
    template: '<div class="el-option" :data-label="label" :data-value="value"></div>'
  },
  'el-date-picker': { template: '<div class="el-date-picker"></div>' },
  'el-time-picker': { template: '<div class="el-time-picker"></div>' },
  'el-button': { template: '<button class="el-button"><slot /></button>' },
  'el-icon': { template: '<i><slot /></i>' },
  MagicStick: { template: '<i />' },
  Close: { template: '<i />' },
  Plus: { template: '<i />' }
}

function mount(scheduleType) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const schedule = ref({ scheduleType, daysOfMonth: [], daysOfWeek: [], times: ['09:00'] })
  const app = createApp({
    render: () =>
      h(SchedulePicker, { schedule: schedule.value, 'onUpdate:schedule': (v) => (schedule.value = v) })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  return { container, app }
}

describe('SchedulePicker · S6 去「月末」选项', () => {
  it('每月日期选项集合恰为 1..31（真正护栏：无月末/无游离值）', () => {
    const { container, app } = mount('MONTHLY')
    const opts = [...container.querySelectorAll('.el-option')]
    // 真断言：把渲染出的选项 value 集合与期望 1..31 逐一比对，多一个/少一个/错一个都挂。
    const values = opts.map((o) => Number(o.getAttribute('data-value')))
    const expected = Array.from({ length: 31 }, (_, i) => i + 1)
    expect(values).toEqual(expected)
    // 兜底：无任何「月末」文案，且无 value=LAST 的历史选项残留。
    expect(container.textContent).not.toContain('月末')
    expect(opts.some((o) => o.getAttribute('data-value') === 'LAST')).toBe(false)
    app.unmount()
    container.remove()
  })
})
