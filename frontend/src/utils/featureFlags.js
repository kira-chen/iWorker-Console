/**
 * 前端功能开关（构建期常量，非运行时配置）。
 *
 * EFFECT_TEST_ENABLED —— 岗位/技能「效果测试 / 试跑」全部入口的总开关。
 * 当前平台不包含执行链路，测试台无法真实试跑，先统一隐藏入口（2026-07）；
 * 执行链路就绪后改回 true 即恢复：
 *   - AdminPositions 列表行「🧪 测试」
 *   - AdminSkillsUnified（「技能」页）列表行「🧪 测试」（仅岗位私有行）
 *   - PositionWorkbench 顶栏「🧪 效果测试」
 *   - SkillFocusEditor 顶栏「🧪 试跑此技能」（岗位白板 + 技能编辑页共用）
 *   - PositionSampleTaskStage 样例任务行「测试」（仿真试跑）
 */
export const EFFECT_TEST_ENABLED = false

// 注：原 FRONT_RUNTIME_ENABLED（员工端运行时页封存开关）已于 2026-09-12 随
// 负责人决策 3（审计 J2）「员工端整体退役」一并删除——页面本身都没了，开关无从谈起。

/**
 * MCP_AUTH_CONFIG_ENABLED —— MCP 连接器「鉴权配置」录入区开关（McpEditor 连接/鉴权区）。
 * 开启后 FDE 可在后台为 streamable-http / sse MCP 录入 Bearer Token / 自定义 Header 密钥
 * （明文仅提交瞬间存在，后端 AES-256-GCM 加密落库，回显恒脱敏）。
 * 关闭时录入区回落只读占位，保存不携带 authConfig（后端保留既有配置不清空）。
 */
export const MCP_AUTH_CONFIG_ENABLED = true
