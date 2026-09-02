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
  verifyModel,
  publishModel,
  delistModel,
  withdrawModel,
  approveModel,
  setDefaultModel
} from '../adminModelMock'

// 新建一条可用行（名称唯一）；返回行 VO
async function mk(name) {
  return createModel({
    name,
    providerName: 'deepseek',
    category: 'TEXT',
    baseUrl: 'https://api.example.com/v1',
    model: 'demo-chat',
    contextWindow: 65536,
    apiKey: 'sk-test-abcdefgh12345678'
  })
}

describe('adminModelMock —— 模型三态状态机 + 密钥掩码（2026-09-01 PRD 对齐轮）', () => {
  it('种子照原型 modelRows：默认模型在前，出参只带掩码不带明文', async () => {
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

  it('名称平台内唯一 + ≤64（M10）', async () => {
    await expect(mk('DeepSeek R1')).rejects.toMatchObject({ field: 'name' })
    await expect(mk('x'.repeat(65))).rejects.toMatchObject({ field: 'name' })
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

  it('重新验证 / 发布 / 撤回不改 updatedAt（排序依据是配置更新）', async () => {
    const row = await mk(`时间口径模型-${Date.now()}`)
    const stamp = row.updatedAt
    await verifyModel(row.id)
    await publishModel(row.id)
    await withdrawModel(row.id)
    const after = await getModel(row.id)
    expect(after.updatedAt).toBe(stamp)
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
})
