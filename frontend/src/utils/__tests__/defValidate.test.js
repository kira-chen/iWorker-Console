import { describe, it, expect } from 'vitest'
import {
  validateMcpForm,
  validateApiAuthParams,
  validateMcpEnv,
  validateBizSystemForm,
  isBlankBizPage,
  BIZ_CONN_TYPES,
  API_BODY_METHODS,
  MCP_TRANSPORTS,
  MCP_COMMAND_OPTIONS,
  API_METHODS
} from '@/utils/defValidate'

/**
 * utils/defValidate.js 单测——MCP / API / 业务系统三套表单前端校验。
 * 对齐（2026-09-12 测试审计 T36/T58 整理）：
 *  - MCP：docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md §三.3 / §三.4.1 / §三.4.2 + 一览表 §5.1/§5.2；
 *  - API 鉴权参数行：prd-API.md §三.3 + 一览表 §6.2；
 *  - 业务系统：prd-业务系统.md §三.2 / §三.3 / §三.7 + 一览表 §七（原散在 bizSystemMeta.test.js，T36 搬入并去重）。
 */

describe('常量', () => {
  it('MCP transports', () => {
    expect(MCP_TRANSPORTS).toEqual(['stdio', 'streamable-http'])
  })
  it('API methods', () => {
    expect(API_METHODS).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
  })
  it('MCP command 下拉枚举（V110 纯下拉）', () => {
    expect(MCP_COMMAND_OPTIONS).toEqual(['npx', 'uvx', 'node', 'python3', 'docker'])
  })
})

