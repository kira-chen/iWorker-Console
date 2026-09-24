// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import SchedulePicker from '@/components/task/SchedulePicker.vue'
import { inferPeriodicPreset } from '@/utils/periodicPreset'

/**
 * SchedulePicker「按周期」预设高亮 / 点击（2026-09-18 待办 yuepu#13·岗位 P1）。
 * 自动化任务种子只有 scheduleType + daysOfWeek / daysOfMonth、没有 periodicPreset：
 * 此前一律按「每天」高亮，且点「每天」因值相同直接无反应。改为按调度形态反推预设。
 */

describe('inferPeriodicPreset（旧数据按调度形态反推周期预设）', () => {
  it('显式 periodicPreset 优先', () => {
    expect(inferPeriodicPreset({ periodicPreset: 'WEEKLY_FRI', scheduleType: 'DAILY' })).toBe('WEEKLY_FRI')
  })
  it('每天 / 周度 / 月度按形态命中五个固定周期之一', () => {
    expect(inferPeriodicPreset({ scheduleType: 'DAILY' })).toBe('DAILY')
    expect(inferPeriodicPreset({})).toBe('DAILY') // scheduleType 缺省视同每天
    expect(inferPeriodicPreset({ scheduleType: 'WEEKLY', daysOfWeek: [1] })).toBe('WEEKLY_MON')
    expect(inferPeriodicPreset({ scheduleType: 'WEEKLY', daysOfWeek: [5, 3, 1] })).toBe('WEEKLY_MON_WED_FRI') // 顺序无关
    expect(inferPeriodicPreset({ scheduleType: 'WEEKLY', daysOfWeek: [5] })).toBe('WEEKLY_FRI')
    expect(inferPeriodicPreset({ scheduleType: 'MONTHLY', daysOfMonth: [1] })).toBe('MONTHLY_1')
  })
  it('不在五个固定周期内（每周二 / 每月 25 日）→ null，不伪装成「每天」', () => {
    expect(inferPeriodicPreset({ scheduleType: 'WEEKLY', daysOfWeek: [2] })).toBeNull()
    expect(inferPeriodicPreset({ scheduleType: 'MONTHLY', daysOfMonth: [25] })).toBeNull()
  })
})

function mountPicker(schedule) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const onUpdate = vi.fn()
  const app = createApp({
    render: () => h(SchedulePicker, { schedule, 'onUpdate:schedule': onUpdate })
  })
  app.component('el-date-picker', { template: '<div class="el-date-picker" />' })
  app.mount(container)
  return { container, onUpdate, unmount: () => { app.unmount(); container.remove() } }
}
const presetBtns = (c) => [...c.querySelectorAll('.sp-seg-preset .sp-seg-btn')]

describe('SchedulePicker · 周期预设', () => {
  it('周度种子（无 periodicPreset）高亮「每周一」而不是「每天」；点「每天」能切换成每天', async () => {
    const { container, onUpdate, unmount } = mountPicker({
      scheduleMode: 'PERIODIC', scheduleType: 'WEEKLY', daysOfWeek: [1], daysOfMonth: [], times: ['09:00']
    })
    await nextTick()
    expect(presetBtns(container).filter((b) => b.classList.contains('on')).map((b) => b.textContent.trim())).toEqual(['每周一'])
    presetBtns(container).find((b) => b.textContent.trim() === '每天').click()
    await nextTick()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ periodicPreset: 'DAILY', scheduleType: 'DAILY', daysOfWeek: [] })
    unmount()
  })

  it('不在固定周期内的旧数据（每月 25 日）不高亮任何预设', async () => {
    const { container, unmount } = mountPicker({
      scheduleMode: 'PERIODIC', scheduleType: 'MONTHLY', daysOfWeek: [], daysOfMonth: [25], times: ['10:00']
    })
    await nextTick()
    expect(presetBtns(container).filter((b) => b.classList.contains('on'))).toHaveLength(0)
    unmount()
  })
})
