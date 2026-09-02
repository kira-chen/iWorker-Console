// @vitest-environment jsdom
// （bizSystemMock → request.js → router 链路触达 window，故用 jsdom；同 fieldDictMock.test.js）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写/删除的行（biz_2102/biz_2103）；
// 软引用删除用例专删 biz_2101；状态机用例各自新建专属行自洽驱动。
import { describe, it, expect } from 'vitest'
import {
  listBizSystems,
  getBizSystem,
  createBizSystem,
  deleteBizSystem,
  publishBizSystem,
  withdrawBizSystem,
  deactivateBizSystem,
  approveBizSystem,
  listBizSystemSkills,
  createBizSystemOwnedSkill,
  deleteBizSystemOwnedSkill,
  aiGenerateBizExampleQuestions
} from '../bizSystemMock'

// 新建一条合法业务系统（名称唯一）
async function mk(name) {
  return createBizSystem({
    name,
    icon: '✓',
    description: '测试用业务系统',
    loginUrl: 'https://demo.example.com/login',
    bizPages: [],
    exampleQuestions: ['帮我发起一个审批', '帮我打开工作台', '帮我查一条记录']
  })
}

describe('bizSystemMock —— 业务系统三态状态机 + 软引用删除（2026-09-01 PRD 对齐轮）', () => {
  it('种子照原型 bizRows：行内直接带 display 字段（status/pendingAction/refs/icon/时间）', async () => {
    const b = await getBizSystem('biz_2102') // 审核中种子行，本文件从不改写
    expect(b.status).toBe('PENDING_REVIEW')
    expect(b.pendingAction).toBe('PUBLISH')
    expect(b.icon).toBe('▦')
    expect(b.refs).toEqual(['员工信息查询'])
    expect(b.referencedBySkillCount).toBe(1)
    expect(b.exampleQuestions).toHaveLength(3)
    expect(b.exampleQuestions.every((q) => q.trim())).toBe(true)
    expect(b.createdAt).toBeTruthy()
    expect(b.updatedAt).toBeTruthy()
  })

  it('搜索覆盖名称 + 描述（B4）；状态筛选可用', async () => {
    const byDesc = await listBizSystems({ keyword: '入转调离' })
    expect(byDesc.list.some((b) => b.name === '人力资源系统')).toBe(true)
    const byState = await listBizSystems({ state: 'PENDING_REVIEW' })
    expect(byState.list.some((b) => b.id === 'biz_2102')).toBe(true)
  })

  it('列表按最近更新时间排序（默认由近到远）', async () => {
    const a = await mk(`排序甲-${Date.now()}`)
    const b = await mk(`排序乙-${Date.now()}`)
    const { list } = await listBizSystems({ keyword: '排序' })
    const idx = (id) => list.findIndex((x) => x.id === id)
    expect(idx(b.id)).toBeLessThan(idx(a.id)) // 后建（更近更新）在前
  })

  it('必填校验：图标 / 描述 / 登录地址 / 示例问题 3 条', async () => {
    const base = {
      name: `校验-${Date.now()}`,
      icon: '✓',
      description: 'd',
      loginUrl: 'https://x.example.com',
      exampleQuestions: ['a', 'b', 'c']
    }
    await expect(createBizSystem({ ...base, icon: '' })).rejects.toMatchObject({ field: 'icon' })
    await expect(createBizSystem({ ...base, description: '' })).rejects.toMatchObject({ field: 'description' })
    await expect(createBizSystem({ ...base, loginUrl: 'notaurl' })).rejects.toMatchObject({ field: 'loginUrl' })
    await expect(createBizSystem({ ...base, exampleQuestions: ['a', '', 'c'] })).rejects.toMatchObject({
      field: 'exampleQuestions'
    })
  })

  it('状态机：发布过审→撤回回未发布→审核通过→停用过审→撤回回已发布→停用审核通过回未发布', async () => {
    const row = await mk(`状态机-${Date.now()}`)
    expect(row.status).toBe('NOT_PUBLISHED')
    // 发布 → 审核中（pendingAction=PUBLISH）
    const p = await publishBizSystem(row.id)
    expect(p.status).toBe('PENDING_REVIEW')
    expect(p.pendingAction).toBe('PUBLISH')
    // 撤回待审发布 → 未发布
    const w = await withdrawBizSystem(row.id)
    expect(w.status).toBe('NOT_PUBLISHED')
    // 再发布并审核通过 → 已发布 + publishedAt
    await publishBizSystem(row.id)
    const ok = await approveBizSystem(row.id)
    expect(ok.status).toBe('PUBLISHED')
    expect(ok.publishedAt).toBeTruthy()
    // 停用过审（B6）：状态转审核中，pendingAction=DEACTIVATE
    const d = await deactivateBizSystem(row.id)
    expect(d.status).toBe('PENDING_REVIEW')
    expect(d.pendingAction).toBe('DEACTIVATE')
    // 撤回待审停用 → 恢复已发布（B7）
    const w2 = await withdrawBizSystem(row.id)
    expect(w2.status).toBe('PUBLISHED')
    // 停用审核通过 → 未发布
    await deactivateBizSystem(row.id)
    const done = await approveBizSystem(row.id)
    expect(done.status).toBe('NOT_PUBLISHED')
  })

  it('软引用删除（B8）：被技能引用亦可删', async () => {
    const before = await getBizSystem('biz_2101')
    expect(before.referencedBySkillCount).toBeGreaterThan(0)
    await expect(deleteBizSystem('biz_2101')).resolves.toEqual({})
    await expect(getBizSystem('biz_2101')).rejects.toThrow('不存在')
  })

  it('专属技能（BQ1 保留）：新建 → 列表 → 删除', async () => {
    const created = await createBizSystemOwnedSkill('biz_2102', { name: '入职材料核对' })
    expect(created.skillId).toBeTruthy()
    let skills = await listBizSystemSkills('biz_2102')
    expect(skills.some((s) => s.skillId === created.skillId)).toBe(true)
    await deleteBizSystemOwnedSkill('biz_2102', created.skillId)
    skills = await listBizSystemSkills('biz_2102')
    expect(skills.some((s) => s.skillId === created.skillId)).toBe(false)
  })

  it('示例问题 AI 生成（BQ4）：一次 3 条、每条 ≤60', async () => {
    const res = await aiGenerateBizExampleQuestions({ name: '客户管理系统', description: '管理客户资料' })
    expect(res.questions).toHaveLength(3)
    expect(res.questions.every((q) => q && q.length <= 60)).toBe(true)
  })
})
