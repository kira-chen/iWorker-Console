// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ChannelBotEditor.vue（机器人抽屉）用例，2026-11-16 渠道首版。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md 第三章 3.2/3.3、第四章 1–3、3.1、5、6、7、8。
 *
 * 真实挂载（真 Element Plus + 真 DrawerEditor），api 层接真 channelMock（延迟调为 0、持久化截掉），
 * 断言落在用户可见结果：文案、按钮状态、保存后 mock 里的数据。确认窗经 useConfirm → ElMessageBox.confirm，用 spy 拦。
 * 抽屉 append-to-body，从 document.body 取节点。
 */
vi.mock('@/api/mockPersist', () => ({ attachPersist: () => () => {} }))
vi.mock('@/api/channel', async () => await import('@/api/channelMock'))

const mock = await import('@/api/channelMock')
const { resetAccessAuditMock } = await import('@/api/accessAuditMock')
const Editor = (await import('@/components/admin/channel/ChannelBotEditor.vue')).default

let mounted, savedSpy, successSpy, warnSpy, confirmSpy, visible
beforeEach(() => {
  mock.__setChannelMockLatency(0)
  mock.__resetChannelMock()
  resetAccessAuditMock()
  savedSpy = vi.fn()
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  warnSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }))
  vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
  confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function open(props = {}) {
  visible = ref(false)
  const Host = defineComponent({
    setup() {
      return () =>
        h(Editor, { ...props, visible: visible.value, 'onUpdate:visible': (v) => (visible.value = v), onSaved: savedSpy })
    }
  })
  mounted = mountReal(Host)
  await flushAll(2)
  visible.value = true
  await settle()
}
/** mock 延迟为 0 仍是 setTimeout：等宏任务再冲刷渲染 */
async function settle(n = 3) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushAll(4)
  }
}
const drawer = () => document.body.querySelector('.el-drawer')
const title = () => drawer().querySelector('.de-head-title').textContent.trim()
const field = (key) => drawer().querySelector(`[data-field="${key}"]`)
const errOf = (key) => field(key)?.querySelector('.cb-err')?.textContent.trim()
const hintOf = (key) => field(key)?.querySelector('.cb-hint')?.textContent.trim()
const byTest = (id) => document.body.querySelector(`[data-testid="${id}"]`)
const inputOf = (id) => byTest(id).querySelector('input, textarea') || byTest(id)
const btn = (text, root = drawer()) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
async function type(id, value) {
  const el = inputOf(id)
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushAll(3)
}
async function click(el) {
  el.click()
  await settle()
}
/** 确认窗正文：字符串直接返回；h() 渲染函数取文本 */
function confirmText(call = confirmSpy.mock.calls.at(-1)) {
  const msg = call[0]
  if (typeof msg === 'string') return msg
  const walk = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(walk).join('') : v?.children ? walk(v.children) : '')
  return walk(msg())
}
const getBot = (id) => mock.listBots().then((r) => r.list.find((b) => b.id === id))

/** 企业微信新建：填齐全部必填项 */
async function fillWecom({ secret = 'GoodSecret1234567890' } = {}) {
  await type('bot-name', '企微助手')
  await type('bot-org', 'ww8f1e2a3b4c')
  await type('bot-key', '1000012')
  await type('bot-secret', secret)
  await type('http-token', 'iWk7Tn2Rb9')
  await type('http-aesKey', 'aB3dE5fG7hJ9kL1mN3pQ')
}

