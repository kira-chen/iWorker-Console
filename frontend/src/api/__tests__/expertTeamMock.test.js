// @vitest-environment jsdom
// （expertTeamMock → request.js → router 链路触达 window，故用 jsdom；同 domainExpertMock.test）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  listTeamMemberCandidates,
  candidateTypesOf,
  trialTeam,
  publishTeam,
  withdrawTeam,
  unpublishTeam,
  forceRevokeTeam,
  applyTeamReviewResult,
  getTeamReviewSnapshot,
  listTeamPublications,
  delistTeamPublication,
  listTeamsReferencingExpert,
  checkTeamPublishable,
  __resetTeamMock
} from '../expertTeamMock'
import { __resetExpertMock, createExpert, deleteExpert, forceRevokeExpert, unpublishExpert, applyExpertReviewResult } from '../domainExpertMock'
import { opsRecords, resetAccessAuditMock, listClientFacingOps } from '../accessAuditMock'
import { listReviews } from '../reviewsMock'

beforeEach(() => {
  __resetExpertMock()
  __resetTeamMock()
  resetAccessAuditMock()
})

const base = (over = {}) => ({
  name: '新测试团',
  type: 'PLATFORM',
  category: '通用',
  avatar: '◈',
  intro: '一段团介绍',
  members: [
    { expertId: 201, duty: '经营口径' },
    { expertId: 204, duty: '行业研究' }
  ],
  collab: '先看经营再看研究',
  exampleQuestions: ['问一', '问二', '问三'],
  ...over
})

