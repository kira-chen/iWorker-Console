// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminChannel.vue 页面级用例（04运行 › 渠道，2026-11-16 首版）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md 第二章（导航栏、查询口径、页面状态）、
 * 第三章 1/3.1/3.5（机器人列表、操作按钮、停用启用）、第五章 1–4（群聊治理）、第十章（访问审计跳转注入）。
 *
 * 真实挂载（真 Element Plus + 真子组件），api 层接真 channelMock（延迟调为 0、持久化截掉）；
 * 需要模拟失败时对 api 包装函数 mockRejectedValueOnce。机器人抽屉细节见 components/admin/__tests__/channelBotEditor.test.js，
 * 消息设置弹窗见 channelMessageSettingsDialog.test.js，数据规则与审计见 api/__tests__/channelMock.test.js。
 */
vi.mock('@/api/mockPersist', () => ({ attachPersist: () => () => {} }))
vi.mock('@/api/channel', async () => {
  const real = await import('@/api/channelMock')
  return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(v) : v]))
})
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route }))

const api = await import('@/api/channel')
const mock = await import('@/api/channelMock')
const { resetAccessAuditMock } = await import('@/api/accessAuditMock')
const AdminChannel = (await import('@/views/admin/AdminChannel.vue')).default

let mounted, successSpy, confirmSpy, errorSpy
beforeEach(() => {
  mock.__setChannelMockLatency(0)
  mock.__resetChannelMock()
  resetAccessAuditMock()
  route.query = {}
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  expect(errorSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function settle(n = 3) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushAll(4)
  }
}
async function mountPage() {
  mounted = mountReal(AdminChannel)
  await settle()
  return mounted.container
}
const root = () => mounted.container
const pane = (name) => root().querySelector(`#pane-${name}`)
// el-input 的 data-testid 透传到内部 <input> 上，所以搜索框直接取到的就是 input
const byTest = (id, el = document.body) => el.querySelector(`[data-testid="${id}"]`)
const rowsOf = (name) => [...pane(name).querySelectorAll('.el-table__body-wrapper tbody tr')]
const rowOf = (name, text) => rowsOf(name).find((tr) => tr.textContent.includes(text))
const btn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
async function click(el) {
  el.click()
  await settle()
}
async function type(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushAll(3)
}
async function pickOption(selectTestId, label, scope) {
  byTest(selectTestId, scope).querySelector('.el-select__wrapper').click()
  await flushAll(4)
  // 下拉都挂在 body 上：只点当前展开（未隐藏）的那个下拉里的项
  const open = [...document.body.querySelectorAll('.el-select-dropdown__item')].filter((i) => i.textContent.trim() === label && i.closest('.el-popper')?.style.display !== 'none')
  open.at(-1).click()
  await settle()
}
const cellTexts = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())
const tabLabels = () => [...root().querySelectorAll('.el-tabs__item')].map((t) => t.textContent.trim())
const activeTab = () => root().querySelector('.el-tabs__item.is-active').textContent.trim()

describe('导航栏（第二章 1）', () => {
  it('标题「渠道」、说明「接入飞书、钉钉、企业微信机器人，统一配置单聊与群聊」、页签【机器人】【群聊治理】', async () => {
    await mountPage()
    expect(root().querySelector('.page-header-title').textContent.trim()).toBe('渠道')
    expect(root().querySelector('.page-header-sub').textContent.trim()).toBe('接入飞书、钉钉、企业微信机器人，统一配置单聊与群聊')
    expect(tabLabels()).toEqual(['机器人', '群聊治理'])
    expect(activeTab()).toBe('机器人')
  })

  it('切换页签保留各页签自己的搜索条件', async () => {
    await mountPage()
    await type(byTest('bot-search', pane('bot')), '钉钉')
    await click(root().querySelectorAll('.el-tabs__item')[1])
    await type(byTest('group-search', pane('group')), '华东')
    await click(root().querySelectorAll('.el-tabs__item')[0])
    expect(byTest('bot-search', pane('bot')).value).toBe('钉钉')
    expect(byTest('group-search', pane('group')).value).toBe('华东')
  })
})

