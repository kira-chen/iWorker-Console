// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listSampleTasks,
  getSampleTask,
  createSampleTask,
  updateSampleTask,
  reorderSampleTasks,
  deleteSampleTask,
  setSampleTaskStatus,
  previewSampleSchedule,
  testRunSampleTask,
  summarizeSchedule,
  computeNextRunTimes,
  __resetSampleTaskMock
} from '../sampleTaskMock'

beforeEach(() => __resetSampleTaskMock())

const validPayload = (over = {}) => ({
  name: '竞品周报采集',
  prompt: '每周采集竞品动态并输出周报',
  schedule: { scheduleType: 'DAILY', times: ['10:00'] },
  sopDoc: '# SOP\n\n1. 搜集\n2. 汇总\n',
  toolRefs: [{ type: 'API', code: 'api__search', bizName: '联网搜索 API' }],
  skillRefs: [],
  ...over
})

describe('sampleTaskMock · 样例定时任务（2026-09-02 岗位工作台补 mock）', () => {
  it('种子与岗位同源：401 两条（含 scheduleSummary/toolRefs/skillRefs），403/404 空态', async () => {
    const p401 = await listSampleTasks(401)
    expect(p401.total).toBe(2)
    expect(p401.list[0]).toMatchObject({ name: '每日经营晨报', scheduleSummary: '每天 08:30' })
    expect(p401.list[0].skillRefs[0]).toMatchObject({ platformSkillId: 'sk_302' })
    expect(p401.list[1].scheduleSummary).toBe('每周一 09:00')
    expect((await listSampleTasks(404)).list).toEqual([])
  })

  it('新建/编辑校验与回显：缺名/缺 SOP 被拦（field 定位），成功回 VO 含摘要', async () => {
    await expect(createSampleTask(404, validPayload({ name: '' }))).rejects.toMatchObject({ field: 'name' })
    await expect(createSampleTask(404, validPayload({ sopDoc: ' ' }))).rejects.toMatchObject({ field: 'sopDoc' })
    const vo = await createSampleTask(404, validPayload())
    expect(vo).toMatchObject({ name: '竞品周报采集', status: 'ENABLED', scheduleSummary: '每天 10:00', sortOrder: 0 })
    const upd = await updateSampleTask(404, vo.id, validPayload({ name: '竞品日报采集', schedule: { scheduleType: 'WEEKLY', times: ['09:30'], daysOfWeek: [1, 3] } }))
    expect(upd.scheduleSummary).toBe('每周一、三 09:30')
    expect((await getSampleTask(404, vo.id)).name).toBe('竞品日报采集')
  })

  it('排序：orderedIds 生效；集合不一致 409', async () => {
    const before = (await listSampleTasks(401)).list
    await reorderSampleTasks(401, [before[1].id, before[0].id])
    const after = (await listSampleTasks(401)).list
    expect(after.map((s) => s.id)).toEqual([before[1].id, before[0].id])
    await expect(reorderSampleTasks(401, [before[0].id])).rejects.toMatchObject({ code: 409 })
  })

  it('删除与启停', async () => {
    const { list } = await listSampleTasks(401)
    await setSampleTaskStatus(401, list[0].id, 'DISABLED')
    expect((await getSampleTask(401, list[0].id)).status).toBe('DISABLED')
    await deleteSampleTask(401, list[0].id)
    expect((await listSampleTasks(401)).total).toBe(1)
    await expect(deleteSampleTask(401, list[0].id)).rejects.toThrow('不存在')
  })

  it('调度预览：summary 人话 + 未来触发时间条数正确；ONCE 缺时间被拦', async () => {
    const daily = await previewSampleSchedule(401, { schedule: { scheduleType: 'DAILY', times: ['09:00'] }, count: 3 })
    expect(daily.summary).toBe('每天 09:00')
    expect(daily.nextRunTimes).toHaveLength(3)
    daily.nextRunTimes.forEach((t) => expect(t).toMatch(/^\d{4}-\d{2}-\d{2} 09:00$/))
    await expect(previewSampleSchedule(401, { schedule: { scheduleType: 'ONCE', onceAt: '' } })).rejects.toMatchObject({ field: 'schedule' })
  })

  it('summarize/computeNextRunTimes 纯函数口径（MONTHLY / ONCE）', () => {
    expect(summarizeSchedule({ scheduleType: 'MONTHLY', times: ['08:00'], daysOfMonth: [1, 15] })).toBe('每月 1、15 日 08:00')
    expect(summarizeSchedule({ scheduleType: 'ONCE', onceAt: '2027-01-01T09:00' })).toBe('2027-01-01 09:00 执行一次')
    expect(computeNextRunTimes({ scheduleType: 'ONCE', onceAt: '2027-01-01T09:00' })).toEqual(['2027-01-01 09:00'])
  })

  it('试跑（demo 拟真）：回 AttemptResult 口径（success + steps 含模拟工具步）', async () => {
    const { list } = await listSampleTasks(401)
    const r = await testRunSampleTask(401, list[0].id)
    expect(r.success).toBe(true)
    expect(r.steps.some((s) => s.simulated)).toBe(true)
    expect(r.resultSummary).toContain('模拟执行')
  })
})
