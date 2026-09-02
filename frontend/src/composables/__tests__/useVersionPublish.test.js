import { describe, it, expect, vi } from 'vitest'
import { useVersionPublish } from '@/composables/useVersionPublish'

/**
 * useVersionPublish：N5/N6 发布版本号编排收敛（三处复用）。
 * 验证 load 的建议号带出 / prevMaxLabel 推导 / 无法自动建议（返 null）/ 拉取失败降级，以及派生态 canSubmit。（2026-09-02 起语义化 vX.Y.Z）
 * 纯 composable，无 DOM；fetchNextLabel 用 vi.fn mock。
 */
describe('useVersionPublish', () => {
  it('load：带出建议号 v1.2.1 → 回填版本号，prevMaxLabel = 建议号 patch-1（v1.2.0），非到顶', async () => {
    const fetchNextLabel = vi.fn().mockResolvedValue('v1.2.1')
    const vp = useVersionPublish({ fetchNextLabel })
    await vp.load('pos_1')
    expect(fetchNextLabel).toHaveBeenCalledWith('pos_1')
    expect(vp.versionLabel.value).toBe('v1.2.1')
    expect(vp.prevMaxLabel.value).toBe('v1.2.0')
    expect(vp.atMax.value).toBe(false)
    // 升级说明 load 时被清空
    expect(vp.releaseNotes.value).toBe('')
    expect(vp.nextLoading.value).toBe(false)
  })

  it('load：无历史（建议 v1.0.0，patch=0）→ prevMaxLabel 留空（不提示递增）', async () => {
    const vp = useVersionPublish({ fetchNextLabel: vi.fn().mockResolvedValue('v1.0.0') })
    await vp.load('x')
    expect(vp.versionLabel.value).toBe('v1.0.0')
    expect(vp.prevMaxLabel.value).toBe('')
    expect(vp.incrementHint.value).toBe('')
  })

  it('load：无法自动建议（后端返 null）→ atMax、版本号留空、prevMaxLabel 留空', async () => {
    const vp = useVersionPublish({ fetchNextLabel: vi.fn().mockResolvedValue(null) })
    await vp.load('x')
    expect(vp.atMax.value).toBe(true)
    expect(vp.versionLabel.value).toBe('')
    expect(vp.prevMaxLabel.value).toBe('')
    expect(vp.canSubmit.value).toBe(false)
  })

  it('load：拉取失败 → 不给假上限态，版本号/prevMaxLabel 留空供手填', async () => {
    const vp = useVersionPublish({ fetchNextLabel: vi.fn().mockRejectedValue(new Error('boom')) })
    await vp.load('x')
    expect(vp.atMax.value).toBe(false)
    expect(vp.versionLabel.value).toBe('')
    expect(vp.prevMaxLabel.value).toBe('')
    expect(vp.nextLoading.value).toBe(false)
  })

  it('派生态：版本号合法 + 升级说明已填 → canSubmit=true；缺一即 false', async () => {
    const vp = useVersionPublish({ fetchNextLabel: vi.fn().mockResolvedValue('v1.2.1') })
    await vp.load('x')
    // 仅有版本号、升级说明空 → notesErr 非空 → 不可提交
    expect(vp.notesErr.value).not.toBe('')
    expect(vp.canSubmit.value).toBe(false)
    vp.releaseNotes.value = '本次更新导出'
    expect(vp.notesErr.value).toBe('')
    expect(vp.canSubmit.value).toBe(true)
    // 版本号改非法 → versionErr 非空 → 不可提交
    vp.versionLabel.value = 'v1'
    expect(vp.versionErr.value).not.toBe('')
    expect(vp.canSubmit.value).toBe(false)
  })

  it('incrementHint：填的号未递增（≤历史最大）→ 软提示；递增则无提示', async () => {
    const vp = useVersionPublish({ fetchNextLabel: vi.fn().mockResolvedValue('v1.2.1') })
    await vp.load('x') // prevMaxLabel=v1.2.0
    vp.versionLabel.value = 'v1.2.0' // 等于历史最大 → 未递增
    expect(vp.incrementHint.value).not.toBe('')
    vp.versionLabel.value = 'v020' // 递增
    expect(vp.incrementHint.value).toBe('')
  })
})
