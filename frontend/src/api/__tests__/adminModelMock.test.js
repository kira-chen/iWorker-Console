// @vitest-environment jsdom
// （adminModelMock → request.js → router 链路触达 window，故用 jsdom；同 fieldDictMock.test.js）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写的行；状态机用例各自新建专属行自洽驱动。
import { describe, it, expect } from 'vitest'
import {
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  verifyModel,
  publishModel,
  delistModel,
  withdrawModel,
  approveModel,
  rejectModel,
  setDefaultModel
} from '../adminModelMock'

/**
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md
 *   §二.2 排序（updatedAt 口径）/ §二.3.4 验证 / §二.3.5 发布 / §二.3.6 撤回 / §二.3.7 停用 /
 *   §二.3.8 设为默认 / §二.3.9 删除 / §二.4 状态规则 / §三.2 基本信息校验 / §三.8 编辑页异常。
 * 本文件无 reset：每条用例各自 mk() 专属行自洽驱动，种子断言只读从不被改写的行（md_101/md_102）；
 * 唯一改写种子的是「Kimi K2 重验」用例（md_104），其它用例不引用该行。
 */

// 新建一条可用行（名称唯一）；返回行 VO。over 可覆盖类别等字段
async function mk(name, over = {}) {
  return createModel({
    name,
    providerName: 'deepseek',
    category: 'TEXT',
    baseUrl: 'https://api.example.com/v1',
    model: 'demo-chat',
    contextWindow: 65536,
    apiKey: 'sk-test-abcdefgh12345678',
    ...over
  })
}

