import { describe, it, expect } from 'vitest'
import {
  rowsToSchema,
  schemaToRows,
  validateRows,
  FIELD_TYPES
} from '@/utils/schema'

describe('FIELD_TYPES', () => {
  it('暴露类型白名单 string/number/integer/boolean/object/array（2026-09-01 增 integer）', () => {
    expect(FIELD_TYPES.map((t) => t.value)).toEqual([
      'string',
      'number',
      'integer',
      'boolean',
      'object',
      'array'
    ])
  })
})

describe('rowsToSchema', () => {
  it('空 rows / null / undefined → null（不提交空 schema）', () => {
    expect(rowsToSchema([])).toBeNull()
    expect(rowsToSchema(null)).toBeNull()
    expect(rowsToSchema(undefined)).toBeNull()
  })

  it('全部字段名为空白 → 视为无有效字段 → null', () => {
    expect(rowsToSchema([{ name: '   ', type: 'string' }])).toBeNull()
    expect(rowsToSchema([{ name: '', type: 'string' }])).toBeNull()
  })

  it('单字段：组装 type=object + properties，无 required 字段时不带 required 键', () => {
    const schema = rowsToSchema([{ name: 'billNo', type: 'string' }])
    expect(schema).toEqual({
      type: 'object',
      properties: { billNo: { type: 'string' } }
    })
    expect('required' in schema).toBe(false)
  })

  it('required 字段进入 required 数组', () => {
    const schema = rowsToSchema([
      { name: 'a', type: 'string', required: true },
      { name: 'b', type: 'number', required: false }
    ])
    expect(schema.required).toEqual(['a'])
    expect(schema.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'number' }
    })
  })

  it('description 非空才写入，空白被裁剪丢弃', () => {
    const schema = rowsToSchema([
      { name: 'a', type: 'string', description: '  说明  ' },
      { name: 'b', type: 'string', description: '   ' }
    ])
    expect(schema.properties.a.description).toBe('说明')
    expect('description' in schema.properties.b).toBe(false)
  })

  it('字段名前后空白被 trim', () => {
    const schema = rowsToSchema([{ name: '  name  ', type: 'string' }])
    expect(Object.keys(schema.properties)).toEqual(['name'])
  })

  it('非法/未知 type 兜底为 string（含历史 date 类型）；合法 type（含 integer）原样保留', () => {
    const schema = rowsToSchema([
      { name: 'a', type: 'float' }, // 非白名单
      { name: 'b', type: undefined },
      { name: 'c', type: 'boolean' },
      { name: 'd', type: 'date' }, // 历史日期类型已从白名单移除，归一为 string
      { name: 'e', type: 'integer' } // 2026-09-01 转正
    ])
    expect(schema.properties.a.type).toBe('string')
    expect(schema.properties.b.type).toBe('string')
    expect(schema.properties.c.type).toBe('boolean')
    expect(schema.properties.d.type).toBe('string')
    expect(schema.properties.e.type).toBe('integer')
  })

  it('请求参数扩展键（2026-09-01）：in / defaultValue 按需写入，缺省不带键', () => {
    const schema = rowsToSchema([
      { name: 'billNo', type: 'string', in: 'QUERY', defaultValue: ' BX001 ' },
      { name: 'note', type: 'string' }
    ])
    expect(schema.properties.billNo.in).toBe('QUERY')
    expect(schema.properties.billNo.default).toBe('BX001')
    expect('in' in schema.properties.note).toBe(false)
    expect('default' in schema.properties.note).toBe(false)
  })

  it('过滤掉空名行后仅保留有效行', () => {
    const schema = rowsToSchema([
      { name: '', type: 'string' },
      { name: 'keep', type: 'number' }
    ])
    expect(Object.keys(schema.properties)).toEqual(['keep'])
  })
})

