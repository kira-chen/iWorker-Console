// 访问审计 —— 产物下载 & 管理端操作两个子页 mock 数据。
// 数据来源：原交互原型的 dlRecords / opsRecords（原型 html 已于 2026-09-17 退役删除，git 历史可查）。
//
// 2026-09-20：「管理端操作」不再全是静态种子——版本管理页的发布 / 停用成功后会调 appendOpsRecord 真的写一条
// （见 versionMock.js），刷新后仍在（mockPersist 只持久化这些新增记录，种子仍以代码为准）。
// 其余模块的操作暂未接入，仍是静态种子。
import { attachPersist } from './mockPersist'
import { nowMinuteText } from '@/utils/datetime'

export const dlRecords = [
  { id: 1, time: '2026-08-28 10:32', user: '刘敏', filename: '销售顾问v1.4.2岗位说明.docx', channel: 'Windows', source: '会话产物', result: 'SUCCESS' },
  { id: 2, time: '2026-08-28 10:18', user: '张浩', filename: '竞品资料库精编版.pdf', channel: 'Mac', source: '知识库·本地产物', result: 'SUCCESS' },
  { id: 3, time: '2026-08-28 09:55', user: '王芳', filename: '合同付款条款手册.pdf', channel: 'Mac', source: '知识库·本地产物', result: 'SUCCESS' },
  { id: 4, time: '2026-08-27 22:06', user: '吴强', filename: '财税合规政策手册.pdf', channel: 'Mac', source: '知识库·我的资料', result: 'FAILED', failReason: '磁盘空间不足（CS端）' },
  { id: 5, time: '2026-08-27 18:40', user: '李强', filename: '人事档案汇总2026Q3.xlsx', channel: 'Windows', source: '会话产物', result: 'FAILED', failReason: '无写入权限（CS端）' },
  { id: 6, time: '2026-08-27 16:15', user: '陈宇', filename: '项目交付规范手册v2.pdf', channel: 'Windows', source: '知识库·本地产物', result: 'SUCCESS' },
  { id: 7, time: '2026-08-27 14:50', user: '孙新', filename: '2026年客户名单.xlsx', channel: 'Mac', source: '知识库·我的资料', result: 'SUCCESS' },
  { id: 8, time: '2026-08-27 11:23', user: '李娜', filename: '合同模板—服务合同.docx', channel: 'Windows', source: '会话产物', result: 'SUCCESS' },
]

