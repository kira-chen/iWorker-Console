// 工具调用审计 —— 数字员工调用外部工具 / 第三方知识服务的事后审计记录，只读 mock 数据。
// 三组数据对应页面的三个页签（口径见 PRD 正本 §一 页签结构）：
//   1. toolCallRecords    技能调用    用户在对话中触发的一次技能执行，执行中调连接器（MCP / API / 业务系统）
//   2. taskCallRecords    岗位自动化任务  定时触发、无人值守的一次任务运行，运行中调连接器
//   3. knowledgeCallRecords 知识库检索  岗位 / 专家引用的知识库，经 API / MCP 数据源检索第三方知识服务
//
// 2026-10-09 与研发（梅竹）讨论后改版：技能调用 / 岗位自动化任务两组的记录单元从「一次工具调用」
// 改为「一次技能执行 / 一次任务运行」（§一「记录单元」）——单次对话可能多次调用工具，按单条工具调用
// 上报数据量大，且单个工具失败、整体兜底成功时单纯记工具失败意义有限。改版后：
//   - 列表层是执行 / 运行记录，带「是否涉及写操作」「是否有待处理的确认（仅技能调用）」「整体执行结果」；
//   - 工具调用的明细（哪个工具、读写性质、各自确认与结果、参数响应）收进 calls 数组，由详情展开展示。
// 同轮讨论：岗位自动化任务原「写操作需任务内预授权」口径（AUTH_LABEL）废弃——自动化任务全部操作免授权、
// 不经确认，读写一致处理；原「任务运行编号」字段随之废弃，记录本身已是运行级，不必再用字段串联。
// 知识库检索页签明确不采用本次记录单元改版，维持改版前「一次检索=一条记录」。
//
// 技能调用的示例数据参考已退场的旧交互原型（数字员工管理端交互原型.html · 05治理/工具调用审计，
// 原型本身已于 2026-09-09/10 退场不作依据），本次改版重新分组为执行单元，场景未变、组合方式变了。
// 岗位自动化任务、知识库检索两组是 2026-09-28 按 PRD 新增页签补的，任务名 / 知识库名 / 数据源名
// 取自 sampleTaskMock / knowledgeBaseMock 的种子，不另造名字。
// 产品口径以 docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md 为准。
// 原型字段 role（如"销售顾问"）在本次改造中更名为 position（岗位），避免与 06组织/角色 的
// 权限角色概念混淆。

/** 工具调用（详情层，技能调用 / 岗位自动化任务两页签共用）的执行结果，五态不变。 */
export const RESULT_LABEL = {
  SUCCESS: '成功',
  FAILED: '执行失败',
  BLOCKED: '执行前拦截',
  CANCELLED: '用户取消',
  PENDING: '待确认'
}

/** 工具调用（详情层，仅技能调用页签——岗位自动化任务免授权、不出现确认环节）的用户确认状态。 */
export const CONFIRM_LABEL = {
  NONE: '不需要确认',
  CONFIRMED: '已确认',
  PENDING: '待确认',
  CANCELLED: '已取消'
}

export const NATURE_LABEL = { READ: '读', WRITE: '写' }

/** 技能执行（列表层）的整体结果：待确认的调用存在则「进行中」，否则按是否完成预期产出判定。 */
export const EXEC_RESULT_LABEL = { SUCCESS: '成功', FAILED: '失败', IN_PROGRESS: '进行中' }

/** 任务运行 / 知识库检索（列表层，均无人值守）的整体结果，没有「进行中」。 */
export const UNATTENDED_RESULT_LABEL = { SUCCESS: '成功', FAILED: '失败', BLOCKED: '执行前拦截' }
/** 上面三态按口径固定顺序排列，供筛选下拉复用（任务运行 / 知识库检索共用同一结果集）。 */
export const UNATTENDED_RESULTS = ['SUCCESS', 'FAILED', 'BLOCKED']

