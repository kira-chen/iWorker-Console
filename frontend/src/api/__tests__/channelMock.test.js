// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

// 截住持久化：既不落 localStorage，又能拿到快照函数核对「密钥不落库」
const persistState = vi.hoisted(() => ({ opts: null }))
vi.mock('../mockPersist', () => ({
  attachPersist: (key, opts) => {
    persistState.opts = opts
    return () => {}
  }
}))

import * as m from '../channelMock'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'
import { statusSubText } from '@/utils/channelMeta'

/**
 * channelMock 数据层用例（2026-11-16 渠道首版）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md：
 *   第三章 1/2/3.5/4/6（列表、排序、停用启用、状态、消息设置）、第四章 3.1/6/8（更换应用、保存、校验文案）、
 *   第五章 1/2（群列表、移出）、第十章（访问审计）。
 * 演示约定（密钥含 bad / other / noperm）见 channelMock.js 头注。页面交互见 views/admin/__tests__/adminChannel*.test.js。
 */
const liveOps = () => opsRecords.filter((r) => r.live && r.module === '渠道')
const FEISHU = 'bot-feishu'
const DING = 'bot-dingtalk'
const GOOD = 'GoodSecret1234567890'

/** 企业微信新建的合法入参（HTTP 回调、已检测校验） */
const wecomPayload = (over = {}) => ({
  ch: 'wecom',
  name: '企微助手',
  desc: '企业微信上的统一入口',
  org: 'ww8f1e2a3b4c',
  appKey: '1000012',
  secret: GOOD,
  conn: 'http',
  http: { token: 'iWk7Tn2Rb9', aesKey: 'aB3dE5fG7hJ9kL1mN3pQ' },
  callbackChecked: true,
  ...over
})
const editOf = async (id, over = {}) => {
  const b = await m.getBot(id)
  return { name: b.name, desc: b.desc, secret: '', conn: b.conn, http: {}, baseUpdatedAt: b.updatedAt, ...over }
}
const botRow = async (id) => (await m.listBots()).list.find((b) => b.id === id)

beforeEach(() => {
  m.__setChannelMockLatency(0)
  m.__resetChannelMock()
  resetAccessAuditMock()
})

describe('种子与列表（第三章 1、2）', () => {
  it('种子：飞书正常；钉钉连接中断，第二行「AppSecret 已失效」；企业微信未接入', async () => {
    const { list } = await m.listBots()
    expect(list.map((b) => [b.ch, b.status, statusSubText(b)])).toEqual([
      ['feishu', 'NORMAL', ''],
      ['dingtalk', 'DOWN', 'AppSecret 已失效']
    ])
  })

  it('默认按最近更新时间由近到远', async () => {
    const { list } = await m.listBots()
    expect(list.map((b) => b.updatedAt)).toEqual(['2026-09-12 16:20', '2026-09-10 11:05'])
  })

  it('搜索名称或用途说明：忽略前后空格、部分匹配', async () => {
    expect((await m.listBots({ keyword: '  钉钉上 ' })).list.map((b) => b.id)).toEqual([DING])
  })

  it.each([
    [{ ch: 'feishu' }, [FEISHU]],
    [{ status: 'DOWN' }, [DING]],
    [{ ch: 'wecom' }, []]
  ])('按渠道 / 状态筛选 %j', async (params, ids) => {
    expect((await m.listBots(params)).list.map((b) => b.id)).toEqual(ids)
  })

  it('底部汇总：2 个机器人 · 已接入 2 / 3 个 IM 平台', async () => {
    expect(await m.getBotSummary()).toEqual({ botCount: 2, platformCount: 2, platformTotal: 3 })
  })

  it('每平台上限 1：飞书、钉钉已满（带已接入机器人名），企业微信可选', async () => {
    expect(await m.getPlatformSlots()).toEqual([
      { ch: 'feishu', full: true, botName: 'iWorker 助手' },
      { ch: 'dingtalk', full: true, botName: 'iWorker 助手' },
      { ch: 'wecom', full: false, botName: '' }
    ])
  })

  it('查看详情只给最近 5 条操作记录', async () => {
    for (let i = 0; i < 4; i++) await m.stopBot(FEISHU).then(() => m.enableBot(FEISHU))
    expect((await m.getBot(FEISHU)).logs).toHaveLength(5)
  })
})