describe('validateMcpForm（2026-09-01 对齐 PRD §三：code 不校验、名称≤64、描述/图标/超时必填）', () => {
  const valid = {
    name: '报销系统 MCP',
    description: '对接报销系统，提供报销单查询与提交',
    icon: '🧾',
    timeoutMs: 10000,
    transport: 'streamable-http',
    endpoint: 'https://intranet.example/mcp',
    // 示例问题：2026-09-09 PRD 复核轮·G4 起 MCP 也强制必填（md §三.3 L242，与 API / 业务系统拉齐）
    exampleQuestions: ['帮我查这个月的报销单', '帮我提交一张报销单', '帮我查报销审批到哪一步了'],
    tools: [{ name: 'query', bizName: '报销查询', description: '查询单据' }]
  }
  const validStdio = {
    name: '文件 MCP',
    description: '本地文件读写',
    icon: '📁',
    timeoutMs: 10000,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-foo'],
    env: [{ key: 'API_KEY', value: 'secret' }],
    exampleQuestions: ['帮我读取工作区里的文件', '帮我列出目录内容', '帮我写一份文件到工作区'],
    tools: [{ name: 'read', bizName: '读取', description: '读文件' }]
  }
  it('合法表单通过', () => {
    expect(validateMcpForm(valid).ok).toBe(true)
  })
  it('code 不再校验（系统生成、不展示不填写）', () => {
    expect(validateMcpForm({ ...valid, code: '' }).errors.code).toBeUndefined()
    expect(validateMcpForm({ ...valid, code: 'Bad-Code' }).errors.code).toBeUndefined()
  })
  it('名称必填、长度上限 64', () => {
    expect(validateMcpForm({ ...valid, name: '' }).errors.name).toBeTruthy()
    expect(validateMcpForm({ ...valid, name: 'x'.repeat(65) }).errors.name).toBeTruthy()
    expect(validateMcpForm({ ...valid, name: 'x'.repeat(64) }).errors.name).toBeUndefined()
  })
  it('服务描述必填、上限 2000', () => {
    expect(validateMcpForm({ ...valid, description: '' }).errors.description).toBeTruthy()
    expect(validateMcpForm({ ...valid, description: 'a'.repeat(2001) }).errors.description).toBeTruthy()
  })
  it('图标必填', () => {
    expect(validateMcpForm({ ...valid, icon: '' }).errors.icon).toBeTruthy()
  })
  it('超时必填且 1000-120000', () => {
    expect(validateMcpForm({ ...valid, timeoutMs: null }).errors.timeoutMs).toBeTruthy()
    expect(validateMcpForm({ ...valid, timeoutMs: 500 }).errors.timeoutMs).toBeTruthy()
    expect(validateMcpForm({ ...valid, timeoutMs: 120001 }).errors.timeoutMs).toBeTruthy()
    expect(validateMcpForm({ ...valid, timeoutMs: 120000 }).errors.timeoutMs).toBeUndefined()
  })
  it('transport 非法报错', () => {
    expect(validateMcpForm({ ...valid, transport: 'ws' }).errors.transport).toBeTruthy()
  })
  // 2026-09-09 PRD 复核轮 · G4（清单第五节第 3 项）：md §三.3 L242 与 UI 都写「必填，固定 3 条」，
  // 此前保存端无该分支 → 三件套里只有 MCP 放行。补齐后文案与业务系统侧一致。
  it('示例问题：固定 3 条须全部填写（与 API / 业务系统同口径）', () => {
    expect(validateMcpForm({ ...valid, exampleQuestions: ['', '', ''] }).errors.exampleQuestions).toBe(
      '示例问题固定 3 条，须全部填写'
    )
    expect(validateMcpForm({ ...valid, exampleQuestions: ['a', 'b'] }).errors.exampleQuestions).toBeTruthy()
    expect(validateMcpForm({ ...valid, exampleQuestions: undefined }).errors.exampleQuestions).toBeTruthy()
    // 空白串按未填算（trim 后为空）
    expect(validateMcpForm({ ...valid, exampleQuestions: ['a', '  ', 'c'] }).errors.exampleQuestions).toBeTruthy()
  })
  it('示例问题：单条上限 300 字', () => {
    const long = ['x'.repeat(301), 'b', 'c']
    expect(validateMcpForm({ ...valid, exampleQuestions: long }).errors.exampleQuestions).toContain('300')
    const ok300 = ['x'.repeat(300), 'b', 'c']
    expect(validateMcpForm({ ...valid, exampleQuestions: ok300 }).errors.exampleQuestions).toBeUndefined()
  })

  it('工具清单只读化：无工具可保存（不再校验 tools）', () => {
    const r = validateMcpForm({ ...valid, tools: [] })
    expect(r.ok).toBe(true)
    expect(r.errors.tools).toBeUndefined()
  })

  describe('transport 分流（连接字段）', () => {
    it('streamable-http 必填 endpoint 且需 http(s):// 开头', () => {
      expect(validateMcpForm({ ...valid, endpoint: '' }).errors.endpoint).toBeTruthy()
      expect(validateMcpForm({ ...valid, endpoint: 'ftp://x' }).errors.endpoint).toBeTruthy()
      expect(validateMcpForm({ ...valid, endpoint: 'https://x/mcp' }).errors.endpoint).toBeUndefined()
    })
    it('http 模式不校验 command/args/env', () => {
      const r = validateMcpForm({ ...valid, command: '', args: [''], env: [{ key: 'bad-key' }] })
      expect(r.ok).toBe(true)
      expect(r.errors.command).toBeUndefined()
      expect(r.errors.args).toBeUndefined()
      expect(r.errors.env).toBeUndefined()
    })
    it('stdio 合法表单通过', () => {
      expect(validateMcpForm(validStdio).ok).toBe(true)
    })
    it('stdio 必填 command（md 连接器-MCP §4.2 L276「Command：必填，下拉选择」；错误文案「请选择启动命令」为代码口径，md 未给逐字文案）', () => {
      expect(validateMcpForm({ ...validStdio, command: '' }).errors.command).toBe('请选择启动命令')
      expect(validateMcpForm({ ...validStdio, command: '   ' }).errors.command).toBe('请选择启动命令')
    })
    it('stdio args 每项非空', () => {
      expect(validateMcpForm({ ...validStdio, args: ['-y', ''] }).errors.args).toBeTruthy()
    })
    it('stdio env KEY 合法且不重复', () => {
      expect(validateMcpForm({ ...validStdio, env: [{ key: '1BAD', value: 'x' }] }).errors.env).toBeTruthy()
      expect(
        validateMcpForm({ ...validStdio, env: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] }).errors.env
      ).toContain('重复')
    })
    it('stdio 不校验 endpoint（缺 endpoint 也通过）', () => {
      expect(validateMcpForm({ ...validStdio, endpoint: '' }).errors.endpoint).toBeUndefined()
    })
  })

  // 2026-09-12 测试审计 T58（A18）：md §三.4.1 L266-271 + 一览表 §5.2 第 7-9 行。错误落 authConfig（对齐后端 data.field）。
  describe('streamable-http 鉴权（md §三.4.1 L266-271）', () => {
    const apiKey = { ...valid, authType: 'header', authHeaderName: 'X-Api-Key', authValue: 'sk-1' }

    it('选 API Key：Header 名必填 → 「鉴权 Header 名必填」', () => {
      expect(validateMcpForm({ ...apiKey, authHeaderName: '' }).errors.authConfig).toBe('鉴权 Header 名必填')
      expect(validateMcpForm({ ...apiKey, authHeaderName: '   ' }).errors.authConfig).toBe('鉴权 Header 名必填')
    })

    it('Header 名 129 字或含下划线 → 「仅允许字母 / 数字 / 连字符（不超过 128 字符）」；恰 128 字通过', () => {
      const tooLong = validateMcpForm({ ...apiKey, authHeaderName: 'a'.repeat(129) }).errors.authConfig
      expect(tooLong).toBe('鉴权 Header 名仅允许字母 / 数字 / 连字符（不超过 128 字符）')
      expect(validateMcpForm({ ...apiKey, authHeaderName: 'X_Api_Key' }).errors.authConfig).toContain('仅允许字母')
      expect(validateMcpForm({ ...apiKey, authHeaderName: 'a'.repeat(128) }).errors.authConfig).toBeUndefined()
      expect(validateMcpForm({ ...apiKey, authHeaderName: 'X-Api-Key-2' }).ok).toBe(true)
    })

    it('新配置密钥留空 → 「鉴权密钥必填（已配置同类型密钥时留空表示保留原值）」（Bearer 与 API Key 同）', () => {
      const msg = '鉴权密钥必填（已配置同类型密钥时留空表示保留原值）'
      expect(validateMcpForm({ ...valid, authType: 'bearer', authValue: '' }).errors.authConfig).toBe(msg)
      expect(validateMcpForm({ ...apiKey, authValue: '  ' }).errors.authConfig).toBe(msg)
    })

    it('编辑态已配置（authConfigured）留空放行；填了新值也放行；无鉴权 / stdio 不校验密钥', () => {
      expect(validateMcpForm({ ...valid, authType: 'bearer', authValue: '', authConfigured: true }).ok).toBe(true)
      expect(validateMcpForm({ ...apiKey, authValue: '', authConfigured: true }).ok).toBe(true)
      expect(validateMcpForm({ ...valid, authType: 'bearer', authValue: 'tok' }).ok).toBe(true)
      expect(validateMcpForm({ ...valid, authType: 'none', authValue: '' }).ok).toBe(true)
      expect(validateMcpForm({ ...validStdio, authType: 'bearer', authValue: '' }).errors.authConfig).toBeUndefined()
    })
  })
})

