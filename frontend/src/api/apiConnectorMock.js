/**
 * API 连接器页内存 mock（demo 数据层，模式同 knowledgeBaseMock.js；开关见 apiConnector.js 头注释）。
 *
 * 模型与状态机对齐 PRD-20260828《03能力/连接器/API/prd-API.md》：
 * - 服务提供系统：纯聚合容器（名称≤64 平台内唯一 + 描述），不设启用/停用；空系统才可删。
 * - API 三态：未发布 NOT_PUBLISHED / 审核中 PENDING_REVIEW / 已发布 PUBLISHED；
 *   pendingAction 区分待审类型（PUBLISH 发布审核 / DEACTIVATE 停用审核），撤回按其恢复：
 *   待审发布撤回 → 未发布；待审停用撤回 → 已发布（PRD §二.4）。
 * - 连通性验证：未探测(null→UNKNOWN)/连接正常 HEALTHY/连接异常 UNHEALTHY；
 *   修改 API 地址、请求方式或鉴权配置后原验证结果失效（回未探测，PRD §二.3）。
 *   探测语义=API 地址可达性（收到任意 HTTP 响应即连通）；健康检查路径已删
 *   （2026-09-01 拍板：多数第三方 API 不提供健康端点，后有需要再说）。
 * - 删除：软引用——无论是否被技能引用均可删（确认影响后继续删，PRD §二.4）。
 * - 鉴权（提案 20260831-2 · B 节）：不鉴权 / API_KEY 多参数行（参数名 + 描述 + 客户端填写 + 位置 + 值）
 *   / BEARER 单 Token（请求时以 Authorization: Bearer <token> 头附加）。
 *   密钥展示统一首尾掩码（2026-09-01 拍板推广模型页口径，见 utils/secretMask）：mock 内部存明文
 *   （demo 数据层，供生成掩码），列表/详情出参只带 valueMasked 掩码串、绝不带明文；
 *   编辑留空=保留原值；clientFill 行值由客户端收集、平台不存。
 */
import { ApiError } from './request'
import { maskSecret } from '@/utils/secretMask'
import { attachPersist } from './mockPersist'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
let psSeq = 5
let apiSeq = 1108
let skillSeq = 10

const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

/* ---------------- 服务提供系统 ---------------- */
let providerSystems = [
  { id: 'pv_1', name: '财务服务系统', description: '聚合报销、付款与财务单据接口' },
  { id: 'pv_2', name: '客户数据平台', description: '客户资料、商机和跟进记录接口' },
  { id: 'pv_3', name: '内容服务中心', description: '内容审核与素材服务' },
  { id: 'pv_4', name: '星火智能体平台', description: '接入星火平台发布的智能体、任务链与知识库能力（OpenAI 协议 v3）' }
]

/* ---------------- API 定义 ---------------- */
// 时间统一带 +08:00（北京时间），fmtTime 展示精确到分钟
const mkApi = (over) => ({
  id: over.code,
  code: over.code,
  name: '',
  icon: '',
  description: '',
  providerSystemId: null,
  method: 'GET',
  // 启用/停用（原型 renderApiEditor 状态单选；仅配置项示意，与发布状态机无联动）
  enabled: true,
  readWrite: 'read',
  url: '',
  authType: 'NONE',
  // API_KEY 多参数：{ params: [{ in: HEADER|QUERY|BODY|PATH, name, description, clientFill, value }] }；
  // BEARER：{ value }。value 为 mock 内部明文，仅用于生成首尾掩码——出参经 toRow 脱敏为 valueMasked。
  authConfig: null,
  requestSchema: null,
  responseSchema: null,
  exampleQuestions: ['', '', ''],
  referencedBySkills: [],
  status: 'NOT_PUBLISHED',
  pendingAction: null,
  displayStatus: null, // null=未探测；HEALTHY/UNHEALTHY
  lastCheckedAt: null,
  lastCheckError: null,
  createdAt: null,
  updatedAt: null,
  publishedAt: null,
  ...over
})

