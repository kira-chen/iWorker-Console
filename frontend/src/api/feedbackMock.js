/**
 * 用户反馈内存 mock（2026-09-01 PRD 对齐改造，仅 DEV 生效，见 feedback.js 头注释）。
 *
 * 种子数据照交互原型 v2 五模块脚本的 `var feedbacks=[…]` 4 条逐字抄录。
 * 列表口径同原型 renderFeedback（+ 时间排序补丁）：
 * - keyword 过滤域 [username, content]；terminal 筛选（MAC/WINDOWS）；
 * - createdAt 排序（默认 desc，原型 time-sort 补丁口径）。
 *
 * 附图形态（2026-09-01 疑点1 处置）：保留现有真实图片缩略图 + ElImageViewer，
 * 原型的「▧ 1」编号按钮为占位示意不照搬。mock 下附图用内置生成的 SVG 占位图 blob
 * （原型 images 数组的「截图 N」文案画进图内），与真实后端的 blob 拉取链路同形。
 * images[] 形状对齐后端契约：[{ seq, thumb_url, url }]。
 */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))

// mock 附图地址协议：mock-fb://<feedbackId>/<seq>（fetchFeedbackImageBlob 据此生成占位图）
const imgUrl = (id, seq) => `mock-fb://${id}/${seq}`

/* ---------------- 种子（原型 var feedbacks 逐字抄录；images 标签保留画入占位图） ---------------- */
function seedRows() {
  const raw = [
    { id: 1, username: 'zhangwei', createdAt: '2026-08-28 10:12', content: '希望对话中的引用来源可以一键复制，同时保留原始链接和更新时间。', terminal: 'WINDOWS', images: ['截图 1', '截图 2'] },
    { id: 2, username: 'li.na', createdAt: '2026-08-27 18:36', content: '任务执行完成后建议增加桌面通知，并支持只提醒失败任务。', terminal: 'MAC', images: [] },
    { id: 3, username: 'chenyu', createdAt: '2026-08-27 14:20', content: '技能市场的分类较多，希望记住我上次选择的筛选条件。', terminal: 'WINDOWS', images: ['截图 1'] },
    { id: 4, username: 'wangfang', createdAt: '2026-08-26 16:05', content: '长对话滚动时偶尔会跳到顶部，附件中是复现步骤和页面截图。', terminal: 'MAC', images: ['截图 1', '截图 2', '截图 3'] }
  ]
  return raw.map((r) => ({
    ...r,
    images: r.images.map((label, i) => ({
      seq: i + 1,
      label,
      thumb_url: imgUrl(r.id, i + 1),
      url: imgUrl(r.id, i + 1)
    }))
  }))
}

let feedbacks = seedRows()

/** 测试专用：重置内存态。 */
export function resetFeedbackMock() {
  feedbacks = seedRows()
}

/**
 * 列表。params: { keyword?, terminal?('MAC'|'WINDOWS'), sortDir?('asc'|'desc'), page?, size? }
 * → { list, total }
 */
export async function listFeedbacks(params = {}) {
  await delay()
  const q = String(params.keyword || '').toLowerCase()
  let list = feedbacks.filter(
    (r) =>
      (!params.terminal || r.terminal === params.terminal) &&
      (!q || [r.username, r.content].some((v) => String(v).toLowerCase().includes(q)))
  )
  const dir = params.sortDir === 'asc' ? 1 : -1
  list = list.slice().sort((a, b) => dir * String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const total = list.length
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: clone(list.slice((page - 1) * size, page * size)), total }
}

/** 生成占位截图 SVG（浅灰底 + 居中「反馈截图 N」文案），供缩略图与大图查看器共用。 */
function placeholderSvg(id, seq) {
  const label = `反馈截图 ${seq}`
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">' +
    '<rect width="640" height="400" fill="#f1f0ee"/>' +
    '<rect x="8" y="8" width="624" height="384" fill="none" stroke="#d9d6d0" stroke-width="2" rx="10"/>' +
    `<text x="320" y="190" text-anchor="middle" font-size="30" fill="#7d7a75" font-family="-apple-system, 'PingFang SC', sans-serif">${label}</text>` +
    `<text x="320" y="234" text-anchor="middle" font-size="17" fill="#a8a49d" font-family="-apple-system, 'PingFang SC', sans-serif">用户反馈 #${id} · 示意附图</text>` +
    '</svg>'
  )
}

/**
 * 附图取 blob（与 feedback.js 真实链路同签名）：按 mock-fb:// 地址生成 SVG 占位图。
 * 地址不合法时抛错，供页面走「加载失败」降级链路。
 */
export async function fetchFeedbackImageBlob(url) {
  await delay(120)
  const m = /^mock-fb:\/\/(\d+)\/(\d+)$/.exec(String(url || ''))
  if (!m) {
    throw new Error('图片加载失败')
  }
  return new Blob([placeholderSvg(Number(m[1]), Number(m[2]))], { type: 'image/svg+xml' })
}
