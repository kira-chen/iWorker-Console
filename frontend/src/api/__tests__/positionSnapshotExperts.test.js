// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect } from 'vitest'
import { bindPositionExpert, publishPosition, getPositionReviewSnapshot } from '@/api/positionMock'

/**
 * 岗位审核快照带上当时引用的专家与专家团（产品优化需求-202611 R13 §2：引用关系随岗位发布生效）。
 * 审核详情读快照，看到的是提交那一刻的引用；岗位在审期间锁定，引用改不了。
 */
describe('positionMock · 岗位审核快照里的专家与专家团', () => {
  it('提交发布时把当前引用的专家（只留 id 与名称）写进快照', async () => {
    await bindPositionExpert(404, 205) // 205 经营数据核查专家：已发布的岗位私有专家
    await publishPosition(404, { releaseNotes: '首次发布' })
    const refs = getPositionReviewSnapshot(404).detail.expertRefs
    expect(refs.experts).toEqual([{ expertId: 205, name: '经营数据核查专家' }])
    expect(refs.teams).toEqual([])
  })
})
