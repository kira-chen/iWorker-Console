// 工具调用审计 —— 数字员工调用外部工具 / 第三方知识服务的事后审计记录，只读 mock 数据。
// 三组数据对应页面的三个页签（口径见 PRD 正本 §一 页签结构）：
//   1. toolCallRecords    技能调用    用户在对话中触发，技能调连接器（MCP / API / 业务系统）
//   2. taskCallRecords    岗位自动化任务  定时触发、无人值守，任务调连接器
//   3. knowledgeCallRecords 知识库检索  岗位 / 专家引用的知识库，经 API / MCP 数据源检索第三方知识服务
//
// 技能调用的字段与示例数据参考已退场的旧交互原型（数字员工管理端交互原型.html · 05治理/工具调用审计，
// 原型本身已于 2026-09-09/10 退场不作依据，此处仅复用其示例数据完成本次改造）；
// 岗位自动化任务、知识库检索两组是 2026-09-28 按 PRD 新增页签补的，任务名 / 知识库名 / 数据源名
// 取自 sampleTaskMock / knowledgeBaseMock 的种子，不另造名字。
// 产品口径以 docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md 为准。
// 原型字段 role（如"销售顾问"）在本次改造中更名为 position（岗位），避免与 06组织/角色 的
// 权限角色概念混淆。

export const RESULT_LABEL = {
  SUCCESS: '成功',
  FAILED: '执行失败',
  BLOCKED: '执行前拦截',
  CANCELLED: '用户取消',
  PENDING: '待确认'
}

export const CONFIRM_LABEL = {
  NONE: '不需要确认',
  CONFIRMED: '已确认',
  PENDING: '待确认',
  CANCELLED: '已取消'
}

export const NATURE_LABEL = { READ: '读', WRITE: '写' }

/** 无人值守调用（岗位自动化任务、知识库检索）没有用户在场，不会出现「用户取消 / 待确认」。 */
export const UNATTENDED_RESULTS = ['SUCCESS', 'FAILED', 'BLOCKED']

/** 岗位自动化任务的写操作授权（本期演示口径，配置入口待补，见 docs/04-待补需求定义/）。 */
export const AUTH_LABEL = { NONE: '不需要授权', AUTHORIZED: '已预授权', UNAUTHORIZED: '未授权' }