// 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md（md）
describe('expertTeamMock —— 专家团 mock（2026-10-12）', () => {
  it('种子 3 条：默认按最近更新时间降序；303 是唯一「未发布无版本」样本；301 设了团长、302 没设', async () => {
    const { list, total } = await listTeams()
    expect(total).toBe(3)
    expect(list.map((t) => t.name)).toEqual(['岗位协同团', '知识问答团', '经营研究团'])
    const byName = Object.fromEntries(list.map((t) => [t.name, t]))
    expect(byName['岗位协同团']).toMatchObject({ status: 'draft', latestVersionLabel: '', type: 'POSITION', positionIds: [401], positionCount: 1 })
    expect(byName['经营研究团']).toMatchObject({ leaderName: '经营分析专家', memberCount: 2 })
    expect(byName['知识问答团']).toMatchObject({ leaderId: null, leaderName: '' })
    expect((await listTeams({ sort: 'asc' })).list[0].name).toBe('经营研究团')
  })

  it('筛选：keyword 覆盖团名 / 介绍 / 分类；type / category / status 三态精确', async () => {
    expect((await listTeams({ keyword: '制度' })).list.map((t) => t.name).sort()).toEqual(['岗位协同团', '知识问答团'])
    expect((await listTeams({ type: 'SYSTEM_DEFAULT' })).list.map((t) => t.name)).toEqual(['知识问答团'])
    expect((await listTeams({ category: '通用' })).total).toBe(1)
    expect((await listTeams({ status: 'draft' })).list.map((t) => t.name)).toEqual(['岗位协同团'])
    expect((await listTeams({ status: 'published' })).total).toBe(2)
    expect((await listTeams({ status: 'review' })).total).toBe(0)
  })

  it('候选范围（md §三.3.1）：三类团都可放通用 + 市场专家，只有岗位私有团可放岗位私有专家；候选只含已发布专家', async () => {
    expect(candidateTypesOf('PLATFORM')).toEqual(['SYSTEM_DEFAULT', 'PLATFORM'])
    expect(candidateTypesOf('SYSTEM_DEFAULT')).toEqual(['SYSTEM_DEFAULT', 'PLATFORM'])
    expect(candidateTypesOf('POSITION')).toContain('POSITION')
    const ids = async (type) => (await listTeamMemberCandidates({ type })).map((x) => x.id).sort()
    // 种子里只有 201 / 202 / 204 已发布（203 法务审阅专家是未发布草稿）
    expect(await ids('SYSTEM_DEFAULT')).toEqual([201, 202, 204])
    expect(await ids('PLATFORM')).toEqual([201, 202, 204])
    expect(await ids('POSITION')).toEqual([201, 202, 204])
    expect((await listTeamMemberCandidates({ type: 'PLATFORM' })).find((x) => x.id === 201).leadGuide).toContain('经营数据')
  })

  it('创建：团名重名拦截（字段 name）；岗位私有专家不能进市场 / 通用团；团长必须是成员', async () => {
    await expect(createTeam(base({ name: '经营研究团' }))).rejects.toMatchObject({ field: 'name', message: '团名称已存在' })
    // 203 是岗位私有专家
    await expect(createTeam(base({ members: [{ expertId: 201, duty: 'a' }, { expertId: 203, duty: 'b' }] })))
      .rejects.toMatchObject({ field: 'members' })
    await expect(createTeam(base({ type: 'POSITION', members: [{ expertId: 201, duty: 'a' }, { expertId: 203, duty: 'b' }] })))
      .resolves.toMatchObject({ status: 'draft' })
    await expect(createTeam(base({ name: '团长不在成员里', leaderId: 202 }))).rejects.toMatchObject({ field: 'leaderId' })
  })

  it('创建后初始为「未发布」，团类型创建后不可改；更新时团类型被忽略', async () => {
    const t = await createTeam(base())
    expect(t).toMatchObject({ status: 'draft', type: 'PLATFORM', latestVersionLabel: '' })
    const u = await updateTeam(t.id, { type: 'POSITION', intro: '改了' })
    expect(u.type).toBe('PLATFORM')
    expect(u.intro).toBe('改了')
  })

  it('保存校验（md §三.8）：没设团长缺协作关系 / 设了团长缺团长职责 / 成员团内负责什么为空 各有各的字段提示', async () => {
    const full = await getTeam(303)
    expect(checkTeamPublishable(full)).toBeNull()
    expect(checkTeamPublishable({ ...full, collab: '' })).toMatchObject({ field: 'collab', message: '请填写团队协作关系' })
    expect(checkTeamPublishable({ ...full, leaderId: 202, leaderDuty: '' })).toMatchObject({ field: 'leaderDuty', message: '请填写团长职责' })
    // 设了团长时协作关系可以不填
    expect(checkTeamPublishable({ ...full, leaderId: 202, leaderDuty: '按知识口径', collab: '' })).toBeNull()
    expect(checkTeamPublishable({ ...full, members: [full.members[0], { ...full.members[1], duty: ' ' }] })).toMatchObject({ field: 'members' })
    expect(checkTeamPublishable({ ...full, members: [full.members[0]] })).toMatchObject({ field: 'members', message: '至少 2 位成员' })
    expect(checkTeamPublishable({ ...full, exampleQuestions: ['a', '', 'c'] })).toMatchObject({ field: 'examples' })
  })

  it('发布前检查：成员须均为已发布；岗位私有成员须绑定团的全部所属岗位', async () => {
    const full = await getTeam(303)
    // 203（岗位私有，未发布）→ 先因「未发布」被拦
    const withDraft = { ...full, members: [full.members[0], { expertId: 203, duty: '合同' }] }
    expect(checkTeamPublishable(withDraft).message).toContain('成员「法务审阅专家」未发布')
    // 把 203 发布成「已发布」后：绑定了 401 / 402，团绑 401 + 999 → 缺 999
    await applyFakePublished(203)
    const t = { ...withDraft, positionIds: [401, 999] }
    expect(checkTeamPublishable(t).message).toMatch(/成员「法务审阅专家」未绑定岗位「.*999.*」，该岗位员工将无法使用，请调整/)
    expect(checkTeamPublishable({ ...withDraft, positionIds: [401, 402] })).toBeNull()
  })

  it('提交发布 → 进入审核 + 审核中心落行 + 存快照；撤回清快照；通过后 v1.0.0 已发布、驳回回到未发布', async () => {
    await expect(publishTeam(303, { releaseNotes: '  ' })).rejects.toMatchObject({ field: 'releaseNotes' })
    await publishTeam(303, { releaseNotes: '首发' })
    const row = (await getTeam(303))
    expect(row).toMatchObject({ pendingAction: 'PUBLISH', pendingVersion: 'v1.0.0' })
    expect(getTeamReviewSnapshot(303)).toMatchObject({ kind: 'EXPERT_TEAM', requestAction: 'FIRST_PUBLISH', version: 'v1.0.0' })
    expect((await listReviews({ size: 100 })).list.some((r) => r.type === 'EXPERT_TEAM' && r.refId === 303)).toBe(true)
    // 审核中锁定
    await expect(updateTeam(303, { intro: 'x' })).rejects.toMatchObject({ message: '审核中，专家团已锁定不可修改' })
    await withdrawTeam(303)
    expect(getTeamReviewSnapshot(303)).toBeNull()
    expect(await getTeam(303)).toMatchObject({ pendingAction: null, status: 'draft' })

    await publishTeam(303, { releaseNotes: '首发' })
    expect(applyTeamReviewResult(303, 'FIRST_PUBLISH', false)).toBe(true)
    expect(await getTeam(303)).toMatchObject({ status: 'draft', latestVersionLabel: '' })

    await publishTeam(303, { releaseNotes: '首发' })
    expect(applyTeamReviewResult(303, 'FIRST_PUBLISH', true)).toBe(true)
    expect(await getTeam(303)).toMatchObject({ status: 'published', latestVersionLabel: 'v1.0.0', pendingAction: null })
    expect((await listTeamPublications(303)).map((p) => [p.versionLabel, p.status])).toEqual([['v1.0.0', 'ACTIVE']])
    // 申请类型与对象在途事项不同向时拒绝落地
    expect(applyTeamReviewResult(303, 'DELIST', true)).toBe(false)
  })

  it('停用走审核，通过后回「未发布」；最后一个启用版本不可禁用；已发布不可删除', async () => {
    await unpublishTeam(301)
    expect(await getTeam(301)).toMatchObject({ pendingAction: 'DELIST', status: 'published' })
    applyTeamReviewResult(301, 'DELIST', true)
    expect(await getTeam(301)).toMatchObject({ status: 'draft', latestVersionLabel: 'v1.0.0' })
    await expect(deleteTeam(302)).rejects.toMatchObject({ message: '已发布的专家团不可删除，需先完成停用审核' })
    const pubs = await listTeamPublications(302)
    await expect(delistTeamPublication(302, pubs[0].id)).rejects.toMatchObject({ message: expectStr('最后一个启用版本') })
  })

  it('强制回收：立即生效不进审核、写访问审计（模块=专家团）并被客户端读取；成员专家不受影响', async () => {
    await expect(forceRevokeTeam(301, { reason: ' ' })).rejects.toMatchObject({ message: '请输入回收原因' })
    await expect(forceRevokeTeam(301, { reason: 'x'.repeat(501) })).rejects.toMatchObject({ message: '回收原因最多 500 字' })
    await forceRevokeTeam(301, { reason: '团配置异常' })
    const t = await getTeam(301)
    expect(t).toMatchObject({ status: 'draft', latestVersionLabel: 'v1.0.0' })
    expect(t.revoked.reason).toBe('团配置异常')
    expect(opsRecords.some((r) => r.module === '专家团' && r.action === '强制回收' && r.detail === '团配置异常')).toBe(true)
    expect(listClientFacingOps().find((r) => r.kind === 'forceRevoke' && r.objectType === '专家团')).toMatchObject({ objectName: '经营研究团', reason: '团配置异常' })
    await expect(forceRevokeTeam(301, { reason: '再来一次' })).rejects.toMatchObject({ message: '专家团状态已变化，请刷新后重试' })
    expect((await getTeam(301)).members.every((m) => !m.unavailable)).toBe(true)
    // 重新发布审核通过后「已回收」标记清除
    await publishTeam(301, { releaseNotes: '恢复' })
    applyTeamReviewResult(301, 'VERSION_PUBLISH', true)
    expect((await getTeam(301)).revoked).toBeNull()
  })

  it('缺员（md §四）：成员专家被强制回收 / 删除后团在列表显示缺员 N 与原因；发布前检查被阻断', async () => {
    expect((await listTeams()).list.every((t) => t.missingCount === 0)).toBe(true)
    await forceRevokeExpert(202, { reason: '专家异常' })
    const { list } = await listTeams()
    const t = list.find((x) => x.name === '岗位协同团')
    expect(t).toMatchObject({ missingCount: 1 })
    expect(t.missing).toEqual([{ expertId: 202, name: '企业知识助手', reason: '已回收' }])
    expect(checkTeamPublishable(await getTeam(303)).message).toBe('成员「企业知识助手」已回收，请移除或替换后再发布')
  })

  it('专家删除被团引用时拦截（md §四）；停用专家不拦截但团随之缺员', async () => {
    const x = await createExpert({ name: '临时专家', type: 'PLATFORM', category: '通用', avatar: 'T', intro: 'i', roleDesc: 'r', exampleQuestions: ['a', 'b', 'c'], skillIds: [302] })
    const t = await createTeam(base({ members: [{ expertId: x.id, duty: '临时' }, { expertId: 201, duty: '经营' }] }))
    expect(listTeamsReferencingExpert(x.id)).toEqual([{ id: t.id, name: '新测试团', status: 'draft' }])
    await expect(deleteExpert(x.id)).rejects.toMatchObject({ message: expectStr('被 1 个专家团引用') })
    await deleteTeam(t.id)
    await expect(deleteExpert(x.id)).resolves.toBe(1)
    // 停用 201（已发布）：提交审核 + 通过后下线，不被团拦截
    await unpublishExpert(201)
    applyExpertReviewResult(201, 'DELIST', true)
    expect((await listTeams()).list.find((r) => r.name === '经营研究团')).toMatchObject({ missingCount: 1, missing: [{ expertId: 201, name: '经营分析专家', reason: '已停用' }] })
  })

  it('试跑拆解：有团长标「由团长按职责拆解」，没团长标「由系统」；首位先做；成员少于 2 位 / 任务为空报错', async () => {
    const members = [{ expertId: 201, duty: '经营口径' }, { expertId: 204, duty: '行业研究' }, { expertId: 202, duty: '制度依据' }]
    const sys = await trialTeam({ members, leaderId: null, collab: '先看经营，最后核对制度依据', task: '看一下' })
    expect(sys.mode).toBe('system')
    expect(sys.plan.map((p) => p.order)).toEqual(['先做', '同时', '等 经营分析专家 完成后'])
    const lead = await trialTeam({ members, leaderId: 201, collab: '', task: '看一下' })
    expect(lead).toMatchObject({ mode: 'leader', leaderName: '经营分析专家' })
    await expect(trialTeam({ members: [members[0]], task: 'x' })).rejects.toMatchObject({ message: '请先选择至少 2 位成员' })
    await expect(trialTeam({ members, task: ' ' })).rejects.toMatchObject({ field: 'task' })
  })

  it('「已试跑」状态：改动成员 / 协作关系后清零；编辑器重新试跑后随保存带上 trialed=true 才保留', async () => {
    expect((await getTeam(302)).trialed).toBe(true)
    expect((await updateTeam(302, { intro: '只改介绍' })).trialed).toBe(true)
    expect((await updateTeam(302, { collab: '换一套分工' })).trialed).toBe(false)
    expect((await updateTeam(302, { collab: '再换一套', trialed: true })).trialed).toBe(true)
  })
})

/* 小工具 */
function expectStr(sub) {
  return expect.stringContaining(sub)
}
/** 把专家 203 直接置为已发布（跳过审核流程，仅为构造「岗位私有专家已发布」的前置）。 */
function applyFakePublished(expertId) {
  // 走真实路径：提交发布 → 审核通过
  return import('../domainExpertMock').then(async ({ publishExpert }) => {
    await publishExpert(expertId, { releaseNotes: '测试' })
    applyExpertReviewResult(expertId, 'FIRST_PUBLISH', true)
  })
}