describe('机器人页签 · 列表（第三章 1）', () => {
  it('业务说明条', async () => {
    await mountPage()
    expect(pane('bot').querySelector('.ch-note').textContent.replace(/\s+/g, '')).toBe(
      '每个IM平台最多接入1个机器人；员工在机器人里使用自己的全部能力（岗位私有+内置+市场安装），机器人不裁剪、也不额外授予能力。'
    )
  })

  it('列：机器人名称 / 用途说明 / 渠道 / 连接方式 / 状态 / 最近更新 / 操作', async () => {
    await mountPage()
    const heads = [...pane('bot').querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim()).filter(Boolean)
    expect(heads).toEqual(['机器人名称', '用途说明', '渠道', '连接方式', '状态', '最近更新', '操作'])
  })

  it('飞书行：名称、用途说明、飞书、长连接、正常、最近更新精确到分钟，操作【查看】【编辑】【停用】', async () => {
    await mountPage()
    expect(cellTexts(rowOf('bot', '飞书上的统一入口'))).toEqual(['iWorker 助手', '飞书上的统一入口', '飞书', '长连接', '正常', '2026-09-12 16:20', '查看编辑停用'])
  })

  it('连接中断：红色状态，第二行展示原因「AppSecret 已失效」', async () => {
    await mountPage()
    const tr = rowOf('bot', '钉钉上的统一入口')
    expect(tr.querySelector('.status-tag').textContent.trim()).toBe('连接中断')
    expect(tr.querySelector('.status-tag').className).toContain('st--danger')
    expect(byTest('status-sub', tr).textContent.trim()).toBe('AppSecret 已失效')
    expect(cellTexts(tr)[3]).toBe('Stream 模式')
  })

  it('用途说明为空展示「—」', async () => {
    const b = await mock.getBot('bot-feishu')
    await mock.updateBot('bot-feishu', { name: b.name, desc: '', conn: b.conn, secret: '' })
    await mountPage()
    expect(cellTexts(rowOf('bot', '长连接'))[1]).toBe('—')
  })

  it('底部汇总「2 个机器人 · 已接入 2 / 3 个 IM 平台」', async () => {
    await mountPage()
    expect(byTest('bot-summary', pane('bot')).textContent.trim()).toBe('2 个机器人 · 已接入 2 / 3 个 IM 平台')
  })

  it('汇总加载失败：底部显示「—」，列表照常展示', async () => {
    api.getBotSummary.mockRejectedValueOnce(new Error('超时'))
    await mountPage()
    expect(byTest('bot-summary', pane('bot')).textContent.trim()).toBe('—')
    expect(rowsOf('bot')).toHaveLength(2)
  })

  it('查询区右侧有【消息设置】【+ 新建机器人】；还有平台未达上限时新建可点', async () => {
    await mountPage()
    expect(byTest('open-msg-settings', pane('bot')).textContent.trim()).toBe('消息设置')
    expect(byTest('bot-create', pane('bot')).disabled).toBe(false)
  })

  it('所有平台都达到上限：【+ 新建机器人】置灰，悬停提示各 IM 平台均已达到上限', async () => {
    await mock.createBot({ ch: 'wecom', name: '企微助手', org: 'ww12345678', appKey: '1000012', secret: 'GoodSecret1234567890', conn: 'http', http: { token: 't', aesKey: 'k' }, callbackChecked: true })
    await mountPage()
    expect(byTest('bot-create', pane('bot')).disabled).toBe(true)
    expect(pane('bot').querySelector('.cbp-create-wrap').title).toBe('各 IM 平台均已达到机器人上限（每个 IM 平台最多接入 1 个机器人）')
  })

  it('【消息设置】打开「消息设置」弹窗', async () => {
    await mountPage()
    await click(byTest('open-msg-settings', pane('bot')))
    expect(document.body.querySelector('.ms-dialog .el-dialog__title').textContent).toBe('消息设置')
  })
})

describe('机器人页签 · 查询（第二章 2、3）', () => {
  it('输入关键词不回车不刷新；回车后按关键词过滤', async () => {
    await mountPage()
    const input = byTest('bot-search', pane('bot'))
    await type(input, '钉钉')
    await settle() // 给可能的自动刷新留出时间，再确认列表没变
    expect(rowsOf('bot')).toHaveLength(2)
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await settle()
    expect(rowsOf('bot').map((tr) => cellTexts(tr)[2])).toEqual(['钉钉'])
  })

  it('清空搜索内容后自动刷新', async () => {
    await mountPage()
    const input = byTest('bot-search', pane('bot'))
    await type(input, '钉钉')
    await click(btn(pane('bot'), '查询'))
    await type(input, '')
    await settle()
    expect(rowsOf('bot')).toHaveLength(2)
  })

  it('切换状态筛选后自动刷新', async () => {
    await mountPage()
    await pickOption('bot-status-filter', '连接中断', pane('bot'))
    expect(rowsOf('bot').map((tr) => cellTexts(tr)[2])).toEqual(['钉钉'])
  })

  it('无查询结果：「没有符合条件的记录」并提供【清空筛选】，点后恢复全部', async () => {
    await mountPage()
    await pickOption('bot-ch-filter', '企业微信', pane('bot'))
    expect(pane('bot').querySelector('[data-testid="list-empty"]').textContent.trim()).toBe('没有符合条件的记录')
    await click(btn(pane('bot'), '清空筛选'))
    expect(rowsOf('bot')).toHaveLength(2)
  })

  it('首次暂无机器人：「还没有机器人 · 点「新建机器人」接入第一个 IM 平台」', async () => {
    api.listBots.mockResolvedValueOnce({ list: [], total: 0 })
    await mountPage()
    expect(pane('bot').querySelector('[data-testid="list-empty"]').textContent.trim()).toBe('还没有机器人 · 点「新建机器人」接入第一个 IM 平台')
  })

  it('列表加载失败：展示「加载失败」和【重试】，点击后按当前条件重新加载', async () => {
    api.listBots.mockRejectedValueOnce(new Error('网络异常'))
    await mountPage()
    expect(pane('bot').textContent).toContain('加载失败')
    await click(btn(pane('bot'), '重试'))
    expect(rowsOf('bot')).toHaveLength(2)
  })
})