export const opsRecords = [
  { id: 1, time: '2026-08-28 10:05', operator: 'zhang.wei', module: '岗位', action: '发布', target: '销售顾问', version: 'v1.4.2', detail: 'v1.4.2 正式发布上线' },
  { id: 2, time: '2026-08-28 09:48', operator: 'wang.fang', module: '知识库', action: '停用', target: '竞品资料库', detail: '' },
  { id: 3, time: '2026-08-27 18:22', operator: 'admin', module: 'MCP', action: '发布', target: 'ERP 连接器', detail: '' },
  { id: 4, time: '2026-08-27 17:15', operator: 'admin', module: '审核中心', action: '审核通过', target: '生产计划专属规格申请', detail: '' },
  { id: 5, time: '2026-08-27 16:08', operator: 'admin', module: '用户技能审核', action: '审核驳回', target: 'sun.hao / 财税合规助手', detail: '岗位与技能权限范围不匹配' },
  { id: 6, time: '2026-08-27 14:40', operator: 'li.qiang', module: 'API', action: '停用', target: '报表批量导出接口', detail: '' },
  { id: 7, time: '2026-08-27 11:20', operator: 'zhang.wei', module: '技能', action: '撤回', target: '经营分析技能', version: 'v1.3', detail: '' },
  { id: 8, time: '2026-08-27 09:55', operator: 'wang.fang', module: '模型', action: '发布', target: '财税合规专属模型', detail: '' },
  { id: 9, time: '2026-08-26 17:33', operator: 'admin', module: '专家', action: '停用', target: '税务筹划专家', version: 'v2.1', detail: '' },
  { id: 10, time: '2026-08-26 15:10', operator: 'zhang.wei', module: '业务系统', action: '发布', target: 'Salesforce CRM 集成', detail: 'v1.0 首次接入，发布上线' },
  { id: 11, time: '2026-08-26 11:45', operator: 'li.qiang', module: '岗位', action: '撤回', target: '采购分析岗', version: 'v1.1', detail: '' },
  { id: 12, time: '2026-08-25 16:20', operator: 'admin', module: '用户技能审核', action: '审核通过', target: 'wang.fang / 合同管理助手', detail: '' },
  // 版本管理（客户端版本）：与 versionMock.js 种子里各版本的发布记录一一对应（时间 / 发布人 / 更新说明同源，
  // 由 versionMock.test.js 的「审计种子与版本种子一致」用例守着）。操作对象 =「终端 + 版本号」，不附灰色版本号小标签；
  // 变更内容 = 该版本的更新说明（发布 / 停用 / 撤回三种动作一律如此）。新版本生效时旧版本被自动顶替回到未发布，不单独记一条「停用」。
  { id: 13, time: '2026-06-20 10:00', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Windows v1.0.0', detail: '首个正式版本：\n1. 支持岗位对话与技能调用\n2. 支持知识库检索\n3. 支持定时任务' },
  { id: 14, time: '2026-06-20 10:10', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Mac v1.0.0', detail: '首个正式版本（Mac）：支持岗位对话、技能调用与知识库检索。' },
  { id: 15, time: '2026-07-18 10:00', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Windows v1.1.0', detail: '新增技能市场；优化长对话滚动体验。' },
  { id: 16, time: '2026-08-20 10:30', operator: 'li.na', module: '版本管理', action: '发布', target: 'Windows v1.2.0', detail: '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知\n3. 修复长对话滚动偶尔跳到顶部的问题' },
  { id: 17, time: '2026-08-20 10:32', operator: 'li.na', module: '版本管理', action: '发布', target: 'Mac v1.1.0', detail: '与 Windows 端同步：引用来源一键复制、任务完成桌面通知。' },
]

/* ---------------- 运行期新增的操作记录（版本管理写入） ---------------- */
const LIVE_ID_START = 100 // 新增记录 id 从 100 起，避开种子 id
let opsSeq = LIVE_ID_START

// 只持久化「运行期新增」的记录（带 live 标记），种子仍以代码为准——改种子不会被旧本地存档盖住。
const persist = attachPersist('accessAuditOps', {
  version: 1,
  snapshot: () => ({ opsSeq, live: opsRecords.filter((r) => r.live) }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.opsSeq) || !Array.isArray(d.live)) {
      throw new Error('accessAuditOps 快照形状不合法')
    }
    opsSeq = d.opsSeq
    opsRecords.unshift(...d.live)
  }
})

/**
 * 写一条「管理端操作」记录（demo 里只有版本管理的发布 / 停用接入了）。
 * 记录时间取当前时刻（精确到分钟）；operator 传登录用户名（如 xiaomei）。
 * 就地写进 opsRecords 数组，访问审计页下次进入即可见（页面没有 keep-alive）。
 * @param {{operator:string, module:string, action:string, target:string, detail?:string}} rec
 */
export function appendOpsRecord({ operator, module, action, target, detail = '' }) {
  const record = { id: opsSeq++, time: nowMinuteText(), operator, module, action, target, detail, live: true }
  opsRecords.unshift(record)
  persist()
  return { ...record }
}

/** 测试专用：清掉运行期新增的记录，回到纯种子。 */
export function resetAccessAuditMock() {
  for (let i = opsRecords.length - 1; i >= 0; i--) {
    if (opsRecords[i].live) opsRecords.splice(i, 1)
  }
  opsSeq = LIVE_ID_START
  persist()
}
