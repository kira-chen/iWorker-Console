// @vitest-environment jsdom
// （positionMock / unifiedSkillMock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  publishPosition,
  withdrawPosition,
  unpublishPosition,
  updatePosition,
  getPositionReviewSnapshot,
  __resetPositionMock
} from '../positionMock'
import { setUserPosition } from '../positionAssignmentMock'
import {
  publishSkill,
  withdrawPublish,
  delistSkill,
  updateSkill,
  getSkillReviewSnapshot
} from '../unifiedSkillMock'
import { publishExpert, withdrawExpert, getExpertReviewSnapshot } from '../domainExpertMock'
import { needsSnapshot, loadReviewSnapshot, SNAPSHOT_MISSING_HINT } from '@/utils/reviewSnapshot'

/**
 * 审核版本快照（2026-09-09 PRD 复核·G3G6 · A5）回归保护。
 *
 * 负责人批注：「要不要快照是由提交模块决定的，而不在审核中心/我的申请做存储处理。
 * 例如：技能/专家/岗位单独存储了审核版本的快照」。
 * md `prd.审核中心.md` §四 L48：岗位/专家/技能提交审核时由所属业务模块生成快照，审核详情读该快照；
 *                              知识库/MCP/API/业务系统/模型不生成快照，读当前配置。
 * md `prd.审核中心.md` §七 L102：快照缺失（岗位/专家/技能）→ 阻止审核并提示联系提交人重新提交。
 *
 * 本文件验证三条不变式：
 *   1. 提交审核 → 各提交模块自己存下快照（读得到，且带提交时点）；
 *   2. 快照冻结提交当时的配置——提交后再改业务对象，快照内容不变（这正是快照存在的理由）；
 *   3. 撤回 → 快照销毁（下次提交重新生成），治理侧据此按 md §七 阻止审核。
 */
