/**
 * 驾驶舱「使用情况」页签 · 点踩明细样例（PRD 驾驶舱第八、九节；产品优化需求-202611 修改点 20）。
 *
 * 原先写在 UsageFeedbackPanel.vue 里，修改点 20 加「助手生成的文件」时挪到 api 层（mock 不散落进组件）。
 * - 52 条抽样明细，代表点踩数的样例子集，不随页签筛选条变化，非逐条对应生产数据；
 * - 每条只含被点踩的单轮：用户提问 + 被点踩的助手回复（不留前情）；
 * - 修改点 20：被点踩回复里生成的文件随这一轮留存，管理端可预览、下载；用户提问里的附件不留、不展示。
 *   图片、PDF、文本可在线预览；Word、Excel 等只能下载；文件已失效时不能预览、下载。
 * - 回复与提问、生成的文件按同一主题配（原组件里回复按 1031 - i 取，和提问错位，挂上文件后对不上，一并改正）。
 * 纯静态样例，无写操作，不落盘（无 attachPersist）。
 */

const POSITIONS = ['销售顾问', '经营分析师', '项目经理助手', '产品经理助手', '公文写作', '生产计划员']
const USERS = ['张**', '李**', '王**', '陈**', '刘**', '杨**', '赵**', '黄**']
const SNIPPETS = [
  '请帮我分析这份销售数据并给出建议', '需要生成一份项目汇报周报模板', '帮我起草客户拜访前的确认邮件',
  '分析本季度产线排班优化方案', '帮我整理这份会议纪要并提炼要点', '生成合同摘要并标注主要风险条款',
  '我需要最新的产品报价单及折扣规则', '帮我分析竞品的市场定价策略', '请生成本月的经营分析报告摘要',
  '帮我优化这段公文的措辞和格式'
]
const TIMES = [
  '2026-09-15 14:32', '2026-09-15 11:18', '2026-09-14 16:47', '2026-09-14 09:23', '2026-09-13 18:05',
  '2026-09-13 14:33', '2026-09-12 20:11', '2026-09-12 15:44', '2026-09-11 10:22', '2026-09-11 08:57',
  '2026-09-10 17:36', '2026-09-10 11:09', '2026-09-09 19:48', '2026-09-09 14:21', '2026-09-08 16:33',
  '2026-09-08 10:54', '2026-09-07 18:22', '2026-09-07 13:41', '2026-09-06 15:19', '2026-09-06 09:37',
  '2026-09-05 20:44', '2026-09-05 16:08', '2026-09-04 17:55', '2026-09-04 12:30', '2026-09-03 19:14',
  '2026-09-03 08:46', '2026-09-02 21:03', '2026-09-02 14:17', '2026-09-01 16:29', '2026-09-01 10:52',
  '2026-08-31 18:37', '2026-08-31 13:05', '2026-08-30 20:18', '2026-08-30 11:43', '2026-08-29 17:02',
  '2026-08-29 09:28', '2026-08-28 19:51', '2026-08-28 14:16', '2026-08-27 16:44', '2026-08-27 10:09',
  '2026-08-26 18:27', '2026-08-26 13:53', '2026-08-25 20:06', '2026-08-25 11:35', '2026-08-24 17:49',
  '2026-08-24 09:14', '2026-08-23 18:33', '2026-08-23 14:07', '2026-08-22 16:21', '2026-08-22 10:48',
  '2026-08-21 19:03', '2026-08-21 13:29'
]
const REPLIES = [
  '根据您的需求，我进行了初步分析，主要发现如下：① 核心指标同比有所变化，建议重点关注转化率和客单价；② 当前数据缺少部分维度，建议补充采集后再做深度分析。',
  '已为您生成所需模板，包含标准章节结构和填写说明。请注意第三部分的格式要求，并根据实际情况修改后使用。',
  '已起草完成，核心内容包含三个部分：背景说明、主要诉求和后续行动建议。建议在发送前确认联系人信息和时间节点是否准确。',
  '根据现有数据，优化方案涉及以下几点：① 调整班次结构，② 优化设备利用率，③ 引入弹性排班机制。预计可提升效率约 12%~18%，具体效果需结合实际验证。',
  '会议纪要已整理完毕，共提炼出 5 项核心决议和 3 项后续行动项，各项均已标注责任人和截止时间。如需调整格式，请告知。',
  '合同摘要已生成，共标注 4 处主要风险条款，建议重点关注第 7 条（违约责任）和第 12 条（知识产权归属）。',
  '已整理最新产品报价单及折扣规则，共包含 23 个 SKU。部分产品近期调价，已用标注提示，请注意核对。',
  '根据公开信息，竞品定价策略主要体现在差异化定价、动态调价机制和地区价格分层三个维度，具体数据如下……',
  '本月经营分析报告摘要已生成，核心数据涵盖营收、成本、利润率和客户留存四项指标，整体表现略低于预期，主要受季节性因素影响。',
  '公文已优化，主要调整了措辞正式度、段落逻辑衔接及格式问题。修改处已加括号注释，方便您对比审阅。'
]

/* ---------- 助手生成的文件（修改点 20） ---------- */

/** 文件类型 → 展示名、能否在线预览。图片、PDF、文本可预览；Word、Excel 只能下载。 */
export const FILE_KINDS = {
  image: { label: '图片', previewable: true },
  pdf: { label: 'PDF', previewable: true },
  txt: { label: '文本', previewable: true },
  docx: { label: 'Word', previewable: false },
  xlsx: { label: 'Excel', previewable: false }
}