export const toolCallRecords = [
  { id: 'C-1012', date: '2026-09-27', time: '15:02:11', user: '刘敏', position: '销售顾问', skill: '方案要点生成', tool: 'MCP·文档生成服务', action: '生成方案摘要文档', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.8 秒', wait: '不适用' },
  { id: 'C-1011', date: '2026-09-27', time: '15:01:39', user: '陈杰', position: '销售顾问', skill: '报价单生成', tool: '业务系统·Salesforce CRM', action: '创建报价单', nature: 'WRITE', confirm: 'CONFIRMED', result: 'SUCCESS', reason: '', duration: '1.4 秒', wait: '8 秒', confirmedAt: '15:01:47', endAt: '15:01:49' },
  { id: 'C-1010', date: '2026-09-27', time: '15:00:52', user: '张浩', position: '生产计划员', skill: '排产冲突检测', tool: '业务系统·SAP ERP', action: '查询排产计划', nature: 'READ', confirm: 'NONE', result: 'FAILED', reason: '连接超时', duration: '30 秒', wait: '不适用', endAt: '15:01:22' },
  { id: 'C-1009', date: '2026-09-27', time: '14:58:20', user: '周敏', position: '生产计划员', skill: '排产计划调整', tool: '业务系统·SAP ERP', action: '修改排产计划', nature: 'WRITE', confirm: 'PENDING', result: 'PENDING', reason: '', duration: '未执行', wait: '等待中' },
  { id: 'C-1008', date: '2026-09-27', time: '14:52:05', user: '李强', position: '财务助手', skill: '报销单提交', tool: '业务系统·用友财务', action: '提交报销单', nature: 'WRITE', confirm: 'CANCELLED', result: 'CANCELLED', reason: '用户取消本次操作', duration: '未执行', wait: '12 秒', endAt: '14:52:17' },
  { id: 'C-1007', date: '2026-09-27', time: '14:45:12', user: '张浩', position: '生产计划员', skill: '生产数据查询', tool: '业务系统·SAP ERP', action: '删除生产订单', nature: 'WRITE', confirm: 'NONE', result: 'BLOCKED', reason: '不在工具白名单', duration: '未执行', wait: '不适用' },
  { id: 'C-1006', date: '2026-09-27', time: '14:41:08', user: '刘敏', position: '销售顾问', skill: '客户信息查询', tool: '业务系统·Salesforce CRM', action: '查询客户信息', nature: 'READ', confirm: 'NONE', result: 'BLOCKED', reason: '权限不足', duration: '未执行', wait: '不适用' },
  { id: 'C-1005', date: '2026-09-27', time: '15:01:25', user: '陈杰', position: '销售顾问', skill: '报价单生成', tool: '业务系统·Salesforce CRM', action: '查询客户信息', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.6 秒', wait: '不适用' },
  { id: 'C-1004', date: '2026-09-27', time: '15:01:30', user: '张浩', position: '生产计划员', skill: '排产冲突检测', tool: '业务系统·SAP ERP', action: '查询排产计划', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '2.3 秒', wait: '不适用' },
  { id: 'C-1003', date: '2026-09-26', time: '16:20:08', user: '陈杰', position: '销售顾问', skill: '客户记录更新', tool: '业务系统·Salesforce CRM', action: '添加客户跟进记录', nature: 'WRITE', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.9 秒', wait: '不适用' },
  { id: 'C-1002', date: '2026-09-26', time: '12:01:10', user: '李强', position: '财务助手', skill: '报销查询', tool: 'API·费控系统', action: '查询报销进度', nature: 'READ', confirm: 'NONE', result: 'SUCCESS', reason: '', duration: '0.7 秒', wait: '不适用' },
  { id: 'C-1001', date: '2026-09-20', time: '09:10:15', user: '周敏', position: '生产计划员', skill: '排产计划调整', tool: '业务系统·SAP ERP', action: '修改排产计划', nature: 'WRITE', confirm: 'CONFIRMED', result: 'FAILED', reason: '连接超时', duration: '30 秒', wait: '6 秒', confirmedAt: '09:10:21', endAt: '09:10:51' }
]

// 请求参数 / 响应结果按记录编号覆盖：没有覆盖的记录走通用兜底（见 paramsOf / outputOf）。
// 技能调用（C-）与岗位自动化任务（T-）共用这两张表，知识库检索（K-）的参数由记录字段直接生成。
const PARAM_OVERRIDES = {
  'C-1011': [
    ['客户编号', 'customer_id', 'C-20240612-0083'],
    ['客户名称', 'customer_name', '华东制造集团'],
    ['报价金额（人民币元）', 'amount', '800,000.00'],
    ['折扣参数', 'discount_rate', '0.18'],
    ['操作凭证', 'operator_token', '•••••••• 已脱敏'],
    ['联系电话', 'contact_phone', '138••••5678 已脱敏']
  ],
  'C-1012': [
    ['输入内容', 'input', '制造企业数字化转型方案的核心要点'],
    ['输出格式', 'format', '摘要/要点列表'],
    ['最大长度', 'max_tokens', '800'],
    ['语言', 'language', 'zh-CN']
  ],
  'T-2006': [
    ['客户编号', 'customer_id', 'C-20260611-0142'],
    ['拜访提纲', 'visit_outline', '本次拜访目标、议题与需确认事项（共 5 条）'],
    ['操作凭证', 'operator_token', '•••••••• 已脱敏']
  ]
}

const OUTPUT_OVERRIDES = {
  'C-1011': { summary: '报价单创建成功', rows: [['报价单编号', 'QT-20260927-0083'], ['返回状态', '已创建']] },
  'T-2006': { summary: '拜访提纲已写入客户档案', rows: [['档案编号', 'ARC-20260611-0142'], ['返回状态', '已写入']] }
}

/** 详情抽屉「实际请求参数」页签数据：[参数名, 技术标识, 本次请求值][]。 */
export function paramsOf(record) {
  return PARAM_OVERRIDES[record.id] || [['请求数据', 'payload', '【待补充】本次调用的实际请求参数']]
}

/** 详情抽屉「实际响应结果」页签数据。 */
export function outputOf(record) {
  if (OUTPUT_OVERRIDES[record.id]) return OUTPUT_OVERRIDES[record.id]
  if (['BLOCKED', 'CANCELLED', 'PENDING'].includes(record.result)) {
    return { text: '工具未执行，因此没有实际响应结果。' }
  }
  if (record.result === 'FAILED') {
    return { text: record.reason, note: '错误码及原始响应：【待补充】' }
  }
  return { text: '调用成功，实际响应内容【待补充】。' }
}

/** demo：全量返回，由 useAdminList 的 paged:'client' 模式本地筛选、排序、分页。 */
export async function listToolCallAudits() {
  return toolCallRecords
}

/* ══════════════ 岗位自动化任务 ══════════════
 * 任务按调度计划触发、无人值守：user / position 是任务所属用户（领用该岗位的用户）及其岗位，
 * 不是「发起人」；runId 标识「一次任务运行」，同一次运行内的多次工具调用共用（PRD §八）。
 * 写操作无法当场确认，演示口径为任务里预授权：AUTHORIZED 执行，UNAUTHORIZED 执行前拦截。 */
export const taskCallRecords = [
  { id: 'T-2012', runId: 'RUN-20260928-7013', date: '2026-09-28', time: '09:00:06', user: '张浩', position: '经营分析岗', task: '库存低位预警', trigger: '定时·每天 09:00', tool: 'MCP·知识库 MCP', action: '检索库存预警阈值', nature: 'READ', auth: 'NONE', result: 'BLOCKED', reason: '不在工具白名单', duration: '未执行' },
  { id: 'T-2011', runId: 'RUN-20260928-7015', date: '2026-09-28', time: '09:00:05', user: '刘敏', position: '经营分析岗', task: '季度财务简报', trigger: '定时·每月 28 日 09:00', tool: 'MCP·知识库 MCP', action: '检索财务简报模板', nature: 'READ', auth: 'NONE', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '09:00:35' },
  { id: 'T-2010', runId: 'RUN-20260928-7015', date: '2026-09-28', time: '09:00:04', user: '刘敏', position: '经营分析岗', task: '季度财务简报', trigger: '定时·每月 28 日 09:00', tool: 'API·客户数据 API', action: '汇总本季度财务数据', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '2.1 秒', endAt: '09:00:06' },
  { id: 'T-2009', runId: 'RUN-20260928-7004', date: '2026-09-28', time: '09:00:03', user: '陈杰', position: '市场研究岗', task: '每周竞品动态汇总', trigger: '定时·每周一 09:00', tool: 'MCP·知识库 MCP', action: '检索竞品动态', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '1.4 秒', endAt: '09:00:04' },
  { id: 'T-2008', runId: 'RUN-20260928-7001', date: '2026-09-28', time: '08:30:07', user: '刘敏', position: '经营分析岗', task: '每日经营晨报', trigger: '定时·每天 08:30', tool: 'MCP·知识库 MCP', action: '检索指标口径', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '0.9 秒', endAt: '08:30:08' },
  { id: 'T-2007', runId: 'RUN-20260928-7001', date: '2026-09-28', time: '08:30:04', user: '刘敏', position: '经营分析岗', task: '每日经营晨报', trigger: '定时·每天 08:30', tool: 'API·客户数据 API', action: '查询昨日营收数据', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '1.2 秒', endAt: '08:30:05' },
  { id: 'T-2006', runId: 'RUN-20260928-7003', date: '2026-09-28', time: '08:00:03', user: '周敏', position: '客户成功岗', task: '拜访前资料准备', trigger: '定时·每天 08:00', tool: 'API·客户数据 API', action: '写入拜访提纲', nature: 'WRITE', auth: 'AUTHORIZED', authBy: '周敏', authAt: '2026-09-10 14:20', result: 'SUCCESS', reason: '', duration: '1.6 秒', endAt: '08:00:05' },
  { id: 'T-2005', runId: 'RUN-20260925-7012', date: '2026-09-25', time: '17:00:03', user: '张浩', position: '经营分析岗', task: '供应商付款提醒', trigger: '定时·每周五 17:00', tool: '业务系统·用友财务', action: '提交付款申请', nature: 'WRITE', auth: 'UNAUTHORIZED', result: 'BLOCKED', reason: '无人值守任务未授权写操作', duration: '未执行' },
  { id: 'T-2004', runId: 'RUN-20260925-7011', date: '2026-09-25', time: '10:00:05', user: '刘敏', position: '经营分析岗', task: '月度目标达成预警', trigger: '定时·每月 25 日 10:00', tool: 'API·客户数据 API', action: '查询目标达成率', nature: 'READ', auth: 'NONE', result: 'FAILED', reason: '连接超时', duration: '30 秒', endAt: '10:00:35' },
  { id: 'T-2003', runId: 'RUN-20260924-7003', date: '2026-09-24', time: '08:00:04', user: '周敏', position: '客户成功岗', task: '拜访前资料准备', trigger: '定时·每天 08:00', tool: 'API·客户数据 API', action: '写入拜访提纲', nature: 'WRITE', auth: 'AUTHORIZED', authBy: '周敏', authAt: '2026-09-10 14:20', result: 'FAILED', reason: '客户档案已锁定，写入被拒绝', duration: '0.7 秒', endAt: '08:00:05' },
  { id: 'T-2002', runId: 'RUN-20260924-7001', date: '2026-09-24', time: '08:30:04', user: '刘敏', position: '经营分析岗', task: '每日经营晨报', trigger: '定时·每天 08:30', tool: 'API·客户数据 API', action: '查询昨日营收数据', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '1.1 秒', endAt: '08:30:05' },
  { id: 'T-2001', runId: 'RUN-20260921-7004', date: '2026-09-21', time: '09:00:03', user: '陈杰', position: '市场研究岗', task: '每周竞品动态汇总', trigger: '定时·每周一 09:00', tool: 'MCP·知识库 MCP', action: '检索竞品动态', nature: 'READ', auth: 'NONE', result: 'SUCCESS', reason: '', duration: '1.6 秒', endAt: '09:00:04' }
]

export async function listTaskCallAudits() {
  return taskCallRecords
}

/* ══════════════ 知识库检索 ══════════════
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
