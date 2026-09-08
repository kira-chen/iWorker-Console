/**
 * 用户技能审核内存 mock（demo 数据层；2026-09-08 PRD-20260908 对齐整页重做，开关见 skillReview.js）。
 *
 * 【覆盖范围】UserSkillReviews.vue 列表页 + UserSkillAuditDrawer 查看技能抽屉 + RiskSettingsDrawer 风险设置：
 *   listReviewApplications / getReviewApplication / approveReviewApplication / rejectReviewApplication
 *   getRiskConfig / setCurrentScale / saveRiskTemplate
 *
 * 【记录结构】（md §4.1 / §5 / §6；种子取自原型 L4415–4461 七条，等级改 md §2.2 五档命名）
 *   { id, skillName, description, submitter, submittedAt(ISO), status(PENDING|APPROVED|REJECTED),
 *     scale(宽松|通用|严格), skillMd, risks:[{ item, level, location, code, detail }], reviewer, reviewedAt, rejectReason }
 *   risks 只存命中的检测项；未命中项由 utils/userSkillAuditMeta.fullDetectionResults 补齐为「检测通过」。
 *   item 用内部标识（"敏感信息明文凭证"），展示名由页面转换（md §2.1 注）。
 *
 * 【风险设置】riskConfig = { currentScale, templates: { 宽松 / 通用 / 严格: { [item]: level | '不进入审核' } } }
 *   默认值表见 userSkillAuditMeta.DEFAULT_RISK_TEMPLATES（md §7.2）。
 *
 * 【状态词】接口枚举 PENDING/APPROVED/REJECTED；展示词由页面映射（待审核 / 已通过 / 已驳回，负责人裁决全站「待审核」）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import {
  DETECTION_ITEMS,
  ITEM_RISK_OPTIONS,
  AUDIT_SCALES,
  DEFAULT_CURRENT_SCALE,
  DEFAULT_RISK_TEMPLATES,
  cloneTemplate
} from '@/utils/userSkillAuditMeta'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, code = 40000) => new ApiError({ code, message })

// 本地时间 → ISO 串（mock 内时间统一带 +08:00，同 domainExpertMock.nowIso）
function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
  )
}

function seedReviews() {
  return [
    {
      id: 'usr_1',
      skillName: '自动发送邮件',
      description: '批量向外部邮箱发送邮件，支持附件与模板',
      submitter: 'zhangsan',
      submittedAt: '2026-09-01T10:23:00+08:00',
      status: 'PENDING',
      scale: '通用',
      skillMd:
        '## 功能\n\n批量向外部邮箱发送邮件，支持附件与自定义模板。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| recipients | 收件人列表（必填） |\n| subject | 邮件主题 |\n| template | 邮件模板名称 |\n| attachments | 附件路径列表 |\n\n## 示例\n\n```yaml\nname: send-email\nrecipients:\n  - a@corp.com\nsubject: 周报\ntemplate: weekly-report\n```\n\n## 注意\n\n需通过企业邮件网关外发，严禁直接使用个人邮箱账号。',
      risks: [
        {
          item: '对外动作',
          level: '中风险',
          location: 'send_email.py:34',
          code: 'smtp = smtplib.SMTP("smtp.gmail.com", 587)\nsmtp.login(SMTP_USER, SMTP_PASS)\nsmtp.sendmail(SMTP_USER, recipients, msg)',
          detail: '发现对外发送邮件的行为（smtplib），技能直连外部 SMTP 服务器，绕过企业邮件网关，存在数据外泄路径。'
        },
        {
          item: '敏感信息明文凭证',
          level: '高风险',
          location: 'send_email.py:7',
          code: 'SMTP_USER = "bot@corp.com"\nSMTP_PASS = "P@ssw0rd2026!"  # ← 硬编码口令',
          detail: '脚本顶部硬编码 SMTP 账号口令，任何可读取源码的人员均可获取邮件账号凭证，存在账号劫持和数据外泄风险。'
        }
      ],
      reviewer: '',
      reviewedAt: '',
      rejectReason: ''
    },
    {
      id: 'usr_2',
      skillName: '数据库批量清理',
      description: '定期清理过期数据库记录，支持自定义条件',
      submitter: 'lisi',
      submittedAt: '2026-08-30T14:05:00+08:00',
      status: 'REJECTED',
      scale: '严格',
      skillMd:
        '## 功能\n\n定期清理过期数据库记录，支持自定义条件。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| table | 目标数据表（必填） |\n| conditions | SQL 条件（必填，无条件下拒绝执行） |\n| batch_size | 单批删除行数 |\n\n## 示例\n\n```yaml\nname: db-cleanup\ntable: logs\nconditions: "created_at < now() - interval 90 day"\nbatch_size: 500\n```\n\n## 安全约束\n\n必须提供确定条件的 WHERE 子句，禁止无条件 DELETE。',
      risks: [
        {
          item: '危险操作',
          level: '严重风险',
          location: 'db_cleanup.py:52',
          code: '# 危险：conditions 未做非空校验时直接拼入 SQL\ncursor.execute(f"DELETE FROM {table} WHERE {conditions}")',
          detail: 'DELETE 语句通过 f-string 拼接用户传入的 conditions，若 conditions 为空字符串或仅含空白，将执行无条件全表删除，造成不可逆数据丢失。'
        },
        {
          item: '权限范围',
          level: '高风险',
          location: 'manifest.yml:18',
          code: 'permissions:\n  - db_admin          # ← 申请数据库管理员角色\n  - table_read: "*"   # ← 无限制读取所有表',
          detail: '技能申请 db_admin 权限，拥有对所有数据库表的读写和结构变更能力，严重违反最小权限原则，存在被滥用的高风险。'
        }
      ],
      reviewer: 'audit.admin',
      reviewedAt: '2026-08-31T09:20:00+08:00',
      rejectReason: 'DELETE 语句缺少 WHERE 非空校验，且申请 db_admin 权限远超业务所需，请整改后重新提交。'
    },
    {
      id: 'usr_3',
      skillName: 'Slack 通知推送',
      description: '将系统告警实时推送到指定 Slack 频道',
      submitter: 'wangwu',
      submittedAt: '2026-08-28T09:17:00+08:00',
      status: 'APPROVED',
      scale: '宽松',
      skillMd:
        '## 功能\n\n将系统告警实时推送到指定 Slack 频道。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| channel | 目标频道（必填） |\n| message | 推送内容 |\n| level | 告警级别 |\n\n## 示例\n\n```yaml\nname: slack-notify\nchannel: ops-alerts\nmessage: 数据库连接池告警\nlevel: warning\n```\n\n## 约束\n\n仅允许推送至企业内已授权的 Slack 频道，禁止对外群组。',
      risks: [
        {
          item: '对外动作',
          level: '低风险',
          location: 'notify.py:21',
          code: 'requests.post(SLACK_WEBHOOK_URL, json={"text": message})',
          detail: '技能通过 Slack Incoming Webhook 向企业内部频道发送通知，Webhook 地址指向内网，接收方为企业自有 Slack 工作区，属低风险对外调用行为，建议在审计日志中保留调用记录。'
        }
      ],
      reviewer: 'audit.admin',
      reviewedAt: '2026-08-28T11:02:00+08:00',
      rejectReason: ''
    },
    {
      id: 'usr_4',
      skillName: '内网文件同步',
      description: '将本地指定目录文件同步到企业共享网盘',
      submitter: 'zhaoliu',
      submittedAt: '2026-08-27T16:44:00+08:00',
      status: 'PENDING',
      scale: '通用',
      skillMd:
        '## 功能\n\n将本地指定目录文件同步到企业共享网盘。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| source_dir | 本地源目录（必填） |\n| target_dir | 共享网盘目标目录（必填） |\n| filter | 文件过滤规则 |\n\n## 示例\n\n```yaml\nname: file-sync\nsource_dir: /data/reports\ntarget_dir: /shared/ops/reports\nfilter: "*.pdf"\n```\n\n## 约束\n\n禁止同步至共享网盘根目录，目标目录需预先申请。',
      risks: [
        {
          item: '权限范围',
          level: '中风险',
          location: 'manifest.yml:12',
          code: 'permissions:\n  - file_share_read: "**"   # ← 通配符覆盖所有共享目录\n  - file_share_write: "**"',
          detail: '技能申请对所有共享文件夹的读写权限，未将访问范围限定到业务所需的具体目录，存在越权读取敏感部门文件的风险，建议按最小权限原则缩小路径范围。'
        },
        {
          item: '对外动作',
          level: '低风险',
          location: 'file_sync.py:38',
          code: 'conn = SMBConnection(username, password, "agent-host", "file-server")\nconn.connect("192.168.1.100", 445)',
          detail: '技能通过 SMB 协议连接企业内部文件服务器（192.168.1.100），属于内网访问行为，未发现外网出口，风险较低，但建议记录文件操作审计日志。'
        }
      ],
      reviewer: '',
      reviewedAt: '',
      rejectReason: ''
    },
    {
      id: 'usr_5',
      skillName: 'API 密钥管理器',
      description: '统一管理和定期轮换各服务 API 密钥',
      submitter: 'sunqi',
      submittedAt: '2026-08-25T11:30:00+08:00',
      status: 'REJECTED',
      scale: '严格',
      skillMd:
        '## 功能\n\n统一管理和定期轮换各服务 API 密钥。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| service | 服务标识（必填） |\n| rotation_days | 轮换周期（天） |\n| notify_email | 轮换通知邮箱 |\n\n## 示例\n\n```yaml\nname: rotate-key\nservice: payment\ndays: 30\nnotify: sec@corp.com\n```\n\n## 安全约束\n\n密钥不得硬编码于代码中，须使用受管密钥库存储。',
      risks: [
        {
          item: '敏感信息明文凭证',
          level: '严重风险',
          location: 'config.py:5',
          code: 'OPENAI_API_KEY = "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"\nAWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE"\nAWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n# ... 共 10 处硬编码凭证',
          detail: '代码文件中存在 10 处 API Key 明文写入，涉及 OpenAI、AWS 等多个云服务。任何拥有代码读取权限的人均可直接获取这些凭证，存在严重账号劫持和费用盗刷风险，需立即轮换所有相关密钥并改用环境变量或密钥管理服务。'
        },
        {
          item: '权限范围',
          level: '高风险',
          location: 'manifest.yml:9',
          code: 'permissions:\n  - secrets_manager_read: "*"  # ← 读取所有服务的密钥\n  - env_read: "*"              # ← 读取所有环境变量',
          detail: '技能申请读取密钥管理服务中所有条目及所有环境变量，权限范围远超当前业务需求，一旦技能被攻击者利用，可批量获取其他服务的凭证，建议按需限定到具体 Secret 名称。'
        }
      ],
      reviewer: 'audit.admin',
      reviewedAt: '2026-08-25T15:48:00+08:00',
      rejectReason: '源码中存在 10 处明文 API Key，请改用密钥管理服务并缩小权限范围后重新提交。'
    },
    {
      id: 'usr_6',
      skillName: '自动报表生成',
      description: '每日自动生成销售日报并发送至管理层',
      submitter: 'zhouba',
      submittedAt: '2026-08-24T08:00:00+08:00',
      status: 'APPROVED',
      scale: '宽松',
      skillMd:
        '## 功能\n\n每日自动生成销售日报并发送至管理层。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| recipients | 收件人列表（必填，仅企业域名） |\n| period | 统计周期 |\n\n## 示例\n\n```yaml\nname: sales-report\nrecipients:\n  - mgmt@corp.com\nperiod: yesterday\n```\n\n## 约束\n\n报表数据仅限企业内部使用，收件人须为管理员白名单。',
      risks: [
        {
          item: '对外动作',
          level: '低风险',
          location: 'report_mailer.py:44',
          code: 'recipients = ["team-reports@corp.com", "manager@corp.com"]\nsmtp.sendmail(SENDER, recipients, msg.as_string())',
          detail: '技能通过企业邮件服务器向内部邮件列表发送报告，收件方均为 @corp.com 域名，未发现外部地址，属于低风险对外通信行为，建议保留发件日志供审计。'
        }
      ],
      reviewer: 'audit.admin',
      reviewedAt: '2026-08-24T10:15:00+08:00',
      rejectReason: ''
    },
    {
      id: 'usr_7',
      skillName: '用户权限批量调整',
      description: '根据上传 Excel 文件批量修改用户系统权限',
      submitter: 'wujiu',
      submittedAt: '2026-08-22T15:20:00+08:00',
      status: 'PENDING',
      scale: '严格',
      skillMd:
        '## 功能\n\n根据上传的 Excel 文件批量修改用户系统权限。\n\n## 参数\n\n| 参数 | 说明 |\n| --- | --- |\n| excel_path | 权限变更清单（必填） |\n| dry_run | 是否先预览变更 |\n\n## 示例\n\n```yaml\nname: batch-perm\nfile: /data/perm.xlsx\ndry_run: true\n```\n\n## 安全约束\n\n必须开启 dry_run 预览，严禁直接授予系统管理员权限。',
      risks: [
        {
          item: '危险操作',
          level: '高风险',
          location: 'perm_manager.py:67',
          code: 'for root, dirs, files in os.walk(target_path):\n    for f in files:\n        os.chmod(os.path.join(root, f), 0o777)  # ← 递归赋予所有人读写执行',
          detail: '技能对 target_path 下所有文件递归执行 chmod 777，将影响大量用户及系统进程的文件访问控制，可能导致敏感配置文件、私钥等被任意用户读写，存在严重越权风险。'
        },
        {
          item: '权限范围',
          level: '高风险',
          location: 'manifest.yml:7',
          code: 'permissions:\n  - sudo: true          # ← 系统管理员完整权限\n  - file_write: "/**"   # ← 写入任意系统路径',
          detail: '技能申请 sudo 及全路径写入权限，具备对操作系统任意文件的修改能力，远超用户权限调整业务所需的最低权限范围，建议将权限限定到具体用户组管理接口，并增加操作二次确认机制。'
        }
      ],
      reviewer: '',
      reviewedAt: '',
      rejectReason: ''
    }
  ]
}

function seedRiskConfig() {
  return {
    currentScale: DEFAULT_CURRENT_SCALE,
    templates: Object.fromEntries(AUDIT_SCALES.map((s) => [s, cloneTemplate(DEFAULT_RISK_TEMPLATES[s])]))
  }
}

let reviews = seedReviews()
let riskConfig = seedRiskConfig()

// 【持久化】写点：approve / reject / setCurrentScale / saveRiskTemplate。
// version 2（2026-09-08）：记录结构由旧口径（reviewStatus/purpose/riskItems）改为新结构 + 新增 riskConfig，
// 旧快照形状不符即回种子（mockPersist 兜底）。
const persist = attachPersist('skillReview', {
  version: 2,
  snapshot: () => ({ reviews, riskConfig }),
  restore: (d) => {
    if (!d || !Array.isArray(d.reviews) || !d.riskConfig || !d.riskConfig.templates) {
      throw new Error('skillReview 快照形状不合法')
    }
    reviews = d.reviews
    riskConfig = d.riskConfig
  }
})

const toRow = (r) => ({ ...r, risks: (r.risks || []).map((x) => ({ ...x })) })
const cloneConfig = () => ({
  currentScale: riskConfig.currentScale,
  templates: Object.fromEntries(AUDIT_SCALES.map((s) => [s, cloneTemplate(riskConfig.templates[s])]))
})

/* ==================== 审核记录 ==================== */

