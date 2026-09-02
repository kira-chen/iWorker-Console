import { describe, it, expect } from 'vitest'
import { envRowsFromDetail, buildEnvSubmit, buildProbeEnv, emptyEnvRow } from '@/utils/mcpEnv'

describe('envRowsFromDetail — detail 脱敏数组 → 编辑器行（V110 声明式）', () => {
  it('平台值项：configured=true、value 恒空（不回显明文/密文）', () => {
    const r = envRowsFromDetail([{ key: 'API_KEY', valueMasked: true }])
    expect(r).toEqual([
      { key: 'API_KEY', description: '', clientFill: false, value: '', configured: true, valueMasked: '' }
    ])
  })

  it('valueMasked 为掩码串（全站密钥掩码口径 2026-09-01）：透传供行内占位核对', () => {
    const r = envRowsFromDetail([{ key: 'API_KEY', valueMasked: 'sk-*****0ab' }])
    expect(r[0].configured).toBe(true)
    expect(r[0].valueMasked).toBe('sk-*****0ab')
  })

  it('客户端填写项：clientFill=true、configured=false（无平台值可保留）', () => {
    const r = envRowsFromDetail([
      { key: 'TYC_API_KEY', valueMasked: false, description: '天眼查 API Key', clientFill: true }
    ])
    expect(r).toEqual([
      {
        key: 'TYC_API_KEY',
        description: '天眼查 API Key',
        clientFill: true,
        value: '',
        configured: false,
        valueMasked: ''
      }
    ])
  })

  it('存量后端项（无 description/clientFill 字段）：兜底空描述/平台值', () => {
    const r = envRowsFromDetail([{ key: 'DEBUG', valueMasked: true }])
    expect(r[0].description).toBe('')
    expect(r[0].clientFill).toBe(false)
    expect(r[0].configured).toBe(true)
  })

  it('非数组/空/无 key 项：安全兜底', () => {
    expect(envRowsFromDetail(null)).toEqual([])
    expect(envRowsFromDetail([{ valueMasked: true }])).toEqual([])
  })
})

describe('buildEnvSubmit — 编辑器行 → 保存入参（完整期望集）', () => {
  it('平台行留空值=保留旧密文；填值=覆盖；行被删（不在列表）=后端丢弃', () => {
    const rows = [
      { key: 'AMAP_KEY', description: '', clientFill: false, value: '', configured: true },
      { key: 'TOKEN', description: '', clientFill: false, value: 'newtok', configured: true }
    ]
    expect(buildEnvSubmit(rows)).toEqual([
      { key: 'AMAP_KEY', value: '', description: null, clientFill: false },
      { key: 'TOKEN', value: 'newtok', description: null, clientFill: false }
    ])
  })

  it('clientFill 行不带值（即使残留输入也置空，双保险互斥）', () => {
    const rows = [{ key: 'K', description: '说明', clientFill: true, value: 'leak', configured: false }]
    expect(buildEnvSubmit(rows)).toEqual([
      { key: 'K', value: '', description: '说明', clientFill: true }
    ])
  })

  it('完全空白行静默丢弃（「添加变量」后未填）；key/描述做 trim', () => {
    const rows = [
      emptyEnvRow(),
      { key: ' A ', description: ' d ', clientFill: false, value: '1', configured: false }
    ]
    expect(buildEnvSubmit(rows)).toEqual([{ key: 'A', value: '1', description: 'd', clientFill: false }])
  })

  it('value 不 trim（保留有意义空格）；空描述归 null', () => {
    const rows = [{ key: 'A', description: '', clientFill: false, value: ' v ', configured: false }]
    expect(buildEnvSubmit(rows)[0].value).toBe(' v ')
    expect(buildEnvSubmit(rows)[0].description).toBeNull()
  })

  it('空/null 输入：返回空数组', () => {
    expect(buildEnvSubmit([])).toEqual([])
    expect(buildEnvSubmit(null)).toEqual([])
  })
})

describe('buildProbeEnv — 编辑器行 → 探测入参（仅 {key,value}）', () => {
  it('平台行下发（留空=后端回退库值）；clientFill 行整行不下发', () => {
    const rows = [
      { key: 'AMAP_KEY', description: '', clientFill: false, value: '', configured: true },
      { key: 'TOKEN', description: '', clientFill: false, value: 'plain', configured: false },
      { key: 'CF_VAR', description: 'x', clientFill: true, value: '', configured: false }
    ]
    expect(buildProbeEnv(rows)).toEqual([
      { key: 'AMAP_KEY', value: '' },
      { key: 'TOKEN', value: 'plain' }
    ])
  })

  it('空白行/空输入：安全兜底', () => {
    expect(buildProbeEnv([emptyEnvRow()])).toEqual([])
    expect(buildProbeEnv(null)).toEqual([])
  })
})