/**
 * 从一次执行 / 运行的工具调用明细，推导列表层需要的汇总字段（§一「记录单元」判定规则）：
 *   hasWrite  明细里有没有写操作
 *   pending   明细里有没有调用仍待用户确认（仅技能调用会出现，任务运行恒为 false）
 *   result    pending 为真记「进行中」；否则看明细里最后一次调用是否成功——
 *             这是 mock 对「是否完成预期产出」的简化模拟（真实判定由后端 / Agent 决定，
 *             这里只演示规则形态：哪怕中途有调用失败，只要最后收口成功，整体仍记"成功"）。
 * reason（失败原因概要）与 duration（耗时合计）仍由种子数据直接给出，不在此处拼接字符串。
 */
function deriveExec(calls) {
  const hasWrite = calls.some((c) => c.nature === 'WRITE')
  const pending = calls.some((c) => c.result === 'PENDING')
  const last = calls[calls.length - 1]
  const result = pending ? 'IN_PROGRESS' : last.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED'
  return { hasWrite, pending, result }
}

/** 岗位自动化任务版：没有待确认概念，BLOCKED 单独保留为「执行前拦截」，不并入「失败」。 */
function deriveTaskExec(calls) {
  const hasWrite = calls.some((c) => c.nature === 'WRITE')
  const last = calls[calls.length - 1]
  const result = last.result === 'SUCCESS' ? 'SUCCESS' : last.result === 'BLOCKED' ? 'BLOCKED' : 'FAILED'
  return { hasWrite, result }
}

/* ══════════════ 技能调用 ══════════════
 * 记录单元＝一次技能执行：calls 是这次执行里按发生顺序调用的工具明细（§五.2）。
 * 同一次对话里技能被循环调用多次，每次各自算一条独立执行，不合并——下面 10 条执行记录里
 * 大多数只调了一次工具；「报价单生成」「排产冲突检测」两条各调了两次，演示"一次执行多步"
 * 与"工具先失败、重试后整体仍成功"（后者对应与梅竹讨论的 G3：失败不应被整体结果盖掉）。 */