/**
 * 列表（服务端分页）。params: { keyword?, scale?, status?, sort?('asc'|'desc'，默认 desc), page, size }。
 * keyword 模糊匹配 技能名称 / 描述 / 提交人（md §三）。返回 { list, total }。
 */
export async function listReviewApplications(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const scale = String(params.scale || '')
  const status = String(params.status || '')
  const dir = params.sort === 'asc' ? 1 : -1
  const list = reviews
    .filter(
      (r) =>
        (!kw || [r.skillName, r.description, r.submitter].some((v) => String(v || '').toLowerCase().includes(kw))) &&
        (!scale || r.scale === scale) &&
        (!status || r.status === status)
    )
    .sort((a, b) => dir * String(a.submittedAt).localeCompare(String(b.submittedAt)))
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

export async function getReviewApplication(reviewId) {
  await delay()
  const r = reviews.find((x) => String(x.id) === String(reviewId))
  if (!r) throw err('审核记录不存在', 40400)
  return toRow(r)
}

/** 通过（md §6.1）：记录审核人与审核时间，状态 → APPROVED。仅 PENDING 可审。payload: { reviewer } */
export async function approveReviewApplication(reviewId, payload = {}) {
  await delay()
  const r = reviews.find((x) => String(x.id) === String(reviewId))
  if (!r) throw err('审核记录不存在', 40400)
  if (r.status !== 'PENDING') throw err('该记录已审核，不能重复操作', 40900)
  r.status = 'APPROVED'
  r.reviewer = String(payload.reviewer || '').trim() || 'admin'
  r.reviewedAt = nowIso()
  r.rejectReason = ''
  persist()
  return toRow(r)
}

/** 驳回（md §6.2）：原因必填 ≤500 字；记录审核人 / 时间 / 原因，状态 → REJECTED。payload: { reviewer, reason } */
export async function rejectReviewApplication(reviewId, payload = {}) {
  await delay()
  const r = reviews.find((x) => String(x.id) === String(reviewId))
  if (!r) throw err('审核记录不存在', 40400)
  if (r.status !== 'PENDING') throw err('该记录已审核，不能重复操作', 40900)
  const reason = String(payload.reason || '').trim()
  if (!reason) throw err('请填写驳回原因')
  if (reason.length > 500) throw err('驳回原因不能超过 500 字')
  r.status = 'REJECTED'
  r.reviewer = String(payload.reviewer || '').trim() || 'admin'
  r.reviewedAt = nowIso()
  r.rejectReason = reason
  persist()
  return toRow(r)
}

/**
 * 旧签名兼容（ReviewSkillDetailPage 整页已退役为深链重定向，保留仅防旧调用方报错）：
 * { approved, comment } → 通过 / 驳回（驳回时 comment 即原因）。
 */
export function reviewApplication(reviewId, payload = {}) {
  return payload.approved
    ? approveReviewApplication(reviewId, { reviewer: payload.reviewer })
    : rejectReviewApplication(reviewId, { reviewer: payload.reviewer, reason: payload.comment })
}

/* ==================== 风险设置 ==================== */

/** 读风险设置：{ currentScale, templates } 拷贝。 */
export async function getRiskConfig() {
  await delay(120)
  return cloneConfig()
}

/** 当前审查尺度（md §7.1：选择即时生效）。 */
export async function setCurrentScale(scale) {
  await delay(120)
  if (!AUDIT_SCALES.includes(scale)) throw err('审核尺度不合法')
  riskConfig.currentScale = scale
  persist()
  return cloneConfig()
}

/**
 * 保存某一尺度模板（md §7.2「保存当前 Tab 的配置」）。template: { [item]: level | '不进入审核' }，
 * 每项必须在该检测项的可选集合内（md §7.2 表一）。
 */
export async function saveRiskTemplate(scale, template = {}) {
  await delay(160)
  if (!AUDIT_SCALES.includes(scale)) throw err('审核尺度不合法')
  const next = {}
  for (const item of DETECTION_ITEMS) {
    const v = template[item]
    if (!ITEM_RISK_OPTIONS[item].includes(v)) throw err(`「${item}」的触发等级不在可选范围内`)
    next[item] = v
  }
  riskConfig.templates[scale] = next
  persist()
  return cloneConfig()
}

/** 测试辅助：重置种子。 */
export function __resetSkillReviewMock() {
  reviews = seedReviews()
  riskConfig = seedRiskConfig()
  persist()
}
