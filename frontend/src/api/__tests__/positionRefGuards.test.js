// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
/**
 * 岗位侧引用的数据层口径（产品优化需求-202611 修改点 1 / 2 / 3，2026-11-12 原型走查补齐）：
 * - 「添加技能」候选：已发布的岗位私有技能，「已发布」按技能本体状态判——有新版本在审核中的仍在候选里；
 * - 移除技能 / 专家团前的预检：被本岗位自动化任务引用 / 选为执行对象时回拦截文案，与移除接口的兜底拦截同一句；
 * - 执行对象候选附带全部专家 / 团的名称，所选对象已不可用时编辑页据此显示名称而非裸 id。
 *
 * 种子：401 经营分析岗引用岗位私有技能 sk_301；任务 7002「周度经营复盘提醒」交给团 304「经营复盘团」执行；
 * 团 303「岗位协同团」是 401 引用的未发布团（不在执行对象候选里）；专家 205 被 401 引用、没有任务用它。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listPositionSkillCandidates,
  checkDetachPositionSkill,
  detachPositionSkill,
  checkUnbindPositionTeam,
  checkUnbindPositionExpert,
  unbindPositionTeam,
  listTaskExecTargetCandidates,
  getPosition,
  getPositionExperts,
  __resetPositionMock
} from '../positionMock'
import { updateSampleTask, getSampleTask, __resetSampleTaskMock } from '../sampleTaskMock'
import { _getRaw, _reset } from '../unifiedSkillMock'
import { __resetExpertMock } from '../domainExpertMock'
import { __resetTeamMock } from '../expertTeamMock'
import { getFieldOptionNames, saveFieldOptions } from '../fieldDictMock'

const SK_305_SEED = _getRaw('sk_305')

beforeEach(() => {
  __resetPositionMock()
  __resetSampleTaskMock()
  __resetExpertMock()
  __resetTeamMock()
  _reset('sk_305', { pendingAction: SK_305_SEED.pendingAction ?? null, pendingVersion: SK_305_SEED.pendingVersion ?? '', status: SK_305_SEED.status })
})

/** 让 401 的任务 7001「每日经营晨报」在「引用技能」里引用 sk_301（日报周报生成）。 */
async function letTaskUseSkill301() {
  const t = await getSampleTask(401, 7001)
  await updateSampleTask(401, 7001, { ...t, skillRefs: [...t.skillRefs, { platformSkillId: 'sk_301', name: '日报周报生成' }] })
}

describe('「添加技能」候选：已发布按技能本体状态判（修改点 1 / 4）', () => {
  it('岗位私有技能提交了新版本、在审核中（本体仍 published）→ 仍在候选里', async () => {
    _reset('sk_305', { pendingAction: 'publish', pendingVersion: 'v1.1.0' })
    const names = (await listPositionSkillCandidates(401)).map((s) => s.name)
    expect(names).toContain('客户拜访准备')
  })

  it('候选只含未被本岗位引用的已发布岗位私有技能：已引用的、草稿（含首发在审）、非岗位私有的都不在', async () => {
    const ids = (await listPositionSkillCandidates(401)).map((s) => s.id)
    expect(ids).not.toContain('sk_301') // 401 已引用
    expect(ids).not.toContain('sk_308') // 草稿、首发审核中
    expect(ids).not.toContain('sk_302') // 市场技能
    expect(ids).toEqual(['sk_305'])
  })
})

describe('移除技能前预检：被本岗位自动化任务引用时回拦截文案（修改点 1）', () => {
  it('没有任务引用 → 回空串（可以移除）', async () => {
    expect(await checkDetachPositionSkill(401, 'sk_301')).toBe('')
  })

  it('任务引用着 → 回 PRD 原句；移除接口兜底拦截给同一句', async () => {
    await letTaskUseSkill301()
    const msg = '「日报周报生成」正被自动化任务「每日经营晨报」引用，请先从任务里移除'
    expect(await checkDetachPositionSkill(401, 'sk_301')).toBe(msg)
    await expect(detachPositionSkill(401, 'sk_301')).rejects.toThrow(msg)
  })
})

