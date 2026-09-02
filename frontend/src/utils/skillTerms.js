/**
 * 技能编辑器面向 FDE 的「说人话」文案 —— 单一真相源（功能波次 2a · 组②）。
 *
 * 收口背景（CR）：此前 SkillFocusEditor 的 TERMS 字典与 filebar/SkillFileTree.promptHint/ToolDock.TAB_TIP/
 * frontmatter 内联文案各写一套，「子文件」措辞三处不一致且 TERMS 多数键是死代码。本模块把所有用户可见的术语/
 * 标注文案集中此处，三处真正复用，删并行文案，确保口径单一。
 *
 * 文案约束：面向不懂技术的配置者，口语化、准确——尤其区分「不直接进 prompt」vs「运行时仍可被读取」，
 * 并明示「子文档需在主文件流程里写明让 AI 去读，否则不会被读」，避免 FDE 误以为 AI 自动会读。
 */

/* ============================ 文件「是否进 prompt」标注 ============================ */

// 文件标签条上的短标注（紧凑）。
export const PROMPT_TAG_ENTRY = '直接喂给 AI'
export const PROMPT_TAG_SUBFILE = '按需读取，不随主文件直接喂 AI'

// 入口（主文件 SKILL.md）完整说明：与 frontmatter「不作为正文喂给 AI」呼应（P2-1 严谨措辞）。
export const PROMPT_FULL_ENTRY =
  '这是主文件，正文会直接交给 AI 阅读（开头的元数据除外）。'
// 子文件完整说明：补「需在主文件写明让 AI 去读，否则不会被读」的关键指引（P2-2 高误区）。
export const PROMPT_FULL_SUBFILE =
  '这个文件不会随主文件直接交给 AI。AI 办事时可以按需打开它来查阅，' +
  '但前提是你在主文件（SKILL.md）的流程里写明让 AI 去读这个文件——否则建了也不会被读到。'

// 文件树节点 title（与上方完整说明同口径，略短适配悬浮）。
export const TREE_HINT_ENTRY = '主文件：正文直接交给 AI 阅读（开头的元数据除外）'
export const TREE_HINT_SUBFILE =
  '辅助文件：不随主文件直接喂 AI。需在主文件(SKILL.md)流程里写明让 AI 去读，否则不会被读到'

/* ============================ 术语「?」气泡 / tooltip 说明（大白话） ============================ */

export const TERMS = {
  // 「入口」徽标——「元数据」统一改「基本信息」口径。
  entry: '主文件（入口）。AI 从这里开始读，正文会直接交给 AI（开头的基本信息除外）。',
  // 「基本信息（元数据）」折叠区——「元数据」单独出现时统一为「基本信息（名称、描述等）」。
  frontmatter: '这里是技能的基本信息（名称、描述等），不作为正文喂给 AI；与上方技能信息互不影响。',
  // 工具坞 tab（大白话，去技术腔）。
  mcp: 'MCP 工具：AI 同事能调用的外部工具/数据源，由后台技术同事接好，你直接选用即可。',
  // API：「接口」对外偏技术 → 说人话（文案微调）。
  api: 'API 工具：连到公司内部系统、让 AI 真能去办事的通道。',
  table: '数据表：AI 可读写的业务数据表。',
  bizSystem: '业务系统：可对接的内部业务系统。'
}

/* ============================ 其它高频位置文案（口语化） ============================ */

// 工具坞顶部提示：正文用到的工具自动算进白名单（删系统腔）。
export const TOOL_WHITELIST_HINT =
  '你在内容里用到的工具会自动算进这个技能能用的工具，不用单独打勾。'

// 触发词 tooltip（口语化，去「路由提示/强匹配」术语）。
export function triggerHint(maxCount) {
  return `最多 ${maxCount} 个。用户说到这些词时更可能用上这个技能（只是提示，不要求一字不差）。`
}

// 描述输入框 tooltip：说明它也参与路由候选判断（P2-3）。
export const DESCRIPTION_HINT =
  '一句话说明这个技能办什么事。它也用来判断该不该选用这个技能，建议写清适用场景。'

/* ============================ 组④：试跑 / 断链提示文案（口语化，集中维护） ============================ */

// 🧪 试跑按钮 tooltip：明示是排练演示、不真实执行。
export const TRIAL_HINT =
  '保存后就地试跑（扮演用户发一句话）。这是排练演示，不会真的发送或修改数据。'
// 试跑禁用原因：技能未存（无 id）/ 未分配岗位。去行话（不提「岗位语境/挂载/Agent」）。
export const TRIAL_DISABLED_NO_SKILL = '请先保存技能'
export const TRIAL_DISABLED_NO_POSITION =
  '这个技能还没分配给任何岗位的 AI 同事，先去工作台把它分配给一个才能试。'

// 断链/失效工具：角标 + 说明（大白话）。known=false=用不了（断链）；DISABLED/UNHEALTHY=会跳过（降级）。
export const REF_BADGE_BROKEN = '用不了'
export const REF_BADGE_DEGRADED = '会跳过'
export const REF_ALERT_BROKEN =
  '运行时取不到这个工具，它不会被算进这个技能能用的工具。如需修复请联系后台技术同事。'
export const REF_ALERT_DISABLED =
  '这个工具已停用，运行时会跳过它，可能影响办事结果。如需修复请联系后台技术同事。'
export const REF_ALERT_UNHEALTHY =
  '这个工具当前异常，运行时可能跳过它，可能影响办事结果。如需修复请联系后台技术同事。'
