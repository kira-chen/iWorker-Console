// @vitest-environment jsdom
// （unifiedSkillMock → request.js → router 链路触达 window，故用 jsdom，同 fieldDictMock.test.js）
import { describe, it, expect } from 'vitest'

/**
 * 技能模块内存 mock（unifiedSkillMock.js）单测——2026-09-01 PRD 对齐改造新增。
 *
 * 覆盖：三态+pendingAction 状态机（提交发布→审核中·停在审核中；撤回按 version 空/非空恢复；
 * 停用→停用审核）、引用拦截（删除/停用）、列表筛选（类型/三态/分类/关键词）、
 * 版本历史（最后启用版守卫 + 启用互斥）、创建/导入（分类必选）、文件层基础能力、示例问题 AI 生成。
 *
 * 注意：mock 是模块级共享内存，用例间共享状态——每条用例自建技能行或用 _reset 复位，
 * 不依赖种子行的可变状态（vitest 随机顺序会暴露隐式顺序依赖）。
 */
import * as mock from '@/api/unifiedSkillMock'
import { derivePlatformState } from '@/utils/skillPublication'

const CAT = '办公效率'

async function mkSkill(over = {}) {
  const { skillId } = await mock.createSkill({ name: over.name || '测试技能', type: over.type || 'PLATFORM', categoryName: CAT })
  return skillId
}

describe('创建 / 导入（分类必选，fieldDict 同源校验）', () => {
  it('手动创建：缺名/缺类型/缺分类均拒绝；成功返回 skillId 且落 8 类之一', async () => {
    await expect(mock.createSkill({ name: '', type: 'PLATFORM', categoryName: CAT })).rejects.toThrow('请填写技能名')
    await expect(mock.createSkill({ name: 'x', type: '', categoryName: CAT })).rejects.toThrow('请选择技能类型')
    await expect(mock.createSkill({ name: 'x', type: 'PLATFORM', categoryName: '' })).rejects.toThrow('请选择技能分类')
    await expect(mock.createSkill({ name: 'x', type: 'PLATFORM', categoryName: '不存在的分类' })).rejects.toThrow('技能分类不存在')
    const id = await mkSkill({ name: '新建A' })
    const detail = await mock.getSkillDetail(id)
    expect(detail.name).toBe('新建A')
    expect(detail.displayCategoryId).toBe(CAT)
    expect(detail.publications).toEqual([]) // 初始未发布
  })

  it('zip 导入：非 .zip 拒绝、每包分类必选；成功以包名为技能名', async () => {
    await expect(mock.importSkillZip({ fileName: 'a.tar', type: 'PLATFORM', categoryName: CAT })).rejects.toThrow('仅支持 .zip')
    await expect(mock.importSkillZip({ fileName: 'a.zip', type: 'PLATFORM', categoryName: '' })).rejects.toThrow('请为技能包选择分类')
    const vo = await mock.importSkillZip({ fileName: '行业报告助手.zip', type: 'SYSTEM_DEFAULT', categoryName: CAT })
    const detail = await mock.getSkillDetail(vo.skillId)
    expect(detail.name).toBe('行业报告助手')
    expect(detail.type).toBe('SYSTEM_DEFAULT')
    // 导入包自带入口 SKILL.md（编辑页可直接打开）
    const tree = await mock.listSkillFiles(vo.skillId)
    expect(tree.files.some((f) => f.path === 'SKILL.md')).toBe(true)
  })
})

