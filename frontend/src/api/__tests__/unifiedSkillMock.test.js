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
// 静态顶层导入（不用 await import()）：本文件末尾的「持久化读回」块会 vi.resetModules()，
// 动态 import 在那之后拿到的会是另一个模块实例，跟 unifiedSkillMock 内部静态 import 的
// mcpConnectorMock 对不上（同 positionMock.test.js 排查过的同一类坑，2026-09-23 待办 yuepu#10②）
import { createMcp, deleteMcp, publishMcpService, delistMcpService, applyMcpReviewResult } from '@/api/mcpConnectorMock'
import { listApisSync, getApi, updateApi, deactivateApi, applyApiReviewResult, __resetApiMock } from '@/api/apiConnectorMock'
import { deactivateBizSystem, approveBizSystem, __resetBizSystemMock } from '@/api/bizSystemMock'
import { opsRecords, resetAccessAuditMock } from '@/api/accessAuditMock'
import { listReviews } from '@/api/reviewsMock'
import { getFieldOptionNames, saveFieldOptions } from '@/api/fieldDictMock'

const CAT = '办公效率'
const pubState = (d) => derivePlatformState(d.publications)

async function mkSkill(over = {}) {
  const { skillId } = await mock.createSkill({ name: over.name || '测试技能', type: over.type || 'PLATFORM', categoryName: CAT })
  // 图标必填、发布前须已选（待办 yuepu#18①）：createSkill 建的是无图标草稿，默认补一个；无图标场景传 icon: null
  if (over.icon !== null) await mock.updateSkill(skillId, { icon: over.icon || '🧪' })
  return skillId
}