describe('机器人页签 · 停用与启用（第三章 3.1、3.5）', () => {
  it('停用二次确认文案按 PRD，确认按钮为红色【停用】', async () => {
    await mountPage()
    await click(btn(rowOf('bot', '飞书上的统一入口'), '停用'))
    const [msg, title, opts] = confirmSpy.mock.calls[0]
    expect(title).toBe('停用机器人')
    expect(msg).toBe('停用后，员工在飞书里给「iWorker 助手」发消息只会收到「机器人已停用」提示，机器人在 4 个群里不再响应，推送暂停（改发站内通知）。不影响网页端和客户端。确认停用？')
    expect(opts).toMatchObject({ confirmButtonText: '停用', confirmButtonClass: 'el-button--danger' })
  })

  it('确认停用：提示「机器人已停用」，状态「已停用」，操作列变为【启用】', async () => {
    await mountPage()
    await click(btn(rowOf('bot', '飞书上的统一入口'), '停用'))
    expect(successSpy).toHaveBeenCalledWith('机器人已停用')
    const tr = rowOf('bot', '飞书上的统一入口')
    expect(tr.querySelector('.status-tag').textContent.trim()).toBe('已停用')
    expect(byTest('status-sub', tr).textContent.trim()).toBe('员工发消息不会得到回复')
    expect(btn(tr, '启用')).toBeTruthy()
    expect(btn(tr, '停用')).toBeUndefined()
  })

  it('取消停用：不执行', async () => {
    confirmSpy.mockRejectedValue('cancel')
    await mountPage()
    await click(btn(rowOf('bot', '飞书上的统一入口'), '停用'))
    expect(rowOf('bot', '飞书上的统一入口').querySelector('.status-tag').textContent.trim()).toBe('正常')
  })

  it('启用直接生效，不二次确认，提示「机器人已启用」', async () => {
    await mock.stopBot('bot-feishu')
    await mountPage()
    await click(btn(rowOf('bot', '飞书上的统一入口'), '启用'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(successSpy).toHaveBeenCalledWith('机器人已启用')
    expect(rowOf('bot', '飞书上的统一入口').querySelector('.status-tag').textContent.trim()).toBe('正常')
  })

  it('机器人不提供删除', async () => {
    await mountPage()
    expect(btn(rowOf('bot', '飞书上的统一入口'), '删除')).toBeUndefined()
  })
})

describe('群聊治理页签（第五章）', () => {
  async function toGroup() {
    await mountPage()
    await click(root().querySelectorAll('.el-tabs__item')[1])
  }

  it('说明条与查询区：搜索占位「搜索群名称或拉入人」，右侧主按钮【群聊规则】', async () => {
    await toGroup()
    expect(pane('group').querySelector('.ch-note').textContent.replace(/\s+/g, '')).toBe(
      '群里的每条指令都以发起人本人的身份和权限执行；能力以发起人自己的能力为上限；所有群按「群聊规则」执行，不单独配置。'
    )
    expect(byTest('group-search', pane('group')).placeholder).toBe('搜索群名称或拉入人')
    expect(byTest('open-group-rules', pane('group')).className).toContain('el-button--primary')
  })

  it('群行：群名称 + 第二行「拉入人 {姓名} · {拉入时间}」、渠道、成员、最近更新、【查看】【移出】', async () => {
    await toGroup()
    expect(cellTexts(rowOf('group', '销售华东区'))).toEqual(['销售华东区拉入人 陈杰 · 2026-07-21 09:40', '飞书', '24', '2026-09-01 11:02', '查看移出'])
  })

  it('没有状态列：表头为 群 / 渠道 / 成员 / 最近更新 / 操作', async () => {
    await toGroup()
    const heads = [...pane('group').querySelectorAll('.el-table__header th')].map((th) => th.textContent.trim()).filter(Boolean)
    expect(heads).toEqual(['群', '渠道', '成员', '最近更新', '操作'])
  })

  it('底部汇总「5 个群」', async () => {
    await toGroup()
    expect(byTest('group-summary', pane('group')).textContent.trim()).toBe('5 个群')
  })

  it('移出二次确认文案按 PRD；确认后提示「机器人已移出群」，列表与汇总随之减少', async () => {
    await toGroup()
    await click(btn(rowOf('group', '销售华东区'), '移出'))
    expect(confirmSpy.mock.calls[0][0]).toBe('移出后机器人会退出「销售华东区」，群记录保留 30 天，期间重新拉入可恢复。确认移出？')
    expect(confirmSpy.mock.calls[0][1]).toBe('移出群')
    expect(successSpy).toHaveBeenCalledWith('机器人已移出群')
    expect(rowOf('group', '销售华东区')).toBeUndefined()
    expect(byTest('group-summary', pane('group')).textContent.trim()).toBe('4 个群')
  })

  it('【查看】打开「查看群」抽屉：群信息与群内规则，底部只有【关闭】', async () => {
    await toGroup()
    await click(btn(rowOf('group', '精密事业部周会'), '查看'))
    const d = [...document.body.querySelectorAll('.el-drawer')].find((x) => x.textContent.includes('查看群'))
    expect(byTest('group-info', d).textContent.replace(/\s+/g, '')).toBe('群名称精密事业部周会渠道/机器人钉钉·iWorker助手成员14人拉入人王磊')
    expect(byTest('group-rules', d).textContent.replace(/\s+/g, '')).toBe('响应方式仅@机器人时响应能力范围按发起人自己的能力业务沉淀需显式指令')
    expect(d.textContent).toContain('拉入时间：2026-06-03 16:00')
    expect([...d.querySelectorAll('.el-drawer__footer button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
  })

  it('【群聊规则】抽屉：群聊默认规则 4 条 + 固定规则 5 条，只读', async () => {
    await toGroup()
    await click(byTest('open-group-rules', pane('group')))
    const d = [...document.body.querySelectorAll('.el-drawer')].find((x) => x.textContent.includes('群聊默认规则'))
    expect([...byTest('default-rules', d).querySelectorAll('tbody td:first-child')].map((td) => td.textContent)).toEqual(['入群准入', '群内响应方式', '群内能力范围', '业务沉淀'])
    expect([...byTest('fixed-rules', d).querySelectorAll('tbody td:first-child')].map((td) => td.textContent)).toEqual(['执行身份', '结果可见性', '产物与确认', '个人记忆', '员工提示'])
    expect(d.querySelectorAll('input, textarea, select')).toHaveLength(0)
  })
})

describe('访问审计【查看】跳转注入（第十章）', () => {
  it('?keyword=机器人名称：停在【机器人】页签，搜索框带上名称并按它过滤', async () => {
    await mock.updateBot('bot-feishu', { ...(await mock.getBot('bot-feishu')), name: '飞书助手', secret: '' })
    route.query = { keyword: '飞书助手' }
    await mountPage()
    expect(activeTab()).toBe('机器人')
    expect(byTest('bot-search', pane('bot')).value).toBe('飞书助手')
    expect(rowsOf('bot').map((tr) => cellTexts(tr)[0])).toEqual(['飞书助手'])
  })

  it('?keyword=机器人名称：关键词只注入【机器人】，【群聊治理】的搜索框保持为空', async () => {
    route.query = { keyword: 'iWorker 助手' }
    await mountPage()
    expect(byTest('group-search', pane('group')).value).toBe('')
  })

  it('?tab=group&keyword=群名称：切到【群聊治理】并按群名称过滤，机器人页签不受影响', async () => {
    route.query = { tab: 'group', keyword: '销售华东区' }
    await mountPage()
    expect(activeTab()).toBe('群聊治理')
    expect(rowsOf('group').map((tr) => tr.querySelector('.ch-name').textContent)).toEqual(['销售华东区'])
    expect(byTest('bot-search', pane('bot')).value).toBe('')
  })

  it('同名参数重复（数组）时取第一个，不白屏', async () => {
    route.query = { keyword: ['iWorker', 'x'] }
    await mountPage()
    expect(byTest('bot-search', pane('bot')).value).toBe('iWorker')
  })
})
