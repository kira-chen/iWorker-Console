/**
 * 模型接入枚举与字段说明（提供商 / 上下文窗口档位 / 类别 / ? 悬浮文案）。
 *
 * 原「厂商预设模板」MODEL_PRESETS 与 FIELD_TIPS.preset 已于 2026-09-12 死码清理删除（审计 J13）：
 * 预设卡片区 2026-09-09 · A9 按 Q224 决策移除后常量零调用方。
 */

/**
 * 模型提供商（V86）：编辑弹窗「模型提供商」下拉。展示中文厂商名（label），入库存 Provider Name（value）。
 * 2026-09-12 对齐 md §三.2（审计 K24）：中英文之间加空格，与「智谱 GLM、月之暗面 Kimi、阿里 Qwen、小米 MiMo」逐字一致。
 * 本枚举只做「厂商标识」持久化（label 与 md §三.2 逐字一致）。
 */
export const MODEL_PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zai', label: '智谱 GLM' },
  { value: 'moonshot', label: '月之暗面 Kimi' },
  { value: 'qwen-oauth', label: '阿里 Qwen' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'stepfun', label: '阶跃星辰' },
  { value: 'xiaomi', label: '小米 MiMo' },
  { value: 'other', label: '其他' }
]

/** Provider Name → 中文厂商名（列表展示/兜底回填用）。 */
export const MODEL_PROVIDER_LABELS = MODEL_PROVIDER_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label
  return acc
}, {})

/** 上下文窗口常用档位（表单下拉，支持手输自定义值）。 */
export const CONTEXT_WINDOW_OPTIONS = [
  { value: 8192, label: '8K' },
  { value: 16384, label: '16K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
  { value: 196608, label: '192K' },
  { value: 202752, label: '198K' },
  { value: 204800, label: '200K' },
  { value: 262144, label: '256K' },
  { value: 1048576, label: '1M' }
]

/** 模型类别（V83，必填，4 选 1）：业务用途分类（人工枚举，非能力探测）。value 与后端枚举一致。 */
export const MODEL_CATEGORY_OPTIONS = [
  { value: 'TEXT', label: '文本生成' },
  { value: 'VISION', label: '图像理解' },
  { value: 'MULTIMODAL', label: '多模态' },
  { value: 'IMAGE_GEN', label: '文生图' }
]

/** 类别 value → 中文 label（列表展示/兜底回填用）。 */
export const MODEL_CATEGORY_LABELS = MODEL_CATEGORY_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label
  return acc
}, {})

/**
 * 参数解释文案（小白版，? 悬浮显示）。集中维护便于统一口径。
 */
export const FIELD_TIPS = {
  provider:
    '这个模型来自哪个提供商（厂商）。用于标识模型归属，从下拉里选择即可。',
  name: '给这个模型起个好认的名字，比如「DeepSeek V3」。员工在客户端选模型时看到的就是它。',
  category:
    '这个模型主要用来做什么：文本生成（对话/写作）、图像理解（看图回答）、多模态（图文混合）、文生图（按文字画图）。必填；每一类可各自设置 1 个默认模型。',
  baseUrl:
    '模型服务的接口地址，可以在平台官网的开发文档里找到（一般叫 API 地址 / 接入点），通常以 /v1 结尾。系统会自动在后面拼接调用路径。',
  model:
    '要使用哪一款模型的「代号」，必须和平台文档里写的一模一样（区分大小写），比如 deepseek-chat。到平台控制台/开发文档里复制过来最稳妥；填错会在「验证连通性」时暴露。',
  contextWindow:
    '模型一次能“记住”的内容总量（按 token 计，1 个汉字约等于 1~2 个 token），包括你发给它的和它回答的。数值越大，能处理越长的对话和资料。请按平台文档填写；拿不准就选小一档——填大了会导致长对话出错。',
  maxOutputTokens:
    '模型一次回答最多能写多长（按 token 计）。填得比平台允许的大，请求会被拒绝；填得太小，长回答会被截断。默认 4096 适合大多数模型。',
  defaultTemperature:
    '控制回答的“发散程度”：数值低（如 0.2）回答更稳定严谨，数值高（如 1.0）更有创造性。不填则使用平台默认值。注意：各平台允许的范围不同，建议按平台文档的推荐值填写。',
  extraBody:
    '高级选项，不清楚就留空。个别平台要求在每次请求里额外带一些专有参数（JSON 格式），填在这里会原样附加。例如阿里云 qwen3 系列需要 {"enable_thinking": false}。',
  authType:
    '平台给你的密钥形式：只有一串以 sk- 开头的密钥就选「API Key」；给了 AppID、APIKey、APISecret 三样（如讯飞）就选「AppID/AppSecret」。',
  apiKey: '平台分配的调用密钥，在平台控制台的密钥管理里创建/查看。保存后会加密存储，页面不再显示原文。',
  appId: '平台分配的应用 ID（讯飞等三元组平台）。它只是应用的编号，不参与接口调用。',
  appIdApiKey: '三元组里的 APIKey（注意不是 AppID）。系统会自动和 APISecret 组合完成鉴权。',
  appSecret: '三元组里的 APISecret。保存后会加密存储，页面不再显示原文。',
  capabilities:
    '这些能力是系统在「验证连通性」时自动检测出来的，不需要手动填写：流式=支持逐字输出；工具=支持调用外部工具（岗位挂接连接器需要）；JSON=支持强制按 JSON 格式回答；推理=会先思考再回答的模型。'
}