describe('validateMcpEnv（V110 声明式行）', () => {
  it('合法返回空串：平台行有值 / 编辑态已配置留空 / 客户端填写无值', () => {
    expect(
      validateMcpEnv([
        { key: 'API_KEY', value: 'x' },
        { key: '_X1', value: '', configured: true },
        { key: 'CF', clientFill: true, description: '客户侧密钥' }
      ])
    ).toBe('')
  })
  it('空 KEY / 非法名 / 重复名各报错', () => {
    expect(validateMcpEnv([{ key: '', value: 'v' }])).toBeTruthy()
    expect(validateMcpEnv([{ key: '1A', value: 'v' }])).toBeTruthy()
    expect(validateMcpEnv([{ key: 'A-B', value: 'v' }])).toBeTruthy()
    expect(validateMcpEnv([{ key: 'A', value: 'v' }, { key: 'A', value: 'v' }])).toContain('重复')
  })
  it('互斥：勾选客户端填写不可再填平台值', () => {
    expect(validateMcpEnv([{ key: 'A', clientFill: true, value: 'leak' }])).toContain('不可再填')
  })
  it('必值：未勾选且无新值无旧值报错；已配置（configured）留空放行', () => {
    expect(validateMcpEnv([{ key: 'A', value: '' }])).toContain('必须填写平台值')
    expect(validateMcpEnv([{ key: 'A', value: '', configured: true }])).toBe('')
  })
  it('描述超 200 字报错', () => {
    expect(validateMcpEnv([{ key: 'A', value: 'v', description: 'x'.repeat(201) }])).toContain('描述')
  })
  it('完全空白行跳过（「添加变量」未填不拦保存）', () => {
    expect(validateMcpEnv([{ key: '', value: '', description: '' }])).toBe('')
  })
  // 2026-09-09 PRD 复核·G4 · A11（三步式改值/删除，md §三.4.2 L285）
  it('待删除行（pendingDelete）跳过校验：保存时本就丢弃，不该被自己的规则拦住', () => {
    // 若不跳过，这行「未勾客户端填写又没值」会报「必须填写平台值」
    expect(validateMcpEnv([{ key: 'A', value: '', pendingDelete: true }])).toBe('')
    // 删掉旧的同名变量、另加一个同名新变量：不算重复
    expect(
      validateMcpEnv([
        { key: 'A', value: '', configured: true, pendingDelete: true },
        { key: 'A', value: 'newv' }
      ])
    ).toBe('')
  })
})

