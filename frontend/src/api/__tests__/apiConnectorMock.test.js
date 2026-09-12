// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * apiConnectorMock.js 数据层单测（2026-09-12 测试审计 T58 新建；768 行 v2 此前零测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md：
 *   §二.3 连通性验证（连接配置变更后原验证结果失效 / 未验证不允许发布）
 *   §二.4 发布 / 撤回 / 停用 状态机（撤回按待审类型恢复）
 *   §二.5 服务提供系统（名称必填 ≤64 平台内唯一、描述必填 ≤2000；含 API 不可删）
 *   §一.1 搜索按名称或描述 / 状态筛选
 *   §三.3 鉴权密钥保存后遮罩、查看态不明文（出参 valueMasked、留空保留）
 *   + 持久化：每个写点 persist() 一次、快照形状校验、displayStatus 中间态归一。
 *
 * 隔离：mock 无 __reset 复位函数，每条用例 vi.resetModules() 后动态 import 拿全新种子；
 * mockPersist 走 vi.hoisted 桩（范式同 runtimeSpecMock.test.js），persist 计数与 snapshot/restore 直接可拿。
 * 延时：mock 每个操作 await delay(150~900ms)，用假定时器一次跑完。
 */

const persistHarness = vi.hoisted(() => ({ modules: new Map() }))
vi.mock('../mockPersist', () => ({
  attachPersist(moduleKey, options) {
    const persist = vi.fn()
    persistHarness.modules.set(moduleKey, { options, persist })
    return persist
  }
}))

let m, harness
/** 起一个 mock 调用并把它的延时跑完 */
async function run(p) {
  p.catch(() => {}) // 先挂一个接手，避免延时期间的拒绝被记成 unhandled；调用方 await 仍能拿到拒绝
  await vi.runAllTimersAsync()
  return p
}
beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  m = await import('../apiConnectorMock')
  harness = persistHarness.modules.get('apiConnector')
  harness.persist.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

// 种子 api_1101（PUBLISHED / API_KEY / HEALTHY）的合法编辑 payload
const PAYLOAD_1101 = {
  name: '报销单查询',
  icon: '📄',
  description: '按报销单号查询审批状态与金额',
  providerSystemId: 'pv_1',
  method: 'GET',
  readWrite: 'read',
  url: 'https://finance.example.com/api/expense/status',
  authType: 'API_KEY',
  authConfig: {
    params: [
      { in: 'HEADER', name: 'X-Api-Key', description: '', clientFill: false },
      { in: 'QUERY', name: 'appid', description: '财务系统分配的应用标识', clientFill: true }
    ]
  },
  exampleQuestions: ['帮我查询报销单的当前审批状态', '我上周提的报销现在到哪一步了', '查一下单号 BX20260801 的报销金额']
}
const NEW_API = {
  name: '新接口',
  icon: '🧪',
  description: '测试用',
  providerSystemId: 'pv_3',
  method: 'POST',
  readWrite: 'write',
  url: 'https://x.example.com/api',
  authType: 'NONE',
  exampleQuestions: ['a', 'b', 'c']
}

describe('① 连接配置变更 → 原验证结果失效（md §二.3 L60）', () => {
  it('只改名称 / 描述：验证结果保留（HEALTHY + 最近验证时间不变）', async () => {
    const before = await run(m.getApi('api_1101'))
    expect(before.displayStatus).toBe('HEALTHY')
    const after = await run(m.updateApi('api_1101', { ...PAYLOAD_1101, name: '报销单查询（改名）', description: '改了描述' }))
    expect(after.name).toBe('报销单查询（改名）')
    expect(after.displayStatus).toBe('HEALTHY')
    expect(after.lastCheckedAt).toBe(before.lastCheckedAt)
  })

  it.each([
    ['API 地址', { url: 'https://finance.example.com/api/expense/status/v2' }],
    ['请求方式', { method: 'POST' }],
    ['鉴权类型', { authType: 'NONE', authConfig: null }],
    ['鉴权参数换位置', { authConfig: { params: [{ in: 'QUERY', name: 'X-Api-Key', clientFill: false }, PAYLOAD_1101.authConfig.params[1]] } }],
    ['重填密钥值', { authConfig: { params: [{ ...PAYLOAD_1101.authConfig.params[0], value: 'new-secret' }, PAYLOAD_1101.authConfig.params[1]] } }]
  ])('改%s → 回未探测（displayStatus null、最近验证时间 / 错误清空）', async (_label, patch) => {
    const after = await run(m.updateApi('api_1101', { ...PAYLOAD_1101, ...patch }))
    expect(after.displayStatus).toBeNull()
    expect(after.lastCheckedAt).toBeNull()
    expect(after.lastCheckError).toBeNull()
  })

  it('Bearer：留空保留不算变更；填新 Token 算变更', async () => {
    const base = {
      ...NEW_API,
      name: '星火智能体会话',
      providerSystemId: 'pv_4',
      url: 'https://flames.example.com/openapi/flames/api/v3/chat/completions',
      authType: 'BEARER'
    }
    const keep = await run(m.updateApi('api_1105', { ...base, authConfig: {} }))
    expect(keep.displayStatus).toBe('HEALTHY')
    const changed = await run(m.updateApi('api_1105', { ...base, authConfig: { value: 'new-token-xyz' } }))
    expect(changed.displayStatus).toBeNull()
  })

  it('改过地址后重新验证：mock 专用「恒异常」标记被清掉，检活按正常路径回 HEALTHY', async () => {
    // api_1104 种子带 _mockUnhealthy：不改地址直接检活恒异常
    const bad = await run(m.healthCheckApi('api_1104'))
    expect(bad.displayStatus).toBe('UNHEALTHY')
    expect(bad.error).toContain('连接被拒绝')
    await run(
      m.updateApi('api_1104', {
        ...NEW_API,
        name: '新增客户跟进',
        providerSystemId: 'pv_2',
        url: 'https://crm.example.com/api/follow-up/create-fixed'
      })
    )
    const ok = await run(m.healthCheckApi('api_1104'))
    expect(ok.displayStatus).toBe('HEALTHY')
    expect(ok.error).toBeNull()
    expect((await run(m.getApi('api_1104'))).lastCheckedAt).toBe(ok.checkedAt)
  })
})

