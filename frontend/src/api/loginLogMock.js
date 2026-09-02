/**
 * 访问审计开发期内存 mock（仅 DEV 生效，见 loginLog.js 头注释）。
 *
 * 数据照交互原型 v2 最终版 renderAuditMultiDevice 的 P.audits 11 条种子：
 * 同一账号多终端/多 IP 多条记录、在线记录无登出时间；终端仅 Windows / Mac 两类
 * （prd.访问审计.md §五：未识别终端由数据接入层映射后再展示）；
 * location 字段保留在数据里但页面不展示（md §四）。
 */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const AUDITS = [
  { id: 1, username: 'zhangwei', terminal: 'Windows', location: '上海 · 总部办公网', loginAt: '2026-08-28 09:16', logoutAt: '', status: 'ONLINE', ip: '10.20.14.36' },
  { id: 2, username: 'zhangwei', terminal: 'Windows', location: '杭州 · 移动网络', loginAt: '2026-08-28 08:12', logoutAt: '2026-08-28 08:46', status: 'OFFLINE', ip: '223.104.40.18' },
  { id: 3, username: 'zhangwei', terminal: 'Mac', location: '上海 · 家庭网络', loginAt: '2026-08-27 20:05', logoutAt: '2026-08-27 22:18', status: 'OFFLINE', ip: '116.228.72.91' },
  { id: 4, username: 'li.na', terminal: 'Windows', location: '北京 · 分公司办公网', loginAt: '2026-08-28 08:48', logoutAt: '2026-08-28 12:06', status: 'OFFLINE', ip: '10.20.18.11' },
  { id: 5, username: 'li.na', terminal: 'Windows', location: '北京 · 移动网络', loginAt: '2026-08-27 21:06', logoutAt: '2026-08-27 21:42', status: 'OFFLINE', ip: '120.245.63.27' },
  { id: 6, username: 'chenyu', terminal: 'Mac', location: '深圳 · 家庭网络', loginAt: '2026-08-27 17:32', logoutAt: '2026-08-27 19:45', status: 'OFFLINE', ip: '113.87.128.66' },
  { id: 7, username: 'chenyu', terminal: 'Mac', location: '深圳 · 移动网络', loginAt: '2026-08-28 10:21', logoutAt: '', status: 'ONLINE', ip: '183.240.21.19' },
  { id: 8, username: 'wangfang', terminal: 'Windows', location: '成都 · 办公网', loginAt: '2026-08-27 15:08', logoutAt: '2026-08-27 18:22', status: 'OFFLINE', ip: '10.20.21.19' },
  { id: 9, username: 'wangfang', terminal: 'Mac', location: '成都 · 家庭网络', loginAt: '2026-08-28 07:30', logoutAt: '', status: 'ONLINE', ip: '171.221.32.105' },
  { id: 10, username: 'sun.xin', terminal: 'Windows', location: '上海 · 总部办公网', loginAt: '2026-08-28 10:03', logoutAt: '', status: 'ONLINE', ip: '10.20.12.88' },
  { id: 11, username: 'sun.xin', terminal: 'Windows', location: '苏州 · 移动网络', loginAt: '2026-08-26 19:40', logoutAt: '2026-08-26 20:15', status: 'OFFLINE', ip: '117.136.46.73' }
]

/**
 * 登录明细列表。params：keyword（用户名模糊）/ status（ONLINE|OFFLINE）/
 * sortField（loginAt|logoutAt，默认 loginAt）/ sortDir（asc|desc，默认 desc）/ page / size。
 */
export async function listLoginLogs(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const field = params.sortField === 'logoutAt' ? 'logoutAt' : 'loginAt'
  const dir = params.sortDir === 'asc' ? 'asc' : 'desc'
  let list = AUDITS.filter(
    (r) =>
      (!kw || r.username.toLowerCase().includes(kw)) &&
      (!params.status || r.status === params.status)
  )
  list = [...list].sort((a, b) => {
    const av = a[field] || ''
    const bv = b[field] || ''
    return dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)
  })
  const page = Math.max(1, Number(params.page) || 1)
  const size = Math.max(1, Number(params.size) || 20)
  return {
    list: list.slice((page - 1) * size, page * size).map((r) => ({ ...r })),
    total: list.length
  }
}