describe('三态 + pendingAction 状态机', () => {
  it('首发提交 → PENDING_REVIEW（审核中·停在审核中，demo 不落审核结论）', async () => {
    const id = await mkSkill()
    await mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })
    const { publications } = await mock.getSkillDetail(id)
    expect(derivePlatformState(publications)).toBe('REVIEWING')
    // 已有在审提交 → 再次提交被拒（409 语义）
    await expect(mock.publishSkill(id, { bump: 'NONE', releaseNotes: 'x' })).rejects.toThrow('已有在审提交')
  })

  it('升级说明必填：空 releaseNotes 拒绝提交', async () => {
    const id = await mkSkill()
    await expect(mock.publishSkill(id, { bump: 'NONE', releaseNotes: '  ' })).rejects.toThrow('升级说明必填')
  })

  it('撤回：version 空 → 恢复未发布（INITIAL）', async () => {
    const id = await mkSkill()
    await mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })
    await mock.withdrawPublish(id)
    const { publications } = await mock.getSkillDetail(id)
    expect(derivePlatformState(publications)).toBe('INITIAL')
    expect(mock._getRaw(id).pendingAction).toBeNull()
    expect(mock._getRaw(id).pendingVersion).toBe('')
    expect(mock._getRaw(id).pendingReleaseNotes).toBe('')
  })

  it('已发布提新版 → PUBLISHED_REVIEWING；撤回 → 恢复已发布（version 非空）', async () => {
    // 用种子 302（已发布 v1.4.0）：先确保无 pending，再提交新版
    mock._reset('sk_302', { pendingAction: null, pendingVersion: '', pendingReleaseNotes: '' })
    await mock.publishSkill('sk_302', { bump: 'MINOR', releaseNotes: '新增能力' })
    let pubs = (await mock.getSkillDetail('sk_302')).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED_REVIEWING')
    expect(mock._getRaw('sk_302').pendingVersion).toBe('v1.5.0') // MINOR 进位
    await mock.withdrawPublish('sk_302')
    pubs = (await mock.getSkillDetail('sk_302')).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED')
  })

  it('停用 → 停用审核（PUBLISHED_DELISTING，归「审核中」）；撤回恢复已发布', async () => {
    // 种子 303 已发布且无引用
    mock._reset('sk_303', { pendingAction: null })
    await mock.delistSkill('sk_303')
    let pubs = (await mock.getSkillDetail('sk_303')).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED_DELISTING')
    await mock.withdrawPublish('sk_303')
    pubs = (await mock.getSkillDetail('sk_303')).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED')
  })

  it('nextVersionLabel：无版本 → v1.0.0；有版本 → patch+1', async () => {
    const id = await mkSkill()
    expect(await mock.nextVersionLabel(id)).toBe('v1.0.0')
    expect(await mock.nextVersionLabel('sk_301')).toBe('v1.2.1') // 种子 v1.2.0
  })

  it('bumpVersion：NONE=patch+1 / MINOR / MAJOR / 无历史=v1.0.0', () => {
    expect(mock.bumpVersion('', 'NONE')).toBe('v1.0.0')
    expect(mock.bumpVersion('v1.2.3', 'NONE')).toBe('v1.2.4')
    expect(mock.bumpVersion('v1.2.3', 'MINOR')).toBe('v1.3.0')
    expect(mock.bumpVersion('v1.2.3', 'MAJOR')).toBe('v2.0.0')
  })
})

describe('引用拦截（删除 / 停用）', () => {
  it('被引用技能删除被拒，错误 message 携引用主体与清单', async () => {
    // 种子 301：岗位私有，被 2 个岗位引用（2026-09-02 种子自洽治理：refNames 与 positionMock 同源）
    await expect(mock.removeSkill('sk_301')).rejects.toThrow(/2 个岗位引用/)
    await expect(mock.removeSkill('sk_301')).rejects.toThrow(/经营分析岗/)
    // 种子 302：市场技能，被 3 个专家引用 → 停用同拦
    mock._reset('sk_302', { pendingAction: null })
    await expect(mock.delistSkill('sk_302')).rejects.toThrow(/3 个专家引用.*停用/)
  })

  it('无引用技能可删除；删除后详情 404', async () => {
    const id = await mkSkill({ name: '一次性技能' })
    await mock.removeSkill(id)
    await expect(mock.getSkillDetail(id)).rejects.toThrow('技能不存在')
  })
})

describe('列表：筛选 + 三态 + 默认按最近更新时间由近到远', () => {
  it('type / 三态 status / categoryId / keyword 各自生效', async () => {
    const byType = await mock.listUnifiedSkills({ type: 'POSITION', size: 100 })
    expect(byType.list.every((r) => r.type === 'POSITION')).toBe(true)

    const reviewing = await mock.listUnifiedSkills({ status: 'REVIEWING', size: 100 })
    expect(reviewing.list.length).toBeGreaterThan(0)

    const byCat = await mock.listUnifiedSkills({ categoryId: '数据分析', size: 100 })
    expect(byCat.list.every((r) => r.displayCategoryName === '数据分析')).toBe(true)

    const byKw = await mock.listUnifiedSkills({ keyword: '合同', size: 100 })
    expect(byKw.list.some((r) => r.name.includes('合同'))).toBe(true)
  })

  it('默认按 updatedAt 由近到远；行 VO 携发布就绪所需字段（icon/描述/示例问题/hasSkillMd）', async () => {
    const { list } = await mock.listUnifiedSkills({ size: 100 })
    const times = list.map((r) => r.updatedAt)
    expect([...times].sort().reverse()).toEqual(times)
    const seed = list.find((r) => r.id === 'sk_301')
    expect(seed.icon).toBeTruthy()
    expect(seed.refNames.length).toBe(seed.refCount)
    expect(typeof seed.hasSkillMd).toBe('boolean')
  })

  it('referenced 布尔筛选（岗位私有深链口径）', async () => {
    const yes = await mock.listUnifiedSkills({ type: 'POSITION', referenced: true, size: 100 })
    expect(yes.list.every((r) => r.refCount > 0)).toBe(true)
    const no = await mock.listUnifiedSkills({ type: 'POSITION', referenced: false, size: 100 })
    expect(no.list.every((r) => r.refCount === 0)).toBe(true)
  })
})

