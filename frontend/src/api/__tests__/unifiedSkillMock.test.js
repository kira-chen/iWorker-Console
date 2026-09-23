// @vitest-environment jsdom
// （unifiedSkillMock → request.js → router 链路触达 window，故用 jsdom，同 fieldDictMock.test.js）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 技能模块内存 mock（unifiedSkillMock.js）单测——2026-09-01 PRD 对齐改造新增。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/技能/prd.技能.md §二.1/§二.2/§二.3/§四.3、
 * 一览表 §三 L58-62（保存门）/ L328-330（AI 生成）。
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
  it('手动创建：缺名/缺类型/缺分类均拒绝；成功返回 skillId 且落 11 类之一', async () => {
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

  it('zip 导入：skill.md 内 name 全局唯一——同名包（含种子行、同批后续包）均拒绝，提示携具体名称', async () => {
    // 命中种子行 sk_301（日报周报生成）：skillMdName 默认取种子 name，视同已占用。
    await expect(
      mock.importSkillZip({ fileName: '日报周报生成.zip', type: 'PLATFORM', categoryName: CAT })
    ).rejects.toThrow('当前已有同名技能：日报周报生成')
    // 首个包成功导入后，同批次后续同名包同样命中（skills 数组已写入，天然覆盖同批重名）。
    await mock.importSkillZip({ fileName: '批量重名校验.zip', type: 'PLATFORM', categoryName: CAT })
    await expect(
      mock.importSkillZip({ fileName: '批量重名校验.zip', type: 'PLATFORM', categoryName: CAT })
    ).rejects.toThrow('当前已有同名技能：批量重名校验')
    // 手动创建的技能 SKILL.md 尚为空、不占用 name 命名空间，zip 导入同名不受影响。
    await mkSkill({ name: '手动同名技能' })
    await expect(
      mock.importSkillZip({ fileName: '手动同名技能.zip', type: 'PLATFORM', categoryName: CAT })
    ).resolves.toMatchObject({ name: '手动同名技能' })
  })
})

describe('三态 + pendingAction 状态机', () => {
  it('首发提交 → PENDING_REVIEW（审核中·停在审核中，demo 不落审核结论）', async () => {
    const id = await mkSkill()
    await mock.updateSkill(id, { skillMd: '# 正文\n\n最小可发布内容。' })
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

  it('SKILL.md 正文为空不可提交发布（md §三.3 L79，2026-09-23 待办 yuepu#7①）', async () => {
    const id = await mkSkill() // 手动创建默认 SKILL.md 为空
    await expect(mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })).rejects.toThrow('SKILL.md')
  })

  it('撤回：version 空 → 恢复未发布（INITIAL）', async () => {
    const id = await mkSkill()
    await mock.updateSkill(id, { skillMd: '# 正文\n\n最小可发布内容。' })
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
    // 删除仅在「未发布」态展示（md §二.4 L122），故用未发布 + 手动置引用的行验证引用拦截，
    // 不能借已发布的种子 301（会先撞状态守卫，见下方「删除/停用状态守卫」describe）
    const id = await mkSkill({ type: 'POSITION' })
    mock._reset(id, { refNames: ['经营分析岗', '财务审核岗'] })
    await expect(mock.removeSkill(id)).rejects.toThrow(/2 个岗位引用/)
    await expect(mock.removeSkill(id)).rejects.toThrow(/经营分析岗/)
    // 种子 302：市场技能，已发布，被 3 个专家引用 → 停用同拦
    mock._reset('sk_302', { pendingAction: null })
    await expect(mock.delistSkill('sk_302')).rejects.toThrow(/3 个专家引用.*停用/)
  })

  it('无引用技能可删除；删除后详情 404', async () => {
    const id = await mkSkill({ name: '一次性技能' })
    await mock.removeSkill(id)
    await expect(mock.getSkillDetail(id)).rejects.toThrow('技能不存在')
  })
})

