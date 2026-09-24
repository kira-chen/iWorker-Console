/**
 * 「按周期」模式的 5 个固定周期预设（md 岗位 §7.3 L393），SchedulePicker 与自动化任务编辑 / mock 共用。
 *
 * inferPeriodicPreset：旧数据（如自动化任务种子）只有 scheduleType + daysOfWeek / daysOfMonth、没有
 * periodicPreset 字段，各处原先一律 `|| 'DAILY'` 兜底——周度 / 月度任务在选择器里被高亮成「每天」，
 * 再点「每天」因值相同直接无反应（2026-09-18 待办 yuepu#13·岗位 P1）。改为按调度形态反推预设；
 * 反推不出（如每月 25 日、每周二这类不在五个固定周期内的旧数据）返回 null——选择器不高亮任何预设，
 * 也不再伪装成「每天」。
 */
export const PERIODIC_PRESETS = [
  { value: 'DAILY',              label: '每天',       scheduleType: 'DAILY',   daysOfWeek: [],        daysOfMonth: [] },
  { value: 'WEEKLY_MON',         label: '每周一',     scheduleType: 'WEEKLY',  daysOfWeek: [1],       daysOfMonth: [] },
  { value: 'WEEKLY_MON_WED_FRI', label: '每周一三五', scheduleType: 'WEEKLY',  daysOfWeek: [1, 3, 5], daysOfMonth: [] },
  { value: 'WEEKLY_FRI',         label: '每周五',     scheduleType: 'WEEKLY',  daysOfWeek: [5],       daysOfMonth: [] },
  { value: 'MONTHLY_1',          label: '每月1日',    scheduleType: 'MONTHLY', daysOfWeek: [],        daysOfMonth: [1] }
]

const sameSet = (a = [], b = []) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

export function inferPeriodicPreset(schedule = {}) {
  if (schedule.periodicPreset) return schedule.periodicPreset
  const type = schedule.scheduleType || 'DAILY'
  const hit = PERIODIC_PRESETS.find(
    (p) =>
      p.scheduleType === type &&
      sameSet(p.daysOfWeek, schedule.daysOfWeek || []) &&
      sameSet(p.daysOfMonth, schedule.daysOfMonth || [])
  )
  return hit ? hit.value : null
}
