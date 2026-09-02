/**
 * 模型连通性验证 —— 错误分类映射与阶段推断（交互设计-模型连通性验证 §5 / §2.3）。
 *
 * 纯函数模块，无副作用、可单测。两件事：
 *  1. `explainVerifyError`：把后端 `verify_error` 原文（形如 `AUTH_FAILED: 鉴权失败（HTTP 401）…`）
 *     翻译成「中文分类名 + 人话简述 + 怎么办」三段。原文技术前缀不该直接甩给使用者。
 *  2. `verifyPhaseOf`：按已知超时边界推断当前验证阶段。
 *
 * 【为什么阶段只能推断、不能实时获取】
 * 后端 verify 是单次同步阻塞调用，中途不回传进度（无 SSE、无异步任务设施）。但探测时序是确定的：
 * 阶段一「基础连通」连接 5s / 读 15s（上限 20s），阶段二「能力探测」三项并行、同样上限 20s。
 * 故 20 秒仍未返回 ⇒ 必然已进入阶段二。这是可靠推断，不是猜测——
 * 因此进度只做「两格离散」，不做百分比动画（那种平滑进度条在这里等于撒谎）。
 */

/** 阶段一上限（ms）：基础连通探测（连接 5s + 读 15s）。 */
export const PHASE_ONE_MS = 20000

/**
 * 七类错误分类 → 展示三段。
 * key 为后端 `ProbeResult.fail(category, ...)` 的分类前缀（ModelConnectivityService.ERR_*
 * 与 ModelConfigAdminService 的 CONFIG_INCOMPLETE）。
 */
const ERROR_MAP = {
  CONFIG_INCOMPLETE: {
    label: '配置不完整',
    brief: '鉴权信息还没填全',
    advice: '在「编辑」里补齐缺少的凭据字段后，保存会自动重新验证。'
  },
  AUTH_FAILED: {
    label: '鉴权失败',
    brief: '密钥被上游拒绝（HTTP 401/403）',
    advice: '检查「API Key」是否填错或已过期，在「编辑」里重填密钥后会自动重新验证。'
  },
  NOT_FOUND: {
    label: '地址或模型不存在',
    brief: '上游找不到该路径或模型标识',
    advice: '检查「接口地址」结尾是否为 /v1、「模型标识」是否与厂商文档一致。'
  },
  TIMEOUT: {
    label: '响应超时',
    brief: '上游 20 秒内没有返回',
    advice: '多为上游繁忙或网络不通，可稍后重试。若持续超时，确认服务器能访问该地址。'
  },
  UNREACHABLE: {
    label: '无法连接',
    brief: '域名解析失败或连接被拒',
    advice: '检查「接口地址」拼写；确认目标不是内网或回环地址（平台出于安全会拒绝）。'
  },
  UPSTREAM_ERROR: {
    label: '上游服务异常',
    brief: '对方服务报错或限流（HTTP 429/5xx）',
    advice: '通常与我方配置无关，稍后重试；若为 429 请检查账户额度与频率限制。'
  },
  PROTOCOL_ERROR: {
    label: '响应格式不符',
    brief: '返回的不是 OpenAI 协议格式',
    advice: '多为地址指向了非 API 页面（如登录页）。检查「接口地址」是否为 OpenAI 兼容的 /v1 根地址。'
  }
}

/** 兜底：分类无法识别时，用原文首句当简述，并引导展开原始错误。 */
const FALLBACK = {
  label: '验证失败',
  advice: '展开「查看原始错误」了解详情。'
}

/**
 * 解析后端 verify_error 原文。
 *
 * @param {string|null|undefined} raw 形如 `AUTH_FAILED: 鉴权失败（HTTP 401），请检查密钥`
 * @returns {{label:string, brief:string, advice:string, raw:string}|null}
 *          raw 为空时返回 null（调用方据此不渲染错误块）
 */
export function explainVerifyError(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null

  const sep = text.indexOf(':')
  const prefix = sep > 0 ? text.slice(0, sep).trim() : ''
  const rest = sep > 0 ? text.slice(sep + 1).trim() : text

  const hit = ERROR_MAP[prefix]
  if (hit) {
    return { label: hit.label, brief: hit.brief, advice: hit.advice, raw: text }
  }
  // 未知分类：不硬套模板，用原文首句（按中英文句读截断）作简述，避免把整段长文塞进标签位。
  const firstSentence = rest.split(/[。；;\n]/)[0].trim() || rest
  return { label: FALLBACK.label, brief: firstSentence, advice: FALLBACK.advice, raw: text }
}

/**
 * 按已开始时长推断验证阶段。
 *
 * @param {number} elapsedMs 自发起验证起的毫秒数
 * @returns {1|2} 1=基础连通探测中；2=能力探测中
 */
export function verifyPhaseOf(elapsedMs) {
  return elapsedMs >= PHASE_ONE_MS ? 2 : 1
}

/** 阶段文案（列表行内展示，克制单行）。 */
export function verifyPhaseText(phase) {
  return phase === 2 ? '正在检测能力…' : '正在连接模型…'
}

/**
 * 验证态 → HealthTag 的 status 取值（复用工具检活四态徽标，不新造第五态）。
 *
 * 注意「验证中」不映射到徽标：进行中是过程而非结论，由行内进度条承载（§4.2）。
 */
export function verifyHealthStatus(verifyStatus) {
  if (verifyStatus === 'SUCCESS') return 'HEALTHY'
  if (verifyStatus === 'FAILED') return 'UNHEALTHY'
  return 'UNKNOWN'
}