let apis = [
  mkApi({
    code: 'api_1101',
    name: '报销单查询',
    icon: '📄',
    description: '按报销单号查询审批状态与金额',
    providerSystemId: 'pv_1',
    method: 'GET',
    readWrite: 'read',
    url: 'https://finance.example.com/api/expense/status',
    authType: 'API_KEY',
    authConfig: {
      params: [
        { in: 'HEADER', name: 'X-Api-Key', description: '', clientFill: false, value: 'fin-live-9f27c1d8' },
        { in: 'QUERY', name: 'appid', description: '财务系统分配的应用标识', clientFill: true, value: '' }
      ]
    },
    requestSchema: {
      type: 'object',
      properties: { billNo: { type: 'string', description: '报销单号', in: 'QUERY' } },
      required: ['billNo']
    },
    responseSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '审批状态' },
        amount: { type: 'number', description: '报销金额' }
      }
    },
    exampleQuestions: ['帮我查询报销单的当前审批状态', '我上周提的报销现在到哪一步了', '查一下单号 BX20260801 的报销金额'],
    referencedBySkills: [
      { skillId: 'sk_1', skillName: '报销查询技能' },
      { skillId: 'sk_2', skillName: '财务单据助手' }
    ],
    status: 'PUBLISHED',
    displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-24T16:10:00+08:00',
    createdAt: '2026-08-20T09:30:00+08:00',
    updatedAt: '2026-08-24T16:10:00+08:00',
    publishedAt: '2026-08-24T16:10:00+08:00'
  }),
  mkApi({
    code: 'api_1102',
    name: '提交付款申请',
    icon: '💰',
    description: '创建付款申请并返回流程编号',
    providerSystemId: 'pv_1',
    method: 'POST',
    readWrite: 'write',
    url: 'https://finance.example.com/api/payment/apply',
    exampleQuestions: ['帮我提交一笔差旅费付款申请', '给供应商发起一笔付款', '查付款申请需要哪些信息'],
    referencedBySkills: [{ skillId: 'sk_3', skillName: '付款流程助手' }],
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-24T14:28:00+08:00',
    createdAt: '2026-08-21T10:00:00+08:00',
    updatedAt: '2026-08-24T14:28:00+08:00'
  }),
  mkApi({
    code: 'api_1103',
    name: '客户资料查询',
    icon: '👤',
    description: '按客户编号读取客户基础信息',
    providerSystemId: 'pv_2',
    method: 'GET',
    readWrite: 'read',
    url: 'https://crm.example.com/api/customer/profile',
    requestSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: '客户编号', in: 'QUERY' },
        filters: {
          type: 'object',
          description: '筛选条件',
          in: 'QUERY',
          properties: { status: { type: 'string', description: '客户状态' } }
        }
      },
      required: ['customerId']
    },
    responseSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: '客户数据',
          properties: {
            name: { type: 'string', description: '客户名称' },
            score: { type: 'number', description: '客户评分' }
          },
          required: ['name']
        }
      },
      required: ['data']
    },
    exampleQuestions: ['帮我查一下这家客户的基础资料', '客户 C1024 的联系方式是什么', '看看这家客户目前的状态'],
    referencedBySkills: [
      { skillId: 'sk_4', skillName: '客户画像技能' },
      { skillId: 'sk_5', skillName: '商机跟进助手' }
    ],
    status: 'PUBLISHED',
    displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-23T18:40:00+08:00',
    createdAt: '2026-08-18T14:00:00+08:00',
    updatedAt: '2026-08-23T18:40:00+08:00',
    publishedAt: '2026-08-23T18:40:00+08:00'
  }),
  mkApi({
    code: 'api_1104',
    name: '新增客户跟进',
    icon: '✅',
    description: '写入客户跟进记录和下次联系时间',
    providerSystemId: 'pv_2',
    method: 'POST',
    readWrite: 'write',
    url: 'https://crm.example.com/api/follow-up/create',
    exampleQuestions: ['帮我记一条今天的客户拜访跟进', '给这家客户安排下周三的回访', '把刚才的沟通要点存成跟进记录'],
    status: 'NOT_PUBLISHED',
    displayStatus: 'UNHEALTHY',
    lastCheckedAt: '2026-08-22T10:35:00+08:00',
    lastCheckError: 'CONN_REFUSED: 连接被拒绝（目标服务未响应）',
    createdAt: '2026-08-22T09:00:00+08:00',
    updatedAt: '2026-08-22T10:35:00+08:00',
    // mock 专用：该行检活恒返回异常，改过 URL 后恢复正常（模拟修好地址）
    _mockUnhealthy: true
  }),
  // ---- 星火智能体平台接入样例（OpenAI 协议 v3：同一端点，靠 bodyId 区分智能体/任务链/知识库）----
  mkApi({
    code: 'api_1105',
    name: '星火智能体会话',
    icon: '🤖',
    description:
      '调用星火平台已发布的智能体进行对话（OpenAI 协议 v3）。bodyId/appId/stream 为接入时确定的固定值；多轮对话回传上一轮响应中的 sessionId 续聊',
    providerSystemId: 'pv_4',
    method: 'POST',
    readWrite: 'read',
    url: 'https://flames.example.com/openapi/flames/api/v3/chat/completions',
    authType: 'BEARER',
    authConfig: { value: '9a7f3c21:e4b8d6f2a1c95370' }, // Token 形如 appId:appSecret（内部明文，出参掩码）
    requestSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '智能体编码（星火应用详情-关联数据列表复制，固定值）', in: 'BODY' },
        appId: { type: 'string', description: '星火应用 AppID（固定值）', in: 'BODY' },
        stream: { type: 'boolean', description: '是否流式返回（当前接入固定 false）', in: 'BODY', default: 'false' },
        sessionId: { type: 'string', description: '会话 id；多轮对话时传上一轮响应返回的值', in: 'BODY' },
        messages: {
          type: 'array',
          description: '对话消息列表（含历史上下文，累计不超过 8192 tokens）',
          in: 'BODY',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: '角色：user 或 assistant' },
              content: { type: 'string', description: '对话内容' }
            },
            required: ['role', 'content']
          }
        }
      },
      required: ['bodyId', 'appId', 'stream', 'messages']
    },
    responseSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: '本次对话 id' },
        sessionId: { type: 'string', description: '会话 id（下一轮请求回传以续聊）' },
        choices: {
          type: 'array',
          description: '回答内容',
          items: {
            type: 'object',
            properties: {
              delta: {
                type: 'object',
                description: '回答增量',
                properties: {
                  role: { type: 'string', description: '固定 assistant' },
                  content: { type: 'string', description: '回答文本' },
                  content_type: {
                    type: 'string',
                    description: '内容类型：text / recommend / reference / form_input 等'
                  }
                }
              }
            }
          }
        },
        usage: {
          type: 'object',
          description: 'tokens 用量（最后一次返回携带）',
          properties: { total_tokens: { type: 'number', description: '本次交互计费 tokens 总量' } }
        }
      }
    },
    exampleQuestions: ['让星火智能体帮我写一份周报草稿', '问问智能体这个产品功能怎么配置', '帮我总结一下这段客户沟通记录'],
    status: 'PUBLISHED',
    displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-31T15:20:00+08:00',
    createdAt: '2026-08-30T10:00:00+08:00',
    updatedAt: '2026-08-31T15:20:00+08:00',
    publishedAt: '2026-08-31T15:20:00+08:00'
  }),
  mkApi({
    code: 'api_1106',
    name: '星火任务链执行',
    icon: '🔗',
    description:
      '触发星火平台任务链编排并获取节点输出（OpenAI 协议 v3）。parameter.input 按任务链协议的接口详情填写（节点 ID → 参数对象）',
    providerSystemId: 'pv_4',
    method: 'POST',
    readWrite: 'write',
    url: 'https://flames.example.com/openapi/flames/api/v3/chat/completions',
    authType: 'BEARER',
    authConfig: { value: '9a7f3c21:e4b8d6f2a1c95370' },
    requestSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '任务链编码（星火应用详情-关联数据列表复制，固定值）', in: 'BODY' },
        appId: { type: 'string', description: '星火应用 AppID（固定值）', in: 'BODY' },
        stream: { type: 'boolean', description: '是否流式返回（当前接入固定 false）', in: 'BODY', default: 'false' },
        parameter: {
          type: 'object',
          description: '任务链输入',
          in: 'BODY',
          properties: {
            input: {
              type: 'object',
              description: '节点输入参数：节点 ID → 参数对象（按任务链协议-接口详情填写）'
            }
          },
          required: ['input']
        }
      },
      required: ['bodyId', 'appId', 'stream', 'parameter']
    },
    responseSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: '本次调用 id' },
        sessionId: { type: 'string', description: '会话 id' },
        choices: {
          type: 'array',
          description: '节点输出',
          items: {
            type: 'object',
            properties: {
              delta: {
                type: 'object',
                description: '输出增量',
                properties: {
                  content_type: { type: 'string', description: '内容类型：output 或 state' },
                  output: {
                    type: 'object',
                    description: '节点输出内容',
                    properties: {
                      node: { type: 'string', description: '节点 ID' },
                      payload: {
                        type: 'object',
                        description: '返回数据（字段由任务链节点设置决定）',
                        properties: { text: { type: 'string', description: '文本信息' } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    exampleQuestions: ['执行合同审核任务链处理这份文档', '跑一遍数据日报生成流程', '把这批材料交给质检任务链处理'],
    status: 'NOT_PUBLISHED',
    displayStatus: null, // 新接入待连通性验证
    createdAt: '2026-09-01T09:30:00+08:00',
    updatedAt: '2026-09-01T09:30:00+08:00'
  }),
  mkApi({
    code: 'api_1107',
    name: '星火知识库问答',
    icon: '📚',
    description:
      '基于星火平台知识库进行检索问答（OpenAI 协议 v3）。bodyId/appId/stream 为接入时确定的固定值；多轮对话回传上一轮响应中的 sessionId 续聊',
    providerSystemId: 'pv_4',
    method: 'POST',
    readWrite: 'read',
    url: 'https://flames.example.com/openapi/flames/api/v3/chat/completions',
    authType: 'BEARER',
    authConfig: { value: '9a7f3c21:e4b8d6f2a1c95370' },
    requestSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '知识库编码（星火应用详情-关联数据列表复制，固定值）', in: 'BODY' },
        appId: { type: 'string', description: '星火应用 AppID（固定值）', in: 'BODY' },
        stream: { type: 'boolean', description: '是否流式返回（当前接入固定 false）', in: 'BODY', default: 'false' },
        sessionId: { type: 'string', description: '会话 id；多轮对话时传上一轮响应返回的值', in: 'BODY' },
        messages: {
          type: 'array',
          description: '对话消息列表（含历史上下文，累计不超过 8192 tokens）',
          in: 'BODY',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: '角色：user 或 assistant' },
              content: { type: 'string', description: '对话内容' }
            },
            required: ['role', 'content']
          }
        }
      },
      required: ['bodyId', 'appId', 'stream', 'messages']
    },
    responseSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: '本次对话 id' },
        sessionId: { type: 'string', description: '会话 id（下一轮请求回传以续聊）' },
        choices: {
          type: 'array',
          description: '回答内容',
          items: {
            type: 'object',
            properties: {
              delta: {
                type: 'object',
                description: '回答增量',
                properties: {
                  role: { type: 'string', description: '固定 assistant' },
                  content: { type: 'string', description: '回答文本' }
                }
              }
            }
          }
        },
        usage: {
          type: 'object',
          description: 'tokens 用量（最后一次返回携带）',
          properties: {
            prompt_tokens: { type: 'number', description: '含历史问题的总 tokens' },
            completion_tokens: { type: 'number', description: '回答 tokens' },
            total_tokens: { type: 'number', description: '本次交互计费 tokens 总量' }
          }
        }
      }
    },
    exampleQuestions: ['在产品知识库里查这个报错的处理办法', '公司差旅报销制度是怎么规定的', '新员工入职流程有哪些步骤'],
    referencedBySkills: [{ skillId: 'sk_6', skillName: '产品知识问答' }],
    status: 'PUBLISHED',
    displayStatus: 'HEALTHY',
    lastCheckedAt: '2026-08-31T16:05:00+08:00',
    createdAt: '2026-08-30T14:00:00+08:00',
    updatedAt: '2026-08-31T16:05:00+08:00',
    publishedAt: '2026-08-31T16:05:00+08:00'
  })
]