describe('新建 · 渠道选择（第四章 2）', () => {
  it('标题「新建机器人」；达到上限的飞书、钉钉卡片置灰并说明「已接入「iWorker 助手」」', async () => {
    await open()
    expect(title()).toBe('新建机器人')
    for (const ch of ['feishu', 'dingtalk']) {
      const card = byTest(`ch-card-${ch}`)
      expect(card.classList.contains('is-disabled')).toBe(true)
      expect(card.textContent).toContain('已接入「iWorker 助手」')
    }
  })

  it('默认选中第一个未达上限的平台（企业微信），字段下方提示「每个 IM 平台最多接入 1 个机器人」', async () => {
    await open()
    expect(byTest('ch-card-wecom').getAttribute('aria-checked')).toBe('true')
    expect(hintOf('ch')).toBe('每个 IM 平台最多接入 1 个机器人')
  })

  it('点击已达上限的平台：提示「飞书已达到机器人上限，每个 IM 平台最多接入 1 个机器人」，选择不变', async () => {
    await open()
    await click(byTest('ch-card-feishu'))
    expect(warnSpy).toHaveBeenCalledWith('飞书已达到机器人上限，每个 IM 平台最多接入 1 个机器人')
    expect(byTest('ch-card-wecom').getAttribute('aria-checked')).toBe('true')
  })

  it('企业微信只有 HTTP 回调：连接方式只读展示，并展示回调地址与可信 IP 提示', async () => {
    await open()
    expect(field('conn').querySelector('input').value).toBe('HTTP 回调 · 企业微信自建应用只支持回调模式，需要把 iWorker 出口 IP 加入企业可信 IP')
    expect(inputOf('callback-url').value).toBe('https://iworker.corp.cn/open/im/wecom/events')
    expect(hintOf('callback')).toContain('同时把 iWorker 出口 IP 203.0.113.10、203.0.113.11 加入企业可信 IP。')
  })
})

describe('新建 · 必填与格式校验（第四章 6.1、8）', () => {
  it('不填直接【创建】：各必填项在字段下方提示，替换原提示文字，不创建', async () => {
    await open()
    await click(byTest('bot-submit'))
    expect(errOf('name')).toBe('机器人名称不能为空')
    expect(hintOf('name')).toBeUndefined()
    expect(errOf('org')).toBe('请填写 CorpID')
    expect(errOf('appKey')).toBe('请填写 AgentID')
    expect(errOf('secret')).toBe('请填写 Secret')
    expect(errOf('http.token')).toBe('请填写 Token')
    expect(errOf('http.aesKey')).toBe('请填写 EncodingAESKey')
    expect((await mock.listBots()).total).toBe(2)
  })

  it.each([
    ['bot-name', '企', 'name', '机器人名称至少 2 个字'],
    ['bot-org', 'wx123', 'org', 'CorpID 应以 ww 开头，只含字母或数字'],
    ['bot-key', '10a', 'appKey', 'AgentID 应为纯数字'],
    ['bot-secret', 'has space 1234567890', 'secret', 'Secret 应为 16–128 位，不含空格']
  ])('格式错误 %s=%j → 「%s」：%s', async (id, value, key, message) => {
    await open()
    await type(id, value)
    await click(byTest('bot-submit'))
    expect(errOf(key)).toBe(message)
  })

  it('修改该字段后错误立即消失', async () => {
    await open()
    await click(byTest('bot-submit'))
    await type('bot-name', '企微助手')
    expect(errOf('name')).toBeUndefined()
  })

  it('首次配置 HTTP 未【检测校验】：「请先在平台保存回调地址并完成校验」', async () => {
    await open()
    await fillWecom()
    await click(byTest('bot-submit'))
    expect(errOf('callback')).toBe('请先在平台保存回调地址并完成校验')
  })

  it('凭据验证失败（演示约定：密钥含 bad）：保存时在密钥下方提示，不创建', async () => {
    await open()
    await fillWecom({ secret: 'badSecret12345678' })
    await click(byTest('callback-check'))
    await click(byTest('bot-submit'))
    expect(errOf('secret')).toBe('凭据验证失败：平台返回 invalid credentials')
    expect((await mock.listBots()).total).toBe(2)
  })
})

