/**
 * 渠道 · 平台描述配置 + 部署级配置 + 共用校验（04运行 › 渠道，PRD docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md）。
 *
 * PRD 第一章 6「配置分层」：平台差异（凭据字段、校验规则、连接方式、权限清单）写在「平台描述配置」里，
 * 页面按配置渲染，新增平台或平台规则变化时只改这份配置，不改页面代码。本文件就是这份配置的前端示意：
 *   - PLATFORMS：平台描述配置（第一章 5 平台差异 + 附录 C 权限清单）；
 *   - DEPLOY：部署级配置（回调公网域名、出口 IP、每个 IM 平台的机器人上限），不在管理后台展示；
 *   - 校验函数：页面点【创建】/【保存】/【验证凭据】时先校验，mock 再兜一次，两边同一份规则；
 *   - 消息合并等待时长（第三章 6）：由原「配额与限流」页迁来（2026-11-16）。
 *
 * 格式校验原则（第一章 6）：只做宽松校验（必填、前缀、字符集、长度范围），凭据是否有效以【验证凭据】为准。
 */

/** 部署级配置（PRD 第一章 6）。上限 N 默认 1：所有已启用平台都达到上限后【新建机器人】置灰。 */
export const DEPLOY = {
  callbackBase: 'https://iworker.corp.cn',
  egressIps: ['203.0.113.10', '203.0.113.11'],
  botsPerPlatform: 1
}

/** 每平台上限文案，渠道字段提示与置灰提示共用 */
export const LIMIT_TEXT = `每个 IM 平台最多接入 ${DEPLOY.botsPerPlatform} 个机器人`

const SECRET_RULE = (label) => ({ re: /^\S{16,128}$/, bad: `${label} 应为 16–128 位，不含空格` })

/**
 * 平台描述配置。字段说明：
 *  - name / console：平台名、开发者后台名称（文案里的「{平台}」「{平台开发者后台}」）；
 *  - org：组织标识。needInput=true 的平台（企业微信）新建时要填 CorpID，其余验证凭据时自动获取；
 *  - key / secret：应用标识、应用密钥；
 *  - conns：连接方式，第一个为推荐；只有一个时只读展示；
 *  - httpFields：选 HTTP 时的额外字段（首次切换为 HTTP 时必填）；
 *  - perms：权限清单（附录 C），required / optional / events 三组；jsonImport 表示支持批量导入 JSON（仅飞书）；
 *  - demoOrg：mock 验证通过后返回的所属组织（演示用）。
 */