/** 自建一条「已发布」技能：提交首发 → 审核通过落地（不依赖种子行的可变状态；种子 303 被专家引用、309 停用在审）。 */
async function mkLiveSkill(over = {}) {
  const id = await mkSkill(over)
  await mock.updateSkill(id, { skillMd: '# 已发布测试\n\n正文' })
  await mock.publishSkill(id, { releaseNotes: '首发' })
  expect(mock.applySkillReviewResult(id, 'FIRST_PUBLISH', true)).toBe(true)
  return id
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

  it('图标必填（待办 yuepu#18①）：updateSkill 传空 / 空白图标被拦且原图标不变，不带 icon 键不受影响；无图标草稿提交发布被拦、补图标后放行', async () => {
    const id = await mkSkill({ icon: null }) // createSkill 建的是无图标草稿
    expect(mock._getRaw(id).icon).toBe('')
    await mock.updateSkill(id, { skillMd: '# 正文\n\n最小可发布内容。' })
    await expect(mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })).rejects.toThrow('请选择技能图标后再发布')
    for (const icon of ['', '   ', null]) {
      await expect(mock.updateSkill(id, { icon })).rejects.toThrow('请选择或上传图标')
    }
    await mock.updateSkill(id, { icon: '📘' })
    await mock.updateSkill(id, { description: '只改描述，不带 icon 键' })
    expect(mock._getRaw(id).icon).toBe('📘')
    await expect(mock.updateSkill(id, { icon: '' })).rejects.toThrow('请选择或上传图标')
    expect(mock._getRaw(id).icon).toBe('📘') // 被拦的清空不落
    await expect(mock.publishSkill(id, { bump: 'NONE', releaseNotes: '首发' })).resolves.toMatchObject({ pendingVersion: 'v1.0.0' })
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
    // 自建已发布技能（v1.0.0）。原借种子 302：它引用了审核中的人力资源系统，按产品优化需求-202611 R4 不能再提交发布
    const id = await mkLiveSkill({ name: '新版在审' })
    await mock.publishSkill(id, { bump: 'MINOR', releaseNotes: '新增能力' })
    let pubs = (await mock.getSkillDetail(id)).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED_REVIEWING')
    expect(mock._getRaw(id).pendingVersion).toBe('v1.1.0') // MINOR 进位
    await mock.withdrawPublish(id)
    pubs = (await mock.getSkillDetail(id)).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED')
  })

  it('停用 → 停用审核（PUBLISHED_DELISTING，归「审核中」）；撤回恢复已发布', async () => {
    // 自建已发布、无引用的技能（2026-11-10 起种子 303 被通用专家引用、停用会被拦，不再借种子）
    const id = await mkLiveSkill({ name: '停用撤回技能' })
    await mock.delistSkill(id)
    let pubs = (await mock.getSkillDetail(id)).publications
    expect(derivePlatformState(pubs)).toBe('PUBLISHED_DELISTING')
    await mock.withdrawPublish(id)
    pubs = (await mock.getSkillDetail(id)).publications
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

describe('重新上架状态守卫（待办 yuepu#57③）：不得绕过审核直接回到已发布', () => {
  async function mkPublished(name) {
    const id = await mkSkill({ name })
    await mock.updateSkill(id, { skillMd: '# 重新上架测试\n\n正文' })
    await mock.publishSkill(id, { releaseNotes: '首发' })
    expect(mock.applySkillReviewResult(id, 'FIRST_PUBLISH', true)).toBe(true)
    return id
  }
  const statusOf = async (id) => derivePlatformState((await mock.getSkillDetail(id)).publications)

  it('从未发布的草稿 / 审核中 / 已发布（未下架）一律拒绝，状态不变', async () => {
    const draft = await mkSkill({ name: '重新上架-草稿' })
    await expect(mock.relistSkill(draft)).rejects.toMatchObject({ code: 40909 })
    expect(await statusOf(draft)).not.toBe('PUBLISHED')

    const pending = await mkSkill({ name: '重新上架-审核中' })
    await mock.updateSkill(pending, { skillMd: '# 正文' })
    await mock.publishSkill(pending, { releaseNotes: '首发' })
    await expect(mock.relistSkill(pending)).rejects.toMatchObject({ code: 40909 })
    expect(mock._getRaw(pending).status).not.toBe('published')

    const live = await mkPublished('重新上架-已发布')
    await expect(mock.relistSkill(live)).rejects.toMatchObject({ code: 40909 })
  })

  it('被强制回收的技能须重新提交发布走审核，不能直接重新上架', async () => {
    const id = await mkPublished('重新上架-已回收')
    await mock.delistSkill(id, { forceRevoke: true, reason: '风险' })
    expect(mock.applySkillReviewResult(id, 'DELIST', true)).toBe(true) // 强制回收与停用同走审核，通过后才落「已回收」
    await expect(mock.relistSkill(id)).rejects.toMatchObject({ code: 40909 })
    expect(await statusOf(id)).not.toBe('PUBLISHED')
  })

  it('停用审核通过后的已下架技能仍可重新上架（正向保留）', async () => {
    const id = await mkPublished('重新上架-已下架')
    await mock.delistSkill(id)
    expect(mock.applySkillReviewResult(id, 'DELIST', true)).toBe(true)
    expect(await statusOf(id)).not.toBe('PUBLISHED')
    await mock.relistSkill(id)
    expect(await statusOf(id)).toBe('PUBLISHED')
  })
})

describe('强制回收（PRD 技能 §3.5.1，2026-10-12 改版：停用弹窗勾选项，同走审核，通过才生效）', () => {
  afterEach(() => resetAccessAuditMock())

  /** 自建一条「已发布」技能：提交首发 → 审核通过落地（不依赖种子行的可变状态）。 */
  async function mkPublished(name) {
    const id = await mkSkill({ name })
    await mock.updateSkill(id, { skillMd: '# 回收测试\n\n正文' })
    await mock.publishSkill(id, { releaseNotes: '首发' })
    expect(mock.applySkillReviewResult(id, 'FIRST_PUBLISH', true)).toBe(true)
    return id
  }
  const revokeSubmit = (id, reason = '风险') => mock.delistSkill(id, { forceRevoke: true, reason })

  it('前置条件：与普通停用同守卫——未发布 / 审核中 / 已有在审提交均拒绝', async () => {
    const draft = await mkSkill({ name: '未发布技能' })
    await expect(revokeSubmit(draft)).rejects.toThrow('停用仅适用于已发布状态的技能')

    const id = await mkPublished('前置条件技能')
    await mock.publishSkill(id, { releaseNotes: '迭代' }) // 已发布 + 新版在审
    await expect(revokeSubmit(id)).rejects.toThrow('已有在审提交')
    await mock.withdrawPublish(id)

    await revokeSubmit(id)
    await expect(revokeSubmit(id, '再来一次')).rejects.toThrow('已有在审提交')
  })

  it('原因必填且 ≤500 字；校验不通过时状态不变', async () => {
    const id = await mkPublished('原因校验技能')
    await expect(revokeSubmit(id, '   ')).rejects.toThrow('请输入回收原因')
    await expect(revokeSubmit(id, 'x'.repeat(501))).rejects.toThrow('最多 500 字')
    expect(pubState(await mock.getSkillDetail(id))).toBe('PUBLISHED')
    expect(mock._getRaw(id).pendingAction).toBeFalsy()
  })

  it('提交后与普通停用一致：审核中（PUBLISHED_DELISTING）、仍是已发布、不带「已回收」；审核中心落一行带强制回收原因，审核通过前不写访问审计', async () => {
    const id = await mkPublished('提交后状态技能')
    await revokeSubmit(id, '  发现越权调用  ')

    const detail = await mock.getSkillDetail(id)
    expect(derivePlatformState(detail.publications)).toBe('PUBLISHED_DELISTING')
    expect(detail.revoked).toBeNull()
    expect(mock._getRaw(id)).toMatchObject({ status: 'published', delisted: false, pendingAction: 'stop', pendingRevokeReason: '发现越权调用' })
    // 同走审核：审核中心有这条技能的停用申请行，带强制回收原因（下面断言）
    const row = (await listReviews({ keyword: '提交后状态技能', size: 10 })).list.find((r) => r.refId === id)
    expect(row).toMatchObject({ requestAction: 'FORCE_REVOKE', forceRevokeReason: '发现越权调用' }) // 勾选强制回收的停用申请，申请类型单独记为「强制回收」
    expect(opsRecords.some((x) => x.action === '强制回收' && x.target === '提交后状态技能')).toBe(false)
  })

  it('审核通过后才生效：回「未发布」（保留版本号与版本快照）、写 revoked 三字段、列表行与详情都带、清掉暂存原因', async () => {
    const id = await mkPublished('回收后状态技能')
    const before = await mock.getSkillDetail(id)
    await revokeSubmit(id, '  发现越权调用  ')
    expect(mock.applySkillReviewResult(id, 'DELIST', true)).toBe(true)

    const detail = await mock.getSkillDetail(id)
    expect(detail.revoked).toMatchObject({ reason: '发现越权调用' })
    expect(detail.revoked.at).toBeTruthy()
    expect(detail.revoked.operator).toBe('demo') // 无登录身份 → 内置演示管理员
    expect(detail.versionLabel).toBe('v1.0.0')
    expect(detail.lastPublishedAt).toBe(before.lastPublishedAt)
    expect(pubState(detail)).toBe('DELISTED') // 页面映射为「未发布」
    const { list } = await mock.listUnifiedSkills({ keyword: '回收后状态技能', status: 'UNPUBLISHED' })
    expect(list[0]).toMatchObject({ id, revoked: detail.revoked })
    expect(mock._getRaw(id).snapshots).toHaveLength(1) // 版本快照保留
    expect(mock._getRaw(id).pendingRevokeReason).toBeFalsy()
    // 未被回收的行 revoked 为 null（旧快照缺字段同口径）
    expect((await mock.getSkillDetail('sk_303')).revoked).toBeNull()
  })

  it('普通停用审核通过 → 只变未发布，不带「已回收」、不落强制回收审计', async () => {
    const id = await mkPublished('普通停用技能')
    await mock.delistSkill(id)
    mock.applySkillReviewResult(id, 'DELIST', true)
    const detail = await mock.getSkillDetail(id)
    expect(pubState(detail)).toBe('DELISTED')
    expect(detail.revoked).toBeNull()
    expect(opsRecords.some((x) => x.action === '强制回收' && x.target === '普通停用技能')).toBe(false)
  })

  it('审核驳回 / 撤回：无回收后果——仍是已发布、无 revoked、无审计，暂存原因清掉，可再提交', async () => {
    const id = await mkPublished('驳回撤回技能')
    await revokeSubmit(id, '风险A')
    mock.applySkillReviewResult(id, 'DELIST', false) // 驳回
    expect(pubState(await mock.getSkillDetail(id))).toBe('PUBLISHED')
    expect(mock._getRaw(id).pendingRevokeReason).toBeFalsy()
    expect(mock._getRaw(id).revoked).toBeFalsy()

    await revokeSubmit(id, '风险B')
    await mock.withdrawPublish(id) // 撤回
    expect(pubState(await mock.getSkillDetail(id))).toBe('PUBLISHED')
    expect(mock._getRaw(id).pendingRevokeReason).toBeFalsy()
    expect(mock._getRaw(id).revoked).toBeFalsy()
    expect(opsRecords.some((x) => x.action === '强制回收' && x.target === '驳回撤回技能')).toBe(false)

    // 撤回后改走普通停用并通过：不能沿用上次的回收原因
    await mock.delistSkill(id)
    mock.applySkillReviewResult(id, 'DELIST', true)
    expect(mock._getRaw(id).revoked).toBeFalsy()
  })

  it('被引用也能提交强制回收（不受停用的引用拦截），引用关系保持不动', async () => {
    const id = await mkPublished('被引用技能') // 市场技能：只会被专家引用（2026-11-10 起专家引用名存 expertRefNames）
    mock._reset(id, { expertRefNames: ['经营分析专家', '研究报告专家'] })
    await expect(mock.delistSkill(id)).rejects.toThrow('该技能被 2 个专家引用（经营分析专家、研究报告专家），需先解除引用后再停用。') // 普通停用被拦
    await expect(revokeSubmit(id, '安全风险')).resolves.toBeTruthy()
    mock.applySkillReviewResult(id, 'DELIST', true)
    const raw = mock._getRaw(id)
    expect(raw.expertRefNames).toEqual(['经营分析专家', '研究报告专家'])
    expect(raw.status).toBe('draft')
    expect(raw.revoked).toMatchObject({ reason: '安全风险' })
  })

  it('审核通过时写一条访问审计：模块=技能、动作=强制回收、变更内容=原因、带回收时的版本号', async () => {
    const id = await mkPublished('审计技能')
    await revokeSubmit(id, '数据泄露风险')
    mock.applySkillReviewResult(id, 'DELIST', true)
    const rec = opsRecords.find((x) => x.action === '强制回收' && x.target === '审计技能')
    expect(rec).toMatchObject({ module: '技能', detail: '数据泄露风险', version: 'v1.0.0', live: true })
  })

  // 访问审计 §6.2：操作人为提交申请的管理员（不是审核人）——A 提交、切到 B 审核通过，回收信息与审计都记 A
  it('操作人 = 提交强制回收的管理员：A 提交、演示身份切成 B 后审核通过，revoked.operator 与审计操作人都是 A', async () => {
    const id = await mkPublished('操作人技能')
    const asUser = (username) =>
      Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: (k) => (k === 'ai_assistant_user' ? JSON.stringify({ username }) : null), setItem() {}, removeItem() {}, key: () => null, length: 0 },
        writable: true,
        configurable: true
      })
    try {
      asUser('admin_a')
      await revokeSubmit(id, '越权调用')
      asUser('reviewer_b')
      expect(mock.applySkillReviewResult(id, 'DELIST', true)).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    }
    expect((await mock.getSkillDetail(id)).revoked.operator).toBe('admin_a')
    expect(opsRecords.find((x) => x.action === '强制回收' && x.target === '操作人技能').operator).toBe('admin_a')
    expect(mock._getRaw(id).pendingRevokeBy).toBeFalsy() // 落地后暂存操作人一并清掉
  })

  it('重新走发布审核：撤回 / 驳回不清 revoked，通过后清除并回到已发布', async () => {
    const id = await mkPublished('恢复技能')
    await revokeSubmit(id, '异常')
    mock.applySkillReviewResult(id, 'DELIST', true)

    await mock.publishSkill(id, { releaseNotes: '修复后重发' })
    await mock.withdrawPublish(id) // 撤回不清
    expect(mock._getRaw(id).revoked).toBeTruthy()
    expect(pubState(await mock.getSkillDetail(id))).toBe('DELISTED')

    await mock.publishSkill(id, { releaseNotes: '修复后重发' })
    mock.applySkillReviewResult(id, 'VERSION_PUBLISH', false) // 驳回不清
    expect(mock._getRaw(id).revoked).toBeTruthy()

    await mock.publishSkill(id, { releaseNotes: '修复后重发' })
    mock.applySkillReviewResult(id, 'VERSION_PUBLISH', true) // 通过 → 清
    const detail = await mock.getSkillDetail(id)
    expect(detail.revoked).toBeNull()
    expect(pubState(detail)).toBe('PUBLISHED')
    expect(detail.versionLabel).toBe('v1.0.1')
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
    // 种子 302：市场技能，已发布，被 4 个专家引用（2026-11-09 补种子专家 205）→ 停用同拦
    mock._reset('sk_302', { pendingAction: null })
    await expect(mock.delistSkill('sk_302')).rejects.toThrow(/4 个专家引用.*停用/)
  })

  it('无引用技能可删除；删除后详情 404', async () => {
    const id = await mkSkill({ name: '一次性技能' })
    await mock.removeSkill(id)
    await expect(mock.getSkillDetail(id)).rejects.toThrow('技能不存在')
  })
})