/** 示意图：简单柱状图 SVG（data URI），只用于 demo 的缩略图与大图预览。 */
function chartImage(title, values) {
  const w = 480
  const h = 300
  const max = Math.max(...values)
  const bw = Math.floor((w - 80) / values.length) - 12
  const bars = values
    .map((v, i) => {
      const bh = Math.round((v / max) * (h - 110))
      const x = 50 + i * (bw + 12)
      return `<rect x="${x}" y="${h - 40 - bh}" width="${bw}" height="${bh}" rx="3" fill="#4f7cff" opacity="${0.55 + (0.45 * v) / max}"/>`
    })
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    `<text x="24" y="38" font-size="18" font-family="sans-serif" fill="#1f2329">${title}</text>` +
    `<line x1="40" y1="${h - 40}" x2="${w - 24}" y2="${h - 40}" stroke="#d0d3d9"/>` +
    bars +
    '</svg>'
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/**
 * 按提问主题（SNIPPETS 下标）给出被点踩回复里生成的文件；空数组 = 这一轮没生成文件。
 * previewText：PDF / 文本的预览内容（demo 只放几行示意）。
 */
const FILES_BY_TOPIC = [
  [
    { name: '销售数据分析.xlsx', kind: 'xlsx', sizeBytes: 48_640 },
    { name: '销售趋势图.png', kind: 'image', sizeBytes: 126_976, image: ['近 6 个月销售额', [42, 55, 48, 61, 39, 44]] }
  ],
  [{ name: '项目周报模板.docx', kind: 'docx', sizeBytes: 23_552 }],
  [],
  [{ name: '排班优化方案.pdf', kind: 'pdf', sizeBytes: 312_320, previewText: ['排班优化方案', '一、现状：三班倒，夜班设备利用率 61%。', '二、方案：调整班次结构，引入弹性排班。', '三、预期：效率提升 12%~18%。'] }],
  [{ name: '会议纪要.txt', kind: 'txt', sizeBytes: 3_174, previewText: ['会议纪要', '决议 1：下周一前完成预算复核（负责人：张**）。', '决议 2：……', '行动项：……'] }],
  [{ name: '合同风险摘要.pdf', kind: 'pdf', sizeBytes: 205_824, previewText: ['合同风险摘要', '第 7 条 违约责任：违约金比例偏高。', '第 12 条 知识产权归属：约定不清。'] }],
  [{ name: '产品报价单.xlsx', kind: 'xlsx', sizeBytes: 61_440 }],
  [{ name: '竞品定价对比.png', kind: 'image', sizeBytes: 98_304, image: ['竞品定价对比（元）', [299, 349, 269, 399]] }],
  [
    { name: '经营分析报告摘要.pdf', kind: 'pdf', sizeBytes: 458_752, previewText: ['经营分析报告摘要', '营收：同比 -3.2%。', '成本：同比 +1.1%。', '利润率：12.4%。'] },
    { name: '营收趋势.png', kind: 'image', sizeBytes: 117_760, image: ['本月营收趋势（万元）', [120, 132, 101, 134, 90, 118, 125]] }
  ],
  [{ name: '公文修订稿.docx', kind: 'docx', sizeBytes: 31_744 }]
]

/** 第 i 条样例的文件；每 7 条里有 1 条文件已失效（留存清理后取不到），用来演示失效态。 */
function filesOf(i, recId) {
  const expired = i % 7 === 6
  return FILES_BY_TOPIC[i % FILES_BY_TOPIC.length].map((f, k) => ({
    id: `${recId}-F${k + 1}`,
    name: f.name,
    kind: f.kind,
    kindLabel: FILE_KINDS[f.kind].label,
    sizeBytes: f.sizeBytes,
    previewable: FILE_KINDS[f.kind].previewable,
    expired,
    url: f.image ? chartImage(...f.image) : '',
    previewText: f.previewText ? [...f.previewText] : []
  }))
}

const pad2 = (n) => String(n).padStart(2, '0')
/** 回复时间 = 提问时间 + 1 分钟。 */
function replyTimeOf(time) {
  const date = time.slice(0, 11)
  let h = parseInt(time.slice(11, 13), 10)
  let m = parseInt(time.slice(14, 16), 10) + 1
  if (m >= 60) { m -= 60; h++ }
  return date + pad2(Math.min(23, h)) + ':' + pad2(m)
}

const RECORDS = TIMES.map((t, i) => {
  const id = 'D-' + (1031 - i)
  const files = filesOf(i, id)
  return {
    id,
    time: t,
    position: POSITIONS[i % POSITIONS.length],
    user: USERS[i % USERS.length],
    snippet: SNIPPETS[i % SNIPPETS.length],
    fileCount: files.length,
    turns: [
      { role: 'user', ts: t, text: SNIPPETS[i % SNIPPETS.length], files: [] },
      { role: 'asst', ts: replyTimeOf(t), text: REPLIES[i % REPLIES.length], disliked: true, files }
    ]
  }
})

const clone = (x) => JSON.parse(JSON.stringify(x))
const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms))

/** 点踩明细列表（表格行，不带对话内容）：{ list, total }；样例全量返回，页面自己分页。 */
export async function listDislikeSamples() {
  await delay()
  const list = RECORDS.map(({ turns, ...row }) => clone(row))
  return { list, total: list.length }
}

/** 某条点踩记录的对话明细：{ id, turns }；turns 为被点踩的单轮，助手回复带生成的文件。 */
export async function getDislikeConversation(id) {
  await delay()
  const rec = RECORDS.find((r) => r.id === id)
  if (!rec) throw new Error('点踩记录不存在')
  return { id: rec.id, turns: clone(rec.turns) }
}