// 【持久化 2026-09-02】全部可变状态 = 三个 let 序号（psSeq/apiSeq/skillSeq）+ providerSystems + apis
// 两个 let 数组（deleteXxx 走整体重赋值，restore 同样直接重赋值即可，不存在跨结构共享引用）。
// 无 Map/Set、无派生索引；「验证中」仅是 healthCheckApi 延时期间的 UI 瞬态，模型里只落
// null/HEALTHY/UNHEALTHY 三个稳定值——restore 兜底把未知值归一为 null（未探测），避免脏数据卡中间态。
const persist = attachPersist('apiConnector', {
  version: 1,
  snapshot: () => ({ psSeq, apiSeq, skillSeq, providerSystems, apis }),
  restore: (d) => {
    if (
      !d ||
      !Number.isFinite(d.psSeq) ||
      !Number.isFinite(d.apiSeq) ||
      !Number.isFinite(d.skillSeq) ||
      !Array.isArray(d.providerSystems) ||
      !Array.isArray(d.apis)
    ) {
      throw new Error('apiConnector 快照形状不合法')
    }
    psSeq = d.psSeq
    apiSeq = d.apiSeq
    skillSeq = d.skillSeq
    providerSystems = d.providerSystems
    apis = d.apis.map((a) => ({
      ...a,
      // 连通性展示态归一：只认三个稳定值，异常快照回「未探测」
      displayStatus: a.displayStatus === 'HEALTHY' || a.displayStatus === 'UNHEALTHY' ? a.displayStatus : null
    }))
  }
})