/* 2026-11-10 专家按类型引用技能：引用名分两组——refNames = 引用它的岗位（只有岗位私有技能有），expertRefNames = 引用它的专家
 * （三类技能都可能有）。列表 VO 同时给分组字段与合并字段；停用 / 删除拦截看岗位 + 全部专家引用（此前通用技能从不拦）。 */
describe('引用分组（岗位 / 专家）与通用技能的引用拦截', () => {
  const listRow = async (id) => (await mock.listUnifiedSkills({ size: 1000 })).list.find((r) => r.id === id)

  it('列表 VO · 种子 sk_301（岗位私有）：2 个岗位 + 1 个专家引用，refCount = 3，合并清单岗位在前', async () => {
    expect(await listRow('sk_301')).toMatchObject({
      positionRefNames: ['经营分析岗', '财务审核岗'],
      expertRefNames: ['经营数据核查专家'],
      refCount: 3,
      refNames: ['经营分析岗', '财务审核岗', '经营数据核查专家'],
      referencedByPositionCount: 2,
      referencedByExpertCount: 1
    })
  })

  it('列表 VO · 种子 sk_303（通用技能）被通用专家「企业知识助手」引用：refCount = 1（此前通用技能恒为 0）', async () => {
    expect(await listRow('sk_303')).toMatchObject({
      positionRefNames: [],
      expertRefNames: ['企业知识助手'],
      refCount: 1,
      refNames: ['企业知识助手'],
      referencedByPositionCount: 0,
      referencedByExpertCount: 1
    })
  })

  it('通用技能被专家引用 → 停用被拦，提示专家数与清单，状态不变', async () => {
    mock._reset('sk_303', { pendingAction: null, expertRefNames: ['企业知识助手'] })
    await expect(mock.delistSkill('sk_303')).rejects.toMatchObject({
      code: 40901,
      message: '该技能被 1 个专家引用（企业知识助手），需先解除引用后再停用。'
    })
    expect(mock._getRaw('sk_303').pendingAction).toBeNull()
  })

  it('通用技能被专家引用 → 删除被拦（未发布的通用技能），技能仍在', async () => {
    const id = await mkSkill({ name: '被专家引用的通用草稿', type: 'SYSTEM_DEFAULT' })
    mock._reset(id, { expertRefNames: ['企业知识助手', '经营分析专家'] })
    await expect(mock.removeSkill(id)).rejects.toMatchObject({
      code: 40901,
      message: '该技能被 2 个专家引用（企业知识助手、经营分析专家），需先解除引用后再删除。'
    })
    expect(await mock.getSkillDetail(id)).toBeTruthy()
  })

  it('无引用的通用技能不拦：已发布的可提交停用审核，未发布的可删除', async () => {
    const live = await mkLiveSkill({ name: '无引用的通用技能', type: 'SYSTEM_DEFAULT' })
    await mock.delistSkill(live)
    expect(pubState(await mock.getSkillDetail(live))).toBe('PUBLISHED_DELISTING')
    const draft = await mkSkill({ name: '无引用的通用草稿', type: 'SYSTEM_DEFAULT' })
    await mock.removeSkill(draft)
    await expect(mock.getSkillDetail(draft)).rejects.toThrow('技能不存在')
  })

  it('岗位私有技能同时被岗位和专家引用 → 拦截文案两组都列（岗位在前，组间分号）', async () => {
    const id = await mkSkill({ name: '岗位和专家都引用的草稿', type: 'POSITION' })
    mock._reset(id, { refNames: ['经营分析岗', '财务审核岗'], expertRefNames: ['经营数据核查专家'] })
    await expect(mock.removeSkill(id)).rejects.toThrow(
      '该技能被 2 个岗位、1 个专家引用（经营分析岗、财务审核岗；经营数据核查专家），需先解除引用后再删除。'
    )
    // 只剩专家引用也照样拦（岗位私有技能不再只看岗位引用）
    mock._reset(id, { refNames: [] })
    await expect(mock.removeSkill(id)).rejects.toThrow('该技能被 1 个专家引用（经营数据核查专家），需先解除引用后再删除。')
  })
})

