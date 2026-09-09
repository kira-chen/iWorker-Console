/**
 * 员工端「可选岗位 + 首登绑定」mock（2026-09-09 发布前收口补齐）。
 *
 * 为什么需要它：本模块原先是全仓唯一还在走真实 HTTP 的取数点（request.get('/positions')），
 * 而本项目是纯前端 demo、无后端且 vite 未配 proxy —— /api/positions 会落到 SPA fallback
 * 返回 index.html，store 拿到 HTML 字符串后 .filter/.find 直接抛错，导致 /onboarding、
 * /bind-expert、/other-experts 三个页面的岗位列表区整块空白（冒烟测试实测 pageerror）。
 *
 * 数据同源：直接取 positionMock 的「已发布」岗位，避免再造一套会和后台对不上的种子。
 * 字段映射到员工端视图消费的形状：{ id, name, avatar, jobTag, intro, expertise }。
 * 其中 avatar 复用后台的岗位图标（emoji/字符，el-avatar 无 src 时回落到首字），
 * jobTag 取岗位分类语义位——后台种子无该字段，留空即不渲染标签。
 */
// 注意：positionMock 与 unifiedSkillMock 之间存在既有的循环依赖（岗位详情要同源取技能本体），
// 其模块初始化末尾会执行 seedReviewSnapshots()。这里若用静态 import 拉 positionMock，会把它
// 提前到 unifiedSkillMock 之前初始化，导致 seed 阶段访问尚未初始化的 skills 而抛
// 「Cannot access 'skills' before initialization」。故改为调用时动态 import。
const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms))

/** 后台岗位行 → 员工端岗位卡片 VO。 */
function toUserVO(p) {
  return {
    id: p.positionId,
    name: p.name,
    avatar: p.icon || '',
    jobTag: '',
    intro: p.description || '',
    expertise: ''
  }
}

/**
 * 当前用户可见的岗位列表：只出「已发布」的。
 * 返回裸数组（store 直接 positions.value = await listPositions()）。
 */
export async function listPositions() {
  await delay()
  const { listPositions: listAdminPositions } = await import('./positionMock')
  // size 给足，员工端不分页；status:'published' 走 mock 的三态展示口径
  const { list } = await listAdminPositions({ status: 'published', size: 999 })
  return list.map(toUserVO)
}

/**
 * 首登绑定：demo 不落服务端状态，绑定后的本地态由 store 自行收口
 * （currentPosition + 登录态 markBoundPosition），此处只做成功应答。
 */
export async function bindPosition(positionId) {
  await delay()
  return { positionId }
}