describe('② 发布前置：连通性验证通过才可提交（md §二.3 L59 / §二.2 L50）', () => {
  it('未探测（api_1106）/ 连接异常（api_1104）提交发布 → 拒「连通性验证通过后才可提交发布」，状态仍未发布', async () => {
    await expect(run(m.publishApi('api_1106'))).rejects.toThrow('连通性验证通过后才可提交发布')
    await expect(run(m.publishApi('api_1104'))).rejects.toThrow('连通性验证通过后才可提交发布')
    expect((await run(m.getApi('api_1106'))).status).toBe('NOT_PUBLISHED')
  })

  it('非未发布状态提交发布 → 拒「仅未发布状态可提交发布」', async () => {
    await expect(run(m.publishApi('api_1101'))).rejects.toThrow('仅未发布状态可提交发布')
  })
})

describe('③ 状态机双向（md §二.4 L64-69）', () => {
  it('未发布 → 发布 → 审核中(PUBLISH) → 撤回 → 未发布', async () => {
    await run(m.healthCheckApi('api_1106'))
    const p = await run(m.publishApi('api_1106'))
    expect([p.status, p.pendingAction]).toEqual(['PENDING_REVIEW', 'PUBLISH'])
    const w = await run(m.withdrawApi('api_1106'))
    expect([w.status, w.pendingAction]).toEqual(['NOT_PUBLISHED', null])
  })

  it('已发布 → 停用 → 审核中(DEACTIVATE) → 撤回 → 已发布', async () => {
    const d = await run(m.deactivateApi('api_1101'))
    expect([d.status, d.pendingAction]).toEqual(['PENDING_REVIEW', 'DEACTIVATE'])
    const w = await run(m.withdrawApi('api_1101'))
    expect([w.status, w.pendingAction]).toEqual(['PUBLISHED', null])
  })

  it('越界动作各自拒绝：审核中不可停用、未发布不可撤回、审核中不可再发布', async () => {
    await expect(run(m.deactivateApi('api_1102'))).rejects.toThrow('仅已发布状态可停用')
    await expect(run(m.withdrawApi('api_1106'))).rejects.toThrow('仅审核中状态可撤回')
    await expect(run(m.publishApi('api_1102'))).rejects.toThrow('仅未发布状态可提交发布')
  })
})

describe('④ 服务提供系统校验（md §二.5 L78）', () => {
  it.each([
    ['名称空', { name: '  ', description: 'd' }, 'name', '系统名称必填'],
    ['名称 65 字', { name: 'x'.repeat(65), description: 'd' }, 'name', '系统名称最多 64 字符'],
    ['名称与种子重名', { name: '财务服务系统', description: 'd' }, 'name', '系统名称平台内不可重复'],
    ['描述空', { name: '新系统', description: '' }, 'description', '系统描述必填'],
    ['描述 2001 字', { name: '新系统', description: 'd'.repeat(2001) }, 'description', '系统描述最多 2000 字符']
  ])('新建 %s → rejects {field, message}', async (_l, payload, field, message) => {
    await expect(run(m.createProviderSystem(payload))).rejects.toMatchObject({ field, message })
  })

  it('名称 64 字 / 描述 2000 字恰好通过；编辑时与自身同名不算重复、与他人同名算', async () => {
    const ps = await run(m.createProviderSystem({ name: 'y'.repeat(64), description: 'd'.repeat(2000) }))
    expect(ps.id).toMatch(/^pv_\d+$/)
    await expect(run(m.updateProviderSystem('pv_1', { name: '财务服务系统', description: '自身同名' }))).resolves.toMatchObject({
      description: '自身同名'
    })
    await expect(run(m.updateProviderSystem('pv_1', { name: '客户数据平台', description: 'd' }))).rejects.toMatchObject({
      field: 'name'
    })
  })

  it('列表带聚合 apiCount（pv_1 两个 / pv_3 零个）', async () => {
    const { list } = await run(m.listProviderSystems())
    expect(list.find((p) => p.id === 'pv_1').apiCount).toBe(2)
    expect(list.find((p) => p.id === 'pv_3').apiCount).toBe(0)
  })
})

