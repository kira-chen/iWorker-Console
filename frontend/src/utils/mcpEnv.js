/**
 * stdio MCP 的 Env 声明式行编辑（V110，弹窗改造 B 节）——回填 / 提交 / 探测三向组装。
 * 纯函数，无副作用，供 McpEditor 复用并单测覆盖。
 *
 * 行结构（编辑器内部状态）：
 *   { key, description, clientFill, value, configured, editingValue?, pendingDelete? }
 *   - clientFill：true=客户端填写（平台不存值，与 value 互斥）；
 *   - value：平台值明文（仅提交瞬间存在；编辑态留空=保留旧密文）；
 *   - configured：该 KEY 后端已有平台值密文（来自 detail 的 valueMasked，决定「留空=保留」是否可用）；
 *   - editingValue / pendingDelete：三步式改值 / 删除的界面中间态（2026-09-09 · A11，
 *     md §三.4.2 L283-286）。仅 configured 行会被置起，纯 UI 标记，不进提交 payload：
 *     editingValue 只决定「平台值列是否展开输入框」，pendingDelete 决定该行提交时是否被丢弃。
 *
 * 提交语义沿用「完整期望集」：提交的行列表就是全量期望——后端按 KEY merge，
 * 列表里没有的 KEY = 删除（结构化行取代旧 textarea 后，行列表天然全量，
 * 不再有「漏带=误删」的组装陷阱；历史缺陷见旧版 buildStdioEnvSubmit 注释）。
 */

/**
 * detail 的 env 脱敏数组 → 编辑器行。
 * 后端项：{ key, valueMasked, description?, clientFill? }（存量行无 description/clientFill，兜底空/false）。
 * @param {Array<{key:string,valueMasked?:boolean,description?:string,clientFill?:boolean}>} detailEnv
 * @returns {Array<{key:string,description:string,clientFill:boolean,value:string,configured:boolean}>}
 */
export function envRowsFromDetail(detailEnv) {
  return (Array.isArray(detailEnv) ? detailEnv : [])
    .filter((e) => e && e.key)
    .map((e) => ({
      key: e.key,
      description: e.description || '',
      clientFill: !!e.clientFill,
      value: '', // 平台值永不回显（明文/密文都不回），留空=保留旧值
      configured: e.valueMasked !== false && !e.clientFill,
      // 首尾掩码串（后端/mock 生成，全站密钥掩码口径 2026-09-01）：有则行内占位展示供核对
      valueMasked: typeof e.valueMasked === 'string' ? e.valueMasked : '',
      // 三步式界面态（A11）：回填即「未修改」——不在改值中、不待删除
      editingValue: false,
      pendingDelete: false
    }))
}

/** 行是否「完全空白」（用户加了行没填任何内容）——提交时静默丢弃，不报错。 */
function isBlankRow(r) {
  return !(r.key || '').trim() && !(r.description || '').trim() && !(r.value || '').trim()
}

/**
 * 行是否应从提交/探测中丢弃：完全空白，或被标了【删除】还没【撤销】（A11，md §三.4.2 L285）。
 * 「完整期望集」语义下，列表里没有的 KEY 即后端删除该 KEY——所以「待删除」在这一步落地。
 */
function isDroppedRow(r) {
  return isBlankRow(r) || !!r.pendingDelete
}

/**
 * 编辑器行 → 保存入参 env 列表（完整期望集，后端 applyEnv 口径）。
 * - 完全空白行丢弃（宽容未填的「添加变量」空行）；
 * - 【删除】标记（pendingDelete）未撤销的行丢弃（A11）→ 后端按完整期望集删掉该 KEY；
 * - clientFill 行不带 value（后端互斥校验，双保险这里也置空）；
 * - 平台行 value 原样透传（留空=保留旧密文；不 trim，避免吞掉有意义空格）。
 *   三步式下「未点【改值】」的行 value 恒空 → 天然走「留空=保留原值」（md L286）。
 * @param {Array} rows 编辑器行
 * @returns {Array<{key:string,value:string,description:string|null,clientFill:boolean}>}
 */
export function buildEnvSubmit(rows) {
  return (rows || [])
    .filter((r) => r && !isDroppedRow(r))
    .map((r) => ({
      key: (r.key || '').trim(),
      value: r.clientFill ? '' : r.value || '',
      description: (r.description || '').trim() || null,
      clientFill: !!r.clientFill
    }))
}

/**
 * 编辑器行 → 探测入参 env 列表（test-connection / 草稿拉取工具）。
 * 探测端 EnvItem 仅 {key, value}（草稿明文，不落库）：
 * - 平台行照旧下发（重填=明文试连；留空=空值，已存对象由后端回退库内密文解密）；
 * - clientFill 行无值可探，整行不下发（管理端探测本就代表不了客户端环境，
 *   该服务若必需此变量，探测可能失败——属预期，界面另有提示）。
 * @param {Array} rows 编辑器行
 * @returns {Array<{key:string,value:string}>}
 */
export function buildProbeEnv(rows) {
  return (rows || [])
    .filter((r) => r && !isDroppedRow(r) && !r.clientFill && (r.key || '').trim())
    .map((r) => ({ key: (r.key || '').trim(), value: r.value || '' }))
}

/** 新增一行的空白模板（编辑器「添加变量」）。新行 configured=false → 不走三步式，直填直删。 */
export function emptyEnvRow() {
  return {
    key: '',
    description: '',
    clientFill: false,
    value: '',
    configured: false,
    editingValue: false,
    pendingDelete: false
  }
}