describe('新建（第四章 6.1、8）', () => {
  it('成功：状态「待平台发布」，排在列表最前', async () => {
    await m.createBot(wecomPayload())
    const { list } = await m.listBots()
    expect(list[0]).toMatchObject({ ch: 'wecom', name: '企微助手', status: 'PENDING' })
    expect(statusSubText(list[0])).toBe('企业微信侧未发布应用版本')
  })

  it('成功后企业微信也满了：三个平台都达到上限', async () => {
    await m.createBot(wecomPayload())
    expect((await m.getPlatformSlots()).every((s) => s.full)).toBe(true)
  })

  it('已达上限的平台不能再建：「飞书已达到机器人上限，每个 IM 平台最多接入 1 个机器人」', async () => {
    await expect(m.createBot({ ...wecomPayload(), ch: 'feishu' })).rejects.toMatchObject({
      field: 'ch',
      message: '飞书已达到机器人上限，每个 IM 平台最多接入 1 个机器人'
    })
  })

  it.each([
    [{ name: '' }, 'name', '机器人名称不能为空'],
    [{ name: ' 企 ' }, 'name', '机器人名称至少 2 个字'],
    [{ org: '' }, 'org', '请填写 CorpID'],
    [{ org: 'wx123456' }, 'org', 'CorpID 应以 ww 开头，只含字母或数字'],
    [{ appKey: '' }, 'appKey', '请填写 AgentID'],
    [{ appKey: '10a' }, 'appKey', 'AgentID 应为纯数字'],
    [{ secret: '' }, 'secret', '请填写 Secret'],
    [{ secret: 'short' }, 'secret', 'Secret 应为 16–128 位，不含空格'],
    [{ http: { token: '', aesKey: 'x' } }, 'http.token', '请填写 Token'],
    [{ callbackChecked: false }, 'callback', '请先在平台保存回调地址并完成校验']
  ])('校验 %j → %s「%s」，不落库', async (over, field, message) => {
    await expect(m.createBot(wecomPayload(over))).rejects.toMatchObject({ field, message })
    expect((await m.listBots()).total).toBe(2)
  })

  it('凭据验证失败（演示约定：密钥含 bad）：「凭据验证失败：平台返回 invalid credentials」', async () => {
    await expect(m.createBot(wecomPayload({ secret: 'badSecret12345678' }))).rejects.toMatchObject({
      field: 'secret',
      message: '凭据验证失败：平台返回 invalid credentials'
    })
  })

  it('组织不一致（演示约定：密钥含 other）：「凭据属于另一个企业微信组织，与本企业不一致，员工身份无法复用」', async () => {
    await expect(m.createBot(wecomPayload({ secret: 'otherOrg123456789' }))).rejects.toMatchObject({
      message: '凭据属于另一个企业微信组织，与本企业不一致，员工身份无法复用'
    })
  })

  it('访问审计「新建」：对象为机器人名称，变更内容「渠道 · 连接方式」', async () => {
    await m.createBot(wecomPayload())
    expect(liveOps()).toEqual([expect.objectContaining({ action: '新建', target: '企微助手', detail: '企业微信 · HTTP 回调' })])
  })
})

describe('验证凭据（第四章 3）', () => {
  it('通过：返回所属组织', async () => {
    expect(await m.verifyBotCredentials({ botId: FEISHU, secret: GOOD })).toEqual({ org: 'tenant_key 2f8a…c41e' })
  })

  it('失败：抛出原因，供按钮右侧展示「✕ 原因」', async () => {
    await expect(m.verifyBotCredentials({ botId: FEISHU, secret: 'wrongSecret123456' })).rejects.toThrow('凭据验证失败：平台返回 invalid credentials')
  })
})