// 注：原 validateApiForm / mapApiAuthFromDetail 包装层已随 demo 化清理退役（表单基础校验收口
// ApiEditor 本地 validate、详情回填改直映射）；鉴权多参数行核心 validateApiAuthParams 直测如下。
describe('validateApiAuthParams（鉴权多参数行核心，2026-08-31 改造）', () => {
  it('零有效参数行报错；空白行不计', () => {
    expect(validateApiAuthParams([])).toContain('至少')
    expect(validateApiAuthParams([{ in: 'HEADER', key: '', value: '' }])).toContain('至少')
  })
  it('合法多参数通过（不同位置同名允许）', () => {
    expect(
      validateApiAuthParams([
        { in: 'HEADER', key: 'X-Api-Key', value: 'sk-1' },
        { in: 'QUERY', key: 'appid', value: 'a1' },
        { in: 'QUERY', key: 'X-Api-Key', value: 'dup-name-diff-in-ok' }
      ])
    ).toBe('')
  })
  it('同位置同名去重报错', () => {
    expect(
      validateApiAuthParams([
        { in: 'HEADER', key: 'token', value: 'a' },
        { in: 'HEADER', key: 'token', value: 'b' }
      ])
    ).toContain('重复')
  })
  it('平台参数必值；编辑态已配置（configured）留空放行', () => {
    expect(validateApiAuthParams([{ in: 'HEADER', key: 'k', value: '' }])).toContain('必须填写')
    expect(validateApiAuthParams([{ in: 'HEADER', key: 'k', value: '', configured: true }])).toBe('')
  })
  it('客户端填写与参数值互斥；勾选后无值合法', () => {
    expect(
      validateApiAuthParams([{ in: 'HEADER', key: 'k', clientFill: true, value: 'leak' }])
    ).toContain('不可再填')
    expect(
      validateApiAuthParams([{ in: 'HEADER', key: 'corpid', clientFill: true, description: '企业标识' }])
    ).toBe('')
  })
  it('位置缺失/非法报错', () => {
    expect(validateApiAuthParams([{ key: 'k', value: 'v' }])).toContain('位置')
  })
})

describe('API_BODY_METHODS（BODY 位软提示的 method 口径）', () => {
  it('有请求体的 method = POST/PUT/PATCH（编辑器据此出 BODY×GET/DELETE 软提示，不拦保存）', () => {
    expect(API_BODY_METHODS).toEqual(['POST', 'PUT', 'PATCH'])
  })
})