describe('schemaToRows', () => {
  it('null / 非对象 / 缺 properties → 空数组', () => {
    expect(schemaToRows(null)).toEqual([])
    expect(schemaToRows(undefined)).toEqual([])
    expect(schemaToRows('x')).toEqual([])
    expect(schemaToRows({ type: 'object' })).toEqual([])
  })

  it('反解析含 required 数组：命中字段 required=true，其余 false', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: {
        a: { type: 'string', description: '甲' },
        b: { type: 'number' }
      },
      required: ['a']
    })
    expect(rows).toEqual([
      { name: 'a', type: 'string', required: true, description: '甲' },
      { name: 'b', type: 'number', required: false, description: '' }
    ])
  })

  it('required 非数组时按无 required 处理', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: 'a'
    })
    expect(rows[0].required).toBe(false)
  })

  it('prop 缺 type / 非白名单 type → 兜底 string；integer 合法保留', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: {
        a: {},
        b: { type: 'float' },
        c: { type: 'boolean' },
        d: { type: 'integer' }
      }
    })
    expect(rows.find((r) => r.name === 'a').type).toBe('string')
    expect(rows.find((r) => r.name === 'b').type).toBe('string')
    expect(rows.find((r) => r.name === 'c').type).toBe('boolean')
    expect(rows.find((r) => r.name === 'd').type).toBe('integer')
  })

  it('请求参数扩展键回显：in / default 存在才加键', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: {
        a: { type: 'string', in: 'BODY', default: 'false' },
        b: { type: 'string' }
      }
    })
    const a = rows.find((r) => r.name === 'a')
    expect(a.in).toBe('BODY')
    expect(a.defaultValue).toBe('false')
    const b = rows.find((r) => r.name === 'b')
    expect('in' in b).toBe(false)
    expect('defaultValue' in b).toBe(false)
  })

  it('prop 为 null 不抛错，description 缺省为空串', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: { a: null }
    })
    expect(rows[0]).toEqual({
      name: 'a',
      type: 'string',
      required: false,
      description: ''
    })
  })
})

describe('往返一致性 rows → schema → rows', () => {
  it('规范化后的 rows 经一次往返等价', () => {
    const rows = [
      { name: 'billNo', type: 'string', required: true, description: '单号' },
      { name: 'amount', type: 'number', required: false, description: '' },
      { name: 'paid', type: 'boolean', required: true, description: '已付' }
    ]
    const back = schemaToRows(rowsToSchema(rows))
    expect(back).toEqual(rows)
  })

  it('含非法 type 的 rows 往返后类型被规范为 string 并保持稳定', () => {
    const rows = [{ name: 'x', type: 'float', required: false, description: '' }]
    const first = schemaToRows(rowsToSchema(rows))
    expect(first[0].type).toBe('string')
    // 二次往返幂等
    const second = schemaToRows(rowsToSchema(first))
    expect(second).toEqual(first)
  })

  it('含 in / defaultValue 的请求参数行往返等价', () => {
    const rows = [
      { name: 'stream', type: 'boolean', required: true, description: '流式开关', in: 'BODY', defaultValue: 'false' }
    ]
    expect(schemaToRows(rowsToSchema(rows))).toEqual(rows)
  })

  it('schema → rows → schema 往返保持等价', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'A' },
        b: { type: 'boolean' }
      },
      required: ['a']
    }
    expect(rowsToSchema(schemaToRows(schema))).toEqual(schema)
  })
})

describe('validateRows', () => {
  it('空 rows / null → 通过（返回 null）', () => {
    expect(validateRows([])).toBeNull()
    expect(validateRows(null)).toBeNull()
  })

  it('空名行报错（PRD §7：新增字段行后字段名不能为空）', () => {
    expect(validateRows([{ name: '   ' }, { name: 'ok' }])).toContain('字段名不能为空')
    expect(validateRows([{ name: '' }])).toContain('字段名不能为空')
  })

  it('重名 → 返回重复字段提示', () => {
    const msg = validateRows([{ name: 'a' }, { name: 'a' }])
    expect(msg).toContain('重复')
    expect(msg).toContain('a')
  })

  it('trim 后重名也能识别', () => {
    expect(validateRows([{ name: 'a' }, { name: ' a ' }])).toContain('重复')
  })

  it('非法字段名（以数字开头）→ 提示不合法', () => {
    expect(validateRows([{ name: '1abc' }])).toContain('不合法')
  })

  it('非法字段名（含连字符/中文/空格）→ 提示不合法', () => {
    expect(validateRows([{ name: 'a-b' }])).toContain('不合法')
    expect(validateRows([{ name: '字段' }])).toContain('不合法')
    expect(validateRows([{ name: 'a b' }])).toContain('不合法')
  })

  it('合法标识符（字母/下划线开头，含数字下划线）→ 通过', () => {
    expect(validateRows([{ name: '_x' }, { name: 'Abc_1' }, { name: 'b2' }])).toBeNull()
  })

  it('重名优先于非法名报告（先查重）', () => {
    const msg = validateRows([{ name: '1a' }, { name: '1a' }])
    expect(msg).toContain('重复')
  })

  it('递归校验 object 子字段：深层非法名也能被识别', () => {
    const msg = validateRows([
      {
        name: 'user',
        type: 'object',
        children: [{ name: 'addr', type: 'object', children: [{ name: '1bad' }] }]
      }
    ])
    expect(msg).toContain('不合法')
  })

  it('object 各层字段名合法 → 通过', () => {
    expect(
      validateRows([
        {
          name: 'user',
          type: 'object',
          children: [
            { name: 'name', type: 'string' },
            { name: 'addr', type: 'object', children: [{ name: 'city', type: 'string' }] }
          ]
        }
      ])
    ).toBeNull()
  })
})