describe('删除/停用状态守卫（md §二.4 L122 / §三.5 L94，2026-09-23 待办 yuepu#7①）', () => {
  it('已发布技能不可删除，即使无引用（此前无守卫会连版本快照一起删没）', async () => {
    // 自建已发布、无引用的技能（2026-11-10 起种子 303 被专家引用，不再适合做「无引用」样本）
    const id = await mkLiveSkill({ name: '已发布无引用技能' })
    await expect(mock.removeSkill(id)).rejects.toMatchObject({ code: 40907 })
    expect(await mock.getSkillDetail(id)).toBeTruthy() // 未被误删
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

// 产品优化需求-202611 修改点 15「删除别的分类后，存量数据的处理不变：技能显示"未分类"」（字段字典 md 同口径）：
// 此前列表 VO 直接用存的分类名，删掉的分类照样显示。改为按字段字典当前选项读时派生，存的原值不动。
describe('技能分类在字段字典里被删后显示「未分类」（产品优化需求-202611 修改点 15）', () => {
  it('删掉「设计多媒体」→ 用它的技能列表行 / 详情 displayCategoryName 为空（页面显示「未分类」），存的分类原值不改写；分类加回后照常显示', async () => {
    const before = getFieldOptionNames('skillCategory')
    expect(before).toContain('设计多媒体')
    const { skillId } = await mock.createSkill({ name: '分类被删的技能', type: 'PLATFORM', categoryName: '设计多媒体' })
    const rowOf = async () => (await mock.listUnifiedSkills({ keyword: '分类被删的技能', size: 100 })).list.find((r) => r.id === skillId)
    try {
      await saveFieldOptions('skillCategory', before.filter((n) => n !== '设计多媒体'))
      expect((await rowOf()).displayCategoryName).toBe('')
      expect((await mock.getSkillDetail(skillId)).displayCategoryName).toBe('')
      expect(mock._getRaw(skillId).category).toBe('设计多媒体') // 存量数据不改写
    } finally {
      await saveFieldOptions('skillCategory', before)
    }
    expect((await rowOf()).displayCategoryName).toBe('设计多媒体')
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

describe('工具引用与类别标签实时联动（md §二.1 L45 / §三.3 L173，2026-09-23 待办 yuepu#10①②）', () => {
  it('保存 SKILL.md 正文后 toolRefs/toolCount 随 @tool[code] 标记同步；类别标签跟着派生', async () => {
    const id = await mkSkill({ name: '正文工具联动' })
    let detail = await mock.getSkillDetail(id)
    expect(detail.category).toBe('QUERY') // 无工具引用时的默认（未引用写类工具视为查询类）
    expect(detail.referencedTools).toEqual([])

    await mock.updateSkill(id, { skillMd: '# 正文\n\n引用 @tool[mcp__knowledge_hub] 查资料\n' })
    detail = await mock.getSkillDetail(id)
    expect(detail.referencedTools.map((t) => t.code)).toEqual(['mcp__knowledge_hub'])
    expect(detail.referencedTools[0].bizName).toBe('企业知识库 MCP') // 实时读 mcpConnectorMock 真实种子
    let row = (await mock.listUnifiedSkills({ keyword: '正文工具联动', size: 10 })).list[0]
    expect(row.toolCount).toBe(1)

    // 换成写类工具（业务系统）→ 类别标签变操作类
    await mock.updateSkill(id, { skillMd: '# 正文\n\n@tool[biz__biz_2102]\n' })
    detail = await mock.getSkillDetail(id)
    expect(detail.category).toBe('OPERATION')

    // 删光标记 → toolCount 回 0
    await mock.updateSkill(id, { skillMd: '# 正文\n\n没有工具了\n' })
    row = (await mock.listUnifiedSkills({ keyword: '正文工具联动', size: 10 })).list[0]
    expect(row.toolCount).toBe(0)
  })

  // 2026-11-10 产品优化需求-202611 修改点 13（R4）：技能编辑页的候选放开到未发布 / 审核中（见下方 R4 describe）；
  // 不传 includeUnpublished 的默认候选（自动化任务工具清单同走本端点）仍按 yuepu#50 只列已发布的。
  // 已引用的未发布连接器不再标「已停用」：给真实连接状态 + pubState=UNPUBLISHED（「本技能已引用」区标「未发布」）。
  it('新建的 MCP 未发布时不进默认候选（yuepu#50）、已引用则回显真实连接状态并标未发布（R4）；发布通过后进默认候选、发布态变已发布', async () => {
    const created = await createMcp({ type: 'PLATFORM', name: '测试专用 MCP', description: '仅供本用例验证候选实时性', transport: 'stdio', command: 'npx', exampleQuestions: ['a', 'b', 'c'] })
    const pick = async () => (await mock.toolPicker({ type: 'MCP', keyword: '测试专用' })).map((t) => t.code)
    expect(await pick()).not.toContain(`mcp__${created.code}`) // 默认候选：未发布不列

    const id = await mkSkill({ name: '健康度联动' })
    await mock.updateSkill(id, { skillMd: `# 正文\n\n@tool[mcp__${created.code}]\n` })
    let detail = await mock.getSkillDetail(id)
    expect(detail.referencedTools[0].bizName).toBe('测试专用 MCP') // 已引用的仍回显名称
    expect(detail.referencedTools[0]).toMatchObject({ checkStatus: 'UNKNOWN', pubState: 'UNPUBLISHED' }) // 新建未探测 → 未检测；发布态未发布

    // 提交发布 + 审核通过 → 已发布，进入默认候选
    await publishMcpService(created.code)
    expect(applyMcpReviewResult(created.code, 'FIRST_PUBLISH', true)).toBe(true)
    const candidates = await mock.toolPicker({ type: 'MCP', keyword: '测试专用' })
    expect(candidates.find((t) => t.code === `mcp__${created.code}`)).toMatchObject({ bizName: '测试专用 MCP' })
    detail = await mock.getSkillDetail(id)
    expect(detail.referencedTools[0]).toMatchObject({ checkStatus: 'UNKNOWN', pubState: 'PUBLISHED' })
  })

  it('连接器被删除后已引用工具侧回落显示 code，不再假装「连接正常」', async () => {
    const created = await createMcp({ type: 'PLATFORM', name: '待删除 MCP', description: '仅供本用例验证删除回落', transport: 'stdio', command: 'npx', exampleQuestions: ['a', 'b', 'c'] })
    const id = await mkSkill({ name: '删除回落联动' })
    await mock.updateSkill(id, { skillMd: `# 正文\n\n@tool[mcp__${created.code}]\n` })
    // 新建 MCP 未发布态可删（yuepu#7②状态守卫）
    await deleteMcp(created.code)
    const detail = await mock.getSkillDetail(id)
    expect(detail.referencedTools[0].bizName).toBe(`mcp__${created.code}`)
    expect(detail.referencedTools[0].checkStatus).toBe('UNKNOWN')
  })

  it('默认候选（不传 includeUnpublished）：API / 业务系统同样只列已发布的，与连接器发布态一致（yuepu#50）', async () => {
    const bizNames = (await mock.toolPicker({ type: 'BIZ_SYSTEM' })).map((t) => t.bizName)
    expect(bizNames).toContain('客户管理系统 CRM')
    expect(bizNames).not.toContain('人力资源系统') // 种子：审核中
    expect(bizNames).not.toContain('合同管理系统') // 种子：未发布
    const apiCodes = (await mock.toolPicker({ type: 'API' })).map((t) => t.code)
    const apiRows = listApisSync()
    expect(apiCodes.length).toBeGreaterThan(0)
    expect(apiRows.some((a) => a.status !== 'PUBLISHED')).toBe(true) // 前提：种子里有未发布的 API
    // 固定清单：种子里已发布且启用的 4 个 API；未发布的 1104 / 1106、审核中的 1102 均不在
    expect(apiCodes.sort()).toEqual(['api__api_1101', 'api__api_1103', 'api__api_1105', 'api__api_1107'])
  })

  // 一览表「停用后技能不再可引用该 API」（yuepu#50）：enabled=false 的 API 即使仍是已发布，也不进候选；已引用的回显「已停用」。
  // 种子 API 是模块级共享内存，改完必须 __resetApiMock 复位（用例乱序，不能留脏状态）。
  it('API 被停用（enabled=false）后：从工具坞候选消失；已引用它的技能侧回显名称但状态为「已停用」', async () => {
    try {
      const id = await mkSkill({ name: 'API停用联动' })
      await mock.updateSkill(id, { skillMd: '# 正文\n\n@tool[api__api_1103]\n' })
      expect((await mock.toolPicker({ type: 'API' })).map((t) => t.code)).toContain('api__api_1103') // 前提：停用前在候选里
      expect((await mock.getSkillDetail(id)).referencedTools[0].checkStatus).not.toBe('DISABLED') // 前提：停用前不是「已停用」

      const row = await getApi('api_1103')
      await updateApi('api_1103', { ...row, enabled: false })

      expect((await mock.toolPicker({ type: 'API' })).map((t) => t.code)).not.toContain('api__api_1103')
      const ref = (await mock.getSkillDetail(id)).referencedTools[0]
      expect(ref.bizName).toBe('客户资料查询')
      expect(ref.checkStatus).toBe('DISABLED')
    } finally {
      __resetApiMock()
    }
  })

  it('已引用的 API 被强制回收（回到未发布）→ 技能侧回显「已停用」，且不在候选里', async () => {
    try {
      const id = await mkSkill({ name: 'API回收联动' })
      await mock.updateSkill(id, { skillMd: '# 正文\n\n@tool[api__api_1101]\n' })
      expect((await mock.getSkillDetail(id)).referencedTools[0].checkStatus).not.toBe('DISABLED') // 前提
      await deactivateApi('api_1101', { forceRevoke: true, reason: '联动测试' }) // 强制回收与停用同走审核，通过后才回「未发布」
      expect(applyApiReviewResult('api_1101', undefined, true)).toBe(true)
      expect((await mock.getSkillDetail(id)).referencedTools[0]).toMatchObject({ bizName: '报销单查询', checkStatus: 'DISABLED' })
      expect((await mock.toolPicker({ type: 'API' })).map((t) => t.code)).not.toContain('api__api_1101')
    } finally {
      __resetApiMock()
      resetAccessAuditMock()
    }
  })

  it('已引用的业务系统被强制回收（回到未发布）→ 技能侧回显「已停用」，且不在候选里', async () => {
    try {
      const id = await mkSkill({ name: '业务系统回收联动' })
      await mock.updateSkill(id, { skillMd: '# 正文\n\n@tool[biz__biz_2101]\n' })
      expect((await mock.getSkillDetail(id)).referencedTools[0].checkStatus).not.toBe('DISABLED') // 前提
      await deactivateBizSystem('biz_2101', { forceRevoke: true, reason: '联动测试' })
      await approveBizSystem('biz_2101')
      expect((await mock.getSkillDetail(id)).referencedTools[0]).toMatchObject({ bizName: '客户管理系统 CRM', checkStatus: 'DISABLED' })
      expect((await mock.toolPicker({ type: 'BIZ_SYSTEM' })).map((t) => t.code)).not.toContain('biz__biz_2101')
    } finally {
      __resetBizSystemMock()
      resetAccessAuditMock()
    }
  })
})

/**
 * 产品优化需求-202611 修改点 13（R4）：技能编辑页工具候选含未发布 / 审核中的连接器（三类都放开，R4-2 暂按），
 * 已停用、已强制回收的不出现；技能提交发布时引用了未发布 / 审核中的连接器 → 阻断（R4-3 暂按），提示
 * 「引用的「名称」尚未发布，请先发布该连接器或移除引用」。
 * MCP 三态用自建行（名称带唯一关键词，按关键词取候选），不碰会被别的用例改写的种子；API / 业务系统用本文件从不改写的种子行。
 */
describe('技能工具候选含未发布的连接器 + 发布校验（产品优化需求-202611 修改点 13（R4））', () => {
  const pickAll = (type, keyword) => mock.toolPicker({ type, includeUnpublished: true, ...(keyword ? { keyword } : {}) })
  const pubStateOf = (list, code) => list.find((t) => t.code === code)?.pubState
  const mkMcp = (name) => createMcp({ type: 'PLATFORM', name, description: 'R4 用例自建', transport: 'stdio', command: 'npx', exampleQuestions: ['a', 'b', 'c'] })
  /** 自建 MCP 并走到已发布（提交发布 → 审核通过）。 */
  async function mkLiveMcp(name) {
    const m = await mkMcp(name)
    await publishMcpService(m.code)
    expect(applyMcpReviewResult(m.code, 'FIRST_PUBLISH', true)).toBe(true)
    return m
  }
  /** 自建一条发布必填项齐全、正文引用给定工具的草稿技能。 */
  async function mkDraftReferencing(name, codes) {
    const id = await mkSkill({ name })
    await mock.updateSkill(id, { skillMd: `# ${name}\n\n${codes.map((c) => `@tool[${c}]`).join('\n')}\n` })
    return id
  }

  it('MCP 页签候选含未发布、审核中、已发布三态的连接器，各带发布态', async () => {
    const draft = await mkMcp('R4三态 未发布 MCP')
    const reviewing = await mkMcp('R4三态 审核中 MCP')
    await publishMcpService(reviewing.code)
    const live = await mkLiveMcp('R4三态 已发布 MCP')
    const list = await pickAll('MCP', 'R4三态')
    expect(pubStateOf(list, `mcp__${draft.code}`)).toBe('UNPUBLISHED')
    expect(pubStateOf(list, `mcp__${reviewing.code}`)).toBe('REVIEWING')
    expect(pubStateOf(list, `mcp__${live.code}`)).toBe('PUBLISHED')
  })

  it('API、业务系统页签同样放开：含审核中与未发布的连接器（三类都放开）', async () => {
    const api = await pickAll('API')
    expect(pubStateOf(api, 'api__api_1102')).toBe('REVIEWING') // 种子：提交付款申请，审核中
    expect(pubStateOf(api, 'api__api_1106')).toBe('UNPUBLISHED') // 种子：星火任务链执行，从未发布
    const biz = await pickAll('BIZ_SYSTEM')
    expect(pubStateOf(biz, 'biz__biz_2102')).toBe('REVIEWING') // 种子：人力资源系统
    expect(pubStateOf(biz, 'biz__biz_2103')).toBe('UNPUBLISHED') // 种子：合同管理系统
  })

  it('已停用（停用审核通过、回到未发布但有最近发布时间）的连接器不出现在候选里', async () => {
    const m = await mkLiveMcp('R4停用 MCP')
    expect((await pickAll('MCP', 'R4停用')).map((t) => t.code)).toContain(`mcp__${m.code}`) // 前提：停用前在候选里
    await delistMcpService(m.code)
    expect(applyMcpReviewResult(m.code, 'DELIST', true)).toBe(true)
    expect((await pickAll('MCP', 'R4停用')).map((t) => t.code)).not.toContain(`mcp__${m.code}`)
  })

  it('已强制回收的连接器不出现在候选里——回收后重新提交发布、仍在审核中的也不出现', async () => {
    expect((await pickAll('API')).map((t) => t.code)).not.toContain('api__api_1104') // 种子：新增客户跟进，已回收
    const m = await mkLiveMcp('R4回收 MCP')
    await delistMcpService(m.code, { forceRevoke: true, reason: 'R4 用例' })
    expect(applyMcpReviewResult(m.code, 'DELIST', true)).toBe(true)
    expect((await pickAll('MCP', 'R4回收')).map((t) => t.code)).not.toContain(`mcp__${m.code}`)
    await publishMcpService(m.code) // 重新提交发布：审核中，但「已回收」标记要审核通过才清
    expect((await pickAll('MCP', 'R4回收')).map((t) => t.code)).not.toContain(`mcp__${m.code}`)
  })

  it('「本技能已引用」回显带发布态：审核中的为 REVIEWING 且给真实连接状态（不再标已停用），已发布的为 PUBLISHED', async () => {
    const id = await mkDraftReferencing('R4已引用回显', ['biz__biz_2102', 'mcp__knowledge_hub'])
    const refs = (await mock.getSkillDetail(id)).referencedTools
    expect(refs.find((t) => t.code === 'biz__biz_2102')).toMatchObject({ bizName: '人力资源系统', pubState: 'REVIEWING', checkStatus: 'UNKNOWN' })
    expect(refs.find((t) => t.code === 'mcp__knowledge_hub')).toMatchObject({ pubState: 'PUBLISHED' })
  })

  it('提交发布：引用了未发布的连接器 → 拒绝并提示「引用的「名称」尚未发布…」，技能仍是未发布、不进审核', async () => {
    const m = await mkMcp('R4阻断 未发布 MCP')
    const id = await mkDraftReferencing('R4阻断未发布', [`mcp__${m.code}`])
    await expect(mock.publishSkill(id, { releaseNotes: '首发' })).rejects.toThrow('引用的「R4阻断 未发布 MCP」尚未发布，请先发布该连接器或移除引用')
    expect(mock._getRaw(id).pendingAction).toBeFalsy()
    expect(pubState(await mock.getSkillDetail(id))).toBe('INITIAL')
  })

  it('提交发布：引用了审核中的连接器同样拒绝', async () => {
    const id = await mkDraftReferencing('R4阻断审核中', ['biz__biz_2102'])
    await expect(mock.publishSkill(id, { releaseNotes: '首发' })).rejects.toThrow('引用的「人力资源系统」尚未发布，请先发布该连接器或移除引用')
    expect(mock._getRaw(id).pendingAction).toBeFalsy()
  })

  it('已发布技能提交新版本同样校验：新版正文引用了未发布的连接器 → 拒绝，线上版本不受影响', async () => {
    const id = await mkLiveSkill({ name: 'R4新版校验' })
    const m = await mkMcp('R4新版 未发布 MCP')
    await mock.updateSkill(id, { skillMd: `# 新版\n\n@tool[mcp__${m.code}]\n` })
    await expect(mock.publishSkill(id, { bump: 'MINOR', releaseNotes: '迭代' })).rejects.toThrow('引用的「R4新版 未发布 MCP」尚未发布')
    expect(pubState(await mock.getSkillDetail(id))).toBe('PUBLISHED') // 仍是已发布、无在审新版
  })

  it('连接器发布通过后阻断随之解除：同一技能可以提交发布', async () => {
    const m = await mkMcp('R4解除 MCP')
    const id = await mkDraftReferencing('R4阻断解除', [`mcp__${m.code}`])
    await expect(mock.publishSkill(id, { releaseNotes: '首发' })).rejects.toThrow('尚未发布') // 前提：发布前被拦
    await publishMcpService(m.code)
    expect(applyMcpReviewResult(m.code, 'FIRST_PUBLISH', true)).toBe(true)
    await expect(mock.publishSkill(id, { releaseNotes: '首发' })).resolves.toMatchObject({ pendingVersion: 'v1.0.0' })
  })

  it('引用已停用的连接器不在本条阻断范围（只拦未发布 / 审核中；已停用按软引用口径，「本技能已引用」标已停用）', async () => {
    const m = await mkLiveMcp('R4软引用 MCP')
    const id = await mkDraftReferencing('R4软引用', [`mcp__${m.code}`])
    await delistMcpService(m.code)
    expect(applyMcpReviewResult(m.code, 'DELIST', true)).toBe(true)
    expect((await mock.getSkillDetail(id)).referencedTools[0]).toMatchObject({ checkStatus: 'DISABLED', pubState: null }) // 前提：已停用
    await expect(mock.publishSkill(id, { releaseNotes: '首发' })).resolves.toMatchObject({ pendingVersion: 'v1.0.0' })
  })

  it('列表行携带 unpublishedTools：只含引用的未发布 / 审核中连接器（版本管理弹窗据此拦【提交发布】）', async () => {
    const m = await mkMcp('R4列表 未发布 MCP')
    await mkDraftReferencing('R4列表行', [`mcp__${m.code}`, 'biz__biz_2102', 'mcp__knowledge_hub'])
    const row = (await mock.listUnifiedSkills({ keyword: 'R4列表行', size: 10 })).list[0]
    expect(row.toolCount).toBe(3) // 前提：三个引用都识别到
    expect(row.unpublishedTools.map((t) => [t.bizName, t.pubState])).toEqual([
      ['R4列表 未发布 MCP', 'UNPUBLISHED'],
      ['人力资源系统', 'REVIEWING']
    ])
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
    const reviewing = ['sk_301', 'sk_302', 'sk_303', 'sk_304', 'sk_305', 'sk_307', 'sk_308', 'sk_309']
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

  it('toolPicker 按类型过滤（MCP/API/BIZ_SYSTEM），关键词可搜；候选实时读三个连接器 mock（2026-09-23 待办 yuepu#10②）', async () => {
    const mcp = await mock.toolPicker({ type: 'MCP' })
    expect(mcp.length).toBeGreaterThan(0)
    expect(mcp.every((t) => t.code.startsWith('mcp__'))).toBe(true)
    // 候选取自 bizSystemMock 真实种子（已发布的客户管理系统 CRM），不再是与之脱钩的静态目录
    const biz = await mock.toolPicker({ type: 'BIZ_SYSTEM' })
    expect(biz.some((t) => t.bizName === '客户管理系统 CRM')).toBe(true)
    const kw = await mock.toolPicker({ type: 'API', keyword: '客户资料' })
    expect(kw.map((t) => t.bizName)).toEqual(['客户资料查询'])
  })
})

describe('上传技能包更新已有技能（产品优化需求-202611 R5 草案）', () => {
  const CONFIG_KEYS = ['name', 'description', 'exampleQuestion', 'icon', 'displayCategoryId']
  const pathsOf = async (id) => (await mock.listSkillFiles(id)).files.map((f) => f.path)

  it('包名与当前技能名不一致 → 拒绝并说明原因，原有文件不变', async () => {
    const id = await mkSkill({ name: 'R5 名称校验' })
    await mock.saveSkillFile(id, { path: 'references/旧文件.md', content: '旧' })
    await expect(mock.importZipToSkill(id, { fileName: '别的技能.zip' })).rejects.toThrow(
      '技能包名称（别的技能）与当前技能不一致，请检查后重新上传'
    )
    expect(await pathsOf(id)).toContain('references/旧文件.md')
  })

  it('不是 .zip → 拒绝', async () => {
    const id = await mkSkill({ name: 'R5 后缀校验' })
    await expect(mock.importZipToSkill(id, { fileName: 'R5 后缀校验.rar' })).rejects.toThrow('仅支持 .zip 技能包')
  })

  it('包名一致 → 整包替换全部文件，名称 / 描述 / 示例问题 / 图标 / 分类不变', async () => {
    const id = await mkSkill({ name: 'R5 整包替换' })
    await mock.updateSkill(id, { description: '原描述', exampleQuestion: '原示例问题' })
    await mock.saveSkillFile(id, { path: 'references/旧文件.md', content: '旧' })
    const before = await mock.getSkillDetail(id)
    await mock.importZipToSkill(id, { fileName: 'R5 整包替换.zip' })
    const after = await mock.getSkillDetail(id)
    const paths = await pathsOf(id)
    expect(paths).toContain('SKILL.md')
    expect(paths).not.toContain('references/旧文件.md')
    for (const k of CONFIG_KEYS) expect(after[k]).toEqual(before[k])
    expect(after.skillMd).toContain('# R5 整包替换')
  })

  it('已发布技能上传后只改草稿：状态与线上版本号不变', async () => {
    const id = await mkSkill({ name: 'R5 已发布' })
    mock._reset(id, { status: 'published', version: 'v1.0.0' })
    await mock.importZipToSkill(id, { fileName: 'R5 已发布.zip' })
    const d = await mock.getSkillDetail(id)
    expect(d.versionLabel).toBe('v1.0.0')
    expect(pubState(d)).toBe('PUBLISHED')
  })

  it('审核中 → 拒绝（锁定不可修改）', async () => {
    const id = await mkSkill({ name: 'R5 审核中' })
    mock._reset(id, { pendingAction: 'publish' })
    await expect(mock.importZipToSkill(id, { fileName: 'R5 审核中.zip' })).rejects.toThrow('技能审核中，已锁定不可修改')
  })
})

describe('市场技能「不在市场展示」（产品优化需求-202611 R14）', () => {
  // 演示样本：sk_304 在审核中（编辑页锁定、开关不展示），另需一条可编辑的样本，打开编辑页就能看到开关
  it('种子里有可编辑的演示样本：sk_307「竞品信息汇总」不在市场展示、不在审核中', async () => {
    const d = await mock.getSkillDetail('sk_307')
    expect(d.hideFromMarket).toBe(true)
    expect(mock._getRaw('sk_307').pendingAction || null).toBe(null)
  })

  it('市场技能打开后：详情和列表都带 hideFromMarket，默认安装随之关掉', async () => {
    const id = await mkSkill({ name: 'R14 市场技能隐藏' })
    await mock.updateSkill(id, { defaultInstall: true })
    await mock.updateSkill(id, { hideFromMarket: true })
    const d = await mock.getSkillDetail(id)
    expect(d.hideFromMarket).toBe(true)
    expect(d.defaultInstall).toBe(false)
    const row = (await mock.listUnifiedSkills({ keyword: 'R14 市场技能隐藏', size: 50 })).list.find((r) => r.id === id)
    expect(row.hideFromMarket).toBe(true)
  })

  it('不在市场展示的技能不能再打开默认安装', async () => {
    const id = await mkSkill({ name: 'R14 互斥' })
    await mock.updateSkill(id, { hideFromMarket: true })
    await expect(mock.updateSkill(id, { defaultInstall: true })).rejects.toThrow('不在市场展示的技能不能默认安装')
    expect((await mock.getSkillDetail(id)).defaultInstall).toBe(false)
  })

  it('关掉后恢复在市场展示，默认安装可以再打开', async () => {
    const id = await mkSkill({ name: 'R14 恢复展示' })
    await mock.updateSkill(id, { hideFromMarket: true })
    await mock.updateSkill(id, { hideFromMarket: false })
    await mock.updateSkill(id, { defaultInstall: true })
    const d = await mock.getSkillDetail(id)
    expect(d.hideFromMarket).toBe(false)
    expect(d.defaultInstall).toBe(true)
  })

  it('岗位私有、通用技能没有这个开关：传了也不生效', async () => {
    for (const type of ['POSITION', 'SYSTEM_DEFAULT']) {
      const id = await mkSkill({ name: 'R14 非市场 ' + type, type })
      await mock.updateSkill(id, { hideFromMarket: true })
      expect((await mock.getSkillDetail(id)).hideFromMarket).toBe(false)
    }
  })

  it('演示种子：合同风险检查（sk_304）不在市场展示', async () => {
    expect((await mock.getSkillDetail('sk_304')).hideFromMarket).toBe(true)
  })
})

describe('unifiedSkillMock · 持久化读回（mockPersist v12，2026-11-10 产品优化需求-202611 R4 bump；key iworker-demo-mock:unifiedSkill）', () => {
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

  it('createSkill 落盘（v=14）→ 重新 import 模块（模拟刷新）→ 列表仍含新建技能', async () => {
    const first = await import('@/api/unifiedSkillMock')
    const { skillId } = await first.createSkill({ name: '读回验证技能', type: 'PLATFORM', categoryName: CAT })
    expect(JSON.parse(globalThis.localStorage.getItem(KEY)).v).toBe(14)
    vi.resetModules()
    const fresh = await import('@/api/unifiedSkillMock')
    const { list } = await fresh.listUnifiedSkills({ keyword: '读回验证技能', size: 10 })
    expect(list.map((r) => r.id)).toContain(skillId)
    expect((await fresh.getSkillDetail(skillId)).name).toBe('读回验证技能')
  })

  it('存量版本号 ≠ 当前版本的快照 → 丢弃回种子（sk_301 在、伪造行不在），旧 key 被清掉', async () => {
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

  // 2026-10-09 /test-audit 补缺口 C1（PRD 技能 §3.5.1）：强制回收是写点，刷新后「已回收」必须还在
  // （2026-10-12 改版：回收经审核通过才生效；另补「审核中」时暂存的回收原因刷新后也在，通过后仍能落「已回收」）
  it('强制回收审核通过后刷新页面 → 技能仍是未发布，且带回收原因 / 时间 / 操作人', async () => {
    const first = await import('@/api/unifiedSkillMock')
    const { skillId } = await first.createSkill({ name: '回收读回技能', type: 'PLATFORM', categoryName: CAT })
    await first.updateSkill(skillId, { icon: '🧪', skillMd: '# 回收读回\n\n正文' })
    await first.publishSkill(skillId, { releaseNotes: '首发' })
    expect(first.applySkillReviewResult(skillId, 'FIRST_PUBLISH', true)).toBe(true)
    await first.delistSkill(skillId, { forceRevoke: true, reason: '刷新后仍应标已回收' })
    vi.resetModules()
    const mid = await import('@/api/unifiedSkillMock')
    expect(pubState(await mid.getSkillDetail(skillId))).toBe('PUBLISHED_DELISTING') // 审核中，尚未回收
    expect(mid.applySkillReviewResult(skillId, 'DELIST', true)).toBe(true)
    vi.resetModules()
    const fresh = await import('@/api/unifiedSkillMock')
    const detail = await fresh.getSkillDetail(skillId)
    expect(pubState(detail)).toBe('DELISTED') // 复用下架语义，页面映射为「未发布」
    expect(detail.revoked).toEqual({ reason: '刷新后仍应标已回收', at: expect.any(String), operator: 'demo' })
    const row = (await fresh.listUnifiedSkills({ keyword: '回收读回技能', size: 10 })).list.find((r) => r.id === skillId)
    expect(row.revoked.reason).toBe('刷新后仍应标已回收')
  })

  // 旧快照兼容：强制回收并入停用审核前落盘的快照，在审停用行没有 pendingRevokeReason / pendingRevokeBy
  it('旧 v6 快照里在审停用（pendingAction:stop）且缺回收原因 → 审核通过按普通停用处理：未发布、无已回收、无强制回收审计', async () => {
    const first = await import('@/api/unifiedSkillMock')
    await first.createSkill({ name: '触发落盘', type: 'PLATFORM', categoryName: CAT })
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    const old = snap.data.skills.find((s) => s.id === 'sk_301')
    Object.assign(old, { status: 'published', delisted: false, pendingAction: 'stop' })
    delete old.pendingRevokeReason
    delete old.pendingRevokeBy
    globalThis.localStorage.setItem(KEY, JSON.stringify(snap))
    vi.resetModules()
    const fresh = await import('@/api/unifiedSkillMock')
    const audit = await import('@/api/accessAuditMock')
    expect(fresh.applySkillReviewResult('sk_301', 'DELIST', true)).toBe(true)
    const detail = await fresh.getSkillDetail('sk_301')
    expect(pubState(detail)).toBe('DELISTED')
    expect(detail.revoked).toBeNull()
    expect(audit.opsRecords.some((x) => x.live && x.module === '技能' && x.action === '强制回收')).toBe(false)
  })
})