export const PLATFORMS = {
  feishu: {
    name: '飞书',
    console: '飞书开发者后台',
    enabled: true,
    org: { label: 'tenant_key', needInput: false },
    demoOrg: 'tenant_key 2f8a…c41e',
    key: { label: 'App ID', placeholder: 'cli_ 开头', re: /^cli_[0-9A-Za-z]+$/, bad: 'App ID 应以 cli_ 开头，只含字母或数字' },
    secret: { label: 'App Secret', placeholder: '应用凭证页查看', ...SECRET_RULE('App Secret') },
    conns: [
      { value: 'ws', label: '长连接', desc: '推荐。无需公网回调地址，私有化部署可直接使用' },
      { value: 'http', label: 'HTTP 回调', desc: '需要公网可达的回调地址，并用 Encrypt Key 验签' }
    ],
    httpFields: [
      { key: 'encryptKey', label: 'Encrypt Key' },
      { key: 'verifyToken', label: 'Verification Token' }
    ],
    perms: {
      jsonImport: true,
      required: [
        ['im:message', '获取与发送单聊、群组消息', '收发消息'],
        ['im:message:send_as_bot', '以应用身份发消息', '收发消息'],
        ['im:message.p2p_msg:readonly', '读取用户发给机器人的单聊消息', '收发消息'],
        ['im:message.group_at_msg:readonly', '接收群聊中 @ 机器人的消息', '收发消息'],
        ['im:message:send_multi_users', '给多个用户批量发消息', '收发消息（推送）'],
        ['contact:user.employee_id:readonly', '获取用户 user ID', '读取员工 ID']
      ],
      optional: [
        ['im:resource', '获取与上传图片或文件资源', '下载消息中的文件'],
        ['im:message.group_msg', '获取群组中所有消息（敏感权限，需平台审核）', '读取群内全部消息（后续版本“自动响应”使用，第一版不需要）']
      ],
      events: [
        ['im.message.receive_v1', '接收消息'],
        ['card.action.trigger', '卡片回传交互'],
        ['im.chat.member.bot.added_v1', '机器人进群'],
        ['im.chat.member.bot.deleted_v1', '机器人被移出群']
      ]
    }
  },
  dingtalk: {
    name: '钉钉',
    console: '钉钉开发者后台',
    enabled: true,
    org: { label: 'corpId', needInput: false },
    demoOrg: 'corpId ding8e1f…',
    key: { label: 'AppKey', placeholder: '应用凭证页的 Client ID（原 AppKey）', re: /^[0-9A-Za-z_-]{6,64}$/, bad: 'AppKey 应为 6–64 位字母、数字、下划线或短横线' },
    secret: { label: 'AppSecret', placeholder: '应用凭证页的 Client Secret（原 AppSecret）', ...SECRET_RULE('AppSecret') },
    conns: [
      { value: 'ws', label: 'Stream 模式', desc: '推荐。无需公网回调地址' },
      { value: 'http', label: 'HTTP 模式', desc: '需要公网可达的回调地址，用 AppSecret 验签' }
    ],
    httpFields: [],
    perms: {
      jsonImport: false,
      required: [
        ['qyapi_robot_sendmsg', '企业内机器人发送消息权限', '收发消息、推送'],
        ['qyapi_get_member', '成员信息读权限', '读取员工 ID'],
        ['Card.Instance.Write', '互动卡片实例写权限', '卡片回调'],
        ['Card.Streaming.Write', 'AI 卡片流式更新权限', '流式输出']
      ],
      optional: [
        ['机器人消息文件下载', '下载员工发给机器人的文件', '下载消息中的文件'],
        ['群内全部消息', '钉钉企业内部机器人默认只接收 @ 消息', '读取群内全部消息']
      ],
      events: [
        ['机器人消息回调', 'Stream 模式订阅'],
        ['卡片回调', 'Stream 模式订阅'],
        ['机器人进出群', '群会话机器人变更']
      ]
    }
  },
  wecom: {
    name: '企业微信',
    console: '企业微信管理后台',
    enabled: true,
    org: {
      label: 'CorpID',
      needInput: true,
      placeholder: 'ww 开头，在「我的企业 → 企业信息」查看',
      re: /^ww[0-9A-Za-z]+$/,
      bad: 'CorpID 应以 ww 开头，只含字母或数字'
    },
    demoOrg: 'corpId ww8f1e…',
    key: { label: 'AgentID', placeholder: '应用详情页查看，纯数字', re: /^\d+$/, bad: 'AgentID 应为纯数字' },
    secret: { label: 'Secret', placeholder: '应用详情页查看', ...SECRET_RULE('Secret') },
    conns: [{ value: 'http', label: 'HTTP 回调', desc: '企业微信自建应用只支持回调模式，需要把 iWorker 出口 IP 加入企业可信 IP' }],
    httpFields: [
      { key: 'token', label: 'Token' },
      { key: 'aesKey', label: 'EncodingAESKey' }
    ],
    perms: {
      jsonImport: false,
      required: [
        ['接收消息 · 设置 API 接收', '填写回调地址、Token、EncodingAESKey', '收发消息'],
        ['企业可信 IP', `加入 iWorker 出口 IP（${DEPLOY.egressIps.join('、')}）`, '调用发送消息接口'],
        ['通讯录 · 读取成员', '读取成员 userid', '读取员工 ID']
      ],
      optional: [
        ['获取临时素材', '下载员工发来的文件', '下载消息中的文件'],
        ['群内全部消息', '企业微信自建应用通常无法进入普通群', '读取群内全部消息']
      ],
      events: [
        ['接收消息', '员工发给应用的消息'],
        ['模板卡片事件', '卡片按钮回调'],
        ['进入应用', '员工打开应用会话']
      ]
    }
  }
}

/** 已启用平台（顺序即新建抽屉里渠道卡片的顺序、列表渠道筛选的顺序） */
export const PLATFORM_KEYS = Object.keys(PLATFORMS).filter((k) => PLATFORMS[k].enabled)

