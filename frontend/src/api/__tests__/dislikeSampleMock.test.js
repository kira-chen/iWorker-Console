import { describe, it, expect } from 'vitest'
import { listDislikeSamples, getDislikeConversation } from '../dislikeSampleMock'

/**
 * 点踩明细样例 · 助手生成的文件（产品优化需求-202611 修改点 20；PRD 驾驶舱第八、九节）。
 * 口径：被点踩回复里生成的文件随这一轮留存，可预览、下载；用户提问里的附件不留、不展示；
 * 图片、PDF、文本可在线预览，Word、Excel 只能下载；文件已失效时不能预览、下载。
 */
describe('dislikeSampleMock · 点踩明细样例与生成文件', () => {
  it('列表 52 条，行不带对话内容，fileCount = 该条被点踩回复里生成的文件数', async () => {
    const { list, total } = await listDislikeSamples()
    expect(total).toBe(52)
    expect(list[0]).not.toHaveProperty('turns')
    for (const row of list.slice(0, 10)) {
      const { turns } = await getDislikeConversation(row.id)
      expect(row.fileCount).toBe(turns[1].files.length)
    }
    expect(list.some((r) => r.fileCount === 0)).toBe(true) // 有没生成文件的轮次（表格显示「—」）
  })

  it('对话明细只有单轮：用户提问不带附件，文件只挂在被点踩的助手回复上', async () => {
    const { list } = await listDislikeSamples()
    for (const row of list) {
      const { turns } = await getDislikeConversation(row.id)
      expect(turns.map((t) => t.role)).toEqual(['user', 'asst'])
      expect(turns[0].files).toEqual([])
      expect(turns[1].disliked).toBe(true)
    }
  })

  it('能否在线预览按文件类型：图片、PDF、文本可预览，Word、Excel 只能下载', async () => {
    const { list } = await listDislikeSamples()
    const files = []
    for (const row of list) files.push(...(await getDislikeConversation(row.id)).turns[1].files)
    const byKind = (k) => files.filter((f) => f.kind === k)
    for (const k of ['image', 'pdf', 'txt']) expect(byKind(k).length && byKind(k).every((f) => f.previewable)).toBe(true)
    for (const k of ['docx', 'xlsx']) expect(byKind(k).length && byKind(k).every((f) => !f.previewable)).toBe(true)
    expect(byKind('image').every((f) => f.url.startsWith('data:image/'))).toBe(true)
    expect(byKind('pdf').every((f) => f.previewText.length > 0)).toBe(true)
  })

  it('样例里有文件已失效的记录（演示失效态），同一条的文件全部失效', async () => {
    const { turns } = await getDislikeConversation('D-1025') // 第 7 条：每 7 条 1 条失效
    expect(turns[1].files.length).toBeGreaterThan(0)
    expect(turns[1].files.every((f) => f.expired)).toBe(true)
    expect((await getDislikeConversation('D-1031')).turns[1].files.every((f) => !f.expired)).toBe(true)
  })

  it('不存在的记录 → 报错「点踩记录不存在」', async () => {
    await expect(getDislikeConversation('D-0')).rejects.toThrow('点踩记录不存在')
  })
})
