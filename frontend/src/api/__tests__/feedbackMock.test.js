import { describe, it, expect, beforeEach } from 'vitest'
import { listFeedbacks, fetchFeedbackImageBlob, resetFeedbackMock } from '../feedbackMock'

/**
 * 用户反馈 mock 层（2026-09-01 PRD 对齐改造）回归保护：
 * 种子 = 交互原型 v2 的 4 条反馈；createdAt 排序默认 desc；
 * keyword 过滤域 [username, content]；附图为内置 SVG 占位图 blob（与真实链路同签名）。
 */
describe('feedbackMock · 用户反馈内存 mock', () => {
  beforeEach(() => resetFeedbackMock())

  it('默认列表：4 条，按 createdAt desc', async () => {
    const { list, total } = await listFeedbacks()
    expect(total).toBe(4)
    expect(list.map((r) => r.id)).toEqual([1, 2, 3, 4]) // 时间恰与 id 序一致
    const times = list.map((r) => r.createdAt)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('终端筛选 + keyword 过滤域 [username, content]', async () => {
    const mac = await listFeedbacks({ terminal: 'MAC' })
    expect(mac.list.map((r) => r.id)).toEqual([2, 4])
    const byUser = await listFeedbacks({ keyword: 'chenyu' })
    expect(byUser.list.map((r) => r.id)).toEqual([3])
    const byContent = await listFeedbacks({ keyword: '桌面通知' })
    expect(byContent.list.map((r) => r.id)).toEqual([2])
  })

  it('附图形状：[{ seq, thumb_url, url }]，条数照原型（1 号反馈 2 张、2 号 0 张、4 号 3 张）', async () => {
    const { list } = await listFeedbacks()
    const byId = Object.fromEntries(list.map((r) => [r.id, r]))
    expect(byId[1].images).toHaveLength(2)
    expect(byId[2].images).toHaveLength(0)
    expect(byId[4].images).toHaveLength(3)
    expect(byId[1].images[0]).toMatchObject({ seq: 1, thumb_url: 'mock-fb://1/1', url: 'mock-fb://1/1' })
  })

  it('fetchFeedbackImageBlob：合法地址返回 SVG blob，非法地址抛「图片加载失败」', async () => {
    const blob = await fetchFeedbackImageBlob('mock-fb://1/2')
    expect(blob.type).toBe('image/svg+xml')
    expect(blob.size).toBeGreaterThan(0)
    await expect(fetchFeedbackImageBlob('/api/fde/feedbacks/x')).rejects.toThrow('图片加载失败')
  })
})
