/**
 * 轻量本地 token 量级估算（backlog · 编辑器体验补强 · AI 专家 P0-1）。
 *
 * 定位：**数量级软提示**，非精确计数、非阻断。真实分词以模型/后端为准，这里只给 FDE「会不会太长」的体感。
 * 零依赖、不调模型。启发式口径（保守偏估，宁可略高提醒）：
 *  - 中文/日韩等 CJK 表意字：约 1 字 ≈ 1 token（多数中文分词器对汉字接近 1:1，部分到 1.5，取 1 偏保守不虚高）；
 *  - 英文单词：约 1 词 ≈ 1.3 token（subword 切分），等价约「每 4 个英文字符 ≈ 1 token」；
 *  - 数字/标点/空白：并入「非 CJK 字符按 ~4 字符/token」一档。
 * 实现：CJK 字符数 + 非 CJK 字符数/4，向上取整。这是公认的「字符级粗估」量级法，足够给数量级提示。
 *
 * 另给「路由候选体量」第二量纲：description / triggers 进 IntentClassifier 路由 prompt 时会被
 * 单行截断 + 软上限（后端默认 description≈100 字、triggers 前 6 个；均可配置，故前端按「约」提示，不写死硬阈值）。
 */

// 判断单个码点是否 CJK 表意/假名/谚文（粗范围，够用即可）。
function isCjkChar(code) {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0x3040 && code <= 0x30ff) || // 平假名 + 片假名
    (code >= 0xac00 && code <= 0xd7af) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xff00 && code <= 0xffef) // 全角符号/半角假名
  )
}

/**
 * 估算文本的 token 量级（整数，向上取整）。空串 → 0。
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const s = String(text ?? '')
  if (!s) return 0
  let cjk = 0
  let other = 0
  // 用 for...of 按码点遍历（正确处理 surrogate pair / emoji，不劈裂）。
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (isCjkChar(code)) cjk += 1
    else other += 1
  }
  // CJK ~1 token/字；非 CJK ~1 token/4 字符。
  return cjk + Math.ceil(other / 4)
}

/**
 * 把 token 量级格式化为友好短文案（数量级，不报精确值）。
 * @param {number} tokens
 * @returns {string} 如 "约 1.2k tokens" / "约 800 tokens"
 */
export function formatTokenEstimate(tokens) {
  const t = Math.max(0, Math.round(tokens))
  if (t >= 1000) return `约 ${(t / 1000).toFixed(1)}k tokens`
  return `约 ${t} tokens`
}

/* 「路由候选体量第二量纲」段（ROUTE_DESC_SOFT_CHARS / ROUTE_TRIGGERS_VISIBLE / routeDescHint / routeTriggersHint）
   已于 2026-09-12 死码清理删除（审计 J13）：零调用方，描述/触发词输入框已不再挂路由体量提示。 */