describe('审核版本快照 · A5', () => {
  it('utils/reviewSnapshot：只有岗位/专家/技能三类需要快照（md §四 L48）', () => {
    expect(needsSnapshot('POSITION')).toBe(true)
    expect(needsSnapshot('EXPERT')).toBe(true)
    expect(needsSnapshot('SKILL')).toBe(true)
    for (const k of ['KNOWLEDGE_BASE', 'MCP', 'API', 'BIZ_SYSTEM', 'MODEL', '']) {
      expect(needsSnapshot(k)).toBe(false)
    }
    // 不需快照的类型：读取口恒返回 null（调用方据此走「读当前配置」分支，而非「阻止审核」）
    expect(SNAPSHOT_MISSING_HINT).toContain('重新提交')
  })

  it('不需快照的类型不会误触发读取（loadReviewSnapshot 恒 null）', async () => {
    await expect(loadReviewSnapshot('KNOWLEDGE_BASE', 'kb_3')).resolves.toBe(null)
    await expect(loadReviewSnapshot('MODEL', 'md_104')).resolves.toBe(null)
    await expect(loadReviewSnapshot('POSITION', null)).resolves.toBe(null)
  })

  describe('岗位', () => {
    beforeEach(() => __resetPositionMock())

    it('提交发布 → 存快照；改岗位后快照不变（冻结提交时配置）；撤回 → 快照销毁', async () => {
      // 404 市场研究岗：草稿、无在途审核
      expect(getPositionReviewSnapshot(404)).toBe(null)

      await publishPosition(404, { releaseNotes: '首个版本' })
      const snap = getPositionReviewSnapshot(404)
      expect(snap).toBeTruthy()
      expect(snap.kind).toBe('POSITION')
      expect(snap.requestAction).toBe('FIRST_PUBLISH')
      expect(snap.submittedAt).toBeTruthy()
      expect(snap.detail.name).toBe('市场研究岗')

      // 快照冻结：提交后改岗位描述，快照里仍是提交当时的值
      await updatePosition(404, { description: '提交之后才改的描述' })
      expect(getPositionReviewSnapshot(404).detail.description).toBe(snap.detail.description)
      expect(getPositionReviewSnapshot(404).detail.description).not.toBe('提交之后才改的描述')

      // 撤回 → 快照销毁（治理侧读不到 → 按 md §七 阻止审核）
      await withdrawPosition(404)
      expect(getPositionReviewSnapshot(404)).toBe(null)
    })

    it('提交停用同样存快照（md §四不区分申请类型）', async () => {
      // 401 种子被 zhangwei（userId 1）+ zhouming（userId 5）领用，先解绑——本用例测的是
      // 快照写入，不是领用拦截（2026-09-23 待办 yuepu#9①）
      await setUserPosition(1, null)
      await setUserPosition(5, null)
      await unpublishPosition(401) // 401 经营分析岗已发布
      const snap = getPositionReviewSnapshot(401)
      expect(snap.requestAction).toBe('DELIST')
      expect(snap.detail.name).toBe('经营分析岗')
    })

    it('种子在审岗位（403 财务审核岗）开箱即有快照，不会误判「快照缺失」', () => {
      const snap = getPositionReviewSnapshot(403)
      expect(snap).toBeTruthy()
      expect(snap.detail.name).toBe('财务审核岗')
    })

    it('loadReviewSnapshot 读得到岗位快照（治理侧读取口打通）', async () => {
      await publishPosition(404, { releaseNotes: '首个版本' })
      const snap = await loadReviewSnapshot('POSITION', 404)
      expect(snap?.detail?.name).toBe('市场研究岗')
    })
  })

  describe('技能', () => {
    it('提交发布 → 存快照；在审期间改技能被 mock 拒绝（K20）、快照不变；撤回 → 销毁', async () => {
      // sk_307（未发布草稿态种子）——用例内自洽驱动，先确保没有在途提交
      const id = 'sk_307'
      const before = getSkillReviewSnapshot(id)
      if (before) await withdrawPublish(id)

      await publishSkill(id, { releaseNotes: '首次发布' })
      const snap = getSkillReviewSnapshot(id)
      expect(snap).toBeTruthy()
      expect(snap.kind).toBe('SKILL')
      expect(snap.submittedAt).toBeTruthy()
      const nameAtSubmit = snap.detail.name

      // 2026-09-12 审计 K20：审核锁定期 mock 侧拒写（md 技能 §二.2 L120），快照自然不变
      await expect(updateSkill(id, { description: '提交之后才改的描述' })).rejects.toThrow('技能审核中，已锁定不可修改')
      expect(getSkillReviewSnapshot(id).detail.name).toBe(nameAtSubmit)
      expect(getSkillReviewSnapshot(id).detail.description).not.toBe('提交之后才改的描述')

      await withdrawPublish(id)
      expect(getSkillReviewSnapshot(id)).toBe(null)
    })

    it('提交停用同样存快照', async () => {
      const id = 'sk_303' // 已发布种子
      const before = getSkillReviewSnapshot(id)
      if (before) await withdrawPublish(id)
      await delistSkill(id)
      expect(getSkillReviewSnapshot(id).requestAction).toBe('DELIST')
      await withdrawPublish(id)
    })
  })

  describe('专家', () => {
    it('提交发布 → 存快照（含提交时点与配置）；撤回 → 销毁', async () => {
      // 202 企业知识助手：已发布、无在途审核（用例内自洽驱动，末尾撤回复位）
      const id = 202
      await publishExpert(id, { releaseNotes: '测试提交' })
      const snap = getExpertReviewSnapshot(id)
      expect(snap).toBeTruthy()
      expect(snap.kind).toBe('EXPERT')
      expect(snap.requestAction).toBe('VERSION_PUBLISH')
      expect(snap.submittedAt).toBeTruthy()
      expect(snap.detail.name).toBe('企业知识助手')
      // 治理侧读取口打通
      expect((await loadReviewSnapshot('EXPERT', id))?.detail?.name).toBe('企业知识助手')

      await withdrawExpert(id)
      expect(getExpertReviewSnapshot(id)).toBe(null)
      expect(await loadReviewSnapshot('EXPERT', id)).toBe(null) // → 治理侧按 md §七 阻止审核
    })
  })
})
