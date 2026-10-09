// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminMcp.vue 真实 Element Plus 挂载冒烟（2026-10-08 /test-audit 连接器组新建；对齐
 * docs/PRD/数字员工管理端PRD/03能力/连接器/MCP/prd-连接器-MCP.md §一.1 / §二.1 / §二.2 / §二.5）。
 *
 * adminMcp.test.js 把 el-table / el-tooltip / el-select 等桩掉，拦不住组件 setup 期错误与子组件 props 形状问题
 * （2026-09-11 分页条 TDZ 白屏教训；写法照 adminApisSmoke.test.js）。本文件只 mock api 层与 vue-router，
 * 其余用真 Element Plus 挂载整页，断言：
 *  - mount 不抛、console.error 零调用；
 *  - 搜索占位「搜索服务名称或描述」+【新建 MCP】（md §一.1 L13 / L17）；
 *  - el-table 行数正确，状态列三态文案（§二.1 L47）、验证列连接状态文案（§二.2 L60）；
 *  - 分页条（站内统一 .list-pager）「共 N 条数据」（§二.5 L170-172）。
 */
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

const listMcp = vi.fn()
vi.mock('@/api/admin', () => ({
  listMcp: (...a) => listMcp(...a),
  deleteMcp: vi.fn(),
  healthCheckTool: vi.fn(),
  // McpEditor（页内常驻挂载、未打开）的依赖
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  getMcp: vi.fn(),
  testMcpConn: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpToolsDraft: vi.fn()
}))

const AGG = { mcp_1: 'PUBLISHED', mcp_2: 'PENDING_REVIEW', mcp_3: 'NOT_PUBLISHED' }
vi.mock('@/api/market', () => ({
  getMcpServicePublishStatus: vi.fn((id) => Promise.resolve({ targets: [{ target: 'USER_END', aggregateStatus: AGG[id], pendingAction: null }] })),
  publishMcpService: vi.fn(),
  delistMcpService: vi.fn(),
  withdrawMcpService: vi.fn()
}))

const AdminMcp = (await import('@/views/admin/AdminMcp.vue')).default

const ROWS = [
  { id: 'mcp_1', name: '报销系统 MCP', icon: '¥', description: '查询和提交员工报销单', type: 'PLATFORM', transport: 'streamable-http', toolCount: 3, referencedBySkillCount: 2, referencedBySkills: [], displayStatus: 'HEALTHY', lastCheckedAt: '2026-08-24T16:10:00+08:00', updatedAt: '2026-08-24T16:10:00+08:00' },
  { id: 'mcp_2', name: '本地文件 MCP', icon: '▱', description: '读取工作区文件', type: 'SYSTEM_DEFAULT', transport: 'stdio', toolCount: 1, referencedBySkillCount: 0, referencedBySkills: [], displayStatus: 'HEALTHY', lastCheckedAt: '2026-08-23T10:00:00+08:00', updatedAt: '2026-08-23T10:00:00+08:00' },
  { id: 'mcp_3', name: '天气查询 MCP', icon: '', description: '', type: 'POSITION', transport: 'sse', toolCount: 0, positionCount: 0, referencedByPositions: [], displayStatus: 'UNKNOWN', lastCheckedAt: null, updatedAt: '2026-08-20T09:00:00+08:00' }
]

let mounted, errorSpy
beforeEach(() => {
  listMcp.mockReset().mockResolvedValue({ list: ROWS.map((r) => ({ ...r })), total: ROWS.length })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  errorSpy.mockRestore()
})

describe('AdminMcp · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；工具栏 / 行 / 状态与验证标签 / 分页条齐全（md §一.1、§二.1、§二.2、§二.5）', async () => {
    expect(() => {
      mounted = mountReal(AdminMcp)
    }).not.toThrow()
    await flushAll(10)
    expect(errorSpy).not.toHaveBeenCalled()
    const el = mounted.container

    // 工具栏：搜索占位 + 新建入口
    expect(el.querySelector('input[placeholder="搜索服务名称或描述"]')).toBeTruthy()
    expect([...el.querySelectorAll('.el-button')].some((b) => b.textContent.trim() === '新建 MCP')).toBe(true)
    expect(listMcp).toHaveBeenCalledTimes(1)

    // 行数据真的进了 el-table
    const rows = [...el.querySelectorAll('.el-table__body .el-table__row')]
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('报销系统 MCP')

    // 状态列三态文案（发布态由聚合端点得出）
    expect(rows.map((r) => r.querySelector('.status-tag')?.textContent.trim())).toEqual(['已发布', '审核中', '未发布'])
    // 验证列连接状态文案
    expect(rows.map((r) => r.querySelector('.health-tag')?.textContent.trim())).toEqual(['连接正常', '连接正常', '未探测'])

    // 分页条（站内统一 ListPagination → .list-pager）
    expect(el.querySelector('.list-pager')).toBeTruthy()
    expect(el.querySelector('.list-pager').textContent).toContain('共 3 条数据')
  })
})