describe('编辑（第三章 3.3、第四章 6、第十章）', () => {
  it('改用途说明：写访问审计「编辑」，变更摘要「用途说明：原 → 新」', async () => {
    await m.updateBot(FEISHU, await editOf(FEISHU, { desc: '全员入口' }))
    expect(liveOps()).toEqual([expect.objectContaining({ action: '编辑', target: 'iWorker 助手', detail: '用途说明：飞书上的统一入口 → 全员入口' })])
  })

  it('替换密钥：变更摘要只记「App Secret 已更新」，审计与操作记录都不含密钥内容', async () => {
    await m.updateBot(FEISHU, await editOf(FEISHU, { secret: GOOD }))
    expect(liveOps()[0].detail).toBe('App Secret 已更新')
    expect(JSON.stringify(opsRecords)).not.toContain(GOOD)
    expect(JSON.stringify((await m.getBot(FEISHU)).logs)).not.toContain(GOOD)
  })

  it('密钥不落库：持久化快照里没有密钥', async () => {
    await m.createBot(wecomPayload())
    await m.updateBot(FEISHU, await editOf(FEISHU, { secret: GOOD }))
    expect(JSON.stringify(persistState.opts.snapshot())).not.toContain(GOOD)
  })

  it('保存成功更新最近更新时间', async () => {
    await m.updateBot(DING, await editOf(DING, { name: '钉钉助手', secret: GOOD }))
    expect((await botRow(DING)).updatedAt).not.toBe('2026-09-10 11:05')
  })

  it('没有任何变化：不写访问审计', async () => {
    await m.updateBot(FEISHU, await editOf(FEISHU))
    expect(liveOps()).toHaveLength(0)
  })

  it('凭据失效而中断：不填新密钥不能保存「连接已中断，请填写新的 AppSecret」', async () => {
    await expect(m.updateBot(DING, await editOf(DING, { name: '钉钉助手' }))).rejects.toMatchObject({
      field: 'secret',
      message: '连接已中断，请填写新的 AppSecret'
    })
  })

  it('凭据失效而中断：填写新密钥保存成功后恢复为正常', async () => {
    await m.updateBot(DING, await editOf(DING, { secret: GOOD }))
    expect((await botRow(DING)).status).toBe('NORMAL')
  })

  it('系统检测的状态变化只写机器人操作记录（操作人「系统」），不进访问审计', async () => {
    await m.updateBot(DING, await editOf(DING, { secret: GOOD }))
    expect((await m.getBot(DING)).logs[0]).toMatchObject({ operator: '系统', action: '恢复正常' })
    expect(liveOps().map((r) => r.action)).toEqual(['编辑'])
  })

  it('演示约定 noperm：保存后检测到缺少必需权限 →「连接中断 · 缺少必需权限：Card.Instance.Write」', async () => {
    await m.updateBot(DING, await editOf(DING, { secret: 'noperm-1234567890abcd' }))
    const row = await botRow(DING)
    expect(row.status).toBe('DOWN')
    expect(statusSubText(row)).toBe('缺少必需权限：Card.Instance.Write')
  })

  it('因缺少权限而中断时不要求填写新密钥', async () => {
    await m.updateBot(DING, await editOf(DING, { secret: 'noperm-1234567890abcd' }))
    await expect(m.updateBot(DING, await editOf(DING, { desc: '改一下' }))).resolves.toMatchObject({ desc: '改一下' })
  })

  it('首次切换为 HTTP：未完成回调检测校验不能保存', async () => {
    await expect(
      m.updateBot(FEISHU, await editOf(FEISHU, { conn: 'http', http: { encryptKey: 'k1', verifyToken: 't1' }, callbackChecked: false }))
    ).rejects.toMatchObject({ field: 'callback', message: '请先在平台保存回调地址并完成校验' })
  })

  it('切换连接方式：变更摘要「连接方式：长连接 → HTTP 回调」', async () => {
    await m.updateBot(FEISHU, await editOf(FEISHU, { conn: 'http', http: { encryptKey: 'k1', verifyToken: 't1' }, callbackChecked: true }))
    expect(liveOps()[0].detail).toBe('连接方式：长连接 → HTTP 回调')
  })

  it('并发编辑：打开后已被他人更新 →「机器人已被其他管理员更新」，不覆盖', async () => {
    const stale = await editOf(FEISHU, { desc: '我的修改' })
    await m.updateBot(FEISHU, await editOf(FEISHU, { desc: '别人的修改' }))
    await expect(m.updateBot(FEISHU, stale)).rejects.toMatchObject({ code: 40900, message: '机器人已被其他管理员更新' })
    expect((await botRow(FEISHU)).desc).toBe('别人的修改')
  })
})