describe('移除专家 / 专家团前预检：是本岗位任务的执行对象时回拦截文案（修改点 2）', () => {
  it('团 304 是任务 7002 的执行对象 → 回 PRD 原句；移除接口兜底拦截给同一句', async () => {
    const msg = '「经营复盘团」正被自动化任务「周度经营复盘提醒」使用，请先修改任务的执行动作'
    expect(await checkUnbindPositionTeam(401, 304)).toBe(msg)
    await expect(unbindPositionTeam(401, 304)).rejects.toThrow(msg)
  })

  it('没有任务用的专家 → 回空串（可以移除）', async () => {
    expect(await checkUnbindPositionExpert(401, 205)).toBe('')
  })
})

describe('执行对象候选附带名称表（修改点 3：所选对象不可用时显示名称）', () => {
  it('names 覆盖不在候选里的对象：未发布的团 303 不在 teams 里，但 names.TEAM 能查到「岗位协同团」', async () => {
    const res = await listTaskExecTargetCandidates(401)
    expect(res.teams.map((t) => t.teamId)).not.toContain(303)
    expect(res.names.TEAM['303']).toBe('岗位协同团')
    expect(res.names.EXPERT['205']).toBe('经营数据核查专家')
  })
})

describe('岗位「技能」页签的技能分类（修改点 15：删除分类后技能显示「未分类」）', () => {
  it('技能的分类在字段字典里被删 → 岗位详情技能行 displayCategoryName 为空（页签显示「未分类」）；分类加回后照常显示', async () => {
    const cat = _getRaw('sk_301').category
    const before = getFieldOptionNames('skillCategory')
    expect(before).toContain(cat) // 前提：种子 sk_301 的分类是有效选项
    const rowOf = async () => (await getPosition(401)).skills.find((s) => s.skillId === 'sk_301')
    try {
      await saveFieldOptions('skillCategory', before.filter((n) => n !== cat))
      expect((await rowOf()).displayCategoryName).toBe('')
    } finally {
      await saveFieldOptions('skillCategory', before)
    }
    expect((await rowOf()).displayCategoryName).toBe(cat)
  })
})

describe('没设主理人的专家团可作执行对象（R13-6，md §7.6 / §9.1）', () => {
  it('通用团 302「知识问答团」没设主理人 → 照样在执行对象候选里（leaderId 为 null）', async () => {
    const team = (await listTaskExecTargetCandidates(401)).teams.find((t) => t.teamId === 302)
    expect(team).toMatchObject({ name: '知识问答团', leaderId: null })
  })

  it('任务交给 302 执行 → 发布前检查不出「执行对象不可用」阻断行', async () => {
    const t = await getSampleTask(401, 7002)
    await updateSampleTask(401, 7002, { ...t, execType: 'TEAM', execTargetId: 302 })
    expect((await getSampleTask(401, 7002)).execTargetId).toBe(302) // 前提：确实改成了 302
    expect((await getPositionExperts(401)).execTargetIssues).toEqual([])
  })
})

describe('执行方式为专家 / 专家团时引用技能不下发（R13-7，md §7.6 / §7.8 / §6.3）', () => {
  it('专家团执行的任务带着引用技能保存 → 落库的 skillRefs 为空；岗位移除该技能不再被拦', async () => {
    const t = await getSampleTask(401, 7002)
    expect(t.execType).toBe('TEAM') // 前提：7002 交给团 304 执行
    await updateSampleTask(401, 7002, { ...t, skillRefs: [{ platformSkillId: 'sk_301', name: '日报周报生成' }] })
    expect((await getSampleTask(401, 7002)).skillRefs).toEqual([])
    expect(await checkDetachPositionSkill(401, 'sk_301')).toBe('')
  })

  it('执行方式为技能的任务 → 引用技能照常保存（对照）', async () => {
    await letTaskUseSkill301()
    expect((await getSampleTask(401, 7001)).skillRefs.map((r) => r.platformSkillId)).toContain('sk_301')
  })
})