// 2026-09-12 测试审计 T36：原 bizSystemMeta.test.js:50-210 的 19 条全测本函数，搬入本文件；
// 「url 必填且 http(s)」与「半填行仍照常校验」两条输入完全相同已合并（19→18）；
// 「不再校验 code」空断言已删（T5：validateBizSystemForm 无任何 code 字样，永不红）。
describe('validateBizSystemForm（md 业务系统 §三.2 / §三.3 / §三.7；一览表 §七）', () => {
  const valid = {
    name: '客户管理系统 CRM', // ≤64
    type: 'PLATFORM',
    positionId: null,
    icon: '◎',
    description: '销售办事主系统，记录与查询客户',
    loginUrl: 'https://crm.example.com/login',
    connType: 'login_session',
    bizPages: [{ url: 'https://crm.example.com/workspace', name: '工作台', description: '日常入口' }],
    exampleQuestions: ['帮我发起一个明天下午的请假审批', '帮我打开客户管理工作台', '帮我查询一份员工档案']
  }

  it('连接方式仅登录态托管一种（md §三.2 L96）', () => {
    expect(BIZ_CONN_TYPES.map((c) => c.value)).toEqual(['login_session'])
  })

  it('合法表单通过', () => {
    expect(validateBizSystemForm(valid).ok).toBe(true)
  })

  it('系统名称必填 + ≤64（一览表 §七 第 1 行）', () => {
    expect(validateBizSystemForm({ ...valid, name: '' }).errors.name).toBe('系统名称必填')
    expect(validateBizSystemForm({ ...valid, name: 'x'.repeat(65) }).errors.name).toBe('系统名称不超过 64 字')
    expect(validateBizSystemForm({ ...valid, name: 'x'.repeat(64) }).errors.name).toBeUndefined()
  })

  it('图标必填（md §三.2 L87）', () => {
    expect(validateBizSystemForm({ ...valid, icon: '' }).errors.icon).toBe('请选择或上传图标')
  })

  it('连接器类型必选；所属岗位不强制（2026-09-18 待办 yuepu#1，按 PRD 字面允许先不绑）', () => {
    expect(validateBizSystemForm({ ...valid, type: '' }).errors.type).toBe('请选择连接器类型')
    expect(validateBizSystemForm({ ...valid, type: 'POSITION', positionId: null }).ok).toBe(true)
    expect(validateBizSystemForm({ ...valid, type: 'POSITION', positionId: null }).errors.positionId).toBeUndefined()
  })

  it('系统描述必填 + ≤2000（md §三.2 L95）', () => {
    expect(validateBizSystemForm({ ...valid, description: '' }).errors.description).toBe('系统描述必填')
    expect(validateBizSystemForm({ ...valid, description: 'd'.repeat(2000) }).errors.description).toBeUndefined()
    expect(validateBizSystemForm({ ...valid, description: 'd'.repeat(2001) }).errors.description).toBe('系统描述不超过 2000 字')
  })

  it('登录地址必填 + 合法 HTTP/HTTPS（md §三.2 L97 / §三.7 L144）', () => {
    expect(validateBizSystemForm({ ...valid, loginUrl: '' }).errors.loginUrl).toBe('登录地址必填')
    expect(validateBizSystemForm({ ...valid, loginUrl: 'ftp://x' }).errors.loginUrl).toBe('登录地址需以 http:// 或 https:// 开头')
    expect(validateBizSystemForm({ ...valid, loginUrl: 'https://ok.example.com' }).errors.loginUrl).toBeUndefined()
  })

  it('示例问题固定 3 条均必填、每条 ≤300（md §三.2 L98）', () => {
    expect(validateBizSystemForm({ ...valid, exampleQuestions: ['a', '', 'c'] }).errors.exampleQuestions).toBe(
      '示例问题固定 3 条，须全部填写'
    )
    expect(validateBizSystemForm({ ...valid, exampleQuestions: undefined }).errors.exampleQuestions).toBeTruthy()
    expect(
      validateBizSystemForm({ ...valid, exampleQuestions: ['q'.repeat(301), 'b', 'c'] }).errors.exampleQuestions
    ).toBe('示例问题每条不超过 300 字')
    expect(validateBizSystemForm(valid).errors.exampleQuestions).toBeUndefined()
  })

  it('连接方式非法报错', () => {
    expect(validateBizSystemForm({ ...valid, connType: 'weird' }).errors.connType).toBeTruthy()
  })

  it('业务页整体选填：0 条通过（md §三.3 L103）', () => {
    expect(validateBizSystemForm({ ...valid, bizPages: [] }).ok).toBe(true)
    expect(validateBizSystemForm({ ...valid, bizPages: undefined }).ok).toBe(true)
  })

  it('完全空白的业务页行自动丢弃：不报 url/name 必填（md §三.3 L108）', () => {
    const r = validateBizSystemForm({
      ...valid,
      bizPages: [{ url: '', name: '', description: '' }]
    })
    expect(r.ok).toBe(true)
    expect(r.errors['bizPages.0.url']).toBeUndefined()
    expect(r.errors['bizPages.0.name']).toBeUndefined()
  })

  it('空白行不改变其余行的错误下标（错误键仍按原始位置）', () => {
    const r = validateBizSystemForm({
      ...valid,
      bizPages: [
        { url: '', name: '', description: '' }, // 空行：跳过
        { url: 'not-a-url', name: '工作台' } // 第 2 行有错 → 键仍是 bizPages.1.url
      ]
    })
    expect(r.errors['bizPages.1.url']).toBeTruthy()
    expect(r.errors['bizPages.0.url']).toBeUndefined()
  })

  it('isBlankBizPage：三字段皆空（含纯空格）为空行，任一有内容即非空行', () => {
    expect(isBlankBizPage({ url: '', name: '', description: '' })).toBe(true)
    expect(isBlankBizPage({ url: '  ', name: ' ', description: '' })).toBe(true)
    expect(isBlankBizPage({})).toBe(true)
    expect(isBlankBizPage({ url: 'https://a.com' })).toBe(false)
    expect(isBlankBizPage({ description: '只写了描述' })).toBe(false)
  })

  it('业务页逐项：任一字段已填时 URL 必填且 http(s)（md §三.3 L112 / §三.7 L145）', () => {
    // 只填了名称没填 URL 属漏填，不是空行
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: '', name: '工作台' }] }).errors['bizPages.0.url']
    ).toBe('业务页 URL 必填')
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: 'not-a-url', name: '工作台' }] }).errors['bizPages.0.url']
    ).toBe('业务页 URL 需以 http:// 或 https:// 开头')
  })

  it('业务页逐项：名称必填且 ≤20（md §三.3 L107）', () => {
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: 'https://a.com', name: '' }] }).errors['bizPages.0.name']
    ).toBe('业务页名称必填')
    expect(
      validateBizSystemForm({
        ...valid,
        bizPages: [{ url: 'https://a.com', name: 'n'.repeat(21) }]
      }).errors['bizPages.0.name']
    ).toBe('业务页名称不超过 20 字')
  })

  it('业务页逐项：description 选填 ≤100（md 未写上限，代码现状；审计 J15 待补 md）', () => {
    expect(
      validateBizSystemForm({
        ...valid,
        bizPages: [{ url: 'https://a.com', name: '工作台', description: 'd'.repeat(101) }]
      }).errors['bizPages.0.description']
    ).toBeTruthy()
  })

  it('业务页条目数 ≤20（md §三.3 L106）', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      url: `https://a.com/${i}`,
      name: `p${i}`
    }))
    expect(validateBizSystemForm({ ...valid, bizPages: many }).errors.bizPages).toBe('业务页最多 20 条')
    const twenty = many.slice(0, 20)
    expect(validateBizSystemForm({ ...valid, bizPages: twenty }).errors.bizPages).toBeUndefined()
  })

  it('多行错误索引隔离：第 1 行非法不污染第 0 行', () => {
    const r = validateBizSystemForm({
      ...valid,
      bizPages: [
        { url: 'https://ok.com', name: '工作台' },
        { url: 'bad', name: '' }
      ]
    })
    expect(r.errors['bizPages.0.url']).toBeUndefined()
    expect(r.errors['bizPages.1.url']).toBeTruthy()
    expect(r.errors['bizPages.1.name']).toBeTruthy()
  })
})
