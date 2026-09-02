/**
 * 密钥首尾掩码（全站统一口径，2026-09-01 拍板推广）。
 *
 * 规则源自模型管理页 2026-08-22 负责人口径（ModelConfigEditDialog）：
 *   长度 > 8 露前 3 后 3；≤ 8 露前 2 后 2；中间铺 *（星号数=被遮长度，供核对「配的是不是这把密钥」）。
 *   ≤ 4 全遮（露前 2 后 2 会整串暴露）。
 * 消费方：模型凭据（后端/mock 生成）、API 连接器鉴权参数值与 Bearer Token、
 * MCP 访问凭证与 stdio Env 平台值——展示层一律用掩码，明文只在提交瞬间存在。
 */
export function maskSecret(value) {
  const v = String(value ?? '')
  if (!v) return ''
  if (v.length <= 4) return '*'.repeat(v.length)
  const keep = v.length > 8 ? 3 : 2
  return v.slice(0, keep) + '*'.repeat(v.length - keep * 2) + v.slice(-keep)
}