describe('删除/停用状态守卫（md §二.4 L122 / §三.5 L94，2026-09-23 待办 yuepu#7①）', () => {
  it('已发布技能不可删除，即使无引用（此前无守卫会连版本快照一起删没）', async () => {
    // 种子 303：已发布、SYSTEM_DEFAULT、无引用
    await expect(mock.removeSkill('sk_303')).rejects.toMatchObject({ code: 40907 })
    expect(await mock.getSkillDetail('sk_303')).toBeTruthy() // 未被误删
  })

  it('审核中技能不可删除', async () => {
    const id = await mkSkill()
    await mock.updateSkill(id, { skillMd: '# 正文' })
    await mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })
    await expect(mock.removeSkill(id)).rejects.toMatchObject({ code: 40907 })
  })

  it('未发布（草稿）技能不可提交停用审核，避免造出 PUBLISHED+DELIST 假态', async () => {
    const id = await mkSkill()
    await expect(mock.delistSkill(id)).rejects.toMatchObject({ code: 40908 })
    expect(mock._getRaw(id).pendingAction).toBeNull() // 未被误置为 stop
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

  it('sort=asc → 全量按最近更新时间由远到近再切页（md §二.2 L54 点击列头切换升降序）', async () => {
    const asc = await mock.listUnifiedSkills({ sort: 'asc', size: 100 })
    const times = asc.list.map((r) => r.updatedAt)
    expect([...times].sort()).toEqual(times)
    expect(times.length).toBeGreaterThan(1)
    // asc 与 desc 是同一全量集合、方向相反（同分钟并列行不保证稳定序，故比时间序列与 id 集合）
    const desc = await mock.listUnifiedSkills({ sort: 'desc', size: 100 })
    expect(desc.list.map((r) => r.updatedAt).reverse()).toEqual(times)
    expect(new Set(desc.list.map((r) => r.id))).toEqual(new Set(asc.list.map((r) => r.id)))
    // 排序作用于全量再切页：asc 第 1 页首行 = 全量最早更新的那一行（不是 desc 第 1 页内再倒序）
    const ascPage1 = await mock.listUnifiedSkills({ sort: 'asc', size: 2, page: 1 })
    expect(ascPage1.list[0].updatedAt).toBe(times[0])
    expect(ascPage1.list[0].updatedAt <= desc.list[0].updatedAt).toBe(true)
  })
})