const nowIso = () => new Date().toISOString()
const findApi = (id) => apis.find((a) => a.id === id || a.code === id)
const findPs = (id) => providerSystems.find((p) => p.id === id)

// 鉴权出参脱敏（全站密钥掩码口径）：明文 value 收敛为首尾掩码 valueMasked，明文绝不出 mock
function sanitizeAuth(a) {
  if (a.authType === 'API_KEY') {
    return {
      params: (a.authConfig?.params || []).map((p) => ({
        in: p.in,
        name: p.name,
        description: p.description,
        clientFill: p.clientFill,
        valueMasked: p.clientFill ? '' : maskSecret(p.value)
      }))
    }
  }
  if (a.authType === 'BEARER') return { valueMasked: maskSecret(a.authConfig?.value) }
  return null
}

// 列表行视图：拼分组名 + 引用数（详情字段一并带出，列表引用清单弹窗免二次请求）；鉴权经脱敏
function toRow(a) {
  return {
    ...a,
    authConfig: sanitizeAuth(a),
    providerSystemName: findPs(a.providerSystemId)?.name || '',
    referencedBySkillCount: a.referencedBySkills.length
  }
}

/* ================= 服务提供系统 ================= */
export async function listProviderSystems() {
  await delay(150)
  return {
    list: providerSystems.map((p) => ({
      ...p,
      apiCount: apis.filter((a) => a.providerSystemId === p.id).length
    }))
  }
}

