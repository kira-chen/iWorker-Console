// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('sampleTaskMock · 自动化任务（2026-09-02 岗位工作台补 mock；c40c606 三模式+preKick，persist v4；md 岗位 §7）', () => {
  // 2026-09-09：404 市场研究岗补全为「未发布 + 六项齐备」样本后不再是空态，空态样本改用 403。
  it('种子与岗位同源：401 八条 / 404 一条（含 scheduleSummary/toolRefs/skillRefs），403 空态', async () => {
    const p401 = await listSampleTasks(401)
    expect(p401.total).toBe(8)
    expect(p401.list[0]).toMatchObject({ name: '每日经营晨报', scheduleSummary: '每天 08:30' })
    expect(p401.list[0].skillRefs[0]).toMatchObject({ platformSkillId: 'sk_302' })
    expect(p401.list[1].scheduleSummary).toBe('每周一 09:00')
    const p404 = await listSampleTasks(404)
    expect(p404.total).toBe(1)
    expect(p404.list[0]).toMatchObject({ name: '每周竞品动态汇总', scheduleSummary: '每周一 09:00' })
    expect((await listSampleTasks(403)).list).toEqual([])
  })

  it('新建/编辑校验与回显：缺名/缺 SOP 被拦（field 定位），成功回 VO 含摘要', async () => {
    await expect(createSampleTask(404, validPayload({ name: '' }))).rejects.toMatchObject({ field: 'name' })
    await expect(createSampleTask(404, validPayload({ sopDoc: ' ' }))).rejects.toMatchObject({ field: 'sopDoc' })
    const vo = await createSampleTask(404, validPayload())
    // sortOrder 为 1：404 种子已有 1 条（每周竞品动态汇总），新建的排在其后
    expect(vo).toMatchObject({ name: '竞品周报采集', status: 'ENABLED', scheduleSummary: '每天 10:00', sortOrder: 1 })
    const upd = await updateSampleTask(404, vo.id, validPayload({ name: '竞品日报采集', schedule: { scheduleType: 'WEEKLY', times: ['09:30'], daysOfWeek: [1, 3] } }))
    expect(upd.scheduleSummary).toBe('每周一、三 09:30')
    expect((await getSampleTask(404, vo.id)).name).toBe('竞品日报采集')
  })

  it('排序：orderedIds 生效；集合不一致 409', async () => {
    const before = (await listSampleTasks(401)).list
    // 前两条对调，其余不变，必须传全量 id
    const reordered = [before[1].id, before[0].id, ...before.slice(2).map((s) => s.id)]
    await reorderSampleTasks(401, reordered)
    const after = (await listSampleTasks(401)).list
    expect(after.map((s) => s.id)).toEqual(reordered)
    await expect(reorderSampleTasks(401, [before[0].id])).rejects.toMatchObject({ code: 409 })
  })

  it('删除与启停', async () => {
    const { list } = await listSampleTasks(401)
    await setSampleTaskStatus(401, list[0].id, 'DISABLED')
    expect((await getSampleTask(401, list[0].id)).status).toBe('DISABLED')
    await deleteSampleTask(401, list[0].id)
    expect((await listSampleTasks(401)).total).toBe(7)
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

describe('sampleTaskMock · 持久化读回（mockPersist v4；c40c606 三模式+preKick 种子结构变更后 bump）', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 故与 mockPersist.test 同款注入内存版存储，用 vi.resetModules + 动态 import 模拟「写入 → 刷新 → 重载」。
  const KEY = 'iworker-demo-mock:sampleTask'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  beforeEach(() => {
    globalThis.localStorage = makeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.resetModules()
  })

  it('createSampleTask 落盘（v=4）→ 重新 import 模块（模拟刷新）→ 404 列表含新建任务', async () => {
    const first = await import('../sampleTaskMock')
    await first.createSampleTask(404, validPayload({ name: '读回验证任务' }))
    expect(JSON.parse(globalThis.localStorage.getItem(KEY)).v).toBe(4)
    vi.resetModules()
    const fresh = await import('../sampleTaskMock')
    const { list, total } = await fresh.listSampleTasks(404)
    expect(total).toBe(2)
    expect(list.map((s) => s.name)).toContain('读回验证任务')
  })

  it('存量 v3 快照（旧种子结构）→ 启动时丢弃、回代码种子（401 八条），旧 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 3, data: { sampleSeq: 9999, samplesByPosition: { 401: [] } } }))
    const fresh = await import('../sampleTaskMock')
    expect((await fresh.listSampleTasks(401)).total).toBe(8)
    // mockPersist 版本不符即 removeItem；之后尚无写点，key 应为空
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
  })
})