describe('版本历史：最后启用版守卫 + 启用互斥', () => {
  it('唯一启用版本禁「禁用」（守卫 tip 文案）；有多个启用位时可禁用', async () => {
    // 种子 303 只有一个 ACTIVE 快照
    await expect(mock.delistSnapshot('sk_303', 'v2.1.0')).rejects.toThrow(
      '当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能'
    )
  })

  it('启用历史版本 = 互斥启用（其余启用版本自动禁用，对齐原型 toggleHistory）', async () => {
    // 种子 301：v1.2.0 ACTIVE + v1.1.0 DELISTED
    await mock.relistSnapshot('sk_301', 'v1.1.0')
    const rows = await mock.listSnapshots('sk_301')
    const active = rows.filter((r) => r.status === 'ACTIVE')
    expect(active.map((r) => r.version)).toEqual(['v1.1.0'])
    expect(rows.find((r) => r.version === 'v1.2.0').status).toBe('DELISTED')
    // 复原（恢复种子态，防跨用例串扰）
    await mock.relistSnapshot('sk_301', 'v1.2.0')
  })
})

describe('文件层基础能力（编辑页可打开/可改/可存）', () => {
  it('列树含入口；读写往返一致；新建文件入树；SKILL.md 不可删不可改名', async () => {
    const id = await mkSkill({ name: '文件测试' })
    const tree = await mock.listSkillFiles(id)
    expect(tree.entryPath).toBe('SKILL.md')

    await mock.saveSkillFile(id, { path: 'SKILL.md', content: '# 正文' })
    expect((await mock.getSkillFile(id, 'SKILL.md')).content).toBe('# 正文')

    const vo = await mock.saveSkillFile(id, { path: 'references/说明.md', content: 'ref' })
    expect(vo.treeChanged).toBe(true)
    expect(vo.tree.files.some((f) => f.path === 'references/说明.md')).toBe(true)

    await expect(mock.deleteSkillFile(id, 'SKILL.md')).rejects.toThrow('不可删除')
    await expect(mock.renameSkillFile(id, { fromPath: 'SKILL.md', toPath: 'a.md' })).rejects.toThrow('不可改名')
    await mock.renameSkillFile(id, { fromPath: 'references/说明.md', toPath: 'references/说明2.md' })
    expect((await mock.getSkillFile(id, 'references/说明2.md')).content).toBe('ref')
    await mock.deleteSkillFile(id, 'references/说明2.md')
    await expect(mock.getSkillFile(id, 'references/说明2.md')).rejects.toThrow('文件不存在')
  })

  it('保存正文（updateSkill.skillMd）后列表 hasSkillMd 与更新时间联动', async () => {
    const id = await mkSkill({ name: '正文联动' })
    let row = (await mock.listUnifiedSkills({ keyword: '正文联动', size: 10 })).list[0]
    expect(row.hasSkillMd).toBe(false) // 手动新建为空 SKILL.md
    await mock.updateSkill(id, { skillMd: '# hi' })
    row = (await mock.listUnifiedSkills({ keyword: '正文联动', size: 10 })).list[0]
    expect(row.hasSkillMd).toBe(true)
  })
})

describe('编辑保存门（mock 兜底校验）与示例问题 AI 生成', () => {
  it('updateSkill：名称必填≤64 / 描述≤2000 / 示例问题≤60', async () => {
    const id = await mkSkill()
    await expect(mock.updateSkill(id, { name: ' ' })).rejects.toThrow('技能名称不能为空')
    await expect(mock.updateSkill(id, { name: 'x'.repeat(65) })).rejects.toThrow('64')
    await expect(mock.updateSkill(id, { description: 'x'.repeat(2001) })).rejects.toThrow('2000')
    await expect(mock.updateSkill(id, { exampleQuestion: 'x'.repeat(61) })).rejects.toThrow('60')
  })

  it('AI 生成：从固定例句生成；同一技能重复点击轮换（覆盖式重新生成可感知）', async () => {
    const a = await mock.aiGenerateExampleQuestion({ id: 'sk_x', name: '日报', description: '整理' })
    const b = await mock.aiGenerateExampleQuestion({ id: 'sk_x', name: '日报', description: '整理' })
    expect(a.question).toBeTruthy()
    expect(a.question.length).toBeLessThanOrEqual(60)
    expect(b.question).not.toBe(a.question) // 轮换 → 覆盖可感知
  })

  it('toolPicker 按类型过滤（MCP/API/BIZ_SYSTEM），关键词可搜', async () => {
    const mcp = await mock.toolPicker({ type: 'MCP' })
    expect(mcp.length).toBeGreaterThan(0)
    expect(mcp.every((t) => t.code.startsWith('mcp__'))).toBe(true)
    const biz = await mock.toolPicker({ type: 'BIZ_SYSTEM' })
    expect(biz.some((t) => t.bizName === '人事系统')).toBe(true)
    const kw = await mock.toolPicker({ type: 'API', keyword: '客户' })
    expect(kw.map((t) => t.bizName)).toEqual(['客户数据 API'])
  })
})