describe('新建 · 验证凭据与创建（第四章 3、6.1）', () => {
  it('验证中：按钮右侧「验证中…」', async () => {
    await open()
    await fillWecom()
    mock.__setChannelMockLatency(1) // 恢复真实耗时，才看得到验证中间态
    byTest('verify').click()
    await flushAll(4)
    expect(byTest('verify-result').textContent.trim()).toBe('验证中…')
  })

  it('验证通过：「✓ 验证通过 · 所属组织 corpId ww8f1e2a3b4c」', async () => {
    await open()
    await fillWecom()
    await click(byTest('verify'))
    expect(byTest('verify-result').textContent.trim()).toBe('✓ 验证通过 · 所属组织 corpId ww8f1e2a3b4c')
  })

  it('验证失败：「✕ 凭据属于另一个企业微信组织，与本企业不一致，员工身份无法复用」', async () => {
    await open()
    await fillWecom({ secret: 'otherOrg123456789' })
    await click(byTest('verify'))
    expect(byTest('verify-result').textContent.trim()).toBe('✕ 凭据属于另一个企业微信组织，与本企业不一致，员工身份无法复用')
  })

  it('修改密钥后验证结果清空', async () => {
    await open()
    await fillWecom()
    await click(byTest('verify'))
    await type('bot-secret', 'AnotherSecret12345678')
    expect(byTest('verify-result')).toBeNull()
  })

  it('未手动验证时保存：按钮显示「正在验证凭据…」', async () => {
    await open()
    await fillWecom()
    await click(byTest('callback-check'))
    mock.__setChannelMockLatency(1) // 恢复真实耗时，才看得到保存中间态
    byTest('bot-submit').click()
    await flushAll(4)
    expect(byTest('bot-submit').textContent.trim()).toBe('正在验证凭据…')
  })

  it('创建成功：提示发布应用版本、关闭抽屉，新机器人状态「待平台发布」', async () => {
    await open()
    await fillWecom()
    await click(byTest('callback-check'))
    expect(hintOf('callback')).toContain('✓ 平台校验通过')
    await click(byTest('bot-submit'))
    expect(successSpy).toHaveBeenCalledWith('机器人已创建，请在企业微信管理后台发布应用版本并设置可用范围')
    expect(visible.value).toBe(false)
    expect(savedSpy).toHaveBeenCalled()
    expect((await mock.listBots()).list[0]).toMatchObject({ ch: 'wecom', name: '企微助手', status: 'PENDING' })
  })
})

describe('应用凭据 · 权限清单与密钥显示（第四章 3）', () => {
  it('【查看权限清单】展开三组，再点【收起权限清单】收起', async () => {
    await open({ botId: 'bot-feishu' })
    await click(byTest('toggle-perms'))
    expect(byTest('perm-list').textContent).toContain('必需权限')
    expect(byTest('perm-list').textContent).toContain('按需权限')
    expect(byTest('perm-list').textContent).toContain('事件订阅')
    expect(byTest('toggle-perms').textContent.trim()).toBe('收起权限清单')
    await click(byTest('toggle-perms'))
    expect(byTest('perm-list')).toBeNull()
  })

  it('飞书额外提供【复制必需权限（批量导入 JSON）】，复制后提示去开发者后台粘贴', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await open({ botId: 'bot-feishu' })
    await click(byTest('toggle-perms'))
    await click(btn('复制必需权限（批量导入 JSON）', byTest('perm-list')))
    expect(JSON.parse(writeText.mock.calls[0][0]).scopes.tenant).toContain('im:message:send_as_bot')
    expect(successSpy).toHaveBeenCalledWith('已复制，在飞书开发者后台「权限管理 → 批量导入权限」粘贴')
  })

  it('钉钉没有批量导入 JSON；【复制清单】按「标识 ⇥ 说明 ⇥ 必需/按需 ⇥ 用于：功能」逐行复制', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await open({ botId: 'bot-dingtalk' })
    await click(byTest('toggle-perms'))
    expect(btn('复制必需权限（批量导入 JSON）', byTest('perm-list'))).toBeUndefined()
    await click(btn('复制清单', byTest('perm-list')))
    expect(writeText.mock.calls[0][0].split('\n')[0]).toBe('qyapi_robot_sendmsg\t企业内机器人发送消息权限\t必需\t用于：收发消息、推送')
    expect(successSpy).toHaveBeenCalledWith('已复制到剪贴板')
  })

  it('密钥输入框【显示】/【隐藏】切换明文', async () => {
    await open()
    expect(inputOf('bot-secret').type).toBe('password')
    await click(byTest('toggle-secret'))
    expect(inputOf('bot-secret').type).toBe('text')
    expect(byTest('toggle-secret').textContent.trim()).toBe('隐藏')
  })
})

