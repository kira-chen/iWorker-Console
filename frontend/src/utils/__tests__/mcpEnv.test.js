import { describe, it, expect } from 'vitest'
import { envRowsFromDetail, buildEnvSubmit, buildProbeEnv, emptyEnvRow } from '@/utils/mcpEnv'

describe('envRowsFromDetail — detail 脱敏数组 → 编辑器行（V110 声明式）', () => {
  it('平台值项：configured=true、value 恒空（不回显明文/密文）', () => {
    const r = envRowsFromDetail([{ key: 'API_KEY', valueMasked: true }])
    // editingValue / pendingDelete：2026-09-09 · A11 三步式界面态，回填即「未修改」
    expect(r).toEqual([
      {
        key: 'API_KEY',
        description: '',
        clientFill: false,
        value: '',
        configured: true,
        valueMasked: '',
        editingValue: false,
        pendingDelete: false
      }
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
        valueMasked: '',
        editingValue: false,
        pendingDelete: false
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

  // 2026-09-09 PRD 复核·G4 · A11（md prd-连接器-MCP.md §三.4.2 L285-286）
  it('待删除行（pendingDelete）被丢弃 → 完整期望集里没有该 KEY = 后端删除', () => {
    const rows = [
      { key: 'KEEP', description: '', clientFill: false, value: '', configured: true, pendingDelete: false },
      { key: 'GONE', description: '', clientFill: false, value: '', configured: true, pendingDelete: true }
    ]
    expect(buildEnvSubmit(rows)).toEqual([
      { key: 'KEEP', value: '', description: null, clientFill: false }
    ])
  })

  it('撤销后（pendingDelete 回 false）该行重新入提交集，且仍走「留空=保留原值」', () => {
    const row = { key: 'GONE', description: '', clientFill: false, value: '', configured: true, pendingDelete: true }
    expect(buildEnvSubmit([row])).toEqual([])
    row.pendingDelete = false
    expect(buildEnvSubmit([row])).toEqual([
      { key: 'GONE', value: '', description: null, clientFill: false }
    ])
  })

  it('改值中的行（editingValue=true）照常提交新值——editingValue 纯界面态，不影响 payload', () => {
    const rows = [
      { key: 'TOKEN', description: '', clientFill: false, value: 'newtok', configured: true, editingValue: true }
    ]
    expect(buildEnvSubmit(rows)).toEqual([
      { key: 'TOKEN', value: 'newtok', description: null, clientFill: false }
    ])
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

  // A11：待删除行不下发探测——保存后它就不存在了，拿它试连是在测一个即将消失的配置
  it('待删除行不进探测入参', () => {
    const rows = [
      { key: 'A', description: '', clientFill: false, value: '1', configured: false },
      { key: 'B', description: '', clientFill: false, value: '2', configured: true, pendingDelete: true }
    ]
    expect(buildProbeEnv(rows)).toEqual([{ key: 'A', value: '1' }])
  })
})