export const platformName = (ch) => PLATFORMS[ch]?.name || ch
export const connLabel = (ch, conn) => PLATFORMS[ch]?.conns.find((c) => c.value === conn)?.label || conn

/** 回调地址：由部署级配置的回调公网域名生成（第四章 3） */
export const callbackUrl = (ch) => `${DEPLOY.callbackBase}/open/im/${ch}/events`

/* ---------------- 状态 ---------------- */

/** 机器人状态（第三章 4）：label 与 StatusTag 色 */
export const BOT_STATUS = {
  NORMAL: { label: '正常', tag: 'success' },
  DOWN: { label: '连接中断', tag: 'danger' },
  PENDING: { label: '待平台发布', tag: 'warning' },
  STOPPED: { label: '已停用', tag: 'info' }
}
export const BOT_STATUS_OPTIONS = ['NORMAL', 'DOWN', 'PENDING', 'STOPPED'].map((v) => ({ value: v, label: BOT_STATUS[v].label }))

/** 连接中断是否因缺少必需权限（否则视为凭据失效） */
export const isPermissionDown = (bot) => bot?.status === 'DOWN' && bot.downReason?.kind === 'PERMISSION'
export const isSecretDown = (bot) => bot?.status === 'DOWN' && !isPermissionDown(bot)

/** 列表状态第二行（第三章 1） */
export function statusSubText(bot) {
  const p = PLATFORMS[bot.ch]
  if (bot.status === 'DOWN') {
    return isPermissionDown(bot) ? `缺少必需权限：${bot.downReason.missing.join('、')}` : `${p.secret.label} 已失效`
  }
  if (bot.status === 'PENDING') return `${p.name}侧未发布应用版本`
  if (bot.status === 'STOPPED') return '员工发消息不会得到回复'
  return ''
}

/* ---------------- 字段规则（第四章 2、3、8） ---------------- */

export const BOT_NAME_MIN = 2
export const BOT_NAME_MAX = 20
export const BOT_DESC_MAX = 60

export function botNameError(raw) {
  const n = String(raw ?? '').trim()
  if (!n) return '机器人名称不能为空'
  if (n.length < BOT_NAME_MIN) return `机器人名称至少 ${BOT_NAME_MIN} 个字`
  return ''
}

/** 组织标识（只有 needInput 的平台要填） */
export function orgError(ch, raw) {
  const o = PLATFORMS[ch].org
  if (!o.needInput) return ''
  const v = String(raw ?? '').trim()
  if (!v) return `请填写 ${o.label}`
  if (!o.re.test(v)) return o.bad
  return ''
}

/** 应用标识：必填 + 宽松格式（唯一性由 mock 判断，需要全量数据） */
export function appKeyError(ch, raw) {
  const k = PLATFORMS[ch].key
  const v = String(raw ?? '').trim()
  if (!v) return `请填写 ${k.label}`
  if (!k.re.test(v)) return k.bad
  return ''
}

/** 应用密钥：required=false 时空值合法（编辑态留空表示不修改） */
export function secretError(ch, raw, { required = true } = {}) {
  const s = PLATFORMS[ch].secret
  const v = String(raw ?? '').trim()
  if (!v) return required ? `请填写 ${s.label}` : ''
  if (!s.re.test(v)) return s.bad
  return ''
}

/* ---------------- 演示约定：凭据验证 ---------------- */

/**
 * mock 模拟平台返回的凭据验证结果（演示约定，写在 channelMock 头注）：
 *  - 密钥含 bad / wrong（不区分大小写）→ 凭据验证失败；
 *  - 密钥含 other → 凭据属于另一个组织；
 *  - 其余 → 通过。
 * @returns {string} 失败原因；通过返回空串
 */
export function simulateVerify(ch, secret) {
  const s = String(secret ?? '')
  if (/bad|wrong/i.test(s)) return '凭据验证失败：平台返回 invalid credentials'
  if (/other/i.test(s)) return `凭据属于另一个${PLATFORMS[ch].name}组织，与本企业不一致，员工身份无法复用`
  return ''
}