describe('多级嵌套 rowsToSchema', () => {
  it('object 字段递归展开 properties，子字段 required 进子级 required', () => {
    const schema = rowsToSchema([
      {
        name: 'user',
        type: 'object',
        required: true,
        children: [
          { name: 'id', type: 'number', required: true },
          { name: 'name', type: 'string', required: false, description: '姓名' }
        ]
      }
    ])
    expect(schema).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string', description: '姓名' }
          },
          required: ['id']
        }
      },
      required: ['user']
    })
  })

  it('三层嵌套：object 套 object 套标量', () => {
    const schema = rowsToSchema([
      {
        name: 'a',
        type: 'object',
        children: [
          {
            name: 'b',
            type: 'object',
            children: [{ name: 'c', type: 'string' }]
          }
        ]
      }
    ])
    expect(schema.properties.a.properties.b.properties.c).toEqual({ type: 'string' })
  })

  it('object 子字段全空 → 保留 type=object + 空 properties，无 required', () => {
    const schema = rowsToSchema([{ name: 'meta', type: 'object', children: [] }])
    expect(schema.properties.meta).toEqual({ type: 'object', properties: {} })
  })
})

describe('多级嵌套 schemaToRows', () => {
  it('type=object 的 prop 递归反解析 children，命中子级 required', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string', description: '姓名' }
          },
          required: ['id']
        }
      },
      required: ['user']
    })
    expect(rows).toEqual([
      {
        name: 'user',
        type: 'object',
        required: true,
        description: '',
        children: [
          { name: 'id', type: 'number', required: true, description: '' },
          { name: 'name', type: 'string', required: false, description: '姓名' }
        ]
      }
    ])
  })

  it('object 无 properties 时 children 为空数组', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: { meta: { type: 'object' } }
    })
    expect(rows[0].children).toEqual([])
  })
})

describe('多级往返一致性 rows → schema → rows', () => {
  it('含 object 嵌套的 rows 经一次往返等价', () => {
    const rows = [
      { name: 'billNo', type: 'string', required: true, description: '单号' },
      {
        name: 'applicant',
        type: 'object',
        required: false,
        description: '申请人',
        children: [
          { name: 'name', type: 'string', required: true, description: '' },
          {
            name: 'dept',
            type: 'object',
            required: false,
            description: '',
            children: [{ name: 'code', type: 'string', required: false, description: '部门码' }]
          }
        ]
      }
    ]
    expect(schemaToRows(rowsToSchema(rows))).toEqual(rows)
  })

  it('多级 schema → rows → schema 往返保持等价', () => {
    const schema = {
      type: 'object',
      properties: {
        order: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '订单号' },
            items: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }
          },
          required: ['id']
        }
      },
      required: ['order']
    }
    expect(rowsToSchema(schemaToRows(schema))).toEqual(schema)
  })
})

describe('数组类型（PRD-20260828 §三.5：数组可套子字段）', () => {
  it('array 字段带子字段 → items 为 object schema（子级 required 进 items.required）', () => {
    const schema = rowsToSchema([
      {
        name: 'orders',
        type: 'array',
        required: true,
        children: [
          { name: 'id', type: 'number', required: true },
          { name: 'title', type: 'string', required: false }
        ]
      }
    ])
    expect(schema).toEqual({
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'number' }, title: { type: 'string' } },
            required: ['id']
          }
        }
      },
      required: ['orders']
    })
  })

  it('array 无子字段 → 仅声明 type=array，不带 items', () => {
    const schema = rowsToSchema([{ name: 'tags', type: 'array', children: [] }])
    expect(schema.properties.tags).toEqual({ type: 'array' })
  })

  it('array schema 反解析：items.properties → children', () => {
    const rows = schemaToRows({
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
        }
      }
    })
    expect(rows[0].type).toBe('array')
    expect(rows[0].children).toEqual([
      { name: 'id', type: 'number', required: true, description: '' }
    ])
  })

  it('含 array 嵌套的 rows 经一次往返等价', () => {
    const rows = [
      {
        name: 'orders',
        type: 'array',
        required: false,
        description: '订单列表',
        children: [{ name: 'id', type: 'number', required: true, description: '' }]
      }
    ]
    expect(schemaToRows(rowsToSchema(rows))).toEqual(rows)
  })

  it('validateRows 递归校验 array 子字段非法名', () => {
    const msg = validateRows([
      { name: 'list', type: 'array', children: [{ name: '1bad', type: 'string' }] }
    ])
    expect(msg).toContain('不合法')
  })
})
