// 访问审计 —— 产物下载 & 管理端操作两个子页 mock 数据。
// 数据来源：原交互原型的 dlRecords / opsRecords（原型 html 已于 2026-09-17 退役删除，git 历史可查）。
//
// 2026-09-20：「管理端操作」不再全是静态种子——版本管理页的发布 / 停用成功后会调 appendOpsRecord 真的写一条
// （见 versionMock.js），刷新后仍在（mockPersist 只持久化这些新增记录，种子仍以代码为准）。
// 2026-09-30：强制回收 / 用户技能审核 / 岗位分配三类也接入（PRD §6.2 三条记录说明），并按 §6.5 给记录补
// 页面不展示、数据层必须保存的字段（objectId / at / meta），供客户端通知增量拉取（见文末 listClientFacingOps）。
// 其余模块的操作暂未接入，仍是静态种子。
import { attachPersist } from './mockPersist'
import { nowSecondText } from '@/utils/datetime'

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
  { id: 5, time: '2026-08-27 16:08', operator: 'admin', module: '用户技能审核', action: '审核驳回', target: 'sun.hao / 财税合规助手', detail: '岗位与技能权限范围不匹配', at: '2026-08-27 16:08:00', objectId: 'usr_hist_2', meta: { reviewId: 'usr_hist_2', submitter: 'sun.hao', skillName: '财税合规助手' } },
  { id: 6, time: '2026-08-27 14:40', operator: 'li.qiang', module: 'API', action: '停用', target: '报表批量导出接口', detail: '' },
  { id: 7, time: '2026-08-27 11:20', operator: 'zhang.wei', module: '技能', action: '撤回', target: '经营分析技能', version: 'v1.3', detail: '' },
  { id: 8, time: '2026-08-27 09:55', operator: 'wang.fang', module: '模型', action: '发布', target: '财税合规专属模型', detail: '' },
  { id: 9, time: '2026-08-26 17:33', operator: 'admin', module: '专家', action: '停用', target: '税务筹划专家', version: 'v2.1', detail: '' },
  { id: 10, time: '2026-08-26 15:10', operator: 'zhang.wei', module: '业务系统', action: '发布', target: 'Salesforce CRM 集成', detail: '' },
  { id: 11, time: '2026-08-26 11:45', operator: 'li.qiang', module: '岗位', action: '撤回', target: '采购分析岗', version: 'v1.1', detail: '' },
  { id: 12, time: '2026-08-25 16:20', operator: 'admin', module: '用户技能审核', action: '审核通过', target: 'wang.fang / 合同管理助手', detail: '', at: '2026-08-25 16:20:00', objectId: 'usr_hist_1', meta: { reviewId: 'usr_hist_1', submitter: 'wang.fang', skillName: '合同管理助手' } },
  // 版本管理（客户端版本）：与 versionMock.js 种子里各版本的发布记录一一对应（时间 / 发布人 / 更新说明同源，
  // 由 versionMock.test.js 的「审计种子与版本种子一致」用例守着）。操作对象 =「终端 + 版本号」，不附灰色版本号小标签；
  // 变更内容 = 该版本的更新说明（发布 / 停用 / 撤回三种动作一律如此）。新版本生效时旧版本被自动顶替回到未发布，不单独记一条「停用」。
  { id: 13, time: '2026-06-20 10:00', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Windows v1.0.0', detail: '首个正式版本：\n1. 支持岗位对话与技能调用\n2. 支持知识库检索\n3. 支持定时任务' },
  { id: 14, time: '2026-06-20 10:10', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Mac v1.0.0', detail: '首个正式版本（Mac）：支持岗位对话、技能调用与知识库检索。' },
  { id: 15, time: '2026-07-18 10:00', operator: 'zhang.wei', module: '版本管理', action: '发布', target: 'Windows v1.1.0', detail: '新增技能市场；优化长对话滚动体验。' },
  { id: 16, time: '2026-08-20 10:30', operator: 'li.na', module: '版本管理', action: '发布', target: 'Windows v1.2.0', detail: '1. 对话引用来源支持一键复制\n2. 任务完成后增加桌面通知\n3. 修复长对话滚动偶尔跳到顶部的问题' },
  { id: 17, time: '2026-08-20 10:32', operator: 'li.na', module: '版本管理', action: '发布', target: 'Mac v1.1.0', detail: '与 Windows 端同步：引用来源一键复制、任务完成桌面通知。' },
  // 岗位分配（§6.2 岗位分配记录）：target = 用户名，detail =「原岗位 → 新岗位」（分配时原岗位为「未绑定」），
  // objectId = 用户 id，meta 带用户与前后岗位的名称 + 标识（§6.5.3）。id/岗位取自 adminUserMock / positionMock 种子。
  { id: 18, time: '2026-08-28 11:10', operator: 'admin', module: '岗位分配', action: '分配', target: 'chenyu', detail: '未绑定 → 经营分析岗', at: '2026-08-28 11:10:24', objectId: 203, meta: { userId: 203, username: 'chenyu', fromPosition: null, toPosition: { id: 401, name: '经营分析岗' } } },
  { id: 19, time: '2026-08-28 10:50', operator: 'zhang.wei', module: '岗位分配', action: '变更', target: 'li.na', detail: '客户成功岗 → 财务审核岗', at: '2026-08-28 10:50:37', objectId: 202, meta: { userId: 202, username: 'li.na', fromPosition: { id: 402, name: '客户成功岗' }, toPosition: { id: 403, name: '财务审核岗' } } },
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
 * 写一条「管理端操作」记录（版本管理发布 / 停用、强制回收、用户技能审核、岗位分配、运行规格个人配置都在写）。
 * 记录时间取当前时刻：time 精确到分钟（页面展示），at 精确到秒（数据层，§6.5 通用规则，客户端增量拉取用）；
 * operator 传登录用户名（如 xiaomei）。
 * 就地写进 opsRecords 数组，访问审计页下次进入即可见（页面没有 keep-alive）。
 * 可选字段（未传则不带键，向后兼容）：
 *   version  岗位 / 专家 / 技能的版本号小标签（强制回收落审计时传回收当时的版本）；
 *   objectId 被操作对象的唯一标识（技能 / 专家 / 连接器 / 岗位 / 用户等，页面不展示，客户端据此匹配本地数据）；
 *   hidden   true = 不在「管理端操作」页展示，只留在数据层供客户端通知读取（扩容申请的同意 / 拒绝：
 *            存储空间页的扩容申请页签自己已有处理记录，审计页不重复展示）；
 *   meta     扩展字段：用户技能审核 { reviewId, submitter, skillName }；
 *            岗位分配 { userId?, username, fromPosition:{id,name}|null, toPosition:{id,name} }。
 * @param {{operator:string, module:string, action:string, target:string, detail?:string, version?:string, objectId?:string|number, meta?:object, hidden?:boolean}} rec
 */
export function appendOpsRecord({ operator, module, action, target, detail = '', version, objectId, meta, hidden = false }) {
  const at = nowSecondText()
  const record = { id: opsSeq++, time: at.slice(0, 16), operator, module, action, target, detail, at, live: true }
  if (version) record.version = version
  if (hidden) record.hidden = true
  if (objectId != null && objectId !== '') record.objectId = objectId
  if (meta) record.meta = JSON.parse(JSON.stringify(meta)) // 深拷贝，避免调用方后续改动污染库内数据
  opsRecords.unshift(record)
  persist()
  return { ...record }
}

/* ---------------- 落给客户端的数据（PRD §6.5，只读查询） ---------------- */
// 客户端登录时和之后每 5 分钟拉取，按「上次拉取时间之后」增量处理；不受页面 90 天窗口限制（这里不按日期截断），
// 不含操作人。页面暂不消费，用于演示与测试「管理端落给客户端的数据」长什么样。
const FORCE_REVOKE_MODULES = ['技能', '专家', 'MCP', 'API', '业务系统']
const atOf = (r) => r.at || `${r.time}:00` // 老种子 / 旧快照没有 at 时，按分钟补 :00

/**
 * 取「客户端要读」的记录视图，按操作时间正序（同秒按记录 id）。
 * @param {{since?: string}} [opts] since = 上次拉取时间（YYYY-MM-DD HH:mm:ss），只返回 at 严格晚于它的记录；缺省 = 全量
 * @returns {Array<object>} 每条带 kind 区分四类，公共字段 recordId（记录标识，去重用）/ at（操作时间，秒级）：
 *   forceRevoke   {kind, recordId, at, objectType(=模块), objectId, objectName, reason}                         §6.5.1
 *   skillReview   {kind, recordId, at, result('审核通过'|'审核驳回'), reviewId, submitter, skillName, rejectReason} §6.5.2
 *   positionAssign{kind, recordId, at, type('分配'|'变更'), username, userId, fromPosition|null, toPosition}    §6.5.3
 *   storageQuota  {kind, recordId, at, type('同意扩容'|'拒绝扩容'|'调整容量'), username, userId, requestId|null, newTotalGb|null, rejectReason} §6.5.4
 */
export function listClientFacingOps({ since } = {}) {
  const out = []
  for (const r of opsRecords) {
    const at = atOf(r)
    if (since && !(at > since)) continue
    if (r.action === '强制回收' && FORCE_REVOKE_MODULES.includes(r.module)) {
      out.push({ kind: 'forceRevoke', recordId: r.id, at, objectType: r.module, objectId: r.objectId ?? null, objectName: r.target, reason: r.detail || '' })
    } else if (r.module === '用户技能审核' && (r.action === '审核通过' || r.action === '审核驳回')) {
      const m = r.meta || {}
      const [subFromTarget, skillFromTarget] = String(r.target).split(' / ')
      out.push({
        kind: 'skillReview', recordId: r.id, at, result: r.action,
        reviewId: m.reviewId ?? r.objectId ?? null,
        submitter: m.submitter ?? subFromTarget,
        skillName: m.skillName ?? skillFromTarget,
        rejectReason: r.action === '审核驳回' ? r.detail || '' : ''
      })
    } else if (r.module === '岗位分配' && (r.action === '分配' || r.action === '变更')) {
      const m = r.meta || {}
      out.push({
        kind: 'positionAssign', recordId: r.id, at, type: r.action,
        username: m.username ?? r.target,
        userId: m.userId ?? r.objectId ?? null,
        fromPosition: m.fromPosition ? { ...m.fromPosition } : null,
        toPosition: m.toPosition ? { ...m.toPosition } : null
      })
    } else if (r.module === '存储空间' && ['同意扩容', '拒绝扩容', '调整容量'].includes(r.action)) {
      const m = r.meta || {}
      out.push({
        kind: 'storageQuota', recordId: r.id, at, type: r.action,
        username: m.username ?? r.target,
        userId: m.userId ?? r.objectId ?? null,
        requestId: m.requestId ?? null,
        newTotalGb: m.newTotalGb ?? null,
        rejectReason: r.action === '拒绝扩容' ? r.detail || '' : ''
      })
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.recordId - b.recordId))
}

/** 测试专用：清掉运行期新增的记录，回到纯种子。 */
export function resetAccessAuditMock() {
  for (let i = opsRecords.length - 1; i >= 0; i--) {
    if (opsRecords[i].live) opsRecords.splice(i, 1)
  }
  opsSeq = LIVE_ID_START
  persist()
}
