// 访问审计 —— 产物下载 & 管理端操作两个子页静态 mock 数据。
// 数据来源：数字员工管理端交互原型.html dlRecords / opsRecords。

export const dlRecords = [
  { id: 1, time: '2026-08-28 10:32', user: '刘敏', filename: '销售顾问v1.4.2岗位说明.docx', channel: 'Windows', validMins: 30, result: 'SUCCESS' },
  { id: 2, time: '2026-08-28 10:18', user: '张浩', filename: '竞品资料库精编版.pdf', channel: 'Web', validMins: 30, result: 'SUCCESS' },
  { id: 3, time: '2026-08-28 09:55', user: '王芳', filename: '合同付款条款手册.pdf', channel: 'Mac', validMins: 30, result: 'SUCCESS' },
  { id: 4, time: '2026-08-27 22:06', user: '吴强', filename: '财税合规政策手册.pdf', channel: 'Mac', validMins: 30, result: 'FAILED' },
  { id: 5, time: '2026-08-27 18:40', user: '李强', filename: '人事档案汇总2026Q3.xlsx', channel: 'Web', validMins: 30, result: 'FAILED' },
  { id: 6, time: '2026-08-27 16:15', user: '陈宇', filename: '项目交付规范手册v2.pdf', channel: 'Windows', validMins: 30, result: 'SUCCESS' },
  { id: 7, time: '2026-08-27 14:50', user: '孙新', filename: '2026年客户名单.xlsx', channel: 'Web', validMins: 30, result: 'SUCCESS' },
  { id: 8, time: '2026-08-27 11:23', user: '李娜', filename: '合同模板—服务合同.docx', channel: 'Windows', validMins: 30, result: 'SUCCESS' },
]

export const opsRecords = [
  { id: 1, time: '2026-08-28 10:05', operator: 'zhang.wei', module: '岗位', action: '发布', target: '销售顾问', detail: '版本 v1.4.2 正式发布上线' },
  { id: 2, time: '2026-08-28 09:48', operator: 'wang.fang', module: '知识库', action: '停用', target: '竞品资料库', detail: '可见范围调整中，暂时停用' },
  { id: 3, time: '2026-08-27 18:22', operator: 'admin', module: 'MCP', action: '发布', target: 'ERP 连接器 v2.1', detail: '新版本发布，旧版本同步停用' },
  { id: 4, time: '2026-08-27 17:15', operator: 'admin', module: '审核中心', action: '审核通过', target: '生产计划专属规格申请', detail: '资源配额符合要求，审核通过' },
  { id: 5, time: '2026-08-27 16:08', operator: 'admin', module: '用户技能审核', action: '审核驳回', target: 'sun.hao / 财税合规助手', detail: '岗位与技能权限范围不匹配' },
  { id: 6, time: '2026-08-27 14:40', operator: 'li.qiang', module: 'API', action: '停用', target: '报表批量导出接口', detail: '安全合规审查期间暂停' },
  { id: 7, time: '2026-08-27 11:20', operator: 'zhang.wei', module: '技能', action: '撤回', target: '经营分析技能 v1.3', detail: '发现数据计算逻辑错误，撤回待修复' },
  { id: 8, time: '2026-08-27 09:55', operator: 'wang.fang', module: '模型', action: '发布', target: '财税合规专属模型 v2', detail: '模型配置审核通过，正式发布' },
  { id: 9, time: '2026-08-26 17:33', operator: 'admin', module: '专家', action: '停用', target: '税务筹划专家', detail: '专家内容待更新，临时下线' },
  { id: 10, time: '2026-08-26 15:10', operator: 'zhang.wei', module: '业务系统', action: '发布', target: 'Salesforce CRM 集成', detail: 'v1.0 首次接入，发布上线' },
  { id: 11, time: '2026-08-26 11:45', operator: 'li.qiang', module: '岗位', action: '撤回', target: '采购分析岗 v1.1', detail: '发现权限配置错误，撤回修正' },
  { id: 12, time: '2026-08-25 16:20', operator: 'admin', module: '用户技能审核', action: '审核通过', target: 'wang.fang / 合同管理助手', detail: '工作职责符合，审核通过' },
]