describe('停用与启用（第三章 3.5）', () => {
  it('停用：状态「已停用」，第二行「员工发消息不会得到回复」', async () => {
    await m.stopBot(FEISHU)
    const row = await botRow(FEISHU)
    expect(row.status).toBe('STOPPED')
    expect(statusSubText(row)).toBe('员工发消息不会得到回复')
  })

  it('停用：访问审计「停用」，对象为机器人名称，变更内容为空', async () => {
    await m.stopBot(FEISHU)
    expect(liveOps()).toEqual([expect.objectContaining({ action: '停用', target: 'iWorker 助手', detail: '' })])
  })

  it('启用：回到停用前的状态（正常的飞书回到正常），写访问审计「启用」', async () => {
    await m.stopBot(FEISHU)
    await m.enableBot(FEISHU)
    expect((await botRow(FEISHU)).status).toBe('NORMAL')
    expect(liveOps().map((r) => r.action)).toEqual(['启用', '停用'])
  })

  it('启用：凭据失效的钉钉启用后仍是连接中断（原因没解决）', async () => {
    await m.stopBot(DING)
    await m.enableBot(DING)
    expect(statusSubText(await botRow(DING))).toBe('AppSecret 已失效')
  })

  it('停用、启用都更新最近更新时间，排到最前', async () => {
    await m.stopBot(DING)
    expect((await m.listBots()).list[0].id).toBe(DING)
  })
})

describe('更换应用（第四章 3.1）', () => {
  it('新应用标识与当前相同：「和当前应用相同，无需更换」', async () => {
    await expect(m.verifySwapApp(FEISHU, { appKey: 'cli_a1b2c3d4e5f6', secret: GOOD })).rejects.toMatchObject({
      field: 'appKey',
      message: '和当前应用相同，无需更换'
    })
  })

  it('新应用标识已被其他机器人使用：「该 AppKey 已被其他机器人使用」', async () => {
    await expect(m.verifySwapApp(DING, { appKey: 'cli_a1b2c3d4e5f6', secret: GOOD })).rejects.toMatchObject({
      message: '该 AppKey 已被其他机器人使用'
    })
  })

  it('新应用属于另一个组织：验证不通过', async () => {
    await expect(m.verifySwapApp(FEISHU, { appKey: 'cli_new123', secret: 'otherOrg123456789' })).rejects.toThrow('凭据属于另一个飞书组织')
  })

  it('确认更换：应用标识换新、状态「待平台发布」', async () => {
    await m.swapApp(FEISHU, { appKey: 'cli_new123', secret: GOOD })
    expect(await botRow(FEISHU)).toMatchObject({ appKey: 'cli_new123', status: 'PENDING' })
  })

  it('访问审计「更换应用」：变更内容「原应用标识 → 新应用标识」', async () => {
    await m.swapApp(FEISHU, { appKey: 'cli_new123', secret: GOOD })
    expect(liveOps()).toEqual([expect.objectContaining({ action: '更换应用', target: 'iWorker 助手', detail: 'cli_a1b2c3d4e5f6 → cli_new123' })])
  })
})

