/**
 * 用户技能审核内存 mock（demo 数据层，2026-09-02 补齐；开关见 skillReview.js）。
 *
 * 【覆盖范围】UserSkillReviews.vue 列表页 + ReviewSkillDetailPage.vue 整页查看器所调三接口：
 * listReviewApplications / getReviewApplication / reviewApplication。
 * 字段管理·风险类型/风险等级 CRUD 无页面调用方（字段字典页走 fieldDict.js），不 mock。
 *
 * 【种子 id 直用被审技能 id（demo 简化）】详情页拿 reviewId 调 listSkillFiles/getSkillFile
 * （source='review'，mock 分流进 unifiedSkillMock 按技能 id 取文件树）。种子审核记录的 id
 * 取 unifiedSkillMock 现有技能行 id（sk_301/305/308/309），文件树与 SKILL.md 即可直接渲染。
 *
 * 风险项形状对齐 SkillFocusEditor 的 rr-card：{ typeName, levelName, description }；
 * 类型/等级词表同 fieldDictMock 的 riskType/riskLevel（此处为快照文案，不做实时联动）。
 *
 * 状态口径：reviewStatus: PENDING | APPROVED | REJECTED；purpose: SELF_USE | PLATFORM_SHARE。
 * 仅 PENDING 可审核（页面按钮同步只在 PENDING 显示）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

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
      id: 'sk_308',
      skillName: '报销单智能填报',
      skillDescription: '按发票信息自动填写并提交报销单',
      purpose: 'PLATFORM_SHARE',
      reviewStatus: 'PENDING',
      applicantUserId: 'u_1021',
      applicantName: '陈晓',
      createdAt: '2026-09-01T10:24:00+08:00',
      reviewedAt: null,
      reviewComment: '',
      riskItems: [
        { typeName: '对外动作', levelName: '高风险', description: '技能会向报销系统提交单据（写操作），建议确认提交前有人工确认环节。' },
        { typeName: '敏感信息', levelName: '中风险', description: '流程中读取发票抬头与金额信息，需确认脱敏与留存策略。' }
      ]
    },
    {
      id: 'sk_305',
      skillName: '客户拜访准备',
      skillDescription: '汇总客户资料并生成拜访提纲',
      purpose: 'SELF_USE',
      reviewStatus: 'PENDING',
      applicantUserId: 'u_1036',
      applicantName: '周雨珊',
      createdAt: '2026-08-31T16:02:00+08:00',
      reviewedAt: null,
      reviewComment: '',
      riskItems: [
        { typeName: '权限范围', levelName: '建议修改', description: '引用了 CRM 客户查询工具，建议限定为申请人本人名下客户。' }
      ]
    },
    {
      id: 'sk_309',
      skillName: '行业研究助手',
      skillDescription: '汇总行业资料、竞品动态并生成结构化研究结论',
      purpose: 'PLATFORM_SHARE',
      reviewStatus: 'APPROVED',
      applicantUserId: 'u_1008',
      applicantName: '林一凡',
      createdAt: '2026-08-27T09:40:00+08:00',
      reviewedAt: '2026-08-28T11:15:00+08:00',
      reviewComment: '检测通过，同意上架平台。',
      riskItems: [{ typeName: '对外动作', levelName: '检测通过', description: '仅读取公开渠道信息，无写操作。' }]
    },
    {
      id: 'sk_301',
      skillName: '日报周报生成',
      skillDescription: '按模板汇总当日工作生成日报/周报',
      purpose: 'PLATFORM_SHARE',
      reviewStatus: 'REJECTED',
      applicantUserId: 'u_1021',
      applicantName: '陈晓',
      createdAt: '2026-08-25T14:12:00+08:00',
      reviewedAt: '2026-08-26T10:05:00+08:00',
      reviewComment: '含向 OA 系统直接提交的危险操作且无确认环节，请整改后重新提交。',
      riskItems: [
        { typeName: '危险操作', levelName: '高风险', description: '检测到直接调用 OA 提交接口，且未配置人工确认。' }
      ]
    }
  ]
}

let reviews = seedReviews()

// 【持久化】（2026-09-02）写点仅 reviewApplication；restore 校验失败即回种子（mockPersist 兜底）。
const persist = attachPersist('skillReview', {
  version: 1,
  snapshot: () => ({ reviews }),
  restore: (d) => {
    if (!d || !Array.isArray(d.reviews)) throw new Error('skillReview 快照形状不合法')
    reviews = d.reviews
  }
})

const toRow = (r) => ({ ...r, riskItems: r.riskItems.map((x) => ({ ...x })) })

// 列表（服务端分页）。params: { keyword?, status?, purpose?, page, size }。返回 { list, total }。
export async function listReviewApplications(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const status = String(params.status || '')
  const purpose = String(params.purpose || '')
  const list = reviews
    .filter(
      (r) =>
        (!kw ||
          [r.skillName, r.skillDescription, r.applicantName, r.applicantUserId].some((v) =>
            String(v || '').toLowerCase().includes(kw)
          )) &&
        (!status || r.reviewStatus === status) &&
        (!purpose || r.purpose === purpose)
    )
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

export async function getReviewApplication(reviewId) {
  await delay()
  const r = reviews.find((x) => String(x.id) === String(reviewId))
  if (!r) throw err('审核申请不存在', 40400)
  return toRow(r)
}

// 审核（通过/不通过）。body: { approved: boolean, comment?: string }。仅 PENDING 可审。
export async function reviewApplication(reviewId, payload = {}) {
  await delay()
  const r = reviews.find((x) => String(x.id) === String(reviewId))
  if (!r) throw err('审核申请不存在', 40400)
  if (r.reviewStatus !== 'PENDING') throw err('该申请已审核，不能重复操作', 40900)
  r.reviewStatus = payload.approved ? 'APPROVED' : 'REJECTED'
  r.reviewComment = String(payload.comment || '').trim()
  r.reviewedAt = nowIso()
  persist()
  return toRow(r)
}

/** 测试辅助：重置种子。 */
export function __resetSkillReviewMock() {
  reviews = seedReviews()
  persist()
}