export async function getProviderSystem(id) {
  await delay(100)
  const p = findPs(id)
  if (!p) throw err('服务提供系统不存在')
  return { ...p }
}

function validatePsPayload(payload, selfId = null) {
  const name = (payload.name || '').trim()
  if (!name) throw err('系统名称必填', 'name')
  if (name.length > 64) throw err('系统名称最多 64 字符', 'name')
  if (providerSystems.some((p) => p.name === name && p.id !== selfId)) {
    throw err('系统名称平台内不可重复', 'name')
  }
  const description = (payload.description || '').trim()
  if (!description) throw err('系统描述必填', 'description')
  if (description.length > 2000) throw err('系统描述最多 2000 字符', 'description')
  return { name, description }
}

export async function createProviderSystem(payload) {
  await delay(200)
  const v = validatePsPayload(payload)
  const ps = { id: `pv_${psSeq++}`, ...v }
  providerSystems.push(ps)
  persist()
  return { ...ps }
}

export async function updateProviderSystem(id, payload) {
  await delay(200)
  const p = findPs(id)
  if (!p) throw err('服务提供系统不存在')
  Object.assign(p, validatePsPayload(payload, p.id))
  persist()
  return { ...p }
}

export async function deleteProviderSystem(id) {
  await delay(200)
  const count = apis.filter((a) => a.providerSystemId === id).length
  if (count > 0) throw err(`该系统下有 ${count} 个 API，需先迁移或删除后才能删除系统`)
  providerSystems = providerSystems.filter((p) => p.id !== id)
  persist()
  return {}
}