describe('群聊治理（第五章 1、2）', () => {
  it('群列表按最近更新由近到远；带机器人名供查看抽屉展示', async () => {
    const { list } = await m.listGroups()
    expect(list.map((g) => g.name)).toEqual(['新能源事业部周会', '华东MES项目群', '销售华东区', '生产一厂日报群', '精密事业部周会'])
    expect(list[0].botName).toBe('iWorker 助手')
  })

  it.each([
    [{ keyword: ' 华东 ' }, ['华东MES项目群', '销售华东区']],
    [{ keyword: '王磊' }, ['精密事业部周会']],
    [{ ch: 'dingtalk' }, ['精密事业部周会']]
  ])('搜索群名称或拉入人、按渠道筛选 %j', async (params, names) => {
    expect((await m.listGroups(params)).list.map((g) => g.name)).toEqual(names)
  })

  it('移出：群不再出现在列表里', async () => {
    await m.removeGroup('g2')
    expect((await m.listGroups()).list.map((g) => g.id)).not.toContain('g2')
  })

  it('移出：所在机器人的群数随之减少（停用确认里的「N 个群」）', async () => {
    await m.removeGroup('g2')
    expect((await botRow(FEISHU)).groupCount).toBe(3)
  })

  it('移出：访问审计「移出群」，对象为群名称，变更内容为空', async () => {
    await m.removeGroup('g2')
    expect(liveOps()).toEqual([expect.objectContaining({ action: '移出群', target: '销售华东区', detail: '' })])
  })
})

describe('消息设置 · 消息合并等待时长（第三章 6）', () => {
  it('出厂值为 5 秒', async () => {
    expect(await m.getMessageSettings()).toEqual({ mergeWaitSec: 5 })
  })

  it('保存合法值后读回新值', async () => {
    await m.saveMessageSettings(8)
    expect(await m.getMessageSettings()).toEqual({ mergeWaitSec: 8 })
  })

  it.each([1, 30, '08'])('边界与前导零可保存：%s', async (v) => {
    await expect(m.saveMessageSettings(v)).resolves.toEqual({ mergeWaitSec: Number(v) })
  })

  it.each([
    ['', '请填写消息合并等待时长'],
    ['  ', '请填写消息合并等待时长'],
    [0, '请填写 1–30 之间的整数'],
    [31, '请填写 1–30 之间的整数'],
    ['2.5', '请填写 1–30 之间的整数'],
    ['-3', '请填写 1–30 之间的整数'],
    ['abc', '请填写 1–30 之间的整数']
  ])('非法值 %j 被拒，提示「%s」，原值不变（防绕过页面）', async (v, message) => {
    await expect(m.saveMessageSettings(v)).rejects.toMatchObject({ message, field: 'mergeWaitSec' })
    expect(await m.getMessageSettings()).toEqual({ mergeWaitSec: 5 })
  })

  it('值有变化：访问审计「渠道 / 修改配置」，对象「消息合并等待时长」，变更内容「5 秒 → 8 秒」，不附版本号', async () => {
    await m.saveMessageSettings(8)
    expect(liveOps()).toEqual([expect.objectContaining({ module: '渠道', action: '修改配置', target: '消息合并等待时长', detail: '5 秒 → 8 秒' })])
    expect(liveOps()[0].version).toBeUndefined()
  })

  it('值没变（含「05」这类写法）：不写审计', async () => {
    await m.saveMessageSettings(5)
    await m.saveMessageSettings('05')
    expect(liveOps()).toHaveLength(0)
  })

  it('连续修改各记一条，原值取上一次保存后的值', async () => {
    await m.saveMessageSettings(8)
    await m.saveMessageSettings(12)
    expect(liveOps().map((r) => r.detail)).toEqual(['8 秒 → 12 秒', '5 秒 → 8 秒'])
  })
})