describe('⑤ 含 API 的系统不可删（md §二.5 L81）', () => {
  it('pv_1 下有 2 个 API → 拒「该系统下有 2 个 API，需先迁移或删除后才能删除系统」；空系统 pv_3 可删', async () => {
    await expect(run(m.deleteProviderSystem('pv_1'))).rejects.toThrow('该系统下有 2 个 API，需先迁移或删除后才能删除系统')
    await expect(run(m.deleteProviderSystem('pv_3'))).resolves.toEqual({})
    const { list } = await run(m.listProviderSystems())
    expect(list.some((p) => p.id === 'pv_3')).toBe(false)
  })
})

describe('⑥ listApis 搜索与筛选（md §一.1 L10-11）', () => {
  it('keyword 命中名称或描述（不区分大小写）：每一条都命中，且落掉不命中的', async () => {
    const { list } = await run(m.listApis({ keyword: '星火' }))
    expect(list.length).toBe(3)
    expect(list.every((a) => a.name.includes('星火') || a.description.includes('星火'))).toBe(true)
    const byDesc = await run(m.listApis({ keyword: '报销单号' }))
    expect(byDesc.list.map((a) => a.id)).toEqual(['api_1101'])
    const ci = await run(m.listApis({ keyword: 'openai' }))
    expect(ci.list.length).toBe(3)
  })

  it('state 只留该状态；与 keyword 组合取交集；无条件回全量 7 条', async () => {
    const pub = await run(m.listApis({ state: 'PUBLISHED' }))
    expect(pub.list.length).toBe(4)
    expect(pub.list.every((a) => a.status === 'PUBLISHED')).toBe(true)
    const both = await run(m.listApis({ keyword: '星火', state: 'NOT_PUBLISHED' }))
    expect(both.list.map((a) => a.id)).toEqual(['api_1106'])
    expect((await run(m.listApis())).list.length).toBe(7)
  })

  it('列表行带 providerSystemName 与 referencedBySkillCount', async () => {
    const { list } = await run(m.listApis())
    const a = list.find((x) => x.id === 'api_1101')
    expect(a.providerSystemName).toBe('财务服务系统')
    expect(a.referencedBySkillCount).toBe(2)
  })
})

describe('⑦ 鉴权出参脱敏（md §三.3 L136/L145：保存后遮罩、查看态不明文）', () => {
  it('API_KEY：出参行只有 valueMasked（首尾掩码）没有 value；客户端填写行 valueMasked 为空串', async () => {
    const a = await run(m.getApi('api_1101'))
    const [platform, client] = a.authConfig.params
    expect('value' in platform).toBe(false)
    expect(platform.valueMasked).toBe('fin***********1d8')
    expect(platform.valueMasked).not.toContain('live')
    expect(client.clientFill).toBe(true)
    expect(client.valueMasked).toBe('')
    // 列表行同样脱敏
    const { list } = await run(m.listApis({ keyword: '报销单查询' }))
    expect(JSON.stringify(list)).not.toContain('fin-live-9f27c1d8')
  })

  it('BEARER：出参只有 valueMasked；编辑留空=保留原 Token（掩码不变），重填=覆盖', async () => {
    const before = await run(m.getApi('api_1105'))
    expect(before.authConfig).toEqual({ valueMasked: '9a7*******************370' })
    const base = {
      ...NEW_API,
      name: '星火智能体会话',
      providerSystemId: 'pv_4',
      url: 'https://flames.example.com/openapi/flames/api/v3/chat/completions',
      authType: 'BEARER'
    }
    const kept = await run(m.updateApi('api_1105', { ...base, authConfig: {} }))
    expect(kept.authConfig.valueMasked).toBe('9a7*******************370')
    const replaced = await run(m.updateApi('api_1105', { ...base, authConfig: { value: 'brand-new-token-01' } }))
    expect(replaced.authConfig.valueMasked).toBe('bra************-01')
  })

  it('API_KEY 编辑留空=保留同「位置+参数名」旧值；切不鉴权 → authConfig 为 null', async () => {
    const kept = await run(m.updateApi('api_1101', PAYLOAD_1101))
    expect(kept.authConfig.params[0].valueMasked).toBe('fin***********1d8')
    const none = await run(m.updateApi('api_1101', { ...PAYLOAD_1101, authType: 'NONE', authConfig: null }))
    expect(none.authType).toBe('NONE')
    expect(none.authConfig).toBeNull()
  })

  it('新建校验：名称空 / 所属系统不存在 / URL 非 http(s) / API_KEY 零参数 各回 field', async () => {
    await expect(run(m.createApi({ ...NEW_API, name: '' }))).rejects.toMatchObject({ field: 'name' })
    await expect(run(m.createApi({ ...NEW_API, providerSystemId: 'pv_999' }))).rejects.toMatchObject({ field: 'providerSystemId' })
    await expect(run(m.createApi({ ...NEW_API, url: 'ftp://x' }))).rejects.toMatchObject({ field: 'url' })
    await expect(run(m.createApi({ ...NEW_API, authType: 'API_KEY', authConfig: { params: [{ name: ' ' }] } }))).rejects.toMatchObject({
      field: 'authConfig'
    })
  })
})