describe('adminModelMock —— 模型三态状态机 + 密钥掩码（2026-09-01 PRD 对齐轮）', () => {
  it('种子 5 行：默认模型恒首位，出参只带掩码不带明文（md §二.2 / §三.3.3）', async () => {
    const { list } = await listModels({})
    expect(list.length).toBeGreaterThanOrEqual(4)
    // 默认模型（DeepSeek R1）恒在首位
    expect(list[0].isDefault).toBe(true)
    // 明文绝不出 mock：行上无 apiKey/appSecret，只有掩码信号
    for (const row of list) {
      expect(row.apiKey).toBeUndefined()
      expect(row.appSecret).toBeUndefined()
    }
  })

  it('掩码口径（maskSecret）：首尾明文 + 中间铺 *', async () => {
    const m = await getModel('md_102') // 种子行，仅本用例读取
    // 明文 'sk-demo-dashscope-a1c95370e6d2'（>8 位）→ 露前 3 后 3、中间铺 *
    expect(m.apiKeyMasked.startsWith('sk-')).toBe(true)
    expect(m.apiKeyMasked.endsWith('6d2')).toBe(true)
    expect(m.apiKeyMasked).toContain('*')
    expect(m.apiKeyMasked).not.toContain('demo-dashscope') // 中段不外泄
  })

  it('名称平台内唯一 + ≤64 → 按 name 字段级报错（md §三.2「最多 64 字符」/ §三.8「模型名称重复」）', async () => {
    await expect(mk('DeepSeek R1')).rejects.toMatchObject({ field: 'name' })
    await expect(mk('x'.repeat(65))).rejects.toMatchObject({ field: 'name' })
  })

  // 2026-09-12 测试审计 T55：md §三.2 base_url「必须以 http:// 或 https:// 开头」/ 模型标识必填 /
  // 上下文窗口「不小于 1024 的整数」——mock 侧兜底校验按字段定位（adminModelMock.js:272-277）
  it('createModel 缺 baseUrl / model / contextWindow 各自 rejects 并带对应 field（md §三.2 / §三.8）', async () => {
    const stamp = Date.now()
    await expect(mk(`校验-url-${stamp}`, { baseUrl: 'ftp://x' })).rejects.toMatchObject({
      field: 'baseUrl', message: expect.stringContaining('http:// 或 https://')
    })
    await expect(mk(`校验-model-${stamp}`, { model: '' })).rejects.toMatchObject({ field: 'model' })
    await expect(mk(`校验-cw-${stamp}`, { contextWindow: 512 })).rejects.toMatchObject({
      field: 'contextWindow', message: expect.stringContaining('1024')
    })
    // 三条都没落库
    const { list } = await listModels({ keyword: `校验-` })
    expect(list.filter((m) => m.name.endsWith(String(stamp)))).toHaveLength(0)
  })

  it('状态机：验证过→发布过审→撤回回未发布→审核通过→停用过审→撤回回已发布', async () => {
    const row = await mk(`状态机模型-${Date.now()}`)
    expect(row.status).toBe('DRAFT')
    // 未验证不可发布
    await expect(publishModel(row.id)).rejects.toThrow('验证')
    // 验证成功：能力标签回填、verifiedAt 落库
    const v = await verifyModel(row.id)
    expect(v.verifyStatus).toBe('SUCCESS')
    expect(v.supportsStreaming).toBe(true)
    expect(v.verifiedAt).toBeTruthy()
    // 发布 → 审核中（pendingAction=PUBLISH）
    const p = await publishModel(row.id)
    expect(p.status).toBe('PENDING_REVIEW')
    expect(p.pendingAction).toBe('PUBLISH')
    // 撤回待审发布 → 未发布
    const w = await withdrawModel(row.id)
    expect(w.status).toBe('DRAFT')
    expect(w.pendingAction).toBeNull()
    // 再发布并审核通过 → 已发布 + publishedAt
    await publishModel(row.id)
    const ok = await approveModel(row.id)
    expect(ok.status).toBe('PUBLISHED')
    expect(ok.publishedAt).toBeTruthy()
    // 停用过审：status 仍 PUBLISHED（客户端仍可用），pendingAction=DELIST
    const d = await delistModel(row.id)
    expect(d.status).toBe('PUBLISHED')
    expect(d.pendingAction).toBe('DELIST')
    // 撤回待审停用 → 恢复已发布
    const w2 = await withdrawModel(row.id)
    expect(w2.status).toBe('PUBLISHED')
    expect(w2.pendingAction).toBeNull()
  })

  it('连接字段变更 → 回未发布 + 清验证态；密钥留空=保留', async () => {
    const row = await mk(`连接变更模型-${Date.now()}`)
    await verifyModel(row.id)
    await publishModel(row.id)
    await approveModel(row.id)
    // 改 baseUrl（apiKey 留空=保留）
    const upd = await updateModel(row.id, {
      name: row.name,
      providerName: 'deepseek',
      category: 'TEXT',
      baseUrl: 'https://api.changed.com/v1',
      model: 'demo-chat',
      contextWindow: 65536
    })
    expect(upd.status).toBe('DRAFT')
    expect(upd.verifyStatus).toBe('UNVERIFIED')
    expect(upd.supportsStreaming).toBeNull()
    expect(upd.apiKeyMasked).toBeTruthy() // 留空保留了原密钥
  })

  /**
   * 2026-09-09 PRD 复核批次 0 · A20：口径改按 md `prd-模型.md` §二.2——
   * 「提交审核与撤回提交后，按新的最近更新时间重新排列；重新验证、停用或设置默认模型时，不改变最近更新时间」。
   * 原用例把「发布 / 撤回不改 updatedAt」也一并锁住，与本版 md 相反，已按 md 拆为两条。
   */
  it('重新验证不改 updatedAt（md §二.2「重新验证…不改变」）', async () => {
    const row = await mk(`时间口径模型-${Date.now()}`)
    const stamp = row.updatedAt
    await verifyModel(row.id)
    const after = await getModel(row.id)
    expect(after.updatedAt).toBe(stamp)
  })

  it('提交审核 / 撤回提交后刷新 updatedAt（md §二.2；停用与设为默认仍不刷新）', async () => {
    const row = await mk(`时间刷新模型-${Date.now()}`)
    await verifyModel(row.id)
    const beforePublish = (await getModel(row.id)).updatedAt

    await publishModel(row.id)
    const afterPublish = (await getModel(row.id)).updatedAt
    expect(afterPublish > beforePublish).toBe(true) // 提交审核 → 刷新

    await withdrawModel(row.id)
    const afterWithdraw = (await getModel(row.id)).updatedAt
    expect(afterWithdraw > afterPublish).toBe(true) // 撤回提交 → 刷新

    // 停用（提交停用审核）与设为默认：md 明确「不改变」
    await publishModel(row.id)
    await approveModel(row.id)
    const beforeQuiet = (await getModel(row.id)).updatedAt
    await setDefaultModel(row.id)
    await delistModel(row.id)
    expect((await getModel(row.id)).updatedAt).toBe(beforeQuiet)
  })

  it('设为默认：仅已发布可设，同类别原默认自动取消', async () => {
    const row = await mk(`默认模型-${Date.now()}`)
    await expect(setDefaultModel(row.id)).rejects.toThrow('已发布')
    await verifyModel(row.id)
    await publishModel(row.id)
    await approveModel(row.id)
    const r = await setDefaultModel(row.id)
    expect(r.isDefault).toBe(true)
    // 同类别（TEXT）唯一默认：原默认 DeepSeek R1 被摘掉
    const other = await getModel('md_101')
    expect(other.isDefault).toBe(false)
  })

  /* ===== 2026-09-12 测试审计 T55 补缺口：驳回 / 默认模型停用过审 / 删除守卫 / 种子 Kimi K2 重验 ===== */

  it('驳回待审发布 → 回未发布；驳回待审停用 → 仍已发布（md §二.4「驳回或撤回后变为未发布 / 保持已发布」）', async () => {
    const row = await mk(`驳回模型-${Date.now()}`)
    await verifyModel(row.id)
    await publishModel(row.id)
    const r1 = await rejectModel(row.id)
    expect(r1.status).toBe('DRAFT')
    expect(r1.pendingAction).toBeNull()
    // 再发布并过审 → 已发布；提交停用后驳回 → 保持已发布、pendingAction 清空
    await publishModel(row.id)
    await approveModel(row.id)
    await delistModel(row.id)
    const r2 = await rejectModel(row.id)
    expect(r2.status).toBe('PUBLISHED')
    expect(r2.pendingAction).toBeNull()
    // 没有待审事项时驳回拒绝
    await expect(rejectModel(row.id)).rejects.toThrow('没有待审事项')
  })

  it('默认模型停用：审核期间保留默认标记，审核通过后 isDefault=false（md §二.3.7 L153-154）', async () => {
    // 用 MULTIMODAL 类别：种子里该类别无默认模型，不会摘掉 DeepSeek R1 的默认位影响其它用例
    const row = await mk(`默认停用模型-${Date.now()}`, { category: 'MULTIMODAL' })
    await verifyModel(row.id)
    await publishModel(row.id)
    await approveModel(row.id)
    await setDefaultModel(row.id)
    const pending = await delistModel(row.id)
    expect(pending.isDefault).toBe(true) // 审核期间继续保留默认标记
    expect(pending.pendingAction).toBe('DELIST')
    const done = await approveModel(row.id)
    expect(done.status).toBe('DRAFT')
    expect(done.isDefault).toBe(false) // 停用生效同时取消默认标记
  })

  it('审核中 / 已发布模型 deleteModel 拒绝「仅未发布状态可删除」；未发布可删（md §二.3.9）', async () => {
    const row = await mk(`删除守卫模型-${Date.now()}`)
    await verifyModel(row.id)
    await publishModel(row.id) // 审核中
    await expect(deleteModel(row.id)).rejects.toThrow('仅未发布状态可删除')
    await approveModel(row.id) // 已发布
    await expect(deleteModel(row.id)).rejects.toThrow('仅未发布状态可删除')
    await delistModel(row.id) // 待审停用（展示态审核中）
    await expect(deleteModel(row.id)).rejects.toThrow('仅未发布状态可删除')
    await approveModel(row.id) // 停用通过 → 未发布
    await expect(deleteModel(row.id)).resolves.toEqual({})
    await expect(getModel(row.id)).rejects.toThrow('模型不存在')
  })

  it('种子 Kimi K2（md_104）：重验仍 FAILED 且错误码 AUTH_FAILED；改 baseUrl 后重验 SUCCESS（md §二.5 鉴权失败 / §三.6 连接变更）', async () => {
    const before = await getModel('md_104')
    expect(before.verifyStatus).toBe('FAILED')
    const again = await verifyModel('md_104')
    expect(again.verifyStatus).toBe('FAILED')
    expect(again.verifyError.startsWith('AUTH_FAILED')).toBe(true)
    expect(again.verifyLatencyMs).toBeNull()
    // 改连接配置（模拟换对了密钥的地址）→ 回未发布 + 清验证态，再验即通过并回填能力
    const upd = await updateModel('md_104', {
      name: before.name, providerName: before.providerName, category: before.category,
      baseUrl: 'https://api.moonshot.cn/v2', model: before.model, contextWindow: before.contextWindow
    })
    expect(upd.verifyStatus).toBe('UNVERIFIED')
    const ok = await verifyModel('md_104')
    expect(ok.verifyStatus).toBe('SUCCESS')
    expect(ok.verifyError).toBeNull()
    expect(ok.supportsStreaming).toBe(true)
  })
})
