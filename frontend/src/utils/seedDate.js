/**
 * 演示种子的「相对今天」日期（2026-10-10 测试审计 J27，负责人按团队建议选 A）。
 *
 * 为什么：访问审计 / 工具调用审计页默认只看近 90 天，种子若写死绝对日期，过了几个月整页就空了。
 * 做法：种子里不写 '2026-08-28'，写 daysAgo(43, '10:32')——「43 天前的 10:32」，演示时永远落在窗口内，
 * 种子之间的先后顺序与间隔天数不变。
 *
 * 取「本地墙钟」的日历日（与页面 90 天窗口、nowMinuteText 同口径）；跨夏令时也按日历日回退，不按 24h 毫秒数算。
 */
const pad = (n) => String(n).padStart(2, '0')

/** n 天前的日期 → `YYYY-MM-DD`。 */
export function dateDaysAgo(n, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** n 天前的某个时刻 → `YYYY-MM-DD HH:mm`（clock 传 'HH:mm'）或 `YYYY-MM-DD HH:mm:ss`（clock 传 'HH:mm:ss'）。 */
export function daysAgo(n, clock, now = new Date()) {
  return `${dateDaysAgo(n, now)} ${clock}`
}
