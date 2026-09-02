import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// store 依赖 @/api/memory 网络层；全部 mock 成可控 resolve/reject，
// 只验证 store 的纯逻辑（筛选复位、类型字典、删除回退页、编辑冲突透传）。
const listMemories = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
const getMemoryDetail = vi.fn(() => Promise.resolve({ id: 1, version: 3 }))
const updateMemory = vi.fn(() => Promise.resolve({ id: 1, version: 4 }))
const deleteMemoryItem = vi.fn(() => Promise.resolve())
const getMemoryTypes = vi.fn(() =>
  Promise.resolve([
    { code: 'fact', label: '事实' },
    { code: 'task', label: '待办' }
  ])
)
vi.mock('@/api/memory', () => ({
  listMemories: (...a) => listMemories(...a),
  getMemoryDetail: (...a) => getMemoryDetail(...a),
  updateMemory: (...a) => updateMemory(...a),
  deleteMemoryItem: (...a) => deleteMemoryItem(...a),
  getMemoryTypes: (...a) => getMemoryTypes(...a)
}))

// ApiError 仅用于冲突路径断言，给个最小实现
vi.mock('@/api/request', () => ({
  ApiError: class ApiError extends Error {
    constructor({ code, message }) {
      super(message)
      this.code = code
    }
  }
}))

import {
  useMemoryStore,
  sourceTypeLabel,
  CODE_VERSION_CONFLICT
} from '@/stores/memory'
import { ApiError } from '@/api/request'

describe('memory store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  /* ---------------- 类型字典 ---------------- */
  it('loadTypes 拉取字典并建立 code→label 映射；重复调用不再请求', async () => {
    const s = useMemoryStore()
    await s.loadTypes()
    expect(getMemoryTypes).toHaveBeenCalledTimes(1)
    expect(s.typeLabel('fact')).toBe('事实')
    expect(s.typeLabel('task')).toBe('待办')
    // 未命中回退原 code
    expect(s.typeLabel('unknown')).toBe('unknown')
    // 已加载过不重复请求
    await s.loadTypes()
    expect(getMemoryTypes).toHaveBeenCalledTimes(1)
  })

  /* ---------------- 筛选复位 ---------------- */
  it('setFilters 改类型/关键词时 page 复位为 1 并重拉，带 status=active', async () => {
    const s = useMemoryStore()
    s.page = 5
    await s.setFilters({ keyword: 'hello', memoryType: 'fact' })
    expect(s.page).toBe(1)
    expect(s.keyword).toBe('hello')
    expect(s.memoryType).toBe('fact')
    const arg = listMemories.mock.calls.at(-1)[0]
    expect(arg).toMatchObject({ keyword: 'hello', memoryType: 'fact', status: 'active', page: 1 })
  })

  it('setPage 仅切页重拉，不动筛选', async () => {
    const s = useMemoryStore()
    await s.setPage(3)
    expect(s.page).toBe(3)
    expect(listMemories.mock.calls.at(-1)[0]).toMatchObject({ page: 3 })
  })

  /* ---------------- 列表错误态 ---------------- */
  it('loadList 失败置 error=true，成功置回 false', async () => {
    const s = useMemoryStore()
    listMemories.mockRejectedValueOnce(new Error('boom'))
    await s.loadList()
    expect(s.error).toBe(true)
    await s.loadList()
    expect(s.error).toBe(false)
  })

  /* ---------------- 编辑 ---------------- */
  it('updateMemory 成功后重拉列表并返回最新详情', async () => {
    const s = useMemoryStore()
    const r = await s.updateMemory(1, { content: 'x', version: 3 })
    expect(updateMemory).toHaveBeenCalledWith(1, { content: 'x', version: 3 })
    expect(r).toMatchObject({ version: 4 })
    expect(listMemories).toHaveBeenCalled()
  })

  it('updateMemory 版本冲突(2006)透传 ApiError 供页面处理', async () => {
    const s = useMemoryStore()
    updateMemory.mockRejectedValueOnce(new ApiError({ code: CODE_VERSION_CONFLICT, message: '冲突' }))
    await expect(s.updateMemory(1, { version: 1 })).rejects.toMatchObject({
      code: CODE_VERSION_CONFLICT
    })
  })

  /* ---------------- 删除回退页 ---------------- */
  it('removeMemory 删当前页最后一条且非首页时回退一页再重拉', async () => {
    const s = useMemoryStore()
    s.list = [{ id: 9 }]
    s.page = 3
    await s.removeMemory(9)
    expect(deleteMemoryItem).toHaveBeenCalledWith(9)
    expect(s.page).toBe(2)
  })

  it('removeMemory 首页删最后一条不回退（page 维持 1）', async () => {
    const s = useMemoryStore()
    s.list = [{ id: 9 }]
    s.page = 1
    await s.removeMemory(9)
    expect(s.page).toBe(1)
  })

  /* ---------------- 来源友好化 ---------------- */
  it('sourceTypeLabel 已知映射中文、未知回退原值、空回退 -', () => {
    expect(sourceTypeLabel('chat_extract')).toBe('对话抽取')
    expect(sourceTypeLabel('manual')).toBe('手动')
    expect(sourceTypeLabel('weird')).toBe('weird')
    expect(sourceTypeLabel('')).toBe('-')
  })
})