describe('编辑（第三章 3.3、第四章 3、6.2、7）', () => {
  it('标题「编辑机器人」；顶部时间信息；渠道只读「飞书 · tenant_key 2f8a…c41e」；App ID 只读并带【更换应用】', async () => {
    await open({ botId: 'bot-feishu' })
    expect(title()).toBe('编辑机器人')
    expect(drawer().querySelector('.cb-times').textContent).toContain('创建时间：2026-06-10 09:30')
    expect(drawer().querySelector('.cb-times').textContent).toContain('最近更新：2026-09-12 16:20')
    expect(field('ch').querySelector('input').value).toBe('飞书 · tenant_key 2f8a…c41e')
    expect(field('appKey').querySelector('input').readOnly).toBe(true)
    expect(byTest('swap-app')).toBeTruthy()
  })

  it('密钥占位「已配置 · 留空不修改」', async () => {
    await open({ botId: 'bot-feishu' })
    expect(inputOf('bot-secret').placeholder).toBe('已配置 · 留空不修改')
  })

  it('只改名称：普通配置变更不弹确认，提示「机器人已保存」', async () => {
    await open({ botId: 'bot-feishu' })
    await type('bot-name', '飞书助手')
    await click(byTest('bot-submit'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(successSpy).toHaveBeenCalledWith('机器人已保存')
    expect((await getBot('bot-feishu')).name).toBe('飞书助手')
  })

  it('切换连接方式：字段下方提示「切换连接方式会短暂中断收消息（约 10 秒），保存前会再次确认」', async () => {
    await open({ botId: 'bot-feishu' })
    await click(byTest('conn-http'))
    expect(byTest('conn-switch-hint').textContent.trim()).toBe('切换连接方式会短暂中断收消息（约 10 秒），保存前会再次确认')
  })

  it('替换密钥保存：先弹「连接配置变更」，列出变更项与重连影响', async () => {
    await open({ botId: 'bot-feishu' })
    await type('bot-secret', 'NewSecret1234567890')
    await click(byTest('bot-submit'))
    expect(confirmSpy.mock.calls[0][1]).toBe('连接配置变更')
    expect(confirmText()).toContain('App Secret 替换为新值')
    expect(confirmText()).toContain('重连期间约 10 秒收不到消息，平台会重试投递')
  })

  it('「连接配置变更」点取消：不保存', async () => {
    confirmSpy.mockRejectedValue('cancel')
    await open({ botId: 'bot-feishu' })
    await type('bot-secret', 'NewSecret1234567890')
    await click(byTest('bot-submit'))
    expect(successSpy).not.toHaveBeenCalled()
    expect(visible.value).toBe(true)
  })

  it('并发编辑冲突：提示「机器人已被其他管理员更新」并提供【加载最新内容】，不覆盖他人修改', async () => {
    await open({ botId: 'bot-feishu' })
    const b = await mock.getBot('bot-feishu')
    await mock.updateBot('bot-feishu', { name: b.name, desc: '别人改的', conn: b.conn, secret: '' })
    await type('bot-name', '我改的名字')
    await click(byTest('bot-submit'))
    expect(byTest('conflict').textContent).toContain('机器人已被其他管理员更新')
    expect(btn('加载最新内容')).toBeTruthy()
    expect((await getBot('bot-feishu')).name).toBe('iWorker 助手')
  })
})

describe('编辑 · 连接中断（第三章 3.3、评审补充）', () => {
  it('凭据失效：顶部红色提示「AppSecret 已失效……填写新的 AppSecret 并保存即可恢复」，密钥占位「填写新的 AppSecret」', async () => {
    await open({ botId: 'bot-dingtalk' })
    expect(byTest('down-banner').textContent).toContain('连接中断：AppSecret 已失效')
    expect(byTest('down-banner').textContent).toContain('在下方「应用凭据」填写新的 AppSecret 并保存即可恢复')
    expect(inputOf('bot-secret').placeholder).toBe('填写新的 AppSecret')
  })

  it('凭据失效未填新密钥就保存：「连接已中断，请填写新的 AppSecret」', async () => {
    await open({ botId: 'bot-dingtalk' })
    await click(byTest('bot-submit'))
    expect(errOf('secret')).toBe('连接已中断，请填写新的 AppSecret')
  })

  it('凭据失效填新密钥保存：确认后恢复为「正常」', async () => {
    await open({ botId: 'bot-dingtalk' })
    await type('bot-secret', 'NewSecret1234567890')
    await click(byTest('bot-submit'))
    expect((await getBot('bot-dingtalk')).status).toBe('NORMAL')
  })

  it('缺少必需权限：顶部提示「缺少必需权限 Card.Instance.Write……在钉钉开发者后台开通权限并发布应用版本后，系统会在 10 分钟内自动检测并恢复」', async () => {
    const b = await mock.getBot('bot-dingtalk')
    await mock.updateBot('bot-dingtalk', { name: b.name, desc: b.desc, conn: b.conn, secret: 'noperm-1234567890abcd' })
    await open({ botId: 'bot-dingtalk' })
    expect(byTest('down-banner').textContent).toContain('连接中断：缺少必需权限 Card.Instance.Write')
    expect(byTest('down-banner').textContent).toContain('在钉钉开发者后台开通权限并发布应用版本后，系统会在 10 分钟内自动检测并恢复')
  })

  it('缺少必需权限：不要求填写新密钥，密钥占位「已配置 · 留空不修改」', async () => {
    const b = await mock.getBot('bot-dingtalk')
    await mock.updateBot('bot-dingtalk', { name: b.name, desc: b.desc, conn: b.conn, secret: 'noperm-1234567890abcd' })
    await open({ botId: 'bot-dingtalk' })
    expect(inputOf('bot-secret').placeholder).toBe('已配置 · 留空不修改')
    await type('bot-desc', '改一下')
    await click(byTest('bot-submit'))
    expect(successSpy).toHaveBeenCalledWith('机器人已保存')
  })
})

describe('放弃修改确认（第四章 1）', () => {
  it('有未保存修改时点【取消】：弹「放弃未保存的修改？」（【继续编辑】【放弃修改】）', async () => {
    await open({ botId: 'bot-feishu' })
    await type('bot-name', '改了名字')
    await click(btn('取消'))
    expect(confirmSpy.mock.calls[0][1]).toBe('放弃未保存的修改？')
    expect(confirmSpy.mock.calls[0][2]).toMatchObject({ confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' })
  })

  it('选【继续编辑】：抽屉保持打开，填写内容还在', async () => {
    confirmSpy.mockRejectedValue('cancel')
    await open({ botId: 'bot-feishu' })
    await type('bot-name', '改了名字')
    await click(btn('取消'))
    expect(visible.value).toBe(true)
    expect(inputOf('bot-name').value).toBe('改了名字')
  })

  it('右上角关闭同样拦截', async () => {
    confirmSpy.mockRejectedValue('cancel')
    await open({ botId: 'bot-feishu' })
    await type('bot-name', '改了名字')
    await click(drawer().querySelector('.el-drawer__close-btn'))
    expect(confirmSpy.mock.calls[0][1]).toBe('放弃未保存的修改？')
    expect(visible.value).toBe(true)
  })

  it('没有修改：直接关闭，不弹确认', async () => {
    await open({ botId: 'bot-feishu' })
    await click(btn('取消'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(visible.value).toBe(false)
  })
})

describe('查看（第三章 3.2、第四章 5）', () => {
  it('标题「查看机器人」，底部只有【关闭】，输入项不可修改', async () => {
    await open({ botId: 'bot-feishu', readonly: true })
    expect(title()).toBe('查看机器人')
    const footer = [...document.body.querySelectorAll('.el-drawer__footer button')].map((b) => b.textContent.trim())
    expect(footer).toEqual(['关闭'])
    expect(inputOf('bot-name').disabled).toBe(true)
    expect(byTest('verify')).toBeNull()
  })

  it('员工能力三行：岗位私有能力（已分配岗位的 28,750 人）、内置能力（所有员工）、市场安装的能力（自己添加了的员工）', async () => {
    await open({ botId: 'bot-feishu', readonly: true })
    const text = byTest('capability').textContent
    expect(text).toContain('已分配岗位的 28,750 人')
    expect(text).toContain('所有员工')
    expect(text).toContain('自己添加了的员工')
  })

  it('操作记录：最近 5 条，含操作、时间、操作人和变更摘要', async () => {
    for (let i = 0; i < 3; i++) await mock.stopBot('bot-feishu').then(() => mock.enableBot('bot-feishu'))
    await open({ botId: 'bot-feishu', readonly: true })
    const items = byTest('bot-logs').querySelectorAll('li')
    expect(items).toHaveLength(5)
    expect(items[0].textContent).toContain('启用机器人')
  })

  it('种子记录里的变更摘要原样展示，如「用途说明：— → 飞书上的统一入口」', async () => {
    await open({ botId: 'bot-feishu', readonly: true })
    expect(byTest('bot-logs').textContent).toContain('2026-09-12 16:20 · 王芳 · 用途说明：— → 飞书上的统一入口')
  })

  it('编辑态不展示操作记录', async () => {
    await open({ botId: 'bot-feishu' })
    expect(byTest('bot-logs')).toBeNull()
  })
})

describe('更换应用（第四章 3.1）', () => {
  const dialog = () => document.body.querySelector('.sw-dialog')
  async function openSwap() {
    await open({ botId: 'bot-feishu' })
    await click(byTest('swap-app'))
  }

  it('窗口标题「更换应用 · iWorker 助手」，橙色说明条列出影响（已加入的 4 个群需要重新拉入）', async () => {
    await openSwap()
    expect(dialog().querySelector('.el-dialog__title').textContent).toBe('更换应用 · iWorker 助手')
    expect(byTest('swap-impact').textContent).toContain('已加入的 4 个群需要重新拉入新机器人')
  })

  it('验证通过前【更换应用】置灰', async () => {
    await openSwap()
    expect(byTest('swap-ok').disabled).toBe(true)
  })

  it('新应用标识与当前相同：「和当前应用相同，无需更换」', async () => {
    await openSwap()
    await type('swap-key', 'cli_a1b2c3d4e5f6')
    await type('swap-secret', 'NewSecret1234567890')
    await click(byTest('swap-verify'))
    expect(dialog().querySelector('.sw-err').textContent.trim()).toBe('和当前应用相同，无需更换')
  })

  it('验证通过 →【更换应用】→ 再次确认 → 状态「待平台发布」，提示去飞书开发者后台发布', async () => {
    await openSwap()
    await type('swap-key', 'cli_new123')
    await type('swap-secret', 'NewSecret1234567890')
    await click(byTest('swap-verify'))
    expect(dialog().textContent).toContain('✓ 验证通过，新应用与原组织一致')
    await click(byTest('swap-ok'))
    expect(confirmSpy.mock.calls[0][1]).toBe('确认更换应用？')
    expect(successSpy).toHaveBeenCalledWith('已更换应用，请在飞书开发者后台发布新应用版本')
    expect(await getBot('bot-feishu')).toMatchObject({ appKey: 'cli_new123', status: 'PENDING' })
  })
})
