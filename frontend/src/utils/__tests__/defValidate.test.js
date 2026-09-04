import { describe, it, expect } from 'vitest'
import {
  validateMcpForm,
  validateApiAuthParams,
  validateMcpEnv,
  API_BODY_METHODS,
  MCP_TRANSPORTS,
  MCP_COMMAND_OPTIONS,
  API_METHODS
} from '@/utils/defValidate'

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
    it('stdio 必填 command（2026-09-04 PRD-20260903 对齐：错误文案照新原型「请选择启动命令」）', () => {
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