/* ================= API 定义 ================= */
export async function listApis(params = {}) {
  await delay(200)
  const kw = (params.keyword || '').trim().toLowerCase()
  let list = apis
  if (kw) {
    // PRD §一：按名称或描述模糊搜索
    list = list.filter(
      (a) => a.name.toLowerCase().includes(kw) || (a.description || '').toLowerCase().includes(kw)
    )
  }
  if (params.state) list = list.filter((a) => a.status === params.state)
  return { list: list.map(toRow) }
}

export async function getApi(id) {
  await delay(150)
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  return toRow(a)
}

function validateApiPayload(payload) {
  if (!(payload.name || '').trim()) throw err('名称不能为空', 'name')
  if (!payload.providerSystemId || !findPs(payload.providerSystemId)) {
    throw err('必须选择所属服务提供系统', 'providerSystemId')
  }
  if (!/^https?:\/\/.+/i.test((payload.url || '').trim())) {
    throw err('API 地址必须为合法的 HTTP 或 HTTPS URL', 'url')
  }
  if (payload.authType === 'API_KEY') {
    const params = payload.authConfig?.params || []
    if (!params.some((p) => (p.name || '').trim())) {
      throw err('已选 API KEY 鉴权，至少配置一条参数', 'authConfig')
    }
  }
}

// 连接相关配置是否变化（PRD §二.3：变了则原验证结果失效，回未探测）
function connChanged(a, payload) {
  if ((payload.url || '').trim() !== a.url) return true
  if (payload.method !== a.method) return true
  if ((payload.authType || 'NONE') !== a.authType) return true
  if (payload.authType === 'API_KEY') {
    const oldP = a.authConfig?.params || []
    const newP = (payload.authConfig?.params || []).filter((p) => (p.name || '').trim())
    if (newP.length !== oldP.length) return true
    // 行序即语义（编辑器行序保存），逐行比位置/参数名/客户端填写；掩码口径下编辑器仅在
    // 重填新值时回传 value——带了值即视为换密钥（无法与旧明文比对，也不需要）
    if (
      newP.some(
        (p, i) =>
          p.in !== oldP[i]?.in ||
          (p.name || '').trim() !== (oldP[i]?.name || '') ||
          !!p.clientFill !== !!oldP[i]?.clientFill ||
          !!(p.value || '').trim()
      )
    ) {
      return true
    }
  }
  if (payload.authType === 'BEARER' && (payload.authConfig?.value || '').trim()) {
    return true // 换了 Token 也算连接配置变化
  }
  return false
}

function applyApiPayload(a, payload) {
  a.name = payload.name.trim()
  a.icon = payload.icon || ''
  a.description = (payload.description || '').trim()
  a.providerSystemId = payload.providerSystemId
  a.method = payload.method
  a.enabled = payload.enabled !== false
  a.readWrite = payload.readWrite === 'write' ? 'write' : 'read'
  a.url = payload.url.trim()
  a.requestSchema = payload.requestSchema || null
  a.responseSchema = payload.responseSchema || null
  a.exampleQuestions = Array.isArray(payload.exampleQuestions)
    ? [0, 1, 2].map((i) => (payload.exampleQuestions[i] || '').trim())
    : a.exampleQuestions
  a.authType =
    payload.authType === 'API_KEY' || payload.authType === 'BEARER' ? payload.authType : 'NONE'
  if (a.authType === 'API_KEY') {
    const oldParams = a.authConfig?.params || []
    a.authConfig = {
      params: (payload.authConfig?.params || [])
        .filter((p) => (p.name || '').trim())
        .map((p) => {
          const name = p.name.trim()
          // 留空=保留：同「位置+参数名」旧行的明文继续沿用（掩码口径下编辑器不回传未改的值）
          const prev = oldParams.find((o) => o.in === p.in && o.name === name)
          return {
            in: p.in || 'HEADER',
            name,
            description: (p.description || '').trim(),
            clientFill: !!p.clientFill,
            value: p.clientFill ? '' : (p.value || '').trim() || prev?.value || ''
          }
        })
    }
  } else if (a.authType === 'BEARER') {
    // 留空=保留原 Token；填了新值=覆盖
    a.authConfig = {
      value: (payload.authConfig?.value || '').trim() || a.authConfig?.value || ''
    }
  } else {
    a.authConfig = null
  }
}

