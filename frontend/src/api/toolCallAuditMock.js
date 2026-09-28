// 工具调用审计 —— 数字员工执行技能时调用连接器工具（MCP / API / 业务系统）的事后审计记录，只读 mock 数据。
//
// 字段与示例数据参考已退场的旧交互原型（数字员工管理端交互原型.html · 05治理/工具调用审计，
// 原型本身已于 2026-09-09/10 退场不作依据，此处仅复用其示例数据完成本次改造）；
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
  ]
}

/** 详情抽屉「实际请求参数」页签数据：[参数名, 技术标识, 本次请求值][]。 */
export function paramsOf(record) {
  return PARAM_OVERRIDES[record.id] || [['请求数据', 'payload', '【待补充】本次调用的实际请求参数']]
}

/** 详情抽屉「实际响应结果」页签数据。 */
export function outputOf(record) {
  if (record.id === 'C-1011') {
    return { summary: '报价单创建成功', rows: [['报价单编号', 'QT-20260927-0083'], ['返回状态', '已创建']] }
  }
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