/** 演示约定：密钥含 noperm → 保存后的自动检测发现缺少必需权限（取该平台演示用的缺失项） */
export const DEMO_MISSING_PERM = { feishu: 'im:message:send_multi_users', dingtalk: 'Card.Instance.Write', wecom: '通讯录 · 读取成员' }
export const simulateMissingPerm = (ch, secret) => (/noperm/i.test(String(secret ?? '')) ? [DEMO_MISSING_PERM[ch]] : [])

/* ---------------- 权限清单复制（第四章 3） ---------------- */

/** 【复制清单】：每行「权限标识 ⇥ 中文说明 ⇥ 必需/按需 ⇥ 用于：功能」，事件单独一组 */
export function permListText(ch) {
  const { required, optional, events } = PLATFORMS[ch].perms
  const line = (r, tag) => `${r[0]}\t${r[1]}\t${tag}\t用于：${r[2]}`
  return [
    ...required.map((r) => line(r, '必需')),
    ...optional.map((r) => line(r, '按需')),
    '',
    '事件订阅',
    ...events.map((e) => `${e[0]}\t${e[1]}`)
  ].join('\n')
}

/** 飞书【复制必需权限（批量导入 JSON）】：只放必需权限 */
export function permImportJson(ch) {
  return JSON.stringify({ scopes: { tenant: PLATFORMS[ch].perms.required.map((r) => r[0]), user: [] } }, null, 2)
}

/* ---------------- 消息设置 · 消息合并等待时长（第三章 6） ---------------- */

/** 出厂默认 5 秒，只接受 1–30 的整数 */
export const MERGE_WAIT_DEFAULT_SEC = 5
export const MERGE_WAIT_MIN_SEC = 1
export const MERGE_WAIT_MAX_SEC = 30

/** 配置项名称：弹窗字段名与访问审计的操作对象共用 */
export const MERGE_WAIT_LABEL = '消息合并等待时长'

/**
 * 校验输入框里的原始文本。点【保存】时校验，不自动取整、不自动拉回范围。
 * @returns {string} 错误文案；合法返回空串
 */
export function mergeWaitInputError(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return '请填写消息合并等待时长'
  const n = Number(text)
  if (!/^\d+$/.test(text) || n < MERGE_WAIT_MIN_SEC || n > MERGE_WAIT_MAX_SEC) {
    return `请填写 ${MERGE_WAIT_MIN_SEC}–${MERGE_WAIT_MAX_SEC} 之间的整数`
  }
  return ''
}

/** 访问审计「变更内容」：原值 → 新值，如「5 秒 → 8 秒」 */
export const mergeWaitChangeText = (from, to) => `${from} 秒 → ${to} 秒`

/* ---------------- 群聊规则（第五章 4，第一版固定、只读） ---------------- */

/** 每个群的群内规则（查看群抽屉）：取群聊默认规则的固定值 */
export const GROUP_RULES = {
  respond: '仅 @ 机器人时响应',
  capability: '按发起人自己的能力',
  dossier: '需显式指令'
}

/** 群聊默认规则（第五章 4.2）：[规则, 第一版取值] */
export const GROUP_DEFAULT_RULES = [
  ['入群准入', '立即生效：任何已绑定员工把机器人拉进群即可使用'],
  ['群内响应方式', '仅 @ 机器人时响应'],
  ['群内能力范围', '按发起人自己的能力（岗位私有 + 内置 + 市场安装，和单聊一致）'],
  ['业务沉淀', '需显式指令（员工说“沉淀到 X”才写入工作档案）']
]

/** 固定规则（第五章 4.3，安全底线）：[规则, 内容] */
export const GROUP_FIXED_RULES = [
  ['执行身份', '群里每条指令、每个群定时任务，都以发起人本人执行时的身份和能力执行'],
  ['结果可见性', '个人数据（邮件、日程）、个人授权的连接器产出、命中敏感知识库的内容，结果只私信发起人，群里只提示“已私信你”'],
  ['产物与确认', '产物下载链接绑定发起人；二次确认卡只有发起人能点'],
  ['个人记忆', '群会话不写入任何人的个人工作记忆'],
  ['员工提示', '能力在群里不可用或结果只能私信时说明原因，如“该内容只能私信你，已发到单聊”；/skills 列出本群可用的能力']
]