export async function createApi(payload) {
  await delay(250)
  validateApiPayload(payload)
  const a = mkApi({ code: `api_${apiSeq++}`, createdAt: nowIso(), updatedAt: nowIso() })
  applyApiPayload(a, payload)
  apis.push(a)
  persist()
  return toRow(a)
}

export async function updateApi(id, payload) {
  await delay(250)
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  validateApiPayload(payload)
  const invalidate = connChanged(a, payload)
  applyApiPayload(a, payload)
  if (invalidate) {
    a.displayStatus = null
    a.lastCheckedAt = null
    a.lastCheckError = null
    delete a._mockUnhealthy // 改过连接配置后，检活重新按正常路径判定
  }
  a.updatedAt = nowIso()
  persist()
  return toRow(a)
}

export async function deleteApi(id) {
  await delay(250)
  // PRD §二.4：软引用——无论是否被技能引用，确认后均可删除
  apis = apis.filter((a) => a.id !== id && a.code !== id)
  persist()
  return {}
}

/* ================= 连通性验证 ================= */
export async function healthCheckApi(id) {
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  await delay(900) // 模拟探测耗时（验证中图标旋转可见）
  if (a._mockUnhealthy) {
    a.displayStatus = 'UNHEALTHY'
    a.lastCheckError = 'CONN_REFUSED: 连接被拒绝（目标服务未响应）'
  } else {
    a.displayStatus = 'HEALTHY'
    a.lastCheckError = null
  }
  a.lastCheckedAt = nowIso()
  persist() // 持久化 2026-09-02：探测结果在延时回调后落库（延时期间不落中间态）
  return { displayStatus: a.displayStatus, checkedAt: a.lastCheckedAt, error: a.lastCheckError }
}

/* ================= 发布 / 撤回 / 停用（PRD §二.4 状态机） ================= */
export async function publishApi(id) {
  await delay(250)
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  if (a.status !== 'NOT_PUBLISHED') throw err('仅未发布状态可提交发布')
  if (a.displayStatus !== 'HEALTHY') throw err('连通性验证通过后才可提交发布')
  a.status = 'PENDING_REVIEW'
  a.pendingAction = 'PUBLISH'
  persist()
  return toRow(a)
}

export async function withdrawApi(id) {
  await delay(250)
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  if (a.status !== 'PENDING_REVIEW') throw err('仅审核中状态可撤回')
  // 按待审类型恢复：待审发布 → 未发布；待审停用 → 已发布
  a.status = a.pendingAction === 'DEACTIVATE' ? 'PUBLISHED' : 'NOT_PUBLISHED'
  a.pendingAction = null
  persist()
  return toRow(a)
}

export async function deactivateApi(id) {
  await delay(250)
  const a = findApi(id)
  if (!a) throw err('API 不存在')
  if (a.status !== 'PUBLISHED') throw err('仅已发布状态可停用')
  // 停用走停用审核：状态转审核中，审核通过后变未发布（demo 停在审核中，可撤回恢复已发布）
  a.status = 'PENDING_REVIEW'
  a.pendingAction = 'DEACTIVATE'
  persist()
  return toRow(a)
}

/* ================= 示例问题 AI 生成（demo 本地模板生成） ================= */
const QUESTION_TEMPLATES = [
  (n, d) => `帮我用「${n}」${d ? d.replace(/[。.]$/, '') : '查一下相关信息'}`,
  (n) => `什么情况下应该用「${n}」？给我举个例子`,
  (n) => `用「${n}」帮我处理一下今天的这件事`
]

export async function aiGenerateExampleQuestion({ name, description, index = 0 } = {}) {
  await delay(600) // 模拟模型生成耗时
  const n = (name || '').trim() || '这个 API'
  const d = (description || '').trim()
  const tpl = QUESTION_TEMPLATES[index % QUESTION_TEMPLATES.length]
  return { question: tpl(n, d).slice(0, 60) }
}