describe('⑧ 持久化：每个写点 persist 一次 + 快照形状校验 + 中间态归一', () => {
  it('10 个写点各调 persist() 恰一次；读操作不调', async () => {
    await run(m.listApis())
    await run(m.getApi('api_1101'))
    await run(m.listProviderSystems())
    expect(harness.persist).not.toHaveBeenCalled()
    const steps = [
      () => m.createProviderSystem({ name: '持久化系统', description: 'd' }),
      () => m.updateProviderSystem('pv_3', { name: '内容服务中心', description: '改描述' }),
      () => m.deleteProviderSystem('pv_3'),
      () => m.createApi({ ...NEW_API, providerSystemId: 'pv_2' }),
      () => m.updateApi('api_1106', { ...NEW_API, name: '星火任务链执行', providerSystemId: 'pv_4' }),
      () => m.healthCheckApi('api_1106'),
      () => m.publishApi('api_1106'),
      () => m.withdrawApi('api_1106'),
      () => m.deactivateApi('api_1101'),
      () => m.deleteApi('api_1102')
    ]
    for (let i = 0; i < steps.length; i++) {
      await run(steps[i]())
      expect(harness.persist).toHaveBeenCalledTimes(i + 1)
    }
    expect(harness.options.version).toBe(2)
    const snap = harness.options.snapshot()
    expect(snap.apis.some((a) => a.name === '新接口')).toBe(true)
    expect(snap.apis.some((a) => a.id === 'api_1102')).toBe(false)
    expect(snap.providerSystems.some((p) => p.id === 'pv_3')).toBe(false)
  })

  it('restore：形状不合法抛「apiConnector 快照形状不合法」；合法快照写回后序号延续、CHECKING 归一为未探测', async () => {
    expect(() => harness.options.restore({})).toThrow('apiConnector 快照形状不合法')
    expect(() => harness.options.restore({ psSeq: 9, apiSeq: 9, skillSeq: 1, providerSystems: [], apis: 'no' })).toThrow(
      '快照形状不合法'
    )
    const snap = JSON.parse(JSON.stringify(harness.options.snapshot()))
    snap.psSeq = 50
    snap.apiSeq = 5000
    snap.apis[0].displayStatus = 'CHECKING'
    harness.options.restore(snap)
    const first = await run(m.getApi(snap.apis[0].id))
    expect(first.displayStatus).toBeNull()
    const ps = await run(m.createProviderSystem({ name: '延续序号', description: 'd' }))
    expect(ps.id).toBe('pv_50')
    const api = await run(m.createApi({ ...NEW_API, providerSystemId: ps.id }))
    expect(api.id).toBe('api_5000')
  })
})

describe('示例问题 AI 生成（demo 本地模板）', () => {
  it('按 index 轮换模板、含 API 名、≤60 字；名称空回落「这个 API」', async () => {
    const q0 = await run(m.aiGenerateExampleQuestion({ name: '报销查询', description: '按单号查状态。', index: 0 }))
    expect(q0.question).toBe('帮我用「报销查询」按单号查状态')
    const q1 = await run(m.aiGenerateExampleQuestion({ name: '报销查询', index: 1 }))
    expect(q1.question).toContain('什么情况下应该用「报销查询」')
    const q3 = await run(m.aiGenerateExampleQuestion({ name: '', index: 3 }))
    expect(q3.question).toContain('这个 API')
    expect(q3.question.length).toBeLessThanOrEqual(60)
  })
})