describe('版本历史：最后启用版守卫 + 启用互斥', () => {
  it('唯一启用版本禁「禁用」（守卫 tip 文案）；有多个启用位时可禁用', async () => {
    // 种子 303 只有一个 ACTIVE 快照
    await expect(mock.delistSnapshot('sk_303', 'v2.1.0')).rejects.toThrow(
      '当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能'
    )
  })

  it('启用历史版本 = 互斥启用（其余启用版本自动禁用；md §四.3 L252-255 同一技能同一时间最多一个已启用）', async () => {
    // 种子 301：v1.2.0 ACTIVE + v1.1.0 DELISTED
    await mock.relistSnapshot('sk_301', 'v1.1.0')
    const rows = await mock.listSnapshots('sk_301')
    const active = rows.filter((r) => r.status === 'ACTIVE')
    expect(active.map((r) => r.version)).toEqual(['v1.1.0'])
    expect(rows.find((r) => r.version === 'v1.2.0').status).toBe('DELISTED')
    // 复原（恢复种子态，防跨用例串扰）
    await mock.relistSnapshot('sk_301', 'v1.2.0')
  })

  it('listSnapshots 归一化：种子旧字段 size/publisher/notes/disabledAt → sizeBytes/publishedBy/releaseNotes/delistedAt（md L250；09-09 P1 防回归）', async () => {
    // 种子 301：v1.2.0 ACTIVE '18.6 KB' + v1.1.0 DELISTED 禁用于 2026-08-23 10:15
    // （上一条互斥启用用例会改 disabledAt，这里按种子原样钉回，保证独立可跑）
    mock._reset('sk_301', {
      snapshots: [
        { version: 'v1.2.0', status: 'ACTIVE', size: '18.6 KB', publisher: '管理员', publishedAt: '2026-08-23 18:10', disabledAt: '', notes: '当前线上版本' },
        { version: 'v1.1.0', status: 'DELISTED', size: '17.9 KB', publisher: '管理员', publishedAt: '2026-08-20 16:30', disabledAt: '2026-08-23 10:15', notes: '历史稳定版本' }
      ]
    })
    const rows = await mock.listSnapshots('sk_301')
    const v120 = rows.find((r) => r.version === 'v1.2.0')
    const v110 = rows.find((r) => r.version === 'v1.1.0')
    // 文件大小：'18.6 KB' 展示串还原为字节数，供 VersionHistoryList fmtSize
    expect(v120.sizeBytes).toBe(Math.round(18.6 * 1024))
    expect(v120.publishedBy).toBe('管理员')
    expect(v120.releaseNotes).toBe('当前线上版本')
    expect(v120.delistedAt).toBe('')
    expect(v110.delistedAt).toBe('2026-08-23 10:15')
    expect(v110.releaseNotes).toBe('历史稳定版本')
    // 版本号双名（versionLabel/verLabel）与旧名 size 一并保留，其它消费点不被动改
    expect(v120.versionLabel).toBe('v1.2.0')
    expect(v120.verLabel).toBe('v1.2.0')
    expect(v120.size).toBe('18.6 KB')
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

describe('审核锁定写守卫（md §二.2 L120 / §三.1 L141，2026-09-12 审计 K20）', () => {
  it('在审技能（publish / stop 两种 pendingAction）→ updateSkill / setSkillCategory / saveSkillFile / deleteSkillFile / renameSkillFile 一律 40900「技能审核中，已锁定不可修改」，撤回后放行', async () => {
    const id = await mkSkill({ name: '锁定测试' })
    await mock.saveSkillFile(id, { path: 'SKILL.md', content: '# 正文' })
    await mock.saveSkillFile(id, { path: 'references/a.md', content: 'a' })
    await mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })
    const locked = { code: 40900, message: '技能审核中，已锁定不可修改' }
    await expect(mock.updateSkill(id, { name: '改名' })).rejects.toMatchObject(locked)
    await expect(mock.setSkillCategory(id, CAT)).rejects.toMatchObject(locked)
    await expect(mock.saveSkillFile(id, { path: 'SKILL.md', content: '# 改' })).rejects.toMatchObject(locked)
    await expect(mock.deleteSkillFile(id, 'references/a.md')).rejects.toMatchObject(locked)
    await expect(mock.renameSkillFile(id, { fromPath: 'references/a.md', toPath: 'references/b.md' })).rejects.toMatchObject(locked)
    expect((await mock.getSkillDetail(id)).name).toBe('锁定测试') // 未被改动
    // 撤回 → 解锁
    await mock.withdrawPublish(id)
    expect((await mock.updateSkill(id, { name: '改名' })).name).toBe('改名')
    // 停用审核中（pendingAction='stop'）同样锁定：用种子 309（停用在审）
    await expect(mock.updateSkill('sk_309', { description: 'x' })).rejects.toMatchObject(locked)
  })
})

describe('种子自洽（md §二.3.4 L226-229 在审版本号由线上版本自动递增，2026-09-12 审计 K19）', () => {
  it('所有在审发布行：pendingVersion 必须等于 bumpVersion(version, NONE|MINOR|MAJOR) 之一（sk_302 v1.4.0 → v1.5.0）', async () => {
    const reviewing = ['sk_301', 'sk_302', 'sk_303', 'sk_304', 'sk_305', 'sk_306', 'sk_307', 'sk_308', 'sk_309']
      .map((id) => mock._getRaw(id))
      .filter((r) => r && r.pendingAction === 'publish')
    expect(reviewing.length).toBeGreaterThan(0)
    for (const r of reviewing) {
      const legal = ['NONE', 'MINOR', 'MAJOR'].map((b) => mock.bumpVersion(r.version, b))
      expect(legal, `${r.id} 在审 ${r.pendingVersion} 应由线上 ${r.version || '(无)'} 递增得出`).toContain(r.pendingVersion)
    }
    const s302 = mock._getRaw('sk_302')
    if (s302.pendingAction === 'publish') expect(s302.pendingVersion).toBe('v1.5.0')
  })
})

describe('编辑保存门（mock 兜底校验）与示例问题 AI 生成', () => {
  it('updateSkill：名称必填≤64 / 描述≤2000 / 示例问题≤300（2026-09-18 待办 yuepu#5⑥，原 60）', async () => {
    const id = await mkSkill()
    await expect(mock.updateSkill(id, { name: ' ' })).rejects.toThrow('技能名称不能为空')
    await expect(mock.updateSkill(id, { name: 'x'.repeat(65) })).rejects.toThrow('64')
    await expect(mock.updateSkill(id, { description: 'x'.repeat(2001) })).rejects.toThrow('2000')
    await expect(mock.updateSkill(id, { exampleQuestion: 'x'.repeat(301) })).rejects.toThrow('300')
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

describe('unifiedSkillMock · 持久化读回（mockPersist v6，2026-09-23 待办 yuepu#9⑤ bump；key iworker-demo-mock:unifiedSkill）', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 故与 sampleTaskMock.test 同款注入内存版存储，用 vi.resetModules + 动态 import 模拟「写入 → 刷新 → 重载」。
  const KEY = 'iworker-demo-mock:unifiedSkill'
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
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('createSkill 落盘（v=6）→ 重新 import 模块（模拟刷新）→ 列表仍含新建技能', async () => {
    const first = await import('@/api/unifiedSkillMock')
    const { skillId } = await first.createSkill({ name: '读回验证技能', type: 'PLATFORM', categoryName: CAT })
    expect(JSON.parse(globalThis.localStorage.getItem(KEY)).v).toBe(6)
    vi.resetModules()
    const fresh = await import('@/api/unifiedSkillMock')
    const { list } = await fresh.listUnifiedSkills({ keyword: '读回验证技能', size: 10 })
    expect(list.map((r) => r.id)).toContain(skillId)
    expect((await fresh.getSkillDetail(skillId)).name).toBe('读回验证技能')
  })

  it('存量 version≠3 快照 → 启动时丢弃、回代码种子（sk_301 在、伪造行不在），旧 key 被清掉', async () => {
    globalThis.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 2, data: { idSeq: 9999, skills: [{ id: 'sk_fake', name: '伪造行', type: 'PLATFORM' }], exampleCursor: {}, reviewSnapshots: {} } })
    )
    const fresh = await import('@/api/unifiedSkillMock')
    const { list } = await fresh.listUnifiedSkills({ size: 100 })
    expect(list.some((r) => r.id === 'sk_301')).toBe(true)
    expect(list.some((r) => r.id === 'sk_fake')).toBe(false)
    // mockPersist 版本不符即 removeItem；之后尚无写点，key 应为空
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
  })
})