export const toolCallRecords = [
  {
    id: 'C-1001', date: '2026-09-20', time: '09:10:15', user: '周敏', position: '生产计划员', skill: '排产计划调整',
    reason: '业务系统·SAP ERP 连接超时', duration: '30 秒',
    calls: [
      { tool: '业务系统·SAP ERP', action: '修改排产计划', nature: 'WRITE', confirm: 'CONFIRMED', confirmedAt: '09:10:21', wait: '6 秒', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '09:10:51' }
    ]
  },
  {
    id: 'C-1002', date: '2026-09-26', time: '12:01:10', user: '李强', position: '财务助手', skill: '报销查询',
    reason: '', duration: '0.7 秒',
    calls: [
      { tool: 'API·费控系统', action: '查询报销进度', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.7 秒' }
    ]
  },
  {
    id: 'C-1003', date: '2026-09-26', time: '16:20:08', user: '陈杰', position: '销售顾问', skill: '客户记录更新',
    reason: '', duration: '0.9 秒',
    calls: [
      { tool: '业务系统·Salesforce CRM', action: '添加客户跟进记录', nature: 'WRITE', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.9 秒' }
    ]
  },
  {
    id: 'C-1004', date: '2026-09-27', time: '14:41:08', user: '刘敏', position: '销售顾问', skill: '客户信息查询',
    reason: '业务系统·Salesforce CRM 权限不足', duration: '未执行',
    calls: [
      { tool: '业务系统·Salesforce CRM', action: '查询客户信息', nature: 'READ', confirm: 'NONE', result: 'BLOCKED', reason: '权限不足', duration: '未执行' }
    ]
  },
  {
    id: 'C-1005', date: '2026-09-27', time: '14:45:12', user: '张浩', position: '生产计划员', skill: '生产数据查询',
    reason: '业务系统·SAP ERP 不在工具白名单', duration: '未执行',
    calls: [
      { tool: '业务系统·SAP ERP', action: '删除生产订单', nature: 'WRITE', confirm: 'NONE', result: 'BLOCKED', reason: '不在工具白名单', duration: '未执行' }
    ]
  },
  {
    id: 'C-1006', date: '2026-09-27', time: '14:52:05', user: '李强', position: '财务助手', skill: '报销单提交',
    reason: '用户取消本次操作', duration: '未执行',
    calls: [
      { tool: '业务系统·用友财务', action: '提交报销单', nature: 'WRITE', confirm: 'CANCELLED', wait: '12 秒', result: 'CANCELLED', reason: '用户取消本次操作', duration: '未执行', endAt: '14:52:17' }
    ]
  },
  {
    id: 'C-1007', date: '2026-09-27', time: '14:58:20', user: '周敏', position: '生产计划员', skill: '排产计划调整',
    reason: '', duration: '进行中',
    calls: [
      { tool: '业务系统·SAP ERP', action: '修改排产计划', nature: 'WRITE', confirm: 'PENDING', wait: '等待中', result: 'PENDING', reason: '', duration: '未执行' }
    ]
  },
  {
    // 先失败（超时）后重试成功：列表层仍记「成功」，失败细节只在详情里看到——与梅竹讨论的
    // G3 场景对应：工具本身失败、兜底 / 重试后整体仍完成，不应让单次失败盖掉整体结果。
    id: 'C-1008', date: '2026-09-27', time: '15:00:52', user: '张浩', position: '生产计划员', skill: '排产冲突检测',
    reason: '', duration: '32.3 秒',
    calls: [
      { tool: '业务系统·SAP ERP', action: '查询排产计划', nature: 'READ', confirm: 'NONE', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '15:01:22' },
      { tool: '业务系统·SAP ERP', action: '查询排产计划', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '2.3 秒', endAt: '15:01:32' }
    ]
  },
  {
    // 先查客户信息（读）再创建报价单（写，需确认）：一次执行里既有读也有写，"涉及写操作"记是。
    id: 'C-1009', date: '2026-09-27', time: '15:01:25', user: '陈杰', position: '销售顾问', skill: '报价单生成',
    reason: '', duration: '2.0 秒',
    calls: [
      { tool: '业务系统·Salesforce CRM', action: '查询客户信息', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.6 秒', endAt: '15:01:26' },
      {
        tool: '业务系统·Salesforce CRM', action: '创建报价单', nature: 'WRITE', confirm: 'CONFIRMED', confirmedAt: '15:01:47', wait: '8 秒',
        result: 'SUCCESS', reason: '', duration: '1.4 秒', endAt: '15:01:49',
        params: [
          ['客户编号', 'customer_id', 'C-20240612-0083'],
          ['客户名称', 'customer_name', '华东制造集团'],
          ['报价金额（人民币元）', 'amount', '800,000.00'],
          ['折扣参数', 'discount_rate', '0.18'],
          ['操作凭证', 'operator_token', '•••••••• 已脱敏'],
          ['联系电话', 'contact_phone', '138••••5678 已脱敏']
        ],
        output: { summary: '报价单创建成功', rows: [['报价单编号', 'QT-20260927-0083'], ['返回状态', '已创建']] }
      }
    ]
  },
  {
    id: 'C-1010', date: '2026-09-27', time: '15:02:11', user: '刘敏', position: '销售顾问', skill: '方案要点生成',
    reason: '', duration: '0.8 秒',
    calls: [
      {
        tool: 'MCP·文档生成服务', action: '生成方案摘要文档', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.8 秒',
        params: [
          ['输入内容', 'input', '制造企业数字化转型方案的核心要点'],
          ['输出格式', 'format', '摘要/要点列表'],
          ['最大长度', 'max_tokens', '800'],
          ['语言', 'language', 'zh-CN']
        ]
      }
    ]
  }
].map((r) => ({ ...r, ...deriveExec(r.calls) }))

/** 详情抽屉「实际请求参数」页签数据：[参数名, 技术标识, 本次请求值][]——call 自带则用，否则占位。 */
export function paramsOf(call) {
  return call.params || [['请求数据', 'payload', '【待补充】本次调用的实际请求参数']]
}

/** 详情抽屉「实际响应结果」页签数据——call 自带则用，否则按结果兜底。 */
export function outputOf(call) {
  if (call.output) return call.output
  if (['BLOCKED', 'CANCELLED', 'PENDING'].includes(call.result)) {
    return { text: '工具未执行，因此没有实际响应结果。' }
  }
  if (call.result === 'FAILED') {
    return { text: call.reason, note: '错误码及原始响应：【待补充】' }
  }
  return { text: '调用成功，实际响应内容【待补充】。' }
}

/** demo：全量返回，由 useAdminList 的 paged:'client' 模式本地筛选、排序、分页。 */
export async function listToolCallAudits() {
  return toolCallRecords
}

/* ══════════════ 岗位自动化任务 ══════════════
 * 记录单元＝一次任务运行：calls 是这次运行里按发生顺序调用的工具明细，结构同技能调用，
 * 只是没有 confirm 字段——任务无人值守，全部操作免授权、不经确认（2026-10-09 与研发讨论拍板）。
 * user / position 是任务所属用户（领用该岗位的用户），不是发起人；发起方是调度，见 trigger。 */
export const taskCallRecords = [
  {
    id: 'T-2001', date: '2026-09-21', time: '09:00:03', user: '陈杰', position: '市场研究岗', task: '每周竞品动态汇总', trigger: '定时·每周一 09:00',
    reason: '', duration: '1.6 秒',
    calls: [
      { tool: 'MCP·知识库 MCP', action: '检索竞品动态', nature: 'READ', result: 'SUCCESS', reason: '', duration: '1.6 秒', endAt: '09:00:04' }
    ]
  },
  {
    id: 'T-2002', date: '2026-09-24', time: '08:00:04', user: '周敏', position: '客户成功岗', task: '拜访前资料准备', trigger: '定时·每天 08:00',
    reason: '客户档案已锁定，写入被拒绝', duration: '0.7 秒',
    calls: [
      { tool: 'API·客户数据 API', action: '写入拜访提纲', nature: 'WRITE', result: 'FAILED', reason: '客户档案已锁定，写入被拒绝', duration: '0.7 秒', endAt: '08:00:05' }
    ]
  },
  {
    id: 'T-2003', date: '2026-09-24', time: '08:30:04', user: '刘敏', position: '经营分析岗', task: '每日经营晨报', trigger: '定时·每天 08:30',
    reason: '', duration: '1.1 秒',
    calls: [
      { tool: 'API·客户数据 API', action: '查询昨日营收数据', nature: 'READ', result: 'SUCCESS', reason: '', duration: '1.1 秒', endAt: '08:30:05' }
    ]
  },
  {
    id: 'T-2004', date: '2026-09-25', time: '10:00:05', user: '刘敏', position: '经营分析岗', task: '月度目标达成预警', trigger: '定时·每月 25 日 10:00',
    reason: 'API·客户数据 API 连接超时', duration: '30 秒',
    calls: [
      { tool: 'API·客户数据 API', action: '查询目标达成率', nature: 'READ', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '10:00:35' }
    ]
  },
  {
    id: 'T-2005', date: '2026-09-25', time: '17:00:03', user: '张浩', position: '经营分析岗', task: '供应商付款提醒', trigger: '定时·每周五 17:00',
    reason: '业务系统·用友财务 不在工具白名单', duration: '未执行',
    calls: [
      { tool: '业务系统·用友财务', action: '提交付款申请', nature: 'WRITE', result: 'BLOCKED', reason: '不在工具白名单', duration: '未执行' }
    ]
  },
  {
    id: 'T-2006', date: '2026-09-28', time: '08:00:03', user: '周敏', position: '客户成功岗', task: '拜访前资料准备', trigger: '定时·每天 08:00',
    reason: '', duration: '1.6 秒',
    calls: [
      {
        tool: 'API·客户数据 API', action: '写入拜访提纲', nature: 'WRITE', result: 'SUCCESS', reason: '', duration: '1.6 秒', endAt: '08:00:05',
        params: [
          ['客户编号', 'customer_id', 'C-20260611-0142'],
          ['拜访提纲', 'visit_outline', '本次拜访目标、议题与需确认事项（共 5 条）'],
          ['操作凭证', 'operator_token', '•••••••• 已脱敏']
        ],
        output: { summary: '拜访提纲已写入客户档案', rows: [['档案编号', 'ARC-20260611-0142'], ['返回状态', '已写入']] }
      }
    ]
  },
  {
    id: 'T-2007', date: '2026-09-28', time: '08:30:04', user: '刘敏', position: '经营分析岗', task: '每日经营晨报', trigger: '定时·每天 08:30',
    reason: '', duration: '2.1 秒',
    calls: [
      { tool: 'API·客户数据 API', action: '查询昨日营收数据', nature: 'READ', result: 'SUCCESS', reason: '', duration: '1.2 秒', endAt: '08:30:05' },
      { tool: 'MCP·知识库 MCP', action: '检索指标口径', nature: 'READ', result: 'SUCCESS', reason: '', duration: '0.9 秒', endAt: '08:30:08' }
    ]
  },
  {
    id: 'T-2008', date: '2026-09-28', time: '09:00:03', user: '陈杰', position: '市场研究岗', task: '每周竞品动态汇总', trigger: '定时·每周一 09:00',
    reason: '', duration: '1.4 秒',
    calls: [
      { tool: 'MCP·知识库 MCP', action: '检索竞品动态', nature: 'READ', result: 'SUCCESS', reason: '', duration: '1.4 秒', endAt: '09:00:04' }
    ]
  },
  {
    id: 'T-2009', date: '2026-09-28', time: '09:00:04', user: '刘敏', position: '经营分析岗', task: '季度财务简报', trigger: '定时·每月 28 日 09:00',
    reason: 'MCP·知识库 MCP 连接超时', duration: '32.1 秒',
    calls: [
      { tool: 'API·客户数据 API', action: '汇总本季度财务数据', nature: 'READ', result: 'SUCCESS', reason: '', duration: '2.1 秒', endAt: '09:00:06' },
      { tool: 'MCP·知识库 MCP', action: '检索财务简报模板', nature: 'READ', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '09:00:35' }
    ]
  },
  {
    id: 'T-2010', date: '2026-09-28', time: '09:00:06', user: '张浩', position: '经营分析岗', task: '库存低位预警', trigger: '定时·每天 09:00',
    reason: 'MCP·知识库 MCP 不在工具白名单', duration: '未执行',
    calls: [
      { tool: 'MCP·知识库 MCP', action: '检索库存预警阈值', nature: 'READ', result: 'BLOCKED', reason: '不在工具白名单', duration: '未执行' }
    ]
  }
].map((r) => ({ ...r, ...deriveTaskExec(r.calls) }))

export async function listTaskCallAudits() {
  return taskCallRecords
}

/* ══════════════ 知识库检索 ══════════════
 * 2026-10-09 与研发讨论后明确：本页签不采用「记录单元」改版，维持改版前口径——
 * 只记「经 API / MCP 数据源向第三方知识服务发出的检索」：上传型数据源走平台 RAG，不是外部调用，不入本表。
 * 只读、不需确认，结果只有 成功 / 执行失败 / 执行前拦截；命中 0 条属于「成功」，靠 hitCount 区分。
 * source 格式与另两组的 tool 一致（数据源类型·名称）；tool 仅 MCP 有（所选检索工具），API 为空。 */
const HITS_LAW = [
  ['GB/T 22239-2019 信息安全技术 网络安全等级保护基本要求', '法规库检索'],
  ['数据安全法（2021）第三章 数据安全制度', '法规库检索'],
  ['个人信息保护法（2021）第三章 个人信息跨境提供的规则', '法规库检索']
]

export const knowledgeCallRecords = [
  { id: 'K-3008', date: '2026-09-28', time: '10:12:33', user: '刘敏', position: '客户成功岗', kb: '产品与解决方案库', source: 'MCP·法规库检索', tool: 'search_documents', query: '智能排产系统的合规认证要求', topK: 5, hitCount: 5, hits: HITS_LAW, result: 'SUCCESS', reason: '', duration: '0.9 秒' },
  { id: 'K-3007', date: '2026-09-28', time: '09:41:07', user: '陈杰', position: '客户成功岗', kb: '产品与解决方案库', source: 'MCP·法规库检索', tool: 'search_documents', query: '数据出境评估办法适用范围', topK: 5, hitCount: 0, hits: [], result: 'SUCCESS', reason: '', duration: '0.7 秒' },
  { id: 'K-3006', date: '2026-09-27', time: '16:21:30', user: '李强', position: '财务审核岗', kb: '财务审核制度库', source: 'API·情报平台接口', tool: '', query: '差旅报销超标准处理流程', topK: 5, hitCount: 0, hits: [], result: 'FAILED', reason: '连接超时（8000 ms）', duration: '8 秒' },
  { id: 'K-3005', date: '2026-09-27', time: '16:20:45', user: '李强', position: '财务审核岗', kb: '财务审核制度库', source: 'API·情报平台接口', tool: '', query: '差旅报销超标准处理流程', topK: 5, hitCount: 0, hits: [], result: 'FAILED', reason: '连接超时（8000 ms）', duration: '8 秒' },
  { id: 'K-3004', date: '2026-09-27', time: '10:31:58', user: '张浩', position: '经营分析岗', kb: '财务审核制度库', source: 'API·情报平台接口', tool: '', query: '付款审批权限矩阵', topK: 5, hitCount: 0, hits: [], result: 'BLOCKED', reason: '无该知识库访问权限', duration: '未执行' },
  { id: 'K-3003', date: '2026-09-26', time: '14:15:22', user: '周敏', position: '客户成功岗', kb: '产品与解决方案库', source: 'MCP·法规库检索', tool: 'hybrid_search', query: '出口管制合规声明模板', topK: 5, hitCount: 3, hits: HITS_LAW, result: 'SUCCESS', reason: '', duration: '1.1 秒' },
  { id: 'K-3002', date: '2026-09-25', time: '15:48:10', user: '陈杰', position: '客户成功岗', kb: '产品与解决方案库', source: 'MCP·法规库检索', tool: 'search_documents', query: '等保三级对系统日志留存的要求', topK: 5, hitCount: 4, hits: HITS_LAW, result: 'SUCCESS', reason: '', duration: '1.3 秒' },
  { id: 'K-3001', date: '2026-09-24', time: '11:03:19', user: '刘敏', position: '客户成功岗', kb: '产品与解决方案库', source: 'MCP·法规库检索', tool: 'search_documents', query: '数据安全法对跨境传输的规定', topK: 5, hitCount: 5, hits: HITS_LAW, result: 'SUCCESS', reason: '', duration: '0.8 秒' }
]

/** 知识库检索的「实际请求参数」：检索词 + 返回条数上限（+ MCP 所选检索工具），由记录字段直接生成。 */
export function knowledgeParamsOf(record) {
  const rows = [
    ['检索词', 'query', record.query],
    ['返回条数上限', 'topK', String(record.topK)]
  ]
  if (record.tool) rows.push(['检索工具', 'tool', record.tool])
  return rows
}

/** 知识库检索的「实际响应结果」：命中列表 [标题, 来源名称]（PRD §九.5，对应数据源响应映射的 title / sourceName）。 */
export function knowledgeOutputOf(record) {
  if (record.result === 'BLOCKED') return { text: '检索未执行，因此没有实际响应结果。' }
  if (record.result === 'FAILED') return { text: record.reason, note: '错误码及原始响应：【待补充】' }
  if (record.hitCount === 0) return { text: '检索成功，命中 0 条。' }
  return {
    summary: `共命中 ${record.hitCount} 条，展示前 ${record.hits.length} 条`,
    headers: ['标题', '来源名称'],
    rows: record.hits
  }
}

export async function listKnowledgeCallAudits() {
  return knowledgeCallRecords
}
