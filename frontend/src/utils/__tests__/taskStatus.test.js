import { describe, it, expect } from 'vitest'
import {
  taskStatusMeta,
  execStatusMeta,
  isExecActive,
  isTaskRunning,
  fmtDuration
} from '@/utils/taskStatus'

describe('taskStatusMeta', () => {
  it('映射启用/停用/草稿', () => {
    expect(taskStatusMeta('ENABLED').label).toBe('启用')
    expect(taskStatusMeta('DISABLED').label).toBe('停用')
    expect(taskStatusMeta('DRAFT').label).toBe('草稿')
  })

  it('ONCE 任务跑完(DISABLED+已执行)标「已完成」', () => {
    const task = { scheduleType: 'ONCE', runCount: 1 }
    expect(taskStatusMeta('DISABLED', task).label).toBe('已完成')
  })

  it('ONCE 任务停用但未执行仍为停用', () => {
    const task = { scheduleType: 'ONCE', runCount: 0 }
    expect(taskStatusMeta('DISABLED', task).label).toBe('停用')
  })

  it('非 ONCE 任务停用不误判为已完成', () => {
    const task = { scheduleType: 'DAILY', runCount: 5 }
    expect(taskStatusMeta('DISABLED', task).label).toBe('停用')
  })

  it('未知状态兜底', () => {
    expect(taskStatusMeta('WHATEVER').label).toBe('未知')
  })
})

describe('execStatusMeta', () => {
  it('五种执行状态各有中文徽标', () => {
    expect(execStatusMeta('RUNNING').label).toBe('运行中')
    expect(execStatusMeta('RETRYING').label).toBe('重试中')
    expect(execStatusMeta('SUCCEEDED').label).toBe('成功')
    expect(execStatusMeta('FAILED').label).toBe('失败')
    expect(execStatusMeta('SKIPPED').label).toBe('本次跳过')
  })
})

describe('isExecActive / isTaskRunning', () => {
  it('RUNNING/RETRYING 为活跃态', () => {
    expect(isExecActive('RUNNING')).toBe(true)
    expect(isExecActive('RETRYING')).toBe(true)
    expect(isExecActive('SUCCEEDED')).toBe(false)
    expect(isExecActive('FAILED')).toBe(false)
  })

  it('isTaskRunning 据 lastRunStatus 判定', () => {
    expect(isTaskRunning({ lastRunStatus: 'RUNNING' })).toBe(true)
    expect(isTaskRunning({ lastRunStatus: 'SUCCEEDED' })).toBe(false)
    expect(isTaskRunning({ lastRunStatus: null })).toBe(false)
    expect(isTaskRunning({})).toBe(false)
  })
})

describe('fmtDuration', () => {
  it('null 返回空串', () => {
    expect(fmtDuration(null)).toBe('')
  })
  it('<1s 用 ms', () => {
    expect(fmtDuration(860)).toBe('860ms')
  })
  it('>=1s 用 x.xs', () => {
    expect(fmtDuration(1500)).toBe('1.5s')
  })
})
