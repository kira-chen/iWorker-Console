/**
 * 全站日期/时间工具（2026-09-09 代码冗余治理·第二批 批 2-1 收编，单一真相）。
 *
 * 此前「YYYY-MM-DD HH:mm 展示格式化」在 utils/docMeta.fmtTime（事实正本）、utils/taskStatus.fmtDateTime、
 * MemoryManage.vue 与 6 个 mock 各写一份；「本地 +08:00 ISO 串」在 6 个 mock 逐字重复。
 * 现收编于此；docMeta.fmtTime / taskStatus.fmtDateTime 保留原导出名一行 re-export，消费方零改动。
 */

/**
 * 日期时间 → `YYYY-MM-DD HH:mm`（本地墙钟，精确到分钟）。
 * 语义钉死（与旧 docMeta.fmtTime 逐字一致，边界见 __tests__/datetime.test.js）：
 * 空值（null/undefined/''）→ `''`；无法解析的非法值 → 原样返回入参；合法值 → 格式化串。
 * @param {string|number|Date|null|undefined} dateLike
 */
export function fmtMinute(dateLike) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (Number.isNaN(d.getTime())) return dateLike
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 当前时刻 → `YYYY-MM-DD HH:mm`（mock 层「处理/提交时间戳」惯用形态，与种子串同形）。 */
export function nowMinuteText() {
  return fmtMinute(new Date())
}

/**
 * 当前时刻 → 秒级本地 ISO 串，后缀为运行环境的真实时区偏移（东八区即 `+08:00`）（mock 层统一口径：
 * 存储带时区 ISO，展示走 fmtMinute 精确到分钟）。注意与 `new Date().toISOString()`（UTC `Z` 结尾）是两种口径，
 * 后者的使用点不属本函数收编范围。
 *
 * 此前后缀硬写 `+08:00` 而日期时间取的是本地墙钟：非东八区环境（如 UTC）下墙钟 10:00 被标成 +08:00，
 * 解析回来是 02:00 UTC，展示错 8 小时（2026-09-18 待办 yuepu#13·组织 O1）。
 */
export function nowIsoLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset() // 东区为正；东八区 = 480
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}
