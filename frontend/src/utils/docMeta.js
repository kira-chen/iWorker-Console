/**
 * 个人空间文档展示映射与格式化工具（PRD-03）。
 * 枚举口径严格按契约 §0.1：source 大写、parseStatus 小写，前端不做统一大小写转换。
 */
import { Document, Tickets, Memo } from '@element-plus/icons-vue'

// 来源映射（source 全大写）
export const SOURCE_LABEL = {
  UPLOAD: '上传',
  CHAT_GENERATED: '对话生成'
}

// 处理状态映射（parseStatus 全小写，值不变；仅 label 为面向员工的口语化文案）。
// tag 走 Element Plus el-tag type。
export const STATUS_META = {
  pending: { label: '等待处理', tag: 'info' },
  parsing: { label: '处理中', tag: 'warning' },
  parsed: { label: '可使用', tag: 'success' },
  failed: { label: '处理失败', tag: 'danger' }
}

// 状态筛选下拉项（含 all 伪值，文案与 STATUS_META 对齐）
export const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '等待处理' },
  { value: 'parsing', label: '处理中' },
  { value: 'parsed', label: '可使用' },
  { value: 'failed', label: '处理失败' }
]

// 终态判定（parsed / failed）
export function isTerminal(parseStatus) {
  return parseStatus === 'parsed' || parseStatus === 'failed'
}

/**
 * mimeType → 图标 + 配色类。返回 { icon, cls }。
 * cls 用于 .mt-pdf / .mt-word / .mt-text 配色。
 */
export function mimeIcon(mimeType = '') {
  const m = (mimeType || '').toLowerCase()
  if (m.includes('pdf')) return { icon: Tickets, cls: 'pdf' }
  if (m.includes('word') || m.includes('msword') || m.includes('officedocument')) {
    return { icon: Document, cls: 'word' }
  }
  // txt / markdown / 其余文本
  return { icon: Memo, cls: 'text' }
}

/**
 * mimeType → 面向用户的友好类型名（绝不向员工暴露原始 MIME 串）。
 * 兜底走扩展名/关键字推断，最终回退「文档」。
 * @param {string} mimeType 原始 mimeType
 * @param {string} name 文件名（用于按扩展名兜底）
 */
export function friendlyType(mimeType = '', name = '') {
  const m = (mimeType || '').toLowerCase()
  const ext = (name || '').slice((name || '').lastIndexOf('.') + 1).toLowerCase()
  if (m.includes('pdf') || ext === 'pdf') return 'PDF 文档'
  if (
    m.includes('word') ||
    m.includes('msword') ||
    m.includes('wordprocessingml') ||
    ext === 'doc' ||
    ext === 'docx'
  ) {
    return 'Word 文档'
  }
  if (m.includes('markdown') || ext === 'md' || ext === 'markdown') return 'Markdown 文档'
  if (m.includes('text') || ext === 'txt') return '文本文件'
  return '文档'
}

/**
 * 失败原因人话兜底：后端 errorReason 可能漏出错误码 / 英文异常 / 技术串，
 * 这里统一过滤——疑似技术内容一律回退为通用人话，确保用户永远看不到错误码/英文堆栈。
 * @param {string} reason 后端返回的原始失败原因
 * @returns {string} 适合直接展示给员工的人话
 */
const GENERIC_FAIL = '这份文件没能处理成功，请换个文件或稍后重试'
export function friendlyError(reason) {
  const raw = (reason == null ? '' : String(reason)).trim()
  if (!raw) return GENERIC_FAIL

  // 命中已知常见情况 → 给更贴心的话术
  const lower = raw.toLowerCase()
  if (/(corrupt|damaged|损坏|无法打开|无法读取|broken)/.test(lower)) {
    return '这份文件可能已损坏或无法打开，请检查后重新上传'
  }
  if (/(unsupported|not\s*support|格式|encrypt|加密|password|口令)/.test(lower)) {
    return '这份文件的格式或加密方式暂不支持，请换个文件再试'
  }
  if (/(empty|空白|空文件|no\s*content|无内容)/.test(lower)) {
    return '没有从这份文件里读到可用内容，请确认文件内容后重试'
  }
  if (/(timeout|超时)/.test(lower)) {
    return '这份文件处理超时了，请稍后重试'
  }
  if (/(too\s*large|过大|size|容量)/.test(lower)) {
    return '这份文件太大，处理未能完成，请精简后重试'
  }

  // 技术串嗅探：含错误码 / 英文异常关键字 / 堆栈 / 大段英文 / 代码符号 → 一律回退人话
  const looksTechnical =
    /\b\d{3,}\b/.test(raw) || // 错误码 / 状态码
    /(exception|error|stack|trace|null|undefined|fail(ed|ure)?|code\s*[:=]|errno|http|status|cause)/i.test(
      raw
    ) ||
    /[{}\[\]<>;]|::|->|@[a-z]|\bat\s+[a-z]/i.test(raw) || // 代码/堆栈符号
    (/[a-zA-Z]/.test(raw) && !/[一-龥]/.test(raw)) // 纯英文（无中文）

  if (looksTechnical) return GENERIC_FAIL

  // 是正常中文短句则原样展示
  return raw
}

// 字节 → 人类可读
export function fmtSize(bytes) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  // 大数（>=100）取整更易读，其余保留一位小数。
  // 注：bytes<1024 已在上方提前 return，故此处 i===0 表示 KB 档而非「字节」，不应强制取整。
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

// ISO 时间 → YYYY-MM-DD HH:mm
export function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * ISO 时间 → 相对时间（「刚刚 / N 秒前 / N 分钟前 / N 小时前 / N 天前」）。
 *
 * 用于「这条信息有多新」比「具体哪一刻」更重要的场景——例如模型的最近验证时间：
 * 管理员真正要判断的是「这个『正常』还可信吗」，`3 分钟前` 比 `2026-08-20 14:32` 直观。
 * 绝对时间仍应以 tooltip / 次要位置并存，便于精确追溯。
 *
 * 口径与 `components/position/SaveStatusIndicator.vue` 的相对时间一致（同一套措辞，
 * 全站单一实现——该组件的本地实现已改为引用此函数）。
 *
 * @param {string|number|Date|null} iso ISO 字符串 / 时间戳 / Date
 * @param {number} [nowMs] 参照时刻（默认 Date.now()），供组件按 tick 刷新与单测注入
 * @returns {string} 空值返回 ''
 */
export function fmtRelative(iso, nowMs) {
  if (!iso) return ''
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, (nowMs ?? Date.now()) - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}
